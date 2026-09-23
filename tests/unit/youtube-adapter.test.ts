import { afterEach, expect, it, vi } from "vitest";
import { YouTubePlayerAdapter } from "../../apps/web/src/lib/players/youtube";
import type { Track } from "@resonance/shared";
afterEach(() => vi.unstubAllGlobals());
it("waits for the official CUED event before declaring a track loaded", async () => {
  let stateChange: (event: { data: number }) => void = () => {};
  const cue = vi.fn();
  class OfficialPlayerFixture {
    constructor(
      _element: HTMLElement,
      options: {
        events: { onReady: () => void; onStateChange: typeof stateChange };
      },
    ) {
      stateChange = options.events.onStateChange;
      queueMicrotask(options.events.onReady);
    }
    cueVideoById = cue;
    playVideo() {}
    pauseVideo() {}
    seekTo() {}
    setVolume() {}
    destroy() {}
    getCurrentTime() {
      return 0;
    }
    getPlayerState() {
      return 5;
    }
  }
  vi.stubGlobal("window", {
    YT: { Player: OfficialPlayerFixture },
    location: { origin: "http://localhost:3000" },
  });
  vi.stubGlobal("document", { createElement: () => ({}) });
  const adapter = new YouTubePlayerAdapter(
    { append: vi.fn() } as unknown as HTMLElement,
    { onBlocked: vi.fn(), onError: vi.fn() },
  );
  const track: Track = {
    provider: "youtube",
    providerTrackId: "abcdefghijk",
    title: "Song",
    artist: "Artist",
    url: "https://www.youtube.com/watch?v=abcdefghijk",
    access: "playable",
  };
  let loaded = false;
  const pending = adapter.load(track).then(() => {
    loaded = true;
  });
  await vi.waitFor(() =>
    expect(cue).toHaveBeenCalledWith(track.providerTrackId),
  );
  expect(loaded).toBe(false);
  stateChange({ data: 3 });
  expect(loaded).toBe(false);
  stateChange({ data: 5 });
  await pending;
  expect(loaded).toBe(true);
  await adapter.destroy();
});
