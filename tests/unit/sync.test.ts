import { describe, expect, it, vi } from "vitest";
import { ClockEstimator, SyncEngine } from "../../apps/web/src/lib/sync-engine";
import type { PlaybackState, Track } from "@resonance/shared";
import type { PlayerAdapter } from "../../apps/web/src/lib/players/types";
const track: Track = {
  provider: "youtube",
  providerTrackId: "abcdefghijk",
  title: "Song",
  artist: "Band",
  access: "playable",
  url: "https://www.youtube.com/watch?v=abcdefghijk",
  durationMs: 300000,
};
function player(): PlayerAdapter {
  return {
    supportsSeek: true,
    load: vi.fn(async () => {}),
    play: vi.fn(async () => {}),
    pause: vi.fn(async () => {}),
    seekTo: vi.fn(async () => {}),
    getCurrentTime: vi.fn(async () => 0),
    getState: vi.fn(async () => "playing" as const),
    setVolume: vi.fn(async () => {}),
    destroy: vi.fn(async () => {}),
  };
}
describe("client synchronization", () => {
  it("selects the lowest RTT clock sample", () => {
    const clock = new ClockEstimator();
    clock.add(1000, 1100, 2050);
    clock.add(2000, 2010, 3005);
    expect(clock.offset).toBe(1000);
  });
  it("rejects stale updates and serializes rapid commands", async () => {
    const adapter = player(),
      clock = new ClockEstimator();
    const engine = new SyncEngine(adapter, clock, vi.fn(), vi.fn());
    const base: PlaybackState = {
      track,
      status: "PLAYING",
      version: 4,
      positionSeconds: 42,
      stateUpdatedAt: Date.now(),
    };
    engine.update(base);
    engine.update({
      ...base,
      version: 5,
      status: "PAUSED",
      positionSeconds: 90,
    });
    engine.update({ ...base, version: 3 });
    await vi.waitFor(() => expect(adapter.pause).toHaveBeenCalled());
    expect(adapter.seekTo).toHaveBeenLastCalledWith(90);
    expect(adapter.play).not.toHaveBeenCalled();
    await engine.destroy();
  });
  it("does not repeatedly seek while a provider buffers", async () => {
    const adapter = player();
    vi.mocked(adapter.getState).mockResolvedValue("buffering");
    const engine = new SyncEngine(
      adapter,
      new ClockEstimator(),
      vi.fn(),
      vi.fn(),
    );
    engine.update({
      track,
      status: "PLAYING",
      version: 1,
      positionSeconds: 42,
      stateUpdatedAt: Date.now(),
    });
    await vi.waitFor(() => expect(adapter.play).toHaveBeenCalled());
    await engine.tick();
    await engine.tick();
    expect(adapter.seekTo).toHaveBeenCalledTimes(1);
    await engine.destroy();
  });
});
