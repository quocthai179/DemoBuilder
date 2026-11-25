# ADR-0004: Engine chụp guide — runner riêng tái dùng `Director` (dry) + chú thích tĩnh qua `page.evaluate`
Status: Proposed
Date: 2026-11-25

## Context
- FR-10/11: mỗi bước có ảnh toàn viewport với khung + badge + mũi tên + nhãn, cộng một ảnh cận cảnh; không cursor/ripple; trang phải ổn định.
- FR-29: hồi quy video = 0.
- Xác minh trên code và bằng chạy thử (bản sao sample-app):
  - Overlay vẫn được tiêm khi `--dry` (`record.mjs:205`).
  - `screenshot` không có guard dry (`record.mjs:148`).
  - `wait` là no-op khi dry (`record.mjs:118`).
  - Highlight/callout có transition 0,3 s (`overlay.mjs:334-341`). Ảnh chụp trong dry cho thấy khung/nhãn mờ dở dang, cursor và ripple hiện rõ.
  - Cursor/ripple tắt được **bằng config** truyền vào `overlayInit` (`overlay.mjs:330,378`).
  - `Director` chưa được export (`record.mjs:26`).

## Options considered
| Option | Pros | Cons |
|---|---|---|
| A. Dùng action `highlight` + `screenshot` có sẵn (sinh thêm action vào flow) | Không code mới trong record | Ảnh mờ do transition; cursor/ripple; `screenshot` ghi vào `review/`; không có badge/mũi tên/cận cảnh; trộn guide vào flow video |
| B. Thêm "guide mode" vào `record()` và sửa `overlayInit` | Một engine | Đụng vào đường video (rủi ro FR-29); `record()` đã phức tạp (pacing, warm-up, timeline) |
| C. Runner riêng trong `lib/guide.mjs`: tái dùng `Director` (export) ở `dry:true` để thực thi action; chụp **trước** mỗi action-bước; chú thích tĩnh bằng hàm mới `guideAnnotate/guideClear` gọi qua `page.evaluate`; `overlayInit` dùng lại với `cursor.show=false, clickRipple=false` để giữ mask/hide | Không đổi `overlayInit`/`record()` ngoài export + tách hàm thuần; ảnh sạch (không transition, `animations:'disabled'`); kiểm soát hoàn toàn thời điểm chụp | Lặp lại một ít logic điều hướng scene (~10 dòng) |

## Decision
Chọn **C**.
- **`record.mjs`:**
  - `export class Director`, `export function resolveUrl`;
  - `runActions(actions, label, { errorDir })` với giá trị mặc định giữ hành vi cũ;
  - tách `prepareSession(browser, spec, ctxOpts, { save = true, fresh = false })` bằng cách di chuyển nguyên văn `record.mjs:190-201`; `record()` gọi lại nó.
- **`overlay.mjs`:** thêm export `guideAnnotate(o)` / `guideClear()`. Hàm tự chứa, không transition, `z-index` cao hơn overlay video, `pointer-events:none`. Nhãn được đặt tránh target và rect bị mask.
- **Runner:**
  - Bỏ qua nhóm VISUAL_ONLY: `highlight, spotlight, callout, clear, zoom, unzoom, caption, at, screenshot`.
  - Thực thi các action còn lại bằng `Director.act` khi dry.
  - Với bước:
    1. resolve locator (`nth`/`first`);
    2. `Director.box` (cuộn vào view);
    3. chờ ổn định (networkidle ≤ 1,5 s, `fonts.ready`, bbox đứng yên, 2 rAF);
    4. đọc nhãn DOM;
    5. `guideAnnotate(full)` → `page.screenshot({ animations:'disabled' })`;
    6. `guideAnnotate(closeup)` → `page.screenshot({ clip })` (target + padding 48, tối thiểu 360×200, clamp viewport);
    7. `guideClear`.
- **Cận cảnh:** dùng `page.screenshot({clip})`, **không** dùng `locator.screenshot()`, để giữ padding/ngữ cảnh, mask và box/badge trên trang.

## Consequences
- Đường video không đổi hành vi. Kiểm tra hồi quy bằng `record --dry` và `build --provider silent` trước và sau thay đổi.
- Ảnh ở trạng thái **ngay trước** thao tác, nên modal/dropdown còn hiện. Với `type`, ô nhập còn trống trong ảnh của chính bước đó; giá trị chỉ xuất hiện ở ảnh bước sau. Đây là chuẩn thông thường của help doc.
- Chuột để nguyên vị trí như dry (`parkMouse:false`) để không đóng menu hover. Đổi lại, trạng thái hover của phần tử trước có thể lọt vào ảnh.
