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

## Nâng v1 lên v2

Dừng tiến trình trước khi sao lưu volume và thay image.
Khi mở database v1, ứng dụng tạo thêm các bảng thư viện trong một transaction, nâng `user_version`
lên 2 và giữ nguyên dữ liệu hỗ trợ hiện có. Database có phiên bản mới hơn 2 bị từ chối mở;
ứng dụng không tự hạ phiên bản. Database đã có tài khoản không bị chèn thêm hướng dẫn mẫu.

Nâng schema chỉ có chiều tiến. Để quay lại bản v1, phục hồi cả bản sao database v1 trước khi
chạy image cũ. Không dùng image v1 để mở database v2 đang sử dụng.

Sao lưu cả volume khi ứng dụng đã dừng, hoặc dùng SQLite backup API nếu sao lưu trực tiếp.
Không sao chép riêng một file database đang có tiến trình ghi trong chế độ WAL.
`docker compose down -v` xóa cả volume; chỉ dùng khi chủ động bỏ dữ liệu thử.

## Kiểm tra

`GET /api/health` kiểm tra truy vấn SQLite. Docker healthcheck gọi API này bằng Node, không cần curl.
GitHub Actions còn tạo tài khoản nhân viên trong container thử, lưu một bài, xuất bản bài,
khởi động lại container và đọc lại nội dung, trạng thái, lịch sử và phiên đăng nhập.
