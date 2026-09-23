import { expectedPosition, type PlaybackState } from "@resonance/shared";
import type { PlayerAdapter } from "./players/types";
export type SyncStatus =
  | "Syncing…"
  | "Synced"
  | "Resyncing…"
  | "Tap to resume"
  | "Waiting for provider";
export class ClockEstimator {
  private samples: { rtt: number; offset: number }[] = [];
  add(sent: number, received: number, server: number) {
    this.samples.push({
      rtt: received - sent,
      offset: server - (sent + received) / 2,
    });
    this.samples = this.samples.slice(-12);
  }
  get offset() {
    return [...this.samples].sort((a, b) => a.rtt - b.rtt)[0]?.offset ?? 0;
  }
  now() {
    return Date.now() + this.offset;
  }
}
export class SyncEngine {
  private state?: PlaybackState;
  private loadedId = "";
  private appliedVersion = -1;
  private chain: Promise<void> = Promise.resolve();
  private stopped = false;
  private failures = 0;
  private lastCorrection = 0;
  private checking = false;
  constructor(
    private adapter: PlayerAdapter,
    private clock: ClockEstimator,
    private status: (status: SyncStatus) => void,
    private error: (message: string) => void,
  ) {}
  update(state: PlaybackState, force = false) {
    if (
      this.stopped ||
      (!force && this.state && state.version <= this.state.version)
    )
      return;
    this.state = state;
    this.chain = this.chain
      .then(async () => {
        if (this.stopped || this.state !== state) return;
        this.status("Syncing…");
        if (!state.track) {
          await this.adapter.pause();
          this.loadedId = "";
          this.appliedVersion = state.version;
          return;
        }
        const trackId = `${state.track.provider}:${state.track.providerTrackId}`;
        if (this.loadedId !== trackId) {
          await this.adapter.load(state.track);
          this.loadedId = trackId;
        }
        if (this.stopped || this.state !== state) return;
        if (this.adapter.supportsSeek)
          await this.adapter.seekTo(expectedPosition(state, this.clock.now()));
        if (state.status === "PLAYING") await this.adapter.play();
        else await this.adapter.pause();
        this.appliedVersion = state.version;
        this.lastCorrection = Date.now();
        this.failures = 0;
        this.status("Syncing…");
      })
      .catch((error) => {
        this.status("Waiting for provider");
        this.error((error as Error).message);
      });
  }
  async tick() {
    const state = this.state;
    if (
      this.checking ||
      this.stopped ||
      !state?.track ||
      state.version !== this.appliedVersion ||
      this.failures >= 3
    )
      return;
    this.checking = true;
    try {
      const playerState = await this.adapter.getState();
      if (this.stopped || this.state !== state) return;
      if (playerState === "buffering" || playerState === "unavailable") {
        this.status("Waiting for provider");
        return;
      }
      if (state.status === "PLAYING" && playerState !== "playing") {
        this.status("Tap to resume");
        return;
      }
      if (state.status === "PAUSED" && playerState === "playing") {
        await this.adapter.pause();
      }
      const actual = await this.adapter.getCurrentTime();
      if (this.stopped || this.state !== state) return;
      const drift = Math.abs(
        actual - expectedPosition(state, this.clock.now()),
      );
      if (drift < 0.25) {
        this.failures = 0;
        this.status("Synced");
        return;
      }
      if (drift < 1) {
        this.status("Syncing…");
        return;
      }
      if (
        this.adapter.supportsSeek &&
        Date.now() - this.lastCorrection >= 8000
      ) {
        this.failures++;
        this.lastCorrection = Date.now();
        this.status("Resyncing…");
        await this.adapter.seekTo(expectedPosition(state, this.clock.now()));
        if (this.failures >= 3) this.status("Waiting for provider");
      }
    } catch (error) {
      this.status("Waiting for provider");
      this.error((error as Error).message);
    } finally {
      this.checking = false;
    }
  }
  resync() {
    if (this.state) this.update(this.state, true);
  }
  async destroy() {
    this.stopped = true;
    await this.chain;
    await this.adapter.destroy();
  }
}
