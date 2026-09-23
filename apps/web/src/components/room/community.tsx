"use client";
import { useEffect, useRef, useState } from "react";
import { Crown, Headphones, Send, Users, MessageCircle } from "lucide-react";
import {
  can,
  type RoomSnapshot,
  type Role,
  type Command,
} from "@resonance/shared";
export function Members({
  room,
  role,
  send,
}: {
  room: RoomSnapshot;
  role?: Role;
  send: (command: Command) => void;
}) {
  return (
    <section className="members-panel">
      <div className="panel-heading">
        <h2>
          <Users size={18} />
          In good company <span className="count">{room.members.length}</span>
        </h2>
      </div>
      <div className="members-list">
        {room.members.map((member) => (
          <div className="member-row" key={member.id}>
            <span className={`avatar ${member.connected ? "" : "offline"}`}>
              {member.displayName[0].toUpperCase()}
            </span>
            <div>
              <strong>{member.displayName}</strong>
              <span>
                {member.connected
                  ? member.role === "OWNER"
                    ? "Hosting the room"
                    : member.role === "DJ"
                      ? "On the decks"
                      : "Listening along"
                  : "Reconnecting…"}
              </span>
            </div>
            {member.role === "OWNER" ? (
              <Crown size={16} className="accent" />
            ) : member.role === "DJ" ? (
              <Headphones size={16} className="accent" />
            ) : null}
            {can(role, "MEMBER_PROMOTE") && member.role !== "OWNER" && (
              <select
                aria-label={`Manage ${member.displayName}`}
                value=""
                onChange={(event) => {
                  const action = event.target.value;
                  if (action)
                    send({
                      type: action as
                        | "member:promote"
                        | "member:demote"
                        | "member:kick"
                        | "room:transfer",
                      userId: member.id,
                    });
                }}
              >
                <option value="">Manage</option>
                <option
                  value={
                    member.role === "DJ" ? "member:demote" : "member:promote"
                  }
                >
                  {member.role === "DJ" ? "Make listener" : "Make DJ"}
                </option>
                <option value="room:transfer">Make host</option>
                <option value="member:kick">Remove</option>
              </select>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
export function Chat({
  room,
  userId,
  send,
}: {
  room: RoomSnapshot;
  userId: string;
  send: (command: Command) => Promise<void>;
}) {
  const [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [room.chat.length, room.chat.at(-1)?.id]);
  return (
    <section className="chat-panel">
      <div className="panel-heading">
        <h2>
          <MessageCircle size={18} />
          The conversation
        </h2>
        <span className="subtle tiny-text">Keep it kind.</span>
      </div>
      <div className="chat-messages" aria-live="polite" role="log">
        {room.chat.length ? (
          room.chat.map((message) => (
            <div
              className={`chat-message ${message.userId === userId ? "own-message" : ""}`}
              key={message.id}
            >
              <span className="avatar small">
                {message.displayName[0].toUpperCase()}
              </span>
              <div>
                <div className="chat-meta">
                  <strong>{message.displayName}</strong>
                  <time>
                    {new Date(message.createdAt).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                </div>
                <p>{message.content}</p>
              </div>
            </div>
          ))
        ) : (
          <div className="chat-welcome">
            <span>✦</span>
            <h3>Good music breaks the ice.</h3>
            <p>Say hello. Share a lyric. Ask who picked that song.</p>
          </div>
        )}
        <div ref={bottom} />
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <form
        className="chat-compose"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!message.trim()) return;
          setBusy(true);
          setError("");
          try {
            await send({ type: "chat:send", content: message.trim() });
            setMessage("");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <input
          aria-label="Chat message"
          maxLength={500}
          placeholder="Say something nice…"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
        />
        <button aria-label="Send message" disabled={busy || !message.trim()}>
          <Send size={18} />
        </button>
      </form>
    </section>
  );
}
