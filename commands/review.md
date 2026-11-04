---
description: QA the current cut — frames, sync, pacing, loudness, typos, leaked personal data, claims — and route fixes
argument-hint: [slug]
---

Launch `demo-builder:demo-qa` for `.demo/<slug>/` ($ARGUMENTS).

It runs `status` and `review`, inspects every frame and the captions, checks the brief's must/must-not lists and writes `qa/qa-report.md` with a SHIP / FIX FIRST verdict. Then, from this session, dispatch each high/medium finding to its owner agent (scriptwriter, flow-engineer, voice-producer, screen-recorder, video-editor), rebuild only affected scenes, and re-run QA until SHIP or the user accepts the remaining items.
