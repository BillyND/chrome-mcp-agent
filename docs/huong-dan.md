# Chrome MCP Agent

Cho ChatGPT (kể cả gói Free) điều khiển Chrome thật của bạn: đọc trang, bấm, gõ tiếng Việt, điền form, kéo thả, tải file lên, chụp màn hình. Làm được cả bên trong iframe khác domain, iframe lồng nhau và shadow DOM. Khi AI làm việc, trên trang hiện con trỏ tím và thanh có nút **Dừng**.

```
ChatGPT ──MCP + OAuth──► Cloudflare Worker (/mcp) ──► Durable Object của từng người ──WebSocket──► Extension trong Chrome
```

- **Gateway** (`worker/`): Cloudflare Workers + Durable Objects, gói Free. OAuth 2.1 cho ChatGPT, đăng nhập Google và danh sách email được phép. Mỗi người có một Durable Object giữ WebSocket bằng Hibernation API, ping 20 giây/lần được runtime tự trả lời nên kết nối luôn ấm mà không tốn hạn mức.
- **Extension** (`extension/`): Manifest V3. Thao tác bằng Chrome DevTools Protocol nên trang nhận sự kiện "thật". Content script chạy trong mọi frame. Mỗi iframe tự định vị qua `postMessage` nên toạ độ đúng cả khi khác domain.
- **Tool**: 20 tool đặt tên theo kiểu Playwright MCP (`browser_snapshot`, `browser_click`, `browser_type`, `browser_fill_form`, …). Danh sách đầy đủ ở `shared/tools.ts`.

## Cài đặt cho chủ hệ thống (làm một lần)

1. **Đăng nhập Cloudflare**: `npx wrangler login`.
2. **Tạo Google OAuth client** tại https://console.cloud.google.com/apis/credentials:
   - *OAuth consent screen*: chọn External, điền tên app, chỉ xin quyền `openid`, `email`, `profile`. Để ở chế độ **Testing**, thêm email của những người được dùng vào *Test users*.
   - *Create credentials → OAuth client ID → Web application*. Ở mục *Authorized redirect URIs* thêm `https://chrome-mcp-agent.<tên-tài-khoản>.workers.dev/callback`. Script setup sẽ in ra đúng địa chỉ này.
3. **Deploy**:
   ```bash
   npm install
   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... ALLOWED_EMAILS=ban@gmail.com,ban2@gmail.com npm run setup
   ```
   Script sẽ tạo KV, deploy Worker, chốt URL, đặt secret và đóng gói extension vào `extension/chrome-mcp-agent.zip`. Chạy lại bao nhiêu lần cũng an toàn.
4. **Phát hành extension**: upload file zip lên Chrome Web Store ở chế độ *Unlisted* (phí developer 5 USD, trả một lần), rồi gửi link cho mọi người. Muốn hoàn toàn free thì dùng *Load unpacked* với thư mục `extension/unpacked`. Sau khi có ID extension trên Store, có thể khoá chặt bằng cách đặt `EXTENSION_IDS` trong `worker/wrangler.jsonc` rồi `npm run deploy`.

**Thêm hoặc bớt người dùng**: sửa `ALLOWED_EMAILS` trong `worker/wrangler.jsonc` rồi chạy `npm run deploy`. Người bị xoá sẽ mất kết nối ngay ở lần nối lại tiếp theo. Với Google OAuth client đang ở chế độ Testing, nhớ thêm cả email đó vào *Test users*.

## Hướng dẫn cho người dùng

1. Cài extension **Chrome MCP Agent** rồi ghim biểu tượng lên thanh công cụ.
2. Bấm biểu tượng → **Đăng nhập bằng Google**. Thấy chấm xanh **Đã kết nối** là xong.
3. Trong ChatGPT: **Cài đặt → Apps & Connectors → Advanced**, bật **Developer mode** → **Create**. Dán địa chỉ MCP (bấm "Kết nối với ChatGPT" trong extension để copy), chọn **OAuth**, rồi đăng nhập Google cùng tài khoản.
4. Bật connector trong cuộc chat và nhờ ChatGPT, ví dụ: *"Mở tab Gmail của tôi, tóm tắt 5 email mới nhất"*.

Ghi chú:
- Dải vàng *"Chrome MCP Agent đang gỡ lỗi trình duyệt này"* là bình thường. Nó tự ẩn sau 3 phút không dùng.
- Bấm **Dừng** trên trang hoặc trong extension thì AI dừng ngay. Mọi lệnh sau đó bị từ chối cho tới khi bạn bấm **Tiếp tục**.
- Mỗi tài khoản chỉ kết nối từ một Chrome tại một thời điểm. Nếu mở ở máy khác, extension sẽ hiện nút **Dùng Chrome này** để chuyển về.
- Extension không điều khiển được các trang `chrome://` và Chrome Web Store, vì Chrome cấm.

## Phát triển

```bash
npm run typecheck        # worker + extension
npm test                 # unit tests (token, allowlist, phím tắt, catalog tool)
npm run test:e2e         # Chromium thật + wrangler dev + gọi MCP như ChatGPT
npm run dev              # gateway local tại http://localhost:8787 (cần worker/.dev.vars)
node scripts/pack-extension.mjs --dev   # extension trỏ về localhost
```

`worker/.dev.vars` dùng cho local. Biến `DEV_MODE=1` mở route `/dev/token` và `/dev/mcp` để test, **không bao giờ** đặt biến này khi deploy.

Bộ e2e kiểm tra: click, gõ tiếng Việt, contenteditable, select và checkbox, closed shadow DOM, iframe cùng nguồn, iframe khác nguồn, iframe lồng 3 tầng, phím tắt, hộp thoại confirm, kéo thả HTML5, upload file, chạy JS trong iframe khác nguồn, cuộn, chờ chữ xuất hiện, screenshot, network log, back/forward, nút Dừng/Tiếp tục và tự nối lại.
