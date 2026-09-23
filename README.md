# Resonance

Ứng dụng nghe nhạc cùng phòng: Next.js + Fastify + Socket.IO + Redis + PostgreSQL. Mỗi trình duyệt dùng player chính thức; server **không tải, tách, chuyển mã hoặc proxy audio/video**.

## Chạy local

Yêu cầu Node.js 24 LTS, npm và Docker Engine/Compose đang chạy.

```sh
npm ci
cp .env.example .env
# Windows PowerShell: Copy-Item .env.example .env
```

Tạo **hai giá trị riêng** cho `AUTH_SECRET` và `TOKEN_ENCRYPTION_KEY` bằng lệnh dưới đây, rồi điền vào `.env` (không commit file này):

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
docker compose up -d postgres redis
npm run db:generate
npm run db:migrate
npm run dev
```

Mở **http://localhost:3000**. API: http://localhost:4000, health: http://localhost:4000/health. Guest, tạo/join phòng, mật khẩu, presence, quyền và chat chạy ngay. Search và queue cần provider credentials bên dưới; không có fake catalog hay media fallback. Không cần đăng nhập Google để dùng guest hoặc player công khai.

## Tính năng

- Phòng public/private, mật khẩu Argon2id, link UUID, danh sách public có tìm kiếm và bộ lọc.
- Guest với session cookie HttpOnly; Google OIDC dùng authorization code, PKCE, state và nonce.
- OWNER, DJ, LISTENER; quyền server-side tập trung, tùy chọn listener thêm bài.
- Queue thêm/xóa/sắp xếp/clear; Play Now; play/pause/seek/next theo trạng thái server.
- Player YouTube IFrame và SoundCloud Widget hiển thị đầy đủ, âm lượng riêng từng người, nút resync và bước tương tác trước khi tải player.
- Chat giới hạn 500 ký tự, rate limit và render dưới dạng text React.
- Presence nhiều tab theo một user, reconnect grace, lease cho trường hợp API crash, chuyển owner và xóa phòng rỗng.
- Redis CAS transactions chống mất cập nhật, Socket.IO Redis adapter, nhiều API replica; PostgreSQL lưu Google identity/preferences.
- Responsive desktop/mobile, keyboard controls, accessible dialog, trạng thái loading/empty/error.

## Cấu trúc

```text
apps/web             Next.js App Router, React, Tailwind, Radix dialog
apps/api             Fastify, HTTP/auth, Socket.IO, lifecycle, Redis store
packages/shared      Types, Zod schemas, permissions, canonical position
packages/providers   Official metadata/search providers
packages/database    Prisma schema, generated client, SQL migration
docs/architecture.md Thiết kế requirements/DB/Redis/protocol/sync trước scaffold
docs/protocol.md     HTTP, events, permissions, rate limits
deploy/nginx.conf    Same-origin HTTP + WebSocket gateway
tests                Unit, real-service integration, browser flows
```

UI primitives nằm trong source theo cách tiếp cận shadcn (Radix + Tailwind/CSS), không phụ thuộc bộ component được generate từ CLI. Prisma được cố định ở **7.10 stable**, không dùng dist-tag `latest` đang trỏ vào 8.0 RC khi triển khai. Lockfile khóa dependency. Overrides `deepmerge-ts` và `mysql2` loại bỏ advisory trong dependency của Prisma CLI; generate/migrate được kiểm tra với overrides.

## Google và YouTube

1. Tạo Google Cloud project, cấu hình OAuth consent screen.
2. Nếu muốn website login: tạo OAuth Web client, authorized redirect URI local là `http://localhost:3000/api/auth/google/callback`. Production dùng `https://your-domain/api/auth/google/callback`.
3. Điền `GOOGLE_CLIENT_ID` và `GOOGLE_CLIENT_SECRET`. Scope chỉ `openid profile`. Website lưu subject/name/avatar và bỏ Google tokens sau khi lấy identity.
4. Bật **YouTube Data API v3**, tạo server API key, điền `YOUTUBE_API_KEY`. Giới hạn key cho Data API và IP egress production nếu có thể; không đặt key vào biến `NEXT_PUBLIC_*`.
5. Khởi động lại API. Search dùng `search.list` và `videos.list`; server tự lấy metadata khi thêm bài, không tin title/duration/URL từ client. Cache search 120 giây giúp tiết kiệm quota.

**Google login không phải YouTube authorization**, và không chia sẻ YouTube Premium. Mỗi listener có ads/cookie/login riêng trong official embed. Player không bị che hoặc ẩn để biến thành audio-only. Header `Referrer-Policy: strict-origin-when-cross-origin` hỗ trợ yêu cầu nhận diện client của YouTube. Video không cho embed, bị xóa, giới hạn vùng hoặc lỗi provider hiển thị thông báo; phòng vẫn tồn tại.

Tài liệu: [YouTube IFrame API](https://developers.google.com/youtube/iframe_api_reference), [Data API](https://developers.google.com/youtube/v3/docs), [Required Minimum Functionality](https://developers.google.com/youtube/terms/required-minimum-functionality).

## SoundCloud

1. Đăng ký ứng dụng qua quy trình hiện hành của [SoundCloud Developers](https://developers.soundcloud.com/docs/api/register-app). Quyền API/điều kiện tài khoản do SoundCloud quyết định.
2. Điền `SOUNDCLOUD_CLIENT_ID`, `SOUNDCLOUD_CLIENT_SECRET`, và khóa 32 byte dạng hex `TOKEN_ENCRYPTION_KEY`.
3. Public search/metadata dùng OAuth **client credentials** tại `https://secure.soundcloud.com/oauth/token` (HTTP Basic), không yêu cầu quyền tài khoản của listener.
4. Token bundle được AES-256-GCM encrypt trong Redis, chia sẻ giữa API instances. Cache token, refresh bằng single-use refresh token và lock chống refresh song song. Không gửi access/refresh token hoặc client secret cho browser.
5. Search `/tracks` và metadata `/tracks/{urn}` qua API chính thức. Playback dùng visible [Widget API](https://developers.soundcloud.com/docs/api/html5-widget), không gọi stream URL qua backend. Tên tác giả và link SoundCloud hiển thị trong kết quả và player.

Chỉ track `playable` được thêm vào room; `preview`, `blocked` và `embeddable_by=none` bị từ chối với thông báo. Vùng/thiết bị vẫn có thể chặn một track mà metadata cho phép: lỗi chỉ ảnh hưởng player đó. Không có private-library/user-resource OAuth vì use case này không cần; thêm flow riêng khi mở rộng, không dùng website Google login thay thế.

Xem [SoundCloud API Guide](https://developers.soundcloud.com/docs/api/guide) để theo dõi token limits và thay đổi chính sách.

## Đồng bộ hoạt động thế nào

Server lưu `track`, `status`, `positionSeconds`, `stateUpdatedAt`, `version`. Nếu PLAYING:

```text
expected = basePosition + (estimatedServerNow - stateUpdatedAt) / 1000
```

Client dùng clock ping/RTT, chọn sample có RTT thấp nhất để ước lượng clock offset. Join/reconnect nhận full snapshot; playback commands đi qua server rồi broadcast. Full room snapshots có `revision`, playback có `version`, client bỏ packet cũ và serialize async player calls. Queue advance dựa trên duration được server xác nhận, không dựa vào callback ended của một listener.

Client kiểm tra local player mỗi 2 giây, **không polling playback state qua HTTP**. Drift dưới 250ms bỏ qua. Với adapter không hỗ trợ tốc độ phát mềm, drift 250–1000ms được dung sai; từ 1 giây seek với cooldown 8 giây. Sau ba lần correction không hiệu quả, tự động correction dừng đến khi có lệnh mới hoặc người dùng Resync. Buffering/autoplay được xử lý riêng, không cố bypass ads. Mất WebSocket sẽ pause player local và ngừng gửi controls.

**Dưới 500ms là mục tiêu, không phải SLA đã đo/đảm bảo.** Hai official SDK không cung cấp một clock media chung hoặc tín hiệu quảng cáo đáng tin cậy. Quảng cáo theo người, startup latency và network có thể làm lệch lớn hơn. Track live/không có duration dùng Next thủ công; phòng không suy đoán track đã kết thúc từ một client. Server lịch phát không chờ một listener đang xem quảng cáo.

## Presence và lưu trữ

Mỗi member có nhiều connection IDs, count chỉ theo user. Socket disconnect chờ 15 giây (configurable), reconnect giữ role. Lease 20 giây bảo vệ trường hợp API chết không có disconnect event. Owner rời sau grace → connected DJ cũ nhất → listener cũ nhất; nếu chỉ còn member đang trong grace thì giữ ownership ở member sớm nhất có ưu tiên DJ. Explicit leave áp dụng cho toàn bộ tab của user trong phòng.

Phòng không còn member chờ thêm 15 giây rồi bị xóa cùng queue/chat/presence/playback/hash/grants; biến mất khỏi discovery. TTL 24h là safety net cho room state, hoạt động sẽ gia hạn. Chat giữ 100 tin cuối, queue tối đa 100, phòng tối đa 100 member, user tối đa 8 tab/phòng. Redis single primary/managed failover được hỗ trợ; **Redis Cluster sharding chưa hỗ trợ** vì transaction dùng room/index/grant keys ở nhiều hash slot.

## Tests

```sh
npm run typecheck
npm test
# Redis/Postgres đang chạy và migration đã apply:
npm run test:integration
# Terminal khác đang chạy npm run dev; error-state test dùng response fixture riêng:
npx playwright install chromium
npx playwright test
npm run build
npm audit
```

Integration tests dùng Redis DB **15**, test-created rooms được dọn riêng (không FLUSHDB), API ports 4101/4102. Có thể thay `TEST_REDIS_URL`/`TEST_DATABASE_URL`. Provider fixture chỉ nằm trong test injection; test không giả vờ kiểm chứng media thật. Browser test kiểm chứng guest/create/private/chat/roles/settings, thông báo thiếu API key, và không overflow ở 390px.

Google consent flow, media playback với API keys thực, quảng cáo theo session, region errors và drift p95 qua Internet cần acceptance test với credentials hợp lệ. Xem [release checklist](docs/operations.md) trước khi public.

Kết quả kiểm tra YouTube thực tế và các phần chưa kiểm chứng được ghi trong [verification record](docs/verification.md). Sau khi thay credentials trong `.env`, khởi động lại API để nạp cấu hình mới.

## Docker và production

```sh
# Tạo .env và secrets trước. APP_URL là origin mà browser thật sự truy cập.
docker compose --profile app up --build -d
```

Gateway ở port 8080; đặt TLS reverse proxy phía trước cho production, ví dụ `https://music.example.com` → gateway. `APP_URL` phải là origin HTTPS đó, redirect URI OAuth cũng phải khớp. Production cookie luôn `Secure`: nếu chỉ truy cập HTTP `http://localhost:8080`, login có thể không hoạt động; **local development dùng `npm run dev`**. Image build không chứa `.env` hoặc provider secrets.

Đặt `POSTGRES_PASSWORD` và `DATABASE_URL` phù hợp. Redis/Postgres chỉ bind loopback trên host; trong production nên bỏ hẳn ports nếu không cần host access. Không expose API trực tiếp khi bật `TRUST_PROXY`. Nginx ghi đè X-Forwarded-For từ kết nối thật. Nếu thêm load balancer/TLS proxy, cấu hình trusted real-IP chain để rate limits nhận đúng IP; đừng tin header từ Internet tùy ý.

`docker compose --profile app up -d --scale api=3` dùng Redis adapter, WebSocket-only nên không cần sticky sessions. Khi scale/recreate, reload gateway để DNS upstream lấy replica mới: `docker compose --profile app exec gateway nginx -s reload`. CAS atomic bảo vệ room mutations; mỗi replica chạy sweeper idempotent. Chưa có benchmark tải hay Redis Cluster; scale cần đo capacity theo số phòng/members.

Trước public: TLS, secrets manager, credentials approved, DB backup/restore, dependency health alerting, provider policy review, thông tin operator/contact và quy trình xóa tài khoản. Không có claim rằng code đã được penetration test hoặc SLA production đã được xác thực.

## Mở rộng provider

Thêm implementation `MusicProvider` (search/getTrack/capabilities), `PlayerAdapter` (load/play/pause/seek/time/state/volume/destroy), đăng ký factory và provider enum/schema. Không sửa thuật toán room/sync theo tên provider. Capabilities điều khiển player seek; adapter tương lai có thể thêm correction bằng playback rate khi SDK cho phép. Không hard-code Spotify/Apple Music vì quyền subscription, SDK và policy của họ cần đánh giá riêng.
