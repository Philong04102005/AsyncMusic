"use client";
import { useState } from "react";
import type { RoomSnapshot, Command, ProviderId } from "@resonance/shared";
import { Dialog } from "../ui/dialog";
export function RoomSettings({
  room,
  open,
  setOpen,
  send,
}: {
  room: RoomSnapshot;
  open: boolean;
  setOpen: (open: boolean) => void;
  send: (command: Command) => Promise<void>;
}) {
  const [name, setName] = useState(room.name),
    [visibility, setVisibility] = useState(room.visibility),
    [provider, setProvider] = useState(room.provider),
    [password, setPassword] = useState(""),
    [allow, setAllow] = useState(room.allowListenersToAddTracks),
    [guests, setGuests] = useState(room.allowGuests),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Make this room your own."
      description="These settings apply to everyone in the room."
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            await send({
              type: "room:edit",
              name,
              visibility,
              provider,
              password: password || undefined,
              allowListenersToAddTracks: allow,
              allowGuests: guests,
            });
            setOpen(false);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Room name
          <input
            value={name}
            minLength={2}
            maxLength={80}
            required
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Visibility
          <select
            value={visibility}
            onChange={(event) =>
              setVisibility(event.target.value as typeof visibility)
            }
          >
            <option value="PUBLIC">Public</option>
            <option value="PRIVATE">Private</option>
          </select>
        </label>
        {visibility === "PRIVATE" && (
          <label>
            New password
            <input
              type="password"
              autoComplete="new-password"
              placeholder="Leave empty to keep the current password"
              minLength={8}
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
        )}
        <label>
          Music provider
          <select
            value={provider}
            onChange={(event) => setProvider(event.target.value as ProviderId)}
            disabled={!!room.playback.track || !!room.queue.length}
          >
            <option value="youtube">YouTube</option>
            <option value="soundcloud">SoundCloud</option>
          </select>
          <small>
            To switch sources, clear the queue and skip the current track.
          </small>
        </label>
        <label className="toggle-row">
          <span>Listeners can add songs</span>
          <input
            type="checkbox"
            checked={allow}
            onChange={(event) => setAllow(event.target.checked)}
          />
        </label>
        <label className="toggle-row">
          <span>Allow guests to join</span>
          <input
            type="checkbox"
            checked={guests}
            onChange={(event) => setGuests(event.target.checked)}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary full" disabled={busy}>
          Save changes
        </button>
      </form>
      <div className="danger-zone">
        {confirm ? (
          <>
            <p>Close the room for everyone? Queue and chat will be deleted.</p>
            <button
              className="button danger"
              onClick={async () => {
                try {
                  await send({ type: "room:delete" });
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Yes, close this room
            </button>
            <button className="text-button" onClick={() => setConfirm(false)}>
              Keep listening
            </button>
          </>
        ) : (
          <button
            className="text-button danger-text"
            onClick={() => setConfirm(true)}
          >
            Leave and close room
          </button>
        )}
      </div>
    </Dialog>
  );
}
