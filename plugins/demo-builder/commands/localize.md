---
description: Make a localised version of a demo in another language (narration, cards, native voice, re-record in the app's locale or reuse footage)
argument-hint: <slug> <language, e.g. en-US | ja-JP | th-TH>
---

Launch `demo-builder:localizer` for: $ARGUMENTS

It creates `.demo/<slug>-<lang>/` from the approved source spec, adapts narration and cards, picks a native voice and lexicon, and decides (with the trade-off stated) between re-recording with the app's locale and reusing the source recordings. Then generate voice, record if needed, assemble, and run `demo-builder:demo-qa` on the new cut. Flag lines that need a native speaker's check.
