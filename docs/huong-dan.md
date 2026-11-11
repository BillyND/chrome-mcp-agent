# Chrome MCP Agent

Cho ChatGPT (kể cả gói Free) điều khiển Chrome thật của bạn: đọc trang, bấm, gõ tiếng Việt, điền form, kéo thả, tải file lên, chụp màn hình. Làm được cả bên trong iframe khác domain, iframe lồng nhau và shadow DOM. Khi AI làm việc, trên trang hiện con trỏ và thanh có nút **Dừng**.

```
ChatGPT ──MCP + OAuth──► Cloudflare Worker (/mcp) ──► Durable Object của từng người ──WebSocket──► Extension trong Chrome
```

- **Gateway** (`worker/`): Cloudflare Workers + Durable Objects, gói Free. OAuth 2.1 cho ChatGPT, nối với đúng Chrome bằng mã kết nối. Mỗi Chrome có một Durable Object giữ WebSocket bằng Hibernation API. Ping 20 giây/lần được runtime tự trả lời, nên kết nối luôn ấm mà không tốn hạn mức. Lệnh chỉ-đọc tự gửi lại nếu Chrome nối lại giữa chừng.
- **Extension** (`extension/`): Manifest V3. Thao tác bằng Chrome DevTools Protocol nên trang nhận sự kiện "thật". Content script chạy trong mọi frame. Mỗi iframe tự định vị qua `postMessage` nên toạ độ đúng cả khi khác domain.
- **Tool**: 20 tool đặt tên theo kiểu Playwright MCP (`browser_snapshot`, `browser_click`, `browser_type`, `browser_fill_form`, …). Danh sách đầy đủ ở `shared/tools.ts`.

## Đang chạy

- Trang chủ (có nút tải extension): https://chrome-mcp-agent.chrome-mcp-agent.workers.dev/
- Địa chỉ MCP cho ChatGPT: `https://chrome-mcp-agent.chrome-mcp-agent.workers.dev/mcp`

## Hướng dẫn cho người dùng

1. Vào trang chủ, bấm **Tải extension (.zip)** rồi giải nén. Mở `chrome://extensions`, bật **Developer mode**, bấm **Load unpacked**, chọn thư mục vừa giải nén. Ghim biểu tượng con trỏ lên thanh công cụ.
2. Bấm biểu tượng, chọn **Kết nối Chrome này**. Extension hiện **mã kết nối** (ví dụ `K7QX2-MN4PD`) và chấm xanh **Đã kết nối**.
3. Trong ChatGPT: **Cài đặt → Apps & Connectors → Advanced**, bật **Developer mode**, rồi bấm **Create**. Dán địa chỉ MCP, chọn **OAuth**. Khi trang cho phép hiện ra, dán mã kết nối và bấm **Cho phép**.
4. Bật connector trong cuộc chat rồi nhờ ChatGPT, ví dụ: *"Mở tab Gmail của tôi, tóm tắt 5 email mới nhất"*.

Ghi chú:
- Không cần tài khoản Google hay đăng nhập gì cả. Mỗi mã kết nối chỉ điều khiển được đúng một Chrome. Đừng chia sẻ mã cho người khác.
- Bấm **Ngắt kết nối Chrome này** trong extension sẽ huỷ mã. Mọi ChatGPT đã kết nối bằng mã đó lập tức mất quyền.
- Dải vàng *"Chrome MCP Agent đang gỡ lỗi trình duyệt này"* là bình thường, tự ẩn sau 3 phút không dùng.
- Công tắc **Cho phép AI điều khiển** trong extension là nút dừng duy nhất: tắt thì AI dừng ngay (vẫn giữ kết nối), bật lại là tiếp tục. Nút **Dừng** / **Tiếp tục** trên thanh ở trang cũng bật tắt công tắc này, và trạng thái được nhớ kể cả khi Chrome khởi động lại extension.
- Extension và các trang web có nút chọn ngôn ngữ (EN/VI) và giao diện (sáng/tối/theo hệ thống). Mặc định là sáng, ngôn ngữ theo trình duyệt.
- AI vẽ và bấm được trên canvas (ví dụ Google Sheets, bảng vẽ) bằng `browser_mouse_xy`, và gõ thẳng vào ô đang chọn mà không cần chỉ định phần tử (`browser_type` không cần ref).
- Extension không điều khiển được các trang `chrome://` và Chrome Web Store, vì Chrome cấm.

## Chế độ cục bộ (Local mode)

Dùng khi AI chạy ngay trên máy bạn (Claude Desktop, Claude Code, Cursor, VS Code, Codex CLI…). Không cần Cloudflare, tài khoản hay mã kết nối: client MCP chạy một server nhỏ trên máy qua **stdio**, extension nối tới server đó bằng WebSocket tại `127.0.0.1`. Chế độ này chạy song song với chế độ cloud, bật cái nào dùng cái đó.

```
Claude Desktop / Cursor / Claude Code ──stdio MCP──► helmsman-mcp (Node) ──WebSocket 127.0.0.1:47821──► Extension trong Chrome
```

**Bật chế độ cục bộ**

1. Cài extension như bình thường (không cần bấm **Kết nối**).
2. Mở popup, bật công tắc **Chế độ cục bộ**. Chấm trạng thái hiện *Đang chờ server cục bộ* cho tới khi client MCP chạy server.
3. Thêm server vào client AI (xem bên dưới). Khi client khởi động server, chấm chuyển sang *Đã kết nối*.

**Lấy server.** `npm run build:local` tạo file duy nhất `local/helmsman-mcp.mjs` (cần Node 20+, file đã commit sẵn trong repo). Có thể chạy trực tiếp bằng `node /đường/dẫn/helmsman-mcp.mjs`. Gói `local/` có sẵn `package.json` với `bin`, nên sau khi `npm publish` trong thư mục `local/` thì dùng được `npx -y helmsman-mcp`. Dưới đây dùng `npx`; chưa publish thì thay bằng `"command": "node", "args": ["/đường/dẫn/tuyệt/đối/local/helmsman-mcp.mjs"]`.

**Cấu hình client**

Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json` trên macOS, `%APPDATA%\Claude\claude_desktop_config.json` trên Windows), Cursor (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "helmsman": { "command": "npx", "args": ["-y", "helmsman-mcp"] }
  }
}
```

Claude Code:

```bash
claude mcp add helmsman -- npx -y helmsman-mcp
```

VS Code (`.vscode/mcp.json`):

```json
{ "servers": { "helmsman": { "type": "stdio", "command": "npx", "args": ["-y", "helmsman-mcp"] } } }
```

Codex CLI (`~/.codex/config.toml`):

```toml
[mcp_servers.helmsman]
command = "npx"
args = ["-y", "helmsman-mcp"]
```

**Nhiều client cùng lúc.** Chỉ một tiến trình giữ được cổng. Tiến trình đầu tiên mở server WebSocket và nhận kết nối từ extension; các tiến trình sau thấy cổng đã bận thì tự nối vào tiến trình đầu như một "peer" (đường `/peer`) và gửi lệnh qua đó, nên nhiều client AI dùng chung một Chrome cùng lúc. Nếu tiến trình đầu thoát, một tiến trình còn lại tự giữ cổng và extension tự nối lại sau vài giây (lệnh đang chờ được giữ tối đa 20 giây).

**Biến môi trường** (đặt trong `env` của cấu hình client):

- `HELMSMAN_PORT`: đổi cổng (mặc định `47821`). Extension bản build sẵn dùng cổng mặc định; muốn đổi cổng phải đóng gói lại extension với cùng biến: `HELMSMAN_PORT=47900 node scripts/pack-extension.mjs`.
- `HELMSMAN_EXTENSION_ID`: chỉ nhận kết nối từ đúng extension có id này (mặc định nhận mọi origin `chrome-extension://`).

**Bảo mật và đánh đổi.** Server chỉ lắng nghe `127.0.0.1`, kiểm tra header `Host` (chặn DNS rebinding) và từ chối mọi WebSocket có `Origin` không phải `chrome-extension://…`, nên trang web không nối vào được. Không dùng token: bất kỳ extension Chrome nào khác trên máy cũng có origin `chrome-extension://` và có thể kết nối nếu giành được cổng trước extension này; tiến trình khác trên máy cũng gọi được qua `/peer`. Chấp nhận được với máy cá nhân; nếu cần chặt hơn, đặt `HELMSMAN_EXTENSION_ID`. Công tắc **Cho phép AI điều khiển** áp dụng cho cả hai chế độ. Lệnh gọi mang tên `local:<tên client>` (ví dụ `local:claude-code`) để phân biệt các agent.

## Quản trị

- **Deploy lại sau khi sửa code**: `npm run setup`. Script tự tạo KV, deploy, đặt secret và đóng gói extension, đồng thời cập nhật file zip trên trang chủ. Chạy lại nhiều lần vẫn an toàn.
- **Đặt mật khẩu nhóm** (để người lạ tải extension cũng không dùng được): `ACCESS_PASSWORD=matkhau npm run setup`. Mỗi người nhập mật khẩu này một lần khi bấm Kết nối.
- **Kiểm tra server thật**: `node scripts/pack-extension.mjs && node scripts/live-check.mjs`. Script chạy một Chromium có extension, kết nối như ChatGPT, rồi gõ và bấm trong iframe khác domain và iframe lồng thông qua Cloudflare.
- **Đăng lên Chrome Web Store** (tuỳ chọn, để có link cài một click và tự cập nhật): upload `extension/chrome-mcp-agent.zip` ở chế độ *Unlisted*. Phí developer 5 USD, trả một lần.

## Phát triển

```bash
npm run typecheck        # worker + extension + local
npm test                 # unit tests (token, mã kết nối, phím tắt, catalog tool, relay)
npm run build:local      # đóng gói server cục bộ thành local/helmsman-mcp.mjs
npm run test:e2e         # Chromium thật + wrangler dev + gọi MCP như ChatGPT
npm run dev              # gateway local tại http://localhost:8787 (cần worker/.dev.vars)
node scripts/pack-extension.mjs --dev   # extension trỏ về localhost
```

`worker/.dev.vars` dùng cho local. Biến `DEV_MODE=1` mở route `/dev/token` và `/dev/mcp` để test, **không bao giờ** đặt biến này khi deploy.

Chạy e2e trên cổng riêng: `E2E_PORT=8795 E2E_FIXTURE_PORT=4300 HELMSMAN_PORT=47895` (build extension và server cục bộ trước bằng `E2E_PORT=8795 HELMSMAN_PORT=47895 node scripts/pack-extension.mjs --dev && npm run build:local`). `tests/local-mode.e2e.ts` chạy server cục bộ như một client MCP thật qua stdio, thử hai client cùng lúc, cloud + local cùng lúc và khởi động lại server.

Bộ e2e kiểm tra: click, gõ tiếng Việt, contenteditable, select và checkbox, closed shadow DOM, iframe cùng nguồn, iframe khác nguồn, iframe lồng 3 tầng, phím tắt, hộp thoại confirm, kéo thả HTML5, upload file, chạy JS trong iframe khác nguồn, cuộn, chờ chữ xuất hiện, screenshot, network log, back/forward, nút Dừng/Tiếp tục và tự nối lại, và luồng ChatGPT nhập mã kết nối → token → gọi tool → ngắt kết nối thì mất quyền.
