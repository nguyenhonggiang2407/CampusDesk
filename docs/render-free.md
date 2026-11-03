# CampusDesk trên Render Free

Cấu hình [render.yaml](../render.yaml) dành cho bản demo portfolio của Nguyễn Hồng Giang. Cấu hình đã được chuẩn bị; tài liệu này không xác nhận có dịch vụ hoặc URL đang hoạt động.

## Triển khai

Kết nối đúng repository `nguyenhonggiang2407/CampusDesk`, nhánh `main`, trong Render và tạo Blueprint từ `render.yaml`. Mỗi ứng dụng là một Web Service riêng, chọn **Free**, không thêm disk, database Render hoặc dịch vụ trả phí. Blueprint chờ CI thành công trước khi tự triển khai các commit tiếp theo.

Runtime Node.js 24.22.1. Build: `npm ci --include=dev && npm run build`. Start lấy `APP_ORIGIN` từ URL HTTPS thực tế mà Render cấp qua `RENDER_EXTERNAL_URL`, rồi chạy `npm start`. Không đặt URL ví dụ làm URL thật. Với domain riêng, đặt `APP_ORIGIN` thành đúng origin HTTPS của domain đó rồi redeploy. Không thêm đường dẫn hoặc dấu `/` cuối.

Ứng dụng bind `0.0.0.0` và đọc cổng `PORT` do Render cấp. Cookie phiên giữ Secure và HttpOnly. Health check: `/api/health`. Frontend build và API cùng một origin, không cần một static host riêng.

## Dữ liệu của bản miễn phí

SQLite đặt ở `/tmp/campusdesk.sqlite` trên filesystem tạm. **Tài khoản, phiên và dữ liệu thử có thể mất sau khi service ngủ, restart hoặc redeploy.** Đây không phải nơi lưu dữ liệu cá nhân lâu dài. Khi database bị thay, người thử mở lại bản demo hoặc tạo lại tài khoản; phiên cũ không khôi phục dữ liệu.

CampusDesk bật `DEMO_SEED=1` trên database demo mới. Dùng nút Student demo / Staff demo; đây là tài khoản hư cấu dùng chung, không nhập thông tin cá nhân. Seed không ghi đè database đã có tài khoản.

Để giữ dữ liệu lâu dài, cần chuyển sang database ngoài hoặc host có volume bền vững. Blueprint hiện tại không tự tạo tài nguyên trả phí và không upload database trên máy cá nhân.

Render Free có giờ chạy dùng chung theo workspace và ngủ khi không có truy cập. Không dùng công cụ ping để giữ cả năm dịch vụ thức. Kiểm tra Monthly Included Usage và không bật tính năng trả phí khi giữ ngân sách 0đ.

## Kiểm tra sau khi có URL

1. Mở URL HTTPS do Render trả về, kiểm tra trang chính và tải trực tiếp một đường dẫn trong ứng dụng.
2. Gọi `GET /api/health`, kiểm tra trả 200.
3. Dùng tài khoản/dữ liệu hư cấu, đăng nhập và lưu một thay đổi; tải lại trang và kiểm tra còn dữ liệu trong cùng lần chạy.
4. Kiểm tra cookie Secure/HttpOnly và việc từ chối thao tác ghi sai Origin/CSRF.
5. Restart bản demo, xác nhận người dùng được đưa về phiên mới khi database tạm không còn. Không coi việc mất dữ liệu lúc này là kiểm chứng lưu trữ bền vững.
6. Chỉ thêm link demo vào README và mục Website trên GitHub sau khi các bước trên thành công.

Tham khảo: [Render Free](https://render.com/docs/free), [biến môi trường mặc định](https://render.com/docs/environment-variables), [Blueprint](https://render.com/docs/blueprint-spec). Hướng dẫn lưu trữ lâu dài: [deployment.md](deployment.md).
