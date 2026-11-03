---
description: Make a complete product demo video end-to-end with the demo squad — brief → script → flow → voice → record → edit → QA → launch copy
argument-hint: <product / app URL, audience or customer, goal, length, language — e.g. "app.acme.vn cho khách hàng ngân hàng, 2 phút, tiếng Việt">
---

Produce a customer demo video with the demo-builder squad for:

$ARGUMENTS

Follow the `demo-playbook` skill. Run the orchestration from this session (subagents cannot launch subagents):

1. **Set up** — resolve the toolkit path (`demo-toolkit` skill), run `doctor` (offer `setup` if Playwright/ffmpeg/edge-tts are missing), choose a slug and `init .demo/<slug>`.
2. **Brief** — launch `demo-builder:demo-strategist` with everything the user gave (product, customer, goal, length, language, app URL). Output `.demo/<slug>/brief.md`.
3. **Script** — launch `demo-builder:scriptwriter` → `script.md` + scenes/narration in `demo.yaml`.
4. **Checkpoint ⏸** — show the user the brief summary and the storyboard table; get approval or changes before recording. Ask which env vars hold credentials if login is needed.
5. **In parallel:** `demo-builder:flow-engineer` (actions, selectors, setup/login, masks, `record --dry` green) ∥ `demo-builder:voice-producer` (voice choice, lexicon, `tts`).
6. **Record** — `demo-builder:screen-recorder` records, reviews frames, retakes scenes.
7. **Edit** — `demo-builder:video-editor` cards, music, captions, exports, thumbnail.
8. **QA** — `demo-builder:demo-qa` → `qa/qa-report.md`. Route every high/medium finding to its owner and loop (steps 5–8 for the affected scenes only) until the verdict is SHIP.
9. **Checkpoint ⏸** — show the user the final paths, length, contact sheet and thumbnail; get approval.
10. **Copy** — `demo-builder:launch-copywriter` → `copy/` (titles, description + chapters, customer email, social post, talking points).

Close with: deliverables and paths, duration, voice used, open risks, and the one-line commands to retake a scene or rebuild. Do not commit, upload or send anything unless the user asks.
