# Resonance — implementation design

## Scope and boundaries
Next.js/React renders discovery, guest/Google sign-in, room management, queue, chat and visible official embeds. Fastify authenticates HTTP and Socket.IO connections. PostgreSQL stores Google identities and preferences; Redis is the sole authority for ephemeral rooms, sessions, access grants, rate limits and presence. No media bytes pass through the API. Provider credentials are required for real search; missing credentials produce an actionable error rather than invented results.

## Database
User: UUID, optional unique Google subject, display name, optional avatar, preferences JSON, timestamps. Google OAuth uses authorization code + PKCE and state through openid-client. Only identity metadata persists; Google tokens are discarded. Guest identities use signed opaque Redis sessions and expire. Website login grants no YouTube entitlement.

## Redis model and concurrency
`res:room:{id}` stores a bounded JSON room aggregate (members, connection leases, queue, chat, playback, ban list, password hash). `res:rooms` indexes IDs. Each update uses WATCH/MULTI on a dedicated connection with bounded retries: no lost updates between API instances and no lock expiry race. Expensive provider calls and Argon2 hashing happen outside transactions. A room revision orders full snapshots; playback has its own version. Clients reject stale revisions and serialize player effects. Redis adapter delivers Socket.IO broadcasts across replicas. Room state has a 24h sliding safety TTL; the sweeper removes abandoned state sooner.

`res:session:{opaqueToken}`: authenticated identity, seven-day expiry. `res:grant:{room}:{user}`: password-verified access with password epoch, one-day expiry. `res:limit:{bucket}:{identity}`: atomic counter + TTL. `res:provider:soundcloud`: AES-256-GCM encrypted OAuth token bundle, shared by replicas with a refresh lock. Public discovery projects only public rooms; private room access uses unguessable UUID URLs.

Connection leases refresh every 5s and expire after 20s, covering process crashes. Disconnect removes only that socket, then starts a 15s membership grace. Explicit leave removes all of that user's connections. On expiry, ownership moves to the oldest connected DJ, then listener; reconnection cancels removal. An empty room receives a 15s cleanup deadline. Compare-and-swap deletion removes the aggregate, index and access grants atomically. Cleanup workers may run on every replica safely.

## Protocol and authorization
HTTP: session, guest login, Google OAuth, public rooms, create room, private access, authenticated provider search, health. Same-origin mutation checks, HttpOnly SameSite cookies, strict origin allowlist, Redis rate limits and schema validation apply. Socket auth resolves identity from server session; client role/userId are never trusted. Commands use an acknowledgement `{ok, error?}`; server broadcasts `room:state` and `room:deleted`. One discriminated Zod command union covers playback, queue, chat, membership and room editing. Central permission tables gate every mutation. Queue entries resolve metadata on the server, so clients cannot forge URLs, durations or titles.

## Synchronization
The server stores status, base position, update timestamp and monotonically increasing playback version. Expected position is base plus elapsed server time only while playing, clamped to known duration. Clock probes measure RTT; the lowest-RTT sample estimates offset. Clients periodically compare their local provider position to the canonical extrapolated position (no HTTP state polling). Drift below 250ms is ignored; adapters without rate adjustment tolerate up to 1s, then seek with an 8s correction cooldown. Playback commands trigger immediate application. Large corrections suspend after repeated failures until explicit resync; ads and buffering must never trigger bypass attempts. Server timers advance finite tracks exactly once using CAS; unknown-duration/live tracks require manual skip. Reconnect obtains a fresh snapshot.

## Provider boundaries and restrictions
Metadata providers implement search/getTrack and capabilities; browser adapters implement load/play/pause/seek/time/state/volume/destroy. YouTube Data API supplies metadata and the visible IFrame API plays video. SoundCloud public search uses official API client-credentials OAuth, cached and refreshed server-side; its visible Widget API plays permitted tracks. Preview/blocked tracks are labelled and rejected from full-track sessions. Region/player failures stay local and never crash a room. No extracting, downloading, proxying audio, hidden players, ad blocking or background restriction workarounds. Each browser has its own ads, login and entitlement; host Premium does not transfer. Sub-500ms synchronization is a target under normal conditions, not a provider guarantee.

## Verification and operations
Unit coverage targets permission tables, canonical positions, queue operations, lifecycle, sanitization and provider normalization. Integration uses real Redis/PostgreSQL, HTTP and three Socket.IO clients, including private access, forged permissions, reconnect, multi-tab, cleanup and competing API replicas. Docker Compose supplies database, cache, API and web. Health checks test dependencies. Structured logs redact credentials. Production requires TLS, provider app registration, secret rotation, private Redis networking, backups for PostgreSQL, and provider-policy review before public launch.

## Official references checked
- https://developers.google.com/youtube/iframe_api_reference
- https://developers.google.com/youtube/terms/required-minimum-functionality
- https://developers.soundcloud.com/docs/api/guide
- https://developers.soundcloud.com/docs/api/html5-widget
