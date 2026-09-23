"use client";
import { useEffect, useRef, useState } from "react";
import {
  Headphones,
  Play,
  Pause,
  SkipForward,
  Volume2,
  RefreshCw,
  ExternalLink,
  Disc3,
} from "lucide-react";
import {
  can,
  expectedPosition,
  type RoomSnapshot,
  type Command,
  type Role,
} from "@resonance/shared";
import { createPlayer } from "@/lib/players";
import type { PlayerAdapter } from "@/lib/players/types";
import { ClockEstimator, SyncEngine, type SyncStatus } from "@/lib/sync-engine";
import { time } from "@/lib/api";
export function RoomPlayer({
  room,
  role,
  connected,
  clock,
  send,
}: {
  room: RoomSnapshot;
  role?: Role;
  connected: boolean;
  clock: ClockEstimator;
  send: (command: Command) => void;
}) {
  const [started, setStarted] = useState(false),
    [status, setStatus] = useState<SyncStatus>("Syncing…"),
    [error, setError] = useState(""),
    [playerAttempt, setPlayerAttempt] = useState(0),
    [supportsSeek, setSupportsSeek] = useState(false),
    [volume, setVolume] = useState(0.7),
    [position, setPosition] = useState(0);
  const mount = useRef<HTMLDivElement>(null),
    engine = useRef<SyncEngine | null>(null),
    adapter = useRef<PlayerAdapter | null>(null),
    state = useRef(room.playback);
  state.current = room.playback;
  useEffect(() => {
    if (!started || !mount.current) return;
    let active = true;
    const updateStatus = (value: SyncStatus) => {
      if (active) setStatus(value);
    };
    const updateError = (value: string) => {
      if (active) setError(value);
    };
    const element = document.createElement("div");
    element.className = "provider-player";
    mount.current.append(element);
    const player = createPlayer(room.provider, element, {
      onBlocked: () => updateStatus("Tap to resume"),
      onError: updateError,
    });
    adapter.current = player;
    setSupportsSeek(player.supportsSeek);
    const sync = new SyncEngine(player, clock, updateStatus, updateError);
    engine.current = sync;
    sync.update(state.current);
    const interval = setInterval(() => void sync.tick(), 2000);
    return () => {
      active = false;
      clearInterval(interval);
      engine.current = null;
      adapter.current = null;
      element.remove();
      void sync.destroy().catch(() => {});
    };
  }, [started, room.provider, clock, playerAttempt]);
  useEffect(() => {
    setError("");
    engine.current?.update(room.playback);
  }, [room.playback.version]);
  useEffect(() => {
    const timer = setInterval(
      () => setPosition(expectedPosition(state.current, clock.now())),
      250,
    );
    return () => clearInterval(timer);
  }, [clock]);
  useEffect(() => {
    let active = true;
    if (adapter.current && room.playback.track)
      void adapter.current.setVolume(volume).catch((e) => {
        if (active) setError((e as Error).message);
      });
    return () => {
      active = false;
    };
  }, [volume, started, room.playback.track?.providerTrackId, playerAttempt]);
  useEffect(() => {
    if (!connected) {
      void adapter.current?.pause().catch(() => {});
    } else engine.current?.resync();
  }, [connected]);
  const control = can(role, "PLAYER_PLAY") && connected;
  const track = room.playback.track;
  const reloadPlayer = () => {
    setError("");
    setStatus("Syncing…");
    setPlayerAttempt((value) => value + 1);
  };
  return (
    <section className="player-panel">
      <div className="panel-label">
        <span>
          <span className="live-dot" />
          NOW PLAYING
        </span>
        <span
          className={`sync-indicator ${status === "Synced" && connected ? "synced" : ""}`}
        >
          {!connected
            ? "Reconnecting…"
            : started && track
              ? status
              : "Ready when you are"}
        </span>
      </div>
      <div className="player-stage" ref={mount}>
        {!started && (
          <div className="player-welcome">
            <div className="player-orb">
              <Headphones size={45} />
            </div>
            <h2>Your seat is saved.</h2>
            <p>Tap to start your synchronized listening session.</p>
            <button className="button primary" onClick={() => setStarted(true)}>
              <Play size={17} fill="currentColor" />
              Join listening session
            </button>
            <small>
              Music plays directly from{" "}
              {room.provider === "youtube" ? "YouTube" : "SoundCloud"}.
            </small>
          </div>
        )}
        {started && !track && (
          <div className="player-empty">
            <Disc3 size={54} />
            <h3>The stage is yours.</h3>
            <p>Add a song to the queue, then press play.</p>
          </div>
        )}
      </div>
      {started && status === "Tap to resume" && track && (
        <button
          className="button secondary full resume-button"
          onClick={() => engine.current?.resync()}
        >
          <Play size={16} />
          Tap to resume synchronized playback
        </button>
      )}
      {error && (
        <div className="error player-error" role="alert">
          <p>{error}</p>
          <p>
            The room timer can keep running even when your local player is
            unavailable.
          </p>
          <button
            className="button secondary small-button"
            onClick={reloadPlayer}
          >
            Reload player
          </button>
        </div>
      )}
      <div className="track-details">
        <div>
          <h2>{track?.title ?? "A good song is all it takes"}</h2>
          <p>{track?.artist ?? "Your next shared memory starts here"}</p>
        </div>
        {track && (
          <a
            className="icon-button"
            href={track.url}
            target="_blank"
            rel="noopener"
            aria-label={`Open on ${room.provider}`}
          >
            <ExternalLink size={18} />
          </a>
        )}
      </div>
      <div className="seek-row">
        <input
          type="range"
          aria-label="Playback position"
          min={0}
          max={
            track?.durationMs ? track.durationMs / 1000 : Math.max(position, 1)
          }
          step={1}
          value={position}
          disabled={!control || !supportsSeek || !track?.durationMs}
          onChange={(event) => setPosition(Number(event.target.value))}
          onPointerUp={(event) =>
            send({
              type: "player:seek",
              position: Number(event.currentTarget.value),
            })
          }
          onKeyUp={(event) => {
            if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
              send({
                type: "player:seek",
                position: Number(event.currentTarget.value),
              });
          }}
        />
        <div>
          <span>{time(position)}</span>
          <span>
            {track?.durationMs ? time(track.durationMs / 1000) : "—:—"}
          </span>
        </div>
      </div>
      <div className="playback-controls">
        <button
          className="text-button subtle"
          onClick={() => {
            if (error) reloadPlayer();
            else engine.current?.resync();
          }}
          disabled={!started || !track}
        >
          <RefreshCw size={15} />
          Resync
        </button>
        <div className="transport">
          <button
            className="play-button"
            aria-label={
              room.playback.status === "PLAYING" ? "Pause room" : "Play room"
            }
            disabled={!control}
            onClick={() =>
              send({
                type:
                  room.playback.status === "PLAYING"
                    ? "player:pause"
                    : "player:play",
              })
            }
          >
            {room.playback.status === "PLAYING" ? (
              <Pause size={24} fill="currentColor" />
            ) : (
              <Play size={24} fill="currentColor" />
            )}
          </button>
          <button
            className="icon-button"
            aria-label="Next track"
            disabled={!control}
            onClick={() => send({ type: "player:next" })}
          >
            <SkipForward size={22} />
          </button>
        </div>
        <label className="volume">
          <Volume2 size={17} />
          <input
            aria-label="Your volume"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(event) => setVolume(Number(event.target.value))}
          />
        </label>
      </div>
      <p className="player-footnote">
        {control
          ? "Room controls change playback for everyone."
          : "The host and DJs choose the soundtrack."}{" "}
        Ads and availability may differ for each listener.
      </p>
    </section>
  );
}
