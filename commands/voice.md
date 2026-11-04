---
description: Generate or redo the voice-over — choose provider/voice (free Edge TTS incl. Vietnamese, OpenAI, ElevenLabs, Google, your own recording), fix pronunciation
argument-hint: [slug] [e.g. "giọng nam", "use elevenlabs", "fix pronunciation of 'Kubernetes'", "scenes intro,pricing"]
---

Launch `demo-builder:voice-producer` for:

$ARGUMENTS

It updates `voice:` / `voice.lexicon` in `.demo/<slug>/demo.yaml`, runs the toolkit's `tts` (only the affected scenes when possible), compares durations with the script and lists scenes that now need re-recording. Remind the user to listen to a sample before the full render if the voice is new.
