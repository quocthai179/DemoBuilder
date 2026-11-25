# Design: User guide writer (`guide-writer` + `/demo-builder:guide` + `lib/guide.mjs`)
Requirements: .squad/requirements/user-guide-writer.md (FINAL MVP; mục 12 = câu trả lời ràng buộc Q1–Q5)
Discovery: .squad/requirements/user-guide-agent-discovery.md mục 8
ADR: .squad/adr/0001 … 0005
Ngày: 2026-11-25 · Tác giả: software-architect · Trạng thái: Proposed (chờ người dùng duyệt trước khi code)

> Văn xuôi tiếng Việt, định danh tiếng Anh. Mọi dẫn chứng `file:line` tính từ
> `plugins/demo-builder/skills/demo-toolkit/scripts/` trừ khi ghi khác.

---

## 0. Kết quả xác minh trên code thật (trước khi thiết kế)

| # | Câu hỏi mở trong requirements | Kết quả (đã chạy thử trên bản sao `examples/sample-app` trong scratchpad) | Dẫn chứng |
|---|---|---|---|
| V1 | Overlay có chạy trong `--dry` không? | **Có.** `addInitScript(overlayInit)` luôn được gọi, chỉ `recordVideo` bị bỏ khi dry. | `lib/record.mjs:204-207` |
| V2 | `screenshot` có bị bỏ qua khi dry không? | **Không.** Action `screenshot` luôn chụp (không có guard dry). | `lib/record.mjs:148` |
| V3 | Highlight trong dry có chụp được sạch không? | **Không.** `.__demo-hl`/`.__demo-callout` có `transition .3s` + `requestAnimationFrame` → ảnh chụp ngay sau đó (và sau `wait: 400`, vì `wait` là no-op khi dry) cho ra khung/nhãn **mờ dở dang** (ghosting). | `lib/overlay.mjs:334-341,387,395`; `lib/record.mjs:118,126` |
| V4 | Cursor/ripple có lọt vào ảnh dry không? | **Có.** Cursor hiển thị khi `cursor.show` (mặc định true) và ripple được vẽ vì `Director.act` vẫn gọi `overlay('ripple')` khi dry. Có thể tắt **chỉ bằng config** `cursor: { show:false, clickRipple:false }` truyền vào `overlayInit`, không sửa code overlay. | `lib/overlay.mjs:330,378`; `lib/record.mjs:88,98,105,107,108`; `lib/spec.mjs:220` |
| V5 | `mask`/`hide` có áp dụng trong dry không? | **Có.** Email `.email` bị blur trong ảnh dry. CSS mask/hide được tiêm khi `root()` chạy (DOMContentLoaded/mousemove). | `lib/overlay.mjs:345-346,367-368` |
| V6 | `Director` có dùng lại được từ module khác? | **Chưa.** `class Director` không được export; `resolveUrl` cũng không; `runActions` ghi ảnh lỗi cứng vào `spec.dirs.recordings`. | `lib/record.mjs:11,26,159` |
| V7 | Có thể lấy lại được việc action nào dùng `${ENV}` sau khi `loadSpec`? | **Không.** `interpolateEnv` thay giá trị lúc load, thông tin nguồn bị mất. | `lib/spec.mjs:249-261,310,327` |
| V8 | PDF bằng Chromium: ảnh + font offline? | `page.setContent()` + `<img src="file://…">` → **ảnh bị chặn** (PDF chỉ có icon 14×16). `page.goto('file://…/guide.html')` + `src="images/…"` tương đối → ảnh 1280×720 được nhúng. `pdffonts` cho thấy font hệ thống (Inter) **được nhúng (subset)**. `page.pdf({ tagged:true, outline:true })` → `Tagged: yes` với Playwright 1.63. | thí nghiệm scratchpad; `lib/cards.mjs:54` (cards dùng `setContent` + data URI) |
| V9 | Môi trường | Node v22.23.5; Playwright 1.63.0 cài global (`/opt/node22/lib/node_modules`), Chromium qua `PLAYWRIGHT_BROWSERS_PATH`; npm `yaml` **không có** → fallback python3 PyYAML hoạt động; ffmpeg/ffprobe có; `pdffonts`/`pdfinfo` có (chỉ dùng cho QA, không phải dependency). `record --dry` sample-app pass trong ~2,4 s. | `lib/util.mjs:196-206`, `lib/spec.mjs:232-239` |
| V10 | Repo có test runner? | **Không.** Không có `package.json`, không có thư mục test, không có CI. Node ≥ 18 có sẵn `node:test` (không cần dependency). | `find . -name package.json` → rỗng |
| V11 | CLI có hỗ trợ subcommand 2 cấp? | **Chưa.** `main()` chỉ lấy `[cmd, target]`. | `demo.mjs:125-127` |

Hệ quả thiết kế: **không** dùng action `highlight`/`screenshot` của video để chụp guide; chạy flow bằng một runner riêng của guide tái dùng `Director` ở chế độ dry, vẽ chú thích tĩnh bằng một hàm browser-side mới không có transition, chụp với `animations: 'disabled'`.

---

## 1. Overview

Một lệnh `/demo-builder:guide <slug> [refresh]` khởi chạy agent `guide-writer`. Agent điều khiển một nhóm lệnh **xác định (deterministic)** mới của toolkit: `node demo.mjs guide <plan|capture|render|refresh|approve> <spec>`, toàn bộ nằm trong `lib/guide.mjs`. Toolkit chạy lại flow `demo.yaml` (đã pass `record --dry`) trong một browser context riêng cho guide (locale `en-US` theo `guide.yaml`, không video, không cursor/ripple). **Trước** mỗi action tương tác, toolkit chụp ảnh toàn viewport có khung + badge số + mũi tên + nhãn, và một ảnh cận cảnh. Sau đó nó ghi `steps.json` (hợp đồng dữ liệu) và một **skeleton** `guide.skeleton.md` với văn mẫu. Agent viết văn xuôi tiếng Anh vào `guide.md`, chỉ trong các vùng có marker. Toolkit render `guide.md` → `guide.html` → `guide-draft.pdf` + contact sheet. Người dùng duyệt xong thì `guide approve` đổi tên `guide-draft.pdf` thành `guide.pdf`. `refresh` chỉ chụp lại ảnh (giữ nguyên tên file) và render lại. Lệnh này **không bao giờ ghi `guide.md`**.

### 1.1 Phân vai xác định vs agent (ADR-0001)

| Phần | Ai làm | Ghi chú |
|---|---|---|
| Đọc/validate `demo.yaml` + `guide.yaml`, chọn bước, đánh số, step id, tên file | Toolkit | `guide plan` |
| Phân loại môi trường (local/staging/unknown) và chặn khi chưa xác nhận | Toolkit | `--confirm-env` |
| Chạy flow, chụp ảnh, vẽ chú thích, crop cận cảnh, đọc nhãn DOM, phát hiện lệch locale | Toolkit | `guide capture` |
| Văn mẫu tối thiểu (câu template, alt text template, các mục `TODO(guide)`) | Toolkit | `guide.skeleton.md`; đủ để test mà không cần LLM |
| Câu hướng dẫn (1 câu mệnh lệnh + ≤ 1 câu phụ), tiêu đề task, goal, prerequisites bổ sung, expected result, note/warning khi cần, alt text tốt hơn | **Agent `guide-writer`** | Viết vào `guide.md`, giữ nguyên marker và dòng ảnh |
| Chọn dữ liệu giả cố định cho `type`/`fill`/`select` | **Agent** → ghi `value:` vào `guide.yaml` **trước** capture | FR-13; giá trị cố định giữa các lần chạy |
| Render HTML/PDF, contact sheet, kiểm tra (ảnh thiếu, alt rỗng, secret, TODO, lệch đánh số) | Toolkit | `guide render` |
| Checkpoint duyệt, quyết định approve | **Người dùng** (main session chạy `guide approve` sau khi người dùng đồng ý rõ ràng) | FR-25/26 |

### 1.2 Sơ đồ thành phần

```mermaid
flowchart LR
  subgraph Workspace[".demo/<slug>/"]
    DY[demo.yaml] ; GY[guide.yaml optional]
    subgraph G["guide/"]
      SJ[steps.json] ; IMG[images/NN-scene-step(.closeup).png] ; SK[guide.skeleton.md]
      MD[guide.md] ; HT[guide.html] ; DP[guide-draft.pdf] ; P[guide.pdf] ; CS[preview/contact-sheet.png]
      RJ[render.json] ; AJ[approval.json] ; ERR[errors/error-*.png] ; HIS[history/]
    end
  end
  CMD["/demo-builder:guide"] --> GW[agent guide-writer]
  GW -->|plan/capture/render/refresh| CLI["demo.mjs guide …"]
  CLI --> GL[lib/guide.mjs]
  GL --> SP[lib/spec.mjs loadSpec + loadYaml]
  GL --> RC["lib/record.mjs Director, resolveUrl, prepareSession (exported)"]
  GL --> OV["lib/overlay.mjs overlayInit (cursor off) + guideAnnotate/guideClear (new)"]
  GL --> MDR["lib/guide-md.mjs mdToHtml (new)"]
  GL --> UT[lib/util.mjs]
  DY --> GL ; GY --> GL
  GL --> SJ & IMG & SK & HT & DP & CS & RJ
  GW -->|writes prose| MD
  CMD -->|after explicit user approval| AP["demo.mjs guide approve"] --> P & AJ
```

### 1.3 Sequence: `/demo-builder:guide <slug>` (lần đầu)

```mermaid
sequenceDiagram
  actor U as User
  participant M as Main session (/demo-builder:guide)
  participant A as guide-writer
  participant T as demo.mjs guide (lib/guide.mjs)
  participant B as Chromium (Playwright)
  M->>A: brief: slug, mode=generate
  A->>T: validate <spec>; guide plan <spec> --json
  T-->>A: steps[], env.class, warnings (TOO_MANY_STEPS, …)
  alt env.class == unknown (production-like)
    A-->>M: Status needs-input: xác nhận môi trường
    M->>U: hỏi; U xác nhận → M relaunch A với "env confirmed"
  end
  A->>A: ghi/cập nhật guide.yaml (value: dữ liệu giả cho type/fill/select; chỉ thêm khoá)
  A->>T: guide capture <spec> [--confirm-env] --json
  T->>B: newContext(locale=en-US, no video) + overlayInit(cursor off, mask/hide)
  T->>B: prepareSession(setup/auth, save=false)
  loop mỗi action của mỗi screen scene
    alt action là STEP
      T->>B: resolve target, scroll vào view, chờ ổn định, đọc nhãn DOM
      T->>B: guideAnnotate(full) → screenshot viewport → guideAnnotate(closeup) → screenshot clip → guideClear
    end
    alt action không phải VISUAL_ONLY
      T->>B: Director.act(action') (dry=true, value override)
    end
  end
  T-->>A: guide/.staging → images/ (dir swap), steps.json, guide.skeleton.md, guide.md (chỉ khi chưa có)
  A->>A: đọc steps.json + xem ảnh; viết văn xuôi vào guide.md
  A->>T: guide render <spec>
  T->>B: goto file://guide.html → pdf(tagged, outline) ; contact sheet
  T-->>A: guide-draft.pdf, preview/contact-sheet.png, render.json, findings
  A-->>M: Status needs-input + preview + cảnh báo (locale, tạo dữ liệu, >12 bước, env)
  M->>U: trình contact sheet + PDF nháp
  alt U duyệt rõ ràng
    M->>T: guide approve <spec>
    T-->>M: guide.pdf + approval.json
  else U yêu cầu sửa
    M->>A: relaunch với feedback (lặp render/preview)
  end
```

### 1.4 Sequence: `/demo-builder:guide <slug> refresh`

```mermaid
sequenceDiagram
  participant M as Main session
  participant A as guide-writer
  participant T as demo.mjs guide refresh
  participant B as Chromium
  M->>A: brief: slug, mode=refresh
  A->>T: guide refresh <spec> [--confirm-env]
  T->>T: buildPlan() và so signature với guide/steps.json
  alt signature khác (bước thêm/bớt/đổi thứ tự/đổi action)
    T-->>A: exit 2 + diff (added/removed/moved) — KHÔNG chạm file nào
    A-->>M: needs-input: liệt kê điểm lệch + lựa chọn (sửa flow / tái sinh có merge)
  else signature khớp
    T->>B: capture vào guide/.staging (như trên)
    alt lỗi giữa chừng
      T-->>A: exit 1, errors/error-*.png; images/, steps.json, guide.md, PDF cũ nguyên vẹn
    else thành công
      T->>T: swap images/, ghi steps.json, skeleton; KHÔNG ghi guide.md
      T->>T: render → guide-draft.pdf (guide.pdf cũ giữ nguyên tới khi approve)
      T-->>A: warnings LABEL_CHANGED / SELECTOR_CHANGED / LOCALE_MISMATCH
      A-->>M: needs-input + preview (checkpoint bắt buộc, AC-8.5)
    end
  end
```

---

## 2. Components & responsibilities

| Component | Change | Notes |
|---|---|---|
| `scripts/lib/guide.mjs` | **New (L)** | `guideCli`, `loadGuideConfig`, `buildPlan`, `classifyEnv`, `capture`, `writeSkeleton`, `render`, `refresh`, `approve`, `scanSecrets` |
| `scripts/lib/guide-md.mjs` | **New (M)** | `mdToHtml(md)` cho tập con Markdown, `parseStepBlocks(md)`, `printHtml(...)`, `contactSheetHtml(...)` — tách riêng để unit-test không cần browser |
| `scripts/lib/overlay.mjs` | **Modified (S)** | Thêm 2 export browser-side mới `guideAnnotate(opts)`, `guideClear()`; **không sửa** `overlayInit` |
| `scripts/lib/record.mjs` | **Modified (S/M)** | `export class Director`, `export function resolveUrl`; `runActions(actions, label, { errorDir } = {})`; tách `prepareSession()` (di chuyển nguyên văn dòng 190-201) và `record()` gọi lại nó |
| `scripts/lib/spec.mjs` | **Modified (S)** | `export function loadYaml`; gắn `envRefs: string[]` cho action/setup có `${VAR}` |
| `scripts/demo.mjs` | **Modified (S)** | Case `guide` với subcommand thứ 2; booleans `confirm-env`, `json`; HELP; `init` thêm dòng `.gitignore` |
| `agents/guide-writer.md` | **New (M)** | Agent mới |
| `commands/guide.md` | **New (S)** | Lệnh `/demo-builder:guide <slug> [refresh]` + approve |
| `agents/demo-director.md` | **Modified (S)** | Thêm `guide-writer` vào squad, nhánh guide sau flow-engineer |
| `skills/demo-playbook/SKILL.md` | **Modified (S)** | Roster, pipeline "User guide", workspace `guide.yaml` + `guide/`, checkpoint |
| `skills/demo-toolkit/SKILL.md` | **Modified (S)** | Bảng lệnh `guide …` |
| `skills/demo-toolkit/references/spec-reference.md` | **Modified (S)** | Mục `guide.yaml`, option `guideId` của action, file sinh ra |
| `README.md`, `plugins/demo-builder/.claude-plugin/plugin.json` | **Modified (S)** | 11 agent / 13 lệnh; mô tả |
| `tests/guide/*.test.mjs`, `tests/fixtures/guide-app/` (repo root) | **New (M)** | `node --test`; không ship trong plugin |

Không đổi: `assemble.mjs`, `review.mjs`, `tts.mjs`, `cards.mjs`, `overlayInit`. `record()` chỉ đổi cấu trúc (extract hàm), hành vi giữ nguyên (FR-29).

---

## 3. Data model

### 3.1 Workspace

```
.demo/<slug>/
├── demo.yaml                  # nguồn flow (không đổi; có thể thêm khoá thụ động guideId vào action)
├── guide.yaml                 # tuỳ chọn; KHÔNG BAO GIỜ được đọc bởi record/assemble (FR-3)
└── guide/
    ├── guide.md               # nguồn sự thật của VĂN BẢN sau lần tạo đầu; toolkit không bao giờ ghi đè
    ├── guide.skeleton.md      # toolkit sinh lại mỗi lần capture (tham chiếu để merge)
    ├── steps.json             # hợp đồng capture → agent/render
    ├── images/                # toolkit-owned: NN-<scene>-<step>.png, NN-<scene>-<step>-closeup.png
    ├── assets/                # ảnh do người dùng tự thêm; toolkit không chạm
    ├── guide.html             # bản in (render)
    ├── guide-draft.pdf        # render; trạng thái nháp (Q4 a)
    ├── guide.pdf              # chỉ có sau `guide approve`
    ├── render.json            # manifest hash của lần render
    ├── approval.json          # manifest lần duyệt
    ├── preview/contact-sheet.png (+ contact-sheet.html)
    ├── history/guide.md.<stamp>   # backup khi plan đổi
    ├── errors/error-<scene>-<i>.png
    └── .staging/              # tạm; xoá khi lỗi hoặc sau khi swap
```

`init` thêm vào `.gitignore` của workspace: `guide/.staging/`, `guide/errors/`. `clean` (kể cả `--all`) **không** chạm `guide/` (`demo.mjs:112-122` chỉ xoá các dir video; giữ nguyên).

### 3.2 `guide.yaml` schema (v1)

| Key | Kiểu | Mặc định | Ý nghĩa |
|---|---|---|---|
| `version` | `1` | `1` | Phiên bản schema |
| `locale` | BCP-47 | `en-US` | Locale browser **chỉ cho capture guide** (L3). Không ảnh hưởng `spec.locale` của video |
| `title` | string | – | Tiêu đề task (skeleton). Thiếu → `TODO(guide): title` |
| `goal` | string | – | 1–2 câu mục tiêu |
| `prerequisites` | string[] | `[]` | Điều kiện tiên quyết bổ sung |
| `signIn` | bool | `true` nếu `spec.setup.length > 0 \|\| spec.auth` | Thêm dòng đầu `Sign in to the app.` (FR-7, không ảnh, không credential) |
| `expectedResult` | string | – | Kết quả mong đợi |
| `scenes` | string[] | mọi scene `screen` | Scene nào **đóng góp bước**; scene khác vẫn chạy để giữ trạng thái |
| `steps` | map `<ref>` → StepOverride | `{}` | Ghi đè theo bước (mục 3.3) |
| `manual` | ManualStep[] | `[]` | Bước thêm tay tham chiếu selector (không thực thi action) |
| `mask`, `hide` | string[] | `[]` | **Bổ sung** (cộng dồn) vào `spec.mask`/`spec.hide` chỉ cho ảnh guide; không thể bớt |
| `capture.padding` | px | `48` | Padding cận cảnh |
| `capture.closeupMin` | `{width,height}` | `{360, 200}` | Kích thước tối thiểu vùng crop |
| `capture.settleMs` | ms | `1500` | Thời gian tối đa chờ phần tử đứng yên |
| `capture.timeout` | ms | `15000` | Chờ phần tử visible (như `Director.box`, `record.mjs:54`) |
| `capture.parkMouse` | bool | `false` | `true` = dời chuột ra góc dưới phải trước khi chụp (mặc định giữ như dry để không đóng menu hover) |
| `capture.freshSession` | bool | `false` | `true` = bỏ qua `auth.storageState` khi chạy setup (khi app nhớ ngôn ngữ trong session) |
| `pdf.format` | `A4`/`Letter` | `A4` | Khổ giấy (ASSUMPTION A4 dọc từ requirements) |
| `pdf.fonts` | `{family, file, weight?, style?}[]` | `[]` | File font cục bộ (đường dẫn tương đối guide.yaml) → `@font-face`; không mạng |

**StepOverride** (`steps.<ref>`): `include: true` (bật action mặc định không-bước như `hover`, `goto`), `skip: true`, `title`, `text`, `note`, `warning`, `label` (chữ trên nhãn ảnh), `value` (dữ liệu giả cho `type`/`fill`/`select`). `include` và `skip` cùng lúc → lỗi.

**ManualStep**: `id` (bắt buộc, `^[a-zA-Z][a-zA-Z0-9_-]*$`), đúng một trong `after: <ref>` | `before: <ref>`, `selector` (bắt buộc), `nth`, `verb` (`click|type|select|check|hover|look`, mặc định `look`, chỉ để chọn câu template), `title`, `text`, `note`, `warning`, `label`. Bước tay **chỉ chụp**, không thực thi gì, để không làm lệch trạng thái flow đã kiểm chứng.

**Ref (định danh bước ổn định).** `<sceneId>.<n>`, trong đó `n` là vị trí 1-based của action trong `scenes[].actions` của scene đó, đếm **mọi** action, đúng như thứ tự nhìn thấy trong YAML. Dạng khác: `<sceneId>.<guideId>` khi action có khoá thụ động `guideId` (ví dụ `- click: { selector: "#save", guideId: save }`). `normaliseAction` đã giữ khoá phụ (`spec.mjs:274,280`) và `Director.act` bỏ qua khoá lạ, nên khoá này không đổi hành vi video. Scene id không chứa `.` (`spec.mjs:317`), nên tách ref ở dấu `.` đầu tiên. Step id của bước tay là `<sceneId của anchor>.<manual.id>`. `guideId`/`manual.id` phải bắt đầu bằng chữ cái để không trùng chỉ số.

**Tên file (FR-15):** `NN-<sceneId>-<local>.png` và `NN-<sceneId>-<local>-closeup.png`; `NN` = số bước 2 chữ số (01..99, >99 → 3 chữ số kèm cảnh báo), `local` = `n` hoặc `guideId`/`manual.id`. Ví dụ `03-add-contact-3.png`.

**Validate (FR-4).** Mỗi lỗi sau làm lệnh dừng (DemoError), liệt kê **tất cả** ref sai một lần:
- scene không tồn tại hoặc là `card`;
- `n` ngoài khoảng;
- `guideId` không tìm thấy hoặc bị trùng trong scene;
- `include` + `skip` cùng lúc;
- `value` đặt cho action không phải `type`/`fill`/`select`;
- bước tay thiếu `selector`, có cả `after` và `before`, hoặc anchor sai;
- khoá lạ ở top-level hoặc StepOverride (bắt lỗi chính tả).

**Merge với demo.yaml.** Spec giữ nguyên quyền với flow, selector, `setup`/`auth`, `mask`/`hide` (guide chỉ cộng thêm), `brand`, `viewport`, `colorScheme`, `timezone`, `baseUrl`, `ignoreHTTPSErrors`. `guide.yaml` chỉ ảnh hưởng: locale của context guide, chọn bước, chữ, giá trị giả, tham số chụp/PDF. `loadGuideConfig(spec)` trả về object mới, **không mutate `spec`**.

**Quy tắc chọn bước (FR-5/6):**

| Lớp | Action | Trong guide capture |
|---|---|---|
| STEP (mặc định là bước) | `click, dblclick, type, fill, select, check, uncheck, upload, press` | chụp trước, rồi thực thi |
| STATE (thực thi, không là bước; `include` được) | `goto, reload, hover, moveTo, scroll, waitFor, waitForUrl, wait (no-op như dry), evaluate` | thực thi; `hover`/`goto` chỉ thành bước khi `include` |
| VISUAL_ONLY (bỏ qua hoàn toàn) | `highlight, spotlight, callout, clear, zoom, unzoom, caption, at, screenshot` | **không thực thi**: chỉ vẽ overlay video/biến đổi `body`/ghi file vào `review/`, không đổi trạng thái app |

`setup:` luôn chạy off-camera và không bao giờ thành bước (BR-3). Scene `card` không thành bước; `title`/`subtitle` của card chỉ được đưa vào `steps.json.task.hints` (FR-8).

**Ví dụ cho sample-app** (`.demo/acme-crm/guide.yaml`):

```yaml
version: 1
locale: en-US
title: Add a new contact
goal: Create a contact record so your sales team can follow up.
expectedResult: The new contact appears at the top of the Customers list.
scenes: [add-contact]          # dashboard tour scene contributes no steps
steps:
  add-contact.3: { value: "Jane Doe" }
  add-contact.4: { value: "jane.doe@example.com", note: "The email address is blurred in screenshots for privacy." }
  add-contact.5: { warning: "Each run creates a new contact. Use a test workspace." }
manual:
  - id: new-row
    after: add-contact.5
    selector: "#rows tr:first-child"
    label: New contact
```

Không có `guide.yaml` → 5 bước (`add-contact.1..5`); `dashboard` (highlight/at/zoom) và card scenes → 0 bước (AC-1.2/1.3).

### 3.3 `guide/steps.json` (contract v1)

```jsonc
{
  "version": 1,
  "spec": "demo.yaml", "guideConfig": "guide.yaml" /* hoặc null */,
  "capturedAt": "2026-11-25T10:00:00Z",
  "playwright": "1.63.0",
  "viewport": { "width": 1280, "height": 720 },
  "locale": { "requested": "en-US", "navigatorLanguage": "en-US", "pageLangs": ["vi"], "mismatch": true, "mismatchSteps": [1,2,3,4,5] },
  "env": { "class": "local", "hosts": ["file"], "confirmed": false },
  "task": {
    "title": "Add a new contact", "goal": "…", "prerequisites": ["Sign in to the app."], "expectedResult": "…",
    "signIn": false, "hints": { "specTitle": "Acme CRM — …", "cardTitles": ["Acme CRM", "Dùng thử miễn phí 14 ngày"] }
  },
  "plan": { "signature": "9f2c…(util.hash 16 hex)", "steps": [ { "n": 1, "id": "add-contact.1", "action": "click" } ] },
  "steps": [
    {
      "n": 3, "id": "add-contact.3", "source": "flow",            // "flow" | "manual"
      "ref": { "scene": "add-contact", "index": 3, "guideId": null },
      "action": "type", "selector": "#name", "nth": null, "key": null,
      "value": "Jane Doe", "valueSource": "guide.yaml",            // "spec" | "guide.yaml" | "redacted" | null
      "valueRedacted": false,
      "page": { "title": "Acme CRM", "path": "file:///…/index.html" },   // origin+pathname, không query/hash (NFR-1)
      "target": {
        "found": true, "visible": true, "count": 1, "tag": "input", "role": "textbox", "inputType": "text",
        "label": "Tên khách hàng", "labelSource": "placeholder",   // label|aria-label|aria-labelledby|placeholder|title|innerText|value(button)|focused|none
        "isPassword": false, "box": { "x": 68, "y": 147, "width": 320, "height": 41 }, "scrolled": false
      },
      "annotation": { "label": "Type in \"Tên khách hàng\"", "placement": "below", "badge": { "x": 54, "y": 133 } },
      "images": {
        "full": "images/03-add-contact-3.png",
        "closeup": "images/03-add-contact-3-closeup.png",          // null khi không có đích (press không focus)
        "clip": { "x": 20, "y": 99, "width": 416, "height": 200 }
      },
      "overrides": { "title": null, "text": null, "note": null, "warning": null, "label": null },
      "flags": { "localeMismatch": true, "mutatingHint": false, "ambiguous": false, "targetHidden": false, "noTarget": false },
      "template": { "title": "Type in \"Tên khách hàng\"", "text": "In the **Tên khách hàng** field, type `Jane Doe`.",
                    "altFull": "Step 3: the \"Tên khách hàng\" field is highlighted", "altCloseup": "Close-up of the \"Tên khách hàng\" field" }
    }
  ],
  "warnings": [
    { "code": "LOCALE_MISMATCH", "steps": [1,2,3,4,5], "message": "App UI did not switch to en-US; quote on-screen labels verbatim (L2)." },
    { "code": "DATA_CREATING", "steps": [5], "message": "…" },
    { "code": "TOO_MANY_STEPS", "message": "…" }            // > 12 bước (FR-32)
  ]
}
```

Bảng mã cảnh báo:
- `TOO_MANY_STEPS`: hơn 12 bước.
- `LOCALE_MISMATCH`: UI không chuyển sang locale guide.
- `DATA_CREATING`: có bước có khả năng tạo dữ liệu (Q5 a).
- `AMBIGUOUS_TARGET`: selector khớp > 1 phần tử và không có `nth`.
- `TARGET_HIDDEN`: phần tử đích bị `hide` hoặc không visible.
- `NO_TARGET`: `press` không có phần tử focus.
- `ENV_UNCONFIRMED`: môi trường chưa xác nhận.

Chỉ dùng khi refresh:
- `LABEL_CHANGED`: nhãn DOM khác lần trước.
- `SELECTOR_CHANGED`: selector khác lần trước.

Chỉ dùng khi render:
- `OVERRIDE_NOT_APPLIED`
- `STEP_MARKERS_MISMATCH`
- `FONT_FALLBACK`
- `TODO_PLACEHOLDER`

Quy tắc bảo mật của contract (NFR-1, FR-13):
- `value` = `"••••••"` + `valueRedacted: true` khi input là password hoặc action có `envRefs`.
- `target.label` không bao giờ lấy `.value` của input; chỉ lấy `.value` của `input[type=submit|button]`.
- Không có cookie, storageState hay URL query.

---

## 4. API / interface contracts

### 4.1 CLI (`demo.mjs`)

`main()` (`demo.mjs:125`) đổi thành `const { _: [cmd, target, arg2], flags } = parseArgs(…, [...cũ, 'confirm-env', 'json'])`. Thêm `case 'guide'`: `sub = target`, spec = `loadSpec(arg2 || flags.spec || 'demo.yaml')`. `loadSpec` báo `Spec not found` (`spec.mjs:291`) **trước** khi tạo bất kỳ thư mục nào, nên đáp ứng AC-1.6.

| Lệnh | Mô tả | Ghi | Exit |
|---|---|---|---|
| `guide plan <spec> [--json]` | Load + validate `guide.yaml`, dựng danh sách bước, phân loại env, cảnh báo. Không mở browser | không ghi file | 0 / 1 (ref sai, FR-4) |
| `guide capture <spec> [--confirm-env] [--headed] [--json]` | Chạy flow, chụp vào `.staging`, swap, ghi `steps.json`, `guide.skeleton.md`, `guide.md` (chỉ khi chưa có). Plan đổi so với `steps.json` cũ và `guide.md` tồn tại → backup `history/guide.md.<stamp>` + cảnh báo "merge needed" | `guide/**` trừ `guide.md` đã có | 0 / 1 (lỗi flow FR-31, env chưa xác nhận, secret) |
| `guide render <spec> [--json]` | `guide.md` → `guide.html` → `guide-draft.pdf`; `preview/contact-sheet.png`; `render.json`; kiểm tra | các file render | 0 (có thể có warn) / 1 (ảnh thiếu, alt rỗng, secret, URL từ xa) |
| `guide refresh <spec> [--confirm-env] [--json]` | So plan signature → capture (staging) → swap → render. Không ghi `guide.md` | như capture+render | 0 / 1 lỗi / **2 plan mismatch** (in diff, không đổi file nào) |
| `guide approve <spec>` | Kiểm tra `render.json` khớp hash hiện tại của `guide.md` + ảnh, không còn `TODO(guide)` → `rename(guide-draft.pdf → guide.pdf)`, ghi `approval.json` | `guide.pdf`, `approval.json` | 0 / 1 (chưa render, đã sửa sau render, còn TODO) |

`--json` in một object `{ ok, steps:[{n,id,action,label,images}], warnings:[…], files:{…} }` ra stdout để agent đọc. Log tiến độ (NFR-8): `• step 03 add-contact.3 type #name → images/03-add-contact-3.png`, **không** in value.

### 4.2 `lib/guide.mjs` (exports)

```js
export const STEP_ACTIONS = new Set(['click','dblclick','type','fill','select','check','uncheck','upload','press']);
export const VISUAL_ONLY = new Set(['highlight','spotlight','callout','clear','zoom','unzoom','caption','at','screenshot']);
export function guideDir(spec)                                  // spec.abs('guide')
export function loadGuideConfig(spec)                           // → GuideConfig (defaults merged); throws DemoError listing all bad keys/refs
export function parseRef(ref)                                   // 'add-contact.3' → { scene, index|guideId }
export function buildPlan(spec, cfg)                            // → { steps: PlanStep[], signature, warnings, env, task }
export function planSignature(steps)                            // util.hash(steps.map(s => [s.n, s.id, s.action]))
export function diffPlans(oldSteps, newSteps)                   // → { added:[], removed:[], moved:[], changedAction:[] }
export function classifyEnv(spec)                               // → { class: 'local'|'staging'|'unknown', hosts: [] }
export async function capture(spec, cfg, { confirmEnv, headed, strictSignature } = {}) // → steps.json object
export function writeSkeleton(spec, cfg, stepsDoc)              // → markdown string; writes guide.skeleton.md (+ guide.md if missing)
export async function render(spec, cfg)                         // → { html, pdf, sheet, findings }
export async function refresh(spec, cfg, opts)                  // capture({strictSignature:true}) + render
export function approve(spec)                                   // → { pdf, approval }
export function secretValues(spec)                              // values of ${VAR} referenced in raw spec file (len ≥ 4)
export function scanSecrets(texts, secrets)                     // → [{ file, varName, line }]
export async function guideCli(sub, spec, flags)
```

`classifyEnv` xét `baseUrl` và mọi `scene.url`/`goto.url` tuyệt đối:
- `local`: `file:`, `localhost`, `127.0.0.0/8`, `::1`, `*.local`, `*.test`, `*.localhost`, IP private `10/8`, `172.16/12`, `192.168/16`.
- `staging`: có nhãn hostname khớp `/(^|[.-])(staging|stage|stg|demo|dev|test|qa|uat|sandbox|preview)([.-]|$)/i`.
- `unknown`: các trường hợp còn lại, coi như production-like. `capture`/`refresh` từ chối (exit 1, mã `ENV_UNCONFIRMED`) nếu thiếu `--confirm-env` (FR-14, AC-5.4).

### 4.3 `lib/record.mjs` (thay đổi export)

```js
export function resolveUrl(spec, url)                           // unchanged body (record.mjs:11-16)
export class Director { … }                                     // unchanged body; only `export`
//   runActions(actions, label, { errorDir = this.spec.dirs.recordings } = {})   // default = hành vi cũ (record.mjs:159)
export async function prepareSession(browser, spec, ctxOpts, { save = true, fresh = false } = {})
//   = nguyên văn record.mjs:190-201: storageState từ auth (trừ khi fresh), chạy setup trong context riêng với Director dry,
//     trả storageState; chỉ writeJson(auth.save) khi save === true. record() gọi prepareSession(browser, spec, ctxOpts) → không đổi hành vi.
```

### 4.4 `lib/overlay.mjs` (export mới, browser-side, tự chứa)

```js
export function guideAnnotate(o)
// o = { rect:{x,y,width,height}|null, n:number, label:string|null, mode:'full'|'closeup',
//       color, font, masks:string[], pad:8 }
// Vẽ #__guide-annot (position:fixed; pointer-events:none; z-index 2147483600; KHÔNG transition/animation):
//  - box: border 3px solid color + outline 2px #fff + shadow (tương phản trên nền sáng/tối, NFR-5)
//  - badge: vòng tròn 30px, nền color, chữ số trắng hoặc #111827 (chọn theo tương phản WCAG ≥ 4.5 tính trong guide.mjs)
//  - label pill + arrow SVG (chỉ mode 'full'): chọn vị trí trong [below, above, right, left] đầu tiên không cắt
//    target, không cắt rect của phần tử khớp masks, nằm trọn viewport; fallback 'below' clamp.
//  - rect null (press không đích): chỉ label pill góc trên-giữa "Press Enter", không box/arrow.
// Trả { placement, badge:{x,y} }.
export function guideClear()                                    // xoá #__guide-annot
```

Gọi bằng `page.evaluate(guideAnnotate, opts)`: Playwright serialise hàm nên hàm phải tự chứa, giống quy ước `overlayInit` (`overlay.mjs:4`). Không dùng `addInitScript`, nên không có trạng thái dư sau navigation.

### 4.5 `lib/spec.mjs`

- `export function loadYaml(text, file)`: chỉ thêm `export` (`spec.mjs:232`).
- Trong `loadSpec`, với mỗi action của scene và `setup` thì tính `envRefs = [...JSON.stringify(raw).matchAll(ENV_RE)].map(m => m[1])` **trước** `interpolateEnv`. Nếu không rỗng, gán `action.envRefs = envRefs`. Không consumer nào serialise action (đã grep `tts.mjs`/`assemble.mjs`/`review.mjs`: hash audio chỉ dùng narration/voice, `tts.mjs:120`), nên video không đổi.

---

## 5. Key flows

### 5.1 Capture (thiết kế chi tiết)

1. **Tiền kiểm (không browser):**
   - `loadGuideConfig` → `buildPlan`, dừng nếu ref sai (FR-4).
   - `classifyEnv`: `unknown` mà thiếu `--confirm-env` thì dừng.
   - **Guard secret (FR-13):** STEP `type`/`fill` có `envRefs` và **không** có `value` override thì dừng, trừ khi đích là `input[type=password]`; việc kiểm tra password làm lúc chạy, xem bước 4. Thông báo nêu ref và tên biến, không nêu giá trị.
2. **Browser:**
   - `chromium.launch({ headless: !headed, args: ['--hide-scrollbars', '--disable-blink-features=AutomationControlled'] })`, giống `record.mjs:176`.
   - `ctxOpts = { viewport: spec.viewport, deviceScaleFactor: 1, locale: cfg.locale, colorScheme: spec.colorScheme || 'light', timezoneId: spec.timezone, ignoreHTTPSErrors: !!spec.ignoreHTTPSErrors }`. Khác `record.mjs:186-189` **duy nhất** ở `locale`.
   - `storageState = await prepareSession(browser, spec, ctxOpts, { save: false, fresh: cfg.capture.freshSession })`. **Không ghi `auth.save`**, để không đưa session tạo dưới locale `en-US` vào lần quay video sau (ADR-0003).
   - `ctx = newContext({ ...ctxOpts, storageState })`, không `recordVideo`.
   - `ctx.addInitScript(overlayInit, { cursor: { ...spec.cursor, show: false, clickRipple: false }, mask: [...spec.mask, ...cfg.mask], hide: [...spec.hide, ...cfg.hide], primary: spec.brand.primary, font: spec.brand.font, hideScrollbars: spec.hideScrollbars !== false })`. Cursor bị ẩn bằng `display:none` (`overlay.mjs:330`), còn ripple return sớm (`overlay.mjs:378`). **Không sửa `overlayInit`.**
   - `d = new Director(page, spec, { dry: true })`.
3. **Điều hướng:** chạy **toàn bộ** scene `screen` theo thứ tự, không có warm-up chọn lọc. Scene đầu: `s.url` → `d.goto(s.url)`, nếu không có thì khi action đầu không phải `goto` và có `baseUrl` → `d.goto(spec.baseUrl)`. Các scene sau: có `s.url` thì `d.goto(s.url)`. Đây là đúng ngữ nghĩa của `record.mjs:223-239` khi không lọc scene.
4. **Với mỗi action `a` (index `i`, ref `scene.(i+1)`):**
   - Nếu `a.name ∈ VISUAL_ONLY` thì bỏ qua.
   - Nếu là bước (STEP và không `skip`, hoặc `include`), hoặc có bước tay `before` anchor này, thì **chụp trước khi thực thi** (ASSUMPTION của requirements được giữ: ảnh ở trạng thái ngay trước thao tác, để modal/dropdown còn hiện):
     1. Resolve target qua `d.locator(a.selector, a)`, tức `nth` hoặc `.first()` (`record.mjs:48-52`). Ghi `count = page.locator(sel).count()`, nếu > 1 mà không có `nth` thì `AMBIGUOUS_TARGET`. Với `press`, target = `document.activeElement` nếu khác `body`, nếu không thì `noTarget`. Với `upload`, nếu input không visible sau 2 s thì thử `label[for=id]` hoặc `closest('label')`, không được thì `targetHidden`, ảnh không box, kèm cảnh báo.
     2. `b = await d.box(loc, { timeout: cfg.capture.timeout })`: chờ visible, cuộn vào giữa khi ngoài viewport (`record.mjs:53-64`). Timeout ở đây = lỗi flow (FR-31). Nếu phần tử bị `hide` (display:none), action gốc cũng sẽ lỗi; trường hợp này được báo `TARGET_HIDDEN` kèm gợi ý thay vì crash im lặng.
     3. **Ổn định (FR-11):**
        - `waitForLoadState('networkidle', { timeout: 1500 }).catch()`;
        - `document.fonts.ready`;
        - lặp đọc `boundingBox` cách 120 ms tới khi 2 lần bằng nhau, tối đa `settleMs`;
        - hai `requestAnimationFrame`.
        Nếu `parkMouse` thì `page.mouse.move(vw-1, vh-1)`.
     4. `target = await loc.evaluate(describeTarget)`. Hàm này lấy nhãn theo thứ tự `el.labels[0].innerText` → `aria-label` → `aria-labelledby` → `placeholder` → `title` → `innerText` (button/link) → `value` (chỉ `input[type=submit|button]`) → `name`. Kết quả được trim, gộp khoảng trắng, cắt 80 ký tự. Hàm trả thêm `tag`, `role`, `inputType`, `isPassword`, `document.documentElement.lang`, `document.title`. Nếu `envRefs` có mà `!isPassword` và không có override → dừng (guard bước 1).
     5. `annotation = await page.evaluate(guideAnnotate, { rect: b, n, label: annLabel, mode: 'full', … })`, với `annLabel = override.label ?? VERB[action] + ' "' + target.label + '"'` cắt 40 ký tự. `page.screenshot({ path: staging/full, animations: 'disabled', caret: 'hide' })`: toàn viewport, 1x (NFR-6).
     6. `page.evaluate(guideAnnotate, { …, mode: 'closeup' })` (giữ box + badge, bỏ arrow/label). Tính `clip = pad(b, padding)`, nới tới `closeupMin` quanh tâm, clamp vào viewport, sau đó `page.screenshot({ path: staging/closeup, clip, animations: 'disabled' })`. Chọn clip của page thay vì `locator.screenshot`, vì clip giữ được padding/ngữ cảnh và mask/annotation đang có trên trang (FR-12, AC-3.4).
     7. `page.evaluate(guideClear)`.
   - Với bước tay neo `before`/`after`: chụp tương tự trên `selector` của nó (không thực thi).
   - **Thực thi:** nếu action không phải VISUAL_ONLY thì `await d.act(a')`, với `a' = { ...a, text|value: override.value }` cho `type`/`fill`/`select`. Lỗi trong khi chụp hoặc thực thi sẽ dừng ngay (mục 5.3).
5. **Phát hiện tạo dữ liệu (Q5 a):** `mutatingHint` = action `click`/`dblclick`/`press Enter` mà target là `button[type=submit]`/`input[type=submit]`, nằm trong `form`, hoặc nhãn khớp `/\b(save|create|add|submit|send|confirm|delete|remove|post|publish|pay|import|lưu|tạo|thêm|gửi|xoá|xóa)\b/i`. Gộp thành cảnh báo `DATA_CREATING` (chỉ cảnh báo).
6. **Hoàn tất (atomic, AC-8.4):**
   - `staging/images` → `images.new`; copy các file trong `images/` **không** khớp `^\d{2,3}-.+\.png$` (ảnh lạ do người dùng bỏ vào) sang, kèm cảnh báo khuyên dùng `assets/`;
   - `rename(images → images.old)`, `rename(images.new → images)`, `rm images.old`;
   - ghi `steps.json` (write tmp + rename), `guide.skeleton.md`, rồi `guide.md` nếu chưa tồn tại;
   - xoá `.staging`.

### 5.2 Locale L3 (ADR-0003)

- `cfg.locale` (mặc định `en-US`) chỉ đi vào `ctxOpts.locale` của context guide và của setup context trong lần chạy guide. Playwright đặt `navigator.language`, `Accept-Language` và định dạng `Intl` theo đó. Video vẫn dùng `spec.locale || spec.language` (`record.mjs:187`), không đổi.
- **Phát hiện lệch** theo từng bước:
  - `pageLangMismatch = html[lang]` có mặt và primary subtag ≠ primary subtag của `cfg.locale` (ví dụ `vi` ≠ `en`);
  - `labelNonEnglish = /(?![\x00-\x7F])\p{L}/u.test(target.label)` (có chữ cái ngoài ASCII: `Lưu`, `Khách hàng`; ký hiệu `₫`, `…` không tính);
  - `localeMismatch = pageLangMismatch || labelNonEnglish`.
  Kết quả được tổng hợp vào `locale.mismatchSteps` và cảnh báo `LOCALE_MISMATCH`. Nếu `navigator.language` khác `cfg.locale` thì lỗi cấu hình, ghi vào `steps.json`.
- **Hành vi agent (L2 fallback):** bước có `localeMismatch` thì câu tiếng Anh trích **nguyên văn** nhãn hiển thị in đậm, có thể kèm gloss tiếng Anh trong ngoặc, ví dụ `Click **Lưu** ("Save").`. Agent không bao giờ thay nhãn bằng bản dịch (BR-2, L4 bị loại). Agent nêu cảnh báo ở checkpoint.
- **Auth:** capture không ghi `auth.save`. Nếu app lưu ngôn ngữ trong session/cookie (UI vẫn tiếng Việt dù `Accept-Language: en-US`), người dùng bật `capture.freshSession: true` để setup chạy lại từ đầu dưới `en-US`. Nếu app chỉ đổi ngôn ngữ qua cài đặt người dùng thì L2 fallback được chấp nhận (quyết định Q1). Không thêm "extra setup" riêng cho guide ở MVP.
- `sample-app` có `<html lang="vi">` và nhãn tiếng Việt cố định, nên nó là fixture tự nhiên cho nhánh fallback.

### 5.3 Lỗi (FR-31, AC-1.5)

Khi action/selector lỗi trong capture/refresh:
- chụp `guide/errors/error-<scene>-<i>.png`;
- ném `DemoError` cùng định dạng `record.mjs:161`: scene, `action #i (name selector)`, URL không query, dòng lỗi đầu, đường dẫn ảnh lỗi, gợi ý `inspect`;
- xoá `.staging`. **Không** đụng `images/`, `steps.json`, `guide.md`, `guide-draft.pdf`, `guide.pdf`.

Setup lỗi thì dùng `runActions(spec.setup, 'setup', { errorDir: guide/errors })`. Không có file "dở dang" nào được trình bày là hoàn chỉnh, vì mọi thứ chỉ được promote sau khi thành công.

### 5.4 Skeleton & `guide.md` (ADR-0001, ADR-0002)

`guide.md` dùng một tập con Markdown có **marker HTML comment** để render, kiểm tra và merge một cách xác định:

```markdown
<!-- guide:meta version=1 locale=en-US -->
# Add a new contact

## Goal
Create a contact record so your sales team can follow up.

## Prerequisites
- Sign in to the app.

## Steps

<!-- guide:step n=1 id=add-contact.1 -->
### 1. Open Customers
Click **Khách hàng** ("Customers") in the top navigation bar.

![Step 1: the "Khách hàng" link in the top navigation bar is highlighted](images/01-add-contact-1.png)
![Close-up of the "Khách hàng" link](images/01-add-contact-1-closeup.png)
<!-- /guide:step -->

<!-- guide:step n=5 id=add-contact.5 -->
### 5. Save the contact
Click **Lưu** ("Save").

![…](images/05-add-contact-5.png)
![…](images/05-add-contact-5-closeup.png)

> **Warning:** Each run creates a new contact. Use a test workspace.
<!-- /guide:step -->

## Expected result
The new contact appears at the top of the Customers list.
```

- Template câu theo action:
  - `click`: `Click **{label}**.`
  - `dblclick`: `Double-click **{label}**.`
  - `type`/`fill`: ``In the **{label}** field, type `{value}`.``; password: `… type your password.`
  - `select`: `In **{label}**, select **{value}**.`
  - `check`: `Select the **{label}** check box.`
  - `uncheck`: `Clear the **{label}** check box.`
  - `upload`: `Click **{label}** and choose the file to upload.`
  - `press`: `Press **{key}**.`
  - `hover`: `Point to **{label}**.`
  - `goto`: `Go to the **{page.title}** page.`
  - bước tay: `Look at **{label}**.`
  - Không có label: `the highlighted {role}`.
- Alt template:
  - ảnh toàn viewport: `Step {n}: the "{label}" {role} is highlighted`;
  - ảnh cận cảnh: `Close-up of the "{label}" {role}`.
  `role` ∈ button/link/field/drop-down list/check box/control. Alt luôn bằng tiếng Anh; nhãn trong ngoặc kép là trích nguyên văn (L3).
- Các override trong `guide.yaml` (`title`/`text`/`note`/`warning`, task fields) được đặt nguyên văn vào skeleton (AC-2.3/2.4). Mục thiếu được ghi là `TODO(guide): …`.
- **Quy tắc sở hữu:** toolkit chỉ tạo `guide.md` khi file chưa tồn tại. Sau đó `guide.md` thuộc về agent và người dùng. Thay đổi `text` trong `guide.yaml` về sau **không** tự lan vào `guide.md`. `render` báo `OVERRIDE_NOT_APPLIED` khi khối bước không chứa chuỗi override. Theo BR-6, chữ trong `guide.md` thắng.

### 5.5 Render (ADR-0005)

1. Đọc `guide.md`, rồi `mdToHtml` (tập con được hỗ trợ):
   - ATX `#`–`####`; đoạn văn;
   - `**b**`, `*i*`/`_i_`, `` `code` ``, `[text](url)`;
   - danh sách `-`/`*`/`1.`; blockquote, với `> **Note:**`/`> **Warning:**`/`> **Tip:**` → `aside.callout.note|warning|tip`;
   - ảnh một dòng `![alt](path)` → `<figure class="full|closeup"><img alt></figure>` (closeup nhận biết qua hậu tố `-closeup.png`); `---`;
   - marker `guide:step` → `<section class="step" data-id>`; comment khác bị bỏ.
   **HTML thô bị escape** (an toàn và đảm bảo offline). Cú pháp không hỗ trợ được render thành văn bản thường.
2. **Kiểm tra (findings):**
   - *error*:
     - ảnh tham chiếu không tồn tại;
     - `src` là `http(s):` (NFR-3);
     - alt rỗng hoặc chỉ là `screenshot|image|picture` (AC-3.5);
     - giá trị secret xuất hiện trong `guide.md`/`steps.json`/`guide.html`. Tập secret = giá trị của các biến `${VAR}` tham chiếu trong file spec gốc và có độ dài ≥ 4; báo tên biến và dòng, **không** in giá trị (NFR-1).
   - *warn*:
     - còn `TODO(guide)`;
     - marker `n` không liên tục 1..N, hoặc lệch so với `steps.json` (`STEP_MARKERS_MISMATCH`);
     - `OVERRIDE_NOT_APPLIED`;
     - hơn 12 bước;
     - font brand không có (`document.fonts.check` trên family đầu của `brand.font` → `FONT_FALLBACK`);
     - lặp lại `LOCALE_MISMATCH`/`DATA_CREATING` từ `steps.json`.
3. **HTML in:** ghi `guide/guide.html` với CSS in nội tuyến.
   - `@page { size: A4; margin: 16mm 14mm 18mm }`; font chữ `brand.font`.
   - Trang bìa: nền `brand.background`, chữ `brand.text`, logo (`fileToDataUri`, `util.mjs:263`), tiêu đề + goal + ngày. **Không** dùng `spec.title` vì có thể không phải tiếng Anh (FR-16).
   - Heading/badge số dùng `brand.primary`.
   - `section.step, figure { break-inside: avoid }`; `figure.full img { max-width: 100%; max-height: 120mm; object-fit: contain }`; `figure.closeup img { max-width: 60%; max-height: 70mm }` (FR-22).
   - `pdf.fonts` → `@font-face { src: url("file://…") }`.
4. **PDF:**
   - `page.route('**/*', r => /^(file|data):/.test(r.request().url()) ? r.continue() : r.abort())` chặn mọi request mạng (AC-6.4).
   - `page.goto('file://…/guide/guide.html')`, vì `setContent` không tải được ảnh `file://`, xem V8.
   - `await page.evaluate(() => document.fonts.ready)`.
   - `page.pdf({ path: guide-draft.pdf.tmp, format, printBackground: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: <title · page/total>, tagged: true, outline: true })`, rồi rename sang `guide-draft.pdf`.
   - Font hệ thống được Chromium nhúng dạng subset (V8). Thiết kế không bundle font vào plugin.
   - ASSUMPTION: `tagged`/`outline` có trong mọi bản ≥ 1.48 mà `setup` cài (`demo.mjs:62`). Nếu Playwright ném lỗi option thì retry không có 2 option này và cảnh báo.
5. **Contact sheet:** ghi `preview/contact-sheet.html`. Lưới 3 cột, mỗi ô là ảnh toàn viewport + ảnh cận cảnh nhỏ + caption `NN · id · action · "label"` + cờ (⚠ locale/data). Sau đó `goto file://` và `screenshot({ fullPage: true })` → `preview/contact-sheet.png`. Không dùng `review.mjs`: contact sheet ở đó cắt khung hình từ video cuối bằng ffmpeg theo `output/<name>.timeline.json` (`review.mjs:97-109`), gắn chặt với video. Refactor nó sẽ tạo rủi ro hồi quy cho QA video. Thiết kế tái dùng **cơ chế** (một ảnh lưới để duyệt nhanh) nhưng dựng bằng Chromium, giống cách `cards.mjs:43-66` dựng card.
6. `render.json`: `{ renderedAt, guideMdSha256, stepsSignature, images: { "<file>": sha256 }, pdfSha256, findings }`.

### 5.6 Refresh (ADR-0002) và thay đổi flow

1. `prev = steps.json`. Nếu không có thì lỗi "run `/demo-builder:guide <slug>` first".
2. `plan = buildPlan(spec, cfg)`. Nếu `plan.signature !== prev.plan.signature` thì **exit 2**: in `diffPlans` (ví dụ `+ add-contact.6 click (new)`, `- add-contact.2 click (removed)`, `~ add-contact.3 type→fill`, `↕ moved`), **không ghi file nào và không mở browser**. Signature gồm (n, id, action), tức là bao trùm cả thay đổi do `guide.yaml` skip/include/manual.
3. Nếu khớp: chạy capture với `strictSignature`, rồi so từng bước với `prev`:
   - `target.label` khác → `LABEL_CHANGED { step, from, to }`. Văn bản có thể đã cũ; agent **báo**, không tự sửa `guide.md`.
   - `selector` khác → `SELECTOR_CHANGED`, chỉ cảnh báo, vì flow-engineer sửa selector sau khi UI đổi là trường hợp refresh chính đáng.
4. Swap ảnh như mục 5.1 bước 6, cùng tên file nên các link trong `guide.md` vẫn đúng (AC-8.2). Ghi `steps.json` và `guide.skeleton.md`. **Không ghi `guide.md`**.
5. Render → `guide-draft.pdf`. `guide.pdf` đã duyệt trước đó giữ nguyên cho tới lần approve mới (AC-8.5).

**Khi flow đã thêm/bớt bước (exit 2) và người dùng muốn tái sinh** (đường "regenerate with merge", do agent làm sau khi người dùng đồng ý):
- chạy `guide capture` thường (không strict). Toolkit backup `guide.md` → `history/guide.md.<stamp>`, ghi ảnh mới, `steps.json` mới, `guide.skeleton.md` mới, và giữ `guide.md` cũ;
- agent dựng lại `guide.md` từ skeleton. Với mỗi `id` còn tồn tại, agent **bê nguyên văn** khối văn bản cũ (trừ dòng ảnh, được cập nhật theo tên mới vì `NN` có thể đổi); với id mới, agent viết văn mới. Agent liệt kê các bước bị bỏ cùng văn bản cũ của chúng trong báo cáo;
- **ảnh mồ côi:** dir-swap tự loại mọi file `NN-…png` không còn trong plan. Tham chiếu cũ trong `guide.md` chưa merge sẽ khiến `render` lỗi "missing image", đây là cố ý để không ghép sai ảnh.

### 5.7 Approve

`approve` thực hiện:
- đọc `render.json`;
- kiểm tra `sha256(guide.md)`, hash ảnh và `sha256(guide-draft.pdf)` còn khớp (nếu không thì "re-render first");
- kiểm tra không còn `TODO(guide)` và không có finding mức error;
- `fs.renameSync(guide-draft.pdf, guide.pdf)` (cùng filesystem nên atomic, và thay thế `guide.pdf` cũ);
- ghi `approval.json { approvedAt, pdfSha256, guideMdSha256, stepsSignature }`, không chứa thông tin cá nhân.

Chỉ main session gọi `approve`, và chỉ sau tin nhắn duyệt rõ ràng **của người dùng**. Tin nhắn của agent không bao giờ được tính là duyệt.

---

## 6. Agent `guide-writer` và lệnh

### 6.1 `agents/guide-writer.md` (frontmatter theo mẫu `agents/flow-engineer.md:1-6`)

- `name: guide-writer`, `color: teal`, `model: inherit`. Description: "Technical writer … turns a green demo.yaml flow into an English step-by-step user guide with annotated screenshots and a branded PDF; use for `/demo-builder:guide` and guide refresh".
- **Inputs:** `.demo/<slug>/demo.yaml` (đã pass `record --dry`), `guide.yaml` nếu có, `brief.md` (nếu có; dùng để hiểu người đọc/mục tiêu), mode `generate|refresh`, feedback của người dùng.
- **Workflow generate:**
  1. Resolve toolkit. Kiểm tra `demo.yaml` tồn tại; nếu không thì báo cách khắc phục (`/demo-builder:flow`), không tạo thư mục.
  2. Chạy `validate` và `guide plan --json`.
  3. Nếu env `unknown` và brief chưa ghi "env confirmed" → `needs-input`.
  4. Viết/cập nhật `guide.yaml`, chỉ **thêm** khoá: `value` giả cố định bằng tiếng Anh cho mọi bước `type`/`fill`/`select` (tên/email/số kiểu "Jane Doe", "jane.doe@example.com"); `title`/`goal`/`expectedResult` nếu người dùng chưa có. Không xoá khoá người dùng đã có.
  5. Chạy `guide capture [--confirm-env] --json`.
  6. Đọc `steps.json` và **xem** ảnh của mọi bước: đúng phần tử, không lộ PII, không cursor.
  7. Viết `guide.md` từ skeleton:
     - mỗi bước gồm 1 câu mệnh lệnh + tối đa 1 câu phụ, nêu `target.label` nguyên văn;
     - bước có `localeMismatch` dùng L2;
     - giữ nguyên `text` override và marker/dòng ảnh;
     - alt text mô tả hành động;
     - note/warning chỉ khi cần;
     - không selector CSS, không credential.
  8. Chạy `guide render --json`; sửa mọi finding mức error.
  9. Xem `preview/contact-sheet.png` và vài trang `guide-draft.pdf`.
  10. Trả `needs-input` kèm checkpoint: đường dẫn preview, số bước, cảnh báo (locale, data-creating/Q5, >12 bước, môi trường), câu hỏi duyệt.
- **Workflow refresh:** chạy `guide refresh [--confirm-env] --json`.
  - Exit 2: báo diff và 2 lựa chọn (sửa flow/`guide.yaml` hoặc regenerate-merge), rồi `needs-input`.
  - Thành công: báo `LABEL_CHANGED` kèm đề xuất câu sửa, nhưng **không sửa `guide.md`** trừ khi người dùng yêu cầu. Sau đó đến checkpoint.
- **Rules:**
  - Guide English only (FR-16); không dùng narration không phải tiếng Anh.
  - Không bao giờ chạy `guide approve` (chỉ main session).
  - Không gửi/đăng gì ra ngoài.
  - Không đặt `--confirm-env` khi chưa có xác nhận của người dùng trong brief.
  - Chưa duyệt thì không báo "done" (FR-26).
  - Handoff block theo protocol của squad (`agents/flow-engineer.md:31-46`).

### 6.2 `commands/guide.md` (mẫu `commands/package.md:1-8`)

```
---
description: Turn a demo flow into an English step-by-step user guide (Markdown + annotated screenshots + PDF); "refresh" re-captures images only
argument-hint: <slug> [refresh]
---
```

Thân lệnh:
1. Kiểm tra `.demo/<slug>/demo.yaml` (không có thì gợi ý `/demo-builder:flow`).
2. Launch `demo-builder:guide-writer` với mode.
3. Nếu agent hỏi env, hỏi người dùng rồi relaunch kèm "env confirmed".
4. ⏸ Trình contact sheet + `guide-draft.pdf` + cảnh báo. Người dùng duyệt rõ ràng → chạy `node <demo.mjs> guide approve .demo/<slug>/demo.yaml` và báo `guide.pdf`. Người dùng yêu cầu sửa → relaunch agent với feedback.
5. Kết thúc bằng danh sách "Việc bạn cần làm".
Không commit/đăng/gửi.

### 6.3 Tích hợp director/playbook (FR-28, US-9)

- `agents/demo-director.md`:
  - thêm hàng `guide-writer` vào bảng squad (`:12-22`);
  - thêm vào pipeline (`:28-32`) nhánh `flow-engineer (record --dry green) ─→ guide-writer ⏸ (optional, parallel; never blocks video)`;
  - thêm vào bước gate (`:49`): guide lỗi thì báo riêng, video vẫn đi tiếp;
  - thêm checkpoint "approve guide preview".
- `skills/demo-playbook/SKILL.md`:
  - roster (`:10-21`);
  - pipeline "User guide (`/demo-builder:guide`)";
  - workspace (`:43-54`) thêm `guide.yaml`, `guide/`;
  - checkpoint (`:35-39`) thêm duyệt preview guide và xác nhận môi trường trước khi chụp.

---

## 7. Cross-cutting concerns

- **Bảo mật/riêng tư:**
  - `mask`/`hide` của spec (+ phần cộng dồn của guide) áp dụng cho mọi ảnh qua `overlayInit` (V5). Ảnh cận cảnh chụp từ chính trang đã mask (FR-12).
  - Chú thích được vẽ đè lên trang, không thể làm lộ phần đã blur. Vị trí nhãn tránh rect bị mask (AC-5.3).
  - Password hiển thị dạng che do browser. Bước `${ENV}` bị chặn nếu không có override.
  - Có quét secret trong text output.
  - Không lưu URL query.
  - Không ghi `auth.save`.
  - PDF render offline với route-blocking.
  - Ảnh không quét OCR được (ngoài phạm vi), nên dựa vào checkpoint người dùng.
- **Hiệu năng (NFR-7):** dry-run sample 2 scene mất ~2,4 s (V9). Mỗi bước thêm ~2 screenshot + settle ≤ 1,5 s, nên guide 12 bước ước tính < 1 phút cộng thời gian app. QA ghi số đo thực.
- **Observability:** log theo bước (không value); `--json` cho agent; `steps.json`/`render.json`/`approval.json` làm vết; mã cảnh báo cố định.
- **Lỗi:** `DemoError` với thông điệp hành động được (theo kiểu `record.mjs:161`). Exit code: 0 / 1 / 2 (plan mismatch).
- **Cấu hình:** chỉ `guide.yaml` (+ cờ CLI `--confirm-env`, `--headed`, `--json`). Không có biến môi trường mới.
- **Accessibility (NFR-5):** heading đúng cấp (`#` task, `##` mục, `###` bước); alt bắt buộc; PDF `tagged` + `outline`; box có viền trắng kép; chữ badge chọn màu theo tương phản.
- **Không hồi quy video (FR-29, AC-2.6):** `record()`/`assemble`/`review`/`tts` không đọc `guide.yaml`; thay đổi `record.mjs` chỉ là export + tách hàm thuần (giữ nguyên lệnh); `overlayInit` không đổi; `envRefs` là thuộc tính thụ động.

---

## 8. Danh sách thay đổi file (S/M/L)

| File | Loại | Thay đổi (mức hàm) | Size |
|---|---|---|---|
| `scripts/lib/record.mjs` | Mod | `export` cho `Director` và `resolveUrl`; `runActions(actions, label, { errorDir })` (mặc định giữ `spec.dirs.recordings`); tách `prepareSession(browser, spec, ctxOpts, { save, fresh })` từ dòng 190-201, `record()` gọi lại | S/M |
| `scripts/lib/spec.mjs` | Mod | `export loadYaml`; gắn `envRefs` cho action scene + setup | S |
| `scripts/lib/overlay.mjs` | Mod | Thêm `guideAnnotate(o)`, `guideClear()` (browser-side, tự chứa, không transition) | M |
| `scripts/lib/guide.mjs` | New | Config/plan/env/capture/skeleton/render/refresh/approve/secret scan/CLI | L |
| `scripts/lib/guide-md.mjs` | New | `mdToHtml`, `parseStepBlocks`, `printHtml`, `contactSheetHtml`, template câu/alt | M |
| `scripts/demo.mjs` | Mod | Đọc positional thứ 3; `case 'guide'`; booleans `confirm-env`, `json`; HELP; `init` thêm `guide/.staging/`, `guide/errors/` vào `.gitignore` | S |
| `agents/guide-writer.md` | New | Agent (mục 6.1) | M |
| `commands/guide.md` | New | Lệnh (mục 6.2) | S |
| `agents/demo-director.md` | Mod | Squad + pipeline + gate + checkpoint | S |
| `skills/demo-playbook/SKILL.md` | Mod | Roster, pipeline, workspace, checkpoint | S |
| `skills/demo-toolkit/SKILL.md` | Mod | Bảng lệnh `guide …`, sơ đồ đầu file | S |
| `skills/demo-toolkit/references/spec-reference.md` | Mod | Mục `guide.yaml`, ref/step id, option `guideId`, "Files written" thêm `guide/…` | S |
| `README.md` | Mod | Bảng lệnh + agent, "10 agent/12 slash command" → 11/13, mục "Hướng dẫn sử dụng (user guide)" ngắn | S |
| `plugins/demo-builder/.claude-plugin/plugin.json` | Mod | Mô tả "squad of 10 agents" → 11, thêm "user guides" | S |
| `tests/guide/*.test.mjs`, `tests/fixtures/guide-app/{index.html,demo.yaml,guide.yaml}`, `tests/README.md` | New | Mục 9 | M |

---

## 9. Test strategy hooks

Hiện trạng: repo không có test runner/`package.json`/CI (V10). Đề xuất **`node --test`** (built-in Node ≥ 18, không dependency), đặt ở `tests/` cấp repo để không ship theo plugin. Test cần browser tự `skip` khi `resolveModule('playwright')` trả `null` hoặc Chromium không launch được.

**Unit (không browser, chạy offline mọi nơi):** `tests/guide/plan.test.mjs`, `md.test.mjs`, `env.test.mjs`, `secrets.test.mjs`
- `buildPlan` trên `examples/sample-app/demo.yaml`: không `guide.yaml` → đúng 5 bước `add-contact.1..5`, đánh số 1..5 (AC-1.2); `dashboard`/card → 0 bước (AC-1.3).
- `skip` → bước còn lại liên tục (AC-2.1); `include` hover → có bước (AC-2.2); ref sai/scene card/n ngoài khoảng/`include`+`skip` → DemoError liệt kê đủ (AC-2.5, FR-4).
- `signIn` tự động khi spec có `setup`/`auth` (AC-1.4); không có `setup` → không có dòng.
- `planSignature`/`diffPlans`: thêm/bớt/đổi thứ tự/đổi action.
- `classifyEnv`: các ví dụ local/staging/unknown.
- `mdToHtml`: marker → section, ảnh → figure, HTML thô bị escape, alt rỗng → finding.
- `scanSecrets`: đặt `GUIDE_TEST_SECRET` qua env, đảm bảo phát hiện và **không** in giá trị.

**Integration (cần Playwright + Chromium; app cục bộ `file://`, offline):** `tests/guide/e2e.test.mjs` copy fixture vào `os.tmpdir()` trước khi chạy (không ghi vào cây plugin).
1. **sample-app (nhánh L2 fallback):** `guide capture` → 5 cặp PNG đúng tên `01-add-contact-1.png` … (AC-3.1). Đọc header IHDR PNG bằng `Buffer` để kiểm tra full = 1280×720 (NFR-6). `steps.json.locale.mismatch === true`, có `LOCALE_MISMATCH`, có `DATA_CREATING` ở bước `#save`. Chạy lần 2 → tập tên file y hệt (AC-3.6).
2. **fixture tiếng Anh `tests/fixtures/guide-app/`**, có:
   - `<html lang="en">`, nút ngoài viewport (cuộn);
   - `input[type=password]` lấy giá trị từ `${GUIDE_TEST_SECRET}`;
   - `type` lấy từ `${ENV}` không override → capture phải lỗi; có override → pass;
   - phần tử `.pii` được `mask`; chat widget được `hide`;
   - một bước `press Enter`; một `select`; một `input[type=file]` ẩn có label;
   - một nút có `hover` style và animation 0,5 s.
   Assert: không `LOCALE_MISMATCH`; `valueRedacted` cho password; secret không có trong `guide.md`/`steps.json`/`guide.html` (AC-5.2 phần text).
3. **render:** `guide-draft.pdf` bắt đầu bằng `%PDF`; không có `guide.pdf` trước approve (AC-7.2); nếu có `pdffonts` thì mọi font `emb=yes` (AC-6.2), không thì skip; `guide.html` không chứa `http://`/`https://` trong `src`. Chạy render khi tắt mạng (route chặn) vẫn thành công (AC-6.4).
4. **hand-edit + refresh:** sửa một câu trong `guide.md` → `guide refresh` → câu còn nguyên; mtime/sha ảnh đổi, tên giữ nguyên; `guide.md` sha không đổi (AC-8.1/8.2).
5. **plan mismatch:** thêm `skip` vào `guide.yaml` → `refresh` exit 2, mọi file trong `guide/` giữ nguyên sha (AC-8.3).
6. **lỗi giữa chừng:** đổi selector bước 3 thành không tồn tại → exit 1, có `errors/error-*.png`, `images/`/`steps.json`/`guide.md` giữ nguyên sha, không còn `.staging` (AC-1.5, AC-8.4).
7. **approve:** sửa `guide.md` sau render → approve từ chối; render lại → approve tạo `guide.pdf`, `guide-draft.pdf` biến mất.
8. **slug thiếu `demo.yaml`:** lệnh lỗi, không tạo `guide/` (AC-1.6).

**Hồi quy video (FR-29, AC-2.6), QA chạy thủ công/bán tự động:**
- trước và sau T1/T2, chạy `node demo.mjs record <copy>/demo.yaml --dry` trên bản sao sample-app → log giống hệt;
- chạy `node demo.mjs build <copy>/demo.yaml --provider silent` → so `recordings/timeline.json` (cấu trúc, số scene, `need` ±0,2 s) và xem `review/contact-sheet.jpg` (cursor/ripple/highlight còn như cũ);
- có/không `guide.yaml` trong thư mục → `record --dry` cho cùng output;
- `grep -n "guide" lib/record.mjs lib/assemble.mjs` → không import `guide.mjs`.

**Kiểm tra trực quan (QA/người dùng):** contact sheet. Ảnh không cursor/ripple/caption/zoom (AC-3.3); khung + badge + mũi tên + nhãn (AC-3.2); cận cảnh thấy nhãn (AC-3.4); email blur (AC-5.1).

---

## 10. Implementation plan (T1..T11)

| # | Task | Files | Phụ thuộc | Cách kiểm chứng |
|---|---|---|---|---|
| T1 | Export `Director`/`resolveUrl`; `runActions({errorDir})`; tách `prepareSession` (di chuyển nguyên văn) | `lib/record.mjs` | – | `record --dry` + `build --provider silent` trên bản sao sample-app: log/timeline như trước |
| T2 | `export loadYaml`; `envRefs` trên action/setup | `lib/spec.mjs` | – | `validate` sample không đổi; unit `envRefs` |
| T3 | `loadGuideConfig`, `parseRef`, `buildPlan`, `planSignature`, `diffPlans`, `classifyEnv`; CLI `guide plan` + positional thứ 3 + booleans + HELP | `lib/guide.mjs`, `demo.mjs` | T2 | Unit plan/env (AC-1.2/1.3/2.1/2.2/2.5) |
| T4 | `guideAnnotate`/`guideClear` | `lib/overlay.mjs` | – | Script thử trong scratch: ảnh có box/badge/arrow/label, không mờ |
| T5 | `capture`: context guide (locale, cursor off, mask/hide cộng dồn, `prepareSession save:false`), vòng lặp action, describeTarget, settle, 2 screenshot, guard secret, cảnh báo, staging + dir swap, `steps.json`, lỗi FR-31 | `lib/guide.mjs` | T1, T3, T4 | E2E 1, 2, 6 |
| T6 | Template câu/alt, `writeSkeleton` (skeleton luôn; `guide.md` nếu chưa có; backup history khi plan đổi) | `lib/guide-md.mjs`, `lib/guide.mjs` | T5 | Unit skeleton; AC-2.3/2.4/1.4 |
| T7 | `mdToHtml`, `printHtml`, findings, `render` (route chặn mạng, `goto file://`, `pdf` tagged/outline + fallback), contact sheet, `render.json` | `lib/guide-md.mjs`, `lib/guide.mjs` | T6 | E2E 3; unit md |
| T8 | `refresh` (exit 2 + diff; LABEL/SELECTOR_CHANGED) và `approve` | `lib/guide.mjs` | T7 | E2E 4, 5, 7 |
| T9 | Test suite + fixture + `tests/README.md` (`node --test tests/`) | `tests/**` | T3–T8 (song song dần) | CI cục bộ xanh |
| T10 | `agents/guide-writer.md`, `commands/guide.md` | agents, commands | T8 | Chạy `/demo-builder:guide acme-crm` trên bản sao sample-app: dừng ở checkpoint với preview |
| T11 | Director/playbook/toolkit SKILL/spec-reference/README/plugin.json/`init .gitignore` | docs | T10 | Review tài liệu; `init` sinh `.gitignore` có dòng mới |

Sau mỗi task, hệ thống vẫn chạy được: T1–T2 chỉ refactor/thụ động; T3 thêm lệnh chỉ đọc; T5 trở đi chỉ ghi vào `guide/`.

---

## 11. Risks & mitigations

| # | Rủi ro | Mức | Giảm thiểu |
|---|---|---|---|
| R1 | Ảnh chụp giữa animation/loading (FR-11) | M | Annotation không transition; `animations:'disabled'`; settle bbox + networkidle + fonts + 2 rAF; timeout → lỗi FR-31 |
| R2 | Refactor `record.mjs` gây hồi quy video | M | T1 là di chuyển code thuần + export; test hồi quy dry/build trước-sau; `overlayInit` không đổi |
| R3 | Ref theo chỉ số trôi khi chèn action vào flow → override `guide.yaml` gắn nhầm | M | Signature (n,id,action) chặn refresh; lần capture đầu sau khi đổi sẽ cảnh báo khi action name của ref đổi so với `steps.json` cũ; khoá neo `guideId` tuỳ chọn |
| R4 | App không đổi ngôn ngữ / nhớ ngôn ngữ trong session | M | L2 fallback + `LOCALE_MISMATCH`; `capture.freshSession`; không ghi `auth.save` |
| R5 | Nhãn DOM sai/thiếu (nút icon) | M | Chuỗi fallback aria/title/name; `label` override; agent xem ảnh trước khi viết |
| R6 | Override `value` làm lệch bước sau (vd `waitFor: text=Nguyễn Văn A`) | L | Capture lỗi rõ ràng + gợi ý; agent kiểm tra chuỗi phụ thuộc khi chọn value |
| R7 | Flow tạo dữ liệu bị lặp mỗi lần refresh (Q5 a) | M | `DATA_CREATING` ở checkpoint và báo cáo; người dùng tự dọn staging |
| R8 | Lộ secret trong ảnh (không OCR) | M | Password che bởi browser; `${ENV}` hiển thị bị chặn; mask/hide; checkpoint xem ảnh |
| R9 | Tập con Markdown không đủ cho chỉnh sửa tay | L | Tài liệu hoá tập con; cú pháp lạ hiển thị dạng text + cảnh báo; mở rộng sau |
| R10 | `tagged`/`outline` không có ở bản Playwright cũ | L | Retry không option + cảnh báo |
| R11 | Font brand không cài → fallback | L | `FONT_FALLBACK`; `pdf.fonts` file cục bộ; Chromium vẫn nhúng font fallback |
| R12 | `parkMouse` đóng menu hover | L | Mặc định `false` (giống dry đã kiểm chứng) |
| R13 | Production bị chụp nhầm | M | `classifyEnv` + `--confirm-env` bắt buộc; checkpoint |
| R14 | Chạy guide song song với quay video trên cùng app làm lệch dữ liệu | L | Director khuyến nghị chạy nhánh guide sau dry/không cùng lúc với take nếu flow tạo dữ liệu |

## 12. Điểm lệch/diễn giải so với requirements (cần người dùng biết)

1. **FR-6 "action không-bước vẫn được thực thi khi cần":** thiết kế **bỏ qua** nhóm VISUAL_ONLY (`highlight, spotlight, callout, clear, zoom, unzoom, caption, at, screenshot`) vì chúng không đổi trạng thái app. `zoom` biến đổi `body`, `screenshot` ghi file vào `review/`. Các action khác vẫn chạy như `--dry`.
2. **FR-10 "mỗi bước 2 ảnh":** ngoại lệ `press` khi không có phần tử focus → chỉ có ảnh toàn viewport (theo edge case mục 7 cho phép architect chốt).
3. **FR-15 `<step>`:** được hiểu là chỉ số action 1-based trong scene (hoặc `guideId`/`manual.id`).
4. **`guideId`:** là khoá **thụ động tuỳ chọn** trong action `demo.yaml`. Nó không đổi hành vi video, nhưng là thay đổi nhỏ trong schema `demo.yaml`. Có thể bỏ khỏi MVP nếu người dùng muốn `demo.yaml` hoàn toàn không đổi.
5. **Văn bản trong `guide.yaml` sau lần tạo đầu:** `guide.md` thắng (BR-6). Sửa `text` trong `guide.yaml` về sau không tự cập nhật `guide.md`; render cảnh báo `OVERRIDE_NOT_APPLIED`.
6. **FR-7 dòng chính xác:** `Sign in to the app.` (có dấu chấm cuối câu).
