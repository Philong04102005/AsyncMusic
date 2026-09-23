import { randomUUID } from "node:crypto";
import {
  can,
  expectedPosition,
  type Command,
  type Permission,
  type RoomSnapshot,
  type Member,
  type Track,
  type User,
  type CreateRoomInput,
} from "@resonance/shared";

export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export interface StoredMember extends Member {
  connections: Record<string, number>;
  disconnectedAt?: number;
}
export interface Room extends Omit<RoomSnapshot, "members" | "serverTime"> {
  members: StoredMember[];
  passwordHash?: string;
  passwordEpoch: number;
  banned: string[];
  emptySince?: number;
}
export function createRoom(
  input: CreateRoomInput,
  user: User,
  passwordHash?: string,
  now = Date.now(),
): Room {
  const id = randomUUID();
  return {
    id,
    slug: id,
    name: input.name,
    visibility: input.visibility,
    provider: input.provider,
    ownerUserId: user.id,
    createdAt: now,
    allowGuests: input.allowGuests,
    allowListenersToAddTracks: input.allowListenersToAddTracks,
    passwordHash,
    passwordEpoch: 0,
    banned: [],
    revision: 1,
    queue: [],
    chat: [],
    members: [
      {
        ...user,
        role: "OWNER",
        connectedAt: now,
        connected: false,
        connections: {},
        disconnectedAt: now,
      },
    ],
    playback: {
      track: null,
      status: "PAUSED",
      positionSeconds: 0,
      stateUpdatedAt: now,
      version: 0,
    },
  };
}
export function snapshot(room: Room, now = Date.now()): RoomSnapshot {
  return {
    id: room.id,
    slug: room.slug,
    name: room.name,
    visibility: room.visibility,
    provider: room.provider,
    ownerUserId: room.ownerUserId,
    createdAt: room.createdAt,
    allowGuests: room.allowGuests,
    allowListenersToAddTracks: room.allowListenersToAddTracks,
    members: room.members.map(
      ({ connections: _c, disconnectedAt: _d, ...member }) => member,
    ),
    queue: room.queue,
    playback: room.playback,
    chat: room.chat,
    revision: room.revision,
    serverTime: now,
  };
}
const permissionMap: Partial<Record<Command["type"], Permission>> = {
  "player:play": "PLAYER_PLAY",
  "player:pause": "PLAYER_PAUSE",
  "player:seek": "PLAYER_SEEK",
  "player:next": "PLAYER_SKIP",
  "queue:add": "QUEUE_ADD",
  "queue:remove": "QUEUE_REMOVE",
  "queue:move": "QUEUE_REORDER",
  "queue:clear": "QUEUE_CLEAR",
  "member:kick": "MEMBER_KICK",
  "member:promote": "MEMBER_PROMOTE",
  "member:demote": "MEMBER_DEMOTE",
  "room:transfer": "OWNERSHIP_TRANSFER",
  "room:edit": "ROOM_EDIT",
  "room:delete": "ROOM_DELETE",
};
export function authorize(room: Room, userId: string, command: Command) {
  const member = room.members.find((m) => m.id === userId);
  if (!member?.connected || room.banned.includes(userId))
    throw new AppError("FORBIDDEN", "Join this room first", 403);
  const permission = permissionMap[command.type];
  if (
    permission &&
    !can(member.role, permission, room.allowListenersToAddTracks)
  )
    throw new AppError(
      "FORBIDDEN",
      "Your room role does not allow this action",
      403,
    );
  if (
    command.type === "queue:add" &&
    command.playNow &&
    !can(member.role, "PLAYER_PLAY")
  )
    throw new AppError("FORBIDDEN", "Only the host or a DJ can play now", 403);
  return member;
}
function stamp(room: Room, now: number) {
  room.playback.version++;
  room.playback.stateUpdatedAt = now;
}
export function nextTrack(room: Room, now: number) {
  room.playback.track = room.queue.shift()?.track ?? null;
  room.playback.positionSeconds = 0;
  room.playback.status = room.playback.track ? "PLAYING" : "PAUSED";
  stamp(room, now);
}
export function transferOwner(room: Room) {
  if (room.members.some((m) => m.id === room.ownerUserId)) return;
  const candidates = [...room.members].sort(
    (a, b) =>
      Number(b.connected) - Number(a.connected) ||
      Number(b.role === "DJ") - Number(a.role === "DJ") ||
      a.connectedAt - b.connectedAt,
  );
  if (candidates[0]) {
    candidates[0].role = "OWNER";
    room.ownerUserId = candidates[0].id;
  }
}
export function leave(room: Room, userId: string, now: number) {
  room.members = room.members.filter((m) => m.id !== userId);
  transferOwner(room);
  if (!room.members.length) room.emptySince ??= now;
}
export function cleanup(
  room: Room,
  now: number,
  disconnectGrace: number,
  emptyGrace: number,
): "delete" | "changed" | "unchanged" {
  let changed = false;
  for (const member of room.members) {
    for (const [id, lease] of Object.entries(member.connections))
      if (lease <= now) {
        delete member.connections[id];
        changed = true;
      }
    if (!Object.keys(member.connections).length && member.connected) {
      member.connected = false;
      member.disconnectedAt = now;
      changed = true;
    }
  }
  for (const member of [...room.members])
    if (
      !member.connected &&
      member.disconnectedAt !== undefined &&
      now - member.disconnectedAt >= disconnectGrace
    ) {
      leave(room, member.id, now);
      changed = true;
    }
  if (
    !room.members.length &&
    room.emptySince !== undefined &&
    now - room.emptySince >= emptyGrace
  )
    return "delete";
  if (
    room.playback.status === "PLAYING" &&
    room.playback.track?.durationMs &&
    expectedPosition(room.playback, now) >=
      room.playback.track.durationMs / 1000
  ) {
    nextTrack(room, now);
    changed = true;
  }
  return changed ? "changed" : "unchanged";
}
export function applyCommand(
  room: Room,
  userId: string,
  command: Command,
  resolved?: { track?: Track; passwordHash?: string },
  now = Date.now(),
): "delete" | void {
  const member = authorize(room, userId, command);
  switch (command.type) {
    case "player:play":
      if (!room.playback.track) {
        if (!room.queue.length)
          throw new AppError("EMPTY_QUEUE", "Add a song to start listening");
        nextTrack(room, now);
      } else {
        room.playback.positionSeconds = expectedPosition(room.playback, now);
        room.playback.status = "PLAYING";
        stamp(room, now);
      }
      break;
    case "player:pause":
      room.playback.positionSeconds = expectedPosition(room.playback, now);
      room.playback.status = "PAUSED";
      stamp(room, now);
      break;
    case "player:seek":
      if (!room.playback.track)
        throw new AppError("NO_TRACK", "No track is playing");
      room.playback.positionSeconds = Math.min(
        command.position,
        (room.playback.track.durationMs ?? 604800000) / 1000,
      );
      stamp(room, now);
      break;
    case "player:next":
      nextTrack(room, now);
      break;
    case "queue:add": {
      const track = resolved?.track;
      if (
        !track ||
        track.provider !== room.provider ||
        track.access !== "playable"
      )
        throw new AppError(
          "NOT_PLAYABLE",
          "This track is not available for full playback",
        );
      if (room.queue.length >= 100)
        throw new AppError("QUEUE_FULL", "The queue is limited to 100 tracks");
      if (command.playNow) {
        room.playback.track = track;
        room.playback.positionSeconds = 0;
        room.playback.status = "PLAYING";
        stamp(room, now);
      } else
        room.queue.push({
          id: randomUUID(),
          track,
          addedByUserId: userId,
          addedByName: member.displayName,
          createdAt: now,
        });
      break;
    }
    case "queue:remove":
      room.queue = room.queue.filter((item) => item.id !== command.itemId);
      break;
    case "queue:clear":
      room.queue = [];
      break;
    case "queue:move": {
      const index = room.queue.findIndex((item) => item.id === command.itemId);
      if (index < 0)
        throw new AppError("NOT_FOUND", "Queue item no longer exists", 404);
      const [item] = room.queue.splice(index, 1);
      room.queue.splice(Math.min(command.toIndex, room.queue.length), 0, item);
      break;
    }
    case "chat:send":
      room.chat.push({
        id: randomUUID(),
        roomId: room.id,
        userId,
        displayName: member.displayName,
        content: command.content,
        createdAt: now,
      });
      room.chat = room.chat.slice(-100);
      break;
    case "member:kick":
    case "member:promote":
    case "member:demote":
    case "room:transfer": {
      const target = room.members.find((m) => m.id === command.userId);
      if (!target || target.id === room.ownerUserId)
        throw new AppError(
          "INVALID_MEMBER",
          "Choose a member other than the host",
        );
      if (command.type === "member:kick") {
        if (room.banned.length >= 1000)
          throw new AppError("LIMIT", "Room moderation limit reached");
        room.banned.push(target.id);
        leave(room, target.id, now);
      } else if (command.type === "room:transfer") {
        if (!target.connected)
          throw new AppError("OFFLINE", "New host must be connected");
        member.role = "DJ";
        target.role = "OWNER";
        room.ownerUserId = target.id;
      } else
        target.role = command.type === "member:promote" ? "DJ" : "LISTENER";
      break;
    }
    case "room:edit":
      if (
        command.provider !== room.provider &&
        (room.playback.track || room.queue.length)
      )
        throw new AppError(
          "PROVIDER_BUSY",
          "Clear the queue and skip the current track before switching providers",
        );
      if (
        command.visibility === "PRIVATE" &&
        !resolved?.passwordHash &&
        !room.passwordHash
      )
        throw new AppError(
          "PASSWORD_REQUIRED",
          "Set a password for this private room",
        );
      if (resolved?.passwordHash) {
        room.passwordHash = resolved.passwordHash;
        room.passwordEpoch++;
      }
      if (command.visibility === "PUBLIC") {
        room.passwordHash = undefined;
        room.passwordEpoch++;
      }
      room.name = command.name;
      room.visibility = command.visibility;
      room.provider = command.provider;
      room.allowGuests = command.allowGuests;
      room.allowListenersToAddTracks = command.allowListenersToAddTracks;
      break;
    case "room:leave":
      leave(room, userId, now);
      break;
    case "room:delete":
      return "delete";
  }
}
