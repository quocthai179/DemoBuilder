# ADR-0001: Tách phần xác định (toolkit) và văn xuôi (agent) cho user guide — skeleton có marker
Status: Proposed
Date: 2026-11-25

## Context
Requirements `.squad/requirements/user-guide-writer.md` yêu cầu hai loại việc:
- Việc cần **xác định**: chọn bước (FR-5/6), đánh số (FR-9), tên file ổn định (FR-15, NFR-2), mask/hide (FR-12), không lộ secret (NFR-1), PDF khớp `guide.md` (FR-22), refresh không ghép sai ảnh (FR-24).
- Việc cần **văn xuôi tốt**: câu mệnh lệnh nêu nhãn UI (FR-17), mục tiêu, kết quả mong đợi, alt text mô tả hành động (FR-19), và L2 fallback khi UI không phải tiếng Anh (Q1 → L3).

Toolkit hiện là CLI Node thuần, không LLM (`scripts/demo.mjs`). Agent là file Markdown điều khiển CLI (ví dụ `agents/flow-engineer.md`). QA cần kiểm thử được offline mà không cần LLM.

## Options considered
| Option | Pros | Cons |
|---|---|---|
| A. Toolkit sinh toàn bộ text từ template | Hoàn toàn xác định, test dễ | Văn cứng, không viết được goal/expected result/L2 tự nhiên; không đáp ứng "người đọc là end user" |
| B. Agent viết toàn bộ `guide.md` tự do từ `steps.json` | Văn linh hoạt | Cấu trúc/đường dẫn ảnh/đánh số không đảm bảo; render phải parse Markdown tuỳ ý; refresh/kiểm tra khó |
| C. Toolkit sinh **skeleton** có marker (`<!-- guide:step n= id= -->`), dòng ảnh, alt và câu template; agent chỉ thay văn xuôi trong khối | Cấu trúc + ảnh + số bước xác định; có bản dùng được không cần LLM (test); render/kiểm tra/merge dựa trên marker | Cần quy ước tập con Markdown; agent phải giữ marker (có kiểm tra ở render) |

## Decision
Chọn **C**.
- `lib/guide.mjs` sinh `steps.json` (hợp đồng dữ liệu) và `guide.skeleton.md`, rồi tạo `guide.md` từ skeleton **chỉ khi chưa có**.
- Agent `guide-writer` viết văn xuôi tiếng Anh vào `guide.md`. Agent cũng chọn dữ liệu giả và ghi vào `guide.yaml` (`value:`) **trước** capture để giá trị cố định giữa các lần chạy (FR-13).
- Mọi kiểm tra chạy trong `guide render` và là code xác định:
  - ảnh tồn tại;
  - alt không rỗng;
  - không có secret, không có URL từ xa;
  - marker khớp `steps.json`;
  - không còn `TODO(guide)`.

## Consequences
- QA kiểm thử được toàn bộ pipeline (plan → capture → skeleton → render → refresh → approve) mà không cần LLM.
- Agent bị ràng buộc bởi quy ước marker. Nếu marker hỏng, render báo `STEP_MARKERS_MISMATCH` thay vì sinh PDF sai im lặng.
- Phải viết và duy trì một bộ chuyển tập con Markdown → HTML nhỏ (`lib/guide-md.mjs`). Xem ADR-0005.
