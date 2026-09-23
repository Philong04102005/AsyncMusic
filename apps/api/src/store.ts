import { Redis } from "ioredis";
import { AppError, type Room } from "./domain";

export const roomKey = (id: string) => `res:room:${id}`;
export class RoomStore {
  constructor(public redis: Redis) {}
  async get(id: string): Promise<Room> {
    const value = await this.redis.get(roomKey(id));
    if (!value)
      throw new AppError(
        "ROOM_NOT_FOUND",
        "This room has closed or does not exist",
        404,
      );
    return JSON.parse(value) as Room;
  }
  async create(room: Room) {
    await this.redis
      .multi()
      .set(roomKey(room.id), JSON.stringify(room), "EX", 86400)
      .sadd("res:rooms", room.id)
      .exec();
  }
  async ids() {
    return this.redis.smembers("res:rooms");
  }
  async mutate(
    id: string,
    fn: (room: Room) => "delete" | "unchanged" | void,
  ): Promise<Room | null> {
    const connection = this.redis.duplicate();
    try {
      for (let attempt = 0; attempt < 12; attempt++) {
        await connection.watch(roomKey(id));
        const value = await connection.get(roomKey(id));
        if (!value)
          throw new AppError("ROOM_NOT_FOUND", "This room has closed", 404);
        const room = JSON.parse(value) as Room;
        const result = fn(room);
        if (result === "unchanged") {
          await connection.unwatch();
          return room;
        }
        const transaction = connection.multi();
        if (result === "delete") {
          transaction.del(roomKey(id)).srem("res:rooms", id);
          const grants = await connection.smembers(`res:grants:${id}`);
          if (grants.length) transaction.del(...grants);
          transaction.del(`res:grants:${id}`);
        } else {
          room.revision++;
          transaction.set(roomKey(id), JSON.stringify(room), "EX", 86400);
        }
        if ((await transaction.exec()) !== null)
          return result === "delete" ? null : room;
      }
      throw new AppError("CONFLICT", "Room is busy. Please try again.", 409);
    } finally {
      await connection.quit();
    }
  }
}
export async function rateLimit(
  redis: Redis,
  bucket: string,
  key: string,
  max: number,
  windowSeconds: number,
) {
  const count = Number(
    await redis.eval(
      "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n",
      1,
      `res:limit:${bucket}:${key}`,
      windowSeconds,
    ),
  );
  if (count > max)
    throw new AppError(
      "RATE_LIMITED",
      "Too many requests. Please wait a moment.",
      429,
    );
}
