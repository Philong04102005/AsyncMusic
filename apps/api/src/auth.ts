import { createHmac, randomBytes, randomUUID } from "node:crypto";
import * as oidc from "openid-client";
import { z } from "zod";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { Redis } from "ioredis";
import type { createDatabase } from "@resonance/database";
import { displayNameSchema, type User } from "@resonance/shared";
import type { Config } from "./config";
import { AppError } from "./domain";
import { rateLimit } from "./store";

export class Sessions {
  constructor(
    private redis: Redis,
    private config: Config,
  ) {}
  private key(token: string) {
    return `res:session:${createHmac("sha256", this.config.AUTH_SECRET).update(token).digest("hex")}`;
  }
  async read(token?: string): Promise<User | null> {
    if (!token || token.length > 128) return null;
    const value = await this.redis.get(this.key(token));
    return value ? (JSON.parse(value) as User) : null;
  }
  async require(request: FastifyRequest): Promise<User> {
    const user = await this.read(request.cookies.res_session);
    if (!user)
      throw new AppError(
        "UNAUTHORIZED",
        "Please join as a guest or sign in",
        401,
      );
    return user;
  }
  async issue(user: User, reply: FastifyReply, oldToken?: string) {
    if (oldToken) await this.remove(oldToken);
    const token = randomBytes(32).toString("hex");
    await this.redis.set(this.key(token), JSON.stringify(user), "EX", 604800);
    reply.setCookie("res_session", token, {
      httpOnly: true,
      secure: this.config.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 604800,
    });
  }
  async remove(token?: string) {
    if (token) await this.redis.del(this.key(token));
  }
}
export async function authRoutes(
  app: FastifyInstance,
  redis: Redis,
  db: ReturnType<typeof createDatabase>,
  config: Config,
  sessions: Sessions,
) {
  app.get("/api/session", async (request) => ({
    user: await sessions.read(request.cookies.res_session),
    googleEnabled: !!config.GOOGLE_CLIENT_ID,
  }));
  app.post("/api/auth/guest", async (request, reply) => {
    await rateLimit(redis, "guest", request.ip, 10, 60);
    const body = z
      .object({ displayName: displayNameSchema })
      .parse(request.body);
    const previous = await sessions.read(request.cookies.res_session);
    if (previous) return { user: previous };
    const user: User = {
      id: randomUUID(),
      displayName: body.displayName,
      guest: true,
    };
    await sessions.issue(user, reply);
    return { user };
  });
  app.post("/api/auth/logout", async (request, reply) => {
    await sessions.remove(request.cookies.res_session);
    reply.clearCookie("res_session", { path: "/" });
    return { ok: true };
  });
  let google: Promise<oidc.Configuration> | undefined;
  const getGoogle = () => {
    if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET)
      throw new AppError(
        "AUTH_DISABLED",
        "Google sign-in is not configured",
        503,
      );
    google ??= oidc
      .discovery(
        new URL("https://accounts.google.com"),
        config.GOOGLE_CLIENT_ID,
        config.GOOGLE_CLIENT_SECRET,
      )
      .catch((error) => {
        google = undefined;
        throw error;
      });
    return google;
  };
  app.get("/api/auth/google", async (request, reply) => {
    await rateLimit(redis, "oauth", request.ip, 10, 60);
    const client = await getGoogle();
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    await redis.set(
      `res:oauth:${state}`,
      JSON.stringify({ verifier, nonce }),
      "EX",
      600,
    );
    reply.setCookie("res_oauth", state, {
      httpOnly: true,
      secure: config.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/auth",
      maxAge: 600,
    });
    return reply.redirect(
      oidc.buildAuthorizationUrl(client, {
        redirect_uri: `${config.APP_URL}/api/auth/google/callback`,
        scope: "openid profile",
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
        code_challenge_method: "S256",
        state,
        nonce,
      }).href,
    );
  });
  app.get("/api/auth/google/callback", async (request, reply) => {
    await rateLimit(redis, "oauth", request.ip, 10, 60);
    const url = new URL(request.url, config.APP_URL);
    const state = url.searchParams.get("state");
    if (!state || state !== request.cookies.res_oauth)
      throw new AppError(
        "OAUTH_STATE",
        "Sign-in expired. Please try again.",
        403,
      );
    const raw = await redis.getdel(`res:oauth:${state}`);
    if (!raw) throw new AppError("OAUTH_STATE", "Sign-in expired", 403);
    const { verifier, nonce } = z
      .object({ verifier: z.string(), nonce: z.string() })
      .parse(JSON.parse(raw));
    const client = await getGoogle();
    const tokens = await oidc.authorizationCodeGrant(client, url, {
      pkceCodeVerifier: verifier,
      expectedState: state,
      expectedNonce: nonce,
    });
    const claims = tokens.claims();
    if (!claims?.sub)
      throw new AppError("OAUTH_FAILED", "Could not verify your identity", 403);
    const info = await oidc.fetchUserInfo(
      client,
      tokens.access_token,
      claims.sub,
    );
    const displayName =
      typeof info.name === "string" ? info.name.slice(0, 40) : "Music lover";
    const avatar =
      typeof info.picture === "string" && info.picture.startsWith("https://")
        ? info.picture
        : undefined;
    const user = await db.user.upsert({
      where: { googleSub: claims.sub },
      create: { googleSub: claims.sub, displayName, avatar },
      update: { displayName, avatar },
    });
    await sessions.issue(
      {
        id: user.id,
        displayName: user.displayName,
        avatar: user.avatar ?? undefined,
        guest: false,
      },
      reply,
      request.cookies.res_session,
    );
    reply.clearCookie("res_oauth", { path: "/api/auth" });
    return reply.redirect("/");
  });
}
