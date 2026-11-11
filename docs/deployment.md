# Triển khai và dữ liệu

## Bản thử cục bộ

`docker compose up --build -d` mở http://127.0.0.1:3001.
Cấu hình này bật `DEMO_SEED=1`, dùng HTTP trên loopback và volume `campusdesk-data`.
Các tài khoản và bài mẫu là hư cấu. Lệnh `docker compose down` dừng ứng dụng và giữ dữ liệu.

## HTTPS trên host

Docker image yêu cầu `APP_ORIGIN` là origin HTTPS chính xác, không thêm đường dẫn hoặc dấu `/` cuối.
Ví dụ cấu hình: `NODE_ENV=production`, `APP_ORIGIN=https://support.example.com`,
`HOST=0.0.0.0`, `PORT=3001`, `DEMO_SEED=0`, `DATABASE_PATH=/app/data/campusdesk.sqlite`.
Ứng dụng bắt buộc cookie Secure ở production, kể cả khi biến `COOKIE_SECURE` bị đặt nhầm thành 0.
Đặt reverse proxy HTTPS phía trước và giữ cổng backend trong mạng nội bộ.

Image chạy bằng user `node` (UID 1000). Volume tại `/app/data` cần ghi được bởi tài khoản này.
Mỗi database chạy với một tiến trình ứng dụng, chưa hỗ trợ nhiều replica dùng chung file SQLite.

Sau khi build, tạo nhân viên từ máy chủ bằng `npm run create-staff`.
Lệnh không đổi tài khoản sinh viên có sẵn thành nhân viên và không nhận vai trò từ API đăng ký.
Nếu chạy không tương tác, cấu hình `STAFF_NAME`, `STAFF_EMAIL`, `STAFF_PASSWORD` trên môi trường
tin cậy; không đưa mật khẩu vào mã nguồn hoặc tham số dòng lệnh.

`DEMO_SEED=0` chỉ tắt việc tạo dữ liệu mẫu, không xóa tài khoản mẫu đã tồn tại.
Nếu chuyển từ bản thử sang dữ liệu thật, dùng một database mới cho môi trường thật.

## Nâng schema lên v3

Dừng tiến trình trước khi sao lưu volume và thay image.
Khi mở database v1 hoặc v2, ứng dụng bổ sung các bảng còn thiếu trong một transaction và nâng
`user_version` lên 3. Bảng mới đánh dấu các tài khoản được tạo qua `DEMO_LOGIN_ENABLED=1`.
Ứng dụng giữ nguyên dữ liệu hỗ trợ, tài khoản và phiên đăng nhập thông thường. Database có phiên
bản mới hơn 3 bị từ chối mở. Database đã có tài khoản không bị chèn thêm hướng dẫn mẫu.

Để chạy lại image cũ, phục hồi bản sao database tương ứng trước khi nâng cấp. Nếu từng chạy
bản thử tài khoản cấu hình trước schema v3, hãy dùng database demo mới để khởi tạo lại. Phiên
bản thử chưa lưu dấu hiệu để phân biệt tài khoản đó với sinh viên đã đăng ký.

Sao lưu cả volume khi ứng dụng đã dừng, hoặc dùng SQLite backup API nếu sao lưu trực tiếp.
Không sao chép riêng một file database đang có tiến trình ghi trong chế độ WAL.
`docker compose down -v` xóa cả volume; chỉ dùng khi chủ động bỏ dữ liệu thử.

## Kiểm tra

`GET /api/health` kiểm tra truy vấn SQLite. Docker healthcheck gọi API này bằng Node, không cần curl.
GitHub Actions còn tạo tài khoản nhân viên trong container thử, lưu một bài, xuất bản bài,
khởi động lại container và đọc lại nội dung, trạng thái, lịch sử và phiên đăng nhập.
