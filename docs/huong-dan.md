# Helmsman

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
- Dải vàng *"Helmsman đang gỡ lỗi trình duyệt này"* là bình thường, tự ẩn sau 3 phút không dùng.
- Công tắc **Cho phép AI điều khiển** trong extension là nút dừng duy nhất: tắt thì AI dừng ngay (vẫn giữ kết nối), bật lại là tiếp tục. Nút **Dừng** / **Tiếp tục** trên thanh ở trang cũng bật tắt công tắc này, và trạng thái được nhớ kể cả khi Chrome khởi động lại extension.
- Extension và các trang web có nút chọn ngôn ngữ (EN/VI) và giao diện (sáng/tối/theo hệ thống). Mặc định là sáng, ngôn ngữ theo trình duyệt.
- AI vẽ và bấm được trên canvas (ví dụ Google Sheets, bảng vẽ) bằng `browser_mouse_xy`, và gõ thẳng vào ô đang chọn mà không cần chỉ định phần tử (`browser_type` không cần ref).
- Extension không điều khiển được các trang `chrome://` và Chrome Web Store, vì Chrome cấm.

## Quản trị

- **Deploy lại sau khi sửa code**: `npm run setup`. Script tự tạo KV, deploy, đặt secret và đóng gói extension, đồng thời cập nhật file zip trên trang chủ. Chạy lại nhiều lần vẫn an toàn.
- **Đặt mật khẩu nhóm** (để người lạ tải extension cũng không dùng được): `ACCESS_PASSWORD=matkhau npm run setup`. Mỗi người nhập mật khẩu này một lần khi bấm Kết nối.
- **Kiểm tra server thật**: `node scripts/pack-extension.mjs && node scripts/live-check.mjs`. Script chạy một Chromium có extension, kết nối như ChatGPT, rồi gõ và bấm trong iframe khác domain và iframe lồng thông qua Cloudflare.
- **Đăng lên Chrome Web Store** (tuỳ chọn, để có link cài một click và tự cập nhật): upload `extension/chrome-mcp-agent.zip` ở chế độ *Unlisted*. Phí developer 5 USD, trả một lần.

## Phát triển

```bash
npm run typecheck        # worker + extension
npm test                 # unit tests (token, mã kết nối, phím tắt, catalog tool)
npm run test:e2e         # Chromium thật + wrangler dev + gọi MCP như ChatGPT
npm run dev              # gateway local tại http://localhost:8787 (cần worker/.dev.vars)
node scripts/pack-extension.mjs --dev   # extension trỏ về localhost
```

`worker/.dev.vars` dùng cho local. Biến `DEV_MODE=1` mở route `/dev/token` và `/dev/mcp` để test, **không bao giờ** đặt biến này khi deploy.

Bộ e2e kiểm tra: click, gõ tiếng Việt, contenteditable, select và checkbox, closed shadow DOM, iframe cùng nguồn, iframe khác nguồn, iframe lồng 3 tầng, phím tắt, hộp thoại confirm, kéo thả HTML5, upload file, chạy JS trong iframe khác nguồn, cuộn, chờ chữ xuất hiện, screenshot, network log, back/forward, nút Dừng/Tiếp tục và tự nối lại, và luồng ChatGPT nhập mã kết nối → token → gọi tool → ngắt kết nối thì mất quyền.
