import { z } from "zod";
import type { ProviderId, Track, ProviderErrorCode } from "@resonance/shared";

export class ProviderError extends Error {
  constructor(
    public code: ProviderErrorCode,
    message: string,
  ) {
    super(message);
  }
}
export interface MusicProvider {
  id: ProviderId;
  name: string;
  supportsSeek: boolean;
  supportsQueue: boolean;
  supportsAuthentication: boolean;
  search(query: string): Promise<Track[]>;
  getTrack(id: string): Promise<Track>;
}
async function request(url: string, headers?: HeadersInit): Promise<unknown> {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(10000),
  }).catch(() => {
    throw new ProviderError(
      "UNKNOWN",
      "The music provider could not be reached. Please try again.",
    );
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => undefined);
    const quota = z
      .object({
        error: z.object({
          errors: z.array(z.object({ reason: z.string() })).optional(),
        }),
      })
      .safeParse(body);
    const reasons = quota.success
      ? (quota.data.error.errors?.map((item) => item.reason) ?? [])
      : [];
    const code: ProviderErrorCode =
      response.status === 429 ||
      reasons.some((reason) =>
        ["quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded"].includes(
          reason,
        ),
      )
        ? "RATE_LIMITED"
        : response.status === 401
          ? "AUTH_REQUIRED"
          : response.status === 404
            ? "TRACK_NOT_FOUND"
            : response.status === 403
              ? "NOT_PLAYABLE"
              : "UNKNOWN";
    throw new ProviderError(
      code,
      `Provider request failed (${response.status}). Please try again later.`,
    );
  }
  return response.json().catch(() => {
    throw new ProviderError(
      "UNKNOWN",
      "The music provider returned an unreadable response.",
    );
  });
}
const youtubeVideo = z.object({
  id: z.string(),
  snippet: z.object({
    title: z.string(),
    channelTitle: z.string(),
    thumbnails: z.record(z.string(), z.object({ url: z.string() })).optional(),
  }),
  contentDetails: z.object({ duration: z.string() }),
  status: z.object({ embeddable: z.boolean() }).optional(),
});
export function parseDuration(duration: string): number | undefined {
  const match =
    /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(duration);
  if (!match) return undefined;
  const seconds =
    Number(match[1] ?? 0) * 86400 +
    Number(match[2] ?? 0) * 3600 +
    Number(match[3] ?? 0) * 60 +
    Number(match[4] ?? 0);
  return seconds ? seconds * 1000 : undefined;
}
export function normalizeYouTube(video: z.infer<typeof youtubeVideo>): Track {
  return {
    provider: "youtube",
    providerTrackId: video.id,
    title: video.snippet.title,
    artist: video.snippet.channelTitle,
    thumbnail: video.snippet.thumbnails?.medium?.url,
    durationMs: parseDuration(video.contentDetails.duration),
    url: `https://www.youtube.com/watch?v=${video.id}`,
    access: video.status?.embeddable === false ? "blocked" : "playable",
  };
}
export class YouTubeProvider implements MusicProvider {
  id = "youtube" as const;
  name = "YouTube";
  supportsSeek = true;
  supportsQueue = true;
  supportsAuthentication = false;
  constructor(private apiKey?: string) {}
  private async api(path: string, params: Record<string, string>) {
    if (!this.apiKey)
      throw new ProviderError(
        "AUTH_REQUIRED",
        "YouTube search needs a server API key. See the setup guide.",
      );
    return request(
      `https://www.googleapis.com/youtube/v3/${path}?${new URLSearchParams({ ...params, key: this.apiKey })}`,
    );
  }
  private async videos(ids: string[]) {
    if (!ids.length) return [];
    const data = z.object({ items: z.array(youtubeVideo) }).parse(
      await this.api("videos", {
        part: "snippet,contentDetails,status",
        id: ids.join(","),
      }),
    );
    return data.items.map(normalizeYouTube);
  }
  async search(query: string) {
    const data = z
      .object({
        items: z.array(z.object({ id: z.object({ videoId: z.string() }) })),
      })
      .parse(
        await this.api("search", {
          part: "snippet",
          q: query,
          type: "video",
          videoEmbeddable: "true",
          maxResults: "12",
        }),
      );
    return this.videos(data.items.map((item) => item.id.videoId));
  }
  async getTrack(id: string) {
    if (!/^[a-zA-Z0-9_-]{11}$/.test(id))
      throw new ProviderError("TRACK_NOT_FOUND", "Invalid YouTube video ID");
    const track = (await this.videos([id]))[0];
    if (!track)
      throw new ProviderError(
        "TRACK_NOT_FOUND",
        "This video is no longer available",
      );
    return track;
  }
}
const soundCloudTrack = z.object({
  id: z.union([z.number(), z.string()]).optional(),
  urn: z.string().optional(),
  title: z.string(),
  user: z.object({ username: z.string() }),
  metadata_artist: z.string().nullish(),
  artwork_url: z.string().nullish(),
  duration: z.number().optional(),
  permalink_url: z.string().url(),
  access: z.enum(["playable", "preview", "blocked"]).optional(),
  embeddable_by: z.string().optional(),
});
export function normalizeSoundCloud(
  track: z.infer<typeof soundCloudTrack>,
): Track {
  return {
    provider: "soundcloud",
    providerTrackId: track.urn ?? String(track.id),
    title: track.title,
    artist: track.metadata_artist || track.user.username,
    thumbnail: track.artwork_url ?? undefined,
    durationMs: track.duration,
    url: track.permalink_url,
    access:
      track.embeddable_by === "none" ? "blocked" : (track.access ?? "blocked"),
  };
}
export class SoundCloudProvider implements MusicProvider {
  id = "soundcloud" as const;
  name = "SoundCloud";
  supportsSeek = true;
  supportsQueue = true;
  supportsAuthentication = true;
  constructor(private getToken: () => Promise<string>) {}
  private async api(path: string) {
    return request(`https://api.soundcloud.com${path}`, {
      Authorization: `OAuth ${await this.getToken()}`,
    });
  }
  async search(query: string) {
    const data = z
      .object({ collection: z.array(soundCloudTrack) })
      .parse(
        await this.api(
          `/tracks?${new URLSearchParams({ q: query, limit: "12", linked_partitioning: "true", access: "playable" })}`,
        ),
      );
    return data.collection.map(normalizeSoundCloud);
  }
  async getTrack(id: string) {
    if (!/^(?:soundcloud:tracks:)?\d+$/.test(id))
      throw new ProviderError("TRACK_NOT_FOUND", "Invalid SoundCloud track ID");
    return normalizeSoundCloud(
      soundCloudTrack.parse(
        await this.api(`/tracks/${encodeURIComponent(id)}`),
      ),
    );
  }
}
