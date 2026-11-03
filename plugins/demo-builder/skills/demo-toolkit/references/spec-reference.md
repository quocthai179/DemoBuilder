# demo.yaml reference

Paths are relative to the spec file. Strings in `baseUrl`, `setup`, scene `url` and `actions` may use `${ENV_VAR}` or `${ENV_VAR:-default}`; a missing variable without a default is an error (secrets never live in the file). A `.json` spec with the same structure also works.

## Top level

| Key | Default | Meaning |
|---|---|---|
| `title` | folder name | Video title (cards, thumbnail) |
| `language` | `en-US` | Narration language (TTS defaults, words-per-minute estimates) |
| `locale` | `language` | Browser locale while recording |
| `timezone`, `colorScheme` | – / `light` | Browser emulation |
| `targetDuration` | – | Seconds; review warns when off by > 15 % |
| `baseUrl` | – | Base for relative scene/action URLs |
| `viewport` | `1600×900` | Browser size; keep 16:9 for 16:9 output |
| `headless` | `true` | `false` to watch (same as `--headed`) |
| `ignoreHTTPSErrors` | `false` | For self-signed staging certificates |
| `hideScrollbars` | `true` | Hide page scrollbars |
| `output.dir` / `name` | `output` / `demo` | Output folder / base file name |
| `output.width/height/fps/crf` | 1920/1080/30/20 | Render settings |
| `output.background` | `#0b0d12` | Letterbox colour |
| `output.formats` | `[mp4]` | Extra: `vertical`, `square`, `gif` |
| `output.gif` | `{start:0,duration:12,width:960,fps:12}` | GIF preview |
| `output.thumbnail` | `{}` | `{ title, eyebrow, subtitle, at }`; `title: false` = plain frame |
| `voice` | edge | See below; scenes may override any field |
| `timing` | see below | Global pacing |
| `cursor` | shown | `{ show, color, ring, size, clickRipple }` |
| `captions` | sidecar | `{ sidecar, burn, maxChars: 42, maxLines: 2, style }` (`style` = ASS force_style) |
| `music` | none | `{ file, volume: 0.15, duck: true }` |
| `loudness` | `-16` | Target integrated LUFS (-14 for social) |
| `brand` | indigo/dark | `{ primary, accent, background, text, font, logo }` for cards, highlights, thumbnail |
| `mask` | `[]` | CSS selectors blurred on every page |
| `hide` | `[]` | CSS selectors hidden on every page |
| `auth` | – | `{ storageState: file, save: file }` — reuse/save a logged-in session |
| `setup` | `[]` | Off-camera actions run in a separate context before recording; its session carries into the take |
| `paths` | – | Override work dirs: `{ audio, recordings, cards, build, review }` (e.g. reuse recordings from another language) |
| `scenes` | required | List of scenes |

### `voice`

| Key | Providers | Meaning |
|---|---|---|
| `provider` | – | `edge` · `openai` · `elevenlabs` · `google` · `espeak` · `silent` · (per scene `audio:` file) |
| `voice` | all | Voice name/id (edge `vi-VN-HoaiMyNeural`, openai `alloy`/`nova`/…, elevenlabs voice id, google `vi-VN-Neural2-A`…) |
| `rate`, `pitch`, `volume` | edge | `"+10%"`, `"-2Hz"`, `"+0%"` |
| `model` | openai, elevenlabs | e.g. `gpt-4o-mini-tts`, `eleven_multilingual_v2` |
| `instructions` | openai | Delivery style: "Warm, confident presenter, medium pace" |
| `speed` | openai, silent | 0.25–4 |
| `stability`, `similarity`, `style`, `languageCode` | elevenlabs | Voice settings |
| `speakingRate` | google | 0.25–4 |
| `wpm` | espeak | Words per minute |
| `lexicon` | all | `{ written: spoken }` replacements for audio only |

### `timing`

| Key | Default | Meaning |
|---|---|---|
| `audioDelay` | 0.4 s | Silence before narration starts in each scene |
| `tail` | 0.6 s | Hold after narration ends |
| `typeDelay` | 55 ms | Per keystroke for `type` |
| `moveMs` | 650 ms | Max cursor travel time |
| `actionGap` | 350 ms | Pause after each action |
| `highlightMs` | 1400 ms | Default highlight duration |

## Scene

| Key | Meaning |
|---|---|
| `id` | Unique, `[a-zA-Z0-9_-]` (used for files and `--scenes`) |
| `type` | `screen` (default when `url`/`actions` exist) or `card` |
| `narration` | Spoken text. `[pause]` adds a pause; `*word*` is spoken plain. |
| `audio` | Use a recorded file instead of TTS |
| `voice` | Per-scene voice override (e.g. `{ rate: "-5%" }`) |
| `chapter` | Chapter label (cards default to their title) |
| `url` | Navigate here at scene start |
| `actions` | List of actions (screen scenes) |
| `audioDelay`, `tail`, `minDuration` | Per-scene timing |
| `trimStart`, `trimEnd` | Seconds cut from the recorded segment |
| `transition` | `fade` (cards default) or `none` |
| Card fields | `eyebrow`, `title`, `titleSize`, `subtitle`, `bullets`, `cta`, `footer`, `layout: center|left`, `background` (image), `brand` override, `duration`, or raw `html` |

## Actions

Write each action as `- name: value` or `- name: { …options }`. Every action accepts `gap` (ms pause after it), `timeout` (ms), and element actions accept `nth` (pick the n-th match), `move: false` (no cursor travel), `moveMs`, `offsetX`/`offsetY` (0–1 inside the element).

| Action | Short form | Options |
|---|---|---|
| `goto` | url | `waitUntil` |
| `click`, `dblclick` | selector | `force` |
| `hover` | selector | `ms` |
| `type` | – | `selector`, `text`, `delay`, `clear` (default true), `enter` |
| `fill` | – | `selector`, `text` (instant) |
| `press` | key | e.g. `Enter`, `Control+K` |
| `select` | – | `selector`, `value`/`label` |
| `check`, `uncheck` | selector | |
| `upload` | – | `selector`, `files` |
| `scroll` | selector | or `{ y: 600 }`, `{ to: top|bottom }`, `ms` |
| `wait` | ms | |
| `waitFor` | selector | `state: visible|hidden|attached` |
| `waitForUrl` | url | substring or glob |
| `highlight` | selector | `label`, `ms`, `hold`, `style: glow|spot`, `padding`, `position: top|bottom`, `move` |
| `spotlight` | selector | same as highlight with dimmed surroundings |
| `callout` | selector | alias of highlight with `label`/`text` |
| `clear` | – | remove held highlights |
| `zoom` | selector | `scale` (1.6), `ms` (700), `hold` (seconds, then auto-unzoom) |
| `unzoom` | – | `ms` |
| `moveTo` | selector | or `{ x, y }` |
| `at` | seconds | wait until N s after scene start (sync with narration) |
| `caption` | text | on-screen caption bubble inside the recording (`""` hides) |
| `screenshot` | path | save a still |
| `evaluate` | script | run JS in the page (escape hatch) |
| `reload` | – | |

Selectors are Playwright selectors: CSS (`#save`, `[data-testid=total]`), text (`text=Save`), `:has-text("…")`, chained (`nav >> text=Customers`), XPath (`xpath=//button`).

## Files written

```
audio/<id>.mp3|wav, audio/manifest.json
recordings/take-<time>.webm, recordings/timeline.json, recordings/error-*.png
cards/<id>.png
build/NN-<id>.mp4, build/joined.mp4
output/<name>.mp4, <name>-vertical.mp4, <name>-square.mp4, <name>-preview.gif, <name>-thumbnail.png,
       <name>.srt, <name>.vtt, <name>.chapters.txt, <name>.timeline.json
review/NNN-<id>-start|mid|end.jpg, review/contact-sheet.jpg, review/report.md, review/inspect/*
```
