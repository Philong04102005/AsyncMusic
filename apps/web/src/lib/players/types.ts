import type { Track } from "@resonance/shared";
export type PlayerState =
  "playing" | "paused" | "buffering" | "ended" | "unavailable";
export interface PlayerAdapter {
  supportsSeek: boolean;
  load(track: Track): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seekTo(seconds: number): Promise<void>;
  getCurrentTime(): Promise<number>;
  getState(): Promise<PlayerState>;
  setVolume(volume: number): Promise<void>;
  destroy(): Promise<void>;
}
export interface PlayerCallbacks {
  onBlocked: () => void;
  onError: (message: string) => void;
}
const scripts = new Map<string, Promise<void>>();
export function loadScript(url: string) {
  let promise = scripts.get(url);
  if (!promise) {
    promise = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = url;
      script.async = true;
      const timer = window.setTimeout(() => {
        script.remove();
        scripts.delete(url);
        reject(new Error("Player took too long to load. Please try again."));
      }, 15000);
      script.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      script.onerror = () => {
        clearTimeout(timer);
        scripts.delete(url);
        reject(
          new Error("Could not load the music player. Check your connection."),
        );
      };
      document.head.append(script);
    });
    scripts.set(url, promise);
  }
  return promise;
}
