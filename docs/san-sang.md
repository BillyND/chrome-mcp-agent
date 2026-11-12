# Helmsman: sẵn sàng dùng trong 10 phút

Làm lần lượt 4 bước. Mỗi bước có cách kiểm tra "xong chưa".

---

## Bước 1: Cài extension (2 phút)

1. Mở https://chrome-mcp-agent.chrome-mcp-agent.workers.dev/ và bấm **Download extension**.
2. Giải nén file vừa tải.
3. Mở `chrome://extensions`, bật **Developer mode** ở góc phải trên.
4. Bấm **Load unpacked** và chọn thư mục vừa giải nén.
5. Bấm biểu tượng mảnh ghép trên thanh Chrome, rồi ghim **Helmsman**.

✅ **Xong khi:** thấy biểu tượng ô đen có con trỏ trắng trên thanh Chrome.

---

## Bước 2: Lấy mã kết nối (30 giây)

1. Bấm biểu tượng Helmsman, chọn **Connect** (Kết nối).
2. Copy **mã kết nối**, ví dụ `K7QX2-MN4PD`.

✅ **Xong khi:** popup hiện chấm xanh **Connected** và một mã kết nối.

---

## Bước 3: Thêm vào ChatGPT (3 phút)

1. Vào ChatGPT, mở **Settings → Apps & Connectors → Advanced** và bật **Developer mode**.
2. Bấm **Create**:
   - **Name:** `Helmsman`
   - **MCP URL:** `https://chrome-mcp-agent.chrome-mcp-agent.workers.dev/mcp`
   - **Authentication:** `OAuth`
3. Trang cho phép hiện ra: dán mã kết nối ở bước 2, bấm **Allow**.

✅ **Xong khi:** ChatGPT báo Helmsman đã kết nối.

> Dùng Claude Desktop, Cursor hay Claude Code? Bật **Local mode** trong popup, rồi copy đoạn cấu hình có sẵn ngay bên dưới công tắc vào client. Không cần mã kết nối.

---

## Bước 4: Thử 3 việc (5 phút)

Mở một cuộc chat mới, bật connector **Helmsman**, rồi gửi lần lượt từng câu:

1. **Đọc trang:**
   > Mở wikipedia.org, tìm "Việt Nam" và cho tôi biết dân số.
2. **Thao tác trên tài khoản của bạn:**
   > Mở tab Gmail của tôi, tóm tắt 5 email mới nhất. Không gửi hay xoá gì.
3. **Bảng tính:**
   > Mở Google Sheet [link của bạn], ghi "Xin chào" vào ô B2.

✅ **Xong khi:**
- con trỏ đen lướt trên trang và AI làm đúng việc,
- khi AI định **gửi / xoá / thanh toán**, trang hiện hộp xác nhận chờ bạn bấm.

---

## Khi có trục trặc

| Hiện tượng | Cách xử lý |
|---|---|
| ChatGPT báo "Chrome is not connected" | 1) Mở popup Helmsman: phải có chấm xanh **Connected**, nếu không thì bấm **Connect**. 2) So mã ChatGPT nhắc tới ("code ending in …") với mã trong popup. Khác nhau nghĩa là ChatGPT đang gắn với mã cũ (do cài lại hoặc ngắt kết nối extension): vào ChatGPT, xoá connector Helmsman rồi tạo lại và dán mã mới. |
| AI không làm gì | Kiểm tra công tắc **Allow AI control** trong popup đang bật. |
| Muốn dừng AI ngay | Bấm **Dừng** trên thanh nhỏ ở cuối trang. Nhắn tiếp là AI làm tiếp, không cần bật lại. |
| Một trang bị chặn | Popup → **Sites**: xoá dòng chặn của trang đó. |
| Dải vàng "đang gỡ lỗi trình duyệt" | Bình thường khi AI đang điều khiển. Tự ẩn sau 3 phút. |
| Muốn xem AI đã làm gì | Popup → **Audit log**. |

---

## Chia sẻ cho bạn bè

Gửi họ link trang chủ: https://chrome-mcp-agent.chrome-mcp-agent.workers.dev/

Mỗi người tự làm 4 bước trên. Mỗi người có mã riêng, chỉ điều khiển được Chrome của chính họ.

---

## (Tuỳ chọn) Đưa lên Chrome Web Store

Đưa lên Store thì có link cài một click và extension tự cập nhật.

1. Đăng ký developer tại https://chrome.google.com/webstore/devconsole (phí 5 USD, trả một lần).
2. Trong thư mục project, chạy lần lượt:
   ```
   node scripts/pack-extension.mjs
   npm run check:store
   ```
   Lệnh kiểm tra phải báo **Store package looks ready**.
3. Bấm **New item** và upload `extension/chrome-mcp-agent.zip`.
4. Điền nội dung theo `docs/store/listing.md`. Ảnh có sẵn trong `docs/store/screenshots/`. Chính sách quyền riêng tư: https://chrome-mcp-agent.chrome-mcp-agent.workers.dev/privacy
5. Chọn **Unlisted** nếu chỉ dùng cho nhóm bạn, rồi bấm **Submit for review**.
