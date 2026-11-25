# Discovery: Agent viết User Guide / Help Document (step-by-step, có ảnh UI)

> Trạng thái: DISCOVERY (chưa phải requirements chốt). Mục đích: gom ý tưởng + câu hỏi để người dùng trả lời nhanh. Mọi chỗ ghi `ASSUMPTION` là giả định tạm, cần xác nhận.

## 1. Vấn đề & giá trị

**Yêu cầu gốc:** thêm một agent viết help document, sinh bộ user guide từng bước, mỗi bước có ảnh UI.

### Ai đọc guide?
| Người đọc | Nhu cầu | Ví dụ |
|---|---|---|
| End user | "Làm sao để làm X?" | Hướng dẫn tạo hoá đơn |
| Admin / IT | Cấu hình, phân quyền, tích hợp | Thêm user, bật SSO |
| Support / CS | Trả lời ticket bằng link bài chuẩn, có ảnh | Macro trả lời khách |
| Onboarding khách hàng mới | Lộ trình 30 phút đầu | "Bắt đầu nhanh" |
| Đào tạo nội bộ | Tài liệu training sales/CS | Slide / PDF in được |

### Khác gì video demo?
| | Video demo | User guide |
|---|---|---|
| Mục tiêu | Thuyết phục, "wow" (presales) | Hoàn thành tác vụ (post-sales) |
| Cách đọc | Xem tuần tự, thụ động | Quét nhanh, tra cứu, làm theo song song |
| Độ chi tiết | 2-4 khoảnh khắc giá trị | Đủ mọi bước, kể cả bước nhàm |
| Hình thức | Mượt, có cursor, hiệu ứng | Ảnh tĩnh sắc nét, đánh số bước, chú thích |
| Vòng đời | Ít sửa | Phải cập nhật mỗi khi UI đổi |

### Đòn bẩy "một flow -> video + guide"
`demo.yaml` đã chứa: URL từng màn, chuỗi action (click/type/select...), selector ổn định, setup/login qua `${ENV}`, `mask`/`hide` bảo vệ dữ liệu, brand, language, narration. Đó chính là nguyên liệu của một guide: mỗi action = một bước, mỗi `narration` = nội dung giải thích. Chạy cùng một flow sinh cả video lẫn guide thì:
- Không phải khám phá UI lần hai, selector đã được flow-engineer kiểm chứng (`record --dry`).
- Privacy đã giải quyết một lần (mask/hide dùng chung).
- Đổi UI -> chạy lại -> cả video lẫn ảnh guide cùng cập nhật (docs-as-code).
- Localizer đã có sẵn để dịch.

Lưu ý quan trọng: demo tập trung "value moments" (2-4 cảnh), còn guide cần phủ **tác vụ đầy đủ**. Nên khả năng cao `demo.yaml` hiện có **chưa đủ bước** cho guide (xem câu hỏi D1).

## 2. Reuse map (đã đọc code thực tế)

### 2.1 Dùng lại nguyên trạng
| Năng lực | Vị trí | Dùng cho guide |
|---|---|---|
| Spec loader/validate, `${ENV}`, path resolve | `plugins/demo-builder/skills/demo-toolkit/scripts/lib/spec.mjs` (`loadSpec`, `validateSpec`, `normaliseAction`) | Đọc `demo.yaml` làm input |
| Chạy action bằng Playwright (`Director.runActions`, `goto`, `click`, `fill`, `select`...) | `scripts/lib/record.mjs` (switch action dòng ~83-149) | Lặp lại flow để chụp |
| `setup:` off-camera + `auth.storageState` | `record.mjs` dòng ~190-201 | Login không lộ vào ảnh |
| `mask` (blur) và `hide` (display:none) | `scripts/lib/overlay.mjs` css(), tiêm qua `ctx.addInitScript(overlayInit, ...)` | Che PII trong ảnh guide |
| `highlight`/`spotlight`/`callout` vẽ khung + nhãn quanh element | `overlay.mjs` (`.__demo-hl`, `.__demo-callout`) | Khung nhấn mạnh phần tử trong ảnh |
| Action `screenshot` (lưu ảnh viewport) | `record.mjs` dòng 148 | Nền tảng chụp ảnh (hiện chỉ lưu full viewport, không guard dry) |
| `inspect <url>` (ảnh + bảng element + selector gợi ý) | `record.mjs` `inspect()` dòng ~270 | Khám phá UI khi không có flow sẵn |
| Chế độ `--dry` (nhanh, không video) | `record.mjs` | Chụp ảnh nhanh, không cần pacing theo giọng đọc |
| Render HTML -> ảnh theo brand | `scripts/lib/cards.mjs` (`cardHtml`, `renderCards`) | Cover / trang tiêu đề guide, ảnh banner |
| `brand`, `language`, `locale`, `viewport`, `colorScheme` | `spec-reference.md` top-level | Theme + ngôn ngữ guide |
| Contact sheet / frame extract | `scripts/lib/review.mjs` | Preview nhanh toàn bộ ảnh guide cho QA |
| Localizer (dịch + chạy lại theo locale, `paths` override) | `agents/localizer.md`, `paths` trong spec | Guide đa ngôn ngữ |
| Playbook/Handoff/checkpoint/workspace `.demo/<slug>/` | `skills/demo-playbook/SKILL.md`, `agents/demo-director.md` | Gắn agent mới vào squad |

### 2.2 Cần mở rộng
| Mở rộng | Lý do | Ghi chú |
|---|---|---|
| Chụp ảnh **theo từng action** (before/after) tự động, đặt tên `NN-<scene>-<step>.png` | `screenshot` hiện là action thủ công, 1 ảnh viewport | Cần cơ chế "mỗi bước = 1 ảnh" mà không bắt người viết thêm action |
| **Marker đánh số** (1, 2, 3 ở góc/gần element) | overlay hiện chỉ có khung + callout text | Mở rộng overlay (self-contained, chạy trong page) |
| **Crop/zoom theo element** (ảnh cận cảnh) | `zoom` hiện là CSS transform cho video | Cần crop bằng bounding box + padding, hoặc `element.screenshot` |
| **Step-level GIF/webm ngắn** | video là 1 take liên tục, `assemble` có GIF theo `start/duration` | Có thể cắt từ `timeline.json` (đã lưu start/end mỗi scene) |
| **Alt text** cho ảnh | Chưa có | Sinh từ mô tả bước + nhãn element |
| **Cursor/ripple tắt** trong ảnh guide | Overlay luôn vẽ cursor khi `cursor.show` | Thêm chế độ "guide" (cursor tuỳ chọn, không animation delay) |
| Metadata mỗi bước: `title`, `description`, `note/warning`, `expected result` | `demo.yaml` chỉ có `narration` cấp scene | Thêm trường guide (xem câu hỏi D) |
| Hash ảnh + visual diff giữa hai lần chạy | Chưa có | Nền cho "freshness" |
| `status`-like lệnh cho guide (stale?) | `status` hiện chỉ cho voice/recording | Tương tự cho ảnh |

### 2.3 Hoàn toàn mới
- **Doc renderer**: Markdown trước (ASSUMPTION), sau đó HTML tĩnh, PDF...
- **Template** guide (cover, mục lục, bước, cảnh báo, FAQ).
- **Exporter/publisher** theo nền tảng (static site, Confluence, Notion, in-app JSON).
- **Agent mới** (đề xuất tên `guide-writer`/`help-doc-writer`), command mới (đề xuất `/demo-builder:guide <slug>`), skill hướng dẫn viết help doc (giọng văn, cấu trúc Diataxis).
- **Công cụ phát hiện UI lệch** (visual diff, báo bước lỗi thời).

## 3. Các mức phạm vi (Idea options)

| Mức | Nội dung | Giá trị 1 dòng | Độ phức tạp |
|---|---|---|---|
| **A. MVP "Flow -> Markdown guide"** | Đọc `demo.yaml`, chạy flow, chụp 1 ảnh/bước có khung highlight + số bước, agent viết câu hướng dẫn, xuất 1 file Markdown + thư mục ảnh | Có ngay guide có ảnh từ flow đã có, không khám phá lại UI | Thấp-vừa (S/M): 1 agent, 1 command, mở rộng record/overlay, 1 renderer MD |
| **B. "Guide hoàn chỉnh"** | A + HTML tĩnh một file/site đơn giản, PDF, crop/zoom element, before/after, alt text, mục lục, FAQ/Troubleshooting, nhúng GIF bước, brand cover, i18n qua localizer, demo-qa kiểm guide | Tài liệu giao được cho khách, đa ngôn ngữ | Vừa (M/L) |
| **C. "Docs-as-code sống"** | B + `guide status`/`guide refresh` chỉ chụp lại bước đổi, visual diff gắn cờ bước lỗi thời, versioning theo release, CI hook (chạy khi deploy staging), changelog guide | Guide không bao giờ lỗi thời so với UI | Lớn (L) |
| **D. "Help platform"** | C + xuất Confluence/Notion/Zendesk/Intercom, in-app help JSON (tooltip/walkthrough tour), cấu trúc Diataxis (tutorial/how-to/reference/explanation), tìm kiếm, tự khám phá app (không cần flow) và đề xuất danh sách tác vụ | Một nguồn sự thật cho mọi kênh help | Rất lớn (XL), nhiều rủi ro |

Danh sách ý tưởng bổ sung (có thể rải vào các mức):
- Docs-as-code freshness + visual diff (C).
- Đa định dạng: Markdown, HTML site tĩnh, PDF, DOCX, Confluence, Notion, in-app help JSON (B-D).
- Reuse localizer: guide theo locale, chụp lại với locale của app (B).
- FAQ / Troubleshooting sinh từ lỗi hay gặp, validation message, trạng thái rỗng (B).
- Cấu trúc theo tác vụ (Diataxis how-to) vs reference theo màn hình (B-D).
- Nhúng video demo / GIF ngắn theo từng mục (B).
- demo-qa mở rộng: kiểm ảnh lộ PII, bước thiếu ảnh, ảnh không khớp lời, lỗi chính tả, link hỏng (B).
- Versioning theo release (C).
- "Quick reference card" 1 trang in được; checklist onboarding (B).
- Vẽ mũi tên/khung/làm mờ vùng không liên quan trong ảnh (B).
- Chế độ dark/light, ảnh 1x/2x (retina) (B).
- Tự tạo "tour" in-app từ flow (D).

**Khuyến nghị:** làm A trước, thiết kế dữ liệu sao cho B và C là mở rộng (không viết lại).

## 4. User stories nháp (chỉ MVP = mức A)

Giả định tạm: Markdown, 1 ngôn ngữ, đọc từ `demo.yaml` hiện có, chạy trên staging/demo.

### US-1: Sinh guide từ flow có sẵn
As a product owner/CS, I want a command that turns an existing `demo.yaml` flow into a step-by-step guide, so that I get help docs without re-exploring the UI.
Priority: Must
- AC-1.1 Given `.demo/<slug>/demo.yaml` hợp lệ và `validate` pass, when chạy `/demo-builder:guide <slug>`, then tạo `.demo/<slug>/guide/guide.md` và thư mục `.demo/<slug>/guide/images/`.
- AC-1.2 Given mỗi scene `screen` có N action tương tác (click/type/fill/select/check/upload/press), when sinh guide, then guide có đúng một bước đánh số cho mỗi action tương tác, theo thứ tự flow.
- AC-1.3 Given scene `type: card`, when sinh guide, then card không thành bước thao tác (có thể thành phần giới thiệu/tiêu đề mục).
- AC-1.4 Given flow lỗi (selector timeout), when sinh guide, then lệnh dừng, báo scene/action lỗi và đường dẫn `error-*.png`, không ghi guide dở dang như thể hoàn chỉnh.

### US-2: Ảnh UI cho từng bước
As an end user, I want each step to have a screenshot that shows where to act, so that I can find the control quickly.
Priority: Must
- AC-2.1 Given một bước click/fill/select, when sinh guide, then có ít nhất một file ảnh PNG cho bước đó, tên theo `NN-<scene>-<step>.png`, được tham chiếu trong `guide.md` bằng đường dẫn tương đối.
- AC-2.2 Given bước có element đích, when chụp, then ảnh có khung highlight quanh element đích và số bước hiển thị gần khung (số khớp với số bước trong văn bản).
- AC-2.3 Given ảnh guide, then không chứa cursor giả và không có hiệu ứng ripple/animation dở dang (ASSUMPTION: guide không cần cursor).
- AC-2.4 Mọi ảnh có alt text không rỗng trong Markdown.

### US-3: Lời hướng dẫn đúng và dễ làm theo
As an end user, I want each step written as a short imperative sentence naming the visible UI label, so that I can follow without guessing.
Priority: Must
- AC-3.1 Given một bước, then văn bản dạng mệnh lệnh ngắn (1 câu chính, tối đa 1 câu bổ sung) viết bằng `language` của spec, dùng đúng nhãn UI nhìn thấy trong ảnh (không dùng selector CSS).
- AC-3.2 Given bước `type/fill`, then giá trị nhập là dữ liệu minh hoạ (không phải giá trị `${ENV}` thật/secret); giá trị mật khẩu luôn hiển thị là placeholder.
- AC-3.3 Guide có: tiêu đề, mô tả mục tiêu 1-2 câu, điều kiện tiên quyết (quyền/tài khoản), danh sách bước, kết quả mong đợi ở cuối.

### US-4: Bảo vệ dữ liệu trong ảnh
As a security-minded owner, I want the same `mask`/`hide` rules as the video to apply to guide screenshots, so that no customer data leaks.
Priority: Must
- AC-4.1 Given `mask` và `hide` trong spec, when chụp, then phần tử khớp selector bị blur/ẩn trong mọi ảnh guide.
- AC-4.2 Given credentials qua `${ENV}`, then không có giá trị secret nào xuất hiện trong `guide.md`, ảnh hay log.
- AC-4.3 Bước đăng nhập trong `setup:` không xuất hiện thành bước trong guide trừ khi được đánh dấu rõ (ASSUMPTION; xem câu hỏi I/G).

### US-5: Duyệt trước khi giao
As a reviewer, I want a preview and a QA pass on the guide, so that I can approve before sharing.
Priority: Should
- AC-5.1 Given guide đã sinh, then có contact sheet/preview tất cả ảnh (tái dùng review) và báo cáo `guide/qa-report.md` liệt kê: bước thiếu ảnh, alt text thiếu, lỗi chính tả, nghi ngờ lộ PII.
- AC-5.2 Agent dừng ở checkpoint chờ người dùng duyệt trước khi bất kỳ thứ gì được xuất/đăng ra ngoài máy.

### US-6: Chạy lại nhanh khi UI đổi (mức tối thiểu)
As a maintainer, I want to re-generate only the images without rewriting text, so that small UI changes are cheap to refresh.
Priority: Could
- AC-6.1 Given guide đã có và văn bản đã chỉnh tay, when chạy lại chế độ "chỉ ảnh", then ảnh được thay mới, văn bản đã chỉnh tay không bị ghi đè.

## 5. Câu hỏi mở (quan trọng nhất)

Cách trả lời nhanh: chỉ cần ghi mã, ví dụ "A1: b, B2: a, ..." hoặc "dùng hết mặc định". Mặc định khuyến nghị được đánh dấu **[Mặc định]**.

### A. Đối tượng & mục đích
- **A1. Người đọc chính là ai?**
  - a) End user của sản phẩm [Mặc định: đa số help doc phục vụ nhóm này, ngôn ngữ đơn giản]
  - b) Admin/IT (cấu hình, quyền)
  - c) Nhân viên Support/CS (dùng để trả lời ticket)
  - d) Khách hàng mới đang onboarding
- **A2. Guide dùng để làm gì?**
  - a) Tài liệu giao kèm khách (deliverable cho từng dự án) 
  - b) Help center công khai của sản phẩm
  - c) Tài liệu nội bộ/training
  - Mặc định: **a** (khớp với định hướng "demo cho khách hàng" của plugin hiện tại).
- **A3. Một guide là bao lớn?**
  - a) 1 tác vụ = 1 guide (how-to ngắn, 5-12 bước) [Mặc định: dễ tìm, dễ bảo trì]
  - b) 1 module = 1 guide gồm nhiều tác vụ
  - c) Cả sản phẩm = 1 manual
- **A4. Tiêu chí thành công đo bằng gì?**
  - a) Người mới làm được tác vụ không cần hỏi (user test nhỏ)
  - b) Giảm số ticket support lặp lại
  - c) Thời gian tạo guide giảm so với làm tay [Mặc định: đo được ngay, không cần dữ liệu hậu mãi]

### B. Nội dung & cấu trúc
- **B1. Cấu trúc tài liệu theo hướng nào?**
  - a) Theo tác vụ (how-to: "Cách tạo hoá đơn") [Mặc định: đúng nhu cầu người đọc]
  - b) Theo màn hình/menu (reference: "Màn hình Hoá đơn")
  - c) Cả hai (Diataxis đầy đủ: tutorial/how-to/reference/explanation) -> để mức C/D
- **B2. Mỗi bước gồm những gì?**
  - a) Câu hướng dẫn + ảnh [Mặc định cho MVP]
  - b) a + ghi chú/cảnh báo/mẹo
  - c) b + kết quả mong đợi mỗi bước
- **B3. Có thêm các mục phụ không?**
  - a) Không (MVP) [Mặc định]
  - b) Điều kiện tiên quyết + kết quả cuối
  - c) b + FAQ + Troubleshooting (lỗi thường gặp, thông báo validation)
  - Mặc định: **b** cho MVP; c ở mức B. Lý do: b gần như miễn phí từ flow, c cần nội dung ngoài flow.
- **B4. Giọng văn?**
  - a) Trang trọng, "Bạn/Quý khách" 
  - b) Thân thiện, ngắn gọn, "Bạn" [Mặc định: help doc hiện đại, dễ đọc]
  - c) Theo guideline có sẵn của công ty (bạn cung cấp)
- **B5. Có cần mục lục, tóm tắt "Trong 30 giây", glossary không?**
  - a) Chỉ mục lục [Mặc định]
  - b) Mục lục + tóm tắt đầu bài
  - c) Thêm glossary thuật ngữ

### C. Ảnh chụp & chú thích
- **C1. Mỗi bước có bao nhiêu ảnh?**
  - a) 1 ảnh toàn màn hình, đã đánh dấu [Mặc định: đơn giản, ổn định]
  - b) 1 ảnh toàn màn hình + 1 ảnh cận cảnh (crop element)
  - c) Before/after (trước và sau khi thao tác)
- **C2. Kiểu chú thích?**
  - a) Khung highlight + số bước [Mặc định: tái dùng overlay, đã có sẵn khung/nhãn]
  - b) a + mũi tên + nhãn text
  - c) Làm mờ/dim phần còn lại (spotlight)
- **C3. Kích thước/độ phân giải ảnh?**
  - a) Viewport như demo (1600x900), 1x [Mặc định: nhất quán, rẻ]
  - b) 2x (retina) để nét khi in/PDF
  - c) Crop vùng liên quan, bỏ chrome thừa
- **C4. Cần ảnh động không?**
  - a) Không, chỉ ảnh tĩnh [Mặc định cho MVP]
  - b) GIF ngắn cho vài bước phức tạp (kéo thả, nhiều ô)
  - c) Nhúng video demo theo mục (tái dùng output của video)
- **C5. Ảnh có cần cả dark mode / nhiều viewport (mobile)?**
  - a) Chỉ light, desktop [Mặc định]
  - b) Thêm dark mode (`colorScheme`)
  - c) Thêm viewport mobile
- **C6. Alt text?**
  - a) AI sinh từ nội dung bước [Mặc định: đạt accessibility, không tốn công]
  - b) Người viết duyệt từng cái
  - c) Không cần

### D. Nguồn đầu vào
- **D1. Guide lấy nội dung từ đâu?**
  - a) Dùng lại thẳng `demo.yaml` (mọi action tương tác thành bước) 
  - b) File riêng `guide.yaml` mô tả tác vụ (có thể tham chiếu/kế thừa selector từ demo.yaml) [Mặc định: demo chỉ phủ "value moments", guide cần phủ đủ bước và đọc ý khác; tách file tránh làm hỏng video]
  - c) Agent tự khám phá app (crawl/`inspect`) rồi tự đề xuất tác vụ
  - d) Kết hợp: demo.yaml làm khởi đầu, `guide.yaml` bổ sung/ghi đè
- **D2. Ai chỉ định danh sách tác vụ cần viết?**
  - a) Người dùng liệt kê [Mặc định]
  - b) Agent đề xuất từ menu/route của app, người dùng duyệt
  - c) Lấy từ ticket/FAQ thật (cần nguồn dữ liệu)
- **D3. Có tài liệu đầu vào khác không (PRD, spec, doc cũ, release notes, mã nguồn)?**
  - a) Không, chỉ app đang chạy [Mặc định]
  - b) Có, agent đọc để hiểu quy tắc nghiệp vụ, trường bắt buộc
  - c) Có doc cũ cần "làm mới" (migrate) sang format mới
- **D4. Bước nào trong flow không nên thành bước guide (đăng nhập, chờ, scroll thẩm mỹ, highlight)?**
  - a) Bỏ `setup:`, `wait`, `scroll`, `highlight`...; chỉ giữ action người dùng thật sự làm [Mặc định]
  - b) Cho phép đánh dấu từng action `guide: skip|include`
  - c) Giữ cả bước đăng nhập (hướng dẫn "cách đăng nhập")

### E. Định dạng xuất & phát hành
- **E1. Định dạng đầu ra đầu tiên?**
  - a) Markdown + thư mục ảnh [Mặc định: dễ review, dễ chuyển đổi sang mọi thứ khác, git-friendly]
  - b) HTML tĩnh (1 file tự chứa hoặc site nhỏ)
  - c) PDF
  - d) DOCX
- **E2. Cần đẩy lên đâu?**
  - a) Không đẩy, chỉ file cục bộ [Mặc định: tuân thủ nguyên tắc "không gửi ra ngoài khi chưa được yêu cầu"]
  - b) Confluence / Notion
  - c) Help center (Zendesk, Intercom, GitBook, Docusaurus...)
  - d) In-app help (JSON cho tooltip/tour)
  - Hỏi thêm: tên nền tảng cụ thể bạn đang dùng?
- **E3. Một file hay nhiều trang?**
  - a) 1 file Markdown/guide [Mặc định MVP]
  - b) Mỗi tác vụ 1 trang + trang chỉ mục (site)
- **E4. Ảnh nhúng hay link?**
  - a) Link tương đối tới file ảnh [Mặc định]
  - b) Nhúng base64 vào 1 file HTML/PDF (gửi email gọn)
  - c) Upload lên CDN/nền tảng đích
- **E5. Công cụ chuyển đổi cho PDF/DOCX?**
  - a) Dùng Chromium sẵn có của Playwright in PDF từ HTML [Mặc định: không thêm dependency]
  - b) Cho phép pandoc (cần cài thêm)
  - c) Chưa cần PDF/DOCX

### F. Brand & template
- **F1. Có cần trang bìa/brand?**
  - a) Có, dùng `brand` trong spec (màu, logo, font) như card video [Mặc định: tái dùng sẵn]
  - b) Có template riêng của công ty (bạn cung cấp)
  - c) Không cần
- **F2. Có bộ template mẫu sẵn (quick start, how-to, admin guide, release notes) hay 1 template duy nhất?**
  - a) 1 template how-to [Mặc định MVP]
  - b) 3-4 template theo loại tài liệu
  - c) Người dùng tự mang template
- **F3. Có tên sản phẩm/thuật ngữ chuẩn (style guide, glossary) phải tuân thủ không?**
  - a) Không [Mặc định]
  - b) Có, cung cấp file glossary/style guide (có thể tái dùng ý tưởng `lexicon` nhưng cho văn bản, không phải giọng đọc)

### G. Ngôn ngữ & bản địa hoá
- **G1. Ngôn ngữ guide?**
  - a) Theo `language` của spec (mặc định tiếng Việt) [Mặc định]
  - b) Song ngữ Vi/En trong cùng guide
  - c) Nhiều bản riêng theo locale
- **G2. Với bản ngôn ngữ khác, ảnh lấy ở đâu?**
  - a) Chạy lại với locale của app để ảnh có UI đúng ngôn ngữ (nếu app hỗ trợ) [Mặc định: guide đúng nghĩa cần ảnh khớp chữ]
  - b) Dùng lại ảnh gốc, chỉ dịch văn bản
  - c) Dịch rồi vẽ đè nhãn (không khuyến nghị)
- **G3. Localizer hiện tại (`agents/localizer.md`) mở rộng làm luôn guide, hay agent mới tự xử lý dịch?**
  - a) Mở rộng localizer [Mặc định: tránh trùng việc]
  - b) Guide-writer tự dịch
- **G4. Nhãn UI trong văn bản: lấy từ ảnh/DOM hiện tại hay từ bảng thuật ngữ?**
  - a) Lấy từ DOM lúc chụp (text thực của nút) [Mặc định: luôn khớp với ảnh]
  - b) Bảng thuật ngữ cố định

### H. Bảo trì & độ mới
- **H1. Khi UI đổi thì làm gì?**
  - a) Chạy lại toàn bộ thủ công [Mặc định MVP]
  - b) Lệnh `guide refresh` chỉ chụp lại ảnh, giữ văn bản đã sửa
  - c) b + visual diff gắn cờ bước nghi lỗi thời
  - d) c + chạy tự động trong CI mỗi lần deploy staging
- **H2. Ngưỡng coi là "UI đổi"?**
  - a) Diff pixel vượt X% vùng quanh element [cần chọn X]
  - b) Selector không còn tìm thấy hoặc nhãn text đổi [Mặc định: ít nhiễu, tận dụng Playwright sẵn có]
  - c) Cả hai
- **H3. Versioning?**
  - a) Không (chỉ bản mới nhất) [Mặc định MVP]
  - b) Gắn version sản phẩm vào metadata/thư mục (`guide/v2.3/`)
  - c) Giữ nhiều version song song trên site
- **H4. Ai chịu trách nhiệm cập nhật nội dung chữ khi nghiệp vụ đổi?**
  - a) Con người sửa tay, agent không đụng vào bước đã sửa [Mặc định]
  - b) Agent viết lại khi flow đổi, hiển thị diff để duyệt

### I. Quyền riêng tư & dữ liệu
- **I1. Môi trường chụp?**
  - a) Chỉ staging/demo với dữ liệu giả [Mặc định: đồng bộ với nguyên tắc hiện có của plugin]
  - b) Được phép production có tài khoản test
  - c) Production dữ liệu thật (không khuyến nghị)
- **I2. Dữ liệu nhập mẫu trong form?**
  - a) Dữ liệu giả cố định do agent chọn (tên, số tiền VN) [Mặc định]
  - b) Người dùng cung cấp bộ dữ liệu mẫu
  - c) Sinh ngẫu nhiên mỗi lần (rủi ro ảnh không ổn định, khó diff)
- **I3. Quét tự động PII/secret trên ảnh trước khi xuất?**
  - a) Chỉ dựa vào `mask`/`hide` + agent QA xem ảnh [Mặc định: không thêm công cụ]
  - b) Thêm OCR quét email/SĐT/token (cần dependency, phức tạp hơn)
- **I4. Bước đăng nhập có hiện thành bước guide không (cần ảnh trang login có field)?**
  - a) Không, chỉ nêu "Đăng nhập vào hệ thống" (không ảnh) [Mặc định]
  - b) Có ảnh trang login với trường trống (không điền)

### J. Tích hợp với squad & command hiện có
- **J1. Agent mới là gì và đứng ở đâu trong pipeline?**
  - a) 1 agent `guide-writer` độc lập, dùng sau khi flow đã green [Mặc định: phụ thuộc rõ ràng flow-engineer, dễ giao]
  - b) Tách 2 agent: `guide-writer` (nội dung) + `screenshot-engineer` (ảnh)
  - c) Mở rộng `flow-engineer` thêm nhiệm vụ guide
- **J2. Command?**
  - a) Thêm `/demo-builder:guide <slug>` [Mặc định, giống mẫu `/demo-builder:package`]
  - b) Chạy trong `/demo-builder:new` tuỳ chọn `--guide`
  - c) Cả hai
- **J3. Vai trò `demo-director`?**
  - a) Director điều phối guide như một nhánh song song sau flow, có checkpoint duyệt [Mặc định]
  - b) Guide hoàn toàn tách, không qua director
- **J4. demo-qa?**
  - a) Mở rộng `demo-qa` có chế độ guide [Mặc định: tái dùng quy trình QA, khung hình, PII]
  - b) Agent QA riêng cho guide
- **J5. Workspace?**
  - a) Cùng `.demo/<slug>/guide/` [Mặc định: một flow, nhiều output]
  - b) Workspace riêng `.guide/<slug>/` (không gắn với video)
  - Câu hỏi kèm theo: có cần guide cho sản phẩm mà không làm video không? Nếu có, tên "demo-builder" còn đúng phạm vi không (có đổi tên/chia plugin không)?
- **J6. Công cụ CLI?**
  - a) Thêm lệnh vào `demo.mjs` (ví dụ `guide`, `guide-status`) và `lib/guide.mjs` [Mặc định: nhất quán kiến trúc]
  - b) Agent tự viết script tạm (kém tái lập)

### K. Chất lượng
- **K1. Bar "done" cho một guide?**
  - a) Mọi bước có ảnh + alt + nhãn UI đúng; QA không có lỗi mức cao; người dùng duyệt [Mặc định]
  - b) a + một người thật chạy thử theo guide (user test)
- **K2. Giới hạn độ dài?**
  - a) Tối đa ~12 bước/tác vụ; dài hơn thì tách [Mặc định: guideline help doc phổ biến]
  - b) Không giới hạn
- **K3. Ai viết lời cuối cùng?**
  - a) AI soạn, người duyệt ở checkpoint [Mặc định]
  - b) AI soạn tự động xuất, không dừng
- **K4. Xử lý ảnh trùng lặp/khác nhau rất ít giữa các bước liên tiếp?**
  - a) Giữ mỗi bước 1 ảnh [Mặc định MVP]
  - b) Gộp (1 ảnh dùng cho nhiều bước nhập liệu liên tiếp trong cùng form)
- **K5. Accessibility của chính tài liệu (alt text, độ tương phản khung, cấu trúc heading)?**
  - a) Có, bắt buộc alt + heading đúng cấp [Mặc định: chi phí thấp]
  - b) Không ưu tiên

## 6. Rủi ro & ngoài phạm vi

### Rủi ro
- R1. `demo.yaml` thiết kế cho video (pacing, `at:`, highlight thẩm mỹ), không phải cho tài liệu đầy đủ -> guide từ flow demo có thể thiếu bước hoặc thừa bước thẩm mỹ. Giảm thiểu: D1/D4.
- R2. Ảnh không ổn định (animation, loading, dữ liệu động) -> ảnh chụp giữa chừng. Cần chờ trạng thái ổn định (`waitFor`) trước khi chụp.
- R3. Action "tạo dữ liệu" không idempotent (đã nêu trong `flow-engineer`) -> chạy lại để refresh có thể tạo bản ghi trùng.
- R4. Overlay hiện thiết kế cho video (cursor, ripple, transition thời gian) -> cần chế độ tĩnh cho ảnh; thay đổi `overlay.mjs` phải giữ tương thích với video.
- R5. Lộ PII/secret qua ảnh hoặc giá trị nhập; ảnh dễ bị chia sẻ rộng hơn video.
- R6. AI viết sai nhãn/đoán sai ý định nghiệp vụ; cần nguồn nhãn lấy từ DOM và checkpoint duyệt.
- R7. Phạm vi nở rộng (publish nhiều nền tảng, in-app help) -> nên khoá phạm vi theo mức A.
- R8. Sai lệch tên/định vị sản phẩm: plugin tên "demo-builder" và mô tả hướng presales; guide hướng post-sales. Cần quyết định có giữ cùng plugin không (J5).
- R9. UI nhiều ngôn ngữ: chụp lại theo locale chỉ đúng nếu app hỗ trợ i18n.
- R10. Phụ thuộc mới (pandoc, thư viện diff ảnh, OCR) làm tăng gánh nặng cài đặt, trái với tính "dependency-light" của toolkit.
- Chưa xác minh: hành vi của overlay/highlight khi chạy `--dry` (có hiển thị khung kịp để chụp không) và cách `screenshot` hoạt động trong dry; cần architect/developer kiểm chứng thực tế.

### Ngoài phạm vi (ứng viên, MVP)
- Đẩy tự động lên Confluence/Notion/Zendesk/Intercom.
- In-app walkthrough/tooltip JSON.
- Visual diff tự động và CI hook (để mức C).
- Tự khám phá và tự đề xuất tác vụ cho toàn bộ app.
- Quản lý nhiều version song song.
- Chỉnh sửa ảnh nâng cao (vẽ tay, làm mờ thủ công).
- Ứng dụng mobile native, desktop app (chỉ web qua Playwright).
- Tìm kiếm, analytics, feedback "bài này có hữu ích không".

## 7. Pipeline đề xuất sau khi bạn trả lời

```
user trả lời câu hỏi mở
  -> business-analyst: chốt requirements (.squad/requirements/user-guide-agent.md), khoá phạm vi MVP
  -> architect: thiết kế (schema guide trong spec hoặc guide.yaml, chế độ chụp tĩnh cho overlay,
                 cấu trúc lib/guide.mjs, ranh giới agent/command, chiến lược stable-screenshot)
  -> developer: lib/guide.mjs + mở rộng overlay (số bước, tắt cursor) + record (chụp theo bước)
                 + lệnh `guide` trong demo.mjs + agent guide-writer + command /demo-builder:guide + skill help-writing
  -> qa-engineer: test trên app mẫu `examples/sample-app` (AC-1..AC-5), kiểm PII/mask, kiểm chạy lại
  -> tech-writer: README (tiếng Việt), cập nhật demo-playbook, tài liệu agent/command mới
  -> (tuỳ chọn) demo-director cập nhật pipeline: thêm nhánh "guide" sau flow-engineer
```

Gợi ý bộ câu trả lời nhanh để vào MVP: dùng toàn bộ **[Mặc định]**, ngoại trừ D1 (chọn a hoặc d nếu muốn thử nhanh nhất với flow có sẵn; b nếu muốn guide đầy đủ), A1/A2 (bạn xác nhận người đọc & mục đích).

Ba câu quyết định lớn nhất (ảnh hưởng thiết kế nhất): **D1** (nguồn đầu vào), **E1/E2** (định dạng & nơi phát hành), **J5** (guide có sống cùng workspace video hay độc lập).

## 8. Quyết định của người dùng (2026-11-25)

| Chủ đề | Quyết định |
|---|---|
| Phạm vi | **Mức A — MVP**, có thêm xuất **PDF** (thiết kế để mở rộng lên B/C) |
| Nguồn đầu vào (D1) | **d)** `demo.yaml` làm nền (selector, setup/login, mask/hide, brand) + `guide.yaml` bổ sung/ghi đè bước, tiêu đề, ghi chú |
| Người đọc (A1) | End user; khách hàng onboarding; Support/nội bộ |
| Định dạng (E1) | **Markdown + ảnh** và **PDF** (in bằng Chromium của Playwright, nhúng font) |
| Ảnh (C1/C2) | Ảnh toàn màn hình có **khung + số bước** (không cursor) + **ảnh cận cảnh** (crop/zoom vùng thao tác) + **mũi tên + nhãn** |
| Nội dung (B2/B3) | Tiêu chuẩn: mục tiêu, điều kiện tiên quyết, các bước (câu mệnh lệnh + ảnh), ghi chú/cảnh báo khi cần, kết quả cuối |
| Tích hợp (J1–J6) | 1 agent mới `guide-writer` + lệnh `/demo-builder:guide` + `lib/guide.mjs` (lệnh trong `demo.mjs`); workspace chung `.demo/<slug>/guide/`; demo-director điều phối như nhánh song song sau flow-engineer |
| Ngôn ngữ (G1) | **Chỉ tiếng Anh** (English only), bất kể `language` của video |
| Khi UI đổi (H1) | **b)** `guide refresh`: chụp lại toàn bộ ảnh, giữ nguyên chữ đã sửa tay |
| QA (K/J4) | Người dùng **duyệt preview trước khi xuất** (checkpoint); chưa mở rộng demo-qa, chưa có "tự làm theo guide" |
| Login & dữ liệu (I1/I2/I4) | Ẩn bước login (chỉ ghi "Sign in to the app", không ảnh); dữ liệu giả cố định; chỉ staging/demo; tái dùng mask/hide |
| Bước tiếp | Chốt requirements (business-analyst) → thiết kế (architect) → **dừng để người dùng duyệt trước khi code** |
