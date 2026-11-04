---
name: voiceover
description: Voice-over reference for demo videos — choosing between free Edge TTS (incl. Vietnamese voices), OpenAI, ElevenLabs, Google Cloud TTS, offline espeak, silent drafts and recording your own voice; API keys, voice names, rate/style settings, pronunciation lexicon tricks, recording tips, and how voice changes affect recording sync. Use when configuring `voice:` in demo.yaml, generating audio, or fixing pronunciation/pacing.
---

# Voice-over guide

## Providers

| Provider | Cost / key | Quality | Vietnamese | Notes |
|---|---|---|---|---|
| `edge` | Free, no key (`pip install edge-tts`, needs internet) | Good neural | ✅ `vi-VN-HoaiMyNeural` (female), `vi-VN-NamMinhNeural` (male) | Default. `rate`, `pitch`, `volume`. List: `demo.mjs voices --lang vi` |
| `openai` | `OPENAI_API_KEY` | Very natural, steerable | ✅ multilingual voices | `model: gpt-4o-mini-tts`, `voice: alloy|ash|coral|echo|fable|nova|onyx|sage|shimmer…`, `instructions:` for tone/pace, `speed` |
| `elevenlabs` | `ELEVENLABS_API_KEY` | Most expressive; cloning | ✅ with `eleven_multilingual_v2` / newer multilingual models | `voice:` = voice id; `stability`, `similarity`, `style`; clone only with the speaker's consent |
| `google` | `GOOGLE_TTS_API_KEY` | Solid | ✅ `vi-VN-Wavenet-*`, `vi-VN-Neural2-*` | `speakingRate` |
| `espeak` | Free, offline | Robotic | ✅ basic | Only for offline drafts |
| `silent` | Free | – | – | Estimated-length silence for pacing drafts — never deliver |
| recorded file | Free | Human | ✅ | `audio: assets/vo/<scene>.wav` per scene |

Check availability with `node demo.mjs doctor`. Keys go in environment variables only (`export OPENAI_API_KEY=…`), never in files.

## Choosing

- Customer-facing sales demo in Vietnamese, no budget → `edge` HoaiMy (warm) or NamMinh (calm, corporate).
- Premium launch video / need emotion → `elevenlabs` or `openai` with `instructions: "Friendly, confident product presenter. Medium pace, smile in the voice, slight pause before key numbers."`
- Founder/presenter's own voice → record per scene (see below) or cloned ElevenLabs voice with written consent.
- Match gender/tone to the brief; keep one voice per video (two voices only for deliberate dialogue).

## Pronunciation (lexicon)

`voice.lexicon` replaces written forms with spoken forms **before TTS only** (captions keep the original):

```yaml
voice:
  lexicon:
    CRM: "xê rê em"
    API: "ê pi ai"
    SaaS: "sát"
    Kubernetes: "cu bơ nê tít"
    "1.250.000 ₫": "một triệu hai trăm năm mươi nghìn đồng"
    acme.vn: "ác mi chấm vi en"
```

Matching is whole-word and case-sensitive. Test tricky words in a 1-scene spec before the full run. If a word is still wrong, rephrase the sentence.

## Pacing

- Natural: vi ≈ 2.6–2.9 words/s, en ≈ 2.4–2.6 words/s. Review flags > 1.3× as rushed.
- Prefer cutting words over speeding up. Small global adjustments: edge `rate: "+5%"`, openai `speed: 1.05`.
- Per scene override: `voice: { rate: "-8%" }` for a key message.
- `[pause]` in narration gives a short beat.

## Recording your own voice

- Quiet room, close mic (USB condenser or headset), pop filter; 48 kHz WAV.
- One file per scene, named by scene id; leave ~0.3 s of silence at both ends.
- Read from `script.md`; keep the same distance and energy across scenes.
- Clean up: `ffmpeg -i raw.wav -af "highpass=f=80,afftdn=nf=-25,loudnorm=I=-16:TP=-1.5" assets/vo/intro.wav`.
- Point scenes to the files with `audio:`; `tts` measures them like generated audio.

## Sync consequences

Audio length drives scene length. After **any** narration or voice change: `tts --scenes <ids>` → `record --scenes <ids>` → `assemble`. `status` marks scenes STALE when they were recorded before their audio existed.
