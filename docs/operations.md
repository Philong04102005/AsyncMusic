# Operations and acceptance

## Deployment

1. Set public HTTPS APP_URL, random AUTH_SECRET and 64-hex TOKEN_ENCRYPTION_KEY; configure registered provider credentials as secret environment variables.
2. Run migrations once per release before API starts (Compose migrate service). PostgreSQL holds durable identities; configure encrypted backups and perform a restore rehearsal.
3. Keep Redis inaccessible from the Internet. Use authentication/TLS for external managed Redis, `noeviction`, monitor memory and latency. AOF is enabled locally; loss of ephemeral rooms on unrecoverable Redis failure is acceptable, silent memory eviction of active sessions is not.
4. WebSocket gateway must forward Upgrade/Connection and retain connections >90s. API uses WebSocket-only Socket.IO. Configure trusted proxy addresses accurately; do not accept spoofed X-Forwarded-For.
5. Health `/health` returns 503 when PostgreSQL or Redis fails. Logs include room lifecycle, authorization failures and normalized provider errors. Logging intentionally omits raw request URLs/bodies to avoid OAuth callback codes and secrets. Send JSON logs to your monitoring service and alert on health failures/provider rate limits/Redis errors.
6. Deployments run as non-root Node users. Containers currently retain the workspace/toolchain to run TypeScript and Prisma migrations; reduce image size and isolate migration images for environments with stricter runtime requirements.

## Real-provider acceptance (requires operator credentials)

- On two independent browsers/devices: create public YouTube room, search, queue, start, join at 30s, seek to 2:10, pause, promote listener and control from DJ.
- Check blocked autoplay on a fresh mobile browser. Tap the official player if needed, then Resync. Ensure no player is hidden/covered and provider links remain visible.
- Repeat on SoundCloud with playable, preview, blocked and region-restricted tracks; verify metadata attribution and local error without room deletion.
- Test different advertising and subscription sessions. Do not mark synchronization successful solely because all clients received the same timestamp. Measure actual media positions, startup delay, p50/p95 drift, network jitter and correction counts. Current tests validate the protocol and algorithm, not an Internet playback SLA.
- Revoke provider credentials or exhaust sandbox quota; check meaningful UI messages and continued room/chat operation.
- Complete Google sign-in, deny consent, reuse expired callback, and verify minimal scope and no token leakage.

## Failure and scale tests before public release

- Run two or more API replicas; kill the owner-connected replica. Socket leases expire, reconnect restores role within grace, then ownership transfers if absent.
- Restart Redis/PostgreSQL and verify health changes, no unhandled rejection, and a useful reconnect path. Redis state writes fail closed; clients cannot mutate room state during an outage.
- Load-test room fanout and CAS contention. The MVP sends bounded full snapshots and scans an index each sweep. It is correct for modest loads but not benchmarked for large deployments. Introduce scheduled expiration sorted sets and event deltas if metrics justify it.
- Public guest rooms are social spaces, not a strong identity boundary. For abuse-sensitive deployments disable guest joins and add persistent moderation/audit features.
- Verify browser CSP, TLS headers and cookies through the real gateway. Production `unsafe-inline`/`unsafe-eval` currently accommodates Next hydration/development and SDK scripts; tighten with request nonces and separate development policies if deployment security requires it.
- Publish operator identity, support/contact, privacy notice and account deletion process. The in-app provider notice is a starting point, not a jurisdiction-specific policy.

## Implemented and deferred

Implemented: guest/Google website auth, provider abstractions, both official embed adapters, public search/metadata, realtime queue/permissions/chat/presence, encrypted SoundCloud application tokens, private room grants, lifecycle cleanup, CAS multi-instance state, Docker, schema/migration and automated tests.

No audio relay, downloads, ad manipulation or provider session sharing. No persistent playlists, previous-track history, voting, friends, mobile native client, private provider library authorization, Redis Cluster sharding, email login or managed cloud deployment. These are extension points rather than fake UI features.
