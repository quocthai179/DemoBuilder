# Agent `guide-writer` — Requirements MVP (mức A + PDF)

> Trạng thái: FINAL cho MVP, chờ người dùng duyệt trước khi chuyển sang architect/developer.
> Nguồn: `.squad/requirements/user-guide-agent-discovery.md`, mục 8 "Quyết định của người dùng" (2026-11-25) là ràng buộc. Tham chiếu hiện trạng: `plugins/demo-builder/skills/demo-toolkit/references/spec-reference.md`.
> Tài liệu viết bằng tiếng Việt; định danh kỹ thuật giữ tiếng Anh. Các mã `D1`, `A1`, ... là mã câu hỏi trong discovery doc.

## 1. Mục tiêu, người đọc, phạm vi

### 1.1 Tóm tắt
Thêm agent `guide-writer`, lệnh `/demo-builder:guide <slug> [refresh]` và `lib/guide.mjs`. Từ flow `demo.yaml` đã được flow-engineer kiểm chứng (cộng `guide.yaml` tuỳ chọn), hệ thống chạy lại flow bằng Playwright và sinh user guide từng bước có ảnh UI: `guide.md` + `images/` + `guide.pdf`. Giá trị: có help doc từ flow có sẵn mà không phải khám phá UI lần hai; mask/hide, brand và selector dùng chung với video.

### 1.2 Người đọc (quyết định A1)
- End user của sản phẩm (người đọc chính).
- Khách hàng mới đang onboarding.
- Support / nội bộ (dùng guide để trả lời ticket, training).

### 1.3 Trong phạm vi MVP (mức A + PDF)
- Đầu vào `demo.yaml` + `guide.yaml` tuỳ chọn.
- Ảnh toàn màn hình có chú thích + ảnh cận cảnh.
- Guide Markdown + PDF, văn bản tiếng Anh.
- `guide refresh` (chụp lại ảnh, giữ chữ sửa tay).
- Checkpoint duyệt preview của người dùng.
- Lệnh `/demo-builder:guide`, nhánh guide trong `demo-director`.

### 1.4 Ngoài phạm vi (hoãn, KHÔNG làm trong MVP)
- Đa ngôn ngữ / dịch guide / dùng localizer cho guide.
- Đẩy lên Confluence, Notion, Zendesk, Intercom hoặc nền tảng khác.
- Visual diff, phát hiện ảnh lỗi thời (staleness), `guide status`.
- CI hook / chạy tự động khi deploy.
- Mở rộng `demo-qa` sang chế độ guide.
- "Tự làm theo guide" để kiểm thử (self-follow testing).
- GIF / ảnh động theo bước, nhúng video.
- Dark mode, nhiều viewport (mobile), ảnh 2x.
- Xuất DOCX; HTML site; OCR quét PII; versioning guide; FAQ/Troubleshooting; tự khám phá app.

## 2. Hiện trạng liên quan (đã đối chiếu spec-reference)
- `demo.yaml` có `scenes[]` với `type: screen|card`, `actions[]`; action thật: `goto, click, dblclick, hover, type, fill, press, select, check, uncheck, upload, scroll, wait, waitFor, waitForUrl, highlight, spotlight, callout, clear, zoom, unzoom, moveTo, at, caption, screenshot, evaluate, reload`.
- Top-level đã có `language`, `locale` (mặc định = `language`), `viewport` (1600x900), `brand`, `mask`, `hide`, `auth`, `setup`, `colorScheme`, `baseUrl`, `${ENV}`.
- `setup:` chạy off-camera trong context riêng, session mang sang take; `mask`/`hide` tiêm vào mọi trang.
- Hạn chế đã biết: overlay hiện chỉ có khung + callout, cursor/ripple luôn vẽ khi `cursor.show`; `screenshot` chỉ chụp viewport; chưa kiểm chứng hành vi overlay trong `--dry` (architect/developer phải xác minh).

## 3. Yêu cầu chức năng (FR)

### Đầu vào
- **FR-1** Đầu vào bắt buộc là `.demo/<slug>/demo.yaml` hợp lệ (qua `validate`); lấy từ đó: URL/`baseUrl`, selector, `setup`/`auth`, `mask`, `hide`, `brand`, `viewport`, `locale`, `colorScheme`.
- **FR-2** `.demo/<slug>/guide.yaml` là tuỳ chọn. Khi có, nó bổ sung/ghi đè theo từng cấp:
  - Cấp task: `title`, `goal`, `prerequisites[]`, `expectedResult`.
  - Cấp bước (tham chiếu theo `scene` id + chỉ số action hoặc id bước): `include`/`skip`, `title`, `text` (câu hướng dẫn), `note`, `warning`.
  - Cho phép thêm bước thủ công (ngoài action của demo.yaml) tham chiếu một selector.
  - Tên khoá chính xác do architect chốt; yêu cầu là các khả năng trên.
- **FR-3** `guide.yaml` không bao giờ làm đổi hành vi/đầu ra của video; thiếu `guide.yaml` thì guide vẫn sinh được chỉ từ `demo.yaml`.
- **FR-4** Khi `guide.yaml` tham chiếu scene/action không tồn tại, lệnh dừng với thông báo nêu rõ tham chiếu sai (không bỏ qua im lặng).

### Quy tắc chọn bước
- **FR-5** Mặc định, các action tương tác thành bước: `click, dblclick, type, fill, select, check, uncheck, upload, press`.
- **FR-6** Mặc định KHÔNG thành bước: toàn bộ `setup:` và login, `wait, waitFor, waitForUrl, scroll, highlight, spotlight, callout, clear, zoom, unzoom, caption, at, moveTo, hover, goto, reload, screenshot, evaluate`, và scene `type: card`. (`hover`, `goto` có thể được bật bằng `guide.yaml` `include`.) Các action không-bước vẫn được thực thi khi cần để đưa UI về đúng trạng thái trước bước kế tiếp.
- **FR-7** Login/`setup` được thể hiện đúng một dòng văn bản trong mục điều kiện tiên quyết: "Sign in to the app", không ảnh, không giá trị credential. (ASSUMPTION: chỉ in dòng này khi spec có `setup:` hoặc `auth:`.)
- **FR-8** Scene `card` không thành bước; `title`/`subtitle` của card có thể dùng làm gợi ý tiêu đề/mục tiêu (ASSUMPTION: chỉ là gợi ý, `guide.yaml` ưu tiên hơn).
- **FR-9** Số bước được đánh liên tục 1..N trong một task, theo thứ tự flow; số trên ảnh khớp số trong văn bản.

### Ảnh
- **FR-10** Mỗi bước có 2 ảnh PNG: (a) ảnh toàn viewport với khung highlight quanh phần tử đích + badge số bước + mũi tên + nhãn ngắn; (b) ảnh cận cảnh (crop vùng thao tác kèm padding).
- **FR-11** Ảnh không có cursor giả, không có ripple/animation dở dang; chụp sau khi trang ổn định (không loading/transition giữa chừng).
- **FR-12** `mask` (blur) và `hide` (ẩn) của spec áp dụng cho MỌI ảnh, cả toàn viewport lẫn cận cảnh; chú thích (khung, badge, mũi tên) không che hay làm lộ phần đã mask.
- **FR-13** Bước `type`/`fill` dùng dữ liệu giả cố định (do agent chọn, có thể ghi đè trong `guide.yaml`), cùng một giá trị ở mọi lần chạy; trường mật khẩu luôn hiển thị dạng che; không bao giờ dùng giá trị `${ENV}` thật.
- **FR-14** Chỉ chạy trên staging/demo; agent từ chối/cảnh báo khi `baseUrl` trông như production (ASSUMPTION: heuristic do architect đề xuất, tối thiểu là người dùng xác nhận môi trường ở checkpoint).
- **FR-15** Đặt tên ảnh `NN-<scene>-<step>.png` và `NN-<scene>-<step>-closeup.png` trong `.demo/<slug>/guide/images/`, `NN` là số bước hai chữ số; chạy lại cho cùng nội dung ra cùng tên file.

### Văn bản
- **FR-16** Toàn bộ văn bản guide (tiêu đề, bước, ghi chú, alt text, cover PDF) bằng tiếng Anh, bất kể `language` của demo; `narration` của video không được dùng nguyên văn nếu không phải tiếng Anh.
- **FR-17** Mỗi bước: 1 câu mệnh lệnh chính, tối đa 1 câu bổ sung, nêu nhãn UI nhìn thấy (lấy từ DOM lúc chụp, không dùng selector CSS); ghi chú/cảnh báo chỉ khi cần.
- **FR-18** Cấu trúc `guide.md`: tiêu đề, mục tiêu (1-2 câu), điều kiện tiên quyết, danh sách bước (câu + ảnh toàn + ảnh cận cảnh), kết quả mong đợi ở cuối, mục lục khi >= 1 task dài (ASSUMPTION: mục lục bắt buộc chỉ khi có nhiều hơn một task).
- **FR-19** Ảnh tham chiếu bằng đường dẫn tương đối; mỗi ảnh có alt text không rỗng, mô tả được hành động (không chỉ "screenshot").

### Đầu ra
- **FR-20** Sinh `.demo/<slug>/guide/guide.md`, `.demo/<slug>/guide/images/`, `.demo/<slug>/guide/guide.pdf`.
- **FR-21** PDF render từ HTML bằng Chromium của Playwright, nhúng font, dùng `brand` (màu, font, logo) của spec cho trang bìa và tiêu đề; không thêm dependency nặng (không pandoc).
- **FR-22** PDF phản ánh đúng nội dung `guide.md` hiện tại (gồm chữ đã sửa tay) và không bị tràn/cắt ảnh qua trang.

### Refresh
- **FR-23** `/demo-builder:guide <slug> refresh` chạy lại flow và chụp lại TOÀN BỘ ảnh (cả hai loại), giữ nguyên văn bản đã sửa tay trong `guide.md`/`guide.yaml`, rồi dựng lại PDF.
- **FR-24** Cách nhận biết "chữ sửa tay" phải xác định được (ví dụ so với bản agent sinh lần trước hoặc vùng được đánh dấu); nếu số/thứ tự bước đổi so với guide cũ thì refresh dừng và báo điểm lệch thay vì ghi đè hay ghép sai ảnh.

### Checkpoint duyệt
- **FR-25** Trước khi PDF được coi là bản cuối, agent tạo preview gồm contact sheet ảnh các bước (tái dùng cơ chế `review`) và bản render guide, rồi DỪNG chờ người dùng duyệt.
- **FR-26** Chưa duyệt thì `guide.pdf` được gắn nhãn nháp (tên/ghi chú trạng thái "draft") và agent không báo "done". Người dùng yêu cầu sửa thì agent sửa và trình preview lại.

### Tích hợp
- **FR-27** Lệnh mới `/demo-builder:guide <slug> [refresh]`; slug không tồn tại hoặc thiếu `demo.yaml` thì báo lỗi rõ ràng kèm cách khắc phục.
- **FR-28** `demo-director` có nhánh guide sau flow-engineer (khi flow đã pass `record --dry`), gọi `guide-writer`, giữ checkpoint ở FR-25; nhánh guide không chặn quy trình video.
- **FR-29** Logic chụp/dựng nằm trong `lib/guide.mjs`, gọi qua lệnh trong `demo.mjs`; mọi thay đổi `overlay.mjs`/`record.mjs` phải giữ nguyên đầu ra video hiện tại (hồi quy video = 0).
- **FR-30** Workspace dùng chung `.demo/<slug>/guide/`.

### Lỗi
- **FR-31** Khi selector timeout/action lỗi: dừng ngay, báo scene + action lỗi + thông điệp lỗi + đường dẫn ảnh lỗi (`error-*.png`); không để lại `guide.md`/`guide.pdf` dở dang được trình bày như hoàn chỉnh (file tạm bị xoá hoặc gắn rõ "incomplete", và bản hoàn chỉnh cũ, nếu có, không bị ghi đè).
- **FR-32** Cảnh báo (không dừng) khi một task có hơn ~12 bước, đề xuất tách task.

## 4. Yêu cầu phi chức năng
- **NFR-1** Không secret nào (giá trị `${ENV}`, cookie, `storageState`, token) xuất hiện trong `guide.md`, ảnh, PDF hay log.
- **NFR-2** Đặt tên file xác định (FR-15); chạy lại không sinh file thừa với tên khác.
- **NFR-3** Chạy được cục bộ/offline đối với app đích cục bộ; không gửi dữ liệu ra ngoài; font phải nhúng/cục bộ (không tải CDN lúc render PDF).
- **NFR-4** Không thêm dependency nặng; chỉ dùng Playwright + Chromium + ffmpeg sẵn có và Node thuần.
- **NFR-5** Accessibility tài liệu: alt text cho mọi ảnh, heading đúng cấp, khung/badge đủ tương phản.
- **NFR-6** Ảnh viewport 1x theo `viewport` của spec (mặc định 1600x900).
- **NFR-7** Hiệu năng: chấp nhận được nếu guide 12 bước sinh xong trong vài phút (ASSUMPTION, chưa đo; QA ghi nhận thời gian thực tế).
- **NFR-8** Log tiến độ theo bước, không in giá trị nhập vào trường nhạy cảm.

## 5. User stories

### US-1: Sinh guide từ flow có sẵn (Must)
As a product owner/CS, I want one command that turns a `demo.yaml` flow into a step-by-step guide, so that I get help docs without re-exploring the UI.
- AC-1.1 Given `demo.yaml` hợp lệ, when chạy `/demo-builder:guide <slug>`, then tồn tại `.demo/<slug>/guide/guide.md` và `.demo/<slug>/guide/images/`.
- AC-1.2 Given scene có N action thuộc `click/dblclick/type/fill/select/check/uncheck/upload/press`, và không có `guide.yaml`, when sinh guide, then có đúng N bước được đánh số liên tục theo thứ tự flow.
- AC-1.3 Given action `wait/waitFor/scroll/highlight/spotlight/zoom/caption/at` và scene `card`, when sinh guide, then không có bước nào tương ứng.
- AC-1.4 Given spec có `setup:` login, when sinh guide, then điều kiện tiên quyết có đúng dòng "Sign in to the app", không ảnh login và không giá trị credential nào.
- AC-1.5 Given selector không tìm thấy, when sinh guide, then lệnh dừng, thông báo nêu scene + action + lỗi + đường dẫn ảnh lỗi, và không có `guide.md`/`guide.pdf` dở dang được báo là hoàn chỉnh.
- AC-1.6 Given slug không có `demo.yaml`, then lệnh báo lỗi rõ và không tạo thư mục guide.

### US-2: Tuỳ biến bằng guide.yaml (Must)
As a guide author, I want to override steps, titles and notes in `guide.yaml`, so that the guide can cover the full task without changing the video.
- AC-2.1 Given `guide.yaml` đặt `skip` cho một bước, when sinh, then bước đó vắng mặt và số bước còn lại liên tục.
- AC-2.2 Given `guide.yaml` đặt `include` cho một action `hover` (mặc định bị loại), then nó xuất hiện như bước.
- AC-2.3 Given `guide.yaml` đặt `title`/`text`/`note`/`warning` cho một bước, then guide dùng đúng chữ đó.
- AC-2.4 Given `guide.yaml` đặt task `title`, `goal`, `prerequisites`, `expectedResult`, then các mục tương ứng trong guide dùng đúng nội dung.
- AC-2.5 Given `guide.yaml` tham chiếu scene/action không tồn tại, then lệnh dừng và nêu tham chiếu sai.
- AC-2.6 Given có/không có `guide.yaml`, then file video đầu ra của cùng spec không đổi.

### US-3: Ảnh UI rõ ràng cho từng bước (Must)
As an end user, I want each step to show a full screenshot and a close-up, so that I can find the control quickly.
- AC-3.1 Given một bước, then có đúng hai PNG `NN-<scene>-<step>.png` và `NN-<scene>-<step>-closeup.png`, được tham chiếu bằng đường dẫn tương đối trong `guide.md`.
- AC-3.2 Given ảnh toàn viewport, then có khung quanh phần tử đích, badge số bước trùng số trong văn bản, mũi tên và nhãn ngắn.
- AC-3.3 Given bất kỳ ảnh nào, then không có cursor giả, không có ripple, không có overlay caption/zoom của video.
- AC-3.4 Given ảnh cận cảnh, then chứa phần tử đích với padding và nhìn thấy nhãn của nó.
- AC-3.5 Mọi ảnh trong `guide.md` có alt text không rỗng.
- AC-3.6 Given chạy hai lần với cùng app/spec, then tập tên file ảnh giống hệt nhau.

### US-4: Văn bản dễ làm theo, tiếng Anh (Must)
As an end user, I want short English instructions naming the visible UI label, so that I can follow without guessing.
- AC-4.1 Given demo có `language: vi-VN`, when sinh guide, then toàn bộ chữ của guide (kể cả alt text, bìa PDF) là tiếng Anh.
- AC-4.2 Given một bước, then văn bản là 1 câu mệnh lệnh chính (+ tối đa 1 câu bổ sung) và nêu nhãn UI hiển thị trong ảnh, không chứa selector CSS.
- AC-4.3 Given bước `fill`/`type`, then giá trị hiển thị là dữ liệu giả cố định, giống nhau giữa các lần chạy; trường mật khẩu hiển thị che.
- AC-4.4 Given guide hoàn chỉnh, then có: tiêu đề, mục tiêu, điều kiện tiên quyết, các bước, kết quả mong đợi.
- AC-4.5 Given task có > 12 bước, then có cảnh báo đề xuất tách task (không chặn sinh).

### US-5: Bảo vệ dữ liệu (Must)
As a security-minded owner, I want the same `mask`/`hide` and no secrets in outputs, so that nothing sensitive leaks.
- AC-5.1 Given `mask`/`hide` trong spec, then phần tử khớp bị blur/ẩn trong mọi ảnh (toàn viewport và cận cảnh).
- AC-5.2 Given credential qua `${ENV}`, then chuỗi secret không xuất hiện trong `guide.md`, ảnh (xác minh bằng xem preview), PDF hay log.
- AC-5.3 Given khung/badge/mũi tên, then không che phần đã mask khiến lộ dữ liệu thật.
- AC-5.4 Given `baseUrl` nghi là production, then agent cảnh báo và cần xác nhận trước khi chụp.

### US-6: Xuất PDF có brand (Must)
As a customer-success lead, I want a branded PDF of the guide, so that I can hand it to onboarding customers.
- AC-6.1 Given guide đã dựng, then `.demo/<slug>/guide/guide.pdf` tồn tại, mở được, có trang bìa theo `brand` (màu, logo, font).
- AC-6.2 Given PDF, then font được nhúng (kiểm bằng thuộc tính tài liệu) và ảnh không bị cắt/tràn trang.
- AC-6.3 Given PDF, then nội dung (bước, số bước, alt/nhãn) khớp `guide.md` tại thời điểm dựng, kể cả chữ sửa tay.
- AC-6.4 Việc render PDF không cần mạng và không cần cài thêm công cụ ngoài Playwright Chromium.

### US-7: Duyệt preview trước khi chốt (Must)
As a reviewer, I want to approve a preview before the PDF is final, so that nothing wrong is shared.
- AC-7.1 Given guide vừa sinh, then agent trình contact sheet ảnh các bước + bản render guide và dừng chờ.
- AC-7.2 Given chưa duyệt, then `guide.pdf` mang trạng thái nháp và agent không báo "done".
- AC-7.3 Given người dùng yêu cầu sửa, then agent sửa và trình lại preview; chỉ khi duyệt rõ ràng mới ghi nhận bản cuối.
- AC-7.4 Không có file nào được gửi/đăng ra ngoài máy trong quá trình này.

### US-8: Refresh khi UI đổi (Must)
As a maintainer, I want to re-capture all images without losing hand-edited text, so that small UI changes are cheap.
- AC-8.1 Given guide đã có và chữ đã sửa tay, when chạy `/demo-builder:guide <slug> refresh`, then toàn bộ ảnh (cả hai loại) được chụp lại, chữ sửa tay giữ nguyên, PDF dựng lại.
- AC-8.2 Given UI đã đổi nên ảnh mới khác ảnh cũ, then các file ảnh có cùng tên được thay bằng ảnh mới.
- AC-8.3 Given số/thứ tự bước của flow khác guide cũ, then refresh dừng và báo điểm lệch, không ghi đè.
- AC-8.4 Given refresh lỗi giữa chừng, then guide cũ còn nguyên vẹn (không nửa mới nửa cũ).
- AC-8.5 Sau refresh vẫn phải qua checkpoint duyệt preview (US-7).

### US-9: Điều phối bởi demo-director (Should)
As a user of `/demo-builder:new`, I want the director to offer the guide step after the flow is green, so that I get video and guide from one flow.
- AC-9.1 Given flow đã pass `record --dry`, then demo-director đề xuất/chạy nhánh guide qua `guide-writer`.
- AC-9.2 Given nhánh guide lỗi, then quy trình video không bị chặn và lỗi được báo riêng.

## 6. Quy tắc nghiệp vụ & kiểm tra
- BR-1 Một guide = một tác vụ (how-to), khuyến nghị <= ~12 bước.
- BR-2 Nhãn UI trong văn bản lấy từ DOM lúc chụp, không từ bảng thuật ngữ.
- BR-3 Không có bước nào cho login; login chỉ là dòng prerequisite.
- BR-4 Guide chỉ sinh trên staging/demo với dữ liệu giả.
- BR-5 Tên file/ảnh/PDF xác định; chạy lại không đổi tên.
- BR-6 Chữ sửa tay luôn thắng khi refresh.

## 7. Edge cases
- Action tạo dữ liệu không idempotent: refresh có thể tạo bản ghi trùng trên staging. Cần cảnh báo ở checkpoint và trong báo cáo (rủi ro R3 của discovery).
- Phần tử đích ngoài viewport: cần cuộn vào tầm nhìn trước khi chụp; cận cảnh vẫn hợp lệ.
- Phần tử bị `hide`: bước vẫn phải xử lý có kiểm soát (cảnh báo, không crash).
- Nhiều phần tử khớp selector: dùng `nth` của action, nếu mơ hồ thì cảnh báo.
- Trang có animation/loading: chờ ổn định; quá thời gian thì báo lỗi theo FR-31.
- `press` không có phần tử đích: ảnh toàn viewport không khung, nhãn phím (ví dụ "Press Enter"), cận cảnh bỏ hoặc dùng phần tử đang focus (ASSUMPTION; architect chốt).
- Hai bước liên tiếp gần như giống nhau: vẫn giữ mỗi bước một ảnh (không gộp ở MVP).
- Modal/dropdown đóng ngay sau action: chụp ảnh TRƯỚC thao tác để thấy phần tử đích (ASSUMPTION: ảnh chụp ở trạng thái ngay trước action).

## 8. RỦI RO NGÔN NGỮ (cần người dùng quyết định)

**Vấn đề.** Guide bắt buộc là tiếng Anh (FR-16), nhưng app đang chụp có thể chạy tiếng Việt (`language`/`locale` của demo thường là `vi-VN`). Khi đó ảnh hiển thị nhãn tiếng Việt ("Lưu", "Tạo hoá đơn") còn câu hướng dẫn tiếng Anh ("Click Save") -> người đọc không khớp được chữ với ảnh; alt text và nhãn trên ảnh cũng lệch.

**Lựa chọn**
- **L1. Ép locale `en-US` khi chụp guide** (đặt `locale`/Accept-Language của Playwright, hoặc trường `locale` trong `guide.yaml` chỉ áp dụng cho guide). Ảnh và chữ cùng tiếng Anh. Điều kiện: app hỗ trợ i18n tiếng Anh; nếu app không hỗ trợ thì ảnh vẫn tiếng Việt -> rơi về L2. Không ảnh hưởng video vì `locale` guide tách riêng.
- **L2. Giữ locale của app, trích nguyên văn nhãn trên màn hình trong câu tiếng Anh** (ví dụ: Click **Lưu** ("Save")). Luôn đúng với ảnh dù app không có tiếng Anh, nhưng câu văn lai ngôn ngữ, người đọc tiếng Anh vẫn thấy ảnh tiếng Việt.
- **L3. Kết hợp (mặc định đề xuất kỹ thuật):** `guide.yaml` có `locale` (mặc định `en-US`); chụp theo locale đó; nếu nhãn lấy từ DOM khác ASCII tiếng Anh/không có bản dịch (phát hiện app không đổi ngôn ngữ) thì dùng L2 và cảnh báo ở checkpoint.
- **L4. Yêu cầu guide-writer tự dịch nhãn** (không nhìn thấy trong ảnh): KHÔNG khuyến nghị, dễ sai và vi phạm BR-2.

**Khuyến nghị: L3.** Mặc định ép `en-US` cho guide, quay về L2 kèm cảnh báo khi app không có bản tiếng Anh. Đây là câu hỏi mở Q1 bên dưới; người dùng phải xác nhận vì ảnh hưởng thiết kế (trường `guide.yaml.locale`, auth/storageState có thể phụ thuộc locale) và ảnh người đọc nhìn thấy.

## 9. Giả định
- ASSUMPTION: Flow trong `demo.yaml` chạy được ở chế độ chụp tĩnh mà không cần pacing theo giọng đọc (dùng cơ chế kiểu `--dry`); hành vi overlay trong `--dry` chưa được xác minh.
- ASSUMPTION: `guide.yaml` nằm cạnh `demo.yaml` tại `.demo/<slug>/guide.yaml`.
- ASSUMPTION: Một `demo.yaml` sinh một guide (một task); nhiều task do `guide.yaml` mô tả hoặc hoãn (xem Q3).
- ASSUMPTION: PDF khổ A4 dọc.
- ASSUMPTION: Dữ liệu giả cố định là tên/số tiền phù hợp tiếng Anh (ví dụ "Acme Co.", "Jane Doe") vì guide tiếng Anh.

## 10. Câu hỏi mở (tối đa 5)

- **Q1. Ngôn ngữ UI trong ảnh (xem mục 8).** Options: L1 ép `en-US`; L2 giữ locale app + trích nhãn nguyên văn; L3 kết hợp; L4 tự dịch. **Mặc định: L3.** Nếu không trả lời: dùng L3, cảnh báo ở checkpoint.
- **Q2. Cơ chế "chữ sửa tay" khi refresh (FR-24).** Options: (a) người dùng sửa chữ trong `guide.yaml`, `guide.md` luôn sinh lại từ yaml + ảnh; (b) người dùng sửa thẳng `guide.md`, refresh chỉ thay ảnh và dựng lại PDF; (c) cả hai với dấu vùng. **Mặc định: (b)** vì khớp trực giác "sửa file Markdown", ghép ảnh theo tên file ổn định. Ảnh hưởng: thiết kế refresh và quy mô kiểm thử.
- **Q3. Một demo có nhiều task không?** Options: (a) một `demo.yaml` = một guide/task; (b) `guide.yaml` định nghĩa nhiều task, mỗi task ra một guide riêng. **Mặc định: (a)**; nếu chọn (b) cần đổi tên file/ thư mục đầu ra (`guide/<task>/...`).
- **Q4. Trạng thái "nháp" của PDF trước khi duyệt (FR-26).** Options: (a) ghi `guide-draft.pdf`, đổi thành `guide.pdf` khi duyệt; (b) giữ `guide.pdf` + watermark/ghi chú "DRAFT" cho tới khi duyệt; (c) chỉ dừng trong hội thoại, không đánh dấu file. **Mặc định: (a)** (rõ ràng nhất, không lẫn bản chưa duyệt). Lưu ý: yêu cầu gốc nói đầu ra là `guide.pdf`, nên (a) cần người dùng xác nhận.
- **Q5. Chế độ dữ liệu giả và flow không idempotent.** Options: (a) cảnh báo ở checkpoint và để người dùng tự dọn staging; (b) cho phép `guide.yaml` khai báo bước cleanup/ reset off-camera; (c) bắt buộc flow idempotent mới chạy. **Mặc định: (a)** cho MVP. Ảnh hưởng: refresh có thể tạo bản ghi trùng.

## 11. Truy vết (FR/NFR -> quyết định mục 8 của discovery)

| Hàng quyết định (mục 8) | FR / NFR / US |
|---|---|
| Phạm vi: mức A + PDF | Mục 1.3, 1.4, FR-20, FR-21, FR-22, US-6 |
| Nguồn đầu vào (D1 d) | FR-1, FR-2, FR-3, FR-4, FR-5, FR-6, FR-8, FR-9, US-1, US-2 |
| Người đọc (A1) | Mục 1.2, FR-17, FR-18, BR-1 |
| Định dạng (E1) | FR-19, FR-20, FR-21, FR-22, NFR-3, NFR-4, US-6 |
| Ảnh (C1/C2) | FR-10, FR-11, FR-12, FR-15, NFR-6, US-3, US-5 |
| Nội dung (B2/B3) | FR-2, FR-17, FR-18, FR-32, BR-1, US-4 |
| Tích hợp (J1-J6) | FR-27, FR-28, FR-29, FR-30, US-9 |
| Ngôn ngữ (G1: English only) | FR-16, US-4 (AC-4.1), Mục 8, Q1 |
| Khi UI đổi (H1 b) | FR-23, FR-24, BR-6, US-8, Q2 |
| QA (K/J4): duyệt preview, chưa mở rộng demo-qa, chưa self-follow | FR-25, FR-26, US-7, mục 1.4 |
| Login & dữ liệu (I1/I2/I4) | FR-7, FR-13, FR-14, FR-12, NFR-1, BR-3, BR-4, US-1 (AC-1.4), US-5 |
| Bước tiếp: dừng để người dùng duyệt trước khi code | Handoff của tài liệu này |
| Xử lý lỗi (AC-1.4 discovery, chuẩn dự án) | FR-31, US-1 (AC-1.5) |
| Alt text/accessibility (C6 a, K5 a) | FR-19, NFR-5, AC-3.5 |

## 12. Rủi ro còn lại
- Overlay/cursor/ripple hiện thiết kế cho video; chế độ chụp tĩnh cần thiết kế cẩn thận để không gây hồi quy video (FR-29).
- Ảnh có thể chụp giữa chừng nếu trang chưa ổn định (FR-11, edge cases).
- Rủi ro ngôn ngữ (mục 8) có thể làm ảnh/chữ lệch nhau nếu không xử lý.
- Refresh trên flow tạo dữ liệu không idempotent (Q5).
- `--dry` và `screenshot` chưa được xác minh hành vi thực tế; architect/developer phải kiểm chứng sớm.

## 12. Câu trả lời của người dùng cho Q1–Q5 (2026-11-25)

- **Q1 → L3 (kết hợp):** `guide.yaml.locale` mặc định `en-US`, chỉ áp dụng khi chụp guide; nếu app không đổi sang tiếng Anh thì trích nguyên văn nhãn trên màn hình (L2) và cảnh báo ở checkpoint.
- **Q2 → (b):** người dùng sửa thẳng `guide.md`; `refresh` chỉ thay ảnh (tên file ổn định) và dựng lại PDF, không ghi đè chữ.
- **Q3 → (a):** một `demo.yaml` = một guide/task.
- **Q4 → (a):** ghi `guide-draft.pdf`; chỉ đổi thành `guide.pdf` sau khi người dùng duyệt.
- **Q5 → (a) mặc định (không hỏi riêng):** cảnh báo ở checkpoint khi flow tạo dữ liệu, người dùng tự dọn staging.
