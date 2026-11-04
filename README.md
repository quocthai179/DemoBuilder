# DemoBuilder

**Bộ plugin Claude Code giúp bạn làm video demo sản phẩm cho khách hàng**: lên kịch bản, tự động quay các thao tác trên giao diện, lồng tiếng AI (có tiếng Việt), chèn phụ đề, nhạc nền, dựng video, kiểm tra chất lượng và soạn sẵn email/bài đăng để gửi khách hàng.

> *A Claude Code plugin with a squad of 10 agents and a Playwright + ffmpeg toolkit that turns your web app into a narrated customer demo video — script, automated screen recording, AI voice-over (incl. Vietnamese), captions, music, editing, QA, localisation and launch copy.*

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
| 🔒 **Bảo vệ dữ liệu** | `mask:` làm mờ email/SĐT/dữ liệu khách; `hide:` ẩn chat widget, banner; mật khẩu qua biến môi trường; đăng nhập ngoài khung hình |
| 🎙️ **Lồng tiếng** | Edge TTS miễn phí (`vi-VN-HoaiMyNeural`, `vi-VN-NamMinhNeural`), OpenAI, ElevenLabs, Google, giọng thu của bạn; từ điển phát âm (`CRM → "xê rê em"`) |
| ⏱️ **Đồng bộ hình–tiếng** | Quay theo độ dài lời thoại, mốc `at:` để thao tác rơi đúng câu nói; quay lại từng cảnh riêng lẻ |
| 🎬 **Dựng video** | Card mở đầu/kết thúc theo brand, nhạc nền tự giảm âm khi có lời (ducking), chuẩn hoá loudness, phụ đề .srt/.vtt hoặc burn-in, chapters YouTube |
| 📐 **Nhiều định dạng** | MP4 16:9 1080p, dọc 9:16, vuông 1:1, GIF preview, thumbnail có tiêu đề |
| ✅ **QA** | Trích khung hình mỗi cảnh, contact sheet, đo loudness, phát hiện khoảng lặng, lời đọc quá nhanh, sai độ dài; agent QA soi lỗi chính tả, lộ dữ liệu, sai màn hình |
| 🌏 **Bản địa hoá** | Chuyển sang ngôn ngữ khác với giọng bản xứ, quay lại theo locale hoặc tái sử dụng footage |
| 📣 **Copy bán hàng** | Tiêu đề, mô tả + chapters, email gửi khách, bài LinkedIn, talking points cho sales |

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

Tham chiếu đầy đủ: [`skills/demo-toolkit/references/spec-reference.md`](skills/demo-toolkit/references/spec-reference.md).

### Dùng toolkit trực tiếp (không cần agent)

```bash
T=skills/demo-toolkit/scripts/demo.mjs
node $T doctor
node $T init .demo/my-demo --title "My demo" --url https://staging.example.com
node $T validate .demo/my-demo/demo.yaml
node $T inspect https://staging.example.com --spec .demo/my-demo/demo.yaml   # liệt kê selector
node $T build .demo/my-demo/demo.yaml          # tts → record → assemble → review
node $T record .demo/my-demo/demo.yaml --scenes approve   # quay lại 1 cảnh
```

Thử ngay với app mẫu kèm theo:

```bash
cp -r skills/demo-toolkit/examples/sample-app /tmp/sample-app
node skills/demo-toolkit/scripts/demo.mjs build /tmp/sample-app/demo.yaml --provider silent
```

(`--provider silent` dùng giọng câm để thử nhịp; bỏ đi để dùng Edge TTS khi đã `pip install edge-tts`.)

## Cấu trúc repo

Gốc repo chính là plugin (có cả `plugin.json` lẫn `marketplace.json`), nên vừa cài được qua marketplace, vừa tải lên dạng file zip được.

```
.claude-plugin/
├── plugin.json        # manifest của plugin
└── marketplace.json   # marketplace trỏ về "./"
agents/                # 10 agent
commands/              # 12 slash command
skills/
├── demo-playbook/     # quy trình, phân vai, workspace
├── demo-toolkit/      # CLI demo.mjs (Playwright + ffmpeg), spec reference, template, app mẫu
├── scriptwriting/     # cẩm nang viết kịch bản demo
└── voiceover/         # cẩm nang lồng tiếng & phát âm
```

### Tải lên dạng file zip (claude.ai / Cowork)

Nén **nội dung** của repo (để `.claude-plugin/plugin.json` nằm ngay ở gốc file zip, không bọc trong thư mục con):

```bash
git archive --format=zip -o demo-builder.zip HEAD
```

## Lưu ý

- Chỉ quay trên môi trường demo/staging với dữ liệu giả; agent QA sẽ chặn dữ liệu cá nhân lọt vào khung hình nhưng bạn vẫn nên xem lại trước khi gửi.
- Nhạc nền/hình ảnh phải có bản quyền phù hợp; nhân bản giọng nói chỉ khi người đó đồng ý.
- Toolkit chạy cục bộ; không có gì được tải lên hay gửi đi trừ khi bạn yêu cầu (các nhà cung cấp TTS trả phí nhận văn bản lời thoại).

## License

MIT
