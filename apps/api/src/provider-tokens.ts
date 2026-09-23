import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { z } from "zod";
import type { Redis } from "ioredis";
import { ProviderError } from "@resonance/providers";
import type { Config } from "./config";
const tokenSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number(),
});
interface TokenBundle {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}
export function encrypt(value: string, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}
export function decrypt(value: string, key: string): string {
  const data = Buffer.from(value, "base64");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(key, "hex"),
    data.subarray(0, 12),
  );
  cipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([
    cipher.update(data.subarray(28)),
    cipher.final(),
  ]).toString("utf8");
}
export function soundCloudTokenSource(redis: Redis, config: Config) {
  return async (): Promise<string> => {
    if (!config.SOUNDCLOUD_CLIENT_ID || !config.SOUNDCLOUD_CLIENT_SECRET)
      throw new ProviderError(
        "AUTH_REQUIRED",
        "SoundCloud search needs registered application credentials. See the setup guide.",
      );
    const key = "res:provider:soundcloud";
    const read = async () => {
      const value = await redis.get(key);
      return value
        ? (JSON.parse(
            decrypt(value, config.TOKEN_ENCRYPTION_KEY),
          ) as TokenBundle)
        : undefined;
    };
    let bundle = await read();
    if (bundle && bundle.expiresAt > Date.now() + 60000)
      return bundle.accessToken;
    const lock = randomUUID();
    if (!(await redis.set(`${key}:lock`, lock, "PX", 20000, "NX")))
      throw new ProviderError(
        "RATE_LIMITED",
        "SoundCloud is reconnecting. Try again shortly.",
      );
    try {
      bundle = await read();
      if (bundle && bundle.expiresAt > Date.now() + 60000)
        return bundle.accessToken;
      const body: Record<string, string> = bundle?.refreshToken
        ? {
            grant_type: "refresh_token",
            refresh_token: bundle.refreshToken,
            client_id: config.SOUNDCLOUD_CLIENT_ID,
            client_secret: config.SOUNDCLOUD_CLIENT_SECRET,
          }
        : { grant_type: "client_credentials" };
      const response = await fetch(
        "https://secure.soundcloud.com/oauth/token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${Buffer.from(`${config.SOUNDCLOUD_CLIENT_ID}:${config.SOUNDCLOUD_CLIENT_SECRET}`).toString("base64")}`,
          },
          body: new URLSearchParams(body),
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!response.ok)
        throw new ProviderError(
          response.status === 429 ? "RATE_LIMITED" : "AUTH_REQUIRED",
          "SoundCloud authorization failed. Check application credentials.",
        );
      const token = tokenSchema.parse(await response.json());
      await redis.set(
        key,
        encrypt(
          JSON.stringify({
            accessToken: token.access_token,
            refreshToken: token.refresh_token,
            expiresAt: Date.now() + token.expires_in * 1000,
          }),
          config.TOKEN_ENCRYPTION_KEY,
        ),
      );
      return token.access_token;
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(
        "UNKNOWN",
        "SoundCloud authorization is temporarily unavailable. Please try again.",
      );
    } finally {
      await redis.eval(
        "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0",
        1,
        `${key}:lock`,
        lock,
      );
    }
  };
}
