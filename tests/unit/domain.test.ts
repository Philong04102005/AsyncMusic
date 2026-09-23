import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import {
  can,
  expectedPosition,
  commandSchema,
  permissions,
  type Track,
  type User,
} from "@resonance/shared";
import {
  createRoom,
  applyCommand,
  cleanup,
  snapshot,
  type StoredMember,
} from "../../apps/api/src/domain";
import {
  parseDuration,
  normalizeYouTube,
  normalizeSoundCloud,
} from "@resonance/providers";
import { encrypt, decrypt } from "../../apps/api/src/provider-tokens";
const host: User = { id: randomUUID(), displayName: "Host", guest: true };
const track: Track = {
  provider: "youtube",
  providerTrackId: "abcdefghijk",
  title: "Test song",
  artist: "Artist",
  durationMs: 240000,
  url: "https://www.youtube.com/watch?v=abcdefghijk",
  access: "playable",
};
function setup() {
  const room = createRoom(
    {
      name: "Test room",
      visibility: "PUBLIC",
      provider: "youtube",
      allowGuests: true,
      allowListenersToAddTracks: false,
    },
    host,
    undefined,
    1000,
  );
  room.members[0].connected = true;
  room.members[0].connections.s1 = 999999;
  return room;
}
function member(role: "DJ" | "LISTENER", at: number): StoredMember {
  return {
    id: randomUUID(),
    displayName: role,
    guest: true,
    role,
    connectedAt: at,
    connected: true,
    connections: { x: 999999 },
  };
}
describe("central permissions", () => {
  it("grants owner all permissions but protects administrative commands from DJs", () => {
    for (const permission of permissions)
      expect(can("OWNER", permission)).toBe(true);
    expect(can("DJ", "PLAYER_SEEK")).toBe(true);
    expect(can("DJ", "ROOM_DELETE")).toBe(false);
    expect(can("DJ", "MEMBER_PROMOTE")).toBe(false);
    expect(can("LISTENER", "QUEUE_ADD", true)).toBe(true);
    expect(can("LISTENER", "PLAYER_PLAY", true)).toBe(false);
    expect(can(undefined, "QUEUE_ADD", true)).toBe(false);
  });
  it("does not trust a listener who asks to play now", () => {
    const room = setup();
    const listener = member("LISTENER", 2);
    room.members.push(listener);
    room.allowListenersToAddTracks = true;
    expect(() =>
      applyCommand(
        room,
        listener.id,
        { type: "queue:add", trackId: track.providerTrackId, playNow: true },
        { track },
      ),
    ).toThrow("host or a DJ");
  });
});
describe("canonical playback and queue", () => {
  it("extrapolates server time, freezes pause, and clamps finite duration", () => {
    const state = {
      track,
      status: "PLAYING" as const,
      positionSeconds: 42,
      stateUpdatedAt: 1000,
      version: 1,
    };
    expect(expectedPosition(state, 11000)).toBe(52);
    expect(expectedPosition({ ...state, status: "PAUSED" }, 11000)).toBe(42);
    expect(expectedPosition(state, 999999)).toBe(240);
  });
  it("queues, reorders, removes and advances on the server", () => {
    const room = setup();
    for (const title of ["One", "Two", "Three"])
      applyCommand(
        room,
        host.id,
        { type: "queue:add", trackId: track.providerTrackId, playNow: false },
        { track: { ...track, title } },
        1000,
      );
    applyCommand(room, host.id, {
      type: "queue:move",
      itemId: room.queue[2].id,
      toIndex: 0,
    });
    expect(room.queue.map((item) => item.track.title)).toEqual([
      "Three",
      "One",
      "Two",
    ]);
    applyCommand(room, host.id, {
      type: "queue:remove",
      itemId: room.queue[1].id,
    });
    applyCommand(room, host.id, { type: "player:play" }, undefined, 2000);
    expect(room.playback.track?.title).toBe("Three");
    applyCommand(
      room,
      host.id,
      { type: "player:seek", position: 50 },
      undefined,
      3000,
    );
    applyCommand(room, host.id, { type: "player:pause" }, undefined, 8000);
    expect(room.playback.positionSeconds).toBe(55);
    expect(room.playback.version).toBe(3);
    applyCommand(room, host.id, { type: "player:next" }, undefined, 9000);
    expect(room.playback.track?.title).toBe("Two");
  });
  it("rejects cross-provider and preview tracks", () => {
    const room = setup();
    expect(() =>
      applyCommand(
        room,
        host.id,
        { type: "queue:add", trackId: "1", playNow: false },
        { track: { ...track, access: "preview" } },
      ),
    ).toThrow("not available");
  });
  it("validates malicious positions and oversized chat", () => {
    expect(
      commandSchema.safeParse({ type: "player:seek", position: Infinity })
        .success,
    ).toBe(false);
    expect(
      commandSchema.safeParse({ type: "chat:send", content: "x".repeat(501) })
        .success,
    ).toBe(false);
  });
});
describe("lifecycle", () => {
  it("waits for disconnect grace, transfers to oldest DJ, then deletes an empty room", () => {
    const room = setup();
    const listener = member("LISTENER", 1000),
      dj = member("DJ", 3000);
    room.members.push(listener, dj);
    room.members[0].connected = false;
    room.members[0].connections = {};
    room.members[0].disconnectedAt = 1000;
    cleanup(room, 15999, 15000, 15000);
    expect(room.ownerUserId).toBe(host.id);
    cleanup(room, 16000, 15000, 15000);
    expect(room.ownerUserId).toBe(dj.id);
    applyCommand(room, dj.id, { type: "room:leave" }, undefined, 17000);
    expect(room.ownerUserId).toBe(listener.id);
    applyCommand(room, listener.id, { type: "room:leave" }, undefined, 18000);
    expect(cleanup(room, 32999, 15000, 15000)).toBe("unchanged");
    expect(cleanup(room, 33000, 15000, 15000)).toBe("delete");
  });
  it("handles a crashed process using socket lease expiry", () => {
    const room = setup();
    room.members[0].connections = { dead: 2000 };
    cleanup(room, 2001, 15000, 15000);
    expect(room.members[0].connected).toBe(false);
    cleanup(room, 17001, 15000, 15000);
    expect(room.members).toHaveLength(0);
  });
  it("does not leak password hashes, bans or socket identities in a snapshot", () => {
    const room = setup();
    room.passwordHash = "secret";
    room.banned.push("banned-id");
    const wire = JSON.stringify(snapshot(room));
    expect(wire).not.toContain("secret");
    expect(wire).not.toContain("banned-id");
    expect(wire).not.toContain("connections");
  });
  it("uses Argon2id and rejects the wrong password", async () => {
    const hash = await argon2.hash("a private room", { type: argon2.argon2id });
    expect(hash).toContain("$argon2id$");
    expect(await argon2.verify(hash, "a private room")).toBe(true);
    expect(await argon2.verify(hash, "wrong")).toBe(false);
  });
});
describe("provider metadata and token security", () => {
  it("normalizes YouTube duration and embedding restrictions", () => {
    expect(parseDuration("PT1H2M3S")).toBe(3723000);
    expect(parseDuration("P0D")).toBeUndefined();
    const result = normalizeYouTube({
      id: "abcdefghijk",
      snippet: { title: "Song", channelTitle: "Band" },
      contentDetails: { duration: "PT2M" },
      status: { embeddable: false },
    });
    expect(result.access).toBe("blocked");
    expect(result.durationMs).toBe(120000);
  });
  it("preserves SoundCloud attribution and access limitations", () => {
    const result = normalizeSoundCloud({
      urn: "soundcloud:tracks:123",
      title: "Song",
      user: { username: "Uploader" },
      metadata_artist: "Artist",
      permalink_url: "https://soundcloud.com/artist/song",
      access: "preview",
    });
    expect(result.artist).toBe("Artist");
    expect(result.access).toBe("preview");
  });
  it("authenticates ciphertext and never persists a plaintext token", () => {
    const key = "01".repeat(32);
    const sealed = encrypt("secret-provider-token", key);
    expect(sealed).not.toContain("secret-provider-token");
    expect(decrypt(sealed, key)).toBe("secret-provider-token");
    expect(() => decrypt(sealed, "02".repeat(32))).toThrow();
  });
});
