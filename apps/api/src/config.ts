import { z } from "zod";
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  API_URL: z.string().url().default("http://localhost:4000"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string(),
  REDIS_URL: z.string(),
  AUTH_SECRET: z.string().min(32),
  TOKEN_ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/i),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  YOUTUBE_API_KEY: z.string().optional(),
  SOUNDCLOUD_CLIENT_ID: z.string().optional(),
  SOUNDCLOUD_CLIENT_SECRET: z.string().optional(),
  DISCONNECT_GRACE_MS: z.coerce.number().min(0).default(15000),
  EMPTY_ROOM_GRACE_MS: z.coerce.number().min(0).default(15000),
  TRUST_PROXY: z.enum(["true", "false"]).default("false"),
});
export type Config = z.infer<typeof schema>;
export const readConfig = () => schema.parse(process.env);
