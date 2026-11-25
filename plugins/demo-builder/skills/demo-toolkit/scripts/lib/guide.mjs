// User guide generation: plan -> capture annotated screenshots -> skeleton -> render PDF -> refresh/approve.
// Deterministic part of the guide pipeline; the agent only writes prose into guide.md (see ADR-0001..0005).
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { requireModule, resolveModule, ensureDir, readJson, writeJson, hash, fileToDataUri, log, logState, sleep, DemoError } from './util.mjs';
import { loadYaml } from './spec.mjs';
import { Director, prepareSession } from './record.mjs';
import { overlayInit, guideAnnotate, guideClear } from './overlay.mjs';
import { assertMaskSelectors, maskLocators, redactedScreenshot } from './selectors.mjs';
import { MANUAL_VERB, annotationLabel, stepTemplate, skeletonMarkdown, parseStepBlocks, scanImages, findUnclosedComment, mdToHtml, printHtml, contactSheetHtml } from './guide-md.mjs';

export const STEP_ACTIONS = new Set(['click', 'dblclick', 'type', 'fill', 'select', 'check', 'uncheck', 'upload', 'press']);
export const VISUAL_ONLY = new Set(['highlight', 'spotlight', 'callout', 'clear', 'zoom', 'unzoom', 'caption', 'at', 'screenshot']);
export const GUIDE_SUBS = ['plan', 'capture', 'render', 'refresh', 'approve'];
const AFTER_CAPTURE = new Set(['goto', 'reload', 'waitForUrl']); // no element to point at before the action: capture the result
const MAX_STEPS = 12;

const TOP_KEYS = ['version', 'locale', 'title', 'goal', 'prerequisites', 'signIn', 'expectedResult', 'scenes', 'steps', 'manual', 'mask', 'hide', 'env', 'capture', 'pdf'];
const OVERRIDE_KEYS = ['include', 'skip', 'title', 'text', 'note', 'warning', 'label', 'value'];
const MANUAL_KEYS = ['id', 'after', 'before', 'selector', 'nth', 'verb', 'title', 'text', 'note', 'warning', 'label'];
const MANUAL_VERBS = Object.keys(MANUAL_VERB);
const CAPTURE_DEFAULTS = { padding: 48, closeupMin: { width: 360, height: 200 }, settleMs: 1500, timeout: 15000, parkMouse: false, freshSession: false };
const ID_RE = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

function guideFail(code, msg) { const e = new DemoError(msg); e.code = code; throw e; }
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const fileSha = (f) => sha256(fs.readFileSync(f));
const rmrf = (p) => fs.rmSync(p, { recursive: true, force: true });
const rel = (p) => path.relative(process.cwd(), p) || p;

export function guideDir(spec) { return spec.abs('guide'); }
const gpath = (spec, ...p) => path.join(guideDir(spec), ...p);

// ---------- config (guide.yaml) ----------
/** "add-contact.3" -> { scene, index:3 }; "add-contact.save" -> { scene, guideId:'save' }; null when malformed. */
export function parseRef(ref) {
  const s = String(ref);
  const dot = s.indexOf('.');
  if (dot < 1 || dot === s.length - 1) return null;
  const scene = s.slice(0, dot); const rest = s.slice(dot + 1);
  if (/^\d+$/.test(rest)) return { scene, index: Number(rest) };
  return ID_RE.test(rest) ? { scene, guideId: rest } : null;
}

function resolveRef(spec, ref) {
  const p = parseRef(ref);
  if (!p) return { error: `"${ref}": not a step reference (expected <scene>.<n> or <scene>.<guideId>)` };
  const scene = spec.scenes.find((s) => s.id === p.scene);
  if (!scene) return { error: `"${ref}": scene "${p.scene}" does not exist` };
  if (scene.type !== 'screen') return { error: `"${ref}": scene "${p.scene}" is a card and has no steps` };
  if (p.guideId) {
    const hits = scene.actions.map((a, i) => (a.guideId === p.guideId ? i + 1 : 0)).filter(Boolean);
    if (!hits.length) return { error: `"${ref}": no action with guideId "${p.guideId}" in scene "${p.scene}"` };
    if (hits.length > 1) return { error: `"${ref}": guideId "${p.guideId}" is used ${hits.length} times in scene "${p.scene}"` };
    return { scene, index: hits[0], action: scene.actions[hits[0] - 1], guideId: p.guideId };
  }
  if (p.index < 1 || p.index > scene.actions.length) return { error: `"${ref}": action #${p.index} is out of range (scene "${p.scene}" has ${scene.actions.length})` };
  return { scene, index: p.index, action: scene.actions[p.index - 1], guideId: scene.actions[p.index - 1].guideId || null };
}

/** Load + validate <spec dir>/guide.yaml (optional). Returns a new object; never mutates `spec`. Throws listing every problem. */
export function loadGuideConfig(spec) {
  const file = spec.abs('guide.yaml');
  let raw = {};
  const errs = [];
  if (fs.existsSync(file)) {
    raw = loadYaml(fs.readFileSync(file, 'utf8'), file) ?? {};
    if (typeof raw !== 'object' || Array.isArray(raw)) guideFail('CONFIG_INVALID', `${file} must be a mapping`);
  }
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const strArr = (v, name) => { if (v === undefined) return []; if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) { errs.push(`${name} must be a list of strings`); return []; } return v; };
  for (const k of Object.keys(raw)) if (!TOP_KEYS.includes(k)) errs.push(`unknown key "${k}" (known: ${TOP_KEYS.join(', ')})`);
  if (raw.version !== undefined && raw.version !== 1) errs.push(`version must be 1, got ${JSON.stringify(raw.version)}`);
  const locale = raw.locale ?? 'en-US';
  if (typeof locale !== 'string' || !/^[A-Za-z]{2,3}([-_][A-Za-z0-9]+)*$/.test(locale)) errs.push(`locale "${locale}" is not a BCP-47 tag`);
  for (const k of ['title', 'goal', 'expectedResult']) if (raw[k] !== undefined && typeof raw[k] !== 'string') errs.push(`${k} must be a string`);

  const screens = spec.scenes.filter((s) => s.type === 'screen');
  for (const s of screens) {
    const seen = new Set();
    for (const a of s.actions) if (a.guideId !== undefined) {
      if (!ID_RE.test(String(a.guideId))) errs.push(`scene "${s.id}": guideId "${a.guideId}" must start with a letter ([A-Za-z][A-Za-z0-9_-]*)`);
      if (seen.has(a.guideId)) errs.push(`scene "${s.id}": guideId "${a.guideId}" is used more than once`);
      seen.add(a.guideId);
    }
  }
  let scenes = screens.map((s) => s.id);
  if (raw.scenes !== undefined) {
    scenes = strArr(raw.scenes, 'scenes');
    for (const id of scenes) {
      const sc = spec.scenes.find((s) => s.id === id);
      if (!sc) errs.push(`scenes: "${id}" does not exist`); else if (sc.type !== 'screen') errs.push(`scenes: "${id}" is a card`);
    }
  }

  const overrides = {}; // canonical "<scene>.<index>" -> override
  if (raw.steps !== undefined && !isObj(raw.steps)) errs.push('steps must be a mapping of <ref> -> overrides');
  for (const [ref, ov] of Object.entries(isObj(raw.steps) ? raw.steps : {})) {
    const r = resolveRef(spec, ref);
    if (r.error) { errs.push(`steps.${r.error}`); continue; }
    if (!isObj(ov)) { errs.push(`steps."${ref}" must be a mapping`); continue; }
    for (const k of Object.keys(ov)) if (!OVERRIDE_KEYS.includes(k)) errs.push(`steps."${ref}": unknown key "${k}" (known: ${OVERRIDE_KEYS.join(', ')})`);
    if (ov.include && ov.skip) errs.push(`steps."${ref}": "include" and "skip" are mutually exclusive`);
    if (ov.include && VISUAL_ONLY.has(r.action.name)) errs.push(`steps."${ref}": "${r.action.name}" is a visual-only action and cannot be a step`);
    if (ov.value !== undefined && !['type', 'fill', 'select'].includes(r.action.name)) errs.push(`steps."${ref}": "value" only applies to type/fill/select (this is "${r.action.name}")`);
    for (const k of ['title', 'text', 'note', 'warning', 'label']) if (ov[k] !== undefined && typeof ov[k] !== 'string') errs.push(`steps."${ref}": ${k} must be a string`);
    const key = `${r.scene.id}.${r.index}`;
    if (overrides[key]) errs.push(`steps: "${ref}" refers to an action that already has an override (${key})`);
    overrides[key] = { ...ov };
  }

  const manual = [];
  if (raw.manual !== undefined && !Array.isArray(raw.manual)) errs.push('manual must be a list');
  const manualIds = new Set();
  for (const [i, m] of (Array.isArray(raw.manual) ? raw.manual : []).entries()) {
    const w = `manual[${i}]`;
    if (!isObj(m)) { errs.push(`${w} must be a mapping`); continue; }
    for (const k of Object.keys(m)) if (!MANUAL_KEYS.includes(k)) errs.push(`${w}: unknown key "${k}" (known: ${MANUAL_KEYS.join(', ')})`);
    if (!m.id || !ID_RE.test(String(m.id))) errs.push(`${w}: "id" is required and must match [A-Za-z][A-Za-z0-9_-]*`);
    if (!m.selector) errs.push(`${w}: "selector" is required`);
    if (m.verb !== undefined && !MANUAL_VERBS.includes(m.verb)) errs.push(`${w}: verb must be one of ${MANUAL_VERBS.join('|')}`);
    if (m.after && m.before) errs.push(`${w}: use either "after" or "before", not both`);
    if (!m.after && !m.before) errs.push(`${w}: "after" or "before" (a step ref) is required`);
    const anchorRef = m.after || m.before;
    const r = anchorRef ? resolveRef(spec, anchorRef) : null;
    if (r?.error) errs.push(`${w}: anchor ${r.error}`);
    else if (r && !scenes.includes(r.scene.id)) errs.push(`${w}: anchor scene "${r.scene.id}" is not listed in "scenes"`);
    if (r && !r.error && m.id) {
      const mid = `${r.scene.id}.${m.id}`;
      if (manualIds.has(mid)) errs.push(`${w}: duplicate manual id "${mid}"`);
      manualIds.add(mid);
      manual.push({ ...m, verb: m.verb || 'look', position: m.after ? 'after' : 'before', anchorKey: `${r.scene.id}.${r.index}`, scene: r.scene.id });
    }
  }

  const allow = [];
  if (raw.env !== undefined && !isObj(raw.env)) errs.push('env must be a mapping ({ allow: [host, ...] })');
  for (const k of Object.keys(isObj(raw.env) ? raw.env : {})) if (k !== 'allow') errs.push(`env: unknown key "${k}" (known: allow)`);
  if (isObj(raw.env) && raw.env.allow !== undefined && (!Array.isArray(raw.env.allow) || raw.env.allow.some((h) => typeof h !== 'string'))) errs.push('env.allow must be a list of host names');
  else for (const h of isObj(raw.env) ? raw.env.allow || [] : []) {
    const host = normHost(h);
    if (!HOST_RE.test(host)) errs.push(`env.allow: "${h}" is not a bare host name (no scheme, port or path; "*.example.com" allows subdomains)`);
    else if (host.startsWith('*.') && !host.slice(2).includes('.')) errs.push(`env.allow: "${h}" is too broad (a wildcard needs at least two labels after "*.", e.g. "*.example.com")`);
    else if (host.startsWith('*.') && isPublicSuffix(host.slice(2))) errs.push(`env.allow: "${h}" is a public suffix (anyone can register a host under it); use exact hosts, or a wildcard under your own domain (e.g. "*.acme.${host.slice(2)}")`);
    else allow.push(host);
  }

  const cap = { ...CAPTURE_DEFAULTS, ...(isObj(raw.capture) ? raw.capture : {}) };
  cap.closeupMin = { ...CAPTURE_DEFAULTS.closeupMin, ...(isObj(raw.capture?.closeupMin) ? raw.capture.closeupMin : {}) };
  if (raw.capture !== undefined && !isObj(raw.capture)) errs.push('capture must be a mapping');
  for (const k of Object.keys(isObj(raw.capture) ? raw.capture : {})) if (!(k in CAPTURE_DEFAULTS)) errs.push(`capture: unknown key "${k}" (known: ${Object.keys(CAPTURE_DEFAULTS).join(', ')})`);
  for (const k of ['padding', 'settleMs', 'timeout']) if (!(Number.isFinite(cap[k]) && cap[k] >= 0)) errs.push(`capture.${k} must be a non-negative number`);
  const pdf = { format: 'A4', fonts: [], ...(isObj(raw.pdf) ? raw.pdf : {}) };
  if (!['A4', 'Letter'].includes(pdf.format)) errs.push('pdf.format must be A4 or Letter');
  if (!Array.isArray(pdf.fonts)) { errs.push('pdf.fonts must be a list'); pdf.fonts = []; }
  pdf.fonts = pdf.fonts.map((f, i) => {
    if (!isObj(f) || !f.family || !f.file) { errs.push(`pdf.fonts[${i}] needs "family" and "file"`); return null; }
    const abs = spec.abs(f.file);
    if (!fs.existsSync(abs)) errs.push(`pdf.fonts[${i}]: file not found: ${f.file}`);
    return { ...f, abs };
  }).filter(Boolean);

  if (errs.length) guideFail('CONFIG_INVALID', `${rel(file)} has ${errs.length} problem(s):\n${errs.map((e) => `  - ${e}`).join('\n')}`);
  return {
    file: fs.existsSync(file) ? file : null, locale: String(locale).replace('_', '-'), title: raw.title ?? null, goal: raw.goal ?? null,
    prerequisites: strArr(raw.prerequisites, 'prerequisites'), signIn: raw.signIn ?? null, expectedResult: raw.expectedResult ?? null,
    scenes, overrides, manual, mask: strArr(raw.mask, 'mask'), hide: strArr(raw.hide, 'hide'), env: { allow }, capture: cap, pdf,
  };
}

// ---------- environment ----------
// Policy: a host is trusted only when it is local, listed in guide.yaml `env.allow`, or confirmed by the user with --confirm-env=<host> (exact hosts, no wildcards).
// "Local" means loopback only: 127.0.0.0/8, ::1, localhost and *.localhost, *.test, and the file: protocol. RFC1918, link-local and *.local hosts are NOT local.
// The staging/production keyword guess below is an advisory label for messages; it never approves anything.
const HOST_RE = /^(\*\.)?[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
const normHost = (h) => String(h).trim().toLowerCase().replace(/^\[|\]$/g, '');
// Wildcards in env.allow must not sit on a public suffix. Small static list (not the full PSL): multi-tenant hosting domains + the ccTLD second-level pattern (co.uk, com.vn, org.au, ...).
const PUBLIC_SUFFIXES = new Set(['github.io', 'gitlab.io', 'vercel.app', 'netlify.app', 'herokuapp.com', 'azurewebsites.net', 'azurestaticapps.net', 'pages.dev', 'workers.dev', 'cloudfront.net', 'appspot.com', 'web.app', 'firebaseapp.com', 'onrender.com', 'fly.dev', 'ngrok.io', 'ngrok-free.app', 'amazonaws.com', 'blogspot.com', 'myshopify.com', 's3.amazonaws.com', 'r2.dev', 'surge.sh', 'ngrok.app', 'trycloudflare.com', 'github.dev', 'loca.lt', 'blob.core.windows.net', 'me.uk', 'run.app', 'railway.app', 'up.railway.app', 'replit.app', 'deno.dev', 'glitch.me', 'azureedge.net', 'azurefd.net', 'cloudapp.azure.com', 'storage.googleapis.com', 'supabase.co', 'readthedocs.io', 'pythonanywhere.com']);
// Providers where every host below the entry is shared (buckets, regions, ...): matched by suffix. Other entries are tenant-per-label (acme.github.io is yours), so only the entry itself matches.
const SHARED_BELOW = ['amazonaws.com', 'amazonaws.com.cn', 'core.windows.net'];
const CC_SECOND_LEVEL = /^(co|com|org|net|gov|edu|ac|or|ne|go|gob|nom|ltd|plc)\.[a-z]{2}$/;
export const isPublicSuffix = (base) => PUBLIC_SUFFIXES.has(base) || CC_SECOND_LEVEL.test(base) || SHARED_BELOW.some((e) => base.endsWith(`.${e}`));
const SAAS_HOST = /(^|\.)(azure\.com|azurewebsites\.net|salesforce\.com|force\.com|atlassian\.net|github\.io|herokuapp\.com|vercel\.app|netlify\.app|pages\.dev|workers\.dev)$/;
/** Stand-in "host" for the file: protocol. Not a possible host name, so a real host called "file" is never mistaken for it. */
export const FILE_HOST = 'file:';

export function isLocalHost(host) {
  const h = normHost(host);
  if (h === FILE_HOST || h === 'localhost' || h === '::1' || h.endsWith('.localhost') || h.endsWith('.test')) return true;
  const ip = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  return !!ip && Number(ip[1]) === 127;
}

/** Advisory label only: local | staging-like | unknown. Keywords are matched on the labels left of the TLD and never on well-known SaaS hosts. */
export function hostClass(host) {
  const h = normHost(host);
  if (isLocalHost(h)) return 'local';
  if (SAAS_HOST.test(h)) return 'unknown';
  const labels = h.split('.');
  const rest = labels.length > 1 ? labels.slice(0, -1).join('.') : h; // drop the TLD (.dev, .qa, ...)
  return /(^|[.-])(staging|stage|stg|demo|dev|test|qa|uat|sandbox|preview)([.-]|$)/.test(rest) ? 'staging-like' : 'unknown';
}

/** `allow` entries are exact hosts or "*.example.com" (any subdomain; the part after "*." must have at least two labels). */
export function hostAllowed(host, allow = []) {
  const h = normHost(host);
  return allow.some((p) => (p.startsWith('*.') ? p.slice(2).includes('.') && h.endsWith(p.slice(1)) && h.length > p.length - 1 : h === p));
}

/** Hosts of baseUrl and every absolute scene/goto URL, with the policy state of each. */
export function classifyEnv(spec, cfg = null) {
  const allow = cfg?.env?.allow || [];
  const urls = [spec.baseUrl, ...spec.scenes.map((s) => s.url), ...spec.setup.filter((a) => a.name === 'goto').map((a) => a.url),
    ...spec.scenes.flatMap((s) => (s.type === 'screen' ? s.actions : [])).filter((a) => a.name === 'goto').map((a) => a.url)].filter(Boolean);
  const hosts = new Set();
  for (const u of urls) {
    if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) continue; // relative: resolves against baseUrl or to a local file
    try { const p = new URL(u); hosts.add(p.protocol === 'file:' ? FILE_HOST : normHost(p.hostname)); } catch { hosts.add(String(u)); }
  }
  if (!hosts.size) hosts.add(FILE_HOST); // only relative paths (served from disk)
  const list = [...hosts];
  const remote = list.filter((h) => !isLocalHost(h));
  const allowed = remote.filter((h) => hostAllowed(h, allow));
  const needsConfirm = remote.filter((h) => !hostAllowed(h, allow));
  const advisory = Object.fromEntries(remote.map((h) => [h, hostClass(h)]));
  const cls = !remote.length ? 'local' : !needsConfirm.length ? 'allowed' : needsConfirm.every((h) => advisory[h] === 'staging-like') ? 'staging' : 'unknown';
  return { class: cls, hosts: list, allowed, needsConfirm, advisory };
}

/** --confirm-env value -> normalised host list. A bare flag (true) confirms nothing. */
export function parseConfirmEnv(v) {
  if (typeof v !== 'string') return [];
  return v.split(',').map(normHost).filter(Boolean);
}

// ---------- plan ----------
export function planSignature(steps) { return hash(steps.map((s) => [s.n, s.id, s.action])); }

/** Ordered list of steps (flow steps + manual steps), numbered 1..N, with signature, warnings, env and task fields. */
export function buildPlan(spec, cfg) {
  const contributes = new Set(cfg.scenes);
  const manualAt = (position, key) => cfg.manual.filter((m) => m.position === position && m.anchorKey === key);
  const steps = [];
  const push = (s) => steps.push({ n: steps.length + 1, ...s });
  const manualStep = (m) => push({ id: `${m.scene}.${m.id}`, source: 'manual', scene: m.scene, index: null, guideId: m.id, local: m.id, action: 'manual', selector: m.selector, nth: m.nth ?? null, key: null, timing: 'before', override: { title: m.title, text: m.text, note: m.note, warning: m.warning, label: m.label }, manual: m, verb: m.verb || 'look', envRefs: [] });
  for (const s of spec.scenes) {
    if (s.type !== 'screen' || !contributes.has(s.id)) continue;
    s.actions.forEach((a, i) => {
      const key = `${s.id}.${i + 1}`;
      for (const m of manualAt('before', key)) manualStep(m);
      const ov = cfg.overrides[key] || {};
      if (!VISUAL_ONLY.has(a.name) && ((STEP_ACTIONS.has(a.name) && !ov.skip) || ov.include)) {
        push({
          id: key, source: 'flow', scene: s.id, index: i + 1, guideId: a.guideId || null, local: a.guideId || String(i + 1), action: a.name,
          selector: a.selector || null, nth: a.nth ?? null, key: a.key ?? null, timing: AFTER_CAPTURE.has(a.name) ? 'after' : 'before',
          override: ov, manual: null, envRefs: a.envRefs || [],
        });
      }
      for (const m of manualAt('after', key)) manualStep(m);
    });
  }
  const warnings = [];
  if (steps.length > MAX_STEPS) warnings.push({ code: 'TOO_MANY_STEPS', message: `${steps.length} steps (> ${MAX_STEPS}): consider splitting this into several guides.` });
  const env = classifyEnv(spec, cfg);
  if (env.needsConfirm.length) warnings.push({ code: 'ENV_UNCONFIRMED', message: `Host(s) ${env.needsConfirm.map((h) => `${h} (${env.advisory[h]})`).join(', ')} are not local and not in guide.yaml env.allow; capture needs --confirm-env=${env.needsConfirm.join(',')} (the user decides).` });
  const signIn = cfg.signIn ?? (spec.setup.length > 0 || !!spec.auth);
  const task = {
    title: cfg.title, goal: cfg.goal, prerequisites: [...(signIn ? ['Sign in to the app.'] : []), ...cfg.prerequisites], expectedResult: cfg.expectedResult, signIn,
    hints: { specTitle: spec.title, cardTitles: spec.scenes.filter((s) => s.type === 'card' && s.title).map((s) => s.title) },
  };
  return { steps, signature: planSignature(steps), warnings, env, task };
}

/** Compare two plans' [{n,id,action}] lists. `moved` = relative order of surviving ids changed. */
export function diffPlans(oldSteps, newSteps) {
  const oldIds = new Map(oldSteps.map((s) => [s.id, s])); const newIds = new Map(newSteps.map((s) => [s.id, s]));
  const added = newSteps.filter((s) => !oldIds.has(s.id));
  const removed = oldSteps.filter((s) => !newIds.has(s.id));
  const changedAction = newSteps.filter((s) => oldIds.has(s.id) && oldIds.get(s.id).action !== s.action).map((s) => ({ id: s.id, from: oldIds.get(s.id).action, to: s.action }));
  const oldCommon = oldSteps.filter((s) => newIds.has(s.id)).map((s) => s.id);
  const newCommon = newSteps.filter((s) => oldIds.has(s.id)).map((s) => s.id);
  const moved = newCommon.filter((id, i) => oldCommon[i] !== id).map((id) => ({ id, from: oldIds.get(id).n, to: newIds.get(id).n }));
  return { added, removed, moved, changedAction };
}

function formatDiff(d) {
  return [
    ...d.added.map((s) => `+ ${s.id} ${s.action} (new)`), ...d.removed.map((s) => `- ${s.id} ${s.action} (removed)`),
    ...d.changedAction.map((c) => `~ ${c.id} ${c.from}→${c.to}`), ...d.moved.map((m) => `↕ ${m.id} moved (step ${m.from} → ${m.to})`),
  ];
}

const planView = (plan) => plan.steps.map(({ n, id, action, source, selector, envRefs, override }) => ({ n, id, action, source, selector, envRefs, overrides: Object.keys(override || {}).filter((k) => override[k] !== undefined) }));

// ---------- secrets ----------
/** Values of the ${VAR}s used by actions of the spec (URLs excluded), length >= 4: [{ varName, value }]. */
export function secretValues(spec) {
  const names = new Set();
  const acts = [...spec.setup, ...spec.scenes.flatMap((s) => (s.type === 'screen' ? s.actions : []))];
  for (const a of acts) if (!['goto', 'waitForUrl'].includes(a.name)) for (const v of a.envRefs || []) names.add(v);
  return [...names].filter((v) => (process.env[v] || '').length >= 4).map((v) => ({ varName: v, value: process.env[v] }));
}

/** texts: [{ file, text }] -> [{ file, varName, line }] (never returns the secret value). */
export function scanSecrets(texts, secrets) {
  const hits = [];
  for (const { file, text } of texts) {
    String(text).split('\n').forEach((ln, i) => { for (const s of secrets) if (ln.includes(s.value)) hits.push({ file, varName: s.varName, line: i + 1 }); });
  }
  return hits;
}

// ---------- capture ----------
/* Runs in the page (serialised by Playwright): describes the element a step points at. Never reads input .value except for submit/button inputs.
   When the element, its <label> or an aria-labelledby node is (or holds) a masked element, NO DOM text is taken at all: the label stays empty
   and the caller falls back to the role word or an explicit `label:` override. */
function describeTarget(el, masks) {
  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute('type') || '').toLowerCase();
  const isMasked = (n) => !!n && n.nodeType === 1 && (masks || []).some((sel) => { try { return !!(n.closest(sel) || n.querySelector(sel)); } catch { return false; } });
  const labelNodes = [...(el.labels || [])];
  const lb = el.getAttribute('aria-labelledby');
  const refNodes = lb ? lb.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean) : [];
  const masked = isMasked(el) || labelNodes.some(isMasked) || refNodes.some(isMasked);
  let label = ''; let source = 'none';
  const set = (v, src) => { const c = clean(v); if (!masked && !label && c) { label = c; source = src; } };
  if (!masked) {
    if (labelNodes[0]) {
      // a wrapping <label> must not contribute the text of the controls inside it (e.g. <select> options)
      const lab = labelNodes[0].cloneNode(true);
      lab.querySelectorAll('select,textarea,input,button,option,datalist,script,style').forEach((x) => x.remove());
      set(lab.textContent, 'label');
    }
    set(el.getAttribute('aria-label'), 'aria-label');
    if (lb) set(refNodes.map((n) => n.textContent || '').join(' '), 'aria-labelledby');
    set(el.getAttribute('placeholder'), 'placeholder');
    set(el.getAttribute('title'), 'title');
    if (!['input', 'textarea', 'select'].includes(tag)) set(el.innerText || el.textContent, 'innerText');
    if (tag === 'input' && ['submit', 'button', 'reset'].includes(type)) set(el.value, 'value');
    set(el.getAttribute('name'), 'name');
  }
  let role = el.getAttribute('role');
  if (!role) role = tag === 'a' ? 'link' : tag === 'button' || (tag === 'input' && ['submit', 'button', 'reset'].includes(type)) ? 'button' : tag === 'select' ? 'combobox' : tag === 'textarea' ? 'textbox' : tag === 'input' ? (['checkbox', 'radio'].includes(type) ? type : 'textbox') : null;
  const inForm = !!el.closest('form');
  return {
    tag, role, inputType: tag === 'input' ? (type || 'text') : null, label, labelSource: label ? source : 'none', masked, isPassword: type === 'password',
    isSubmit: (tag === 'input' && type === 'submit') || (tag === 'button' && (type === '' || type === 'submit') && inForm), inForm,
    lang: document.documentElement.lang || '', title: document.title,
  };
}

/* Runs in a frame: for each mask selector, over the matched elements (open shadow roots included):
   bare      = no blur filter is rendered (page CSS won, or display:contents: the element has no box to filter);
   outside   = visible text that lies outside the union of the element's and its descendants' boxes (the opaque Playwright boxes follow those boxes);
   uncovered = text is rendered where no opaque box and no blur can reach it: the element and its descendants have no box at all, or the text lies
               outside every box while the element is display:contents or has no rendered blur (e.g. bare text next to an element child) — fail closed. */
function checkMaskCss(sels) {
  const roots = [document];
  const walk = (n) => { for (const el of n.querySelectorAll('*')) if (el.shadowRoot) { roots.push(el.shadowRoot); walk(el.shadowRoot); } };
  walk(document);
  const has = (r) => r.width > 0 && r.height > 0;
  const within = (r, b) => r.left >= b.left - 1 && r.right <= b.right + 1 && r.top >= b.top - 1 && r.bottom <= b.bottom + 1;
  return sels.map((q) => {
    let matched = 0; let bare = 0; let outside = 0; let uncovered = 0;
    for (const r of roots) {
      let list; try { list = r.querySelectorAll(q); } catch { continue; }
      for (const el of list) {
        matched++;
        const cs = getComputedStyle(el);
        if (cs.display === 'contents' || !/blur\(/.test(cs.filter)) bare++;
        const own = el.getBoundingClientRect();
        const boxes = [own, ...[...el.querySelectorAll('*')].map((d) => d.getBoundingClientRect())].filter(has);
        const rg = document.createRange(); rg.selectNodeContents(el);
        const clipped = /paint|content|strict/.test(cs.contain) && !['inline', 'contents'].includes(cs.display); // contain:paint hides what lies outside the box
        const texts = [...rg.getClientRects()].filter(has).filter((t) => !clipped || (t.right > own.left && t.left < own.right && t.bottom > own.top && t.top < own.bottom));
        if (!texts.length) continue;
        if (!boxes.length) { uncovered++; continue; }
        // text outside every box: blur still covers it on a normal element; with display:contents or no rendered blur nothing does, so fail closed
        if (texts.some((t) => !boxes.some((b) => within(t, b)))) { if (cs.display === 'contents' || !/blur\(/.test(cs.filter)) uncovered++; else outside++; }
      }
    }
    return { matched, bare, outside, uncovered };
  });
}

function contrastText(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return '#ffffff';
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  const lin = [0, 2, 4].map((i) => { const v = parseInt(h.slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  const L = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  return 1.05 / (L + 0.05) >= 4.5 ? '#ffffff' : '#111827';
}

const sameBox = (a, b) => !!a && !!b && ['x', 'y', 'width', 'height'].every((k) => Math.abs(a[k] - b[k]) < 0.5);
const urlNoQuery = (u) => { try { const p = new URL(u); return `${p.protocol}//${p.host}${p.pathname}`; } catch { return u; } };
const MUTATING = /(?<!\p{L})(save|create|add|submit|send|confirm|delete|remove|post|publish|pay|import|lưu|tạo|thêm|gửi|xoá|xóa)(?!\p{L})/iu;

/** Wait until the page and the target are visually stable (FR-11). */
async function settle(page, loc, settleMs) {
  await page.waitForLoadState('networkidle', { timeout: 1500 }).catch(() => {});
  await page.evaluate(() => (document.fonts ? document.fonts.ready.then(() => true) : true)).catch(() => {});
  if (loc) {
    let prev = await loc.boundingBox().catch(() => null); const t0 = Date.now();
    while (Date.now() - t0 < settleMs) {
      await sleep(120);
      const cur = await loc.boundingBox().catch(() => null);
      if (sameBox(prev, cur)) break;
      prev = cur;
    }
  }
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))).catch(() => {});
}

function closeupClip(b, vp, { padding, closeupMin }) {
  let w = Math.min(vp.width, Math.max(b.width + padding * 2, closeupMin.width));
  let h = Math.min(vp.height, Math.max(b.height + padding * 2, closeupMin.height));
  const cx = b.x + b.width / 2; const cy = b.y + b.height / 2;
  const x = Math.max(0, Math.min(vp.width - w, cx - w / 2)); const y = Math.max(0, Math.min(vp.height - h, cy - h / 2));
  w = Math.round(w); h = Math.round(h);
  return { x: Math.round(x), y: Math.round(y), width: Math.min(w, vp.width - Math.round(x)), height: Math.min(h, vp.height - Math.round(y)) };
}

async function flowError(page, label, i, a, e, errorDir, masks = []) {
  const shot = path.join(errorDir, `error-${label.replace(/[^\w-]/g, '_')}-${i}.png`);
  ensureDir(errorDir);
  await redactedScreenshot(page, masks, { path: shot }).catch(() => {}); // opaque boxes over masked elements; no image at all when they cannot be applied
  return new DemoError(`${label} action #${i} (${a.name} ${a.selector || a.url || a.key || ''}) failed on ${urlNoQuery(page.url())}\n  ${String(e.message).split('\n')[0]}\n  screenshot: ${shot}\n  tip: ${page.url() === 'about:blank' ? 'the page is blank — give this scene a "url:" or set baseUrl' : `node demo.mjs inspect "${urlNoQuery(page.url())}" to list selectors`}`);
}

/** Static guard: ${ENV} values in `press`/`evaluate` of a screen scene would reach the page (and screenshots) with no way to redact them. */
function assertNoSecretKeys(spec) {
  for (const s of spec.scenes) {
    if (s.type !== 'screen') continue;
    s.actions.forEach((a, i) => {
      if (['press', 'evaluate'].includes(a.name) && a.envRefs?.length) {
        guideFail('SECRET_VALUE', `${s.id}.${i + 1}: "${a.name}" uses \${${a.envRefs.join('}, ${')}} outside setup:. Guide capture cannot keep that value out of the screenshots.\n  Move the sign-in into setup:, or replace the value with a fixed fake one.`);
      }
    });
  }
}

/**
 * Run the flow in a guide-only browser context and capture annotated screenshots BEFORE each interactive action.
 * Everything is staged in guide/.staging (images, steps.json, skeleton) and swapped in last; a failure rolls back.
 * Options: confirmEnv (host list the user confirmed), headed, strictSignature (refresh: never create guide.md, fail if the plan changed), compare (add LABEL/SELECTOR_CHANGED).
 */
export async function capture(spec, cfg, { confirmEnv = [], headed = false, strictSignature = false, compare = false } = {}) {
  const plan = buildPlan(spec, cfg);
  const gdir = ensureDir(guideDir(spec));
  const stepsFile = gpath(spec, 'steps.json');
  const prev = readJson(stepsFile, null);
  if (strictSignature && prev && prev.plan?.signature !== plan.signature) guideFail('PLAN_MISMATCH', 'The flow plan changed since the last capture; run "guide capture" to regenerate.');
  if (!plan.steps.length) guideFail('NO_STEPS', 'The plan has no steps (no interactive actions in the selected scenes). Check "scenes"/"steps" in guide.yaml.');
  const confirmed = (Array.isArray(confirmEnv) ? confirmEnv : parseConfirmEnv(confirmEnv)).map(normHost);
  const pending = plan.env.needsConfirm.filter((h) => !confirmed.includes(h));
  if (pending.length) {
    guideFail('ENV_UNCONFIRMED', `Host(s) ${pending.map((h) => `${h} (${plan.env.advisory[h]})`).join(', ')} are not local and not in guide.yaml env.allow. Capturing runs the flow for real and may create data.\n  Only the user may decide this. If the user confirms, re-run with --confirm-env=${pending.join(',')}, or list the host(s) under env.allow in guide.yaml.`);
  }
  assertNoSecretKeys(spec);
  const allow = cfg.env?.allow || [];
  const approved = (h) => isLocalHost(h) || hostAllowed(h, allow) || confirmed.includes(h);

  const { chromium } = requireModule('playwright');
  const staging = gpath(spec, '.staging'); const errorDir = gpath(spec, 'errors');
  rmrf(staging); ensureDir(path.join(staging, 'images'));
  const pad2 = plan.steps.length > 99 ? 3 : 2;
  const masks = [...new Set([...spec.mask, ...cfg.mask])]; const hides = [...new Set([...spec.hide, ...cfg.hide])];
  const maskHits = new Map(masks.map((m) => [m, 0]));
  const cssDefeated = new Map(); // mask selector -> steps where a matched element had no CSS blur (the opaque box still covers it)
  const color = spec.brand.primary; const badgeText = contrastText(color);
  const vp = spec.viewport;
  const byFlow = new Map(plan.steps.filter((s) => s.source === 'flow').map((s) => [s.id, s]));
  const manualByKey = (pos, key) => plan.steps.filter((s) => s.source === 'manual' && s.manual.position === pos && s.manual.anchorKey === key);
  const doc = { steps: [] };
  const flagged = { locale: [], data: [], ambiguous: [], hidden: [], noTarget: [] };
  const pageLangs = new Set(); let navLang = null;
  const wantLang = cfg.locale.split('-')[0].toLowerCase();
  const contacted = new Map(); // host -> { METHOD: count } of every request that left the machine (steps.json env.contacted / env.contactedMethods)
  const blocked = new Map(); // unapproved host -> what was refused/seen there ('navigation GET', 'POST', 'redirect GET'); non-empty = stop flag
  const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
  const count = (h, m) => { const c = contacted.get(h) || {}; c[m] = (c[m] || 0) + 1; contacted.set(h, c); };
  const refuse = (h, what) => { if (!blocked.has(h)) blocked.set(h, new Set()); blocked.get(h).add(what); };
  const envStop = () => Object.assign(new DemoError(`Capture stopped: ${[...blocked].map(([h, w]) => `${h} (${[...w].join(', ')})`).join('; ')} is not local, not in guide.yaml env.allow and not confirmed.\n  Blocked before they are sent: navigations to such a host (top-level, popup, iframe), WebSocket connections and non-read requests (POST/PUT/PATCH/DELETE). A redirect cannot be blocked in advance: the redirected request itself (for a 307/308 redirect of a POST, with its method and body) reaches the host once; it is detected right after, and capture stops before the next action. Service workers and SharedWorker are disabled.\n  Only the user may decide this. If the user confirms, re-run with --confirm-env=${[...new Set([...confirmed, ...blocked.keys()])].join(',')}, or list the host(s) under env.allow.`), { code: 'ENV_UNCONFIRMED' });
  const halt = () => { if (blocked.size) throw envStop(); };
  // Gate every request of a context (setup and capture) through the host policy:
  //  - approved host: continue (counted);
  //  - unapproved host: any navigation (top-level, popup, iframe; unknown = navigation), any non-GET/HEAD/OPTIONS request, or anything once that host was flagged: aborted and the run stops at the next action boundary;
  //  - unapproved host, plain read from a sub-resource: allowed but recorded in env.contacted (warning ENV_CONTACTED_UNAPPROVED);
  //  - SharedWorker: constructor removed in every frame (its requests are invisible to context.route);
  //  - WebSocket to an unapproved host: closed without connecting (context.routeWebSocket); the run stops like for a blocked POST.
  // Redirect hops are not routed (Playwright), so they cannot be blocked in advance: the redirected request itself (with method and body for 307/308) reaches the host
  // once; it is seen on the `request` event after the hop, the host is flagged at once and everything further to it is aborted.
  const gate = async (c) => {
    await c.route(/^https?:\/\//, (route) => {
      const req = route.request();
      let h; try { h = normHost(new URL(req.url()).hostname); } catch { return route.abort('blockedbyclient'); }
      const m = req.method().toUpperCase();
      if (approved(h)) { count(h, m); return route.continue(); }
      let nav = true; try { nav = req.isNavigationRequest(); } catch { /* cannot tell (popup's first request): treat as a navigation */ }
      if (blocked.has(h)) return route.abort('blockedbyclient');
      if (nav) { refuse(h, `navigation ${m}`); return route.abort('blockedbyclient'); }
      if (!SAFE.has(m)) { refuse(h, m); return route.abort('blockedbyclient'); }
      count(h, m); return route.continue();
    });
    // SharedWorker traffic does not go through context.route: disable the constructor in every frame (and the dedicated-worker case is routed normally).
    await c.addInitScript(() => { try { Object.defineProperty(window, 'SharedWorker', { value: undefined, configurable: false }); } catch { /* already locked */ } });
    if (typeof c.routeWebSocket === 'function') {
      await c.routeWebSocket((u) => !approved(normHost(u.hostname)), (ws) => {
        let h = ''; try { h = normHost(new URL(ws.url()).hostname); } catch { /* keep empty */ }
        refuse(h || 'websocket', 'WebSocket'); ws.close({ code: 1008, reason: 'blocked by demo-toolkit' });
      });
    }
    const seeUrl = (u) => { try { const p = new URL(u); if (/^https?:$/.test(p.protocol) && !approved(normHost(p.hostname))) refuse(normHost(p.hostname), 'navigation'); } catch { /* about:blank */ } };
    c.on('request', (req) => {
      try {
        const u = new URL(req.url());
        if (u.protocol === 'file:') { count(FILE_HOST, 'GET'); return; }
        if (!/^https?:$/.test(u.protocol) || !req.redirectedFrom()) return;
        const h = normHost(u.hostname); count(h, req.method().toUpperCase());
        if (!approved(h)) refuse(h, `redirect ${req.method().toUpperCase()}`);
      } catch { /* service-worker request */ }
    });
    c.on('page', (pg) => { seeUrl(pg.url()); pg.on('framenavigated', (fr) => seeUrl(fr.url())); }); // popups and iframes included
  };

  const browser = await chromium.launch({ headless: !headed, args: ['--hide-scrollbars', '--disable-blink-features=AutomationControlled'] });
  try {
    await assertMaskSelectors(browser, { mask: masks, hide: hides }, 'demo.yaml or guide.yaml');
    const ctxOpts = { viewport: vp, deviceScaleFactor: 1, locale: cfg.locale, colorScheme: spec.colorScheme || 'light', timezoneId: spec.timezone, ignoreHTTPSErrors: !!spec.ignoreHTTPSErrors, serviceWorkers: 'block' };
    const storageState = await prepareSession(browser, spec, ctxOpts, { save: false, fresh: cfg.capture.freshSession, errorDir, onContext: gate, halt, masks });
    halt();
    const ctx = await browser.newContext({ ...ctxOpts, storageState });
    await gate(ctx);
    await ctx.addInitScript(overlayInit, {
      cursor: { ...spec.cursor, show: false, clickRipple: false }, mask: masks, hide: hides, primary: color, font: spec.brand.font, hideScrollbars: spec.hideScrollbars !== false,
    });
    const page = await ctx.newPage();
    await maskLocators(page, masks); // fail closed before anything runs: Playwright must be able to draw the opaque boxes
    const d = new Director(page, spec, { dry: true });
    d.halt = halt;

    const describe = async (loc, a, timeout) => {
      const t = await loc.evaluate(describeTarget, masks, timeout ? { timeout } : undefined);
      if (t.lang) pageLangs.add(t.lang);
      return t;
    };

    // Annotated full + close-up screenshots of one step. `a` = the action (null for manual), returns the steps.json entry.
    const shoot = async (ps, a) => {
      halt();
      const cap = cfg.capture; const ov = ps.override || {};
      let loc = null; let count = 0;
      if (ps.source === 'manual') loc = page.locator(ps.selector).nth(ps.nth ?? 0);
      else if (a.name === 'press') loc = page.locator(':focus').first();
      else if (a.selector) loc = d.locator(a.selector, a);
      const sel = ps.source === 'manual' ? ps.selector : a?.selector;
      if (sel) count = await page.locator(sel).count();
      if (a?.name === 'press' && !(await page.locator(':focus').count())) loc = null;
      const flags = { localeMismatch: false, mutatingHint: false, ambiguous: false, targetHidden: false, noTarget: !loc };
      if (loc && sel && count > 1 && ps.nth == null) flags.ambiguous = true;

      let b = null; let boxLoc = loc;
      if (loc) {
        try { b = await d.box(loc, { timeout: ps.action === 'upload' ? 2000 : cap.timeout }); } catch (e) {
          if (ps.action !== 'upload') throw e;
          // hidden file input: point at its <label> instead
          const id = await loc.getAttribute('id', { timeout: 2000 }).catch(() => null);
          for (const cand of [id ? page.locator(`label[for="${id}"]`).first() : null, loc.locator('xpath=ancestor::label[1]')].filter(Boolean)) {
            try { b = await d.box(cand, { timeout: 1000 }); boxLoc = cand; break; } catch { /* next */ }
          }
          if (!b) flags.targetHidden = true;
        }
      }
      await settle(page, b ? boxLoc : null, cap.settleMs);
      if (b) b = (await boxLoc.boundingBox()) || b;
      if (cap.parkMouse) await page.mouse.move(vp.width - 1, vp.height - 1);
      if (masks.length) {
        // CSS blur is the first layer: put it back if the page removed it, and note any matched element that still has no blur.
        // The authoritative layer is the opaque Playwright mask taken with every screenshot below.
        const frames = page.frames().filter((f) => !f.isDetached());
        await Promise.all(frames.map((f) => f.evaluate(() => (window.__demo && window.__demo.ensurePrivacy ? window.__demo.ensurePrivacy() : false)).catch(() => {})));
        const per = await Promise.all(frames.map((f) => f.evaluate(checkMaskCss, masks).catch(() => null))); // same-origin and cross-origin frames alike (Playwright evaluates in each)
        const css = per.some((x) => !x) ? null : masks.map((_, i) => per.reduce((t, x) => ({ bare: t.bare + x[i].bare, outside: t.outside + x[i].outside, uncovered: t.uncovered + x[i].uncovered }), { bare: 0, outside: 0, uncovered: 0 }));
        masks.forEach((m, i) => {
          if (css && css[i].uncovered) guideFail('MASK_NOT_APPLIED', `Step ${ps.n}: an element matching mask "${m}" renders text that no opaque box and no blur can cover (for example bare text directly under a display:contents element), so it would appear in plain text. No image was written.\n  Mask a wrapper element that has a box, or one of the elements around the text.`);
          if (!css || css[i].bare || css[i].outside) { if (!cssDefeated.has(m)) cssDefeated.set(m, new Set()); cssDefeated.get(m).add(ps.n); }
        });
      }
      const target = loc ? await describe(loc, a) : null;
      const annLabel = annotationLabel({ action: ps.action, label: target?.label, key: ps.key, override: ps.override.label, verb: ps.verb });
      const base = `${String(ps.n).padStart(pad2, '0')}-${ps.scene}-${ps.local}`;
      const fullRel = `images/${base}.png`; const closeRel = `images/${base}-closeup.png`;
      const o = { rect: b, n: ps.n, label: annLabel, mode: 'full', color, text: badgeText, font: spec.brand.font, masks, pad: 8 };
      const ann = await page.evaluate(guideAnnotate, o);
      const noteHits = (counts) => counts.forEach((n, i) => maskHits.set(masks[i], Math.max(maskHits.get(masks[i]), n)));
      noteHits(await redactedScreenshot(page, masks, { path: path.join(staging, fullRel), animations: 'disabled', caret: 'hide' }));
      let clip = null; let closeup = null;
      if (b) {
        await page.evaluate(guideAnnotate, { ...o, mode: 'closeup' });
        clip = closeupClip(b, vp, cap);
        noteHits(await redactedScreenshot(page, masks, { path: path.join(staging, closeRel), clip, animations: 'disabled', caret: 'hide' }));
        closeup = closeRel;
      }
      await page.evaluate(guideClear);

      const redacted = !!(a?.envRefs?.length && ps.override.value === undefined) || !!target?.isPassword;
      let value = null; let valueSource = null;
      if (['type', 'fill', 'select'].includes(ps.action)) {
        if (redacted) { value = '••••••'; valueSource = 'redacted'; } else if (ps.override.value !== undefined) { value = String(ps.override.value); valueSource = 'guide.yaml'; } else { value = String(a.text ?? a.value ?? a.label ?? a.option ?? ''); valueSource = 'spec'; }
      }
      const pageLang = (target?.lang || '').split('-')[0].toLowerCase();
      flags.localeMismatch = (!!pageLang && pageLang !== wantLang) || /(?![\x00-\x7F])\p{L}/u.test(target?.label || '');
      flags.mutatingHint = ['click', 'dblclick'].includes(ps.action) || (ps.action === 'press' && /^enter$/i.test(ps.key || ''))
        ? !!(target && (target.isSubmit || target.inForm || MUTATING.test(target.label))) : false;
      if (flags.localeMismatch) flagged.locale.push(ps.n);
      if (flags.mutatingHint) flagged.data.push(ps.n);
      if (flags.ambiguous) flagged.ambiguous.push(ps.n);
      if (flags.targetHidden) flagged.hidden.push(ps.n);
      if (a?.name === 'press' && flags.noTarget) flagged.noTarget.push(ps.n);
      log('dim', `  step ${String(ps.n).padStart(2, '0')} ${ps.id} ${ps.action}${sel ? ` ${sel}` : ''} → ${fullRel}`);
      const entry = {
        n: ps.n, id: ps.id, source: ps.source,
        ref: { scene: ps.scene, index: ps.index, guideId: ps.guideId },
        action: ps.action, ...(ps.source === 'manual' ? { verb: ps.verb } : {}), selector: sel || null, nth: ps.nth, key: ps.key, value, valueSource, valueRedacted: redacted,
        page: { title: await page.title().catch(() => ''), path: urlNoQuery(page.url()) },
        target: target ? { found: true, visible: !!b, count, tag: target.tag, role: target.role, inputType: target.inputType, label: target.label, labelSource: target.labelSource, masked: target.masked, isPassword: target.isPassword, box: b ? Object.fromEntries(['x', 'y', 'width', 'height'].map((k) => [k, Math.round(b[k])])) : null }
          : { found: false, visible: false, count: 0, tag: null, role: null, inputType: null, label: '', labelSource: 'none', masked: false, isPassword: false, box: null },
        annotation: { label: annLabel, placement: ann.placement, badge: ann.badge },
        images: { full: fullRel, closeup, clip },
        overrides: { title: ps.override.title ?? null, text: ps.override.text ?? null, note: ps.override.note ?? null, warning: ps.override.warning ?? null, label: ps.override.label ?? null },
        flags,
      };
      entry.template = stepTemplate(entry);
      doc.steps.push(entry);
    };

    // Fail closed: a ${ENV} value typed into a field is only allowed into a password field, or with a fixed fake `value:` override.
    // Runs for EVERY screen scene action (listed in `scenes` or not, step or not) before the action executes.
    const secretGuard = async (a, ov, key) => {
      if (!a.envRefs?.length || ov.value !== undefined) return;
      const vars = `\${${a.envRefs.join('}, ${')}}`;
      const fix = `Add a fixed fake value so it never reaches the screenshots:\n  steps:\n    ${key}: { value: "Jane Doe" }   # in guide.yaml`;
      if (a.name === 'select') guideFail('SECRET_VALUE', `${key}: "select" uses ${vars} (a secret); a drop-down value is shown on screen.\n  ${fix}`);
      if (!['type', 'fill'].includes(a.name)) return;
      const t = a.selector ? await describe(d.locator(a.selector, a), a, cfg.capture.timeout).catch(() => null) : null;
      if (!t) guideFail('SECRET_VALUE', `${key}: "${a.name}" uses ${vars} (a secret) but the target field could not be inspected, so it cannot be shown to be a password field (failing closed).\n  ${fix}`);
      if (!t.isPassword) guideFail('SECRET_VALUE', `step ${key}: "${a.name}" uses ${vars} (a secret) and is not a password field.\n  ${fix}`);
    };

    // Run the flow: every screen scene in order, like `record` without scene filtering.
    const screens = spec.scenes.filter((s) => s.type === 'screen');
    const contrib = new Set(cfg.scenes);
    for (const [si, s] of screens.entries()) {
      log('info', `● ${s.id}${contrib.has(s.id) ? '' : ' (state only, no steps)'}: ${s.actions.length} action(s)`);
      if (s.url) await d.goto(s.url);
      else if (si === 0) {
        if (s.actions[0]?.name !== 'goto' && spec.baseUrl) await d.goto(spec.baseUrl);
        else if (s.actions[0]?.name !== 'goto') log('warn', `"${s.id}" has no url and there is no baseUrl — starting from a blank page`);
      }
      if (si === 0 && navLang === null) navLang = await page.evaluate(() => navigator.language).catch(() => null);
      for (let i = 0; i < s.actions.length; i++) {
        const a = s.actions[i]; const key = `${s.id}.${i + 1}`;
        const guard = async (fn) => { try { halt(); await fn(); } catch (e) { throw (e instanceof DemoError && e.code) ? e : await flowError(page, `scene "${s.id}"`, i, a, e, errorDir, masks); } };
        const ps = contrib.has(s.id) ? byFlow.get(key) : null;
        await guard(async () => { for (const m of manualByKey('before', key)) await shoot(m, null); });
        if (!VISUAL_ONLY.has(a.name)) {
          const ov = cfg.overrides[key] || {};
          const a2 = ov.value === undefined ? a : { ...a, ...(a.name === 'select' ? { value: ov.value } : { text: ov.value }) };
          await guard(async () => {
            await secretGuard(a, ov, key);
            if (ps && ps.timing === 'before') await shoot(ps, a2);
            await d.act(a2);
            if (ps && ps.timing === 'after') await shoot(ps, a2);
          });
        }
        await guard(async () => { for (const m of manualByKey('after', key)) await shoot(m, null); });
      }
    }
    halt();
    await ctx.close();
  } catch (e) {
    rmrf(staging);
    if (blocked.size && !(e instanceof DemoError && e.code === 'ENV_UNCONFIRMED')) throw envStop(); // a blocked navigation shows up as a failed goto/click: report the real cause
    throw e;
  } finally {
    await browser.close();
  }

  // ---- assemble steps.json ----
  doc.steps.sort((a, b) => a.n - b.n);
  const warnings = [...plan.warnings.filter((w) => w.code !== 'ENV_UNCONFIRMED')];
  const unmatched = [...maskHits].filter(([, n]) => n === 0).map(([m]) => m);
  if (unmatched.length) warnings.push({ code: 'MASK_UNMATCHED', selectors: unmatched, message: `mask selector(s) ${unmatched.map((m) => `"${m}"`).join(', ')} matched nothing on any captured screen; check them for typos, or the data they should hide is not protected.` });
  if (cssDefeated.size) warnings.push({ code: 'MASK_CSS_DEFEATED', selectors: [...cssDefeated.keys()], steps: [...new Set([...cssDefeated.values()].flatMap((x) => [...x]))].sort((a, b) => a - b), message: `The CSS blur is not applied to element(s) matching ${[...cssDefeated.keys()].map((m) => `"${m}"`).join(', ')} (page CSS or an open shadow root overrides it, the element is display:contents, or its text lies outside the element's and its descendants' boxes). The opaque boxes still cover every element box in every image; text outside them is not covered, so check the images.` });
  const outside = [...contacted].filter(([h]) => !approved(h)).sort(([x], [y]) => (x < y ? -1 : 1));
  if (outside.length) warnings.push({ code: 'ENV_CONTACTED_UNAPPROVED', hosts: outside.map(([h, ms]) => ({ host: h, methods: ms })), message: `The app contacted host(s) that are not local, not in env.allow and not confirmed: ${outside.map(([h, ms]) => `${h} (${Object.entries(ms).map(([k, n]) => `${k} x${n}`).join(', ')})`).join('; ')}. Only plain reads of sub-resources were let through; ask the user whether that is acceptable (or add the host to env.allow).` });
  if (flagged.locale.length) warnings.push({ code: 'LOCALE_MISMATCH', steps: flagged.locale, message: `App UI did not switch to ${cfg.locale}; quote on-screen labels verbatim (L2).` });
  if (flagged.data.length) warnings.push({ code: 'DATA_CREATING', steps: flagged.data, message: 'These steps may create, change or delete data; each capture/refresh runs them for real. Use a test workspace.' });
  if (flagged.ambiguous.length) warnings.push({ code: 'AMBIGUOUS_TARGET', steps: flagged.ambiguous, message: 'Selector matched several elements; the first one was used. Add nth or a tighter selector.' });
  if (flagged.hidden.length) warnings.push({ code: 'TARGET_HIDDEN', steps: flagged.hidden, message: 'Target element is not visible (hidden file input without a visible label); the image has no box.' });
  if (flagged.noTarget.length) warnings.push({ code: 'NO_TARGET', steps: flagged.noTarget, message: 'No focused element for this key press; only the full screenshot was taken.' });
  if (compare && prev) {
    const before = new Map((prev.steps || []).map((s) => [s.id, s]));
    for (const s of doc.steps) {
      const p = before.get(s.id); if (!p) continue;
      if (p.target?.label !== s.target.label) warnings.push({ code: 'LABEL_CHANGED', step: s.n, id: s.id, from: p.target?.label ?? '', to: s.target.label, message: `Label of ${s.id} changed; the guide text may be outdated.` });
      if (p.selector !== s.selector) warnings.push({ code: 'SELECTOR_CHANGED', step: s.n, id: s.id, from: p.selector, to: s.selector, message: `Selector of ${s.id} changed.` });
    }
  }
  const pwVersion = (() => { try { return resolveModule('playwright/package.json')?.version || null; } catch { return null; } })();
  const stepsDoc = {
    version: 1, spec: path.basename(spec.file), guideConfig: cfg.file ? path.basename(cfg.file) : null, capturedAt: new Date().toISOString(), playwright: pwVersion, viewport: vp,
    locale: { requested: cfg.locale, navigatorLanguage: navLang, pageLangs: [...pageLangs], mismatch: flagged.locale.length > 0, mismatchSteps: flagged.locale },
    env: { class: plan.env.class, hosts: plan.env.hosts, allowed: plan.env.allowed, advisory: plan.env.advisory, confirmed, contacted: [...contacted.keys()].sort(), contactedMethods: Object.fromEntries([...contacted].sort(([x], [y]) => (x < y ? -1 : 1))) },
    task: plan.task,
    plan: { signature: plan.signature, steps: plan.steps.map((s) => ({ n: s.n, id: s.id, action: s.action })) },
    steps: doc.steps, warnings,
  };
  if (navLang && navLang.toLowerCase() !== cfg.locale.toLowerCase()) warnings.push({ code: 'NAVIGATOR_LOCALE', message: `navigator.language is ${navLang}, expected ${cfg.locale}.` });

  // ---- promote: stage everything first, then swap (renames only) and roll back on failure ----
  const imgs = gpath(spec, 'images'); const old = gpath(spec, 'images.old');
  const mdFile = gpath(spec, 'guide.md'); const skelFile = gpath(spec, 'guide.skeleton.md');
  const skeleton = skeletonMarkdown(stepsDoc, cfg);
  const hadImgs = fs.existsSync(imgs);
  const createMd = !strictSignature && !fs.existsSync(mdFile);
  const done = { moved: false, imgs: false, steps: false, skel: false };
  let priorSteps = null; let priorSkel = null;
  try {
    rmrf(old);
    if (fs.existsSync(stepsFile)) priorSteps = fs.readFileSync(stepsFile);
    if (fs.existsSync(skelFile)) priorSkel = fs.readFileSync(skelFile);
    if (hadImgs) {
      const foreign = fs.readdirSync(imgs).filter((f) => !/^\d{2,3}-.+\.png$/.test(f));
      for (const f of foreign) fs.cpSync(path.join(imgs, f), path.join(staging, 'images', f), { recursive: true }); // files and sub-folders alike
      if (foreign.length) warnings.push({ code: 'USER_IMAGES_KEPT', message: `Kept ${foreign.length} non-generated file(s) in images/; put your own pictures in guide/assets/ instead.` });
    }
    if (prev && prev.plan?.signature !== plan.signature && fs.existsSync(mdFile)) {
      const hist = ensureDir(gpath(spec, 'history'));
      fs.copyFileSync(mdFile, path.join(hist, `guide.md.${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`));
      warnings.push({ code: 'MERGE_NEEDED', message: 'The plan changed: guide.md was backed up to guide/history/ and kept as is. Rebuild it from guide.skeleton.md, carrying over text by step id.' });
    }
    writeJson(path.join(staging, 'steps.json'), stepsDoc);
    fs.writeFileSync(path.join(staging, 'guide.skeleton.md'), skeleton);
    // swap: nothing below copies data
    if (hadImgs) { fs.renameSync(imgs, old); done.moved = true; }
    fs.renameSync(path.join(staging, 'images'), imgs); done.imgs = true;
    fs.renameSync(path.join(staging, 'steps.json'), stepsFile); done.steps = true;
    fs.renameSync(path.join(staging, 'guide.skeleton.md'), skelFile); done.skel = true;
    if (createMd) { fs.writeFileSync(mdFile, skeleton); log('info', `created ${rel(mdFile)} from the skeleton (edit this file; it is never overwritten)`); }
    rmrf(old);
  } catch (e) {
    try { // roll back only what was swapped
      if (done.imgs) rmrf(imgs);
      if (done.moved && fs.existsSync(old)) fs.renameSync(old, imgs);
      if (done.steps) { if (priorSteps) fs.writeFileSync(stepsFile, priorSteps); else rmrf(stepsFile); }
      if (done.skel) { if (priorSkel) fs.writeFileSync(skelFile, priorSkel); else rmrf(skelFile); }
    } catch { /* best effort */ }
    throw e;
  } finally { rmrf(staging); }
  for (const w of warnings) log('warn', `${w.code}${w.steps ? ` (steps ${w.steps.join(',')})` : w.step ? ` (step ${w.step})` : ''}: ${w.message}`);
  log('ok', `Captured ${stepsDoc.steps.length} step(s) → ${rel(gpath(spec, 'images'))}`);
  return stepsDoc;
}

/** Writes guide.skeleton.md (always) and guide.md (only when createGuide and it does not exist yet). Returns the skeleton text. */
export function writeSkeleton(spec, cfg, stepsDoc, { createGuide = true } = {}) {
  const md = skeletonMarkdown(stepsDoc, cfg);
  fs.writeFileSync(gpath(spec, 'guide.skeleton.md'), md);
  if (createGuide && !fs.existsSync(gpath(spec, 'guide.md'))) { fs.writeFileSync(gpath(spec, 'guide.md'), md); log('info', `created ${rel(gpath(spec, 'guide.md'))} from the skeleton (edit this file; it is never overwritten)`); }
  return md;
}

// ---------- render ----------
const loadSteps = (spec) => {
  const doc = readJson(gpath(spec, 'steps.json'), null);
  if (!doc) guideFail('NO_CAPTURE', `No guide/steps.json yet — run: node demo.mjs guide capture ${rel(spec.file)}`);
  if (!doc.plan?.signature || !Array.isArray(doc.steps) || !doc.task) guideFail('NO_CAPTURE', `guide/steps.json is incomplete or damaged — run: node demo.mjs guide capture ${rel(spec.file)}`);
  return doc;
};

/** Checks a guide.md against steps.json and the files on disk. Returns { errors, warnings } of { code, message, ... }. */
function checkGuide(spec, md, doc) {
  const errors = []; const warnings = [];
  const images = scanImages(md);
  const unclosed = findUnclosedComment(md);
  if (unclosed) errors.push({ code: 'UNCLOSED_COMMENT', line: unclosed, message: `line ${unclosed}: "<!--" is never closed with "-->" (the rest of the guide would be hidden)` });
  for (const im of images) {
    if (/^(https?:)?\/\//i.test(im.src)) errors.push({ code: 'REMOTE_IMAGE', line: im.line, message: `line ${im.line}: remote image ${im.src} (guides are rendered offline)` });
    else if (!fs.existsSync(path.resolve(guideDir(spec), im.src))) errors.push({ code: 'MISSING_IMAGE', line: im.line, message: `line ${im.line}: image not found: ${im.src}` });
    if (!im.alt.trim() || /^(screenshot|image|picture)$/i.test(im.alt.trim())) errors.push({ code: 'EMPTY_ALT', line: im.line, message: `line ${im.line}: image needs a descriptive alt text` });
  }
  if (/TODO\(guide\)/.test(md)) warnings.push({ code: 'TODO_PLACEHOLDER', message: `guide.md still has ${(md.match(/TODO\(guide\)/g) || []).length} TODO(guide) placeholder(s)` });
  const blocks = parseStepBlocks(md);
  const want = doc.steps.map((s) => s.id);
  const have = blocks.map((b) => b.id);
  if (blocks.some((b, i) => b.n !== i + 1) || want.join() !== have.join()) warnings.push({ code: 'STEP_MARKERS_MISMATCH', message: `step markers in guide.md (${have.join(', ') || 'none'}) differ from steps.json (${want.join(', ')})` });
  for (const s of doc.steps) {
    const b = blocks.find((x) => x.id === s.id); if (!b) continue;
    const missing = ['title', 'text', 'note', 'warning'].filter((k) => s.overrides?.[k] && !b.text.includes(s.overrides[k]));
    if (missing.length) warnings.push({ code: 'OVERRIDE_NOT_APPLIED', step: s.n, message: `step ${s.n} (${s.id}): guide.yaml ${missing.join('/')} not found in guide.md (guide.md wins)` });
  }
  if (doc.steps.length > MAX_STEPS) warnings.push({ code: 'TOO_MANY_STEPS', message: `${doc.steps.length} steps (> ${MAX_STEPS})` });
  for (const w of doc.warnings || []) if (['LOCALE_MISMATCH', 'DATA_CREATING', 'MASK_UNMATCHED'].includes(w.code)) warnings.push({ ...w });
  return { errors, warnings };
}

/** guide.md -> guide.html -> guide-draft.pdf (+ contact sheet, render.json). Writes nothing when there are error findings. */
export async function render(spec, cfg) {
  const doc = loadSteps(spec);
  const mdFile = gpath(spec, 'guide.md');
  if (!fs.existsSync(mdFile)) guideFail('NO_GUIDE_MD', `guide/guide.md is missing — run "guide capture" (it creates it from the skeleton).`);
  const md = fs.readFileSync(mdFile, 'utf8');
  const { errors, warnings } = checkGuide(spec, md, doc);
  const bodyHtml = mdToHtml(md);
  const fonts = cfg.pdf.fonts.map((f) => ({ ...f, url: pathToFileURL(f.abs).href }));
  const html = printHtml({
    title: doc.task.title, bodyHtml, brand: spec.brand, format: cfg.pdf.format, fonts, date: new Date().toISOString().slice(0, 10), lang: cfg.locale.split('-')[0],
    logoUri: spec.brand.logo && fs.existsSync(spec.abs(spec.brand.logo)) ? fileToDataUri(spec.abs(spec.brand.logo)) : null,
  });
  const leaks = scanSecrets([{ file: 'guide.md', text: md }, { file: 'steps.json', text: JSON.stringify(doc, null, 2) }, { file: 'guide.html', text: html }], secretValues(spec));
  for (const l of leaks) errors.push({ code: 'SECRET_LEAK', file: l.file, line: l.line, message: `${l.file} line ${l.line} contains the value of \${${l.varName}}` });
  if (/<img[^>]+src="https?:/i.test(html)) errors.push({ code: 'REMOTE_IMAGE', message: 'guide.html references a remote image' });
  if (errors.length) { for (const e of errors) log('err', `${e.code}: ${e.message}`); for (const w of warnings) log('warn', `${w.code}: ${w.message}`); return { ok: false, findings: { errors, warnings }, files: {} }; }

  const { chromium } = requireModule('playwright');
  const gdir = guideDir(spec);
  const htmlFile = path.join(gdir, 'guide.html'); const draft = path.join(gdir, 'guide-draft.pdf');
  ensureDir(path.join(gdir, 'preview'));
  const sheetHtml = path.join(gdir, 'preview', 'contact-sheet.html'); const sheetPng = path.join(gdir, 'preview', 'contact-sheet.png');
  fs.writeFileSync(htmlFile, html);
  fs.writeFileSync(sheetHtml, contactSheetHtml(doc, { brand: spec.brand }));
  const browser = await chromium.launch({ args: ['--disable-blink-features=AutomationControlled'] });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } });
    const page = await ctx.newPage();
    await page.route('**/*', (r) => (/^(file|data|blob):/.test(r.request().url()) ? r.continue() : r.abort())); // offline (AC-6.4)
    await page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready.then(() => true));
    const fam = (spec.brand.font || '').split(',')[0].trim().replace(/^["']|["']$/g, '');
    if (fam && !(await page.evaluate((f) => document.fonts.check(`12px "${f}"`), fam).catch(() => true)) && !cfg.pdf.fonts.some((f) => f.family === fam)) {
      warnings.push({ code: 'FONT_FALLBACK', message: `Brand font "${fam}" is not installed; a fallback font was used (add pdf.fonts in guide.yaml).` });
    }
    const footer = `<div style="font-size:8px;width:100%;text-align:center;color:#6b7280;font-family:sans-serif">${(doc.task.title || 'User guide').replace(/[<>&]/g, '')} · <span class="pageNumber"></span>/<span class="totalPages"></span></div>`;
    const opts = { path: `${draft}.tmp`, format: cfg.pdf.format, printBackground: true, preferCSSPageSize: true, displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: footer };
    try { await page.pdf({ ...opts, tagged: true, outline: true }); } catch (e) {
      if (!/tagged|outline/i.test(String(e.message))) throw e;
      warnings.push({ code: 'PDF_UNTAGGED', message: 'This Playwright version has no tagged/outline PDF options; the PDF has no outline/tags.' });
      await page.pdf(opts);
    }
    fs.renameSync(`${draft}.tmp`, draft);
    await page.goto(pathToFileURL(sheetHtml).href, { waitUntil: 'load' });
    await page.screenshot({ path: sheetPng, fullPage: true });
    await ctx.close();
  } finally { await browser.close(); }

  const imgHashes = {};
  for (const im of new Set(scanImages(md).map((i) => i.src))) imgHashes[im] = fileSha(path.resolve(gdir, im));
  const renderDoc = { renderedAt: new Date().toISOString(), guideMdSha256: sha256(md), stepsSignature: doc.plan.signature, images: imgHashes, pdfSha256: fileSha(draft), findings: { errors, warnings } };
  writeJson(path.join(gdir, 'render.json'), renderDoc);
  for (const w of warnings) log('warn', `${w.code}: ${w.message}`);
  log('ok', `Rendered ${rel(draft)} (draft — not approved) and ${rel(sheetPng)}`);
  return { ok: true, findings: { errors, warnings }, files: { html: htmlFile, pdf: draft, sheet: sheetPng, render: path.join(gdir, 'render.json') } };
}

// ---------- refresh / approve ----------
/** Re-capture images only (same file names) and re-render. Never writes guide.md. Plan mismatch -> { ok:false, code:'PLAN_MISMATCH', diff } and nothing is touched. */
export async function refresh(spec, cfg, { confirmEnv = [], headed = false } = {}) {
  const prev = readJson(gpath(spec, 'steps.json'), null);
  if (!prev) guideFail('NO_CAPTURE', `No guide/steps.json yet — run the first capture: node demo.mjs guide capture ${rel(spec.file)}`);
  if (!prev.plan?.signature || !Array.isArray(prev.plan.steps)) guideFail('NO_CAPTURE', `guide/steps.json has no plan (damaged?) — run: node demo.mjs guide capture ${rel(spec.file)}`);
  const plan = buildPlan(spec, cfg);
  if (plan.signature !== prev.plan.signature) {
    const lines = formatDiff(diffPlans(prev.plan.steps, plan.steps.map((s) => ({ n: s.n, id: s.id, action: s.action }))));
    return { ok: false, code: 'PLAN_MISMATCH', diff: lines };
  }
  const doc = await capture(spec, cfg, { confirmEnv, headed, strictSignature: true, compare: true });
  const r = await render(spec, cfg);
  return { ...r, doc };
}

/** Promote guide-draft.pdf to guide.pdf once render.json still matches guide.md, the images and the PDF. */
export function approve(spec) {
  const gdir = guideDir(spec);
  const rj = readJson(path.join(gdir, 'render.json'), null); const draft = path.join(gdir, 'guide-draft.pdf');
  if (!rj || !fs.existsSync(draft)) guideFail('NOT_RENDERED', `Nothing to approve — run: node demo.mjs guide render ${rel(spec.file)}`);
  const mdFile = path.join(gdir, 'guide.md');
  const stale = [];
  const md = fs.existsSync(mdFile) ? fs.readFileSync(mdFile) : null;
  if (!md || sha256(md) !== rj.guideMdSha256) stale.push('guide.md changed since the last render');
  for (const [im, h] of Object.entries(rj.images || {})) { const f = path.resolve(gdir, im); if (!fs.existsSync(f) || fileSha(f) !== h) stale.push(`${im} changed since the last render`); }
  if (fileSha(draft) !== rj.pdfSha256) stale.push('guide-draft.pdf changed since the last render');
  const doc = readJson(gpath(spec, 'steps.json'), null);
  if (!doc || doc.plan?.signature !== rj.stepsSignature) stale.push('steps.json changed since the last render');
  if (stale.length) guideFail('STALE_RENDER', `Cannot approve:\n${stale.map((s) => `  - ${s}`).join('\n')}\n  Re-render first: node demo.mjs guide render ${rel(spec.file)}`);
  if (md && /TODO\(guide\)/.test(md.toString('utf8'))) guideFail('TODO_LEFT', 'Cannot approve: guide.md still has TODO(guide) placeholders.');
  if (rj.findings?.errors?.length) guideFail('RENDER_ERRORS', 'Cannot approve: the last render had errors.');
  const pdf = path.join(gdir, 'guide.pdf');
  fs.renameSync(draft, pdf);
  const approval = { approvedAt: new Date().toISOString(), pdfSha256: rj.pdfSha256, guideMdSha256: rj.guideMdSha256, stepsSignature: rj.stepsSignature };
  writeJson(path.join(gdir, 'approval.json'), approval);
  log('ok', `Approved → ${rel(pdf)}`);
  return { pdf, approval };
}

// ---------- CLI ----------
const stepSummary = (doc) => doc.steps.map((s) => ({ n: s.n, id: s.id, action: s.action, label: s.target?.label ?? '', images: s.images }));
const confirmList = (flags) => parseConfirmEnv(flags['confirm-env']);
const emit = (flags, obj) => { if (flags.json) console.log(JSON.stringify(obj, null, 2)); };

/** `specOrLoader`: a loaded spec, or a function that loads it (so spec-load failures also yield the --json failure document). */
export async function guideCli(sub, specOrLoader, flags = {}) {
  if (flags.json) logState.stderr = true; // stdout carries only the JSON document
  try {
    let spec = specOrLoader;
    if (typeof specOrLoader === 'function') {
      try { spec = specOrLoader(); } catch (e) {
        if (e instanceof DemoError && !e.code) e.code = /^Spec not found/.test(e.message) ? 'SPEC_NOT_FOUND' : /^Environment variable/.test(e.message) ? 'ENV_MISSING' : 'SPEC_INVALID';
        throw e;
      }
    }
    const cfg = loadGuideConfig(spec);
    switch (sub) {
      case 'plan': {
        const plan = buildPlan(spec, cfg);
        emit(flags, { ok: true, steps: planView(plan), warnings: plan.warnings, env: plan.env, task: plan.task, signature: plan.signature });
        if (!flags.json) {
          log('info', `${plan.steps.length} step(s) · env ${plan.env.class} (${plan.env.hosts.join(', ')}) · locale ${cfg.locale}`);
          for (const s of plan.steps) log('dim', `${String(s.n).padStart(2, '0')} ${s.id.padEnd(24)} ${s.action.padEnd(9)} ${s.selector || ''}${s.envRefs.length ? `  (uses \${${s.envRefs.join('}, ${')}})` : ''}`);
          for (const w of plan.warnings) log('warn', `${w.code}: ${w.message}`);
        }
        return;
      }
      case 'capture': {
        const doc = await capture(spec, cfg, { confirmEnv: confirmList(flags), headed: !!flags.headed });
        emit(flags, { ok: true, steps: stepSummary(doc), warnings: doc.warnings, files: { steps: gpath(spec, 'steps.json'), skeleton: gpath(spec, 'guide.skeleton.md'), guide: gpath(spec, 'guide.md'), images: gpath(spec, 'images') } });
        return;
      }
      case 'render': {
        const r = await render(spec, cfg);
        emit(flags, { ok: r.ok, findings: r.findings, files: r.files });
        if (!r.ok) process.exitCode = 1;
        return;
      }
      case 'refresh': {
        const r = await refresh(spec, cfg, { confirmEnv: confirmList(flags), headed: !!flags.headed });
        if (r.code === 'PLAN_MISMATCH') {
          log('err', `The flow no longer matches the captured guide (nothing was changed):\n${r.diff.map((l) => `  ${l}`).join('\n')}\n  Fix demo.yaml/guide.yaml, or regenerate with "guide capture" (guide.md is backed up and must be merged by step id).`);
          emit(flags, { ok: false, code: 'PLAN_MISMATCH', diff: r.diff });
          process.exitCode = 2;
          return;
        }
        emit(flags, { ok: r.ok, steps: stepSummary(r.doc), warnings: r.doc.warnings, findings: r.findings, files: r.files });
        if (!r.ok) process.exitCode = 1;
        return;
      }
      case 'approve': {
        const r = approve(spec);
        emit(flags, { ok: true, files: { pdf: r.pdf }, approval: r.approval });
        return;
      }
      default: guideFail('USAGE', `Usage: guide <${GUIDE_SUBS.join('|')}> <spec> [--confirm-env=<host[,host]>] [--headed] [--json]`);
    }
  } catch (e) {
    if (flags.json) console.log(JSON.stringify({ ok: false, code: e?.code || (e instanceof DemoError ? 'ERROR' : 'INTERNAL'), error: String(e?.message ?? e) }, null, 2));
    throw e;
  }
}
