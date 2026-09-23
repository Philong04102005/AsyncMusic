import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io, type Socket } from "socket.io-client";
import { randomBytes } from "node:crypto";
import { buildServer } from "../../apps/api/src/build-server";
import type { Config } from "../../apps/api/src/config";
import type { MusicProvider } from "@resonance/providers";
import {
  expectedPosition,
  type Track,
  type User,
  type Command,
  type RoomSnapshot,
  type Ack,
} from "@resonance/shared";
const origin = "http://localhost:3000";
const config: Config = {
  NODE_ENV: "test",
  APP_URL: origin,
  API_URL: "http://localhost:4101",
  PORT: 4101,
  DATABASE_URL:
    process.env.TEST_DATABASE_URL ??
    "postgresql://resonance:resonance@localhost:5432/resonance",
  REDIS_URL: process.env.TEST_REDIS_URL ?? "redis://localhost:6379/15",
  AUTH_SECRET: randomBytes(32).toString("hex"),
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  DISCONNECT_GRACE_MS: 1500,
  EMPTY_ROOM_GRACE_MS: 1500,
  TRUST_PROXY: "false",
};
const track: Track = {
  provider: "youtube",
  providerTrackId: "abcdefghijk",
  title: "Integration fixture",
  artist: "Test artist",
  url: "https://www.youtube.com/watch?v=abcdefghijk",
  durationMs: 300000,
  access: "playable",
};
const provider: MusicProvider = {
  id: "youtube",
  name: "Test fixture",
  supportsSeek: true,
  supportsQueue: true,
  supportsAuthentication: false,
  async search() {
    return [track];
  },
  async getTrack(id) {
    return { ...track, providerTrackId: id };
  },
};
let first: Awaited<ReturnType<typeof buildServer>>,
  second: Awaited<ReturnType<typeof buildServer>>;
const sockets: Socket[] = [];
const rooms = new Set<string>();
interface Client {
  user: User;
  cookie: string;
  socket: Socket;
  states: RoomSnapshot[];
}
async function guest(name: string, port = 4101): Promise<Client> {
  const response = await fetch(`http://localhost:${port}/api/auth/guest`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ displayName: name }),
  });
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  const { user } = (await response.json()) as { user: User };
  return connect(user, cookie, port);
}
async function connect(
  user: User,
  cookie: string,
  port = 4101,
): Promise<Client> {
  const socket = io(`http://localhost:${port}`, {
    transports: ["websocket"],
    extraHeaders: { Cookie: cookie, Origin: origin },
    forceNew: true,
    reconnection: false,
  });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  const states: RoomSnapshot[] = [];
  socket.on("room:state", (state) => states.push(state));
  return { user, cookie, socket, states };
}
async function create(client: Client, privateRoom = false) {
  const response = await fetch("http://localhost:4101/api/rooms", {
    method: "POST",
    headers: {
      Origin: origin,
      Cookie: client.cookie,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "Test room",
      visibility: privateRoom ? "PRIVATE" : "PUBLIC",
      provider: "youtube",
      password: privateRoom ? "correct-password" : undefined,
    }),
  });
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  rooms.add(id);
  return id;
}
function join(client: Client, id: string): Promise<Ack<RoomSnapshot>> {
  return client.socket.timeout(5000).emitWithAck("room:join", { roomId: id });
}
function command(client: Client, id: string, command: Command): Promise<Ack> {
  return client.socket
    .timeout(5000)
    .emitWithAck("room:command", { roomId: id, command });
}
async function waitFor(
  check: () => boolean | Promise<boolean>,
  timeout = 7000,
) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Condition timed out");
}
beforeAll(async () => {
  // Database 15 is reserved for tests. No FLUSHDB/FLUSHALL: only test-created rooms are removed.
  first = await buildServer(config, {
    youtube: provider,
    soundcloud: { ...provider, id: "soundcloud" },
  });
  second = await buildServer(
    { ...config, PORT: 4102 },
    { youtube: provider, soundcloud: { ...provider, id: "soundcloud" } },
  );
  await first.app.listen({ port: 4101 });
  await second.app.listen({ port: 4102 });
});
afterAll(async () => {
  sockets.forEach((socket) => socket.disconnect());
  for (const id of rooms)
    try {
      await first.store.mutate(id, () => "delete");
    } catch {
      /* already cleaned up */
    }
  await first?.app.close();
  await second?.app.close();
});
describe("real Redis, PostgreSQL, HTTP and multi-instance Socket.IO", () => {
  it("reports dependency health and rejects cross-origin mutations", async () => {
    const response = await fetch("http://localhost:4101/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      api: "ok",
      redis: "ok",
      postgresql: "ok",
    });
    const attack = await fetch("http://localhost:4101/api/auth/guest", {
      method: "POST",
      headers: {
        Origin: "https://evil.invalid",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ displayName: "Attacker" }),
    });
    expect(attack.status).toBe(403);
  });
  it("synchronizes host, A and late-joining B across two API servers", async () => {
    const host = await guest("Host"),
      a = await guest("Listener A", 4102),
      b = await guest("Listener B", 4102);
    const id = await create(host);
    expect((await join(host, id)).ok).toBe(true);
    expect((await join(a, id)).ok).toBe(true);
    expect((await command(a, id, { type: "player:play" })).ok).toBe(false);
    expect(
      (
        await command(host, id, {
          type: "queue:add",
          trackId: track.providerTrackId,
          playNow: false,
        })
      ).ok,
    ).toBe(true);
    await command(host, id, { type: "player:play" });
    await waitFor(() => a.states.at(-1)?.playback.status === "PLAYING");
    expect(a.states.at(-1)?.playback).toEqual(host.states.at(-1)?.playback);
    await command(host, id, { type: "player:seek", position: 130 });
    await waitFor(() => a.states.at(-1)?.playback.positionSeconds === 130);
    await new Promise((resolve) => setTimeout(resolve, 350));
    const joined = await join(b, id);
    expect(joined.ok).toBe(true);
    if (joined.ok)
      expect(
        expectedPosition(joined.data.playback, Date.now()),
      ).toBeGreaterThan(130.3);
    await command(host, id, { type: "player:pause" });
    await waitFor(() => b.states.at(-1)?.playback.status === "PAUSED");
    expect(a.states.at(-1)?.playback).toEqual(b.states.at(-1)?.playback);
    expect(
      (await command(host, id, { type: "member:promote", userId: b.user.id }))
        .ok,
    ).toBe(true);
    expect(
      (await command(b, id, { type: "player:seek", position: 55 })).ok,
    ).toBe(true);
    expect((await command(b, id, { type: "room:delete" })).ok).toBe(false);
    await command(host, id, { type: "room:leave" });
    await waitFor(
      async () => (await first.store.get(id)).ownerUserId === b.user.id,
    );
    await command(a, id, { type: "room:leave" });
    await command(b, id, { type: "room:leave" });
    await waitFor(async () => !(await first.redis.exists(`res:room:${id}`)));
    expect(await first.redis.sismember("res:rooms", id)).toBe(0);
  });
  it("protects private rooms, changes passwords, promotes and kicks without state leakage", async () => {
    const host = await guest("Private host"),
      listener = await guest("Private listener", 4102);
    const id = await create(host, true);
    await join(host, id);
    const denied = await join(listener, id);
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.code).toBe("PASSWORD_REQUIRED");
    const access = async (password: string) =>
      fetch(`http://localhost:4101/api/rooms/${id}/access`, {
        method: "POST",
        headers: {
          Origin: origin,
          Cookie: listener.cookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password }),
      });
    expect((await access("wrong-password")).status).toBe(403);
    expect((await access("correct-password")).status).toBe(200);
    const joined = await join(listener, id);
    expect(joined.ok).toBe(true);
    expect(JSON.stringify(joined)).not.toContain("passwordHash");
    expect(JSON.stringify(joined)).not.toContain("$argon2id");
    const listed = (await (
      await fetch("http://localhost:4101/api/rooms")
    ).json()) as { rooms: { id: string }[] };
    expect(listed.rooms.some((room) => room.id === id)).toBe(false);
    await command(host, id, {
      type: "member:promote",
      userId: listener.user.id,
    });
    expect(
      (
        await command(listener, id, {
          type: "queue:add",
          trackId: track.providerTrackId,
          playNow: false,
        })
      ).ok,
    ).toBe(true);
    await command(host, id, {
      type: "room:edit",
      name: "Private renamed",
      visibility: "PRIVATE",
      provider: "youtube",
      password: "new-password",
      allowListenersToAddTracks: false,
      allowGuests: true,
    });
    expect((await access("correct-password")).status).toBe(403);
    await command(host, id, { type: "member:kick", userId: listener.user.id });
    expect((await join(listener, id)).ok).toBe(false);
    expect((await command(listener, id, { type: "player:play" })).ok).toBe(
      false,
    );
    await command(host, id, { type: "room:delete" });
    expect(await first.redis.exists(`res:grants:${id}`)).toBe(0);
  });
  it("deduplicates tabs, preserves temporary disconnects and serializes concurrent queue updates", async () => {
    const host = await guest("Multitab host"),
      listener = await guest("Multitab listener", 4102);
    const id = await create(host);
    await join(host, id);
    await join(listener, id);
    const tab = await connect(host.user, host.cookie, 4102);
    await join(tab, id);
    expect((await first.store.get(id)).members).toHaveLength(2);
    host.socket.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 1800));
    expect((await first.store.get(id)).ownerUserId).toBe(host.user.id);
    await command(tab, id, {
      type: "member:promote",
      userId: listener.user.id,
    });
    const results = await Promise.all([
      command(tab, id, {
        type: "queue:add",
        trackId: "aaaaaaaaaaa",
        playNow: false,
      }),
      command(listener, id, {
        type: "queue:add",
        trackId: "bbbbbbbbbbb",
        playNow: false,
      }),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect((await first.store.get(id)).queue).toHaveLength(2);
    tab.socket.disconnect();
    const reconnect = await connect(host.user, host.cookie);
    await join(reconnect, id);
    expect((await first.store.get(id)).ownerUserId).toBe(host.user.id);
    reconnect.socket.disconnect();
    await waitFor(
      async () => (await first.store.get(id)).ownerUserId === listener.user.id,
    );
    await command(listener, id, { type: "room:delete" });
  });
  it("bounds chat and rejects spoofed permissions and malformed commands", async () => {
    const host = await guest("Chat host"),
      listener = await guest("Chat listener");
    const id = await create(host);
    await join(host, id);
    await join(listener, id);
    const spoof = (await listener.socket
      .timeout(5000)
      .emitWithAck("room:command", {
        roomId: id,
        role: "OWNER",
        command: { type: "player:seek", position: 5 },
      })) as Ack;
    expect(spoof.ok).toBe(false);
    const invalid = (await listener.socket
      .timeout(5000)
      .emitWithAck("room:command", {
        roomId: id,
        command: { type: "chat:send", content: "x".repeat(501) },
      })) as Ack;
    expect(invalid.ok).toBe(false);
    const text = "<img src=x onerror=alert(1)>";
    await command(listener, id, { type: "chat:send", content: text });
    expect((await first.store.get(id)).chat[0].content).toBe(text);
    const results = [];
    for (let i = 0; i < 7; i++)
      results.push(
        await command(listener, id, {
          type: "chat:send",
          content: `message ${i}`,
        }),
      );
    expect(
      results.some((result) => !result.ok && result.code === "RATE_LIMITED"),
    ).toBe(true);
    await command(host, id, { type: "room:delete" });
  });
  it("appoints a host when someone joins during the empty-room cleanup grace", async () => {
    const host = await guest("Returning host");
    const id = await create(host);
    await join(host, id);
    await command(host, id, { type: "room:leave" });
    const returning = await connect(host.user, host.cookie, 4102);
    const result = await join(returning, id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.ownerUserId).toBe(host.user.id);
      expect(result.data.members[0].role).toBe("OWNER");
    }
    expect((await command(returning, id, { type: "room:delete" })).ok).toBe(
      true,
    );
  });
});
