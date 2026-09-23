"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Globe2, LockKeyhole, Radio, ArrowRight } from "lucide-react";
import type { ProviderId } from "@resonance/shared";
import { post } from "@/lib/api";
import { Dialog } from "./ui/dialog";
export function CreateRoom({
  open,
  setOpen,
}: {
  open: boolean;
  setOpen: (value: boolean) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<"PUBLIC" | "PRIVATE">("PUBLIC");
  const [provider, setProvider] = useState<ProviderId>("youtube"),
    [password, setPassword] = useState(""),
    [allow, setAllow] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Every good night starts with a room."
      description="Set the mood. We'll bring everyone together."
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            const room = await post<{ slug: string }>("/api/rooms", {
              name,
              visibility,
              provider,
              password: visibility === "PRIVATE" ? password : undefined,
              allowListenersToAddTracks: allow,
              allowGuests: true,
            });
            router.push(`/room/${room.slug}`);
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
            autoFocus
            required
            minLength={2}
            maxLength={80}
            placeholder="e.g. The after-hours club"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <fieldset>
          <legend>Who&apos;s invited?</legend>
          <div className="option-grid">
            <button
              type="button"
              className={`option ${visibility === "PUBLIC" ? "selected" : ""}`}
              onClick={() => setVisibility("PUBLIC")}
            >
              <Globe2 size={20} />
              <strong>Everyone</strong>
              <span>Listed on Discover</span>
            </button>
            <button
              type="button"
              className={`option ${visibility === "PRIVATE" ? "selected" : ""}`}
              onClick={() => setVisibility("PRIVATE")}
            >
              <LockKeyhole size={20} />
              <strong>Just your people</strong>
              <span>Protected by a password</span>
            </button>
          </div>
        </fieldset>
        {visibility === "PRIVATE" && (
          <label>
            Room password
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 8 characters"
            />
          </label>
        )}
        <label>
          Music source
          <select
            value={provider}
            onChange={(event) => setProvider(event.target.value as ProviderId)}
          >
            <option value="youtube">YouTube</option>
            <option value="soundcloud">SoundCloud</option>
          </select>
        </label>
        <label className="toggle-row">
          <span>
            <strong>A shared queue</strong>
            <small>Let listeners add their favorite songs</small>
          </span>
          <input
            type="checkbox"
            checked={allow}
            onChange={(event) => setAllow(event.target.checked)}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary full" disabled={busy}>
          <Radio size={18} />
          {busy ? "Opening your room…" : "Create your room"}
          <ArrowRight size={18} />
        </button>
      </form>
    </Dialog>
  );
}
