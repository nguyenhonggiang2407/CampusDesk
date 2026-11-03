# Kiểm tra portfolio — 03/11/2026

Môi trường local: Windows, Node.js 24.19.0, npm 11.17.0.

| Kiểm tra                              | Kết quả                                                                                                                                   |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci --ignore-scripts`             | Cài đặt theo lockfile thành công.                                                                                                         |
| `npm run check` sau cập nhật lockfile | 28 kiểm thử đạt; TypeScript và Vite build thành công.                                                                                     |
| `npm run format:check`                | Đạt. `.gitattributes` giữ LF cho file văn bản khi checkout trên Windows.                                                                  |
| `npm audit`                           | Không còn advisory được npm báo tại thời điểm kiểm tra, sau cập nhật tương thích semver. Đây không phải chứng nhận an toàn toàn ứng dụng. |
| HTTPS demo                            | Trang chính, `/api/health`, favicon, JS và CSS trả HTTP 200; title đúng CampusDesk. Health trả `{"status":"ok"}`.                         |
| Browser suite local                   | Chưa chạy được: Playwright yêu cầu Chromium 1248 chưa có trong môi trường; không tính bảy test là đạt.                                    |
| Docker local                          | Chưa chạy vì Docker không được cài trong môi trường này.                                                                                  |

Các ảnh có sẵn được giữ nguyên, đã kiểm tra trực quan ảnh desktop và knowledge
library mobile. Không tạo ảnh minh họa thay screenshot. Bản demo được kiểm tra
HTTP là bản triển khai trước commit tài liệu này; cần xem GitHub Actions và Render
cho trạng thái build/deploy của commit mới.

Lockfile cập nhật trong các khoảng phiên bản đã khai báo để xử lý advisory của
body-parser, qs, shell-quote/concurrently, Vite và Zod. Không đổi API, schema hoặc
luồng nghiệp vụ của ứng dụng.
