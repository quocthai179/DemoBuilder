# DemoBuilder

**Bộ plugin Claude Code giúp bạn làm video demo sản phẩm cho khách hàng**: lên kịch bản, tự động quay các thao tác trên giao diện, lồng tiếng AI (có tiếng Việt), chèn phụ đề, nhạc nền, dựng video, kiểm tra chất lượng và soạn sẵn email/bài đăng để gửi khách hàng.

> *A Claude Code plugin with a squad of 11 agents and a Playwright + ffmpeg toolkit that turns your web app into a narrated customer demo video — script, automated screen recording, AI voice-over (incl. Vietnamese), captions, music, editing, QA, localisation and launch copy.*

```
Brief → Kịch bản → Luồng UI ─┐
                  Lồng tiếng ─┴→ Quay màn hình → Dựng video → QA ⟲ → Copy gửi khách
                                                               └→ Bản địa hoá
```

## Tính năng

| | |
|---|---|
| 🎯 **Chiến lược & brief** | Xác định người xem, nỗi đau, 2–4 "khoảnh khắc giá trị", storyline, CTA |
| ✍️ **Kịch bản** | Storyboard theo cảnh, lời thoại viết để *nghe*, ngân sách số từ theo độ dài (tiếng Việt ~165 từ/phút) |
| 🖱️ **Quay UI tự động** | Playwright điều khiển app thật: con trỏ di chuyển mượt, hiệu ứng click, gõ phím như người, highlight / spotlight / chú thích, zoom vào chi tiết, cuộn mượt |
| 🔒 **Bảo vệ dữ liệu** | `mask:` làm mờ email/SĐT/dữ liệu khách trong video (ảnh hướng dẫn thì che bằng ô xám đặc); `hide:` ẩn chat widget, banner; mật khẩu qua biến môi trường; đăng nhập ngoài khung hình |
| 🎙️ **Lồng tiếng** | Edge TTS miễn phí (`vi-VN-HoaiMyNeural`, `vi-VN-NamMinhNeural`), OpenAI, ElevenLabs, Google, giọng thu của bạn; từ điển phát âm (`CRM → "xê rê em"`) |
| ⏱️ **Đồng bộ hình–tiếng** | Quay theo độ dài lời thoại, mốc `at:` để thao tác rơi đúng câu nói; quay lại từng cảnh riêng lẻ |
| 🎬 **Dựng video** | Card mở đầu/kết thúc theo brand, nhạc nền tự giảm âm khi có lời (ducking), chuẩn hoá loudness, phụ đề .srt/.vtt hoặc burn-in, chapters YouTube |
| 📐 **Nhiều định dạng** | MP4 16:9 1080p, dọc 9:16, vuông 1:1, GIF preview, thumbnail có tiêu đề |
| ✅ **QA** | Trích khung hình mỗi cảnh, contact sheet, đo loudness, phát hiện khoảng lặng, lời đọc quá nhanh, sai độ dài; agent QA soi lỗi chính tả, lộ dữ liệu, sai màn hình |
| 🌏 **Bản địa hoá** | Chuyển sang ngôn ngữ khác với giọng bản xứ, quay lại theo locale hoặc tái sử dụng footage |
| 📣 **Copy bán hàng** | Tiêu đề, mô tả + chapters, email gửi khách, bài LinkedIn, talking points cho sales |
| 📘 **Hướng dẫn sử dụng** | Từ cùng luồng `demo.yaml`: tài liệu từng bước bằng tiếng Anh (Markdown + ảnh chụp có khung/số bước/mũi tên + PDF), làm mới ảnh khi giao diện đổi |

## Cài đặt

Trong Claude Code:

```
/plugin marketplace add quocthai179/DemoBuilder
/plugin install demo-builder@demo-builder
```

Công cụ cần có trên máy: **Node.js ≥ 18**, **ffmpeg**, và Playwright + Chromium. Chạy lệnh sau trong Claude Code để kiểm tra và cài phần còn thiếu:

```
/demo-builder:doctor
```

(Lệnh này dùng `node demo.mjs setup` để cài Playwright + `yaml` vào `~/.cache/demo-builder`; giọng miễn phí cần thêm `pip install edge-tts`.)

## Bắt đầu nhanh

```
/demo-builder:new https://staging.acme.vn — demo tính năng duyệt hoá đơn cho khách hàng ngân hàng ABC, 2 phút, tiếng Việt, giọng nữ
```

Đội agent sẽ: viết brief → viết kịch bản → **dừng để bạn duyệt** → dựng luồng thao tác + tạo giọng đọc → quay → dựng → QA → **dừng để bạn duyệt bản cuối** → soạn email/bài đăng. Kết quả nằm trong `.demo/<slug>/output/`.

### Các lệnh

| Lệnh | Việc làm |
|---|---|
| `/demo-builder:new <mô tả>` | Làm trọn gói một video demo |
| `/demo-builder:brief` | Viết/cập nhật brief |
| `/demo-builder:script` | Viết, rút gọn, đổi giọng văn kịch bản |
| `/demo-builder:flow` | Dựng luồng thao tác UI, selector, đăng nhập, che dữ liệu |
| `/demo-builder:voice` | Chọn giọng, sửa phát âm, tạo lại lồng tiếng |
| `/demo-builder:record` | Quay / quay lại cảnh |
| `/demo-builder:edit` | Dựng, nhạc, phụ đề, xuất định dạng, thumbnail |
| `/demo-builder:review` | QA bản dựng và vòng sửa lỗi |
| `/demo-builder:retake <slug> <cảnh> <vấn đề>` | Sửa nhanh một cảnh |
| `/demo-builder:localize <slug> <ngôn ngữ>` | Làm bản ngôn ngữ khác |
| `/demo-builder:package <slug>` | Soạn copy: tiêu đề, mô tả, email, social, talking points |
| `/demo-builder:guide <slug> [refresh\|approve]` | Tạo hướng dẫn sử dụng từng bước (Markdown + ảnh + PDF) từ luồng demo; `refresh` chụp lại ảnh |
| `/demo-builder:doctor` | Kiểm tra / cài công cụ |

### Đội agent

| Agent | Vai trò |
|---|---|
| `demo-director` | Đạo diễn/nhà sản xuất: lập kế hoạch, giao việc, duyệt từng bước |
| `demo-strategist` | Chiến lược presales: người xem, nỗi đau, khoảnh khắc giá trị, CTA |
| `scriptwriter` | Biên kịch: storyboard, lời thoại |
| `flow-engineer` | Kỹ sư luồng UI: selector, thao tác, đăng nhập, dữ liệu demo, che dữ liệu |
| `voice-producer` | Sản xuất giọng đọc: chọn giọng, phát âm, tạo audio |
| `screen-recorder` | Quay phim: quay theo lời thoại, quay lại, căn thời gian |
| `video-editor` | Dựng phim: card, nhạc, phụ đề, xuất bản |
| `demo-qa` | Kiểm định: soi từng khung hình, lộ dữ liệu, nhịp độ, âm lượng |
| `localizer` | Bản địa hoá |
| `launch-copywriter` | Copy ra mắt & bán hàng |
| `guide-writer` | Biên soạn hướng dẫn sử dụng: chọn bước, dữ liệu mẫu giả, viết văn bản tiếng Anh, PDF |

## demo.yaml — một file mô tả cả video

```yaml
title: "Duyệt hoá đơn trong 30 giây"
language: vi-VN
baseUrl: https://staging.acme.vn
voice: { provider: edge, voice: vi-VN-HoaiMyNeural, lexicon: { VAT: "vê a tê" } }
mask: [".customer-email"]
setup:                                   # đăng nhập ngoài khung hình
  - goto: /login
  - fill: { selector: "#email", text: "${DEMO_USER}" }
  - fill: { selector: "#password", text: "${DEMO_PASSWORD}" }
  - click: "button[type=submit]"
scenes:
  - id: intro
    type: card
    title: "Duyệt hoá đơn trong 30 giây"
    narration: Mỗi cuối tháng, đội kế toán mất hai ngày để duyệt hoá đơn. Hãy xem cách rút xuống còn ba mươi giây.
  - id: approve
    url: /invoices
    chapter: "Duyệt hoá đơn"
    narration: Mở danh sách hoá đơn, chọn những hoá đơn hợp lệ và bấm Duyệt hàng loạt.
    actions:
      - click: "[data-testid=select-valid]"
      - at: 4
      - spotlight: { selector: "[data-testid=bulk-approve]", label: "Duyệt 120 hoá đơn cùng lúc" }
      - click: "[data-testid=bulk-approve]"
```

Tham chiếu đầy đủ: [`skills/demo-toolkit/references/spec-reference.md`](plugins/demo-builder/skills/demo-toolkit/references/spec-reference.md).

### Dùng toolkit trực tiếp (không cần agent)

```bash
T=plugins/demo-builder/skills/demo-toolkit/scripts/demo.mjs
node $T doctor
node $T init .demo/my-demo --title "My demo" --url https://staging.example.com
node $T validate .demo/my-demo/demo.yaml
node $T inspect https://staging.example.com --spec .demo/my-demo/demo.yaml   # liệt kê selector
node $T build .demo/my-demo/demo.yaml          # tts → record → assemble → review
node $T record .demo/my-demo/demo.yaml --scenes approve   # quay lại 1 cảnh
```

Thử ngay với app mẫu kèm theo:

```bash
cp -r plugins/demo-builder/skills/demo-toolkit/examples/sample-app /tmp/sample-app
node plugins/demo-builder/skills/demo-toolkit/scripts/demo.mjs build /tmp/sample-app/demo.yaml --provider silent
```

(`--provider silent` dùng giọng câm để thử nhịp; bỏ đi để dùng Edge TTS khi đã `pip install edge-tts`.)

## Hướng dẫn sử dụng từng bước (user guide)

Từ luồng thao tác đã chạy xanh (`record --dry`), plugin tạo thêm một tài liệu hướng dẫn **tiếng Anh**: mỗi bước một câu mệnh lệnh, kèm ảnh toàn màn hình có khung + số bước + mũi tên + nhãn và ảnh cận cảnh.

```
/demo-builder:guide acme-crm             # tạo mới → dừng để bạn duyệt contact sheet + guide-draft.pdf
/demo-builder:guide acme-crm refresh     # giao diện đổi: chụp lại ảnh, giữ nguyên văn bản
/demo-builder:guide acme-crm approve     # sau khi bạn đồng ý: guide-draft.pdf → guide.pdf
```

Tuỳ chọn nằm trong `.demo/<slug>/guide.yaml` (không bắt buộc, không ảnh hưởng video):

```yaml
version: 1
title: Add a new contact
goal: Create a contact record so your sales team can follow up.
scenes: [add-contact]                  # chỉ cảnh này tạo ra các bước
steps:
  add-contact.3: { value: "Jane Doe" } # dữ liệu giả cố định cho ô nhập
  add-contact.5: { warning: "Each run creates a new contact. Use a test workspace." }
```

- `guide.md` do bạn sửa tay được; công cụ không bao giờ ghi đè sau lần tạo đầu.
- Ảnh được chụp ở locale `en-US`, không có con trỏ; `mask:`/`hide:` của demo vẫn áp dụng; trong ảnh hướng dẫn mỗi phần tử bị `mask:` và mọi phần tử con của nó (kể cả iframe cùng origin) được che hoàn toàn bằng ô xám đặc (redact, không phải làm mờ; kèm lớp làm mờ CSS và `contain: paint` để nội dung tràn ra ngoài bị cắt), kể cả ảnh cận cảnh và ảnh lỗi. Trước mỗi ảnh công cụ gắn lại lớp CSS nếu trang đã gỡ nó, cảnh báo `MASK_CSS_DEFEATED` nếu trang vô hiệu hoá lớp làm mờ, phần tử là `display:contents` hoặc chữ nằm ngoài hộp của phần tử và con của nó (hãy xem ảnh), và dừng với `MASK_NOT_APPLIED` nếu không vẽ được ô xám hoặc có chữ mà không có hộp nào. `SharedWorker` bị tắt khi chụp hướng dẫn. Không che được: shadow DOM đóng, bên trong iframe khác origin mà Playwright không truy cập được, chữ `::after` của phần tử con, điểm ảnh canvas/ảnh, chữ `<option>` hiển thị bởi `<select>` chưa mask, cùng dữ liệu hiện ở nơi khác (tiêu đề trang, URL), phần tử top-layer (`<dialog>`, popover) mà không selector nào khớp. Hạn chế đã biết: video vẫn chỉ làm mờ `blur(7px)`, chữ lớn có thể còn đọc được (sẽ làm sau). Nếu app không đổi ngôn ngữ, nhãn trên màn hình được trích nguyên văn kèm chú thích tiếng Anh và có cảnh báo.
- Luồng có bước lưu/gửi sẽ tạo dữ liệu mỗi lần chụp (chỉ cảnh báo) — dùng môi trường demo/staging. Chỉ host cục bộ theo nghĩa hẹp (loopback `127.0.0.0/8`/`::1`, `localhost`, `*.localhost`, `*.test`, giao thức `file:`; IP nội bộ RFC1918, link-local và `*.local` KHÔNG tính là cục bộ), host nằm trong `env: { allow: [host, ...] }` của `guide.yaml`, hoặc host bạn xác nhận bằng `--confirm-env=<host[,host]>` (chỉ nhận đúng tên host, không dùng ký tự đại diện; `env.allow` chỉ nhận `*.example.com` có ít nhất hai nhãn sau `*.`, `*.com` bị từ chối; ký tự đại diện trên public suffix như `*.co.uk`, `*.com.vn`, `*.github.io`, `*.vercel.app` cũng bị từ chối) mới được chạy; mọi host khác (kể cả tên có vẻ là staging như `staging.*`, `*.dev`, `*.qa`) dừng với `ENV_UNCONFIRMED`, và `--confirm-env` trơn không có tác dụng. Khi chụp, mọi request của context chụp và của `setup:` đều đi qua cổng này: mọi điều hướng (khung chính, popup/`target=_blank`, `<iframe src>`), mọi WebSocket và mọi request ghi (không phải GET/HEAD/OPTIONS, ví dụ fetch/XHR `POST`) tới host chưa được duyệt bị chặn trước khi gửi và dừng với `ENV_UNCONFIRMED` (thông báo nêu host và phương thức); service worker bị tắt; request đọc (GET) của tài nguyên phụ tới host ngoài, như CDN, vẫn chạy nhưng được ghi lại và liệt kê trong cảnh báo `ENV_CONTACTED_UNAPPROVED` (host và phương thức). Rủi ro còn lại: redirect không chặn trước được (Playwright không định tuyến các bước nhảy redirect), nên chính request bị redirect đến host chưa được duyệt một lần (redirect 307/308 của một POST giữ nguyên phương thức và nội dung); ngay sau đó cờ dừng được bật, mọi request tiếp theo tới host này bị huỷ và capture dừng trước hành động kế tiếp. `steps.json` ghi `env.confirmed`, `env.contacted` (danh sách host) và `env.contactedMethods` (số request theo host và phương thức, `file:` cho trang cục bộ). `mask`/`hide` phải là selector CSS đầy đủ: selector thiếu dấu đóng (`"`, `(`, `[`, `/*`, `\` cuối dòng) bị từ chối với `MASK_INVALID` ở `guide capture`, `validate` và `record`. Chỉ bạn quyết định xác nhận hoặc thêm host vào `env.allow`.
- Giá trị `${ENV}` (mật khẩu, token) không bao giờ xuất hiện trong ảnh/văn bản: ô nhập không phải mật khẩu mà dùng `${ENV}` phải có `value:` giả trong `guide.yaml`, nếu không `capture` dừng với `SECRET_VALUE` (áp dụng cho mọi cảnh, kể cả cảnh không liệt kê trong `scenes`, cho cả `select`; `${ENV}` trong `press`/`evaluate` ngoài `setup:` bị từ chối; không kiểm tra được ô nhập thì cũng dừng). `mask:`/`hide:` phải là selector CSS thuần: selector sai hoặc kiểu Playwright (`text=`, `:has-text()`) dừng với `MASK_INVALID`, mask không khớp phần tử nào cảnh báo `MASK_UNMATCHED`; nhãn của phần tử bị mask không bao giờ lấy từ DOM (dùng `label:` trong `guide.yaml`). Bước `manual:` có `verb:` (`look` mặc định, `find`, `click`, `type`, `select`, `check`, `hover`) quyết định động từ ở nhãn ảnh và câu hướng dẫn. `render` thoát mã 1 và không ghi gì nếu có lỗi (thiếu ảnh, alt rỗng, ảnh từ xa, lộ bí mật).
- Dùng trực tiếp: `node $T guide <plan|capture|render|refresh|approve> .demo/<slug>/demo.yaml` (`--confirm-env=<host[,host]>`, `--headed`, `--json`; với `--json` stdout chỉ có JSON, lỗi in `{ok:false, code, error}`). Mã thoát: 1 = lỗi, 2 = `refresh` thấy luồng đã đổi các bước (không file nào bị sửa). `capture` chỉ tạo `guide.md` nếu chưa có; nếu luồng đổi, `guide.md` được sao lưu vào `guide/history/` và cảnh báo `MERGE_NEEDED`.

Kết quả:

```
.demo/<slug>/
├── guide.yaml
└── guide/
    ├── guide.md  guide.skeleton.md  steps.json
    ├── images/        # 01-add-contact-1.png, 01-add-contact-1-closeup.png, ...
    ├── preview/contact-sheet.png
    ├── errors/        # error-*.png khi chụp lỗi
    ├── history/       # bản sao lưu guide.md khi luồng đổi
    └── guide-draft.pdf  →  guide.pdf + approval.json (sau khi duyệt)
```

## Cấu trúc repo

```
.claude-plugin/marketplace.json
plugins/demo-builder/
├── .claude-plugin/plugin.json
├── agents/        # 11 agent
├── commands/      # 13 slash command
└── skills/
    ├── demo-playbook/     # quy trình, phân vai, workspace
    ├── demo-toolkit/      # CLI demo.mjs (Playwright + ffmpeg), spec reference, template, app mẫu
    ├── scriptwriting/     # cẩm nang viết kịch bản demo
    └── voiceover/         # cẩm nang lồng tiếng & phát âm
```

## Lưu ý

- Chỉ quay trên môi trường demo/staging với dữ liệu giả; agent QA sẽ chặn dữ liệu cá nhân lọt vào khung hình nhưng bạn vẫn nên xem lại trước khi gửi.
- Nhạc nền/hình ảnh phải có bản quyền phù hợp; nhân bản giọng nói chỉ khi người đó đồng ý.
- Toolkit chạy cục bộ; không có gì được tải lên hay gửi đi trừ khi bạn yêu cầu (các nhà cung cấp TTS trả phí nhận văn bản lời thoại).

## License

MIT
