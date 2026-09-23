"use client";
import {
  ListMusic,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Music2,
} from "lucide-react";
import {
  can,
  type RoomSnapshot,
  type Role,
  type Command,
} from "@resonance/shared";
import { time } from "@/lib/api";
export function Queue({
  room,
  role,
  search,
  send,
}: {
  room: RoomSnapshot;
  role?: Role;
  search: () => void;
  send: (command: Command) => void;
}) {
  const edit = can(role, "QUEUE_REMOVE");
  return (
    <section className="queue-panel">
      <div className="panel-heading">
        <h2>
          <ListMusic size={19} />
          Up next <span className="count">{room.queue.length}</span>
        </h2>
        {can(role, "QUEUE_ADD", room.allowListenersToAddTracks) && (
          <button className="button secondary small-button" onClick={search}>
            <Plus size={15} />
            Add songs
          </button>
        )}
      </div>
      <div className="queue-list">
        {room.queue.length ? (
          room.queue.map((item, index) => (
            <div className="queue-item" key={item.id}>
              <span className="queue-index">
                {String(index + 1).padStart(2, "0")}
              </span>
              {item.track.thumbnail ? (
                <img src={item.track.thumbnail} alt="" />
              ) : (
                <div className="track-placeholder">
                  <Music2 size={18} />
                </div>
              )}
              <div className="queue-copy">
                <strong>{item.track.title}</strong>
                <span>{item.track.artist}</span>
                <small>Added by {item.addedByName}</small>
              </div>
              <span className="track-duration">
                {item.track.durationMs
                  ? time(item.track.durationMs / 1000)
                  : "LIVE"}
              </span>
              {edit && (
                <div className="queue-item-actions">
                  <button
                    aria-label={`Move ${item.track.title} up`}
                    className="icon-button"
                    disabled={index === 0}
                    onClick={() =>
                      send({
                        type: "queue:move",
                        itemId: item.id,
                        toIndex: index - 1,
                      })
                    }
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    aria-label={`Move ${item.track.title} down`}
                    className="icon-button"
                    disabled={index === room.queue.length - 1}
                    onClick={() =>
                      send({
                        type: "queue:move",
                        itemId: item.id,
                        toIndex: index + 1,
                      })
                    }
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    aria-label={`Remove ${item.track.title}`}
                    className="icon-button"
                    onClick={() =>
                      send({ type: "queue:remove", itemId: item.id })
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>
          ))
        ) : (
          <div className="compact-empty queue-empty">
            <ListMusic size={36} />
            <h3>A little room for discovery.</h3>
            <p>Queue up a favorite and pass the good feeling on.</p>
            {can(role, "QUEUE_ADD", room.allowListenersToAddTracks) && (
              <button className="text-button accent" onClick={search}>
                <Plus size={15} />
                Add the first song
              </button>
            )}
          </div>
        )}
      </div>
      <div className="queue-footer">
        <span>
          {room.queue.length
            ? "A soundtrack made together"
            : "Your next favorite might be one song away"}
        </span>
        {edit && room.queue.length > 0 && (
          <button
            className="text-button subtle"
            onClick={() => send({ type: "queue:clear" })}
          >
            Clear queue
          </button>
        )}
      </div>
    </section>
  );
}
