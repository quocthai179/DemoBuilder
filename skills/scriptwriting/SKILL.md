---
name: scriptwriting
description: Craft guide for writing product demo video scripts and narration — story structures (problem-solution, day-in-the-life, before/after, feature spotlight), hooks, word budgets per length and language (Vietnamese ~165 words/min, English ~150), writing for the ear and for TTS, scene sizing, CTA patterns, and Vietnamese-specific tips. Use when writing or editing script.md or the narration in demo.yaml.
---

# Demo scriptwriting guide

## Pick a structure

| Structure | When | Beats |
|---|---|---|
| **Problem → solution** (default) | Prospect knows the pain | Pain (1 scene) → product turns it (2–4 value moments) → result + CTA |
| **Day in the life** | Workflow tools, ops teams | Persona starts their day → 3 moments where the product saves time → end of day result |
| **Before / after** | Replacing spreadsheets/legacy | Old way (fast, slightly painful) → new way side by side → numbers |
| **Feature spotlight** | Release notes, existing customers | What's new → why it matters → how (1 flow) → where to find it |
| **Deep dive / walkthrough** | Technical evaluators, onboarding | Agenda card → chapters per module → recap card |

## Length budgets

| Format | Length | Narration words (vi ≈ 165 wpm · en ≈ 150 wpm) | Scenes |
|---|---|---|---|
| Social teaser (vertical) | 30–60 s | vi 80–160 · en 70–150 | 3–5 |
| Sales teaser | 60–90 s | vi 160–240 · en 150–220 | 5–7 |
| Overview | 2–3 min | vi 320–490 · en 300–450 | 8–12 |
| Deep dive | 5–8 min | chapters of ≤ 90 s | 15–30 |

Leave ~10 % of time without words — visuals need breathing room (cards, zooms, typing).

## Scene rules

- One idea, one screen, 6–20 seconds. Longer → split, or add a `chapter` card.
- First words of a scene describe what the viewer is about to *see* — then the action happens (`at:` sync).
- Name the benefit, then the feature: "Không cần nhập lại dữ liệu — hệ thống tự điền từ hợp đồng."
- Use concrete data that matches the customer's world (industry, currency, Vietnamese names) — never real customer data.
- Max one number per sentence; say it the way it should be heard ("ba mươi phần trăm" or "30%" — check TTS reads it correctly, otherwise lexicon).

## Hooks (first 5–8 s)

- Outcome: "Từ đơn hàng đến hoá đơn chỉ trong 30 giây."
- Pain: "Mỗi cuối tháng đội kế toán mất hai ngày để đối soát?"
- Contrast: "Trước đây: 12 bước. Bây giờ: 3 cú nhấp."
Avoid: "Xin chào, hôm nay tôi sẽ giới thiệu…" as the first line (put greetings after the hook, or skip them).

## CTA patterns

One action, concrete, low friction: "Đặt lịch 30 phút với đội triển khai", "Dùng thử miễn phí 14 ngày tại acme.vn", "Trả lời email này để nhận bản demo trên dữ liệu của bạn". Put it on the outro card *and* in narration.

## Writing for the ear (and TTS)

- Sentences ≤ 20 words; one clause per breath. Read aloud mentally.
- No parentheses, slashes, bullet fragments, emojis, URLs read character by character (say "acme chấm vi en" or show it on the card instead).
- Acronyms and English terms: decide the spoken form and add it to `voice.lexicon` (`API: "ê pi ai"`, `SaaS: "sát"`, `KPI: "cây pi ai"`), or keep them English if the audience says them in English.
- `[pause]` for a beat before a key reveal.
- Consistent terminology: if the UI says "Khách hàng", don't narrate "client".

## Vietnamese tips

- Register: "bạn" for SMB/marketing; "anh chị"/"quý doanh nghiệp" only for formal enterprise/government audiences (decide in the brief).
- Prefer active, concrete verbs: "tạo", "gửi", "duyệt", "theo dõi" over "thực hiện việc…", "tiến hành…".
- Avoid stacking Hán-Việt nouns ("tối ưu hoá quy trình vận hành hiệu quả") — say what changes: "giảm một nửa thời gian duyệt đơn".
- Diacritics must be perfect in cards/captions; numbers use Vietnamese formatting on screen (1.250.000 ₫, 30/11/2026).
- Mixed language: keep brand/product names as written; check TTS pronunciation of each with the voice producer.

## script.md template

```markdown
# Script — <title>
Target: 1:30 · vi-VN · voice: female, warm, medium pace · structure: problem → solution
Hook: "…"   CTA: "…"
| # | Scene id | Type | On screen | Narration | ~sec |
|---|---|---|---|---|---|
Estimated total: 1:27 (238 words)
Lexicon: CRM → "xê rê em"; Zalo OA → "da lô ô a"
Open questions: …
```
