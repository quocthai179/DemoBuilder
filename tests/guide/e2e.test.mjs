// End-to-end tests of `node demo.mjs guide ...` against local file:// fixtures (offline, headless Chromium).
// Every test works on a copy in os.tmpdir(); nothing is written into the plugin tree or the repo.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixtureCopy, copyDir, tmpDir, guide, demo, snapshot, readJson, read, sha, pngSize, browserSkipReason, haveBin, decodePng, countPixels, diffPixels } from './helpers.mjs';

const SKIP = await browserSkipReason();
const SECRET = 'Sup3r-S3cret-Pw-9137';
const NEEDS_BROWSER = SKIP ? { skip: SKIP } : {};
const parseJson = (r) => { try { return JSON.parse(r.stdout); } catch (e) { assert.fail(`stdout is not pure JSON (${e.message}):\n${r.stdout.slice(0, 400)}`); } };
const ls = (d) => fs.readdirSync(d).sort();
const walkText = (dir, exts = ['.md', '.json', '.html', '.yaml']) => {
  const out = [];
  const rec = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) rec(p); else if (exts.includes(path.extname(e.name))) out.push(p); } };
  rec(dir); return out;
};

// ---------------------------------------------------------------- no browser needed
describe('guide CLI without a browser', () => {
  test('plan --json: stdout is pure JSON; steps, env, task; nothing written (AC-1.2/1.3/1.4)', () => {
    const ws = fixtureCopy('sample-app');
    const before = snapshot(ws);
    const r = guide('plan', path.join(ws, 'demo.yaml'), ['--json']);
    assert.equal(r.status, 0, r.stderr);
    const j = parseJson(r);
    assert.equal(j.ok, true);
    assert.deepEqual(j.steps.map((s) => s.id), ['add-contact.1', 'add-contact.2', 'add-contact.3', 'add-contact.4', 'add-contact.5', 'add-contact.new-row']);
    assert.deepEqual(j.steps.map((s) => s.n), [1, 2, 3, 4, 5, 6]);
    assert.equal(j.steps[5].source, 'manual');
    assert.equal(j.env.class, 'local'); assert.equal(j.task.title, 'Add a new contact');
    assert.match(j.signature, /^[0-9a-f]+$/);
    assert.deepEqual(snapshot(ws), before, 'plan must not write any file');
    assert.ok(!fs.existsSync(path.join(ws, 'guide')));
  });
  test('plan without guide.yaml on sample-app gives exactly the 5 interactive steps (AC-1.2)', () => {
    const ws = fixtureCopy('sample-app'); fs.rmSync(path.join(ws, 'guide.yaml'));
    const j = parseJson(guide('plan', path.join(ws, 'demo.yaml'), ['--json']));
    assert.deepEqual(j.steps.map((s) => s.id), ['add-contact.1', 'add-contact.2', 'add-contact.3', 'add-contact.4', 'add-contact.5']);
    assert.ok(!j.steps.some((s) => s.id.startsWith('dashboard')));
  });
  test('plan (text mode) prints to stdout and exits 0', () => {
    const ws = fixtureCopy('sample-app');
    const r = guide('plan', path.join(ws, 'demo.yaml'));
    assert.equal(r.status, 0); assert.match(r.stdout, /6 step\(s\)/); assert.match(r.stdout, /add-contact\.3/);
  });
  test('guide.yaml reference errors: exit 1, every problem listed, JSON failure shape (AC-2.5)', () => {
    const ws = fixtureCopy('sample-app');
    fs.writeFileSync(path.join(ws, 'guide.yaml'), 'steps:\n  add-contact.99: { skip: true }\n  nope.1: { skip: true }\n');
    const r = guide('plan', path.join(ws, 'demo.yaml'), ['--json']);
    assert.equal(r.status, 1);
    const j = parseJson(r);
    assert.equal(j.ok, false); assert.ok(j.code); assert.match(j.error, /2 problem\(s\)/); assert.match(j.error, /add-contact\.99/); assert.match(j.error, /nope/);
    assert.ok(!fs.existsSync(path.join(ws, 'guide')));
  });
  test('--json: a spec that cannot be loaded (missing file / unset ${ENV}) still prints a {ok:false} JSON document on stdout', () => {
    // Contract from the implementation notes: "--json prints only JSON on stdout; failures print {ok:false, code, error}".
    const ws = fixtureCopy('guide-app');
    for (const spec of [path.join(ws, 'does-not-exist.yaml'), path.join(ws, 'demo.yaml') /* needs ${GUIDE_TEST_SECRET} */]) {
      const r = demo(['guide', 'plan', spec, '--json'], { cwd: ws, env: { GUIDE_TEST_SECRET: undefined } });
      assert.equal(r.status, 1);
      const j = parseJson(r); assert.equal(j.ok, false); assert.ok(j.error);
    }
  });
  test('missing demo.yaml: clear error, no guide/ directory created (AC-1.6)', () => {
    const dir = tmpDir();
    const r = demo(['guide', 'capture', path.join(dir, 'nope', 'demo.yaml')], { cwd: dir });
    assert.equal(r.status, 1); assert.match(r.stderr, /Spec not found/);
    assert.deepEqual(fs.readdirSync(dir), []);
  });
  test('unknown subcommand prints usage and exits 1', () => {
    const ws = fixtureCopy('sample-app');
    const r = demo(['guide', 'bogus', path.join(ws, 'demo.yaml')], { cwd: ws });
    assert.equal(r.status, 1); assert.match(r.stderr, /Usage: guide </);
  });
  test('render / refresh / approve before any capture fail with a helpful message and write nothing', () => {
    const ws = fixtureCopy('sample-app'); const spec = path.join(ws, 'demo.yaml');
    const before = snapshot(ws);
    for (const [sub, code] of [['render', 'NO_CAPTURE'], ['refresh', 'NO_CAPTURE'], ['approve', 'NOT_RENDERED']]) {
      const r = guide(sub, spec, ['--json']);
      assert.equal(r.status, 1, sub);
      const j = parseJson(r); assert.equal(j.ok, false); assert.equal(j.code, code, sub);
    }
    assert.deepEqual(snapshot(ws), before);
  });
  test('production-like host without --confirm-env: ENV_UNCONFIRMED, exit 1, no browser launched, nothing written (AC-5.4)', () => {
    const ws = fixtureCopy('guide-prod');
    const r = guide('capture', path.join(ws, 'demo.yaml'), ['--json']);
    assert.equal(r.status, 1);
    const j = parseJson(r);
    assert.equal(j.ok, false); assert.equal(j.code, 'ENV_UNCONFIRMED'); assert.match(j.error, /--confirm-env/); assert.match(j.error, /app\.acme-corp\.com/);
    assert.ok(!fs.existsSync(path.join(ws, 'guide', 'images')) && !fs.existsSync(path.join(ws, 'guide', '.staging')));
    const plan = parseJson(guide('plan', path.join(ws, 'demo.yaml'), ['--json']));
    assert.equal(plan.env.class, 'unknown'); assert.ok(plan.warnings.some((w) => w.code === 'ENV_UNCONFIRMED'));
  });
  test('refresh also demands --confirm-env for unknown hosts (after a previous capture exists)', () => {
    const ws = fixtureCopy('guide-prod'); const spec = path.join(ws, 'demo.yaml');
    fs.mkdirSync(path.join(ws, 'guide'));
    const plan = parseJson(guide('plan', spec, ['--json']));
    fs.writeFileSync(path.join(ws, 'guide', 'steps.json'), JSON.stringify({ plan: { signature: plan.signature, steps: plan.steps.map(({ n, id, action }) => ({ n, id, action })) }, steps: [], warnings: [] }));
    const r = guide('refresh', spec, ['--json']);
    assert.equal(r.status, 1); assert.equal(parseJson(r).code, 'ENV_UNCONFIRMED');
  });
  test('init writes guide/.staging/ and guide/errors/ into .gitignore', () => {
    const dir = path.join(tmpDir(), 'proj');
    const r = demo(['init', dir, '--title', 'X']);
    assert.equal(r.status, 0, r.stderr);
    const gi = read(dir, '.gitignore').split('\n');
    assert.ok(gi.includes('guide/.staging/') && gi.includes('guide/errors/'), gi.join('|'));
  });
});

// ---------------------------------------------------------------- sample-app (Vietnamese UI) full lifecycle
describe('sample-app lifecycle: capture -> render -> refresh -> approve', NEEDS_BROWSER, () => {
  let ws; let spec; let cap; let names;
  before(() => {
    ws = fixtureCopy('sample-app'); spec = path.join(ws, 'demo.yaml');
    cap = guide('capture', spec, ['--json']);
    names = fs.existsSync(path.join(ws, 'guide/images')) ? ls(path.join(ws, 'guide/images')) : [];
  });
  const G = (...p) => path.join(ws, 'guide', ...p);

  test('capture succeeds; images + steps.json + skeleton + guide.md exist (AC-1.1, FR-15, AC-3.1)', () => {
    assert.equal(cap.status, 0, cap.stderr);
    assert.deepEqual(names, [
      '01-add-contact-1-closeup.png', '01-add-contact-1.png', '02-add-contact-2-closeup.png', '02-add-contact-2.png', '03-add-contact-3-closeup.png', '03-add-contact-3.png',
      '04-add-contact-4-closeup.png', '04-add-contact-4.png', '05-add-contact-5-closeup.png', '05-add-contact-5.png', '06-add-contact-new-row-closeup.png', '06-add-contact-new-row.png']);
    for (const f of ['steps.json', 'guide.md', 'guide.skeleton.md']) assert.ok(fs.existsSync(G(f)), f);
    assert.ok(!fs.existsSync(G('.staging')), 'staging removed');
    assert.ok(!fs.existsSync(G('guide.pdf')) && !fs.existsSync(G('guide-draft.pdf')), 'no PDF before render');
  });
  test('--json stdout is a single parseable JSON document; logs went to stderr', () => {
    const j = parseJson(cap);
    assert.equal(j.ok, true); assert.equal(j.steps.length, 6);
    assert.deepEqual(j.steps.map((s) => s.n), [1, 2, 3, 4, 5, 6]);
    assert.ok(j.steps.every((s) => s.images.full.startsWith('images/')));
    assert.ok(j.files.steps.endsWith('steps.json'));
    assert.match(cap.stderr, /Captured 6 step/);
    assert.ok(!/Captured/.test(cap.stdout));
  });
  test('images: full = viewport 1280x720 (NFR-6), close-up is a smaller crop', () => {
    for (const n of names.filter((x) => !x.endsWith('-closeup.png'))) assert.deepEqual(pngSize(G('images', n)), { width: 1280, height: 720 }, n);
    for (const n of names.filter((x) => x.endsWith('-closeup.png'))) { const s = pngSize(G('images', n)); assert.ok(s.width < 1280 && s.height < 720 && s.width >= 300, `${n} ${JSON.stringify(s)}`); }
  });
  test('steps.json contract: plan signature, LOCALE_MISMATCH for the Vietnamese UI, DATA_CREATING on #save, env local (AC-4.1, L2)', () => {
    const d = readJson(G('steps.json'));
    assert.equal(d.version, 1); assert.equal(d.steps.length, 6); assert.equal(d.env.class, 'local');
    assert.equal(d.plan.steps.length, 6); assert.match(d.plan.signature, /^[0-9a-f]+$/);
    assert.equal(d.locale.mismatch, true);
    const codes = d.warnings.map((w) => w.code);
    assert.ok(codes.includes('LOCALE_MISMATCH')); assert.ok(codes.includes('DATA_CREATING'));
    assert.ok(d.warnings.find((w) => w.code === 'DATA_CREATING').steps.includes(5), 'the #save step is flagged as data-creating');
    const s3 = d.steps[2];
    assert.equal(s3.value, 'Jane Doe'); assert.equal(s3.valueSource, 'guide.yaml'); assert.equal(s3.valueRedacted, false);
    assert.equal(d.steps[3].value, 'jane.doe@example.com');
    assert.ok(d.steps.every((s) => s.target.found), 'every target found');
    assert.equal(d.steps[5].source, 'manual');
    assert.ok(d.steps.slice(0, 5).every((s) => !/[#\[]/.test(s.template.text)), 'no CSS selector in step text (AC-4.2)');
  });
  test('guide.md is created from the skeleton with markers, overrides and relative images (AC-2.3, AC-3.5)', () => {
    const md = read(G('guide.md'));
    assert.equal(md, read(G('guide.skeleton.md')));
    assert.ok(md.includes('# Add a new contact') && md.includes('Create a contact record so your sales team can follow up.'));
    assert.ok(md.includes('The new contact appears at the top of the Customers list.'));
    assert.ok(md.includes('> **Warning:** Each run creates a new contact. Use a test workspace.'));
    assert.ok(md.includes('> **Note:** The email address is blurred in screenshots for privacy.'));
    assert.equal((md.match(/<!-- guide:step n=/g) || []).length, 6);
    const imgs = [...md.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)];
    assert.equal(imgs.length, 12);
    for (const [, alt, src] of imgs) { assert.ok(alt.trim().length > 5, alt); assert.ok(!path.isAbsolute(src) && !/^https?:/.test(src)); assert.ok(fs.existsSync(G(src)), src); }
    assert.ok(!/TODO\(guide\)/.test(md));
  });
  test('captured email value is not leaked from the masked column (labels exclude masked text, FR-12)', () => {
    const d = readJson(G('steps.json'));
    assert.ok(!JSON.stringify(d.steps.map((s) => s.target.label)).includes('b.tran@example.com'));
  });
  test('second capture yields the identical set of image file names (AC-3.6, NFR-2) and keeps guide.md', () => {
    const copy = copyDir(ws, path.join(tmpDir(), 'again'));
    fs.writeFileSync(path.join(copy, 'guide/guide.md'), `${read(copy, 'guide/guide.md')}\nHAND-ADDED LINE\n`);
    const md = read(copy, 'guide/guide.md');
    const r = guide('capture', path.join(copy, 'demo.yaml'));
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(ls(path.join(copy, 'guide/images')), names);
    assert.equal(read(copy, 'guide/guide.md'), md, 'guide.md is never overwritten by capture');
  });

  // render -> refresh -> approve are order-dependent: they share `ws`
  test('render produces guide-draft.pdf (not guide.pdf), HTML and contact sheet; PDF is valid and offline (AC-6.x, AC-7.2)', () => {
    const r = guide('render', spec, ['--json']);
    assert.equal(r.status, 0, r.stderr);
    const j = parseJson(r); assert.equal(j.ok, true); assert.deepEqual(j.findings.errors, []);
    assert.ok(fs.existsSync(G('guide-draft.pdf'))); assert.ok(!fs.existsSync(G('guide.pdf')), 'guide.pdf must not exist before approval');
    assert.equal(fs.readFileSync(G('guide-draft.pdf')).subarray(0, 5).toString(), '%PDF-');
    assert.ok(fs.existsSync(G('preview/contact-sheet.png')) && fs.statSync(G('preview/contact-sheet.png')).size > 5000);
    assert.ok(fs.existsSync(G('render.json')));
    const html = read(G('guide.html'));
    assert.ok(!/(src|href)=["']https?:/i.test(html), 'no remote references (AC-6.4)');
    assert.ok(!/<h1>/.test(html.split('<main')[1] || ''), 'title is on the cover only');
  });
  test('PDF content (poppler): pages, text matches guide.md, English, fonts embedded (AC-4.1, AC-6.2, AC-6.3)', { skip: !haveBin('pdfinfo') && 'poppler (pdfinfo) not installed' }, () => {
    const pdf = G('guide-draft.pdf');
    const info = spawnSync('pdfinfo', [pdf], { encoding: 'utf8' }).stdout;
    assert.ok(Number(/Pages:\s+(\d+)/.exec(info)[1]) >= 3, info);
    const text = spawnSync('pdftotext', [pdf, '-'], { encoding: 'utf8' }).stdout;
    for (const s of ['Add a new contact', 'Goal', 'Expected result', 'Jane Doe', 'Each run creates a new contact']) assert.ok(text.includes(s), s);
    const fonts = spawnSync('pdffonts', [pdf], { encoding: 'utf8' }).stdout.split('\n').slice(2).filter(Boolean);
    assert.ok(fonts.length > 0);
    for (const l of fonts) assert.match(l, /\byes\s+(yes|no)\s+(yes|no)\s+\d+\s+\d+\s*$/, `font not embedded: ${l}`);
  });

  test('refresh keeps hand-edited guide.md byte-identical, re-writes images with identical names, rebuilds the PDF (AC-8.1/8.2)', () => {
    const mdPath = G('guide.md');
    const edited = read(mdPath).replace('Create a contact record so your sales team can follow up.', 'HAND EDITED GOAL SENTENCE.');
    assert.notEqual(edited, read(mdPath)); fs.writeFileSync(mdPath, edited);
    const mdSha = sha(fs.readFileSync(mdPath));
    const imgMtime = Object.fromEntries(names.map((n) => [n, fs.statSync(G('images', n)).mtimeMs]));
    const r = guide('refresh', spec, ['--json']);
    assert.equal(r.status, 0, r.stderr);
    const j = parseJson(r); assert.equal(j.ok, true); assert.equal(j.steps.length, 6);
    assert.equal(sha(fs.readFileSync(mdPath)), mdSha, 'guide.md untouched');
    assert.deepEqual(ls(G('images')), names, 'same image names');
    for (const n of names) assert.ok(fs.statSync(G('images', n)).mtimeMs > imgMtime[n], `${n} was re-captured`);
    assert.ok(!fs.existsSync(G('images.new')) && !fs.existsSync(G('images.old')) && !fs.existsSync(G('.staging')));
    if (haveBin('pdftotext')) assert.ok(spawnSync('pdftotext', [G('guide-draft.pdf'), '-'], { encoding: 'utf8' }).stdout.includes('HAND EDITED GOAL SENTENCE.'), 'PDF reflects hand edit (AC-6.3)');
  });

  test('plan mismatch: refresh exits 2, reports the diff and leaves every file in guide/ unchanged (AC-8.3)', () => {
    const before = snapshot(G());
    const guideYaml = read(ws, 'guide.yaml');
    fs.writeFileSync(path.join(ws, 'guide.yaml'), guideYaml.replace('steps:\n', 'steps:\n  add-contact.2: { skip: true }\n'));
    const r = guide('refresh', spec, ['--json']);
    fs.writeFileSync(path.join(ws, 'guide.yaml'), guideYaml);
    assert.equal(r.status, 2, `${r.stdout}\n${r.stderr}`);
    const j = parseJson(r);
    assert.equal(j.ok, false); assert.equal(j.code, 'PLAN_MISMATCH');
    assert.ok(j.diff.some((l) => /add-contact\.2/.test(l) && /removed/.test(l)), j.diff.join('\n'));
    assert.match(r.stderr, /nothing was changed/);
    assert.deepEqual(snapshot(G()), before, 'guide/ unchanged');
  });
  test('plan mismatch in text mode (no --json) also exits 2 and prints the diff to stderr', () => {
    const guideYaml = read(ws, 'guide.yaml'); const before = snapshot(G());
    fs.writeFileSync(path.join(ws, 'guide.yaml'), guideYaml.replace('steps:\n', 'steps:\n  add-contact.1: { skip: true }\n'));
    const r = guide('refresh', spec);
    fs.writeFileSync(path.join(ws, 'guide.yaml'), guideYaml);
    assert.equal(r.status, 2, r.stderr); assert.equal(r.stdout, ''); assert.match(r.stderr, /- add-contact\.1 click \(removed\)/);
    assert.deepEqual(snapshot(G()), before);
  });
  test('capture after a plan change: guide.md kept as is, backed up to history/, MERGE_NEEDED warned; user images kept (FR-24)', () => {
    const copy = copyDir(ws, path.join(tmpDir(), 'merge')); const g = (...p) => path.join(copy, 'guide', ...p);
    fs.writeFileSync(g('images/my-own-picture.jpg'), 'x');
    fs.writeFileSync(path.join(copy, 'guide.yaml'), read(copy, 'guide.yaml').replace('steps:\n', 'steps:\n  add-contact.1: { skip: true }\n'));
    const md = read(g('guide.md'));
    const r = guide('capture', path.join(copy, 'demo.yaml'), ['--json']);
    assert.equal(r.status, 0, r.stderr);
    const codes = parseJson(r).warnings.map((w) => w.code);
    assert.ok(codes.includes('MERGE_NEEDED') && codes.includes('USER_IMAGES_KEPT'), codes.join());
    assert.equal(read(g('guide.md')), md, 'guide.md untouched');
    assert.equal(ls(g('history')).length, 1); assert.equal(read(g('history', ls(g('history'))[0])), md);
    assert.match(read(g('guide.skeleton.md')), /id=add-contact\.new-row/);
    assert.ok(fs.existsSync(g('images/my-own-picture.jpg')));
    assert.equal(readJson(g('steps.json')).steps.length, 5);
  });

  test('approve refuses when guide.md changed after render (STALE_RENDER); then succeeds after re-render (AC-7.3)', () => {
    assert.equal(guide('render', spec).status, 0);
    const mdPath = G('guide.md'); const original = read(mdPath);
    fs.writeFileSync(mdPath, `${original}\nlate edit\n`);
    const refused = guide('approve', spec, ['--json']);
    assert.equal(refused.status, 1);
    const j = parseJson(refused); assert.equal(j.code, 'STALE_RENDER'); assert.match(j.error, /guide\.md changed since the last render/);
    assert.ok(!fs.existsSync(G('guide.pdf')) && !fs.existsSync(G('approval.json')) && fs.existsSync(G('guide-draft.pdf')));

    assert.equal(guide('render', spec).status, 0);
    const ok = guide('approve', spec, ['--json']);
    assert.equal(ok.status, 0, ok.stderr);
    const a = parseJson(ok);
    assert.equal(a.ok, true); assert.ok(a.files.pdf.endsWith('guide.pdf'));
    assert.ok(fs.existsSync(G('guide.pdf'))); assert.ok(!fs.existsSync(G('guide-draft.pdf')), 'draft removed on approval');
    const ap = readJson(G('approval.json'));
    assert.equal(ap.pdfSha256, sha(fs.readFileSync(G('guide.pdf')))); assert.equal(ap.guideMdSha256, sha(fs.readFileSync(mdPath)));
    assert.equal(fs.readFileSync(G('guide.pdf')).subarray(0, 5).toString(), '%PDF-');
  });
  test('approve is refused when an image changed after render, or the draft PDF was tampered with', () => {
    const copy = copyDir(ws, path.join(tmpDir(), 'tamper')); const c = (...p) => path.join(copy, 'guide', ...p);
    fs.renameSync(c('guide.pdf'), c('guide-draft.pdf')); fs.rmSync(c('approval.json'));
    assert.equal(guide('render', path.join(copy, 'demo.yaml')).status, 0);
    const clean = copyDir(copy, path.join(tmpDir(), 'clean')); const cl = (...p) => path.join(clean, 'guide', ...p);
    fs.appendFileSync(c('images/01-add-contact-1.png'), 'x');
    const r1 = guide('approve', path.join(copy, 'demo.yaml'), ['--json']);
    assert.equal(r1.status, 1); assert.match(parseJson(r1).error, /01-add-contact-1\.png changed/);
    fs.appendFileSync(cl('guide-draft.pdf'), 'x');
    const r2 = guide('approve', path.join(clean, 'demo.yaml'), ['--json']);
    assert.equal(r2.status, 1); assert.match(parseJson(r2).error, /guide-draft\.pdf changed/);
  });
  test('approve refuses while TODO(guide) placeholders remain', () => {
    const copy = copyDir(ws, path.join(tmpDir(), 'todo')); const c = (...p) => path.join(copy, 'guide', ...p);
    fs.renameSync(c('guide.pdf'), c('guide-draft.pdf')); fs.rmSync(c('approval.json'));
    fs.writeFileSync(c('guide.md'), `${read(c('guide.md'))}\nTODO(guide): finish me\n`);
    const spc = path.join(copy, 'demo.yaml');
    const rr = guide('render', spc, ['--json']); assert.equal(rr.status, 0);
    assert.ok(parseJson(rr).findings.warnings.some((w) => w.code === 'TODO_PLACEHOLDER'));
    const r = guide('approve', spc, ['--json']);
    assert.equal(r.status, 1); assert.equal(parseJson(r).code, 'TODO_LEFT');
  });

  // FR-31 / AC-1.5 / AC-8.4: mid-flow failure on refresh and on capture
  test('FR-31: broken selector during refresh -> exit 1, error screenshot, old guide untouched, no .staging (AC-1.5, AC-8.4)', () => {
    const copy = copyDir(ws, path.join(tmpDir(), 'fail-refresh')); const g = (...p) => path.join(copy, 'guide', ...p);
    fs.writeFileSync(path.join(copy, 'demo.yaml'), read(copy, 'demo.yaml').replace('selector: "#name"', 'selector: "#does-not-exist"'));
    fs.writeFileSync(path.join(copy, 'guide.yaml'), `${read(copy, 'guide.yaml')}capture: { timeout: 1500 }\n`);
    const before = snapshot(g());
    const r = guide('refresh', path.join(copy, 'demo.yaml'), ['--json']);
    assert.equal(r.status, 1, r.stdout);
    const j = parseJson(r); assert.equal(j.ok, false); assert.ok(j.error);
    assert.match(r.stderr, /scene "add-contact" action #2/);
    assert.match(r.stderr, /#does-not-exist/); assert.match(r.stderr, /screenshot: .*errors[\\/]error-scene__add-contact_-2\.png/);
    assert.deepEqual(ls(g('errors')), ['error-scene__add-contact_-2.png']);
    assert.ok(pngSize(g('errors/error-scene__add-contact_-2.png')).width > 0);
    assert.ok(!fs.existsSync(g('.staging')));
    assert.deepEqual(snapshot(g(), ['errors']), before, 'images, steps.json, guide.md, PDF unchanged');
  });
  test('FR-31: broken selector during a first capture leaves no half-finished guide files', () => {
    const fresh = fixtureCopy('sample-app');
    fs.writeFileSync(path.join(fresh, 'demo.yaml'), read(fresh, 'demo.yaml').replace('selector: "#email"', 'selector: "#nope"'));
    fs.writeFileSync(path.join(fresh, 'guide.yaml'), `${read(fresh, 'guide.yaml')}capture: { timeout: 1500 }\n`);
    const r = guide('capture', path.join(fresh, 'demo.yaml'));
    assert.equal(r.status, 1);
    assert.match(r.stderr, /action #3/);
    const g = path.join(fresh, 'guide');
    for (const f of ['guide.md', 'guide.pdf', 'guide-draft.pdf', 'steps.json', 'images', '.staging']) assert.ok(!fs.existsSync(path.join(g, f)), `${f} must not exist`);
    assert.ok(ls(path.join(g, 'errors')).some((f) => /^error-.*\.png$/.test(f)));
  });
  test('FR-31: failure during capture after a good capture keeps the previous guide intact', () => {
    const copy = copyDir(ws, path.join(tmpDir(), 'fail-capture')); const g = (...p) => path.join(copy, 'guide', ...p);
    fs.writeFileSync(path.join(copy, 'demo.yaml'), read(copy, 'demo.yaml').replace('selector: "#save"', 'selector: "#nope"').replace('click: "#save"', 'click: "#nope"'));
    fs.writeFileSync(path.join(copy, 'guide.yaml'), `${read(copy, 'guide.yaml')}capture: { timeout: 1500 }\n`);
    const before = snapshot(g());
    const r = guide('capture', path.join(copy, 'demo.yaml'));
    assert.equal(r.status, 1);
    assert.deepEqual(snapshot(g(), ['errors']), before);
    assert.ok(!fs.existsSync(g('.staging')));
  });
});

// ---------------------------------------------------------------- English mini-app: password, file, press, scroll, mask, hide, secrets
describe('guide-app: secrets, locale, scrolling, press, hover include, file input', NEEDS_BROWSER, () => {
  let ws; let spec; let cap; let env;
  before(() => {
    ws = fixtureCopy('guide-app'); spec = path.join(ws, 'demo.yaml');
    env = { GUIDE_TEST_SECRET: SECRET };
    cap = guide('capture', spec, ['--json'], { env });
  });
  const G = (...p) => path.join(ws, 'guide', ...p);

  test('capture succeeds with 10 steps, no LOCALE_MISMATCH for an English app (AC-1.2, AC-2.2)', () => {
    assert.equal(cap.status, 0, cap.stderr);
    const d = readJson(G('steps.json'));
    assert.deepEqual(d.steps.map((s) => s.id), ['account.2', 'account.3', 'account.4', 'account.5', 'account.6', 'account.7', 'account.8', 'account.9', 'account.10', 'account.11']);
    assert.deepEqual(d.steps.map((s) => s.action), ['type', 'type', 'select', 'check', 'upload', 'hover', 'click', 'click', 'press', 'click']);
    assert.equal(d.locale.mismatch, false); assert.ok(!d.warnings.some((w) => w.code === 'LOCALE_MISMATCH'));
    assert.deepEqual(ls(G('images')).filter((f) => !f.endsWith('-closeup.png')).slice(0, 3), ['01-account-2.png', '02-account-3.png', '03-account-4.png']);
    assert.ok(d.steps.every((s) => s.target.found));
  });
  test('password field is redacted and its template never mentions a value (FR-13, AC-4.3)', () => {
    const d = readJson(G('steps.json')); const pw = d.steps[1];
    assert.equal(pw.value, '••••••'); assert.equal(pw.valueRedacted, true); assert.equal(pw.valueSource, 'redacted'); assert.equal(pw.target.isPassword, true);
    assert.match(pw.template.text, /type your password/);
    assert.equal(d.steps[0].value, 'Jane Doe'); assert.equal(d.steps[0].valueSource, 'spec');
  });
  test('the secret value appears in no text artifact, nor in CLI output (NFR-1, NFR-8, AC-5.2)', () => {
    assert.ok(!cap.stdout.includes(SECRET) && !cap.stderr.includes(SECRET));
    for (const f of walkText(G())) assert.ok(!read(f).includes(SECRET), f);
  });
  test('below-the-fold target is scrolled into view; boxes lie inside the viewport; env var name shown only as a name', () => {
    const d = readJson(G('steps.json'));
    const far = d.steps.find((s) => s.target.label === 'Far away');
    assert.ok(far, 'Far away step'); assert.ok(far.target.visible);
    assert.ok(far.target.box.y >= 0 && far.target.box.y + far.target.box.height <= 720, JSON.stringify(far.target.box));
    assert.equal(far.page.path.startsWith('file://'), true);
  });
  test('press Enter step has a "Press Enter" label; select / check / file-label steps resolve labels', () => {
    const d = readJson(G('steps.json'));
    const press = d.steps.find((s) => s.action === 'press');
    assert.equal(press.annotation.label, 'Press Enter'); assert.equal(press.template.text, 'Press **Enter**.');
    assert.match(d.steps.find((s) => s.action === 'check').target.label, /agree to the terms/);
    assert.equal(d.steps.find((s) => s.action === 'upload').target.label, 'Choose avatar');
    assert.equal(d.steps.find((s) => s.action === 'upload').target.visible, true, 'hidden file input points at its label');
    assert.match(d.steps.find((s) => s.action === 'select').target.label, /^Plan/);
    assert.equal(d.steps.find((s) => s.action === 'select').annotation.label.startsWith('Choose in "Plan'), true);
    assert.equal(d.steps.find((s) => s.action === 'hover').annotation.label, 'Point to "Hover me"');
  });
  test('labels never use the text of masked elements (FR-12 / AC-5.3)', () => {
    const d = readJson(G('steps.json'));
    assert.ok(!JSON.stringify(d).includes('Secret Person 4711'), 'masked text leaked into steps.json');
    assert.ok(!read(G('guide.md')).includes('Secret Person 4711'));
    const masked = d.steps.find((s) => s.id === 'account.8');
    assert.notEqual(masked.target.label, 'Secret Person 4711');
  });
  test('select label is the <label> text only, not the option list', () => {
    const d = readJson(G('steps.json'));
    assert.equal(d.steps.find((s) => s.action === 'select').target.label, 'Plan');
  });
  test('submit button is flagged as possibly data-creating', () => {
    const d = readJson(G('steps.json'));
    assert.ok(d.warnings.find((w) => w.code === 'DATA_CREATING').steps.includes(10));
    assert.equal(d.steps[9].flags.mutatingHint, true);
  });
  test('render succeeds, secret absent from guide.html and PDF text (AC-5.2)', () => {
    const r = guide('render', spec, ['--json'], { env });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!r.stdout.includes(SECRET) && !r.stderr.includes(SECRET));
    assert.ok(!read(G('guide.html')).includes(SECRET));
    if (haveBin('pdftotext')) assert.ok(!spawnSync('pdftotext', [G('guide-draft.pdf'), '-'], { encoding: 'utf8' }).stdout.includes(SECRET));
    assert.ok(!fs.readFileSync(G('guide-draft.pdf')).includes(SECRET));
  });
  test('secret planted in guide.md: render exits 1 with SECRET_LEAK naming var + line but not the value; writes no HTML/PDF', () => {
    const copy = copyDir(ws, path.join(tmpDir(), 'leak')); const c = (...p) => path.join(copy, 'guide', ...p);
    fs.rmSync(c('guide.html'), { force: true }); fs.rmSync(c('guide-draft.pdf'), { force: true }); fs.rmSync(c('render.json'), { force: true }); fs.rmSync(c('preview'), { recursive: true, force: true });
    const lines = read(c('guide.md')).split('\n'); lines.splice(9, 0, `Use the password ${SECRET} to sign in.`);
    fs.writeFileSync(c('guide.md'), lines.join('\n'));
    const r = guide('render', path.join(copy, 'demo.yaml'), ['--json'], { env });
    assert.equal(r.status, 1);
    assert.ok(!r.stdout.includes(SECRET) && !r.stderr.includes(SECRET), 'value must not be printed');
    const j = parseJson(r); assert.equal(j.ok, false);
    const leak = j.findings.errors.find((e) => e.code === 'SECRET_LEAK');
    assert.ok(leak, 'SECRET_LEAK finding'); assert.equal(leak.file, 'guide.md'); assert.equal(leak.line, 10); assert.match(leak.message, /GUIDE_TEST_SECRET/);
    assert.match(r.stderr, /SECRET_LEAK/);
    for (const f of ['guide.html', 'guide-draft.pdf', 'render.json', 'guide.pdf']) assert.ok(!fs.existsSync(c(f)), `${f} must not be written`);
  });
  test('render exits 1 on a missing image, a remote image and an empty alt (each reported)', () => {
    const copy = copyDir(ws, path.join(tmpDir(), 'badimg')); const c = (...p) => path.join(copy, 'guide', ...p);
    fs.writeFileSync(c('guide.md'), `${read(c('guide.md'))}\n![alt text](images/missing.png)\n![remote ok alt](https://example.com/x.png)\n![](images/01-account-2.png)\n![screenshot](images/01-account-2.png)\n`);
    const r = guide('render', path.join(copy, 'demo.yaml'), ['--json'], { env });
    assert.equal(r.status, 1);
    const codes = parseJson(r).findings.errors.map((e) => e.code);
    for (const k of ['MISSING_IMAGE', 'REMOTE_IMAGE', 'EMPTY_ALT']) assert.ok(codes.includes(k), `${k} in ${codes}`);
    assert.equal(codes.filter((x) => x === 'EMPTY_ALT').length, 2);
    assert.ok(!fs.existsSync(c('guide-draft.pdf')) || sha(fs.readFileSync(c('guide-draft.pdf'))) === sha(fs.readFileSync(G('guide-draft.pdf'))), 'draft not replaced');
  });
  test('render warns (does not fail) about step marker mismatch and unapplied overrides', () => {
    const copy = copyDir(ws, path.join(tmpDir(), 'markers')); const c = (...p) => path.join(copy, 'guide', ...p);
    fs.writeFileSync(c('guide.md'), read(c('guide.md')).replace('<!-- guide:step n=2 id=account.3 -->', '<!-- guide:step n=2 id=account.renamed -->'));
    const r = guide('render', path.join(copy, 'demo.yaml'), ['--json'], { env });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(parseJson(r).findings.warnings.some((w) => w.code === 'STEP_MARKERS_MISMATCH'));
  });
  test('--json render/refresh output has only JSON on stdout', () => {
    const r = guide('refresh', spec, ['--json'], { env });
    assert.equal(r.status, 0, r.stderr);
    const j = parseJson(r); assert.equal(j.ok, true); assert.equal(j.steps.length, 10); assert.ok(j.files.pdf.endsWith('guide-draft.pdf'));
    assert.ok(r.stderr.length > 0, 'logs on stderr');
  });
  test('refresh adds LABEL/SELECTOR change warnings when the UI changed', () => {
    const copy = copyDir(ws, path.join(tmpDir(), 'uichange')); const c = (...p) => path.join(copy, 'guide', ...p);
    fs.writeFileSync(path.join(copy, 'index.html'), read(copy, 'index.html').replace('Create account</button>', 'Register now</button>'));
    const r = guide('refresh', path.join(copy, 'demo.yaml'), ['--json'], { env });
    assert.equal(r.status, 0, r.stderr);
    const w = parseJson(r).warnings.find((x) => x.code === 'LABEL_CHANGED');
    assert.ok(w, 'LABEL_CHANGED'); assert.equal(w.from, 'Create account'); assert.equal(w.to, 'Register now');
    assert.ok(!read(c('guide.md')).includes('Register now'), 'guide.md still untouched');
  });
});

describe('guide-app: mask and hide are applied to the pixels (FR-12, AC-5.1)', NEEDS_BROWSER, () => {
  const YELLOW = (p) => p[0] > 240 && p[1] > 190 && p[1] < 220 && p[2] < 40; // #chat widget background (#fc0)
  const variant = (maskLine, hideLine) => {
    const ws = fixtureCopy('guide-app');
    fs.writeFileSync(path.join(ws, 'demo.yaml'), read(ws, 'demo.yaml').replace('mask: [".pii"]', maskLine).replace('hide: ["#chat"]', hideLine));
    const r = guide('capture', path.join(ws, 'demo.yaml'), [], { env: { GUIDE_TEST_SECRET: SECRET } });
    assert.equal(r.status, 0, r.stderr);
    return path.join(ws, 'guide', 'images');
  };
  test('hide removes #chat from full and close-up images; mask changes the pixels of .pii elements', async () => {
    const plain = variant('mask: []', 'hide: []');
    const masked = variant('mask: [".pii"]', 'hide: []');
    const hidden = variant('mask: []', 'hide: ["#chat"]');
    const full = '01-account-2.png';
    assert.ok(countPixels(await decodePng(path.join(plain, full)), YELLOW) > 200, 'control: chat widget visible when not hidden');
    for (const f of ['01-account-2.png', '08-account-9.png']) assert.equal(countPixels(await decodePng(path.join(hidden, f)), YELLOW), 0, `${f} must not show the hidden widget`);
    // mask: the page differs from the unmasked control, but only where .pii elements are (top area owner line)
    const a = await decodePng(path.join(plain, full)); const b = await decodePng(path.join(masked, full));
    const changed = diffPixels(a, b);
    assert.ok(changed > 100 && changed < 100000, `masked pixels changed: ${changed}`);
    // the masked button's close-up (step 7: click #piibtn) differs from the unmasked one
    const closeup = '07-account-8-closeup.png';
    assert.ok(diffPixels(await decodePng(path.join(plain, closeup)), await decodePng(path.join(masked, closeup))) > 50, 'close-up must be masked too');
  });
});

describe('secret handling at capture time', NEEDS_BROWSER, () => {
  const mk = (guideYaml) => {
    const ws = fixtureCopy('guide-app');
    fs.copyFileSync(path.join(ws, 'demo-secret.yaml'), path.join(ws, 'demo.yaml'));
    if (guideYaml) fs.writeFileSync(path.join(ws, 'guide.yaml'), guideYaml); else fs.rmSync(path.join(ws, 'guide.yaml'), { force: true });
    return ws;
  };
  test('${SECRET} typed into a non-password field without a value override -> SECRET_VALUE, no images kept', () => {
    const ws = mk(null);
    const r = guide('capture', path.join(ws, 'demo.yaml'), ['--json'], { env: { GUIDE_TEST_SECRET: SECRET } });
    assert.equal(r.status, 1);
    const j = parseJson(r); assert.equal(j.ok, false); assert.equal(j.code, 'SECRET_VALUE'); assert.match(j.error, /value: "/);
    assert.ok(!r.stdout.includes(SECRET) && !r.stderr.includes(SECRET));
    assert.ok(!fs.existsSync(path.join(ws, 'guide/images')) && !fs.existsSync(path.join(ws, 'guide/steps.json')) && !fs.existsSync(path.join(ws, 'guide/.staging')));
  });
  test('with a fixed fake value override the same flow captures and the secret appears nowhere', () => {
    const ws = mk('steps:\n  account.1: { value: "Jane Doe" }\n');
    const env = { GUIDE_TEST_SECRET: SECRET };
    const r = guide('capture', path.join(ws, 'demo.yaml'), ['--json'], { env });
    assert.equal(r.status, 0, r.stderr);
    const d = readJson(ws, 'guide/steps.json');
    assert.equal(d.steps[0].value, 'Jane Doe'); assert.equal(d.steps[0].valueSource, 'guide.yaml'); assert.equal(d.steps[0].valueRedacted, false);
    assert.ok(!r.stdout.includes(SECRET) && !r.stderr.includes(SECRET));
    for (const f of walkText(path.join(ws, 'guide'))) assert.ok(!read(f).includes(SECRET), f);
  });
  test('a skipped step that types ${SECRET} into a plain field is still refused (guard also covers non-step actions)', () => {
    const ws = mk('steps:\n  account.1: { skip: true }\n');
    const r = guide('capture', path.join(ws, 'demo.yaml'), ['--json'], { env: { GUIDE_TEST_SECRET: SECRET } });
    assert.equal(r.status, 1); assert.equal(parseJson(r).code, 'SECRET_VALUE');
  });
  test('value override on a click action is a config error', () => {
    const ws = mk('steps:\n  account.2: { value: x }\n');
    const r = guide('plan', path.join(ws, 'demo.yaml'), ['--json'], { env: { GUIDE_TEST_SECRET: SECRET } });
    assert.equal(r.status, 1); assert.match(parseJson(r).error, /"value" only applies to type\/fill\/select/);
  });
});
