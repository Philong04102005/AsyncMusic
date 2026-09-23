"use client";
import { useEffect, useState } from "react";
import { Search, Plus, Play, LoaderCircle, Music2 } from "lucide-react";
import type { Track, ProviderId, Command } from "@resonance/shared";
import { api, time } from "@/lib/api";
import { Dialog } from "../ui/dialog";
export function TrackSearch({
  open,
  setOpen,
  provider,
  roomId,
  canPlay,
  send,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  provider: ProviderId;
  roomId: string;
  canPlay: boolean;
  send: (command: Command) => Promise<void>;
}) {
  const [query, setQuery] = useState(""),
    [tracks, setTracks] = useState<Track[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setTracks([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const timer = setTimeout(() => {
      api<{ tracks: Track[] }>(
        `/api/providers/${provider}/search?${new URLSearchParams({ q: query.trim(), roomId })}`,
        { signal: controller.signal },
      )
        .then((data) => setTracks(data.tracks))
        .catch((e) => {
          if (!controller.signal.aborted) {
            setError((e as Error).message);
            setTracks([]);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 450);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, open, provider, roomId]);
  async function add(track: Track, playNow: boolean) {
    setBusy(true);
    setNotice("");
    setError("");
    try {
      await send({
        type: "queue:add",
        trackId: track.providerTrackId,
        playNow,
      });
      setNotice(
        playNow
          ? "Now playing for the room"
          : `Added “${track.title}” to the queue`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="What should we listen to?"
      description={`Find your next favorite on ${provider === "youtube" ? "YouTube" : "SoundCloud"}.`}
    >
      <div className="search-input search-large">
        <Search size={19} />
        <input
          autoFocus
          placeholder="Search songs, artists, a feeling…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="success" role="status">
          {notice}
        </p>
      )}
      <div className="search-results">
        {loading ? (
          <div className="compact-empty">
            <LoaderCircle className="spin" size={24} />
            <p>Looking for your next song…</p>
          </div>
        ) : tracks.length ? (
          tracks.map((track) => (
            <div className="search-result" key={track.providerTrackId}>
              {track.thumbnail ? (
                <img src={track.thumbnail} alt="" />
              ) : (
                <div className="track-placeholder">
                  <Music2 />
                </div>
              )}
              <div>
                <strong>{track.title}</strong>
                <span>
                  {track.artist} ·{" "}
                  {track.durationMs
                    ? time(track.durationMs / 1000)
                    : "Live / unknown duration"}
                </span>
                <a href={track.url} target="_blank" rel="noopener">
                  {provider === "youtube" ? "YouTube" : "SoundCloud"}
                  {track.access !== "playable" ? ` · ${track.access}` : ""}
                </a>
              </div>
              <button
                disabled={busy || track.access !== "playable"}
                className="icon-button"
                aria-label={`Add ${track.title}`}
                onClick={() => void add(track, false)}
              >
                <Plus size={19} />
              </button>
              {canPlay && (
                <button
                  disabled={busy || track.access !== "playable"}
                  className="icon-button"
                  aria-label={`Play ${track.title} now`}
                  onClick={() => void add(track, true)}
                >
                  <Play size={18} />
                </button>
              )}
            </div>
          ))
        ) : (
          <div className="compact-empty">
            <Music2 size={30} />
            <p>
              {query.length > 1
                ? "No tracks found. Try another search."
                : "Every great queue starts with one song."}
            </p>
          </div>
        )}
      </div>
    </Dialog>
  );
}
