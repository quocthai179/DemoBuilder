---
description: Map the app's UI flow into demo.yaml actions — explore screens, write robust selectors, login/setup, privacy masks, dry-run until green
argument-hint: [slug] [app URL or scene ids to (re)work]
---

Launch `demo-builder:flow-engineer` for:

$ARGUMENTS

It works on `.demo/<slug>/demo.yaml`, uses the toolkit's `inspect` to see each screen, keeps secrets in `${ENV_VAR}` placeholders, adds `mask:`/`hide:` selectors for personal data and distractions, and repeats `record --dry` until it passes. Report the env vars the user must export, fragile selectors and data dependencies.
