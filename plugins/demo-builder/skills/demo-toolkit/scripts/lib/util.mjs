// Shared helpers for the demo-builder toolkit. No third-party dependencies.
import { spawn, spawnSync, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCRIPTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TOOLKIT_DIR = path.resolve(SCRIPTS_DIR, '..');
export const CACHE_HOME = process.env.DEMO_BUILDER_HOME || path.join(os.homedir(), '.cache', 'demo-builder');

const COLORS = { info: '\x1b[36m', ok: '\x1b[32m', warn: '\x1b[33m', err: '\x1b[31m', dim: '\x1b[2m' };
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
export function log(level, ...msg) {
  const tag = { info: '•', ok: '✔', warn: '!', err: '✖', dim: ' ' }[level] || '•';
  const line = `${tag} ${msg.join(' ')}`;
  const out = level === 'err' || level === 'warn' ? process.stderr : process.stdout;
  out.write((useColor ? `${COLORS[level] || ''}${line}\x1b[0m` : line) + '\n');
}

export class DemoError extends Error {}
export function fail(msg) { throw new DemoError(msg); }

// ---------- module resolution (playwright, yaml) ----------
let globalRoot;
function npmGlobalRoot() {
  if (globalRoot !== undefined) return globalRoot;
  try { globalRoot = execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { globalRoot = null; }
  return globalRoot;
}

/** Resolve an npm package from: toolkit dir, cwd, ~/.cache/demo-builder, global npm root. */
export function resolveModule(name) {
  const bases = [SCRIPTS_DIR, process.cwd(), CACHE_HOME];
  for (const base of bases) {
    try { return createRequire(path.join(base, 'noop.js'))(name); } catch { /* next */ }
  }
  const g = npmGlobalRoot();
  if (g) {
    try { return createRequire(path.join(g, 'noop.js'))(name); } catch { /* fallthrough */ }
  }
  return null;
}

export function requireModule(name, hint) {
  const mod = resolveModule(name);
  if (!mod) fail(`Missing npm package "${name}". ${hint || `Run: node demo.mjs setup  (or: npm i -g ${name})`}`);
  return mod;
}

// ---------- processes ----------
export function which(cmd) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null;
}

export function run(cmd, args, { quiet = true, input, cwd, env } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, env: env ? { ...process.env, ...env } : process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = Buffer.alloc(0); let stderr = '';
    p.stdout.on('data', (d) => { stdout = Buffer.concat([stdout, d]); if (!quiet) process.stdout.write(d); });
    p.stderr.on('data', (d) => { stderr += d; if (!quiet) process.stderr.write(d); });
    p.on('error', (e) => reject(new DemoError(`${cmd} failed to start: ${e.message}`)));
    p.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new DemoError(`${cmd} exited with ${code}\n  args: ${args.join(' ')}\n${stderr.split('\n').slice(-15).join('\n')}`));
    });
    if (input) p.stdin.end(input); else p.stdin.end();
  });
}

export async function ffmpeg(args) {
  return run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
}

export async function probeDuration(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
  const d = parseFloat(stdout.toString().trim());
  if (!Number.isFinite(d)) fail(`Could not read duration of ${file}`);
  return d;
}

export async function probeStreams(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]);
  return JSON.parse(stdout.toString());
}

// ---------- files ----------
export function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); return d; }
export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
export function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
export function hash(...parts) {
  return createHash('sha256').update(parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join('\u0000')).digest('hex').slice(0, 16);
}
export function fileToDataUri(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const mime = { svg: 'image/svg+xml', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }[ext] || 'application/octet-stream';
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

// ---------- misc ----------
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function fmtTime(sec, sep = ',') {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000); const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000); const r = ms % 1000;
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)}${sep}${p(r, 3)}`;
}
export function fmtChapter(sec) {
  const s = Math.floor(sec); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Parse argv into { _: positional[], flags } — supports --k v, --k=v, --flag. */
export function parseArgs(argv, booleans = []) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split(/=(.*)/s, 2);
      if (v !== undefined) out.flags[k] = v;
      else if (!booleans.includes(k) && argv[i + 1] && !argv[i + 1].startsWith('--')) out.flags[k] = argv[++i];
      else out.flags[k] = true;
    } else out._.push(a);
  }
  return out;
}
