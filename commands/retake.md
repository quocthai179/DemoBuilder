---
description: Fix one thing fast — re-voice and/or re-record specific scenes and re-render
argument-hint: [slug] [scene id(s)] [what is wrong, e.g. "dashboard: highlight comes too early, say 'tăng 30%' instead"]
---

Quick fix loop for: $ARGUMENTS

1. Decide what changed: narration text → `demo-builder:scriptwriter` (that scene only); pronunciation/voice → `demo-builder:voice-producer` (`tts --scenes <ids>`); actions/selectors/timing → `demo-builder:flow-engineer` or `demo-builder:screen-recorder`. Small, obvious edits you may make directly in `demo.yaml`.
2. Run `tts --scenes <ids>` if narration changed, then `record --scenes <ids>` (narration length changes always require re-recording that scene).
3. `assemble` and `review`; look at the frames of the changed scenes.
4. Report what changed and the updated output paths.
