# ADR-0005: Render PDF — tập con Markdown → HTML in (file://) → `page.pdf()` Chromium, font hệ thống nhúng, chặn mạng
Status: Proposed
Date: 2026-11-25

## Context
- FR-21/22, NFR-3/4, AC-6.1–6.4: PDF dựng bằng Chromium của Playwright, nhúng font, theo brand, không thêm dependency nặng (không pandoc), không mạng, phản ánh đúng `guide.md` hiện tại (kể cả chữ sửa tay), không cắt ảnh qua trang.
- Toolkit không có dependency Markdown: chỉ `playwright` và `yaml` (`demo.mjs:62`). `cards.mjs` dựng HTML bằng `page.setContent` với ảnh data URI (`cards.mjs:8,54`).
- Thử nghiệm (Playwright 1.63, scratchpad):
  - `setContent` + `<img src="file://…">` → ảnh **không** tải được;
  - `goto('file://…/guide.html')` + `src` tương đối → ảnh được nhúng;
  - `pdffonts` báo font hệ thống (Inter) `emb yes, sub yes`;
  - `tagged:true` → PDF `Tagged: yes`.

## Options considered
| Option | Pros | Cons |
|---|---|---|
| A. pandoc / wkhtmltopdf | Markdown đầy đủ | Dependency nặng, trái NFR-4 |
| B. npm `marked`/`markdown-it` | Markdown đầy đủ, nhỏ | Thêm dependency mới vào runtime cài qua `setup`; cần đổi `setup`/`doctor`; lệch nguyên tắc "dependency-light" |
| C. Bộ chuyển tập con Markdown tự viết (`lib/guide-md.mjs`) theo đúng cấu trúc skeleton + `goto file://guide.html` + `page.pdf` | Không dependency; khớp marker (ADR-0001); escape HTML thô → an toàn + offline | Tập con giới hạn (tài liệu hoá; cú pháp lạ hiển thị như văn bản) |
| D. Dựng HTML từ `steps.json` thay vì `guide.md` | Đơn giản | Mất chữ sửa tay → trái FR-22/Q2 (b) |

## Decision
Chọn **C**.
- **Tập con Markdown được hỗ trợ:**
  - heading `#`–`####`, đoạn văn;
  - `**b**`, `*i*`, `` `code` ``, link;
  - list `-`/`*`/`1.`;
  - blockquote với `Note/Warning/Tip` → `aside.callout`;
  - ảnh một dòng → `figure.full|closeup`; `---`;
  - marker `guide:step` → `section.step`; comment khác bị bỏ;
  - HTML thô bị escape.
- **HTML in:**
  - `@page` A4 (hoặc `pdf.format`);
  - trang bìa theo `brand` (background/text/primary/logo dạng data URI); tiêu đề lấy từ guide, không lấy `spec.title`;
  - `section.step, figure { break-inside: avoid }`; ảnh full `max-height: 120mm`, cận cảnh `max-width: 60%; max-height: 70mm`;
  - footer có số trang.
- **PDF:**
  - `page.route` chỉ cho phép `file:`/`data:`;
  - `goto(file://guide/guide.html)`;
  - chờ `document.fonts.ready`;
  - `page.pdf({ printBackground, displayHeaderFooter, tagged:true, outline:true })` → `guide-draft.pdf` (tmp + rename). Nếu option không được hỗ trợ thì retry không `tagged/outline` và cảnh báo.
- **Font:**
  - dùng `brand.font` (CSS stack). Chromium nhúng subset của font thực dùng;
  - **không bundle** font vào plugin;
  - `guide.yaml pdf.fonts` cho phép khai báo file font cục bộ (`@font-face url(file://…)`);
  - `FONT_FALLBACK` khi family đầu không có.
- **Contact sheet:** `preview/contact-sheet.html` → `screenshot({fullPage:true})`. Không refactor `review.mjs` (tránh rủi ro cho QA video).
- **Nháp/duyệt (Q4 a):**
  - render chỉ ghi `guide-draft.pdf`, không watermark trong nội dung;
  - `guide approve` kiểm tra hash trong `render.json`, rồi `rename` → `guide.pdf`.

## Consequences
- Không thêm dependency; render chạy offline (AC-6.4).
- Người dùng muốn định dạng Markdown phức tạp (bảng, HTML) sẽ thấy nó hiển thị như văn bản. Có thể mở rộng tập con sau.
- Vì nội dung PDF nháp và PDF đã duyệt giống hệt nhau, trạng thái "nháp" chỉ thể hiện bằng tên file. Đây đúng là quyết định Q4 (a).
