// Unit tests: pure functions of lib/guide.mjs, lib/guide-md.mjs, lib/spec.mjs (no browser, no network).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LIB, mkSpec, tmpDir } from './helpers.mjs';

const G = await import(LIB('guide.mjs'));
const M = await import(LIB('guide-md.mjs'));
const S = await import(LIB('spec.mjs'));

// A spec with a card, a setup login, two screen scenes, visual-only / non-step actions and a guideId.
const DEMO = `
title: Unit
baseUrl: http://localhost:3000
setup:
  - goto: /login
  - type: { selector: "#u", text: "admin" }
scenes:
  - id: intro
    type: card
    title: Welcome card
    subtitle: sub
  - id: s1
    url: /a
    actions:
      - wait: 100
      - click: "#a"
      - hover: "#h"
      - highlight: { selector: "#x" }
      - type: { selector: "#t", text: hi }
        guideId: typeit
      - scroll: { y: 300 }
      - press: { key: Enter }
      - goto: /b
      - zoom: { selector: "#z" }
      - screenshot: { path: x.png }
  - id: s2
    actions:
      - select: { selector: "#sel", value: v }
      - check: "#c"
      - uncheck: "#c"
      - dblclick: "#d"
      - upload: { selector: "#f", file: x.txt }
      - fill: { selector: "#fi", text: t }
      - spotlight: { selector: "#sp" }
  - id: outro
    type: card
    title: Bye
`;
const ids = (plan) => plan.steps.map((s) => s.id);

describe('parseRef', () => {
  test('numeric and guideId references', () => {
    assert.deepEqual(G.parseRef('add-contact.3'), { scene: 'add-contact', index: 3 });
    assert.deepEqual(G.parseRef('s1.save_btn-2'), { scene: 's1', guideId: 'save_btn-2' });
    assert.deepEqual(G.parseRef('s1.10'), { scene: 's1', index: 10 });
  });
  test('malformed references return null', () => {
    for (const bad of ['nodot', '.3', 'a.', 'a.3x', 'a.1abc', 'a.b.c', 'a. b', '', 'a.-x']) assert.equal(G.parseRef(bad), null, JSON.stringify(bad));
  });
  test('non-string input is coerced, not thrown', () => { assert.equal(G.parseRef(42), null); });
});

describe('buildPlan', () => {
  test('default: only interactive actions become steps, numbered 1..N, in flow order (AC-1.2)', async () => {
    const spec = await mkSpec(DEMO);
    const plan = G.buildPlan(spec, G.loadGuideConfig(spec));
    assert.deepEqual(ids(plan), ['s1.2', 's1.5', 's1.7', 's2.1', 's2.2', 's2.3', 's2.4', 's2.5', 's2.6']);
    assert.deepEqual(plan.steps.map((s) => s.n), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.deepEqual(plan.steps.map((s) => s.action), ['click', 'type', 'press', 'select', 'check', 'uncheck', 'dblclick', 'upload', 'fill']);
  });
  test('visual-only / wait / scroll / goto / hover / card scenes / setup are excluded (AC-1.3, FR-6)', async () => {
    const spec = await mkSpec(DEMO);
    const plan = G.buildPlan(spec, G.loadGuideConfig(spec));
    for (const excluded of ['s1.1', 's1.3', 's1.4', 's1.6', 's1.8', 's1.9', 's1.10', 's2.7']) assert.ok(!ids(plan).includes(excluded), excluded);
    assert.ok(!plan.steps.some((s) => s.scene === 'intro' || s.scene === 'outro' || s.action === 'goto'));
  });
  test('guideId is carried through and used as the local name', async () => {
    const spec = await mkSpec(DEMO);
    const st = G.buildPlan(spec, G.loadGuideConfig(spec)).steps.find((s) => s.id === 's1.5');
    assert.equal(st.guideId, 'typeit'); assert.equal(st.local, 'typeit');
    assert.equal(G.buildPlan(spec, G.loadGuideConfig(spec)).steps[0].local, '2');
  });
  test('skip removes a step and numbering stays contiguous (AC-2.1); guideId ref works', async () => {
    const spec = await mkSpec(DEMO, 'steps:\n  s1.2: { skip: true }\n  s1.typeit: { skip: true }\n');
    const plan = G.buildPlan(spec, G.loadGuideConfig(spec));
    assert.ok(!ids(plan).includes('s1.2') && !ids(plan).includes('s1.5'));
    assert.deepEqual(plan.steps.map((s) => s.n), [1, 2, 3, 4, 5, 6, 7]);
  });
  test('include turns hover and goto into steps (AC-2.2); goto is captured after the action', async () => {
    const spec = await mkSpec(DEMO, 'steps:\n  s1.3: { include: true }\n  s1.8: { include: true }\n');
    const plan = G.buildPlan(spec, G.loadGuideConfig(spec));
    const h = plan.steps.find((s) => s.id === 's1.3'); const g = plan.steps.find((s) => s.id === 's1.8');
    assert.equal(h.action, 'hover'); assert.equal(h.timing, 'before');
    assert.equal(g.action, 'goto'); assert.equal(g.timing, 'after');
    assert.deepEqual(ids(plan).slice(0, 5), ['s1.2', 's1.3', 's1.5', 's1.7', 's1.8']);
  });
  test('scenes list restricts which scenes contribute steps', async () => {
    const spec = await mkSpec(DEMO, 'scenes: [s2]\n');
    assert.ok(G.buildPlan(spec, G.loadGuideConfig(spec)).steps.every((s) => s.scene === 's2'));
  });
  test('manual steps are inserted before/after their anchor and renumbered (FR-4, AC-2.x)', async () => {
    const spec = await mkSpec(DEMO, `manual:
  - { id: first, before: s1.2, selector: "#hdr" }
  - { id: last, after: s1.typeit, selector: "#msg", verb: look }
`);
    const plan = G.buildPlan(spec, G.loadGuideConfig(spec));
    assert.deepEqual(ids(plan).slice(0, 5), ['s1.first', 's1.2', 's1.5', 's1.last', 's1.7']);
    assert.equal(plan.steps.find((x) => x.id === 's1.first').verb, 'look', 'default verb');
    assert.equal(plan.steps.find((x) => x.id === 's1.last').verb, 'look');
    assert.deepEqual(plan.steps.map((s) => s.n), plan.steps.map((_, i) => i + 1));
    const m = plan.steps[0];
    assert.equal(m.source, 'manual'); assert.equal(m.action, 'manual'); assert.equal(m.selector, '#hdr');
  });
  test('signIn prerequisite appears only when the spec has setup/auth (AC-1.4)', async () => {
    const withSetup = await mkSpec(DEMO);
    assert.deepEqual(G.buildPlan(withSetup, G.loadGuideConfig(withSetup)).task.prerequisites, ['Sign in to the app.']);
    const noSetup = await mkSpec(DEMO.replace(/setup:[\s\S]*?scenes:/, 'scenes:'));
    assert.deepEqual(G.buildPlan(noSetup, G.loadGuideConfig(noSetup)).task.prerequisites, []);
    const forced = await mkSpec(DEMO.replace(/setup:[\s\S]*?scenes:/, 'scenes:'), 'signIn: true\nprerequisites: [An admin role.]\n');
    assert.deepEqual(G.buildPlan(forced, G.loadGuideConfig(forced)).task.prerequisites, ['Sign in to the app.', 'An admin role.']);
    const off = await mkSpec(DEMO, 'signIn: false\n');
    assert.deepEqual(G.buildPlan(off, G.loadGuideConfig(off)).task.prerequisites, []);
  });
  test('task fields come from guide.yaml (AC-2.4) and card titles are only hints (FR-8)', async () => {
    const spec = await mkSpec(DEMO, 'title: T\ngoal: G\nexpectedResult: E\n');
    const { task } = G.buildPlan(spec, G.loadGuideConfig(spec));
    assert.equal(task.title, 'T'); assert.equal(task.goal, 'G'); assert.equal(task.expectedResult, 'E');
    assert.deepEqual(task.hints.cardTitles, ['Welcome card', 'Bye']);
    assert.equal(G.buildPlan(await mkSpec(DEMO), G.loadGuideConfig(await mkSpec(DEMO))).task.title, null);
  });
  test('TOO_MANY_STEPS warning above 12 steps, not at 12 (FR-32, AC-4.5)', async () => {
    const mk = (n) => `title: X\nscenes:\n  - id: s\n    url: ./i.html\n    actions:\n${Array.from({ length: n }, (_, i) => `      - click: "#b${i}"`).join('\n')}\n`;
    const twelve = await mkSpec(mk(12)); const thirteen = await mkSpec(mk(13));
    assert.equal(G.buildPlan(twelve, G.loadGuideConfig(twelve)).steps.length, 12);
    assert.ok(!G.buildPlan(twelve, G.loadGuideConfig(twelve)).warnings.some((w) => w.code === 'TOO_MANY_STEPS'));
    assert.ok(G.buildPlan(thirteen, G.loadGuideConfig(thirteen)).warnings.some((w) => w.code === 'TOO_MANY_STEPS'));
  });
  test('does not mutate the spec', async () => {
    const spec = await mkSpec(DEMO, 'steps:\n  s1.2: { skip: true }\n');
    const before = JSON.stringify(spec);
    G.buildPlan(spec, G.loadGuideConfig(spec));
    assert.equal(JSON.stringify(spec), before);
  });
});

describe('planSignature / diffPlans', () => {
  const A = [{ n: 1, id: 's.1', action: 'click' }, { n: 2, id: 's.2', action: 'type' }, { n: 3, id: 's.3', action: 'click' }];
  test('signature is stable, and changes on add / remove / reorder / action change', () => {
    assert.equal(G.planSignature(A), G.planSignature(A.map((x) => ({ ...x }))));
    const sigs = new Set([G.planSignature(A), G.planSignature(A.slice(0, 2)), G.planSignature([...A, { n: 4, id: 's.4', action: 'click' }]),
      G.planSignature([A[1], A[0], A[2]].map((s, i) => ({ ...s, n: i + 1 }))), G.planSignature(A.map((s) => (s.id === 's.2' ? { ...s, action: 'fill' } : s)))]);
    assert.equal(sigs.size, 5);
  });
  test('signature ignores selectors/labels (only n, id, action)', () => {
    assert.equal(G.planSignature(A), G.planSignature(A.map((s) => ({ ...s, selector: '#changed', extra: 1 }))));
  });
  test('diff: added, removed, changedAction, moved', () => {
    const B = [{ n: 1, id: 's.2', action: 'fill' }, { n: 2, id: 's.1', action: 'click' }, { n: 3, id: 's.9', action: 'click' }];
    const d = G.diffPlans(A, B);
    assert.deepEqual(d.added.map((s) => s.id), ['s.9']);
    assert.deepEqual(d.removed.map((s) => s.id), ['s.3']);
    assert.deepEqual(d.changedAction, [{ id: 's.2', from: 'type', to: 'fill' }]);
    assert.deepEqual(d.moved.map((m) => m.id).sort(), ['s.1', 's.2']);
  });
  test('diff of identical plans is empty', () => {
    const d = G.diffPlans(A, A);
    assert.deepEqual([d.added, d.removed, d.moved, d.changedAction], [[], [], [], []]);
  });
});

describe('classifyEnv', () => {
  const env = async (baseUrl, extra = '') => G.classifyEnv(await mkSpec(`title: E\n${baseUrl ? `baseUrl: ${baseUrl}\n` : ''}scenes:\n  - id: s\n    url: ./index.html\n${extra}    actions:\n      - click: "#a"\n`));
  test('local hosts', async () => {
    for (const u of ['http://localhost:3000', 'http://127.0.0.1:8080', 'http://127.8.8.8', 'http://app.test', 'http://a.b.localhost:3000', 'http://[::1]:3000']) assert.equal((await env(u)).class, 'local', u);
  });
  test('N3: RFC1918, link-local, *.local and a host literally named "file" are NOT local: they need env.allow or --confirm-env', async () => {
    for (const u of ['http://10.1.2.3', 'http://192.168.0.5', 'http://172.20.0.1', 'http://172.40.0.1', 'http://169.254.169.254', 'http://shop.local', 'http://file', 'http://0.0.0.0']) {
      const e = await env(u); assert.notEqual(e.class, 'local', u); assert.deepEqual(e.needsConfirm, [new URL(u).hostname], u);
    }
  });
  test('staging-like hosts', async () => {
    for (const u of ['https://staging.acme.com', 'https://acme-stg.example.com', 'https://demo.acme.com', 'https://qa.acme.io', 'https://uat-app.acme.com']) assert.equal((await env(u)).class, 'staging', u);
  });
  test('production-like hosts are unknown', async () => {
    for (const u of ['https://app.acme.com', 'https://www.example.org', 'https://acme.com']) assert.equal((await env(u)).class, 'unknown', u);
  });
  test('no baseUrl and relative urls -> local file', async () => {
    const r = await env(null); assert.equal(r.class, 'local'); assert.deepEqual(r.hosts, ['file:']);
  });
  test('one production scene url makes the whole spec unknown', async () => {
    const spec = await mkSpec('title: E\nbaseUrl: http://localhost:3000\nscenes:\n  - id: s\n    url: https://app.acme.com/x\n    actions:\n      - click: "#a"\n');
    assert.equal(G.classifyEnv(spec).class, 'unknown');
  });
  test('absolute goto action to production is detected', async () => {
    const spec = await mkSpec('title: E\nbaseUrl: http://localhost:3000\nscenes:\n  - id: s\n    url: /a\n    actions:\n      - goto: https://app.acme.com/x\n      - click: "#a"\n');
    assert.equal(G.classifyEnv(spec).class, 'unknown');
  });
  test('plan carries an ENV_UNCONFIRMED warning for every non-local, non-allowlisted host (staging-like too)', async () => {
    for (const base of ['https://app.acme.com', 'https://staging.acme.com']) {
      const spec = await mkSpec(`title: E\nbaseUrl: ${base}\nscenes:\n  - id: s\n    url: /a\n    actions:\n      - click: "#a"\n`);
      const w = G.buildPlan(spec, G.loadGuideConfig(spec)).warnings.find((x) => x.code === 'ENV_UNCONFIRMED');
      assert.ok(w, base); assert.match(w.message, /--confirm-env=/);
    }
    const local = await mkSpec('title: E\nbaseUrl: http://localhost:3000\nscenes:\n  - id: s\n    url: /a\n    actions:\n      - click: "#a"\n');
    assert.ok(!G.buildPlan(local, G.loadGuideConfig(local)).warnings.some((x) => x.code === 'ENV_UNCONFIRMED'));
  });
  test('keyword heuristic ignores the TLD: acme.dev / app.qa / acme.test-less hosts are unknown, not staging (M2)', async () => {
    for (const u of ['https://acme.dev', 'https://app.qa', 'https://shop.test.io', 'https://acme.sandbox']) {
      const e = await env(u);
      if (u === 'https://shop.test.io') { assert.equal(e.class, 'staging', u); continue; } // keyword in a non-TLD label: advisory only
      assert.equal(e.class, 'unknown', u); assert.deepEqual(e.needsConfirm, [new URL(u).hostname], u);
    }
  });
  test('well-known SaaS hosts are never staging-like (dev.azure.com, test.salesforce.com)', async () => {
    for (const u of ['https://dev.azure.com', 'https://test.salesforce.com', 'https://demo.herokuapp.com']) { const e = await env(u); assert.equal(e.class, 'unknown', u); assert.equal(e.advisory[new URL(u).hostname], 'unknown'); }
  });
  test('staging-like keyword hosts are only an advisory label: they still need confirmation', async () => {
    const e = await env('https://staging.acme.com');
    assert.equal(e.class, 'staging'); assert.deepEqual(e.needsConfirm, ['staging.acme.com']); assert.equal(e.advisory['staging.acme.com'], 'staging-like');
  });
  test('hostClass / hostAllowed / isLocalHost / parseConfirmEnv', () => {
    assert.equal(G.hostClass('acme.dev'), 'unknown'); assert.equal(G.hostClass('dev.acme.com'), 'staging-like'); assert.equal(G.hostClass('localhost'), 'local');
    assert.equal(G.isLocalHost('file:'), true); assert.equal(G.isLocalHost('file'), false); assert.equal(G.isLocalHost('app.acme.com'), false);
    for (const h of ['localhost', 'a.localhost', 'x.test', '::1', '[::1]', '127.0.0.1', '127.255.0.9']) assert.equal(G.isLocalHost(h), true, h);
    for (const h of ['10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.1.1', 'host.local', '128.0.0.1', 'localhost.example.com', '::ffff:7f00:1', '']) assert.equal(G.isLocalHost(h), false, h);
    assert.equal(G.hostAllowed('a.com', ['*.com']), false, 'a single-label wildcard never matches'); assert.equal(G.hostAllowed('x.y.acme.com', ['*.acme.com']), true);
    assert.equal(G.hostAllowed('app.acme.com', ['app.acme.com']), true); assert.equal(G.hostAllowed('APP.acme.com', ['app.acme.com']), true);
    assert.equal(G.hostAllowed('x.acme.com', ['*.acme.com']), true); assert.equal(G.hostAllowed('acme.com', ['*.acme.com']), false); assert.equal(G.hostAllowed('evilacme.com', ['*.acme.com']), false);
    assert.deepEqual(G.parseConfirmEnv('A.com, b.com'), ['a.com', 'b.com']); assert.deepEqual(G.parseConfirmEnv(true), []); assert.deepEqual(G.parseConfirmEnv(undefined), []);
  });
  test('guide.yaml env.allow: allowlisted hosts need no confirmation; the rest still do', async () => {
    const spec = await mkSpec('title: E\nbaseUrl: https://app.acme.com\nscenes:\n  - id: s\n    url: https://other.example.org/a\n    actions:\n      - click: "#a"\n', 'env:\n  allow: [app.acme.com]\n');
    const cfg = G.loadGuideConfig(spec);
    assert.deepEqual(cfg.env.allow, ['app.acme.com']);
    const e = G.classifyEnv(spec, cfg);
    assert.deepEqual(e.allowed, ['app.acme.com']); assert.deepEqual(e.needsConfirm, ['other.example.org']); assert.equal(e.class, 'unknown');
    const all = await mkSpec('title: E\nbaseUrl: https://app.acme.com\nscenes:\n  - id: s\n    url: /a\n    actions:\n      - click: "#a"\n', 'env: { allow: ["*.acme.com"] }\n');
    const e2 = G.classifyEnv(all, G.loadGuideConfig(all));
    assert.equal(e2.class, 'allowed'); assert.deepEqual(e2.needsConfirm, []);
    assert.ok(!G.buildPlan(all, G.loadGuideConfig(all)).warnings.some((x) => x.code === 'ENV_UNCONFIRMED'));
  });
  test('N3: a wildcard allow entry with a single label after "*." is CONFIG_INVALID; two labels are fine', async () => {
    const specs = { '*.com': await mkSpec(DEMO, 'env: { allow: ["*.com"] }\n'), '*.io': await mkSpec(DEMO, 'env: { allow: ["*.io"] }\n') };
    for (const bad of ['*.com', '*.io']) assert.throws(() => G.loadGuideConfig(specs[bad]), /too broad/, bad);
    assert.deepEqual(G.loadGuideConfig(await mkSpec(DEMO, 'env: { allow: ["*.acme.com"] }\n')).env.allow, ['*.acme.com']);
  });
  test('R3-5: a wildcard on a public suffix (co.uk, com.vn, github.io, vercel.app, ...) is CONFIG_INVALID; a wildcard under your own domain is fine', async () => {
    for (const bad of ['*.co.uk', '*.com.vn', '*.org.au', '*.github.io', '*.vercel.app', '*.netlify.app', '*.herokuapp.com', '*.azurewebsites.net', '*.s3.amazonaws.com', '*.eu-west-1.s3.amazonaws.com', '*.r2.dev', '*.surge.sh', '*.ngrok.app', '*.trycloudflare.com', '*.github.dev', '*.loca.lt', '*.blob.core.windows.net', '*.me.uk', '*.web.core.windows.net', '*.run.app', '*.railway.app', '*.azureedge.net', '*.cloudapp.azure.com', '*.storage.googleapis.com', '*.supabase.co', '*.s3.amazonaws.com.cn']) {
      const spec = await mkSpec(DEMO, `env: { allow: ["${bad}"] }\n`);
      assert.throws(() => G.loadGuideConfig(spec), /public suffix/, bad);
    }
    for (const ok of ['*.acme.co.uk', '*.acme.com.vn', '*.acme.github.io', '*.acme.com']) assert.deepEqual(G.loadGuideConfig(await mkSpec(DEMO, `env: { allow: ["${ok}"] }\n`)).env.allow, [ok], ok);
    assert.equal(G.isPublicSuffix('co.uk'), true); assert.equal(G.isPublicSuffix('acme.co.uk'), false); assert.equal(G.isPublicSuffix('example.com'), false);
  });
  test('env.allow validation: unknown keys, non-lists and non-host entries are reported', async () => {
    const spec = await mkSpec(DEMO, 'env:\n  allow: ["https://app.acme.com", "a b", ok.example.com]\n  extra: 1\n');
    assert.throws(() => G.loadGuideConfig(spec), (e) => /env: unknown key "extra"/.test(e.message) && /env\.allow: "https:\/\/app\.acme\.com" is not a bare host/.test(e.message) && /"a b"/.test(e.message) && !/ok\.example\.com/.test(e.message));
    const s2 = await mkSpec(DEMO, 'env: { allow: app.acme.com }\n');
    assert.throws(() => G.loadGuideConfig(s2), /env\.allow must be a list/);
  });
});

describe('loadGuideConfig', () => {
  test('no guide.yaml -> defaults, every screen scene contributes', async () => {
    const spec = await mkSpec(DEMO);
    const cfg = G.loadGuideConfig(spec);
    assert.equal(cfg.file, null); assert.equal(cfg.locale, 'en-US'); assert.deepEqual(cfg.scenes, ['s1', 's2']);
    assert.equal(cfg.capture.padding, 48); assert.equal(cfg.pdf.format, 'A4');
  });
  test('locale underscore is normalised', async () => {
    assert.equal(G.loadGuideConfig(await mkSpec(DEMO, 'locale: en_GB\n')).locale, 'en-GB');
  });
  test('reports ALL problems at once (FR-4, AC-2.5)', async () => {
    const spec = await mkSpec(DEMO, `version: 2
bogus: 1
locale: "not a locale"
scenes: [nope, intro]
steps:
  nowhere.1: { skip: true }
  intro.1: { skip: true }
  s1.99: { skip: true }
  s1.2: { include: true, skip: true }
  s1.4: { include: true }
  s1.3: { value: x }
  s1.7: { unknownKey: 1 }
  s1.missing: { skip: true }
  badref: {}
manual:
  - { id: m1, selector: "#a" }
  - { id: "1bad", after: s1.2 }
  - { id: m3, selector: "#a", after: s1.2, before: s1.5 }
  - { id: m4, selector: "#a", after: s1.2, verb: dance }
capture: { padding: -1, wat: 1 }
pdf: { format: Legal }
`);
    let err;
    try { G.loadGuideConfig(spec); } catch (e) { err = e; }
    assert.ok(err, 'must throw');
    const m = err.message;
    const expectations = [/version must be 1/, /unknown key "bogus"/, /locale "not a locale"/, /scenes: "nope" does not exist/, /scenes: "intro" is a card/,
      /"nowhere\.1".*scene "nowhere" does not exist/, /"intro\.1".*is a card/, /"s1\.99".*out of range/, /"include" and "skip" are mutually exclusive/,
      /"highlight" is a visual-only action/, /"value" only applies to type\/fill\/select/, /unknown key "unknownKey"/, /no action with guideId "missing"/, /"badref".*not a step reference/,
      /manual\[0\].*"after" or "before"/, /manual\[1\].*"id" is required/, /manual\[1\].*"selector" is required/, /use either "after" or "before"/, /verb must be one of/,
      /capture\.padding must be a non-negative number/, /capture: unknown key "wat"/, /pdf\.format must be A4 or Letter/];
    for (const re of expectations) assert.match(m, re);
    assert.match(m, /has \d+ problem\(s\)/);
    assert.ok(Number(/has (\d+) problem/.exec(m)[1]) >= expectations.length - 1);
  });
  test('include on every visual-only action is a config error (not silently ignored)', async () => {
    for (const [name, i] of [['highlight', 4], ['zoom', 9], ['screenshot', 10]]) {
      const spec = await mkSpec(DEMO, `steps:\n  s1.${i}: { include: true }\n`);
      assert.throws(() => G.loadGuideConfig(spec), new RegExp(`"${name}" is a visual-only action`));
    }
  });
  test('duplicate guideId and invalid guideId are reported', async () => {
    const spec = await mkSpec(`title: D\nscenes:\n  - id: s\n    url: ./i.html\n    actions:\n      - click: "#a"\n        guideId: dup\n      - click: "#b"\n        guideId: dup\n      - click: "#c"\n        guideId: "9x"\n`);
    assert.throws(() => G.loadGuideConfig(spec), (e) => /used more than once/.test(e.message) && /must start with a letter/.test(e.message));
  });
  test('two refs to the same action (index and guideId) conflict', async () => {
    const spec = await mkSpec(DEMO, 'steps:\n  s1.5: { skip: true }\n  s1.typeit: { skip: true }\n');
    assert.throws(() => G.loadGuideConfig(spec), /already has an override/);
  });
  test('missing pdf font file is reported', async () => {
    const spec = await mkSpec(DEMO, 'pdf:\n  fonts:\n    - { family: X, file: fonts/none.ttf }\n');
    assert.throws(() => G.loadGuideConfig(spec), /file not found: fonts\/none\.ttf/);
  });
  test('guide.yaml must be a mapping', async () => {
    const spec = await mkSpec(DEMO, '- a\n- b\n');
    assert.throws(() => G.loadGuideConfig(spec), /must be a mapping/);
  });
  test('a manual step anchored in a scene outside "scenes" is rejected', async () => {
    const spec = await mkSpec(DEMO, 'scenes: [s1]\nmanual:\n  - { id: m, after: s2.1, selector: "#a" }\n');
    assert.throws(() => G.loadGuideConfig(spec), /anchor scene "s2" is not listed in "scenes"/);
  });
  test('valid overrides are returned keyed by canonical <scene>.<index>', async () => {
    const spec = await mkSpec(DEMO, 'steps:\n  s1.typeit: { value: Jane, note: n }\n');
    assert.deepEqual(G.loadGuideConfig(spec).overrides['s1.5'], { value: 'Jane', note: 'n' });
  });
  test('does not mutate the spec', async () => {
    const spec = await mkSpec(DEMO, 'steps:\n  s1.2: { skip: true }\n');
    const before = JSON.stringify(spec); G.loadGuideConfig(spec); assert.equal(JSON.stringify(spec), before);
  });
});

describe('spec.mjs: envRefs / loadYaml', () => {
  test('loadYaml exported and parses a mapping', () => {
    assert.deepEqual(S.loadYaml('a: 1\nb: [x, y]\n', 'x.yaml'), { a: 1, b: ['x', 'y'] });
  });
  test('actions record the ${VAR}s they used (passive, values still interpolated)', async () => {
    process.env.GUIDE_UNIT_A = 'value-a';
    const spec = await mkSpec('title: R\nscenes:\n  - id: s\n    url: ./i.html\n    actions:\n      - type: { selector: "#a", text: "${GUIDE_UNIT_A}" }\n      - type: { selector: "#b", text: "plain" }\n      - type: { selector: "#c", text: "${GUIDE_UNIT_A}-${GUIDE_UNIT_MISSING:-dflt}" }\n');
    const [a, b, c] = spec.scenes[0].actions;
    assert.deepEqual(a.envRefs, ['GUIDE_UNIT_A']); assert.equal(a.text, 'value-a');
    assert.equal(b.envRefs, undefined);
    assert.deepEqual(c.envRefs, ['GUIDE_UNIT_A', 'GUIDE_UNIT_MISSING']); assert.equal(c.text, 'value-a-dflt');
    delete process.env.GUIDE_UNIT_A;
  });
  test('setup actions carry envRefs too', async () => {
    process.env.GUIDE_UNIT_B = 'bbbb';
    const spec = await mkSpec('title: R\nsetup:\n  - type: { selector: "#p", text: "${GUIDE_UNIT_B}" }\nscenes:\n  - id: s\n    url: ./i.html\n    actions:\n      - click: "#a"\n');
    assert.deepEqual(spec.setup[0].envRefs, ['GUIDE_UNIT_B']);
    delete process.env.GUIDE_UNIT_B;
  });
  test('an unset variable without default still fails loudly', async () => {
    delete process.env.GUIDE_UNIT_NOPE;
    await assert.rejects(mkSpec('title: R\nscenes:\n  - id: s\n    url: ./i.html\n    actions:\n      - type: { selector: "#a", text: "${GUIDE_UNIT_NOPE}" }\n'), /GUIDE_UNIT_NOPE is not set/);
  });
});

describe('secrets (scanSecrets / secretValues)', () => {
  test('scanSecrets reports var name, file and line but never the value', () => {
    const secret = 'Sup3r-S3cret-Value';
    const hits = G.scanSecrets([{ file: 'guide.md', text: `ok\nline two ${secret} here\nok` }, { file: 'steps.json', text: 'nothing' }], [{ varName: 'MY_PW', value: secret }]);
    assert.deepEqual(hits, [{ file: 'guide.md', varName: 'MY_PW', line: 2 }]);
    assert.ok(!JSON.stringify(hits).includes(secret));
  });
  test('no hits when absent; each secret reported per line', () => {
    assert.deepEqual(G.scanSecrets([{ file: 'a', text: 'clean' }], [{ varName: 'X', value: 'abcd1234' }]), []);
    const h = G.scanSecrets([{ file: 'a', text: 'aaaa1111 bbbb2222' }], [{ varName: 'A', value: 'aaaa1111' }, { varName: 'B', value: 'bbbb2222' }]);
    assert.equal(h.length, 2);
  });
  test('secretValues: only env vars used by actions, >= 4 chars, never URLs', async () => {
    Object.assign(process.env, { GUIDE_UNIT_PW: 'longenough', GUIDE_UNIT_SHORT: 'abc', GUIDE_UNIT_HOST: 'localhost' });
    const spec = await mkSpec('title: R\nbaseUrl: http://${GUIDE_UNIT_HOST}:3000\nscenes:\n  - id: s\n    url: /a\n    actions:\n      - goto: "http://${GUIDE_UNIT_HOST}/x"\n      - type: { selector: "#a", text: "${GUIDE_UNIT_PW}" }\n      - type: { selector: "#b", text: "${GUIDE_UNIT_SHORT}" }\n');
    assert.deepEqual(G.secretValues(spec), [{ varName: 'GUIDE_UNIT_PW', value: 'longenough' }]);
    for (const k of ['GUIDE_UNIT_PW', 'GUIDE_UNIT_SHORT', 'GUIDE_UNIT_HOST']) delete process.env[k];
  });
});

const DOC = {
  version: 1, locale: { requested: 'en-US' },
  task: { title: 'Add a contact', goal: 'Create a contact.', prerequisites: ['Sign in to the app.', 'Have a workspace.'], expectedResult: 'It appears in the list.' },
  steps: [
    { n: 1, id: 's.1', action: 'click', key: null, target: { label: 'Add', role: 'button', tag: 'button', inputType: null, isPassword: false }, annotation: { label: 'Click "Add"' }, overrides: {}, images: { full: 'images/01-s-1.png', closeup: 'images/01-s-1-closeup.png' }, flags: {} },
    { n: 2, id: 's.2', action: 'type', value: '••••••', valueRedacted: true, target: { label: 'Password', role: 'textbox', tag: 'input', inputType: 'password', isPassword: true }, annotation: { label: 'Type in "Password"' }, overrides: { title: 'Enter secret', note: 'Careful.', warning: 'Creates data.' }, images: { full: 'images/02-s-2.png', closeup: null }, flags: { mutatingHint: true } },
  ],
};
for (const s of DOC.steps) s.template = M.stepTemplate(s);

describe('guide-md: sentence templates', () => {
  test('roleWord', () => {
    assert.equal(M.roleWord('link'), 'link'); assert.equal(M.roleWord(null, 'select'), 'drop-down list');
    assert.equal(M.roleWord(null, 'input', 'checkbox'), 'check box'); assert.equal(M.roleWord(null, 'input', 'text'), 'field');
    assert.equal(M.roleWord(null, 'input', 'submit'), 'button'); assert.equal(M.roleWord(null, 'div'), 'control');
  });
  test('annotationLabel: verb + quoted label, override wins, press, clipped to 40', () => {
    assert.equal(M.annotationLabel({ action: 'click', label: 'Save' }), 'Click "Save"');
    assert.equal(M.annotationLabel({ action: 'type', label: 'Name' }), 'Type in "Name"');
    assert.equal(M.annotationLabel({ action: 'click', label: 'Save', override: 'Custom' }), 'Custom');
    assert.equal(M.annotationLabel({ action: 'press', key: 'Enter' }), 'Press Enter');
    assert.equal(M.annotationLabel({ action: 'click' }), 'Click');
    const long = M.annotationLabel({ action: 'click', label: 'x'.repeat(100) });
    assert.equal(long.length, 40); assert.ok(long.endsWith('…'));
  });
  test('manual verb drives the annotation label and the sentence; default is "Look at"; unknown falls back (🟡4)', () => {
    const base = { n: 6, action: 'manual', overrides: { label: 'New row' }, target: { label: '', role: null, tag: 'tr' } };
    const t = (verb) => M.stepTemplate({ ...base, verb });
    assert.equal(t(undefined).text, 'Look at **New row**.'); assert.equal(t('look').text, 'Look at **New row**.');
    assert.equal(t('find').text, 'Find **New row**.'); assert.equal(t('check').text, 'Check **New row**.');
    assert.equal(t('click').text, 'Click **New row**.'); assert.equal(t('hover').text, 'Point to **New row**.');
    assert.equal(t('type').text, 'Type in **New row**.'); assert.equal(t('select').text, 'In **New row**, choose an option.');
    assert.equal(M.annotationLabel({ action: 'manual', label: 'Row', verb: 'check' }), 'Check "Row"');
    assert.equal(M.annotationLabel({ action: 'manual', label: 'Row', verb: 'find' }), 'Find "Row"');
    assert.equal(M.annotationLabel({ action: 'manual', label: 'Row' }), 'Look at "Row"');
    assert.equal(M.annotationLabel({ action: 'manual', label: 'Row', verb: 'bogus' }), 'Look at "Row"');
    assert.deepEqual(Object.keys(M.MANUAL_VERB), ['look', 'find', 'click', 'type', 'select', 'check', 'hover']);
    assert.equal(t('check').title, 'Check "New row"');
  });
  test('explicit label override fills in an empty (e.g. masked) DOM label in the sentence', () => {
    const t = M.stepTemplate({ n: 1, action: 'click', overrides: { label: 'Owner menu' }, target: { label: '', masked: true, tag: 'button' } });
    assert.equal(t.text, 'Click **Owner menu**.');
    assert.equal(M.stepTemplate({ n: 1, action: 'click', overrides: {}, target: { label: '', masked: true, tag: 'button' } }).text, 'Click the highlighted button.');
  });
  test('stepTemplate: imperative English sentence quoting the label, no CSS selector (AC-4.2)', () => {
    const t = M.stepTemplate({ n: 3, action: 'click', selector: '#save', target: { label: 'Save', role: 'button', tag: 'button' } });
    assert.equal(t.text, 'Click **Save**.');
    assert.equal(t.altFull, 'Step 3: the "Save" button is highlighted');
    assert.equal(t.altCloseup, 'Close-up of the "Save" button');
    assert.ok(!/#save/.test(JSON.stringify(t)));
  });
  test('stepTemplate: password / redacted values never appear', () => {
    const t = M.stepTemplate({ n: 1, action: 'type', value: 'topsecret', valueRedacted: true, target: { label: 'Password', isPassword: true, tag: 'input', inputType: 'password' } });
    assert.match(t.text, /type your password/); assert.ok(!JSON.stringify(t).includes('topsecret'));
  });
  test('stepTemplate: fake value shown in backticks; select shows the option; label missing falls back to role word', () => {
    assert.equal(M.stepTemplate({ n: 1, action: 'type', value: 'Jane Doe', target: { label: 'Name' } }).text, 'In the **Name** field, type `Jane Doe`.');
    assert.equal(M.stepTemplate({ n: 1, action: 'select', value: 'Pro', target: { label: 'Plan', tag: 'select' } }).text, 'In **Plan**, select **Pro**.');
    assert.equal(M.stepTemplate({ n: 1, action: 'click', target: { label: '', tag: 'button' } }).text, 'Click the highlighted button.');
    assert.equal(M.stepTemplate({ n: 1, action: 'press', key: 'Enter', target: null }).text, 'Press **Enter**.');
    assert.equal(M.stepTemplate({ n: 1, action: 'check', target: { label: 'Terms' } }).text, 'Select the **Terms** check box.');
  });
  test('manual step uses the label override', () => {
    assert.equal(M.stepTemplate({ n: 1, action: 'manual', overrides: { label: 'New row' }, target: { label: 'raw dom text' } }).text, 'Look at **New row**.');
  });
});

describe('guide-md: skeleton, step blocks, images', () => {
  const md = M.skeletonMarkdown(DOC, {});
  test('skeleton has meta, title, goal, prerequisites, markers, expected result (AC-4.4)', () => {
    assert.match(md, /^<!-- guide:meta version=1 locale=en-US -->/);
    for (const s of ['# Add a contact', '## Goal', 'Create a contact.', '## Prerequisites', '- Sign in to the app.', '## Steps', '## Expected result', 'It appears in the list.']) assert.ok(md.includes(s), s);
    assert.ok(md.includes('<!-- guide:step n=1 id=s.1 -->') && md.includes('<!-- guide:step n=2 id=s.2 -->'));
    assert.equal((md.match(/<!-- \/guide:step -->/g) || []).length, 2);
  });
  test('overrides (title/note/warning) are applied; closeup image optional', () => {
    assert.ok(md.includes('### 2. Enter secret'));
    assert.ok(md.includes('> **Note:** Careful.') && md.includes('> **Warning:** Creates data.'));
    assert.equal(M.scanImages(md).length, 3);
  });
  test('missing task fields become TODO(guide) placeholders', () => {
    const t = M.skeletonMarkdown({ ...DOC, task: { prerequisites: [] } }, {});
    assert.equal((t.match(/TODO\(guide\)/g) || []).length, 3);
    assert.ok(!t.includes('## Prerequisites'));
  });
  test('every skeleton image has a non-empty, descriptive alt (AC-3.5)', () => {
    for (const im of M.scanImages(md)) assert.ok(im.alt.trim().length > 8, im.alt);
  });
  test('parseStepBlocks', () => {
    const b = M.parseStepBlocks(md);
    assert.deepEqual(b.map((x) => [x.n, x.id]), [[1, 's.1'], [2, 's.2']]);
    assert.match(b[0].text, /Click \*\*Add\*\*/);
    assert.ok(!b[0].text.includes('guide:step'));
  });
  test('parseStepBlocks tolerates an unterminated block and no blocks', () => {
    assert.equal(M.parseStepBlocks('<!-- guide:step n=1 id=a.1 -->\nhello').length, 1);
    assert.deepEqual(M.parseStepBlocks('# nothing'), []);
  });
  test('scanImages returns alt, src and 1-based line; ignores titles', () => {
    assert.deepEqual(M.scanImages('x\n![a b](images/x.png "t") ![](y.png)'), [{ alt: 'a b', src: 'images/x.png', line: 2 }, { alt: '', src: 'y.png', line: 2 }]);
  });
});

describe('guide-md: mdToHtml subset', () => {
  test('headings, paragraphs, lists, inline formatting', () => {
    const h = M.mdToHtml('# T\n\n## Sub\nline one\nline two\n\n- a\n- **b**\n\n1. x\n2. `y`\n');
    assert.match(h, /<h1>T<\/h1>/); assert.match(h, /<h2>Sub<\/h2>/); assert.match(h, /<p>line one line two<\/p>/);
    assert.match(h, /<ul><li>a<\/li><li><strong>b<\/strong><\/li><\/ul>/); assert.match(h, /<ol><li>x<\/li><li><code>y<\/code><\/li><\/ol>/);
  });
  test('step markers become <section class="step">; images become figures (closeup class)', () => {
    const h = M.mdToHtml(M.skeletonMarkdown(DOC, {}));
    assert.equal((h.match(/<section class="step"/g) || []).length, 2);
    assert.match(h, /<section class="step" data-n="1" data-id="s\.1">/);
    assert.match(h, /<figure class="full"><img src="images\/01-s-1\.png" alt="Step 1: /);
    assert.match(h, /<figure class="closeup"><img src="images\/01-s-1-closeup\.png"/);
    assert.ok(!h.includes('guide:step') && !h.includes('<!--'));
  });
  test('raw HTML is escaped, never passed through', () => {
    const h = M.mdToHtml('<script>alert(1)</script>\n\nhello <img src=x onerror=alert(1)> **b**\n\n![x" onerror="y](a.png)');
    assert.ok(!/<script/i.test(h)); assert.ok(!/<img src=x/i.test(h));
    assert.match(h, /&lt;script&gt;/); assert.ok(!/alt="x" onerror/.test(h));
  });
  test('callouts: Note/Warning become <aside>, plain quotes stay blockquote', () => {
    const h = M.mdToHtml('> **Note:** careful\n\n> **Warning:** data\n\n> just a quote');
    assert.match(h, /<aside class="callout note">/); assert.match(h, /<aside class="callout warning">/); assert.match(h, /<blockquote>just a quote<\/blockquote>/);
  });
  test('links: safe schemes kept, javascript: stripped to text', () => {
    const h = M.mdToHtml('[ok](https://example.com) [bad](javascript:alert(1)) [rel](docs/a.html)');
    assert.match(h, /<a href="https:\/\/example\.com">ok<\/a>/); assert.ok(!/javascript:/.test(h)); assert.match(h, /<a href="docs\/a\.html">rel<\/a>/);
  });
  test('CRLF input and unicode/empty input', () => {
    assert.match(M.mdToHtml('# Tiêu đề\r\n\r\nxin chào 👋\r\n'), /<h1>Tiêu đề<\/h1>\n<p>xin chào 👋<\/p>/);
    assert.equal(M.mdToHtml(''), '');
  });
  test('unterminated "<!--" is kept as visible text, not swallowing the rest; findUnclosedComment reports its line (🟡1)', () => {
    const md = '# T\n\n<!-- never closed\n\n## Goal\nkept text\n';
    const h = M.mdToHtml(md);
    assert.match(h, /kept text/); assert.match(h, /&lt;!-- never closed/); assert.equal(M.findUnclosedComment(md), 3);
    assert.equal(M.findUnclosedComment('<!-- ok -->\ntext\n<!--\nmulti\n-->\n'), null);
    assert.equal(M.findUnclosedComment('a <!-- inline never closed\n'), null); // only line-leading comments are parsed as comments
    assert.doesNotMatch(M.mdToHtml('<!--\nmulti\nline\n-->\nafter'), /multi/);
  });
  test('an unclosed step marker is closed at the end', () => {
    assert.match(M.mdToHtml('<!-- guide:step n=1 id=a.1 -->\ntext'), /<\/section>$/);
  });
  test('huge input does not blow up', () => {
    const big = Array.from({ length: 5000 }, (_, i) => `- item ${i} **b**`).join('\n');
    assert.equal((M.mdToHtml(big).match(/<li>/g) || []).length, 5000);
  });
});

describe('guide-md: printHtml / contactSheetHtml', () => {
  const brand = { primary: '#123456', background: '#000', text: '#fff', font: 'Inter, sans-serif' };
  test('cover takes the first <h1>, which is removed from the body; no remote URLs; lang set', () => {
    const html = M.printHtml({ title: 'Fallback', bodyHtml: '<h1>My Guide</h1><h2>Goal</h2>', brand, format: 'Letter', date: '2026-01-01', lang: 'en' });
    assert.match(html, /<div class="cover">.*<h1>My Guide<\/h1>/s);
    assert.equal((html.match(/<h1>/g) || []).length, 1);
    assert.match(html, /size: Letter/); assert.match(html, /#123456/); assert.match(html, /<html lang="en">/);
    assert.ok(!/(src|href)=["']https?:/i.test(html)); assert.ok(!/@import|fonts\.googleapis/.test(html));
  });
  test('falls back to the spec title and escapes it; embeds @font-face and logo data URI', () => {
    const html = M.printHtml({ title: '<b>&', bodyHtml: '<h2>x</h2>', brand, fonts: [{ family: 'Acme', url: 'file:///f.ttf' }], logoUri: 'data:image/png;base64,AAAA' });
    assert.match(html, /<h1>&lt;b&gt;&amp;<\/h1>/); assert.match(html, /@font-face\{font-family:"Acme";src:url\("file:\/\/\/f\.ttf"\)/); assert.match(html, /class="logo" src="data:image\/png/);
  });
  test('contactSheetHtml lists every step with relative images and flags', () => {
    const html = M.contactSheetHtml({ task: { title: 'T' }, steps: [{ n: 1, id: 'a.1', action: 'click', images: { full: 'images/a.png', closeup: null }, target: { label: 'Go<' }, flags: { mutatingHint: true } }] }, { brand });
    assert.match(html, /src="\.\.\/images\/a\.png"/); assert.match(html, /Go&lt;/); assert.match(html, /⚠ data/); assert.match(html, /1 step\(s\)/);
  });
});

describe('writeSkeleton: guide.md only if absent (ADR-0002)', () => {
  test('creates guide.md once, always refreshes the skeleton, never overwrites hand edits', async () => {
    const spec = await mkSpec(DEMO);
    const gdir = G.guideDir(spec); fs.mkdirSync(gdir, { recursive: true });
    const cfg = G.loadGuideConfig(spec);
    G.writeSkeleton(spec, cfg, DOC);
    assert.ok(fs.existsSync(path.join(gdir, 'guide.md')) && fs.existsSync(path.join(gdir, 'guide.skeleton.md')));
    fs.writeFileSync(path.join(gdir, 'guide.md'), 'HAND EDITED\n');
    const changed = { ...DOC, task: { ...DOC.task, title: 'New title' } };
    G.writeSkeleton(spec, cfg, changed);
    assert.equal(fs.readFileSync(path.join(gdir, 'guide.md'), 'utf8'), 'HAND EDITED\n');
    assert.match(fs.readFileSync(path.join(gdir, 'guide.skeleton.md'), 'utf8'), /# New title/);
  });
  test('createGuide:false (refresh) never creates guide.md', async () => {
    const spec = await mkSpec(DEMO);
    const gdir = G.guideDir(spec); fs.mkdirSync(gdir, { recursive: true });
    G.writeSkeleton(spec, G.loadGuideConfig(spec), DOC, { createGuide: false });
    assert.ok(!fs.existsSync(path.join(gdir, 'guide.md'))); assert.ok(fs.existsSync(path.join(gdir, 'guide.skeleton.md')));
  });
});
