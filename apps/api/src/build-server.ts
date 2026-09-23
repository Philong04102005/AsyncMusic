import Fastify, { LogController, type FastifyServerOptions } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import { Redis } from "ioredis";
import argon2 from "argon2";
import { z } from "zod";
import { createDatabase } from "@resonance/database";
import {
  createRoomSchema,
  providerSchema,
  type ProviderId,
  type PublicRoom,
} from "@resonance/shared";
import {
  YouTubeProvider,
  SoundCloudProvider,
  ProviderError,
  type MusicProvider,
} from "@resonance/providers";
import { AppError, createRoom } from "./domain";
import { RoomStore, rateLimit } from "./store";
import { Sessions, authRoutes } from "./auth";
import { setupRealtime } from "./realtime";
import { soundCloudTokenSource } from "./provider-tokens";
import type { Config } from "./config";

export function serverOptions(config: Config): FastifyServerOptions {
  return {
    logger:
      config.NODE_ENV === "test"
        ? false
        : {
            level: "info",
            redact: [
              "req.headers.cookie",
              "req.headers.authorization",
              "password",
              "*.password",
              "*.token",
              "*.secret",
            ],
          },
    logController: new LogController({ disableRequestLogging: true }),
    trustProxy: config.TRUST_PROXY === "true",
    bodyLimit: 16384,
  };
}

export async function buildServer(
  config: Config,
  providerOverrides?: Record<ProviderId, MusicProvider>,
  app = Fastify(serverOptions(config)),
) {
  const redis = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 2,
    connectTimeout: 5000,
  });
  redis.on("error", () => app.log.error({ event: "redis_connection_error" }));
  const db = createDatabase(config.DATABASE_URL);
  const store = new RoomStore(redis);
  const sessions = new Sessions(redis, config);
  const providers = providerOverrides ?? {
    youtube: new YouTubeProvider(config.YOUTUBE_API_KEY),
    soundcloud: new SoundCloudProvider(soundCloudTokenSource(redis, config)),
  };
  await app.register(cookie);
  await app.register(cors, { origin: config.APP_URL, credentials: true });
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  });
  app.addHook("onRequest", async (request) => {
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(request.method) &&
      request.headers.origin !== config.APP_URL
    )
      throw new AppError("ORIGIN", "Request origin is not allowed", 403);
    if (request.url !== "/health")
      await rateLimit(redis, "http", request.ip, 240, 60);
  });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof z.ZodError)
      return reply
        .code(400)
        .send({
          error: error.issues[0]?.message ?? "Invalid request",
          code: "VALIDATION",
        });
    if (error instanceof AppError)
      return reply
        .code(error.status)
        .send({ error: error.message, code: error.code });
    if (error instanceof ProviderError) {
      app.log.warn({ event: "provider_error", code: error.code });
      return reply
        .code(error.code === "RATE_LIMITED" ? 429 : 503)
        .send({ error: error.message, code: error.code });
    }
    app.log.error({
      event: "api_error",
      errorType: error instanceof Error ? error.name : "Unknown",
    });
    return reply
      .code(500)
      .send({
        error: "The service is temporarily unavailable",
        code: "INTERNAL",
      });
  });
  await authRoutes(app, redis, db, config, sessions);
  app.get("/health", async (_request, reply) => {
    const results = await Promise.allSettled([
      redis.ping(),
      db.$queryRaw`SELECT 1`,
    ]);
    const healthy = results.every((result) => result.status === "fulfilled");
    return reply
      .code(healthy ? 200 : 503)
      .send({
        api: "ok",
        redis: results[0].status === "fulfilled" ? "ok" : "error",
        postgresql: results[1].status === "fulfilled" ? "ok" : "error",
      });
  });
  app.get("/api/rooms", async () => {
    const rooms: PublicRoom[] = [];
    for (const id of await store.ids()) {
      try {
        const room = await store.get(id);
        if (room.visibility === "PUBLIC" && room.members.length)
          rooms.push({
            id: room.id,
            slug: room.slug,
            name: room.name,
            provider: room.provider,
            memberCount: room.members.length,
            ownerName:
              room.members.find((m) => m.id === room.ownerUserId)
                ?.displayName ?? "Host",
            currentTrack: room.playback.track,
          });
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
      }
    }
    return { rooms: rooms.slice(0, 200) };
  });
  app.post("/api/rooms", async (request, reply) => {
    const user = await sessions.require(request);
    await rateLimit(redis, "create-room", user.id, 5, 300);
    const input = createRoomSchema.parse(request.body);
    if (user.guest && !input.allowGuests)
      throw new AppError(
        "AUTH_REQUIRED",
        "Sign in with Google to create a members-only room",
      );
    const hash = input.password
      ? await argon2.hash(input.password, { type: argon2.argon2id })
      : undefined;
    const room = createRoom(input, user, hash);
    await store.create(room);
    app.log.info({ event: "room_created", roomId: room.id, userId: user.id });
    return reply.code(201).send({ id: room.id, slug: room.slug });
  });
  app.post("/api/rooms/:id/access", async (request) => {
    const user = await sessions.require(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await rateLimit(redis, "password-ip", request.ip, 15, 300);
    await rateLimit(redis, "password-room-ip", `${id}:${request.ip}`, 5, 60);
    const { password } = z
      .object({ password: z.string().min(1).max(128) })
      .parse(request.body);
    const room = await store.get(id);
    if (room.banned.includes(user.id))
      throw new AppError("FORBIDDEN", "Access denied", 403);
    if (
      room.visibility !== "PUBLIC" &&
      (!room.passwordHash ||
        !(await argon2.verify(room.passwordHash, password)))
    )
      throw new AppError("BAD_PASSWORD", "The room password is incorrect", 403);
    const key = `res:grant:${id}:${user.id}`;
    await redis
      .multi()
      .set(key, String(room.passwordEpoch), "EX", 86400)
      .sadd(`res:grants:${id}`, key)
      .expire(`res:grants:${id}`, 86400)
      .exec();
    return { ok: true };
  });
  app.get("/api/providers/:provider/search", async (request) => {
    const user = await sessions.require(request);
    await rateLimit(redis, "search-user", user.id, 20, 60);
    await rateLimit(redis, "search-ip", request.ip, 40, 60);
    const { provider } = z
      .object({ provider: providerSchema })
      .parse(request.params);
    const { q, roomId } = z
      .object({
        q: z.string().trim().min(2).max(120),
        roomId: z.string().uuid(),
      })
      .parse(request.query);
    const room = await store.get(roomId);
    if (
      !room.members.some((member) => member.id === user.id) ||
      room.banned.includes(user.id) ||
      room.provider !== provider
    )
      throw new AppError(
        "FORBIDDEN",
        "Join this provider room before searching",
        403,
      );
    const key = `res:search:${provider}:${q.toLowerCase()}`;
    const cached = await redis.get(key);
    if (cached) return { tracks: JSON.parse(cached) as unknown };
    const tracks = await providers[provider].search(q);
    await redis.set(key, JSON.stringify(tracks), "EX", 120);
    return { tracks };
  });
  const realtime = setupRealtime(
    app,
    redis,
    store,
    sessions,
    providers,
    config,
  );
  app.addHook("onClose", async () => {
    await realtime.close();
    await db.$disconnect();
    await redis.quit();
  });
  return { app, redis, db, store, io: realtime.io };
}
