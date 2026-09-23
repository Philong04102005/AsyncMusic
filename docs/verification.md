# Verification record

Local verification on 2026-09-23 (Windows, Node 24, Docker Linux engine):

- `npm run build`: Next.js production compilation and strict TypeScript checks passed.
- `npm test`: 20 unit tests passed (permissions, queue, playback positions, lifecycle, Argon2id, encrypted tokens, provider normalization/failures, client clock/version handling and asynchronous YouTube cue readiness).
- `npm run test:integration`: 6 tests passed against real Redis and PostgreSQL, with two API instances and three listening clients.
- `npm run test:browser`: 2 Chromium browser scenarios passed, covering guest/create/join/private passwords/chat/roles/settings/leave and a 390px mobile viewport. Script-like chat remained text and browser page errors were absent in the checked flow.
- `npm audit`: zero reported vulnerabilities in the installed lockfile.
- Docker web/API image builds passed. Non-root containers started; web returned HTTP 200, API `/health` returned API/Redis/PostgreSQL `ok`. Temporary smoke containers were stopped afterward; development services remain separate.

Browser captures are generated under ignored `test-results/` when browser tests run. No demo rooms or fake tracks are seeded into the application.

## Live YouTube check after credentials were configured

- The configured server key returned HTTP 200 from the official YouTube Data API. After reloading the API process, application search returned 12 real tracks and server-side metadata resolution/queue insertion succeeded.
- A separate private diagnostic room played a real YouTube video through the visible official iframe. Browser media inspection showed advancing playback, `paused=false`, `readyState=4`, and no player error.
- Two isolated Chromium browser contexts joined a private room. The second joined during playback. Observed media positions were approximately 15.028s / 15.246s (217ms apart).
- Host seek to 130s moved both players; after three seconds their observed positions were 132.701s / 132.750s (49ms apart). Host pause stopped both at 133.101s.
- These are short, sequential samples on one local machine, not a cross-device/network drift SLA. Diagnostic rooms were closed afterward; the user's existing room was not changed.
- Browser error-state coverage now intercepts the search response inside the test only, so the regression suite also passes with a real key configured. Production does not use this fixture.

Not verified: real Google consent/login, SoundCloud credentials/live playback, real advertising/region behavior, cross-device media drift over the Internet, production load or a deployed TLS gateway. These require the acceptance steps in `operations.md`. Integration tests use an explicit metadata fixture; production never falls back to it.
