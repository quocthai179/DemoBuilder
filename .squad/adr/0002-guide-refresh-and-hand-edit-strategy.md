# ADR-0002: Refresh chỉ thay ảnh; `guide.md` thuộc người dùng sau lần tạo đầu; step id ổn định + plan signature
Status: Proposed
Date: 2026-11-25

## Context
- Q2 → (b): người dùng sửa thẳng `guide.md`; `refresh` chỉ thay ảnh (tên file ổn định) và dựng lại PDF, không ghi đè chữ.
- FR-24/AC-8.3: số/thứ tự bước đổi → refresh dừng, báo điểm lệch.
- AC-8.4: lỗi giữa chừng không để guide nửa mới nửa cũ.
- FR-15: tên ảnh `NN-<scene>-<step>.png`.
- Action trong `demo.yaml` không có id (`lib/spec.mjs:264-281`), chỉ có vị trí trong `scenes[].actions`. `normaliseAction` giữ các khoá phụ (`spec.mjs:274,280`).

## Options considered
| Option | Pros | Cons |
|---|---|---|
| A. Luôn sinh lại `guide.md` từ `guide.yaml` + ảnh (Q2 a) | Đơn giản về đồng bộ | Trái quyết định Q2 (b); mất chữ sửa tay trong `.md` |
| B. Sửa tay trong `guide.md` có "vùng được bảo vệ" + 3-way merge với bản sinh trước | Có thể cập nhật văn tự động | Phức tạp, dễ sai; xung đột merge; vượt MVP |
| C. Toolkit **không bao giờ ghi `guide.md`** sau lần tạo đầu; refresh = chụp lại ảnh cùng tên + render; plan signature chặn khi tập bước đổi; dir-swap atomic | Xác định, đúng Q2 (b) theo cấu trúc (chữ sửa tay luôn còn vì không ai ghi đè); dễ test | Khi flow đổi tập bước cần đường "regenerate with merge" do agent làm; đổi `text` trong `guide.yaml` sau lần đầu không tự lan |

## Decision
Chọn **C**.
- **Step id** = `<sceneId>.<n>`, với `n` là vị trí 1-based của action trong scene. Có thể dùng neo thụ động `guideId` trên action, khi đó id là `<sceneId>.<guideId>`. Bước tay có id `<sceneId>.<manual.id>`. Tên ảnh là `NN-<sceneId>-<local>.png` và `-closeup.png`.
- **Plan signature** = `util.hash([[n, id, action]…])`, lưu trong `steps.json.plan`.
  - `refresh` tính lại plan **trước khi mở browser**. Nếu khác thì exit 2 kèm diff (added/removed/moved/changedAction) và không chạm file nào.
  - Đổi selector hoặc nhãn DOM chỉ là cảnh báo (`SELECTOR_CHANGED`, `LABEL_CHANGED`), vì đây chính là trường hợp "UI đổi" mà refresh phục vụ.
- **Atomic:** capture ghi vào `guide/.staging/`. Chỉ khi thành công mới `rename images→images.old, images.new→images`, sau đó ghi `steps.json` bằng tmp+rename. Khi lỗi thì xoá staging và giữ nguyên mọi thứ khác. `guide.pdf` chỉ thay đổi qua `guide approve`.
- **Quyền sở hữu văn bản:** `guide.md` được tạo một lần từ skeleton. Sau đó agent và người dùng sở hữu nó (BR-6). Override `text` trong `guide.yaml` về sau sinh cảnh báo `OVERRIDE_NOT_APPLIED` khi render.
- **Regenerate with merge** (sau khi người dùng đồng ý):
  1. `guide capture` backup `guide.md` → `history/guide.md.<stamp>` và ghi skeleton mới.
  2. Agent bê nguyên văn khối của các id còn tồn tại, viết văn mới cho id mới, và liệt kê khối bị bỏ.
  3. Ảnh mồ côi tự bị loại bởi dir-swap. Tham chiếu cũ chưa merge khiến render lỗi "missing image", nhờ vậy không thể ghép sai ảnh.

## Consequences
- Chữ sửa tay không bao giờ bị toolkit ghi đè (đúng theo thiết kế, không cần phát hiện "đã sửa").
- Mọi thay đổi tập bước đều buộc phải có quyết định của người dùng. Phải trả thêm một bước merge do agent làm.
- Chèn action không-bước (vd `waitFor`) vào giữa scene làm trôi chỉ số của các action sau, nên refresh sẽ dừng. Muốn tránh thì dùng `guideId`. Việc này được tài liệu hoá trong spec-reference.
- `images/` thuộc toolkit. Ảnh do người dùng thêm phải đặt ở `guide/assets/`. File lạ trong `images/` được copy sang kèm cảnh báo.
