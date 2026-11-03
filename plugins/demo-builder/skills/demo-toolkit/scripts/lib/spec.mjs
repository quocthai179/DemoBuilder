// Load, validate and normalise a demo spec (demo.yaml / demo.json).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveModule, fail, log } from './util.mjs';

export const ACTIONS = {
  goto: 'url',
  click: 'selector',
  dblclick: 'selector',
  hover: 'selector',
  type: 'selector',
  fill: 'selector',
  press: 'key',
  select: 'selector',
  check: 'selector',
  uncheck: 'selector',
  upload: 'selector',
  scroll: 'selector',
  wait: 'ms',
  waitFor: 'selector',
  waitForUrl: 'url',
  highlight: 'selector',
  callout: 'selector',
  spotlight: 'selector',
  clear: null,
  zoom: 'selector',
  unzoom: null,
  moveTo: 'selector',
  at: 'seconds',
  caption: 'text',
  screenshot: 'path',
  evaluate: 'script',
  reload: null,
};

const DEFAULTS = {
  language: 'en-US',
  viewport: { width: 1600, height: 900 },
  output: { dir: 'output', name: 'demo', width: 1920, height: 1080, fps: 30, formats: ['mp4'], crf: 20, background: '#0b0d12' },
  voice: { provider: 'edge', voice: null, rate: '+0%', pitch: '+0Hz', volume: '+0%', lexicon: {}, model: null, instructions: null },
  timing: { audioDelay: 0.4, tail: 0.6, typeDelay: 55, moveMs: 650, actionGap: 350, highlightMs: 1400 },
  cursor: { show: true, color: '#111827', ring: '#6366f1', size: 22, clickRipple: true },
  captions: { sidecar: true, burn: false, maxChars: 42, maxLines: 2, style: 'FontName=Arial,FontSize=18,PrimaryColour=&H00FFFFFF,OutlineColour=&H80000000,BorderStyle=3,Outline=1,Shadow=0,MarginV=36' },
  music: null,
  brand: { primary: '#6366f1', accent: '#22d3ee', background: '#0b0d12', text: '#f8fafc', font: 'Inter, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif', logo: null },
  mask: [],
  hide: [],
  headless: true,
  loudness: -16,
};

const WPM = { vi: 165, en: 150, ja: 300, zh: 260, ko: 280, default: 150 };

function loadYaml(text, file) {
  const yaml = resolveModule('yaml');
  if (yaml) return yaml.parse(text);
  // Fallback: python3 + PyYAML (commonly available).
  const r = spawnSync('python3', ['-c', 'import sys,json,yaml;print(json.dumps(yaml.safe_load(sys.stdin.read())))'], { input: text, encoding: 'utf8' });
  if (r.status === 0) return JSON.parse(r.stdout);
  fail(`Cannot parse ${file}: install the "yaml" npm package (node demo.mjs setup) or use a .json spec.`);
}

function merge(base, over) {
  if (over === undefined || over === null) return base;
  if (typeof base !== 'object' || base === null || Array.isArray(base) || typeof over !== 'object' || Array.isArray(over)) return over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = merge(base[k], v);
  return out;
}

const ENV_RE = /\$\{([A-Z0-9_]+)(?::-(.*?))?\}/g;
function interpolateEnv(value, where) {
  if (typeof value === 'string') {
    return value.replace(ENV_RE, (_, name, def) => {
      if (process.env[name] !== undefined) return process.env[name];
      if (def !== undefined) return def;
      fail(`Environment variable ${name} is not set (used in ${where}). Export it before running.`);
    });
  }
  if (Array.isArray(value)) return value.map((v) => interpolateEnv(v, where));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, interpolateEnv(v, where)]));
  return value;
}

/** Normalise `- click: "#save"` / `- type: {selector, text}` / `- wait: 500` into {name, ...args}. */
export function normaliseAction(raw, where) {
  if (typeof raw === 'string') {
    if (raw in ACTIONS) return { name: raw };
    fail(`${where}: unknown action "${raw}"`);
  }
  if (!raw || typeof raw !== 'object') fail(`${where}: action must be an object, got ${JSON.stringify(raw)}`);
  const keys = Object.keys(raw).filter((k) => k in ACTIONS);
  if (keys.length !== 1) fail(`${where}: action must have exactly one of [${Object.keys(ACTIONS).join(', ')}], got ${JSON.stringify(raw)}`);
  const name = keys[0];
  const value = raw[name];
  const extra = Object.fromEntries(Object.entries(raw).filter(([k]) => k !== name));
  const primary = ACTIONS[name];
  let args = {};
  if (value === null || value === undefined || value === true) args = {};
  else if (typeof value === 'object' && !Array.isArray(value)) args = { ...value };
  else if (primary) args = { [primary]: value };
  return { name, ...args, ...extra };
}

export function estimateSeconds(text, language) {
  const lang = String(language || 'en').slice(0, 2).toLowerCase();
  const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
  return words ? (words / (WPM[lang] || WPM.default)) * 60 : 0;
}

export function loadSpec(specPath) {
  const file = path.resolve(specPath || 'demo.yaml');
  if (!fs.existsSync(file)) fail(`Spec not found: ${file}`);
  const text = fs.readFileSync(file, 'utf8');
  const raw = /\.json$/i.test(file) ? JSON.parse(text) : loadYaml(text, file);
  if (!raw || typeof raw !== 'object') fail(`${file} is empty or not a mapping`);

  const spec = merge(DEFAULTS, raw);
  spec.file = file;
  spec.root = path.dirname(file);
  spec.abs = (p) => (p ? (path.isAbsolute(p) ? p : path.resolve(spec.root, p)) : p);
  // `paths` lets a localised spec reuse another spec's recordings: paths: { recordings: ../acme-vi/recordings }
  const pth = spec.paths || {};
  spec.dirs = {
    audio: spec.abs(pth.audio || 'audio'), recordings: spec.abs(pth.recordings || 'recordings'), cards: spec.abs(pth.cards || 'cards'),
    build: spec.abs(pth.build || 'build'), review: spec.abs(pth.review || 'review'), output: spec.abs(spec.output.dir),
  };
  if (!spec.title) spec.title = path.basename(spec.root);
  if (!Array.isArray(spec.scenes) || !spec.scenes.length) fail(`${file}: "scenes" must be a non-empty list`);

  if (spec.baseUrl) spec.baseUrl = interpolateEnv(spec.baseUrl, 'baseUrl');
  spec.setup = (spec.setup || []).map((a, i) => normaliseAction(interpolateEnv(a, `setup[${i}]`), `setup[${i}]`));

  const ids = new Set();
  spec.scenes = spec.scenes.map((s, i) => {
    const where = `scenes[${i}]`;
    if (!s || typeof s !== 'object') fail(`${where} must be a mapping`);
    const id = String(s.id || `scene-${String(i + 1).padStart(2, '0')}`);
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) fail(`${where}: id "${id}" may only contain letters, digits, - and _`);
    if (ids.has(id)) fail(`${where}: duplicate scene id "${id}"`);
    ids.add(id);
    const type = s.type || (s.actions || s.url ? 'screen' : 'card');
    if (!['screen', 'card'].includes(type)) fail(`${where}: type must be "screen" or "card"`);
    const scene = {
      ...s, id, type, index: i,
      narration: String(s.narration || '').trim(),
      voice: merge(spec.voice, s.voice),
      url: s.url ? interpolateEnv(s.url, `${where}.url`) : null,
      actions: (s.actions || []).map((a, j) => normaliseAction(interpolateEnv(a, `${where}.actions[${j}]`), `${where}.actions[${j}] (${id})`)),
      chapter: s.chapter ?? (type === 'card' ? s.title : null) ?? null,
    };
    if (type === 'card' && scene.actions.length) log('warn', `${where} (${id}) is a card; its actions are ignored`);
    return scene;
  });
  return spec;
}

/** Return a list of human-readable problems (empty = valid). */
export function validateSpec(spec) {
  const problems = [];
  const screenScenes = spec.scenes.filter((s) => s.type === 'screen');
  if (screenScenes.length && !spec.baseUrl && !screenScenes[0].url && screenScenes[0].actions[0]?.name !== 'goto')
    problems.push(`First screen scene "${screenScenes[0].id}" has no url and there is no baseUrl — the browser would start on about:blank.`);
  for (const s of spec.scenes) {
    if (!s.narration && !s.audio && s.type === 'card' && !s.duration) problems.push(`Card "${s.id}" has no narration and no duration.`);
    if (s.audio && !fs.existsSync(spec.abs(s.audio))) problems.push(`Scene "${s.id}": audio file not found: ${s.audio}`);
    let lastAt = -1;
    for (const a of s.actions) {
      const p = ACTIONS[a.name];
      if (p && p !== 'ms' && a[p] === undefined && !['scroll', 'zoom', 'screenshot', 'moveTo'].includes(a.name))
        problems.push(`Scene "${s.id}": action "${a.name}" is missing "${p}".`);
      if (a.name === 'type' && a.text === undefined) problems.push(`Scene "${s.id}": "type" needs "text".`);
      if (a.name === 'at') {
        const t = Number(a.seconds);
        if (!Number.isFinite(t)) problems.push(`Scene "${s.id}": "at" needs a number of seconds.`);
        else if (t < lastAt) problems.push(`Scene "${s.id}": "at: ${t}" goes back in time (previous at: ${lastAt}).`);
        else lastAt = t;
      }
    }
  }
  if (spec.music?.file && !fs.existsSync(spec.abs(spec.music.file))) problems.push(`music.file not found: ${spec.music.file}`);
  if (spec.brand?.logo && !fs.existsSync(spec.abs(spec.brand.logo))) problems.push(`brand.logo not found: ${spec.brand.logo}`);
  return problems;
}

export function selectScenes(spec, flag) {
  if (!flag || flag === true) return spec.scenes;
  const want = String(flag).split(',').map((s) => s.trim()).filter(Boolean);
  const missing = want.filter((w) => !spec.scenes.some((s) => s.id === w));
  if (missing.length) fail(`Unknown scene id(s): ${missing.join(', ')}`);
  return spec.scenes.filter((s) => want.includes(s.id));
}
