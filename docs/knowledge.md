# Knowledge library

## Vai trò và trạng thái

| Nội dung                  | Sinh viên                                          | Nhân viên                         |
| ------------------------- | -------------------------------------------------- | --------------------------------- |
| Bài đã xuất bản           | Tìm, đọc và xem gợi ý                              | Tìm, đọc, sửa và đổi trạng thái   |
| Bản nháp hoặc bài lưu trữ | Không có trong kết quả, truy cập trực tiếp trả 404 | Xem theo bộ lọc                   |
| Lịch sử biên tập          | API trả 403                                        | Xem 30 lần thay đổi gần nhất      |
| Tạo hoặc sửa bài          | API trả 403                                        | Cần phiên đăng nhập và CSRF token |

Bài mới luôn là `draft`. Nhân viên có thể chuyển `draft → published`, `published → draft`
hoặc lưu trữ bài. Bài `archived` cần được phục hồi về `draft` để kiểm tra trước khi xuất bản lại.
Lưu trữ không xóa nội dung. Lịch sử ghi người thực hiện, phiên bản, loại thay đổi và thời điểm;
đây là nhật ký hoạt động, không phải bản sao toàn bộ các phiên bản nội dung để hoàn tác.

## Tìm kiếm và gợi ý

Nội dung tìm kiếm được chuẩn hóa Unicode NFD, bỏ dấu kết hợp, đổi chữ thường và ánh xạ `đ` sang `d`.
Tìm trong thư viện dùng tối đa tám từ, mỗi từ phải xuất hiện trong tiêu đề, tóm tắt hoặc nội dung.
Các ký tự `%`, `_` và dấu gạch chéo ngược được xử lý như ký tự thường, không phải wildcard SQL.

Gợi ý trong biểu mẫu yêu cầu luôn giới hạn ở bài đã xuất bản và cùng nhóm dịch vụ.
Các từ phù hợp với tiêu đề được chấm cao hơn từ chỉ có trong nội dung; nếu không có từ phù hợp,
trả các bài gần đây trong nhóm. Tối đa ba gợi ý. Đổi nhóm hoặc tiêu đề sẽ hủy yêu cầu đọc cũ;
phản hồi cũ đến muộn không được đưa vào nhóm mới hoặc thay đổi phần sinh viên đang nhập.

Nội dung bài được React hiển thị dưới dạng văn bản thuần; chuỗi HTML là nội dung chữ.

## Ghi dữ liệu

Mỗi bài có `version`. Sửa nội dung và đổi trạng thái cần đúng phiên bản đang lưu.
Một cập nhật từ phiên bản cũ trả 409, giữ nguyên phần đang nhập ở trình duyệt.
**Compare current version** mở bản đang lưu để đối chiếu, không thay phần đang nhập.
Nút **Replace form with current version** mới thay nội dung biểu mẫu.

Tạo bản nháp cần `requestId` UUID. Mã gắn với tài khoản nhân viên và hash của nội dung đã chuẩn hóa.
Gửi lại cùng mã và nội dung trả đúng bài đã tạo; mã đã được dùng cho nội dung khác trả 409.
Mã tạo, bản nháp và nhật ký được ghi trong cùng transaction. Một lần ghi nhật ký thất bại sẽ
rollback thay đổi nội dung hoặc trạng thái. Cơ chế này còn hoạt động sau khi khởi động lại.

Thư viện tối đa 500 bài, gồm cả bài lưu trữ. Trang danh sách có 12 bài.
Giới hạn nội dung: tiêu đề 5–120 ký tự, tóm tắt 20–240 ký tự, phần thân 40–8.000 ký tự.

## API

| Phương thức và đường dẫn                               | Mục đích                                                         |
| ------------------------------------------------------ | ---------------------------------------------------------------- |
| `GET /api/guides?search=...&category=it&page=1`        | Danh sách theo quyền của người đọc                               |
| `GET /api/guides?state=draft`                          | Bộ lọc trạng thái dành cho nhân viên                             |
| `GET /api/guides/suggestions?category=it&search=Wi-Fi` | Gợi ý bài đã xuất bản                                            |
| `GET /api/guides/:id`                                  | Đọc bài, kiểm tra trạng thái ở API                               |
| `GET /api/guides/:id/history`                          | Nhật ký dành cho nhân viên                                       |
| `POST /api/guides`                                     | Tạo nháp với `title`, `summary`, `body`, `category`, `requestId` |
| `PATCH /api/guides/:id`                                | Sửa các trường nội dung cùng `version`                           |
| `POST /api/guides/:id/state`                           | Đổi `state` cùng `version`                                       |

Tạo mới trả 201; thử lại mã tạo thành công trả 200. API ghi cần JSON, cookie phiên và
`X-CSRF-Token`. Nếu có header Origin, nó phải khớp origin đã cấu hình.

## Cấu trúc mã

- `server/knowledge-store.ts`: truy vấn theo quyền, tìm kiếm, transaction và lịch sử.
- `server/knowledge-routes.ts`: xác thực vai trò, CSRF, kiểm tra input và giới hạn tạo bài.
- `shared/knowledge.ts`: kiểu dữ liệu và trạng thái dùng chung.
- `src/KnowledgeBase.tsx`: danh sách, bài đọc, biên tập, đối chiếu và gợi ý trong yêu cầu.
- `tests/knowledge-*.test.ts`: quyền, tìm kiếm, cạnh tranh cập nhật, rollback và nâng dữ liệu.
- `e2e/browser.mjs`: kiểm thử trên giao diện và trình duyệt thật.
