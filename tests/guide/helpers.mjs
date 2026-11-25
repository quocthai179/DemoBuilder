// Shared helpers for the guide test-suite (zero dependencies, node:test only).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TESTS = path.resolve(HERE, '..');
export const REPO = path.resolve(TESTS, '..');
export const FIXTURES = path.join(TESTS, 'fixtures');
export const SCRIPTS = path.join(REPO, 'plugins/demo-builder/skills/demo-toolkit/scripts');
export const DEMO = path.join(SCRIPTS, 'demo.mjs');
export const LIB = (f) => pathToFileURL(path.join(SCRIPTS, 'lib', f)).href;

const made = [];
/** Fresh temp dir (removed on process exit). */
export function tmpDir(prefix = 'guide-test-') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(d);
  return d;
}
process.on('exit', () => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

export function copyDir(src, dest) { fs.cpSync(src, dest, { recursive: true }); return dest; }
/** Copy tests/fixtures/<name> into a fresh temp dir and return it. */
export function fixtureCopy(name) { return copyDir(path.join(FIXTURES, name), path.join(tmpDir(`guide-${name}-`), name)); }

export const sha = (buf) => createHash('sha256').update(buf).digest('hex');
export const read = (...p) => fs.readFileSync(path.join(...p), 'utf8');
export const readJson = (...p) => JSON.parse(read(...p));

/** path (relative) -> sha256 of every file below `dir` (optionally skipping top-level names). */
export function snapshot(dir, skip = []) {
  const out = {};
  const walk = (d, relDir) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = relDir ? `${relDir}/${e.name}` : e.name;
      if (!relDir && skip.includes(e.name)) continue;
      if (e.isDirectory()) walk(path.join(d, e.name), r); else out[r] = sha(fs.readFileSync(path.join(d, e.name)));
    }
  };
  walk(dir, '');
  return out;
}

/** Run the CLI. Returns { status, stdout, stderr } (no throw). */
export function demo(args, { cwd, env = {}, timeout = 180000 } = {}) {
  const full = { ...process.env, NO_COLOR: '1', ...env };
  for (const k of Object.keys(full)) if (full[k] === undefined) delete full[k]; // env: { VAR: undefined } unsets VAR
  const r = spawnSync(process.execPath, [DEMO, ...args], { cwd: cwd || process.cwd(), encoding: 'utf8', timeout, env: full });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', signal: r.signal };
}
export const guide = (sub, specFile, extra = [], opts = {}) => demo(['guide', sub, specFile, ...extra], { cwd: path.dirname(specFile), ...opts });

/** PNG width/height from the IHDR chunk. */
export function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error(`${file} is not a PNG`);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

/** Why browser tests must be skipped, or null when Playwright + Chromium work. Computed once. */
export async function browserSkipReason() {
  if (process.env.GUIDE_TEST_NO_BROWSER) return 'GUIDE_TEST_NO_BROWSER is set';
  try {
    const { resolveModule } = await import(LIB('util.mjs'));
    const pw = resolveModule('playwright');
    if (!pw) return 'Playwright is not resolvable (run: node demo.mjs setup)';
    const b = await pw.chromium.launch({ headless: true });
    await b.close();
    return null;
  } catch (e) { return `Chromium cannot launch: ${String(e.message).split('\n')[0]}`; }
}

export function haveBin(cmd) { return spawnSync('which', [cmd], { encoding: 'utf8' }).status === 0; }

/** Write demo.yaml (+ optional guide.yaml) into a fresh dir and load it with the toolkit's loadSpec. */
export async function mkSpec(demoYaml, guideYaml = null, extraFiles = {}) {
  const dir = tmpDir('guide-spec-');
  fs.writeFileSync(path.join(dir, 'demo.yaml'), demoYaml);
  if (guideYaml !== null) fs.writeFileSync(path.join(dir, 'guide.yaml'), guideYaml);
  for (const [f, c] of Object.entries(extraFiles)) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), c); }
  const { loadSpec } = await import(LIB('spec.mjs'));
  return loadSpec(path.join(dir, 'demo.yaml'));
}

/** Minimal PNG decoder (8-bit RGB/RGBA, non-interlaced) -> { width, height, px(x, y) => [r, g, b] }. Enough for Playwright screenshots. */
export async function decodePng(file) {
  const zlib = await import('node:zlib');
  const b = fs.readFileSync(file);
  let pos = 8; let width; let height; let ctype; const idat = [];
  while (pos < b.length) {
    const len = b.readUInt32BE(pos); const type = b.toString('ascii', pos + 4, pos + 8); const data = b.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); ctype = data[9]; if (data[8] !== 8 || data[12] !== 0) throw new Error('unsupported PNG'); }
    if (type === 'IDAT') idat.push(data);
    pos += 12 + len;
  }
  const bpp = ctype === 6 ? 4 : ctype === 2 ? 3 : null;
  if (!bpp) throw new Error(`unsupported PNG colour type ${ctype}`);
  const raw = zlib.inflateSync(Buffer.concat(idat)); const stride = width * bpp; const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]; const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[y * stride + i - bpp] : 0; const up = y ? out[(y - 1) * stride + i] : 0; const c = i >= bpp && y ? out[(y - 1) * stride + i - bpp] : 0;
      let v = src[i];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const p = a + up - c; const pa = Math.abs(p - a); const pb = Math.abs(p - up); const pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      out[y * stride + i] = v & 255;
    }
  }
  return { width, height, px: (x, y) => [out[y * stride + x * bpp], out[y * stride + x * bpp + 1], out[y * stride + x * bpp + 2]] };
}
/** Number of pixels satisfying `test([r,g,b], x, y)`. */
export function countPixels(img, test) { let n = 0; for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (test(img.px(x, y), x, y)) n++; return n; }
/** Number of pixels that differ between two same-size decoded images. */
export function diffPixels(a, b) { if (a.width !== b.width || a.height !== b.height) return Infinity; return countPixels(a, (p, x, y) => { const q = b.px(x, y); return p[0] !== q[0] || p[1] !== q[1] || p[2] !== q[2]; }); }
