# Code review: user guide feature (demo-builder, working tree vs main)
Verdict: APPROVE WITH NITS

Paths below are relative to `plugins/demo-builder/skills/demo-toolkit/scripts/` unless they start with `tests/` or `plugins/`.
I read the full diff, guide.mjs, guide-md.mjs and the test helpers. I ran `node --test tests/`: 126/126 pass. I also probed `mdToHtml` and `printHtml` with hostile and edge-case inputs.

## 🔴 Blocking
None found.

- **T1 refactor in record.mjs is behaviour-preserving.** `prepareSession` keeps the old logic (storageState load, setup in its own context, `auth.save` write, ctx close).
  - The defaults `save=true`, `fresh=false`, `errorDir=undefined` reproduce the old call.
  - `runActions` defaults `errorDir` to `spec.dirs.recordings`, so video error paths are unchanged. The added `ensureDir` is harmless.
  - `envRefs` is an extra key on actions. Nothing hashes or serialises actions (checked `tts.mjs` and `assemble.mjs`), so recordings do not go stale.
- **HTML injection in `guide.md` is handled.** Raw HTML is escaped. I tried `<img onerror>` and `javascript:` / entity-encoded `javascript&#58;` hrefs, and a hostile step-marker id (it is escaped in `data-id`). The remote-image route abort is also present.

## 🟡 Should fix
1. `lib/guide-md.mjs:128` — an unterminated `<!--` swallows the rest of the document silently.
   - Scenario: `guide.md` has `<!-- note` with no `-->`. I verified that `"# Title\n<!-- unterminated\n## Rest\ntext"` renders only `<h1>Title</h1>`. The Steps and Expected result sections vanish from the PDF. `render` reports no finding and `approve` accepts it.
   - Fix: in `mdToHtml`, if no closing `-->` is found, stop skipping and treat the line as text. Better, add an `UNCLOSED_COMMENT` error finding to `checkGuide`. Also drop only the comment itself, not trailing text after `-->` on the same line.
2. `lib/guide.mjs:536-553` — the promote phase is not atomic across files.
   - It swaps `images/` first, then writes `steps.json`, the skeleton and `guide.md`. A failure after the swap (disk full, a `history/` copy error, EPERM on Windows) leaves new images with the old `steps.json`/`render.json`. `approve` would catch the mismatch via hashes, but "failures leave previous outputs intact" is not strictly true. `copyFileSync` of a subdirectory in `images/` (EISDIR, line 542) fails mid-promote and leaves `images.new` behind.
   - Fix: write `steps.json.tmp` and the skeleton into staging before the swap. Do the renames last, in the order steps.json then images, and wrap the whole promote in the try/catch that cleans `staging` and `images.new`. Skip directories in the foreign-file copy (`withFileTypes`, `isFile()`).
3. `lib/guide.mjs:484-493` — the secret guard has a gap in state-only scenes.
   - The `SECRET_VALUE` check runs only when `contrib.has(s.id)`. A scene excluded from `scenes:` that types `${TOKEN}` into a non-password field (such as an API-key box) is executed unguarded. The value stays visible in the input in later captured screenshots if there is no navigation in between. `scanSecrets` inspects text only, never image pixels.
   - Fix: apply the guard to every scene that precedes or interleaves captured scenes. Alternatively, warn (`SECRET_IN_STATE_SCENE`) and require `steps.<ref>.value` (honoured for non-contributing scenes too, line 486).
4. `lib/guide.mjs:21,133` — the manual-step `verb` is documented but ignored.
   - `spec-reference.md` and the config validate `verb` (`click|type|select|check|hover|look`), but nothing reads `m.verb`. The step action is always `manual`, so the sentence is always "Look at …" and the annotation is always "Look at".
   - Fix: either map `verb` to the action/template (`ps.action = verb`), or remove it from `MANUAL_KEYS` and the docs.
5. `lib/guide.mjs:753-756` — the `--json` failure contract is only honoured for `DemoError`.
   - The agent doc and README promise `{ok:false, code, error}` on failure. A Playwright, TypeError or ENOENT failure prints no JSON on stdout. The agent then has nothing to parse (stderr only).
   - Fix: emit the JSON document for any `Error`, with `code: e.code || 'ERROR'`. Also guard `prev.plan.signature` (lines 354 and 663) against a hand-edited or old `steps.json` (`prev.plan?.signature`).
6. `tests/guide/video-regression.test.mjs` — the "unchanged video pipeline" tests are relative, not baseline-based.
   - They compare `record --dry` and `validate` with versus without `guide.yaml`. That proves guide.yaml is ignored. It does not prove T1 left `record` unchanged against `main`.
   - Fix: add a test for `prepareSession` itself (`auth.save` written by default, not written with `save:false`; error PNG location via the default `errorDir`). Optionally run the same dry record against the pre-change `record.mjs` via `git show main:` into a temp dir.

## 🟢 Nits / optional
- `lib/guide-md.mjs:129` — the heading regex strips trailing `#`, so `### 1. Learn C#` renders as "Learn C" (verified). Only strip when preceded by whitespace: `/^(#{1,4})\s+(.*?)(?:\s+#+)?\s*$/`.
- `lib/guide-md.mjs:113` — hrefs are double-escaped (`&quot;` becomes `&amp;quot;`). It is safe but wrong for query strings with quotes. Unescape all entities, or build the href from the raw URL.
- `lib/guide-md.mjs:121,152` — an inline image mid-paragraph (`text ![x](a.png) text`) renders as `!<a href>` (verified). `checkGuide` still validates it as an image. Either support or reject it, e.g. an `INLINE_IMAGE` warning.
- `lib/guide-md.mjs:100,132` — `scanImages` and `mdToHtml` do not support paths with spaces or parentheses (`<my file.png>` renders `src="&lt;my"`). Images are always generated without them, so low risk. Only hand-added assets are affected.
- `lib/guide.mjs:635` — the footer uses `doc.task.title` (config) while the cover uses the `guide.md` H1. They can differ after a manual edit. Derive both from the H1.
- `lib/guide.mjs:301-306` — `contrastText` is correct, and fine as is.
- `lib/guide.mjs:555-556` — `guide/errors/` is never cleared after a successful capture, so old error PNGs linger. `guide init` only adds `.gitignore` entries for new projects; existing workspaces are not updated.
- `lib/guide.mjs` is 757 lines and mixes config, planning, capture, render and the CLI. Splitting out `guide-config.mjs` (lines 35-158) and `guide-capture.mjs`, or at least pulling the 120-line `shoot` closure out of `capture`, would help. `README` and the playbook docs are otherwise consistent with the code (13 commands, 11 agents, exit codes 1 and 2, `MERGE_NEEDED`).
- `lib/guide.mjs:444` — the locale-mismatch heuristic flags any non-ASCII letter in a label (such as "Café"). This matches the documented English-only design. It is noisy for apps with legitimately accented English labels; consider downgrading to a hint.
- Windows: `render` and the fonts use `pathToFileURL` correctly. The pre-existing `resolveUrl` in record.mjs builds `file://${abs}`, which is wrong on Windows. Out of scope, but `capture` inherits it for relative URLs.

## ✅ What's good
- Plan, signature, diff and `PLAN_MISMATCH` (exit 2) happen before any browser or file write. Tests verify that `guide/` is untouched.
- `approve` re-verifies hashes of `guide.md`, every image, the PDF and the plan signature. The `refresh` then failed-`render` path therefore cannot promote a stale PDF.
- Secret handling is layered: the `envRefs` passive record, a redacted value in `steps.json`, a password-field exemption, the `SECRET_VALUE` guard, and a pre-render scan of `guide.md`, `steps.json` and `guide.html`.
- Markdown to HTML escapes everything first and has a safe-href whitelist. The offline route abort and the REMOTE_IMAGE checks are solid.
- The tests use temp copies, clean up on exit, cover the failure paths (broken selector during refresh and capture, tamper, TODO, merge) and have a browser-skip guard. Everything is zero-dependency. 126/126 pass.
- Annotation placement logic (candidate, fit and mask-collision checks, arrow) is self-contained and unit/e2e tested via pixel checks.

## Questions for the author
1. Is silent skipping of an unclosed HTML comment intended, or should it be a render error?
2. Should `manual.verb` drive the step wording, or be dropped from the schema?
3. Should `refresh` also be allowed to proceed when only selectors changed? Today `planSignature` ignores selector and nth, and it only emits `SELECTOR_CHANGED` as a warning. This looks intentional, but please confirm.

Lessons: none (`.squad/LESSONS.md` is not on `main`).

### Handoff
- Status: done
- Artifacts: report inline; /home/user/DemoBuilder/.squad/reports/2026-11-25-review-user-guide-writer.md
- Next: developer — fix 🟡 items 1-5 (small, localised), add the `prepareSession` test (6); then user — run /dev-squad:review before confirming any push/MR
- User actions: decide on the `manual.verb` question; nothing to run
- Risks / open questions: the secret guard gap for state-only scenes (🟡3) is the only item touching the "no secrets in outputs" invariant. Consider `security-auditor` if that invariant is contractual.
