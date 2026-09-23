import type { Track } from "@resonance/shared";
import {
  loadScript,
  type PlayerAdapter,
  type PlayerCallbacks,
  type PlayerState,
} from "./types";
interface Widget {
  bind(event: string, callback: () => void): void;
  unbind(event: string): void;
  load(
    url: string,
    options: { auto_play: boolean; callback: () => void },
  ): void;
  play(): void;
  pause(): void;
  seekTo(ms: number): void;
  getPosition(callback: (ms: number) => void): void;
  isPaused(callback: (paused: boolean) => void): void;
  setVolume(volume: number): void;
}
declare global {
  interface Window {
    SC?: {
      Widget: ((iframe: HTMLIFrameElement) => Widget) & {
        Events: Record<string, string>;
      };
    };
  }
}
function callbackValue<T>(
  run: (callback: (value: T) => void) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("SoundCloud player is not responding")),
      5000,
    );
    run((value) => {
      clearTimeout(timer);
      resolve(value);
    });
  });
}
export class SoundCloudPlayerAdapter implements PlayerAdapter {
  supportsSeek = true;
  private widget?: Widget;
  private iframe?: HTMLIFrameElement;
  private initialized?: Promise<void>;
  constructor(
    private element: HTMLElement,
    private callbacks: PlayerCallbacks,
  ) {}
  async load(track: Track) {
    await loadScript("https://w.soundcloud.com/player/api.js");
    if (this.widget) {
      await callbackValue<void>((callback) =>
        this.widget!.load(track.url, { auto_play: false, callback }),
      );
      return;
    }
    this.iframe = document.createElement("iframe");
    this.iframe.title = "SoundCloud player";
    this.iframe.allow = "autoplay";
    this.iframe.src = `https://w.soundcloud.com/player/?${new URLSearchParams({ url: track.url, auto_play: "false", visual: "true" })}`;
    this.element.append(this.iframe);
    this.widget = window.SC!.Widget(this.iframe);
    this.initialized = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("SoundCloud could not load this track")),
        15000,
      );
      this.widget!.bind("ready", () => {
        clearTimeout(timer);
        resolve();
      });
      this.widget!.bind("error", () => {
        clearTimeout(timer);
        this.callbacks.onError(
          "This track cannot be played through SoundCloud on this device/region.",
        );
        reject(new Error("SoundCloud playback is unavailable"));
      });
    });
    await this.initialized;
  }
  async play() {
    await this.initialized;
    this.widget?.play();
  }
  async pause() {
    await this.initialized;
    this.widget?.pause();
  }
  async seekTo(seconds: number) {
    await this.initialized;
    this.widget?.seekTo(seconds * 1000);
  }
  async getCurrentTime() {
    await this.initialized;
    if (!this.widget) return 0;
    return (
      (await callbackValue<number>((callback) =>
        this.widget!.getPosition(callback),
      )) / 1000
    );
  }
  async getState(): Promise<PlayerState> {
    await this.initialized;
    if (!this.widget) return "unavailable";
    return (await callbackValue<boolean>((callback) =>
      this.widget!.isPaused(callback),
    ))
      ? "paused"
      : "playing";
  }
  async setVolume(volume: number) {
    await this.initialized;
    this.widget?.setVolume(volume * 100);
  }
  async destroy() {
    this.widget?.unbind("ready");
    this.widget?.unbind("error");
    this.iframe?.remove();
    this.widget = undefined;
  }
}
