# Code review (re-review r2): user-guide-writer
Verdict: APPROVE WITH NITS (no blocking; 2 should-fix)

Suite run: `node --test tests/` 135/135 pass, 115 s.

## Previous findings
1. UNCLOSED_COMMENT: FIXED (guide.mjs:722-723, guide-md.mjs:148; render exits 1, writes nothing; tested).
2. Non-atomic promote / EISDIR: FIXED. Staging, foreign files cpSync recursive, rename-only swap, rollback by `done` flags (guide.mjs:657-696). Traced: failure after imgs->old, after new imgs, after steps/skel all restore correctly. Only gap: a failed guide.md write (createMd) leaves a partial guide.md (minor, nit).
3. SECRET_VALUE scope: FIXED (secretGuard runs for every screen action, fails closed, select refused, press/evaluate refused statically; tested).
4. manual.verb drives wording: FIXED (guide.mjs:239,530; guide-md.mjs:28,58).
5. --json for any error + guarded prev.plan: FIXED (guide.mjs:429,901; tested).
6. prepareSession direct tests: FIXED (hardening.test.mjs:325+).

## Blocking
None.

## Should fix
1. `guide.mjs:455,472-475,618` — redirect to an unapproved host is only detected, and capture keeps running. The `request`/`framenavigated` listeners only add to `blocked`; the flow loop checks `blocked.size` only after the last scene or in the catch. Scenario: approved host 302 -> sso.other.com, the page there happens to have a matching selector (or a `click: "button"`), so `d.act` clicks/types on the foreign site (data creation, and the request already left the machine) before the end-of-run check. The `envStop` text also says "the request was blocked", which is false for redirect hops. Fix: check `if (blocked.size) throw envStop()` after `d.goto`, at the top of each action iteration and before `d.act`; or throw from inside the request listener via a flag the Director reads. Reword the message ("direct navigations are blocked; redirects are detected after the hop"). Test at hardening:244 only passes because `#go` is absent on the foreign page.
2. `agents/guide-writer.md:39,50` — still documents bare `[--confirm-env]`, which now confirms nothing (breaking change). An agent following it gets ENV_UNCONFIRMED loops. Fix: `[--confirm-env=<host[,host]>]`, only for hosts the user named (as line 102 says).

## Nits
- `guide.mjs:438,431` — `--confirm-env=*.acme.com` is not honoured (exact match only), while `env.allow` supports wildcards. Either document "exact hosts only" or use `hostAllowed(h, confirmed)`.
- `isLocalHost` treats all RFC1918 ranges and `.test/.local` as trusted without confirmation; a private-IP staging server needs no confirmation. Fine if intended; spec-reference says "Local hosts are always fine" — consider stating private ranges explicitly.
- Gate checked for false positives: `about:blank`, `data:`, `blob:`, `chrome-error:` are ignored (only http(s) and file are noted); file:// sample-app works (tests e2e pass, contacted=['file']); same-host redirects approved; IPv6 brackets normalised; SW/subframe requests skipped safely (try/catch, parentFrame check). Listeners live on contexts that are closed with the browser in `finally`: no leak. `context.route` disables Chromium HTTP cache for http(s) in capture only; no video impact.
- Video path: per-selector rules in overlayInit only changes CSS shape (one rule per selector); behaviour for valid selectors identical, an invalid selector now drops only itself. video-regression tests pass. No regression found. (Video path does not validate selectors; acceptable.)
- Tests: local server is a spawned child on port 0, killed in `finally`; no fixed ports; deterministic. Suite is slow (~2 min) but stable.
- Docs == code otherwise: HELP, SKILL.md, spec-reference, README and tests/README match `--confirm-env=<host>` and `env.allow` semantics (apart from guide-writer.md above).

## Good
- Fail-closed policy, advisory keywords never approve, wildcard allow validated by HOST_RE.
- Staged promote with explicit rollback and tests that force a failure.
- Mask handling: per-rule CSS, MASK_INVALID before capture, MASK_UNMATCHED, no DOM-derived label for masked targets.

Lessons: gates that only "detect after the fact" must also stop the actor immediately (check the flag before each action), not at end of run.

### Handoff
- Status: done
- Artifacts: report inline; /home/user/DemoBuilder/.squad/reports/2026-11-25-review-user-guide-writer-r2.md
- Next: developer — fix should-fix 1 (stop on blocked redirect before next action, correct message) and 2 (guide-writer.md bare flag); then user — run /dev-squad:review before confirming the push/MR
- User actions: none
- Risks / open questions: Is auto-trust of private IP ranges / .test / .local intended? (security-auditor could confirm the gate threat model)
