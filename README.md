# CampusDesk

<img src="public/favicon.svg" width="56" height="56" alt="CampusDesk" />

Ứng dụng tiếp nhận và xử lý yêu cầu hỗ trợ trong trường học.
Sinh viên gửi yêu cầu và theo dõi phản hồi; nhân viên dùng chung hàng đợi để phân công,
đổi trạng thái và ghi chú nội bộ.

Dự án dùng React, TypeScript, Express và SQLite. Dữ liệu mẫu là hư cấu.

## Chạy ở máy cá nhân

Cần Node.js 24 trở lên và npm.

```bash
npm ci
cp .env.example .env
npm run dev
```

Với PowerShell, dùng `Copy-Item .env.example .env` để sao chép cấu hình.
Mở http://127.0.0.1:5173. Backend chạy ở cổng 3001.

`APP_ORIGIN` phải trùng địa chỉ mở trên trình duyệt, gồm cả hostname và cổng.
Database mẫu chỉ được tạo khi database đang trống, không đặt lại sau mỗi lần khởi động.

| Vai trò | Email mẫu | Mật khẩu mẫu |
| --- | --- | --- |
| Sinh viên | student@campus.example.test | CampusDemo!2026 |
| Nhân viên | staff@campus.example.test | CampusDemo!2026 |

Các tài khoản này dùng để thử trên môi trường riêng.
Đăng ký thông thường chỉ tạo tài khoản sinh viên.

## Luồng xử lý

1. Sinh viên gửi yêu cầu với nhóm dịch vụ, mức ưu tiên và nội dung.
2. Nhân viên nhận việc, phân công và chuyển trạng thái:
   New → Triaged → In progress → Resolved → Closed.
3. Phản hồi công khai được gửi về cho sinh viên; ghi chú nội bộ chỉ nhân viên đọc được.
4. Nhân viên có thể mở lại yêu cầu đã đóng. Yêu cầu đang đóng không nhận thêm bình luận.

Danh sách có tìm kiếm, bộ lọc và phân trang. Thay đổi từ một bản dữ liệu cũ sẽ bị từ chối
bằng mã `409` để tránh ghi đè cập nhật của người khác.

## Kiểm tra và build

```bash
npm run check
npm run build
npm start
```

Để chạy bản build cục bộ, đặt `APP_ORIGIN=http://127.0.0.1:3001` trong `.env`.

Khi đưa lên host, dùng HTTPS, đặt `NODE_ENV=production`, `DEMO_SEED=0`,
`COOKIE_SECURE=1` và trỏ `DATABASE_PATH` đến ổ lưu trữ cố định.
Nếu host yêu cầu lắng nghe từ bên ngoài, đặt `HOST=0.0.0.0`.
Bản này dùng một tiến trình ứng dụng.

Sau khi build, tạo nhân viên đầu tiên bằng:

```bash
npm run create-staff
```

Lệnh hỏi tên, email và mật khẩu; không chuyển tài khoản sinh viên đã có thành nhân viên.

## Cấu trúc và dữ liệu

- `src/`: màn hình đăng nhập, danh sách yêu cầu và hộp thoại xử lý.
- `shared/types.ts`: loại yêu cầu, trạng thái và kiểu API.
- `server/app.ts`: route, kiểm tra quyền, CSRF và transaction.
- `server/database.ts`: lược đồ, chỉ mục và dữ liệu mẫu.
- `tests/`: kiểm thử quyền truy cập, ghi chú nội bộ, chuyển trạng thái và cập nhật đồng thời.

Quyền sinh viên và nhân viên được kiểm tra ở API.
Mật khẩu dùng scrypt; phiên đăng nhập dùng cookie HttpOnly.
API không trả nội dung hoặc số lượng ghi chú nội bộ cho sinh viên.

Ứng dụng chưa có gửi email, tệp đính kèm, SSO hoặc giao diện quản lý nhân viên.

## Hình ảnh

![Giao diện máy tính](docs/screenshots/desktop.jpg)

![Giao diện điện thoại](docs/screenshots/mobile.jpg)

## Giấy phép

Mã ứng dụng và logo dùng [MIT License](LICENSE). Các thư viện giữ giấy phép riêng.
