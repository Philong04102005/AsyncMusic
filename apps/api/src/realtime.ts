import { Server, type Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { parseCookie } from "cookie";
import { z } from "zod";
import argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import {
  commandSchema,
  type ClientEvents,
  type ServerEvents,
  type User,
  type ProviderId,
  type Ack,
  type Command,
} from "@resonance/shared";
import { ProviderError, type MusicProvider } from "@resonance/providers";
import {
  AppError,
  authorize,
  applyCommand,
  cleanup,
  snapshot,
  type Room,
} from "./domain";
import { RoomStore, rateLimit } from "./store";
import type { Config } from "./config";
import type { Sessions } from "./auth";

interface SocketData {
  user: User;
  roomId?: string;
  token?: string;
}
type RoomSocket = Socket<
  ClientEvents,
  ServerEvents,
  Record<string, never>,
  SocketData
>;
const envelope = z.object({
  roomId: z.string().uuid(),
  command: commandSchema,
});
export function setupRealtime(
  app: FastifyInstance,
  redis: Redis,
  store: RoomStore,
  sessions: Sessions,
  providers: Record<ProviderId, MusicProvider>,
  config: Config,
) {
  const io = new Server<
    ClientEvents,
    ServerEvents,
    Record<string, never>,
    SocketData
  >(app.server, {
    cors: { origin: config.APP_URL, credentials: true },
    transports: ["websocket"],
    maxHttpBufferSize: 16384,
    allowRequest: (request, callback) =>
      callback(null, request.headers.origin === config.APP_URL),
  });
  const pub = redis.duplicate(),
    sub = redis.duplicate();
  io.adapter(createAdapter(pub, sub));
  const errorResult = (error: unknown): Ack => {
    if (error instanceof AppError || error instanceof ProviderError)
      return { ok: false, error: error.message, code: error.code };
    if (error instanceof z.ZodError)
      return { ok: false, error: "Invalid request", code: "VALIDATION" };
    app.log.error({
      event: "websocket_error",
      errorType: error instanceof Error ? error.name : "Unknown",
    });
    return {
      ok: false,
      error: "Something went wrong. Please try again.",
      code: "INTERNAL",
    };
  };
  async function broadcast(room: Room | null, id: string, oldOwner?: string) {
    if (room) {
      io.to(id).emit("room:state", snapshot(room));
      if (oldOwner && oldOwner !== room.ownerUserId)
        io.to(id).emit("room:ownerChanged", room.ownerUserId);
    } else {
      io.to(id).emit("room:deleted");
      io.in(id).socketsLeave(id);
      app.log.info({ event: "room_deleted", roomId: id });
    }
  }
  async function access(room: Room, user: User) {
    if (room.banned.includes(user.id))
      throw new AppError(
        "FORBIDDEN",
        "You have been removed from this room",
        403,
      );
    if (room.members.some((m) => m.id === user.id)) return;
    if (user.guest && !room.allowGuests)
      throw new AppError(
        "AUTH_REQUIRED",
        "This room requires Google sign-in",
        403,
      );
    if (room.visibility === "PRIVATE") {
      const epoch = await redis.get(`res:grant:${room.id}:${user.id}`);
      if (epoch !== String(room.passwordEpoch))
        throw new AppError(
          "PASSWORD_REQUIRED",
          "Enter the room password to join",
          403,
        );
    }
  }
  io.use(async (socket, next) => {
    try {
      const token = parseCookie(
        socket.request.headers.cookie ?? "",
      ).res_session;
      const user = await sessions.read(token);
      if (!user) return next(new Error("Please sign in to join"));
      await rateLimit(redis, "socket-connect", user.id, 30, 60);
      socket.data.user = user;
      socket.data.token = token;
      next();
    } catch {
      next(new Error("Connection unavailable. Please try again."));
    }
  });
  async function disconnect(socket: RoomSocket) {
    const id = socket.data.roomId;
    if (!id) return;
    try {
      const room = await store.mutate(id, (room) => {
        const member = room.members.find((m) => m.id === socket.data.user.id);
        if (!member) return "unchanged";
        delete member.connections[socket.id];
        if (!Object.keys(member.connections).length) {
          member.connected = false;
          member.disconnectedAt = Date.now();
        }
      });
      await broadcast(room, id);
    } catch (error) {
      if (!(error instanceof AppError))
        app.log.error({ event: "presence_error" });
    }
  }
  io.on("connection", (socket) => {
    socket.on("clock:ping", async (ack) => {
      if (typeof ack !== "function") return;
      try {
        await rateLimit(redis, "clock", socket.data.user.id, 60, 60);
        ack(Date.now());
      } catch {
        /* bounded probes */
      }
    });
    socket.on("room:join", async (payload, ack) => {
      if (typeof ack !== "function") return;
      try {
        const { roomId } = z
          .object({ roomId: z.string().uuid() })
          .parse(payload);
        if (!(await sessions.read(socket.data.token)))
          throw new AppError("UNAUTHORIZED", "Your session expired", 401);
        await rateLimit(redis, "join", socket.data.user.id, 20, 60);
        if (socket.data.roomId && socket.data.roomId !== roomId) {
          await disconnect(socket);
          await socket.leave(socket.data.roomId);
        }
        const initial = await store.get(roomId);
        await access(initial, socket.data.user);
        const grantEpoch = initial.passwordEpoch;
        const room = await store.mutate(roomId, (room) => {
          if (room.banned.includes(socket.data.user.id))
            throw new AppError(
              "FORBIDDEN",
              "You have been removed from this room",
              403,
            );
          let member = room.members.find((m) => m.id === socket.data.user.id);
          if (!member && room.passwordEpoch !== grantEpoch)
            throw new AppError(
              "PASSWORD_REQUIRED",
              "The room password changed. Please join again.",
              403,
            );
          if (!member && socket.data.user.guest && !room.allowGuests)
            throw new AppError(
              "AUTH_REQUIRED",
              "This room requires Google sign-in",
              403,
            );
          if (!member) {
            if (room.members.length >= 100)
              throw new AppError("ROOM_FULL", "This room is full");
            const role = room.members.length ? "LISTENER" : "OWNER";
            if (role === "OWNER") room.ownerUserId = socket.data.user.id;
            member = {
              ...socket.data.user,
              role,
              connected: true,
              connectedAt: Date.now(),
              connections: {},
            };
            room.members.push(member);
          }
          if (
            Object.keys(member.connections).length >= 8 &&
            !member.connections[socket.id]
          )
            throw new AppError(
              "TAB_LIMIT",
              "Close another room tab before joining",
            );
          member.connections[socket.id] = Date.now() + 20000;
          member.connected = true;
          delete member.disconnectedAt;
          delete room.emptySince;
        });
        if (!room) throw new AppError("ROOM_NOT_FOUND", "Room closed", 404);
        await socket.join(roomId);
        socket.data.roomId = roomId;
        const current = await store.get(roomId);
        if (
          !current.members.find((m) => m.id === socket.data.user.id)
            ?.connections[socket.id] ||
          current.banned.includes(socket.data.user.id)
        ) {
          await socket.leave(roomId);
          throw new AppError(
            "FORBIDDEN",
            "Your room access has changed. Please join again.",
            403,
          );
        }
        ack({ ok: true, data: snapshot(current) });
        await broadcast(current, roomId);
        app.log.info({
          event: "room_join",
          roomId,
          userId: socket.data.user.id,
        });
      } catch (error) {
        ack(errorResult(error) as Ack<never>);
      }
    });
    socket.on("room:command", async (payload, ack) => {
      if (typeof ack !== "function") return;
      let acknowledged = false;
      try {
        const { roomId, command } = envelope.parse(payload);
        if (socket.data.roomId !== roomId || !socket.rooms.has(roomId))
          throw new AppError(
            "FORBIDDEN",
            "Join the room before sending commands",
            403,
          );
        if (!(await sessions.read(socket.data.token)))
          throw new AppError("UNAUTHORIZED", "Your session expired", 401);
        const category = command.type.split(":")[0];
        await rateLimit(
          redis,
          `command:${category}`,
          socket.data.user.id,
          category === "chat" ? 6 : category === "queue" ? 15 : 30,
          10,
        );
        const initial = await store.get(roomId);
        authorize(initial, socket.data.user.id, command);
        if (
          command.type === "player:seek" &&
          !providers[initial.provider].supportsSeek
        ) {
          throw new AppError(
            "NOT_SUPPORTED",
            "This music provider does not support seeking",
          );
        }
        if (
          command.type.startsWith("queue:") &&
          !providers[initial.provider].supportsQueue
        ) {
          throw new AppError(
            "NOT_SUPPORTED",
            "This music provider does not support a queue",
          );
        }
        const resolved = {
          track:
            command.type === "queue:add"
              ? await providers[initial.provider].getTrack(command.trackId)
              : undefined,
          passwordHash:
            command.type === "room:edit" && command.password
              ? await argon2.hash(command.password, { type: argon2.argon2id })
              : undefined,
        };
        const room = await store.mutate(roomId, (room) =>
          applyCommand(room, socket.data.user.id, command, resolved),
        );
        // Acknowledge the committed mutation before a leave/delete event closes the caller's socket.
        ack({ ok: true, data: undefined });
        acknowledged = true;
        if (command.type === "member:kick" || command.type === "room:leave") {
          const targetId =
            command.type === "member:kick"
              ? command.userId
              : socket.data.user.id;
          const sockets = await io.in(roomId).fetchSockets();
          for (const target of sockets)
            if (target.data.user.id === targetId) {
              target.emit("room:kicked");
              await target.leave(roomId);
            }
          app.log.info({ event: "room_leave", roomId, userId: targetId });
        }
        await broadcast(room, roomId, initial.ownerUserId);
      } catch (error) {
        if (error instanceof AppError && error.code === "FORBIDDEN")
          app.log.warn({
            event: "authorization_failure",
            userId: socket.data.user.id,
          });
        if (error instanceof ProviderError)
          app.log.warn({ event: "provider_error", code: error.code });
        if (!acknowledged) ack(errorResult(error));
        else
          app.log.error({
            event: "broadcast_error",
            roomId: socket.data.roomId,
          });
      }
    });
    socket.on("disconnect", () => {
      void disconnect(socket);
    });
  });
  let running = false;
  let lastHeartbeat = 0;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      // Refresh local socket leases every five seconds, one transaction per room.
      if (Date.now() - lastHeartbeat >= 5000) {
        lastHeartbeat = Date.now();
        const local = new Map<string, RoomSocket[]>();
        for (const socket of io.sockets.sockets.values()) {
          if (!(await sessions.read(socket.data.token))) {
            socket.disconnect(true);
            continue;
          }
          if (socket.data.roomId && socket.rooms.has(socket.data.roomId)) {
            const list = local.get(socket.data.roomId) ?? [];
            list.push(socket);
            local.set(socket.data.roomId, list);
          }
        }
        for (const [id, sockets] of local) {
          try {
            await store.mutate(id, (room) => {
              for (const socket of sockets) {
                const member = room.members.find(
                  (m) => m.id === socket.data.user.id,
                );
                if (member?.connections[socket.id])
                  member.connections[socket.id] = Date.now() + 20000;
              }
            });
          } catch {
            /* room may close */
          }
        }
      }
      for (const id of await store.ids()) {
        try {
          const before = await store.get(id);
          const room = await store.mutate(id, (room) => {
            const result = cleanup(
              room,
              Date.now(),
              config.DISCONNECT_GRACE_MS,
              config.EMPTY_ROOM_GRACE_MS,
            );
            return result === "changed" ? undefined : result;
          });
          if (!room || room.revision !== before.revision)
            await broadcast(room, id, before.ownerUserId);
        } catch (error) {
          if (error instanceof AppError && error.status === 404)
            await redis.srem("res:rooms", id);
          else app.log.error({ event: "cleanup_error" });
        }
      }
    } catch {
      app.log.error({ event: "lifecycle_dependency_error" });
    } finally {
      running = false;
    }
  }, 1000);
  timer.unref();
  return {
    io,
    async close() {
      clearInterval(timer);
      await io.close();
      await Promise.all([pub.quit(), sub.quit()]);
    },
  };
}
