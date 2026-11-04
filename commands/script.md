---
description: Write, shorten or rewrite the demo storyboard and narration (into script.md and demo.yaml)
argument-hint: [slug] [instructions, e.g. "cut to 60 seconds", "more formal tone", "rewrite scene pricing"]
---

Launch `demo-builder:scriptwriter` for:

$ARGUMENTS

It must read `.demo/<slug>/brief.md` (if the slug is not given, use the only/most recent folder under `.demo/`), update `script.md` and the scenes in `demo.yaml` without deleting working `actions:`, run `validate`, and report estimated vs. target length. Show the user the storyboard table. If narration of already-recorded scenes changed, tell the user which scenes need new voice-over and re-recording.
