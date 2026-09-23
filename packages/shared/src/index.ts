import { z } from "zod";

export const providerSchema = z.enum(["youtube", "soundcloud"]);
export type ProviderId = z.infer<typeof providerSchema>;
export type Role = "OWNER" | "DJ" | "LISTENER";
export type ProviderErrorCode =
  | "NOT_PLAYABLE"
  | "AUTH_REQUIRED"
  | "RATE_LIMITED"
  | "REGION_BLOCKED"
  | "TRACK_NOT_FOUND"
  | "PLAYER_ERROR"
  | "UNKNOWN";
export interface Track {
  provider: ProviderId;
  providerTrackId: string;
  title: string;
  artist: string;
  thumbnail?: string;
  durationMs?: number;
  url: string;
  access: "playable" | "preview" | "blocked";
}
export interface User {
  id: string;
  displayName: string;
  avatar?: string;
  guest: boolean;
}
export interface Member extends User {
  role: Role;
  connectedAt: number;
  connected: boolean;
}
export interface QueueItem {
  id: string;
  track: Track;
  addedByUserId: string;
  addedByName: string;
  createdAt: number;
}
export interface PlaybackState {
  track: Track | null;
  status: "PLAYING" | "PAUSED";
  positionSeconds: number;
  stateUpdatedAt: number;
  version: number;
}
export interface ChatMessage {
  id: string;
  roomId: string;
  userId: string;
  displayName: string;
  content: string;
  createdAt: number;
}
export interface RoomSnapshot {
  id: string;
  slug: string;
  name: string;
  visibility: "PUBLIC" | "PRIVATE";
  ownerUserId: string;
  provider: ProviderId;
  createdAt: number;
  allowListenersToAddTracks: boolean;
  allowGuests: boolean;
  members: Member[];
  queue: QueueItem[];
  playback: PlaybackState;
  chat: ChatMessage[];
  revision: number;
  serverTime: number;
}
export interface PublicRoom {
  id: string;
  slug: string;
  name: string;
  provider: ProviderId;
  memberCount: number;
  ownerName: string;
  currentTrack: Track | null;
}
export const permissions = [
  "PLAYER_PLAY",
  "PLAYER_PAUSE",
  "PLAYER_SEEK",
  "PLAYER_SKIP",
  "QUEUE_ADD",
  "QUEUE_REMOVE",
  "QUEUE_REORDER",
  "QUEUE_CLEAR",
  "ROOM_EDIT",
  "ROOM_CHANGE_PASSWORD",
  "ROOM_DELETE",
  "MEMBER_KICK",
  "MEMBER_PROMOTE",
  "MEMBER_DEMOTE",
  "OWNERSHIP_TRANSFER",
] as const;
export type Permission = (typeof permissions)[number];
const djPermissions = new Set<Permission>([
  "PLAYER_PLAY",
  "PLAYER_PAUSE",
  "PLAYER_SEEK",
  "PLAYER_SKIP",
  "QUEUE_ADD",
  "QUEUE_REMOVE",
  "QUEUE_REORDER",
  "QUEUE_CLEAR",
]);
export function can(
  role: Role | undefined,
  permission: Permission,
  allowListenersToAddTracks = false,
): boolean {
  return (
    role === "OWNER" ||
    (role === "DJ" && djPermissions.has(permission)) ||
    (role === "LISTENER" &&
      permission === "QUEUE_ADD" &&
      allowListenersToAddTracks)
  );
}
export function expectedPosition(
  state: PlaybackState,
  serverNow: number,
): number {
  const position =
    state.positionSeconds +
    (state.status === "PLAYING"
      ? Math.max(0, serverNow - state.stateUpdatedAt) / 1000
      : 0);
  return Math.max(
    0,
    Math.min(
      position,
      state.track?.durationMs ? state.track.durationMs / 1000 : Infinity,
    ),
  );
}
export const displayNameSchema = z.string().trim().min(2).max(40);
export const createRoomSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    visibility: z.enum(["PUBLIC", "PRIVATE"]),
    provider: providerSchema,
    password: z.string().min(8).max(128).optional(),
    allowListenersToAddTracks: z.boolean().default(false),
    allowGuests: z.boolean().default(true),
  })
  .refine((v) => v.visibility !== "PRIVATE" || !!v.password, {
    message: "Private rooms need a password of at least 8 characters",
    path: ["password"],
  });
export type CreateRoomInput = z.infer<typeof createRoomSchema>;
const target = { userId: z.string().uuid() };
export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("player:play") }),
  z.object({ type: z.literal("player:pause") }),
  z.object({
    type: z.literal("player:seek"),
    position: z.number().finite().min(0).max(604800),
  }),
  z.object({ type: z.literal("player:next") }),
  z.object({
    type: z.literal("queue:add"),
    trackId: z.string().min(1).max(200),
    playNow: z.boolean().default(false),
  }),
  z.object({ type: z.literal("queue:remove"), itemId: z.string().uuid() }),
  z.object({
    type: z.literal("queue:move"),
    itemId: z.string().uuid(),
    toIndex: z.number().int().min(0).max(99),
  }),
  z.object({ type: z.literal("queue:clear") }),
  z.object({
    type: z.literal("chat:send"),
    content: z.string().trim().min(1).max(500),
  }),
  z.object({ type: z.literal("member:kick"), ...target }),
  z.object({ type: z.literal("member:promote"), ...target }),
  z.object({ type: z.literal("member:demote"), ...target }),
  z.object({ type: z.literal("room:transfer"), ...target }),
  z.object({
    type: z.literal("room:edit"),
    name: z.string().trim().min(2).max(80),
    visibility: z.enum(["PUBLIC", "PRIVATE"]),
    password: z.string().min(8).max(128).optional(),
    provider: providerSchema,
    allowListenersToAddTracks: z.boolean(),
    allowGuests: z.boolean(),
  }),
  z.object({ type: z.literal("room:delete") }),
  z.object({ type: z.literal("room:leave") }),
]);
export type Command = z.infer<typeof commandSchema>;
export type Ack<T = undefined> =
  { ok: true; data: T } | { ok: false; error: string; code?: string };
export interface ServerEvents {
  "room:state": (state: RoomSnapshot) => void;
  "room:deleted": () => void;
  "room:kicked": () => void;
  "room:ownerChanged": (userId: string) => void;
}
export interface ClientEvents {
  "room:join": (
    payload: { roomId: string },
    ack: (result: Ack<RoomSnapshot>) => void,
  ) => void;
  "room:command": (
    payload: { roomId: string; command: Command },
    ack: (result: Ack) => void,
  ) => void;
  "clock:ping": (ack: (serverTime: number) => void) => void;
}
