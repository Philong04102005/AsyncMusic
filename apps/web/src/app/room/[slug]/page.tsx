"use client";
import { use, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Copy,
  Settings2,
  LogOut,
  LockKeyhole,
  Globe2,
  Headphones,
} from "lucide-react";
import { can, type Command } from "@resonance/shared";
import { Header } from "@/components/header";
import { useSession } from "@/components/session";
import { useRoom } from "@/lib/use-room";
import { post } from "@/lib/api";
import { RoomPlayer } from "@/components/room/player";
import { Queue } from "@/components/room/queue";
import { TrackSearch } from "@/components/room/search";
import { Members, Chat } from "@/components/room/community";
import { RoomSettings } from "@/components/room/settings";
export default function RoomPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = use(params);
  const { user, loading, signIn } = useSession();
  const { room, connected, error, code, join, command, clock } = useRoom(
    slug,
    user,
  );
  const [password, setPassword] = useState(""),
    [notice, setNotice] = useState(""),
    [actionError, setActionError] = useState(""),
    [search, setSearch] = useState(false),
    [settings, setSettings] = useState(false);
  const send = (value: Command) => {
    setActionError("");
    void command(value).catch((e) => setActionError((e as Error).message));
  };
  const role = room?.members.find((member) => member.id === user?.id)?.role;
  return (
    <>
      <Header />
      {!room ? (
        <main className="center-page">
          <div className="auth-symbol">
            <Headphones size={35} />
          </div>
          <h1>
            {loading
              ? "Finding your session…"
              : !user
                ? "Your people are one song away."
                : code === "PASSWORD_REQUIRED"
                  ? "An invite-only kind of evening."
                  : error
                    ? "A pause in the music."
                    : "Joining the room…"}
          </h1>
          <p>
            {!user
              ? "Choose a display name to join this listening room."
              : error || "Getting everyone on the same wavelength."}
          </p>
          {!user && !loading && (
            <button className="button primary" onClick={signIn}>
              Join the room
            </button>
          )}
          {code === "PASSWORD_REQUIRED" && (
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                setActionError("");
                try {
                  await post(`/api/rooms/${slug}/access`, { password });
                  join();
                } catch (e) {
                  setActionError((e as Error).message);
                }
              }}
            >
              <label>
                Room password
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <button className="button primary full">Unlock room</button>
            </form>
          )}
          {actionError && <p className="error">{actionError}</p>}
          <Link className="text-button" href="/">
            <ArrowLeft size={16} />
            Back to discovery
          </Link>
        </main>
      ) : (
        <main className="room-main">
          <Link href="/" className="back-link">
            <ArrowLeft size={15} />
            All rooms
          </Link>
          <div className="room-title-row">
            <div>
              <div className="eyebrow subdued">
                {room.visibility === "PUBLIC" ? (
                  <Globe2 size={13} />
                ) : (
                  <LockKeyhole size={13} />
                )}
                {room.visibility === "PUBLIC"
                  ? "OPEN TO GOOD COMPANY"
                  : "JUST BETWEEN FRIENDS"}
              </div>
              <h1>
                {room.name}
                <span className="room-live">
                  <span className="live-dot" />
                  LIVE
                </span>
              </h1>
              <p>
                {room.provider === "youtube" ? "YouTube" : "SoundCloud"}{" "}
                <span>·</span> {room.members.length} listening together
              </p>
            </div>
            <div className="room-actions">
              <button
                className="button secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(location.href);
                    setNotice("Room link copied. Send it to your people.");
                    setTimeout(() => setNotice(""), 4000);
                  } catch {
                    setActionError(
                      "Copy the room URL from your address bar to invite friends.",
                    );
                  }
                }}
              >
                <Copy size={16} />
                Invite friends
              </button>
              {can(role, "ROOM_EDIT") && (
                <button
                  className="icon-button bordered"
                  aria-label="Room settings"
                  onClick={() => setSettings(true)}
                >
                  <Settings2 size={18} />
                </button>
              )}
              <button
                className="icon-button bordered"
                aria-label="Leave room"
                onClick={async () => {
                  try {
                    await command({ type: "room:leave" });
                    location.assign("/");
                  } catch (e) {
                    setActionError((e as Error).message);
                  }
                }}
              >
                <LogOut size={18} />
              </button>
            </div>
          </div>
          {notice && (
            <div className="toast success" role="status">
              {notice}
            </div>
          )}
          {actionError && (
            <div className="toast error" role="alert">
              {actionError}
              <button
                className="text-button"
                onClick={() => setActionError("")}
              >
                Dismiss
              </button>
            </div>
          )}
          {!connected && (
            <div className="connection-banner" role="status">
              Connection interrupted. Controls will return when you reconnect.
            </div>
          )}
          <div className="room-layout">
            <div className="room-left">
              <RoomPlayer
                room={room}
                role={role}
                connected={connected}
                clock={clock}
                send={send}
              />
              <Members room={room} role={role} send={send} />
            </div>
            <div className="room-right">
              <Queue
                room={room}
                role={role}
                search={() => setSearch(true)}
                send={send}
              />
              <Chat room={room} userId={user!.id} send={command} />
            </div>
          </div>
          <div className="room-bottom-note">
            Different places. Same feeling. <span>✦</span> You&apos;re listening
            with Resonance.
          </div>
          <TrackSearch
            open={search}
            setOpen={setSearch}
            provider={room.provider}
            roomId={room.id}
            canPlay={can(role, "PLAYER_PLAY")}
            send={command}
          />
          {settings && (
            <RoomSettings
              room={room}
              open={settings}
              setOpen={setSettings}
              send={command}
            />
          )}
        </main>
      )}
    </>
  );
}
