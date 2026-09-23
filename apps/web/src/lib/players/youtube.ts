import type { Track } from "@resonance/shared";
import {
  loadScript,
  type PlayerAdapter,
  type PlayerCallbacks,
  type PlayerState,
} from "./types";
interface YouTubePlayer {
  cueVideoById(id: string): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(time: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  getPlayerState(): number;
  setVolume(volume: number): void;
  destroy(): void;
}
interface YouTubeApi {
  Player: new (
    element: HTMLElement,
    options: {
      width: string;
      height: string;
      playerVars: Record<string, string | number>;
      events: {
        onReady: () => void;
        onError: (event: { data: number }) => void;
        onStateChange: (event: { data: number }) => void;
        onAutoplayBlocked: () => void;
      };
    },
  ) => YouTubePlayer;
}
declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}
let ready: Promise<void> | undefined;
async function youtubeReady() {
  if (window.YT?.Player) return;
  ready ??= new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ready = undefined;
      reject(new Error("YouTube did not respond. Please retry."));
    }, 15000);
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timeout);
      resolve();
    };
    void loadScript("https://www.youtube.com/iframe_api").catch((error) => {
      clearTimeout(timeout);
      ready = undefined;
      reject(error);
    });
  });
  return ready;
}
export class YouTubePlayerAdapter implements PlayerAdapter {
  supportsSeek = true;
  private player?: YouTubePlayer;
  private initialized: Promise<void>;
  private pendingLoad?: { resolve: () => void; reject: (error: Error) => void };
  constructor(element: HTMLElement, callbacks: PlayerCallbacks) {
    this.initialized = youtubeReady().then(
      () =>
        new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("YouTube player could not initialize")),
            15000,
          );
          const mount = document.createElement("div");
          element.append(mount);
          this.player = new window.YT!.Player(mount, {
            width: "100%",
            height: "100%",
            playerVars: {
              playsinline: 1,
              origin: window.location.origin,
              controls: 1,
            },
            events: {
              onReady: () => {
                clearTimeout(timer);
                resolve();
              },
              onAutoplayBlocked: callbacks.onBlocked,
              onStateChange: (event) => {
                // cueVideoById is asynchronous: wait for CUED before applying the room seek.
                if (event.data === 5) this.pendingLoad?.resolve();
              },
              onError: (event) => {
                const message =
                  event.data === 100
                    ? "This YouTube video is no longer available."
                    : event.data === 101 || event.data === 150
                      ? "This video cannot be played in an embedded player."
                      : "YouTube cannot play this video here. Open it on YouTube or try another track.";
                clearTimeout(timer);
                this.pendingLoad?.reject(new Error(message));
                reject(new Error(message));
                callbacks.onError(message);
              },
            },
          });
        }),
    );
  }
  async load(track: Track) {
    await this.initialized;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          this.pendingLoad?.reject(
            new Error(
              "YouTube took too long to prepare this video. Try resyncing.",
            ),
          ),
        15000,
      );
      this.pendingLoad = {
        resolve: () => {
          clearTimeout(timer);
          this.pendingLoad = undefined;
          resolve();
        },
        reject: (error) => {
          clearTimeout(timer);
          this.pendingLoad = undefined;
          reject(error);
        },
      };
      this.player!.cueVideoById(track.providerTrackId);
    });
  }
  async play() {
    await this.initialized;
    this.player!.playVideo();
  }
  async pause() {
    await this.initialized;
    this.player!.pauseVideo();
  }
  async seekTo(seconds: number) {
    await this.initialized;
    this.player!.seekTo(seconds, true);
  }
  async getCurrentTime() {
    await this.initialized;
    return this.player!.getCurrentTime() || 0;
  }
  async getState(): Promise<PlayerState> {
    await this.initialized;
    const state = this.player!.getPlayerState();
    return state === 1
      ? "playing"
      : state === 3
        ? "buffering"
        : state === 0
          ? "ended"
          : "paused";
  }
  async setVolume(volume: number) {
    await this.initialized;
    this.player!.setVolume(volume * 100);
  }
  async destroy() {
    try {
      await this.initialized;
    } catch {
      /* dispose partially initialized player */
    }
    this.player?.destroy();
  }
}
