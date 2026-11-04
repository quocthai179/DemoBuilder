---
description: Assemble and export the video — cards, music with ducking, captions, loudness, chapters, 16:9 / 9:16 / 1:1 / GIF, thumbnail
argument-hint: [slug] [e.g. "add music assets/bgm.mp3", "burn captions", "vertical + gif", "new outro CTA"]
---

Launch `demo-builder:video-editor` for:

$ARGUMENTS

It updates `brand:`, `music:`, `captions:`, `output:` and card scenes in `.demo/<slug>/demo.yaml`, runs `cards`, `assemble` and `review`, inspects the contact sheet and thumbnail, and lists every output file with duration and resolution.
