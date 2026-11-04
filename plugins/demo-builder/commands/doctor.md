---
description: Check and install what the demo toolkit needs (Node, ffmpeg, Playwright + Chromium, edge-tts, API keys)
---

1. Resolve the toolkit path as described in the `demo-toolkit` skill.
2. Run `node <demo.mjs> doctor` and show the result.
3. For anything missing, propose the exact install command for the user's OS (ffmpeg via brew/apt/winget; `node <demo.mjs> setup` for Playwright + yaml + Chromium; `pip install edge-tts` for free voices). Ask before installing system packages; `setup` only touches `~/.cache/demo-builder`.
4. Re-run `doctor` and confirm "Ready to build demos".
5. Optionally offer a smoke test: copy `<toolkit>/examples/sample-app` (next to `scripts/`) to a temp folder and run `node <demo.mjs> build <tmp>/demo.yaml --provider silent` (use `--provider edge` if edge-tts is installed).
