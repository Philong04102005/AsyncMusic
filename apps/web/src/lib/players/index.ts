import type { ProviderId } from "@resonance/shared";
import { YouTubePlayerAdapter } from "./youtube";
import { SoundCloudPlayerAdapter } from "./soundcloud";
import type { PlayerAdapter, PlayerCallbacks } from "./types";
const factories: Record<
  ProviderId,
  (element: HTMLElement, callbacks: PlayerCallbacks) => PlayerAdapter
> = {
  youtube: (element, callbacks) => new YouTubePlayerAdapter(element, callbacks),
  soundcloud: (element, callbacks) =>
    new SoundCloudPlayerAdapter(element, callbacks),
};
export function createPlayer(
  provider: ProviderId,
  element: HTMLElement,
  callbacks: PlayerCallbacks,
) {
  return factories[provider](element, callbacks);
}
