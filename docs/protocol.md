# HTTP and WebSocket contract

All mutations require exact configured Origin. Session cookie `res_session` is HttpOnly, SameSite=Lax, Secure in production; opaque random tokens are HMAC-indexed in Redis. Never send roles or user IDs as authorization. Socket connections require the same cookie and origin. Server validates every incoming event with Zod (clock has no data payload).

## HTTP

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/session` | Current identity and Google-login availability |
| POST | `/api/auth/guest` | `{displayName}` → guest session |
| POST | `/api/auth/logout` | Revoke current session |
| GET | `/api/auth/google` | Start OIDC code + PKCE |
| GET | `/api/auth/google/callback` | Validate state/nonce; upsert identity |
| GET | `/api/rooms` | Public projections only, no private metadata |
| POST | `/api/rooms` | Create room (name, visibility, provider, password?, listener add, guests) |
| POST | `/api/rooms/:id/access` | Verify password and issue user/room/epoch grant |
| GET | `/api/providers/:provider/search?q=...&roomId=...` | Member-only cached official search |
| GET | `/health` | API, Redis PING, PostgreSQL SELECT 1; 503 on dependency failure |

## Socket.IO

WebSocket transport only, 16 KiB maximum packet. `room:join {roomId}` returns `Ack<RoomSnapshot>`. `room:command {roomId, command}` accepts one discriminated command defined in `packages/shared/src/index.ts`. Each acknowledgement is `{ok:true,data}` or `{ok:false,error,code}`. Invalid/missing ack callbacks are safely ignored. No automatic command retries: after a timeout the UI warns the user to check the room before retrying, avoiding duplicate queue entries.

Commands: `player:play`, `player:pause`, `player:seek {position}`, `player:next`; `queue:add {trackId,playNow}`, `queue:remove {itemId}`, `queue:move {itemId,toIndex}`, `queue:clear`; `chat:send {content}`; `member:kick/promote/demote {userId}`; `room:transfer {userId}`, `room:edit {name,visibility,provider,password?,allowGuests,allowListenersToAddTracks}`, `room:leave`, `room:delete`.

Server events: `room:state` (full bounded projection), `room:deleted`, `room:kicked` (also sent to all tabs on explicit leave), `room:ownerChanged`. Full snapshots deliberately replace separate queue/presence/chat deltas for MVP correctness and reconnect simplicity. Larger deployments should introduce deltas and retain full snapshots for recovery. `clock:ping` ack is server Unix milliseconds. Browser probes on connection and every 10s; no polling of playback state.

Every snapshot increments room revision; each media transition increments playback version independently. Snapshots never contain password hashes, bans, connection IDs, tokens or grants. A caller must still be an authenticated connected room member at commit time. Metadata resolution and expensive hashing happen before the CAS transaction; permissions/provider compatibility are checked again inside it.

## Permissions

| Action | Owner | DJ | Listener |
|---|---|---|---|
| Playback control | Yes | Yes | No |
| Queue add | Yes | Yes | Room setting |
| Queue remove/reorder/clear | Yes | Yes | No |
| Play Now | Yes | Yes | No |
| Chat, view members/queue | Yes | Yes | Yes |
| Edit room/password/provider | Yes | No | No |
| Kick/promote/demote/transfer/delete | Yes | No | No |

Owner cannot be kicked/demoted via member commands. Transfer requires another connected member. Provider switching requires empty queue and no current track. Changing the password invalidates old grants for later joins; already admitted members continue listening. Kicks ban the user identity for the lifetime of the room, not their IP/device; a public guest can create a new identity, so guest access is not an abuse-resistant account ban.

## Redis rate-limit buckets

| Bucket | Bound |
|---|---|
| HTTP per IP | 240/min |
| Guest creation | 10/min/IP |
| OAuth | 10/min/IP |
| Create room | 5/5min/user |
| Socket handshake | 30/min/user |
| Room join | 20/min/user |
| Password | 15/5min/IP and 5/min/IP+room |
| Search | 20/min/user and 40/min/IP |
| Chat | 6/10s/user |
| Queue | 15/10s/user |
| Playback/admin | 30/10s/user/category |
| Clock | 60/min/user |

Atomic INCR+EXPIRE Lua works across replicas. Reverse-proxy IP trust must be configured correctly. Additional global provider quotas and load-shedding should be tuned to actual approved API budgets before public rollout.
