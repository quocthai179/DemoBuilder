// Hardening tests for the review findings: mask validation (B1), masked targets (M1), secret guard (M3),
// environment policy (M2), robust promote, --json failures, prepareSession.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fixtureCopy, tmpDir, guide, demo, snapshot, readJson, read, browserSkipReason, mkSpec, decodePng, LIB } from './helpers.mjs';

const SKIP = await browserSkipReason();
const NEEDS_BROWSER = SKIP ? { skip: SKIP } : {};
const SECRET = 'Sup3r-S3cret-Pw-9137';
const ENVV = { GUIDE_TEST_SECRET: SECRET };
const parseJson = (r) => { try { return JSON.parse(r.stdout); } catch (e) { assert.fail(`stdout is not pure JSON (${e.message}):\n${r.stdout.slice(0, 400)}\nstderr: ${r.stderr.slice(0, 400)}`); } };
const ls = (d) => fs.readdirSync(d).sort();
const walkText = (dir) => {
  const out = [];
  const rec = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) rec(p); else if (/\.(md|json|html|yaml)$/.test(e.name)) out.push(p); } };
  rec(dir); return out;
};
const SHELL = (extra) => `title: T\nviewport: { width: 1280, height: 720 }\n${extra}`;
const writeDemo = (ws, body) => fs.writeFileSync(path.join(ws, 'demo.yaml'), body);

// ------------------------------------------------------------------ B1: mask / hide validation
describe('B1: mask and hide selectors are validated and applied one rule each', NEEDS_BROWSER, () => {
  const run = (maskLine, guideYaml = null) => {
    const ws = fixtureCopy('guide-app');
    fs.writeFileSync(path.join(ws, 'demo.yaml'), read(ws, 'demo.yaml').replace('mask: [".pii"]', maskLine));
    if (guideYaml !== null) fs.writeFileSync(path.join(ws, 'guide.yaml'), `${read(ws, 'guide.yaml')}${guideYaml}`);
    return { ws, r: guide('capture', path.join(ws, 'demo.yaml'), ['--json'], { env: ENVV }) };
  };
  test('a Playwright-style or invalid mask selector stops capture with MASK_INVALID listing only the bad ones; nothing is written', () => {
    const { ws, r } = run('mask: [".pii", "text=Jane", "button:has-text(\\"JD\\")", "div[unclosed"]');
    assert.equal(r.status, 1);
    const j = parseJson(r);
    assert.equal(j.ok, false); assert.equal(j.code, 'MASK_INVALID');
    for (const bad of ['text=Jane', 'button:has-text("JD")', 'div[unclosed']) assert.ok(j.error.includes(bad), bad);
    assert.ok(!/mask: \.pii\n/.test(j.error), 'valid selector must not be listed');
    assert.match(j.error, /CSS/);
    assert.ok(!fs.existsSync(path.join(ws, 'guide', 'images')) && !fs.existsSync(path.join(ws, 'guide', 'steps.json')) && !fs.existsSync(path.join(ws, 'guide', '.staging')));
  });
  test('an invalid hide selector from guide.yaml is also MASK_INVALID', () => {
    const { r } = run('mask: [".pii"]', 'hide: ["#chat >> text=x"]\n');
    assert.equal(r.status, 1); const j = parseJson(r); assert.equal(j.code, 'MASK_INVALID'); assert.match(j.error, /hide: #chat >> text=x/);
  });
  test('a mask selector that matches nothing is a MASK_UNMATCHED warning naming it (valid ones are not listed)', () => {
    const { ws, r } = run('mask: [".pii", ".typo-class"]');
    assert.equal(r.status, 0, r.stderr);
    const w = readJson(ws, 'guide/steps.json').warnings.find((x) => x.code === 'MASK_UNMATCHED');
    assert.ok(w, 'MASK_UNMATCHED'); assert.deepEqual(w.selectors, ['.typo-class']);
  });
  test('all valid masks matching: no MASK_UNMATCHED', () => {
    const { ws, r } = run('mask: [".pii"]');
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!readJson(ws, 'guide/steps.json').warnings.some((x) => x.code === 'MASK_UNMATCHED'));
  });
  const TYPOS = ['[data-testid="x]', ':not(.a', 'tr:has(.x', '.a /*', '.a\\'];
  test('N1: unbalanced selectors placed BEFORE valid masks and a hide are MASK_INVALID (each listed), nothing is written', () => {
    const { ws, r } = run(`mask: [${TYPOS.map((t) => `'${t}'`).join(', ')}, ".pii"]`, "hide: ['#chat', '.h /*']\n");
    assert.equal(r.status, 1); const j = parseJson(r);
    assert.equal(j.code, 'MASK_INVALID');
    for (const t of [...TYPOS, '.h /*']) assert.ok(j.error.includes(t), t);
    assert.ok(!j.error.includes('mask: .pii') && !j.error.includes('hide: #chat'), 'valid selectors are not listed');
    assert.ok(!fs.existsSync(path.join(ws, 'guide', 'images')) && !fs.existsSync(path.join(ws, 'guide', 'steps.json')));
  });
  test('N1: overlayInit with those typo selectors listed first still blurs .pii and hides #chat', async () => {
    const { chromium } = (await import(LIB('util.mjs'))).requireModule('playwright');
    const { overlayInit } = await import(LIB('overlay.mjs'));
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.addInitScript(overlayInit, { cursor: { show: false }, mask: [...TYPOS, '.pii'], hide: ['.h /*', '[x="y', '#chat'], primary: '#000', font: 'sans-serif', hideScrollbars: true });
      await page.goto(`file://${path.join(fixtureCopy('guide-app'), 'index.html')}`);
      const r = await page.evaluate(() => ({ pii: getComputedStyle(document.querySelector('.pii')).filter, chat: getComputedStyle(document.querySelector('#chat')).display }));
      assert.match(r.pii, /blur\(7px\)/); assert.equal(r.chat, 'none');
    } finally { await browser.close(); }
  });
  test('N1: `validate` rejects them (exit 1, every bad selector listed); so does `record --dry`', () => {
    const ws = fixtureCopy('guide-app'); const spec = path.join(ws, 'demo.yaml');
    fs.writeFileSync(spec, read(ws, 'demo.yaml').replace('mask: [".pii"]', `mask: [${TYPOS.map((t) => `'${t}'`).join(', ')}, ".pii"]`));
    for (const args of [['validate', spec], ['record', spec, '--dry']]) {
      const r = demo(args, { cwd: ws, env: ENVV }); const out = r.stdout + r.stderr;
      assert.equal(r.status, 1, `${args[0]}: ${out}`);
      for (const t of TYPOS) assert.ok(out.includes(t), `${args[0]} lists ${t}`);
    }
  });
  test('overlayInit emits one CSS rule per selector: an invalid entry cannot cancel the valid one (video path too)', async () => {
    const { chromium } = (await import(LIB('util.mjs'))).requireModule('playwright');
    const { overlayInit } = await import(LIB('overlay.mjs'));
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.addInitScript(overlayInit, { cursor: { show: false }, mask: ['.pii', 'text=Jane', 'button:has-text("x")'], hide: ['#chat', '>>bad'], primary: '#000', font: 'sans-serif', hideScrollbars: true });
      await page.goto(`file://${path.join(fixtureCopy('guide-app'), 'index.html')}`);
      const r = await page.evaluate(() => ({ pii: getComputedStyle(document.querySelector('.pii')).filter, chat: getComputedStyle(document.querySelector('#chat')).display }));
      assert.match(r.pii, /blur\(7px\)/); assert.equal(r.chat, 'none');
    } finally { await browser.close(); }
  });
});

describe('N1: static selector checks (no browser)', () => {
  test('unbalanced / unsafe selectors are refused; ordinary ones pass', async () => {
    const { staticSelectorProblem: p } = await import(LIB('selectors.mjs'));
    for (const bad of ['[data-testid="x]', ':not(.a', 'tr:has(.x', '.a /*', '.a\\', "[a='b", '.x{}', '.x;', '.x}', '.x)', 'a]', '@media all', '', '  ', '[a="b\nc"]', ':is(.a, [b="c)"']) assert.ok(p(bad), JSON.stringify(bad));
    for (const ok of ['.pii', '#chat', '[data-testid="x"]', ':not(.a)', 'tr:has(.x)', '.a\\\\', '[data-x="a)b"]', "[title='it\\'s']", '.a, .b', ':is(.a, .b) > span', '.a\\:b']) assert.equal(p(ok), null, ok);
  });
  test('validateSpec reports mask/hide selectors that fail the static checks', async () => {
    const spec = await mkSpec(SHELL('mask: [".ok", ".x /*"]\nhide: [":not(.a"]\nscenes:\n  - id: s\n    url: ./index.html\n    actions:\n      - click: "#b"\n'), null, { 'index.html': '<button id="b">b</button>' });
    const problems = (await import(LIB('spec.mjs'))).validateSpec(spec).filter((x) => /selector/.test(x));
    assert.equal(problems.length, 2); assert.ok(problems[0].includes('.x /*') && problems[1].includes(':not(.a'));
  });
});

// ------------------------------------------------------------------ M1: masked targets take no DOM text
describe('M1: masked targets: no aria-label/title/placeholder/<label>/name/text in output', NEEDS_BROWSER, () => {
  const LEAKS = ['Jane', 'Customer', 'customer.test', 'email-jane', '555-0100', 'Zed', 'Billing'];
  const mk = (guideYaml) => {
    const ws = fixtureCopy('guide-app');
    fs.copyFileSync(path.join(ws, 'demo-masked.yaml'), path.join(ws, 'demo.yaml'));
    fs.writeFileSync(path.join(ws, 'guide.yaml'), guideYaml);
    return ws;
  };
  test('masked button/input/label-masked/aria-labelledby-masked fall back to the role word; the unmasked control keeps its label', () => {
    const ws = mk('scenes: [m]\n');
    const r = guide('capture', path.join(ws, 'demo.yaml'), ['--json']);
    assert.equal(r.status, 0, r.stderr);
    const d = readJson(ws, 'guide/steps.json');
    for (const s of d.steps.slice(0, 4)) { assert.equal(s.target.label, '', s.id); assert.equal(s.target.masked, true, s.id); assert.equal(s.target.labelSource, 'none', s.id); }
    assert.equal(d.steps[4].target.label, 'Open'); assert.equal(d.steps[4].target.masked, false);
    assert.equal(d.steps[0].template.text, 'Click the highlighted button.');
    assert.equal(d.steps[1].template.text, 'Click the highlighted field.');
    for (const f of walkText(path.join(ws, 'guide'))) { const t = read(f); for (const w of LEAKS) assert.ok(!t.includes(w), `${w} leaked into ${path.relative(ws, f)}`); }
  });
  test('an explicit label: override is used for the sentence and the annotation of a masked target', () => {
    const ws = mk('scenes: [m]\nsteps:\n  m.1: { label: "Profile menu" }\n');
    const r = guide('capture', path.join(ws, 'demo.yaml'), ['--json']);
    assert.equal(r.status, 0, r.stderr);
    const d = readJson(ws, 'guide/steps.json');
    assert.equal(d.steps[0].annotation.label, 'Profile menu'); assert.equal(d.steps[0].template.text, 'Click **Profile menu**.'); assert.equal(d.steps[0].target.label, '');
  });
});

// ------------------------------------------------------------------ M3: secret guard
describe('M3: SECRET_VALUE guard covers every scene, select, evaluate/press, and fails closed', () => {
  const mk = (demoBody, guideYaml = 'scenes: [main]\n') => {
    const ws = fixtureCopy('guide-app');
    writeDemo(ws, SHELL(demoBody)); fs.writeFileSync(path.join(ws, 'guide.yaml'), guideYaml);
    return ws;
  };
  const cap = (ws) => guide('capture', path.join(ws, 'demo.yaml'), ['--json'], { env: ENVV });
  const MAIN = '  - id: main\n    url: ./index.html\n    actions:\n      - click: "#go"\n';
  const noLeak = (r, ws) => { assert.ok(!r.stdout.includes(SECRET) && !r.stderr.includes(SECRET)); assert.ok(!fs.existsSync(path.join(ws, 'guide/images')) && !fs.existsSync(path.join(ws, 'guide/steps.json'))); };

  test('press / evaluate with ${ENV} in a screen scene is refused up front (no browser needed)', () => {
    for (const act of ['press: "${GUIDE_TEST_SECRET}"', 'evaluate: "document.title = \'${GUIDE_TEST_SECRET}\'"']) {
      const ws = mk(`scenes:\n  - id: prep\n    url: ./index.html\n    actions:\n      - ${act}\n${MAIN}`);
      const r = cap(ws);
      assert.equal(r.status, 1, act); const j = parseJson(r); assert.equal(j.code, 'SECRET_VALUE', act); assert.match(j.error, /prep\.1/); assert.match(j.error, /outside setup/);
      noLeak(r, ws);
    }
  });
  test('the same ${ENV} in setup: is not refused by that rule (login is allowed)', async () => {
    process.env.GUIDE_TEST_SECRET = SECRET;
    try {
      const spec = await mkSpec(SHELL(`setup:\n  - press: "\${GUIDE_TEST_SECRET}"\nscenes:\n${MAIN}`), null, { 'index.html': '<title>x</title>' });
      assert.equal(spec.setup[0].envRefs[0], 'GUIDE_TEST_SECRET');
      const G = await import(LIB('guide.mjs'));
      assert.equal(G.buildPlan(spec, G.loadGuideConfig(spec)).steps.length, 1); // plan builds; only screen-scene press/evaluate are refused at capture
    } finally { delete process.env.GUIDE_TEST_SECRET; }
  });
  test('select with ${ENV} and no value override -> SECRET_VALUE', { ...NEEDS_BROWSER }, () => {
    const ws = mk(`scenes:\n  - id: main\n    url: ./index.html\n    actions:\n      - select: { selector: "#plan", value: "\${GUIDE_TEST_SECRET}" }\n      - click: "#go"\n`);
    const r = cap(ws);
    assert.equal(r.status, 1); const j = parseJson(r); assert.equal(j.code, 'SECRET_VALUE'); assert.match(j.error, /select/); assert.match(j.error, /value: "/);
    noLeak(r, ws);
  });
  test('select with ${ENV} plus a fake value override captures', NEEDS_BROWSER, () => {
    const ws = mk(`scenes:\n  - id: main\n    url: ./index.html\n    actions:\n      - select: { selector: "#plan", value: "\${GUIDE_TEST_SECRET}" }\n      - click: "#go"\n`, 'scenes: [main]\nsteps:\n  main.1: { value: pro }\n');
    const r = cap(ws);
    assert.equal(r.status, 0, r.stderr);
    for (const f of walkText(path.join(ws, 'guide'))) assert.ok(!read(f).includes(SECRET), f);
  });
  test('a secret typed into a plain field of a scene NOT listed in guide.yaml `scenes` is refused', NEEDS_BROWSER, () => {
    const ws = mk(`scenes:\n  - id: prep\n    url: ./index.html\n    actions:\n      - type: { selector: "#name", text: "\${GUIDE_TEST_SECRET}" }\n${MAIN}`);
    const r = cap(ws);
    assert.equal(r.status, 1); const j = parseJson(r); assert.equal(j.code, 'SECRET_VALUE'); assert.match(j.error, /prep\.1/); noLeak(r, ws);
  });
  test('the same unlisted-scene type into a password field is allowed; a value override on the unlisted ref is honoured', NEEDS_BROWSER, () => {
    const pw = mk(`scenes:\n  - id: prep\n    url: ./index.html\n    actions:\n      - type: { selector: "#pw", text: "\${GUIDE_TEST_SECRET}" }\n${MAIN}`);
    assert.equal(cap(pw).status, 0);
    const ov = mk(`scenes:\n  - id: prep\n    url: ./index.html\n    actions:\n      - type: { selector: "#name", text: "\${GUIDE_TEST_SECRET}" }\n${MAIN}`, 'scenes: [main]\nsteps:\n  prep.1: { value: "Jane Doe" }\n');
    const r = cap(ov); assert.equal(r.status, 0, r.stderr);
    for (const f of walkText(path.join(ov, 'guide'))) assert.ok(!read(f).includes(SECRET), f);
  });
  test('fail closed: when the target cannot be inspected the typed ${ENV} is refused as SECRET_VALUE', NEEDS_BROWSER, () => {
    const ws = mk(`scenes:\n  - id: main\n    url: ./index.html\n    actions:\n      - type: { selector: "#does-not-exist", text: "\${GUIDE_TEST_SECRET}" }\n${MAIN.replace('  - id: main', '  - id: tail')}`, 'scenes: [main]\ncapture: { timeout: 1500 }\n');
    const r = cap(ws);
    assert.equal(r.status, 1); const j = parseJson(r); assert.equal(j.code, 'SECRET_VALUE'); assert.match(j.error, /could not be inspected/); noLeak(r, ws);
  });
});

// ------------------------------------------------------------------ M2: environment policy
describe('M2: environment policy (allowlist + per-host confirmation)', () => {
  const prod = (baseUrl, guideYaml = null) => {
    const ws = fixtureCopy('guide-prod');
    writeDemo(ws, read(ws, 'demo.yaml').replace('https://app.acme-corp.com', baseUrl));
    if (guideYaml !== null) fs.writeFileSync(path.join(ws, 'guide.yaml'), guideYaml);
    return ws;
  };
  const cap = (ws, extra = []) => guide('capture', path.join(ws, 'demo.yaml'), ['--json', ...extra]);
  test('.dev / .qa TLDs, dev.azure.com, test.salesforce.com and staging-like names all need confirmation', () => {
    for (const u of ['https://acme.dev', 'https://app.qa', 'https://dev.azure.com', 'https://test.salesforce.com', 'https://staging.acme-corp.com', 'https://demo.acme-corp.com']) {
      const ws = prod(u); const host = new URL(u).hostname;
      const r = cap(ws);
      assert.equal(r.status, 1, u); const j = parseJson(r);
      assert.equal(j.code, 'ENV_UNCONFIRMED', u); assert.ok(j.error.includes(`--confirm-env=${host}`), j.error);
      assert.ok(!fs.existsSync(path.join(ws, 'guide', 'images')), u);
    }
  });
  test('a bare --confirm-env, or one naming another host, confirms nothing', () => {
    const ws = prod('https://acme.dev');
    for (const extra of [['--confirm-env'], ['--confirm-env=other.example.org'], ['--confirm-env=']]) {
      const r = cap(ws, extra); assert.equal(r.status, 1, extra.join()); assert.equal(parseJson(r).code, 'ENV_UNCONFIRMED', extra.join());
    }
  });
  test('plan shows needsConfirm / advisory; env.allow removes the warning; local stays free', () => {
    const p = parseJson(guide('plan', path.join(prod('https://staging.acme-corp.com'), 'demo.yaml'), ['--json']));
    assert.equal(p.env.class, 'staging'); assert.deepEqual(p.env.needsConfirm, ['staging.acme-corp.com']); assert.equal(p.env.advisory['staging.acme-corp.com'], 'staging-like');
    assert.ok(p.warnings.some((w) => w.code === 'ENV_UNCONFIRMED' && /--confirm-env=staging\.acme-corp\.com/.test(w.message)));
    const a = parseJson(guide('plan', path.join(prod('https://app.acme-corp.com', 'env:\n  allow: [app.acme-corp.com]\n'), 'demo.yaml'), ['--json']));
    assert.equal(a.env.class, 'allowed'); assert.deepEqual(a.env.needsConfirm, []); assert.deepEqual(a.env.allowed, ['app.acme-corp.com']);
    assert.ok(!a.warnings.some((w) => w.code === 'ENV_UNCONFIRMED'));
    const l = parseJson(guide('plan', path.join(fixtureCopy('guide-app'), 'demo.yaml'), ['--json'], { env: ENVV }));
    assert.equal(l.env.class, 'local'); assert.deepEqual(l.env.needsConfirm, []);
  });
  test('allowlisting a different host does not help; the invalid env.allow entry is a CONFIG_INVALID', () => {
    const ws = prod('https://app.acme-corp.com', 'env:\n  allow: [other.acme-corp.com]\n');
    assert.equal(parseJson(cap(ws)).code, 'ENV_UNCONFIRMED');
    const bad = prod('https://app.acme-corp.com', 'env:\n  allow: ["https://app.acme-corp.com/"]\n');
    const r = cap(bad); assert.equal(r.status, 1); const j = parseJson(r); assert.equal(j.code, 'CONFIG_INVALID'); assert.match(j.error, /env\.allow/);
  });
  test('refresh needs the same host confirmation', () => {
    const ws = prod('https://acme.dev'); const spec = path.join(ws, 'demo.yaml');
    fs.mkdirSync(path.join(ws, 'guide'));
    const plan = parseJson(guide('plan', spec, ['--json']));
    fs.writeFileSync(path.join(ws, 'guide', 'steps.json'), JSON.stringify({ plan: { signature: plan.signature, steps: plan.steps.map(({ n, id, action }) => ({ n, id, action })) }, steps: [], warnings: [] }));
    const r = guide('refresh', spec, ['--json', '--confirm-env=elsewhere.org']);
    assert.equal(r.status, 1); assert.equal(parseJson(r).code, 'ENV_UNCONFIRMED');
  });
});

describe('M2: hosts actually navigated to are gated (links, redirects) and recorded', NEEDS_BROWSER, () => {
  let server; let port;
  const start = async () => {
    const code = `const h=require('http');const s=h.createServer((q,r)=>{if(q.url==='/sw.js'){r.writeHead(200,{'content-type':'text/javascript'});return r.end('self.addEventListener("fetch",function(e){fetch("http://prod.example.com:'+p+'/via-sw-post",{method:"POST",body:"x",mode:"no-cors"})})');}
if(q.url==='/redir'){r.writeHead(302,{Location:'http://elsewhere.example.org/y'});return r.end();}
r.writeHead(200,{'content-type':'text/html'});r.end('<!doctype html><html lang="en"><title>Local</title><button id="go" type="button">Go</button><a id="out" href="http://elsewhere.example.org/x">Leave</a>');});
s.on('upgrade',(q,k)=>{console.log(JSON.stringify({m:'UPGRADE',h:(q.headers.host||'').split(':')[0],u:q.url}));k.destroy();});
s.listen(0,'127.0.0.1',()=>console.log(s.address().port));`;
    server = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'inherit'] });
    port = await new Promise((res, rej) => { server.stdout.once('data', (d) => res(Number(String(d).trim()))); server.once('error', rej); setTimeout(() => rej(new Error('server did not start')), 5000); });
  };
  const mk = (actions, scenePrefix = '    url: /page\n') => {
    const ws = tmpDir('guide-net-');
    fs.writeFileSync(path.join(ws, 'demo.yaml'), SHELL(`baseUrl: http://127.0.0.1:${port}\nscenes:\n  - id: s\n${scenePrefix}    actions:\n${actions}`));
    return ws;
  };
  const cap = (ws, extra = []) => guide('capture', path.join(ws, 'demo.yaml'), ['--json', ...extra]);
  test('local page: capture works; steps.json records contacted and confirmed hosts', async () => {
    await start();
    try {
      const ws = mk('      - click: "#go"\n');
      const r = cap(ws, ['--confirm-env=Extra.Example.org']);
      assert.equal(r.status, 0, r.stderr);
      const env = readJson(ws, 'guide/steps.json').env;
      assert.deepEqual(env.contacted, ['127.0.0.1']); assert.deepEqual(env.confirmed, ['extra.example.org']); assert.equal(env.class, 'local');
    } finally { server.kill(); }
  });
  test('clicking a link to an unconfirmed host is blocked: ENV_UNCONFIRMED names the host, nothing is promoted', async () => {
    await start();
    try {
      const ws = mk('      - click: "#out"\n      - wait: 300\n      - click: "#go"\n');
      const r = cap(ws);
      assert.equal(r.status, 1, r.stdout + r.stderr); const j = parseJson(r);
      assert.equal(j.code, 'ENV_UNCONFIRMED'); assert.match(j.error, /elsewhere\.example\.org/); assert.match(j.error, /--confirm-env=/);
      assert.ok(!fs.existsSync(path.join(ws, 'guide/images')) && !fs.existsSync(path.join(ws, 'guide/steps.json')) && !fs.existsSync(path.join(ws, 'guide/.staging')));
    } finally { server.kill(); }
  });
  test('a redirect from an approved host to an unconfirmed host stops capture', async () => {
    await start();
    try {
      const ws = mk('      - goto: /redir\n      - click: "#go"\n');
      const r = cap(ws);
      assert.equal(r.status, 1, r.stdout + r.stderr); const j = parseJson(r);
      assert.equal(j.code, 'ENV_UNCONFIRMED'); assert.match(j.error, /elsewhere\.example\.org/);
    } finally { server.kill(); }
  });
});

// ------------------------------------------------------------------ N2 / N3: redirect hops stop the run; every request is gated and recorded
describe('N2/N3: redirects and API writes to unapproved hosts', NEEDS_BROWSER, () => {
  // The unapproved hosts RESOLVE to the local test server (Chromium --host-resolver-rules), so a request that is not blocked really arrives and is logged.
  const SERVER = `const h=require('http');const s=h.createServer((q,r)=>{
const p=s.address().port;console.log(JSON.stringify({m:q.method,h:(q.headers.host||'').split(':')[0],u:q.url}));
if(q.url==='/redir'){r.writeHead(302,{Location:'http://prod.example.com:'+p+'/app'});return r.end();}
if(q.url==='/wk.js'){r.writeHead(200,{'content-type':'text/javascript'});return r.end('fetch("http://prod.example.com:'+p+'/w",{method:"POST",body:"x",mode:"no-cors"})');}
if(q.url.startsWith('/api/')){r.writeHead(200,{'access-control-allow-origin':'*'});return r.end('ok');}
r.writeHead(200,{'content-type':'text/html'});
const A={'/popup':'window.open("http://prod.example.com:"+P+"/hit")','/blank':'var a=document.createElement("a");a.href="http://prod.example.com:"+P+"/hit";a.target="_blank";document.body.appendChild(a);a.click()','/iframe':'var f=document.createElement("iframe");f.src="http://prod.example.com:"+P+"/hit";document.body.appendChild(f)','/ws':'new WebSocket("ws://prod.example.com:"+P+"/sock")','/shared':'new SharedWorker("/wk.js")','/sw':'navigator.serviceWorker.register("/sw.js").then(function(){return fetch("/via-sw")}).catch(function(){})'};
const extra=A[q.url]?'<script>var P='+p+';function act(){'+A[q.url]+'}</script><button id="act" type="button" onclick="act()">A</button>':q.url==='/xhr'?'<button id="xpost" type="button" onclick="fetch(\\'http://api.example.org:'+p+'/api/x\\',{method:\\'POST\\',mode:\\'no-cors\\',body:\\'x\\'})">X</button>':q.url==='/img'?'<img src="http://cdn.example.org:'+p+'/pic.png">':'';
r.end('<!doctype html><html lang="en"><title>T</title><button id="save" type="button" onclick="fetch(\\'/api/save\\',{method:\\'POST\\',body:\\'x\\'})">Save</button><button id="go" type="button">Go</button>'+extra);});
s.listen(0,'127.0.0.1',()=>console.log(s.address().port));`;
  let srv; let port; const seen = [];
  const start = async () => {
    seen.length = 0; let buf = '';
    srv = spawn(process.execPath, ['-e', SERVER], { stdio: ['ignore', 'pipe', 'inherit'] });
    port = await new Promise((res, rej) => {
      srv.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (/^\d+$/.test(line)) res(Number(line)); else if (line) seen.push(JSON.parse(line)); } });
      srv.once('error', rej); setTimeout(() => rej(new Error('server did not start')), 5000);
    });
  };
  const settleLog = () => new Promise((r) => setTimeout(r, 400)); // let the server flush any in-flight request into `seen`
  // Runs capture in this process with the resolver rules added to every Chromium launch.
  const capture = async (yaml, opts = {}) => {
    const { requireModule } = await import(LIB('util.mjs')); const G = await import(LIB('guide.mjs')); const { loadSpec } = await import(LIB('spec.mjs'));
    const pw = requireModule('playwright'); const orig = pw.chromium.launch;
    pw.chromium.launch = (o = {}) => orig.call(pw.chromium, { ...o, args: [...(o.args || []), '--host-resolver-rules=MAP prod.example.com 127.0.0.1, MAP api.example.org 127.0.0.1, MAP cdn.example.org 127.0.0.1'] });
    const ws = tmpDir('guide-n23-'); fs.writeFileSync(path.join(ws, 'demo.yaml'), SHELL(`baseUrl: http://127.0.0.1:${port}\n${yaml}`));
    try { const spec = loadSpec(path.join(ws, 'demo.yaml')); const doc = await G.capture(spec, G.loadGuideConfig(spec), opts); await settleLog(); return { ws, doc }; } catch (e) { await settleLog(); e.ws = ws; throw e; } finally { pw.chromium.launch = orig; }
  };
  const posts = () => seen.filter((x) => x.m === 'POST');

  test('N2: after a redirect hop to an unapproved host, no further request (no POST) reaches it and capture stops before the next action', async () => {
    await start();
    try {
      await assert.rejects(capture('scenes:\n  - id: s\n    url: /page\n    actions:\n      - goto: /redir\n      - click: "#save"\n      - wait: 300\n      - click: "#go"\n'), (e) => {
        assert.equal(e.code, 'ENV_UNCONFIRMED'); assert.match(e.message, /prod\.example\.com/); assert.match(e.message, /redirect/); assert.match(e.message, /--confirm-env=/);
        assert.ok(!/the request was blocked/.test(e.message), 'must not claim the redirect was blocked');
        assert.ok(!fs.existsSync(path.join(e.ws, 'guide/images')) && !fs.existsSync(path.join(e.ws, 'guide/steps.json')));
        return true;
      });
      assert.ok(seen.some((x) => x.h === 'prod.example.com' && x.u === '/app'), 'the redirect hop itself is detected after the fact');
      assert.deepEqual(posts(), [], `no write after the hop: ${JSON.stringify(seen)}`);
      assert.ok(!seen.some((x) => x.u === '/api/save'));
    } finally { srv.kill(); }
  });
  test('N2: the same hop inside setup: stops before the next setup action (prepareSession)', async () => {
    await start();
    try {
      await assert.rejects(capture('setup:\n  - goto: /redir\n  - click: "#save"\nscenes:\n  - id: s\n    url: /page\n    actions:\n      - click: "#go"\n'), (e) => e.code === 'ENV_UNCONFIRMED' && /prod\.example\.com/.test(e.message));
      assert.deepEqual(posts(), [], JSON.stringify(seen));
    } finally { srv.kill(); }
  });
  test('N3: a fetch POST from an approved page to an unapproved API host is aborted: ENV_UNCONFIRMED names host and method; the server sees no POST', async () => {
    await start();
    try {
      await assert.rejects(capture('scenes:\n  - id: s\n    url: /xhr\n    actions:\n      - click: "#xpost"\n      - wait: 300\n      - click: "#go"\n'), (e) => {
        assert.equal(e.code, 'ENV_UNCONFIRMED'); assert.match(e.message, /api\.example\.org \(POST\)/); assert.match(e.message, /--confirm-env=/); return true;
      });
      assert.deepEqual(posts(), [], JSON.stringify(seen));
    } finally { srv.kill(); }
  });
  test('N3: once the user confirms that host, the same POST goes through and is counted by host and method in env.contacted / env.contactedMethods', async () => {
    await start();
    try {
      const { ws } = await capture('scenes:\n  - id: s\n    url: /xhr\n    actions:\n      - click: "#xpost"\n      - wait: 300\n      - click: "#go"\n', { confirmEnv: ['api.example.org'] });
      assert.equal(posts().length, 1);
      const env = readJson(ws, 'guide/steps.json').env;
      assert.deepEqual(env.contacted, ['127.0.0.1', 'api.example.org']);
      assert.equal(env.contactedMethods['api.example.org'].POST, 1); assert.ok(env.contactedMethods['127.0.0.1'].GET >= 1);
      assert.deepEqual(env.confirmed, ['api.example.org']);
    } finally { srv.kill(); }
  });
  test('N3: plain GET sub-resources from an unapproved host are allowed but recorded (cdn.example.org GET)', async () => {
    await start();
    try {
      const { ws } = await capture('scenes:\n  - id: s\n    url: /img\n    actions:\n      - click: "#go"\n');
      assert.ok(seen.some((x) => x.h === 'cdn.example.org' && x.m === 'GET'));
      const env = readJson(ws, 'guide/steps.json').env;
      assert.ok(env.contacted.includes('cdn.example.org')); assert.ok(env.contactedMethods['cdn.example.org'].GET >= 1); assert.deepEqual(Object.keys(env.contactedMethods['cdn.example.org']), ['GET']);
    } finally { srv.kill(); }
  });
  const PROD = (x) => x.h === 'prod.example.com';
  for (const [route, what] of [['/popup', 'window.open (a popup\'s first navigation)'], ['/blank', 'a target=_blank link'], ['/iframe', 'an <iframe src>'], ['/ws', 'a WebSocket']]) {
    test(`R3-3/R3-4: ${what} to an unapproved host is blocked before it is sent: ENV_UNCONFIRMED, the server sees nothing, no image is written`, async () => {
      await start();
      try {
        await assert.rejects(capture(`scenes:\n  - id: s\n    url: ${route}\n    actions:\n      - click: "#act"\n      - wait: 600\n      - click: "#go"\n`), (e) => {
          assert.equal(e.code, 'ENV_UNCONFIRMED'); assert.match(e.message, /prod\.example\.com/); assert.match(e.message, /--confirm-env=/);
          assert.ok(!fs.existsSync(path.join(e.ws, 'guide/images')) && !fs.existsSync(path.join(e.ws, 'guide/steps.json')));
          return true;
        });
        assert.deepEqual(seen.filter(PROD), [], `nothing reached the unapproved host: ${JSON.stringify(seen)}`);
      } finally { srv.kill(); }
    });
  }
  test('R3-3: once the user confirms the host, the same iframe loads (the gate is not simply blocking everything)', async () => {
    await start();
    try {
      await capture('scenes:\n  - id: s\n    url: /iframe\n    actions:\n      - click: "#act"\n      - wait: 600\n      - click: "#go"\n', { confirmEnv: ['prod.example.com'] });
      assert.ok(seen.some((x) => PROD(x) && x.u === '/hit'), JSON.stringify(seen));
    } finally { srv.kill(); }
  });
  test('R3-4: service workers are blocked (no /sw.js request, so no request can be made from a worker)', async () => {
    await start();
    try {
      await capture('scenes:\n  - id: s\n    url: /sw\n    actions:\n      - click: "#act"\n      - wait: 500\n      - click: "#go"\n');
      assert.ok(!seen.some((x) => x.u === '/sw.js'), JSON.stringify(seen));
      assert.deepEqual(seen.filter(PROD), []);
    } finally { srv.kill(); }
  });
  test('R4-2: SharedWorker is disabled during capture: a shared worker cannot POST to an unapproved host (its requests are invisible to context.route)', async () => {
    await start();
    try {
      await capture('scenes:\n  - id: s\n    url: /shared\n    actions:\n      - click: "#act"\n      - wait: 800\n      - click: "#go"\n');
      assert.ok(!seen.some((x) => x.u === '/wk.js'), `worker script never requested: ${JSON.stringify(seen)}`);
      assert.deepEqual(seen.filter(PROD), [], JSON.stringify(seen));
    } finally { srv.kill(); }
  });
  test('R3-4: GETs that reached an unapproved host are listed in the ENV_CONTACTED_UNAPPROVED warning (host + methods); approved hosts are not', async () => {
    await start();
    try {
      const { ws } = await capture('scenes:\n  - id: s\n    url: /img\n    actions:\n      - click: "#go"\n');
      const w = readJson(ws, 'guide/steps.json').warnings.find((x) => x.code === 'ENV_CONTACTED_UNAPPROVED');
      assert.ok(w, 'warning present'); assert.deepEqual(w.hosts.map((h) => h.host), ['cdn.example.org']); assert.equal(w.hosts[0].methods.GET, 1);
      assert.match(w.message, /cdn\.example\.org \(GET x1\)/);
      const w2 = readJson((await capture('scenes:\n  - id: s\n    url: /img\n    actions:\n      - click: "#go"\n', { confirmEnv: ['cdn.example.org'] })).ws, 'guide/steps.json').warnings;
      assert.ok(!w2.some((x) => x.code === 'ENV_CONTACTED_UNAPPROVED'));
    } finally { srv.kill(); }
  });
  test('N3: file: pages are local (contacted "file:"), a private-IP base URL needs confirmation and env.allow clears it', () => {
    const ws = fixtureCopy('sample-app'); const spec = path.join(ws, 'demo.yaml');
    const r = guide('capture', spec, ['--json']); assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readJson(ws, 'guide/steps.json').env.contacted, ['file:']);
    const p = tmpDir('guide-priv-'); const mk = (extra) => { fs.writeFileSync(path.join(p, 'demo.yaml'), SHELL('baseUrl: http://192.168.7.7:3000\nscenes:\n  - id: s\n    url: /a\n    actions:\n      - click: "#a"\n')); if (extra) fs.writeFileSync(path.join(p, 'guide.yaml'), extra); else fs.rmSync(path.join(p, 'guide.yaml'), { force: true }); return parseJson(guide('plan', path.join(p, 'demo.yaml'), ['--json'])); };
    assert.deepEqual(mk(null).env.needsConfirm, ['192.168.7.7']);
    assert.deepEqual(mk('env: { allow: [192.168.7.7] }\n').env.needsConfirm, []);
  });
});

// ------------------------------------------------------------------ R3-1 / R3-2: opaque redaction of guide stills
describe('R3-1/R3-2: masked elements are covered by an opaque box in every guide image', NEEDS_BROWSER, () => {
  const PII = 'font:700 40px monospace;color:#000;background:#fff';
  const GREY = '154,160,166'; // MASK_COLOR #9aa0a6
  const VARIANTS = {
    plain: { body: `<div class="pii" style="${PII}">JANE DOE 555</div>`, css: false },
    'page CSS filter:none !important': { body: `<style>html body div.pii{filter:none !important}</style><div class="pii" style="${PII}">JANE DOE 555</div>`, css: true },
    'inline style filter:none !important': { body: `<div class="pii" style="${PII};filter:none !important">JANE DOE 555</div>`, css: true },
    'inside an open shadow root': { body: `<div id="h" style="width:100%;height:100%"></div><script>document.getElementById('h').attachShadow({mode:'open'}).innerHTML='<div class="pii" style="${PII}">JANE DOE 555</div>'</script>`, css: true },
    'style element removed after load': { body: `<div class="pii" style="${PII}">JANE DOE 555</div><script>setTimeout(()=>document.querySelectorAll('style').forEach(s=>s.remove()),30)</script>`, css: false },
  };
  const run = (body, { extraScreens = '' } = {}) => {
    const ws = tmpDir('guide-r31-');
    fs.writeFileSync(path.join(ws, 'index.html'), `<!doctype html><html lang="en"><body style="margin:0"><div style="position:absolute;left:100px;top:160px;width:200px;height:60px;overflow:hidden">${body}</div><button id="go" type="button" style="position:absolute;left:100px;top:100px;width:120px;height:40px">Go</button></body>`);
    fs.writeFileSync(path.join(ws, 'demo.yaml'), `title: T\nviewport: { width: 1280, height: 720 }\nmask: [".pii"]\nscenes:\n  - id: s\n    url: ./index.html\n    actions:\n      - wait: 200\n      - click: "#go"\n${extraScreens}`);
    const r = guide('capture', path.join(ws, 'demo.yaml'), ['--json']);
    return { ws, r };
  };
  // distinct colours inside the 190x50 area well inside the 200x60 masked box
  const colours = (img, ox, oy) => { const set = new Set(); for (let y = 165; y < 215; y++) for (let x = 105; x < 295; x++) set.add(img.px(x - ox, y - oy).join()); return [...set]; };
  for (const [name, v] of Object.entries(VARIANTS)) {
    test(`40px masked text is one flat colour (zero variance) in the full image and in the close-up: ${name}`, async () => {
      const { ws, r } = run(v.body);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const j = readJson(ws, 'guide/steps.json'); const st = j.steps[0];
      assert.ok(st.images.closeup && st.images.clip, 'close-up exists');
      assert.deepEqual(colours(await decodePng(path.join(ws, 'guide', st.images.full)), 0, 0), [GREY], 'full');
      assert.deepEqual(colours(await decodePng(path.join(ws, 'guide', st.images.closeup)), st.images.clip.x, st.images.clip.y), [GREY], 'close-up (clip)');
      assert.equal(j.warnings.some((w) => w.code === 'MASK_CSS_DEFEATED'), v.css, name);
      assert.ok(!j.warnings.some((w) => w.code === 'MASK_UNMATCHED'), 'matches inside a shadow root count as matched');
    });
  }
  // ---- R4-1: content that paints OUTSIDE the matched element's own box (the text's actual area must be one flat colour)
  describe('R4-1: overflowing content is covered too (descendants masked, contain:paint)', () => {
    const T = PII;
    const runRaw = (body, { mask = '.pii' } = {}) => {
      const ws = tmpDir('guide-r41-');
      fs.writeFileSync(path.join(ws, 'index.html'), `<!doctype html><html lang="en"><body style="margin:0"><div style="position:absolute;left:100px;top:160px;width:600px">${body}</div><button id="go" type="button" style="position:absolute;left:100px;top:100px;width:120px;height:40px">Go</button></body>`);
      fs.writeFileSync(path.join(ws, 'demo.yaml'), `title: T\nviewport: { width: 1280, height: 720 }\nmask: ["${mask}"]\nscenes:\n  - id: s\n    url: ./index.html\n    actions:\n      - wait: 200\n      - click: "#go"\n`);
      return { ws, r: guide('capture', path.join(ws, 'demo.yaml'), ['--json']) };
    };
    // distinct colours inside [x0,x1)x[y0,y1) (page px), restricted to what the image covers; returns { set, n }
    const area = (img, ox, oy, [x0, y0, x1, y1]) => { const set = new Set(); let n = 0; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const X = x - ox; const Y = y - oy; if (X < 0 || Y < 0 || X >= img.width || Y >= img.height) continue; set.add(img.px(X, Y).join()); n++; } return { set: [...set], n }; };
    const VAR = {
      'display:contents wrapper': { html: `<div class="pii" style="display:contents"><div style="${T}">JANE DOE 555</div></div>`, box: [105, 165, 380, 200], defeated: true },
      'floated children in a height:0 container (no clearfix)': { html: `<div class="pii" style="height:0"><div style="${T};float:left">JANE DOE 555</div></div>`, box: [105, 165, 380, 200] },
      'absolutely positioned child outside the box (dropdown)': { html: `<div class="pii" style="position:relative;width:200px;height:20px"><div style="${T};position:absolute;top:30px;left:0;white-space:nowrap">JANE DOE 555</div></div>`, box: [105, 195, 380, 230] },
      'transformed child': { html: `<div class="pii" style="width:200px;height:20px"><div style="${T};transform:translate(0,60px);white-space:nowrap">JANE DOE 555</div></div>`, box: [105, 225, 295, 260], noCloseup: true },
    };
    for (const [name, v] of Object.entries(VAR)) {
      test(`40px masked text is one flat colour in the full image and the close-up: ${name}`, async () => {
        const { ws, r } = runRaw(v.html);
        assert.equal(r.status, 0, r.stdout + r.stderr);
        const j = readJson(ws, 'guide/steps.json'); const st = j.steps[0];
        const full = area(await decodePng(path.join(ws, 'guide', st.images.full)), 0, 0, v.box);
        assert.deepEqual(full.set, [GREY], 'full'); assert.ok(full.n > 5000);
        const cu = area(await decodePng(path.join(ws, 'guide', st.images.closeup)), st.images.clip.x, st.images.clip.y, v.box);
        if (!v.noCloseup) { assert.ok(cu.n > 0, 'close-up includes part of the text area'); assert.deepEqual(cu.set, [GREY], 'close-up'); } // else: the close-up crop (around the button) does not reach this text
        assert.equal(j.warnings.some((w) => w.code === 'MASK_CSS_DEFEATED'), !!v.defeated, 'display:contents is reported, the others are covered cleanly');
      });
    }
    test('text in a positioned ::after is clipped by contain:paint: nothing dark is visible outside the box (pseudo-elements cannot be masked by Playwright; the CSS layer is what hides them)', async () => {
      const { ws, r } = runRaw(`<style>.pii::after{content:"SECRET 999";position:absolute;top:40px;left:0;font:700 40px monospace;color:#000;background:#fff}</style><div class="pii" style="position:relative;width:200px;height:20px">x</div>`);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const st = readJson(ws, 'guide/steps.json').steps[0];
      const a = area(await decodePng(path.join(ws, 'guide', st.images.full)), 0, 0, [100, 200, 480, 250]);
      assert.deepEqual(a.set, ['255,255,255'], 'only the page background below the box: the ::after text is not painted'); // still uncovered if page CSS removes contain (documented limit)
    });
    test('a bare text node under a display:contents element has no box at all: fail closed (MASK_NOT_APPLIED), no image', () => {
      const { ws, r } = runRaw(`<div class="pii" style="display:contents">JANE DOE 555</div>`);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stdout + r.stderr, /MASK_NOT_APPLIED/);
      assert.ok(!fs.existsSync(path.join(ws, 'guide/images')), 'no images written');
    });
    test('R5-1: bare text next to an element child under a display:contents mask is uncovered: fail closed (MASK_NOT_APPLIED), no image', () => {
      const { ws, r } = runRaw(`<div class="pii" style="display:contents;${T}">JANE DOE <b>555</b></div>`);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stdout + r.stderr, /MASK_NOT_APPLIED/);
      assert.ok(!fs.existsSync(path.join(ws, 'guide/images')), 'no images written');
    });
    test('R5-2: a positioned ::after on an INLINE mask (contain:paint does not apply) is hidden by the pseudo-element rule', async () => {
      const { ws, r } = runRaw(`<style>.pii::after{content:"SECRET 999";position:absolute;top:60px;left:0;font:700 40px monospace;color:#000;background:#fff;white-space:nowrap}</style><span class="pii" style="position:relative">x</span>`);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const st = readJson(ws, 'guide/steps.json').steps[0];
      const a = area(await decodePng(path.join(ws, 'guide', st.images.full)), 0, 0, [100, 215, 480, 265]);
      // blurred black text leaves neutral greys around 110; with the fix the darkest neutral grey is ~200 (annotation shadow), indigo annotation pixels are not neutral
      const dark = a.set.map((c) => c.split(',').map(Number)).filter(([r, g, b]) => Math.abs(r - g) < 6 && Math.abs(g - b) < 6 && r < 170);
      assert.ok(a.n > 5000); assert.deepEqual(dark, [], 'the ::after text is not painted');
    });
    test('selectors with a comma list are descended as a whole (:is(a, b) *) and MASK_UNMATCHED counts the base selector', async () => {
      const { ws, r } = runRaw(`<div class="pii2" style="height:0"><div style="${T};float:left">JANE DOE 555</div></div>`, { mask: '.nope, .pii2' });
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const j = readJson(ws, 'guide/steps.json');
      assert.deepEqual(area(await decodePng(path.join(ws, 'guide', j.steps[0].images.full)), 0, 0, [105, 165, 380, 200]).set, [GREY]);
      assert.ok(!j.warnings.some((w) => w.code === 'MASK_UNMATCHED'));
    });
    test('R4-1/review: a same-origin iframe: masked 40px text inside the frame is one flat colour (child-frame locators are part of the mask; counts add up across frames)', async () => {
      const inner = `<!doctype html><body style="margin:0"><div class="pii" style="${T}">JANE DOE 555</div>`.replace(/"/g, '&quot;');
      const { ws, r } = runRaw(`<iframe srcdoc="${inner}" style="border:0;width:500px;height:100px"></iframe>`);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const j = readJson(ws, 'guide/steps.json');
      assert.ok(!j.warnings.some((w) => w.code === 'MASK_UNMATCHED'), 'a match only inside the iframe counts as matched');
      const box = [260, 163, 380, 176]; // upper strip of the text area, right of the step callout/arrow
      const full = area(await decodePng(path.join(ws, 'guide', j.steps[0].images.full)), 0, 0, box);
      assert.deepEqual(full.set, [GREY], 'full'); assert.ok(full.n > 1000);
      const cu = area(await decodePng(path.join(ws, 'guide', j.steps[0].images.closeup)), j.steps[0].images.clip.x, j.steps[0].images.clip.y, box);
      assert.ok(cu.n > 0); assert.deepEqual(cu.set, [GREY], 'close-up');
    });
  });
  test('the CSS layer is re-attached when the page removed it (no MASK_CSS_DEFEATED); a defeated one is reported with selector and step', () => {
    const { ws, r } = run(VARIANTS['page CSS filter:none !important'].body);
    assert.equal(r.status, 0, r.stderr);
    const w = readJson(ws, 'guide/steps.json').warnings.find((x) => x.code === 'MASK_CSS_DEFEATED');
    assert.deepEqual(w.selectors, ['.pii']); assert.deepEqual(w.steps, [1]); assert.match(w.message, /opaque boxes still cover/);
  });
  test('an error screenshot of a failing step also has the opaque boxes', async () => {
    const { ws, r } = run(VARIANTS.plain.body, { extraScreens: '      - click: { selector: "#missing", timeout: 500 }\n' });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    const shot = ls(path.join(ws, 'guide/errors')).find((f) => f.endsWith('.png'));
    assert.ok(shot, 'error screenshot written');
    assert.deepEqual(colours(await decodePng(path.join(ws, 'guide/errors', shot)), 0, 0), [GREY]);
  });
  test('a mask selector Playwright cannot resolve fails closed with MASK_NOT_APPLIED (maskLocators, used before every shot)', async () => {
    const { maskLocators } = await import(LIB('selectors.mjs')); const { chromium } = (await import(LIB('util.mjs'))).requireModule('playwright');
    const b = await chromium.launch();
    try {
      const page = await b.newPage();
      await assert.rejects(maskLocators(page, ['.ok', 'div:nth-child(']), (e) => e.code === 'MASK_NOT_APPLIED' && /No image was written/.test(e.message));
      assert.deepEqual((await maskLocators(page, ['.ok', '#a'])).counts, [0, 0]);
    } finally { await b.close(); }
  });
});

// ------------------------------------------------------------------ promote robustness, JSON failures, malformed steps.json
describe('promote is robust', NEEDS_BROWSER, () => {
  test('a sub-folder and a stray file in images/ are kept (no EISDIR); no images.new/images.old/.staging left', () => {
    const ws = fixtureCopy('sample-app'); const spec = path.join(ws, 'demo.yaml');
    assert.equal(guide('capture', spec, ['--json']).status, 0);
    fs.mkdirSync(path.join(ws, 'guide/images/mine'), { recursive: true }); fs.writeFileSync(path.join(ws, 'guide/images/mine/pic.png'), 'x'); fs.writeFileSync(path.join(ws, 'guide/images/note.txt'), 'n');
    const r = guide('capture', spec, ['--json']);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(path.join(ws, 'guide/images/mine/pic.png')) && fs.existsSync(path.join(ws, 'guide/images/note.txt')));
    assert.ok(parseJson(r).warnings.some((w) => w.code === 'USER_IMAGES_KEPT'));
    for (const x of ['images.new', 'images.old', '.staging']) assert.ok(!fs.existsSync(path.join(ws, 'guide', x)), x);
  });
  test('a failure while staging leaves the previous images, steps.json and skeleton untouched and cleans up', () => {
    const ws = fixtureCopy('sample-app'); const spec = path.join(ws, 'demo.yaml'); const g = (...p) => path.join(ws, 'guide', ...p);
    assert.equal(guide('capture', spec, ['--json']).status, 0);
    fs.rmSync(g('guide.skeleton.md')); fs.mkdirSync(g('guide.skeleton.md')); // cannot be read/replaced as a file
    const before = snapshot(g(), ['guide.skeleton.md']);
    const r = guide('capture', spec, ['--json']);
    assert.equal(r.status, 1); assert.equal(parseJson(r).ok, false);
    assert.deepEqual(snapshot(g(), ['guide.skeleton.md']), before);
    for (const x of ['images.new', 'images.old', '.staging']) assert.ok(!fs.existsSync(g(x)), x);
  });
});

describe('malformed steps.json and --json failures (no browser)', () => {
  test('render / refresh / approve on a steps.json without a plan: DemoError JSON, not a crash', () => {
    const ws = fixtureCopy('sample-app'); const spec = path.join(ws, 'demo.yaml');
    fs.mkdirSync(path.join(ws, 'guide')); fs.writeFileSync(path.join(ws, 'guide/steps.json'), '{"steps": []}'); fs.writeFileSync(path.join(ws, 'guide/guide.md'), '# T\n');
    for (const sub of ['render', 'refresh']) {
      const r = guide(sub, spec, ['--json']); assert.equal(r.status, 1, sub);
      const j = parseJson(r); assert.equal(j.ok, false); assert.equal(j.code, 'NO_CAPTURE', sub);
    }
    fs.writeFileSync(path.join(ws, 'guide/render.json'), '{}'); fs.writeFileSync(path.join(ws, 'guide/guide-draft.pdf'), 'x');
    const r = guide('approve', spec, ['--json']); assert.equal(r.status, 1); assert.equal(parseJson(r).ok, false);
  });
  test('unterminated "<!--" in guide.md: render exits 1 with UNCLOSED_COMMENT and writes nothing', () => {
    const ws = fixtureCopy('sample-app'); const spec = path.join(ws, 'demo.yaml');
    fs.mkdirSync(path.join(ws, 'guide'));
    fs.writeFileSync(path.join(ws, 'guide/steps.json'), JSON.stringify({ plan: { signature: 'x', steps: [] }, steps: [], task: { title: 'T' }, warnings: [] }));
    fs.writeFileSync(path.join(ws, 'guide/guide.md'), '# Guide\n\n<!-- oops, never closed\n\n## Goal\nText.\n');
    const r = guide('render', spec, ['--json']);
    assert.equal(r.status, 1, r.stderr);
    const e = parseJson(r).findings.errors.find((x) => x.code === 'UNCLOSED_COMMENT');
    assert.ok(e, 'UNCLOSED_COMMENT'); assert.equal(e.line, 3);
    for (const f of ['guide.html', 'guide-draft.pdf', 'render.json']) assert.ok(!fs.existsSync(path.join(ws, 'guide', f)), f);
  });
});

describe('guideCli --json failure document', () => {
  test('any Error (not only DemoError) prints {ok:false, code, error}; non-DemoError gets code INTERNAL', async () => {
    const G = await import(LIB('guide.mjs')); const { logState, DemoError } = await import(LIB('util.mjs'));
    const wasStderr = logState.stderr; const orig = console.log; let out = '';
    console.log = (...a) => { out += a.join(' '); };
    try {
      await assert.rejects(G.guideCli('plan', () => { throw new TypeError('boom'); }, { json: true }), TypeError);
      let j = JSON.parse(out); assert.deepEqual(j, { ok: false, code: 'INTERNAL', error: 'boom' });
      out = '';
      await assert.rejects(G.guideCli('plan', () => { throw new DemoError('Spec not found: x'); }, { json: true }), DemoError);
      j = JSON.parse(out); assert.equal(j.code, 'SPEC_NOT_FOUND'); assert.equal(j.ok, false);
      out = '';
      await assert.rejects(G.guideCli('plan', () => { throw 'plain string'; }, { json: true }));
      j = JSON.parse(out); assert.equal(j.code, 'INTERNAL'); assert.equal(j.error, 'plain string');
      out = '';
      await assert.rejects(G.guideCli('plan', () => { throw new TypeError('x'); }, {}));
      assert.equal(out, '', 'no JSON document without --json');
    } finally { console.log = orig; logState.stderr = wasStderr; }
  });
});

// ------------------------------------------------------------------ prepareSession
describe('prepareSession (record.mjs)', NEEDS_BROWSER, () => {
  const PAGE = '<!doctype html><title>S</title><button id="b" onclick="localStorage.setItem(\'k\',\'v\');document.cookie=\'a=1\'">go</button>';
  const mk = async (setup) => mkSpec(SHELL(`auth: { save: auth.json }\nsetup:\n${setup}scenes:\n  - id: s\n    url: ./index.html\n    actions:\n      - click: "#b"\n`), null, { 'index.html': PAGE });
  const run = async (spec, opts) => {
    const { requireModule } = await import(LIB('util.mjs')); const { prepareSession } = await import(LIB('record.mjs'));
    const browser = await requireModule('playwright').chromium.launch();
    try { return await prepareSession(browser, spec, { viewport: spec.viewport }, opts); } finally { await browser.close(); }
  };
  test('default: runs setup and saves auth.save; the returned storageState has the data', async () => {
    const spec = await mk('  - goto: ./index.html\n  - click: "#b"\n');
    const st = await run(spec, {});
    assert.ok(fs.existsSync(spec.abs('auth.json')), 'auth.json written by default');
    assert.ok(Array.isArray(st.cookies) && Array.isArray(st.origins));
    assert.deepEqual(JSON.parse(fs.readFileSync(spec.abs('auth.json'), 'utf8')).origins, st.origins);
  });
  test('save:false never writes auth.save', async () => {
    const spec = await mk('  - goto: ./index.html\n  - click: "#b"\n');
    const st = await run(spec, { save: false });
    assert.ok(!fs.existsSync(spec.abs('auth.json'))); assert.ok(st && Array.isArray(st.cookies));
  });
  test('no setup: returns the existing storageState path (or undefined) and writes nothing', async () => {
    const spec = await mkSpec(SHELL('scenes:\n  - id: s\n    url: ./index.html\n    actions:\n      - click: "#b"\n'), null, { 'index.html': PAGE });
    assert.equal(await run(spec, {}), undefined);
  });
  test('errorDir: a failing setup action screenshots into errorDir; without it, into recordings/', async () => {
    const spec = await mk('  - goto: ./index.html\n  - click: { selector: "#nope", timeout: 400 }\n');
    const errorDir = path.join(tmpDir('guide-err-'), 'errors');
    await assert.rejects(run(spec, { errorDir, save: false }), /setup action #1/);
    assert.ok(fs.existsSync(path.join(errorDir, 'error-setup-1.png')), ls(errorDir).join());
    assert.ok(!fs.existsSync(spec.dirs.recordings), 'recordings/ untouched when errorDir is given');
    await assert.rejects(run(spec, { save: false }), /setup action #1/);
    assert.ok(fs.existsSync(path.join(spec.dirs.recordings, 'error-setup-1.png')));
  });
  test('onContext receives the setup context before any page opens', async () => {
    const spec = await mk('  - goto: ./index.html\n');
    let seen = 0; let pagesAtCall = -1;
    await run(spec, { save: false, onContext: (c) => { seen++; pagesAtCall = c.pages().length; } });
    assert.equal(seen, 1); assert.equal(pagesAtCall, 0);
  });
});
