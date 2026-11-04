// Record screen scenes with Playwright, paced by the narration audio.
import fs from 'node:fs';
import path from 'node:path';
import { requireModule, ensureDir, readJson, writeJson, log, fail, sleep, DemoError } from './util.mjs';
import { estimateSeconds, selectScenes } from './spec.mjs';
import { overlayInit } from './overlay.mjs';
import { renderCards } from './cards.mjs';

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function resolveUrl(spec, url) {
  if (!url) return url;
  if (/^[a-z]+:/i.test(url)) return url;
  if (url.startsWith('file:') || !spec.baseUrl) return /^\.{0,2}\//.test(url) && fs.existsSync(spec.abs(url)) ? `file://${spec.abs(url)}` : url;
  return new URL(url, spec.baseUrl.endsWith('/') ? spec.baseUrl : `${spec.baseUrl}/`).href;
}

export function sceneNeed(spec, scene, manifest) {
  const audio = manifest[scene.id];
  const dur = audio ? audio.duration : (scene.narration ? estimateSeconds(scene.narration, spec.language) : 0);
  const delay = scene.audioDelay ?? spec.timing.audioDelay;
  const tail = scene.tail ?? spec.timing.tail;
  return { audio: dur, need: Math.max(scene.minDuration || 0, dur ? delay + dur + tail : 0), estimated: !audio && !!dur };
}

class Director {
  constructor(page, spec, { dry }) {
    this.page = page; this.spec = spec; this.dry = dry; this.t = spec.timing;
    this.mouse = { x: spec.viewport.width / 2, y: spec.viewport.height / 2 };
    this.sceneStart = Date.now();
  }
  elapsed() { return (Date.now() - this.sceneStart) / 1000; }
  async overlay(fn, ...args) {
    try { await this.page.evaluate(([f, a]) => window.__demo && window.__demo[f](...a), [fn, args]); } catch { /* page navigating */ }
  }
  async moveTo(x, y, ms) {
    const from = { ...this.mouse };
    const dist = Math.hypot(x - from.x, y - from.y);
    const dur = this.dry ? 0 : (ms ?? Math.min(this.t.moveMs, 220 + dist * 0.55));
    const steps = Math.max(1, Math.round(dur / 16));
    for (let i = 1; i <= steps; i++) {
      const k = ease(i / steps);
      await this.page.mouse.move(from.x + (x - from.x) * k, from.y + (y - from.y) * k);
      if (!this.dry) await sleep(dur / steps);
    }
    this.mouse = { x, y };
  }
  locator(sel, a) {
    if (!sel) fail(`action "${a.name}" needs a selector`);
    const loc = this.page.locator(sel);
    return a.nth !== undefined ? loc.nth(a.nth) : loc.first();
  }
  async box(loc, a) {
    await loc.waitFor({ state: 'visible', timeout: a.timeout ?? 15000 });
    let b = await loc.boundingBox();
    const vp = this.page.viewportSize();
    if (!b || b.y < 0 || b.y + b.height > vp.height || b.x < 0 || b.x + b.width > vp.width) {
      await loc.evaluate((el, smooth) => el.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center', inline: 'center' }), !this.dry);
      await sleep(this.dry ? 50 : 800);
      b = await loc.boundingBox();
    }
    if (!b) fail(`element has no bounding box`);
    return b;
  }
  async pointAt(a) {
    const loc = this.locator(a.selector, a);
    const b = await this.box(loc, a);
    const x = b.x + b.width * (a.offsetX ?? 0.5); const y = b.y + b.height * (a.offsetY ?? 0.5);
    if (a.move !== false) await this.moveTo(x, y, a.moveMs);
    return { loc, b, x, y };
  }
  async gap(a) { await sleep(this.dry ? 30 : (a.gap ?? this.t.actionGap)); }

  async goto(url, a = {}) {
    await this.page.goto(resolveUrl(this.spec, url), { waitUntil: a.waitUntil || 'load', timeout: a.timeout ?? 45000 });
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await this.overlay('move', this.mouse.x, this.mouse.y);
  }

  async act(a) {
    const p = this.page; const t = this.t;
    switch (a.name) {
      case 'goto': await this.goto(a.url, a); break;
      case 'reload': await p.reload(); await this.overlay('move', this.mouse.x, this.mouse.y); break;
      case 'click': case 'dblclick': {
        const { loc, x, y } = await this.pointAt(a);
        if (!this.dry) await sleep(120);
        await this.overlay('ripple', x, y);
        await (a.name === 'click' ? loc.click({ timeout: a.timeout ?? 15000, force: a.force }) : loc.dblclick({ timeout: a.timeout ?? 15000 }));
        break;
      }
      case 'hover': { const { loc } = await this.pointAt(a); await loc.hover(); if (!this.dry) await sleep(a.ms ?? 500); break; }
      case 'moveTo':
        if (a.selector) await this.pointAt(a); else await this.moveTo(a.x ?? this.mouse.x, a.y ?? this.mouse.y, a.ms);
        break;
      case 'type': {
        const { loc, x, y } = await this.pointAt(a);
        await this.overlay('ripple', x, y);
        await loc.click();
        if (a.clear !== false) await loc.fill('');
        await p.keyboard.type(String(a.text), { delay: this.dry ? 0 : (a.delay ?? t.typeDelay) });
        if (a.enter) await p.keyboard.press('Enter');
        break;
      }
      case 'fill': { const { loc, x, y } = await this.pointAt(a); await this.overlay('ripple', x, y); await loc.fill(String(a.text ?? '')); break; }
      case 'press': await p.keyboard.press(a.key); break;
      case 'select': { const { loc, x, y } = await this.pointAt(a); await this.overlay('ripple', x, y); await loc.selectOption(a.value ?? a.label ?? a.option); break; }
      case 'check': case 'uncheck': { const { loc, x, y } = await this.pointAt(a); await this.overlay('ripple', x, y); await loc[a.name](); break; }
      case 'upload': { const loc = this.locator(a.selector, a); const files = [].concat(a.files || a.file).map((f) => this.spec.abs(f)); await loc.setInputFiles(files); break; }
      case 'scroll': {
        const smooth = this.dry ? 'auto' : 'smooth';
        if (a.selector) await this.locator(a.selector, a).evaluate((el, b) => el.scrollIntoView({ behavior: b, block: 'center' }), smooth);
        else if (a.to === 'top' || a.to === 'bottom') await p.evaluate(([to, b]) => window.scrollTo({ top: to === 'top' ? 0 : document.body.scrollHeight, behavior: b }), [a.to, smooth]);
        else await p.evaluate(([y, b]) => window.scrollBy({ top: y, behavior: b }), [a.y ?? a.by ?? 400, smooth]);
        await sleep(this.dry ? 50 : (a.ms ?? 900));
        break;
      }
      case 'wait': if (!this.dry) await sleep(Number(a.ms ?? 1000)); break;
      case 'waitFor': await this.locator(a.selector, a).waitFor({ state: a.state || 'visible', timeout: a.timeout ?? 20000 }); break;
      case 'waitForUrl': await p.waitForURL(a.url.includes('*') ? a.url : (u) => u.href.includes(a.url), { timeout: a.timeout ?? 20000 }); break;
      case 'highlight': case 'callout': case 'spotlight': {
        const loc = this.locator(a.selector, a); const b = await this.box(loc, a);
        if (a.move) await this.moveTo(b.x + b.width / 2, b.y + b.height / 2);
        const style = a.name === 'spotlight' || a.style === 'spot' ? 'spot' : 'glow';
        await this.overlay('highlight', b, { label: a.label ?? a.text, style, padding: a.padding, position: a.position });
        if (!a.hold) { if (!this.dry) await sleep(a.ms ?? t.highlightMs); await this.overlay('clear'); }
        break;
      }
      case 'clear': await this.overlay('clear'); break;
      case 'zoom': {
        let rect = null;
        if (a.selector) rect = await this.box(this.locator(a.selector, a), a);
        const ms = a.ms ?? 700;
        await this.overlay('zoom', rect, a.scale ?? 1.6, this.dry ? 0 : ms);
        if (!this.dry) await sleep(ms + 100);
        if (a.hold) { if (!this.dry) await sleep(Number(a.hold) * 1000); await this.overlay('unzoom', this.dry ? 0 : ms); if (!this.dry) await sleep(ms); }
        break;
      }
      case 'unzoom': { const ms = a.ms ?? 600; await this.overlay('unzoom', this.dry ? 0 : ms); if (!this.dry) await sleep(ms + 50); break; }
      case 'at': {
        if (this.dry) break;
        const wait = Number(a.seconds) - this.elapsed();
        if (wait > 0) await sleep(wait * 1000);
        else if (wait < -0.5) log('warn', `  "at: ${a.seconds}" reached late by ${(-wait).toFixed(1)}s — actions before it take longer than planned`);
        return; // no gap after a sync point
      }
      case 'caption': await this.overlay('caption', a.text || ''); break;
      case 'screenshot': { const f = this.spec.abs(a.path || `review/shot-${Date.now()}.png`); ensureDir(path.dirname(f)); await p.screenshot({ path: f }); break; }
      case 'evaluate': await p.evaluate(a.script); break;
      default: fail(`Unsupported action ${a.name}`);
    }
    await this.gap(a);
  }

  async runActions(actions, label) {
    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];
      try { await this.act(a); } catch (e) {
        const shot = path.join(this.spec.dirs.recordings, `error-${label.replace(/[^\w-]/g, '_')}-${i}.png`);
        await this.page.screenshot({ path: shot }).catch(() => {});
        throw new DemoError(`${label} action #${i} (${a.name} ${a.selector || a.url || a.key || ''}) failed on ${this.page.url()}\n  ${String(e.message).split('\n')[0]}\n  screenshot: ${shot}\n  tip: ${this.page.url() === 'about:blank' ? 'the page is blank — give this scene a "url:" or set baseUrl' : `node demo.mjs inspect "${this.page.url()}" to list selectors`}`);
      }
    }
  }
}

export async function record(spec, { scenes: sceneFlag, headed = false, dry = false } = {}) {
  const { chromium } = requireModule('playwright');
  ensureDir(spec.dirs.recordings);
  const manifest = readJson(path.join(spec.dirs.audio, 'manifest.json'), {});
  const timelineFile = path.join(spec.dirs.recordings, 'timeline.json');
  const timeline = readJson(timelineFile, { scenes: {} });
  const selected = selectScenes(spec, sceneFlag);
  const screens = selected.filter((s) => s.type === 'screen');

  const browser = await chromium.launch({ headless: !(headed || spec.headless === false), args: ['--hide-scrollbars', '--disable-blink-features=AutomationControlled'] });
  try {
    if (!dry) await renderCards(spec, { browser, only: selected.map((s) => s.id) });
    if (!screens.length) { log('info', 'No screen scenes selected.'); return timeline; }

    for (const s of screens) {
      const n = sceneNeed(spec, s, manifest);
      if (n.estimated && !dry) log('warn', `${s.id}: no voice-over yet — pacing with an estimate of ${n.audio.toFixed(1)}s (run "tts" first for exact sync)`);
    }

    const ctxOpts = {
      viewport: spec.viewport, deviceScaleFactor: 1, locale: spec.locale || spec.language, colorScheme: spec.colorScheme || 'light',
      timezoneId: spec.timezone, ignoreHTTPSErrors: !!spec.ignoreHTTPSErrors,
    };
    let storageState = spec.auth?.storageState && fs.existsSync(spec.abs(spec.auth.storageState)) ? spec.abs(spec.auth.storageState) : undefined;
    if (spec.setup.length) {
      log('info', `setup: ${spec.setup.length} off-camera action(s)`);
      const sctx = await browser.newContext({ ...ctxOpts, storageState });
      const spage = await sctx.newPage();
      const d = new Director(spage, spec, { dry: true });
      if (spec.baseUrl && spec.setup[0].name !== 'goto') await d.goto(spec.baseUrl);
      await d.runActions(spec.setup, 'setup');
      storageState = await sctx.storageState();
      if (spec.auth?.save) writeJson(spec.abs(spec.auth.save), storageState);
      await sctx.close();
    }

    const tmpDir = ensureDir(path.join(spec.dirs.recordings, '.tmp'));
    const ctx = await browser.newContext({ ...ctxOpts, storageState, ...(dry ? {} : { recordVideo: { dir: tmpDir, size: spec.viewport } }) });
    await ctx.addInitScript(overlayInit, {
      cursor: spec.cursor, mask: spec.mask, hide: spec.hide, primary: spec.brand.primary, font: spec.brand.font, hideScrollbars: spec.hideScrollbars !== false,
    });
    const page = await ctx.newPage();
    const t0 = Date.now();
    const d = new Director(page, spec, { dry });
    const results = {};

    // Pre-roll (cut later): bring the app into the state the first selected scene expects.
    const first = screens[0];
    const all = spec.scenes.filter((s) => s.type === 'screen');
    let warmup = [];
    if (!first.url && first.actions[0]?.name !== 'goto') {
      const idx = all.indexOf(first);
      let from = idx - 1;
      while (from > 0 && !all[from].url) from--;
      warmup = from >= 0 ? all.slice(from, idx) : [];
    }
    const firstUrl = warmup.length ? (warmup[0].url || spec.baseUrl) : (first.url || (first.actions[0]?.name === 'goto' ? null : spec.baseUrl));
    if (firstUrl) await d.goto(firstUrl);
    if (warmup.length) {
      log('info', `warm-up (not in the cut): replaying ${warmup.map((w) => w.id).join(', ')} so "${first.id}" starts in the right state`);
      d.dry = true;
      for (const w of warmup) { if (w.url && w !== warmup[0]) await d.goto(w.url); await d.runActions(w.actions, `warm-up "${w.id}"`); }
      d.dry = dry;
    } else if (!firstUrl) log('warn', `"${first.id}" has no url and there is no baseUrl — starting from a blank page`);
    await d.moveTo(spec.viewport.width * 0.6, spec.viewport.height * 0.55, 0);
    if (!dry) await sleep(600);

    for (const s of screens) {
      const n = sceneNeed(spec, s, manifest);
      d.sceneStart = Date.now();
      const start = (d.sceneStart - t0) / 1000;
      log('info', `● ${s.id}${dry ? ' (dry run)' : ''}: ${s.actions.length} action(s), narration ${n.audio.toFixed(1)}s`);
      if (s.url && !(s === first && !warmup.length && firstUrl === s.url)) await d.goto(s.url);
      await d.runActions(s.actions, `scene "${s.id}"`);
      if (!dry) {
        const wait = n.need - d.elapsed();
        if (wait > 0) await sleep(wait * 1000);
        else if (n.need && wait < -1.5) log('warn', `  ${s.id}: actions run ${(-wait).toFixed(1)}s longer than the narration — expect silence; add narration or speed up actions`);
        await d.overlay('clear');
      }
      const end = (Date.now() - t0) / 1000;
      results[s.id] = { start: +start.toFixed(3), end: +end.toFixed(3), need: +n.need.toFixed(3), audioEstimated: n.estimated, audioHash: manifest[s.id]?.hash || null };
    }
    if (!dry) await sleep(400);
    const video = page.video();
    await ctx.close();
    if (dry) { log('ok', `Dry run passed for ${screens.length} scene(s) — selectors and flow work.`); return timeline; }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const takeFile = path.join(spec.dirs.recordings, `take-${stamp}.webm`);
    await video.saveAs(takeFile);
    await video.delete().catch(() => {});
    for (const [id, r] of Object.entries(results)) timeline.scenes[id] = { file: path.basename(takeFile), ...r, recordedAt: new Date().toISOString() };
    timeline.viewport = spec.viewport;
    writeJson(timelineFile, timeline);
    log('ok', `Recorded ${screens.length} scene(s) → ${path.relative(process.cwd(), takeFile)}`);
    return timeline;
  } finally {
    await browser.close();
  }
}

/** List interactive elements + a screenshot so an agent can pick robust selectors. */
export async function inspect(url, { out, storageState, viewport = { width: 1440, height: 900 }, spec } = {}) {
  const { chromium } = requireModule('playwright');
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport, storageState: storageState && fs.existsSync(storageState) ? storageState : undefined });
    const page = await ctx.newPage();
    const target = spec ? resolveUrl(spec, url) : url;
    await page.goto(target, { waitUntil: 'load', timeout: 45000 });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    ensureDir(out);
    const shot = path.join(out, 'page.png');
    await page.screenshot({ path: shot, fullPage: false });
    const elements = await page.evaluate(() => {
      const q = 'a,button,input,select,textarea,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[contenteditable=true],[data-testid],[data-test],[data-cy]';
      const css = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s);
      const seen = new Set(); const rows = [];
      for (const el of document.querySelectorAll(q)) {
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        const st = getComputedStyle(el); if (st.visibility === 'hidden' || st.display === 'none') continue;
        const tag = el.tagName.toLowerCase();
        const text = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 60);
        const tid = el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-cy');
        let sel;
        if (tid) sel = `[data-${el.hasAttribute('data-testid') ? 'testid' : el.hasAttribute('data-test') ? 'test' : 'cy'}="${tid}"]`;
        else if (el.id && !/\d{3,}/.test(el.id)) sel = `#${css(el.id)}`;
        else if (el.getAttribute('name')) sel = `${tag}[name="${el.getAttribute('name')}"]`;
        else if (el.getAttribute('aria-label')) sel = `${tag}[aria-label="${el.getAttribute('aria-label')}"]`;
        else if (el.getAttribute('placeholder')) sel = `${tag}[placeholder="${el.getAttribute('placeholder')}"]`;
        else if (text && ['a', 'button'].includes(tag)) sel = `${tag}:has-text("${text.replace(/"/g, '\\"')}")`;
        else if (text) sel = `text=${text}`;
        else continue;
        if (seen.has(sel)) continue; seen.add(sel);
        rows.push({ tag, text, selector: sel, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), inViewport: r.top < innerHeight && r.bottom > 0 });
      }
      return { title: document.title, url: location.href, rows };
    });
    const md = [`# ${elements.title}`, `URL: ${elements.url}`, `Screenshot: ${shot}`, '', '| # | tag | text | selector | x,y | in view |', '|---|---|---|---|---|---|',
      ...elements.rows.map((r, i) => `| ${i + 1} | ${r.tag} | ${r.text.replace(/\|/g, '\\|')} | \`${r.selector.replace(/\|/g, '\\|')}\` | ${r.x},${r.y} | ${r.inViewport ? 'yes' : 'no'} |`)].join('\n');
    fs.writeFileSync(path.join(out, 'elements.md'), md + '\n');
    writeJson(path.join(out, 'elements.json'), elements);
    return { shot, count: elements.rows.length, md: path.join(out, 'elements.md') };
  } finally { await browser.close(); }
}
