"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type {
  ClientEvents,
  ServerEvents,
  RoomSnapshot,
  Command,
  Ack,
  User,
} from "@resonance/shared";
import { ClockEstimator } from "./sync-engine";
export function useRoom(id: string, user: User | null) {
  const [room, setRoom] = useState<RoomSnapshot | null>(null),
    [connected, setConnected] = useState(false),
    [error, setError] = useState(""),
    [code, setCode] = useState("");
  const socketRef = useRef<Socket<ServerEvents, ClientEvents> | null>(null);
  const clock = useRef(new ClockEstimator());
  const accept = useCallback(
    (state: RoomSnapshot) =>
      setRoom((previous) =>
        !previous || state.revision > previous.revision ? state : previous,
      ),
    [],
  );
  const join = useCallback(() => {
    socketRef.current
      ?.timeout(10000)
      .emit(
        "room:join",
        { roomId: id },
        (timeout: Error | null, result: Ack<RoomSnapshot>) => {
          if (timeout) {
            setError("The room did not respond. Please reconnect.");
            return;
          }
          if (result.ok) {
            accept(result.data);
            setCode("");
            setError("");
            setConnected(true);
          } else {
            setError(result.error);
            setCode(result.code ?? "");
          }
        },
      );
  }, [id, accept]);
  useEffect(() => {
    if (!user) return;
    // In development the API has its own port. Production uses the reverse proxy's /socket.io route.
    const url =
      process.env.NEXT_PUBLIC_SOCKET_URL ||
      (process.env.NODE_ENV === "development"
        ? `${location.protocol}//${location.hostname}:4000`
        : location.origin);
    const socket = io(url, {
      transports: ["websocket"],
      withCredentials: true,
      autoConnect: false,
    });
    socketRef.current = socket;
    const ping = () => {
      const sent = Date.now();
      socket
        .timeout(5000)
        .emit("clock:ping", (error: Error | null, server: number) => {
          if (!error) clock.current.add(sent, Date.now(), server);
        });
    };
    socket.on("connect", () => {
      ping();
      join();
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => {
      setError("Connection interrupted. Reconnecting…");
      setConnected(false);
    });
    socket.on("room:state", accept);
    socket.on("room:deleted", () => {
      setRoom(null);
      setCode("ROOM_NOT_FOUND");
      setError("This room has closed. Find your next listening session.");
      socket.disconnect();
    });
    socket.on("room:kicked", () => {
      setRoom(null);
      setCode("FORBIDDEN");
      setError("You have left this room.");
      socket.disconnect();
    });
    socket.connect();
    const interval = setInterval(ping, 10000);
    const samples = [200, 500, 1000, 2000].map((ms) => setTimeout(ping, ms));
    return () => {
      clearInterval(interval);
      samples.forEach(clearTimeout);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [user?.id, id, accept, join]);
  const command = useCallback(
    (command: Command): Promise<void> =>
      new Promise((resolve, reject) => {
        if (!socketRef.current?.connected)
          return reject(new Error("Reconnect before changing the room"));
        socketRef.current
          .timeout(15000)
          .emit(
            "room:command",
            { roomId: id, command },
            (timeout: Error | null, result: Ack) => {
              if (timeout)
                reject(
                  new Error(
                    "The command timed out. Check the room before retrying.",
                  ),
                );
              else if (!result.ok) reject(new Error(result.error));
              else resolve();
            },
          );
      }),
    [id],
  );
  return { room, connected, error, code, join, command, clock: clock.current };
}
