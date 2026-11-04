#!/usr/bin/env node
// demo-builder toolkit CLI — turn a demo.yaml into a narrated product demo video.
// Usage: node demo.mjs <command> [spec] [--flags]   (run "node demo.mjs help")
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs, log, which, resolveModule, run, ensureDir, readJson, DemoError, CACHE_HOME, TOOLKIT_DIR, fmtChapter } from './lib/util.mjs';
import { loadSpec, validateSpec, estimateSeconds } from './lib/spec.mjs';

const HELP = `demo-builder toolkit

  node demo.mjs doctor                       check ffmpeg, Playwright, TTS providers, API keys
  node demo.mjs setup                        install playwright + yaml into ${CACHE_HOME}
  node demo.mjs init <dir> [--title "..."]   scaffold <dir>/demo.yaml (+ .gitignore)
  node demo.mjs validate <spec>              check the spec; print scenes and estimated durations
  node demo.mjs inspect <url> [--spec s] [--out dir] [--storage auth.json]
                                             screenshot + table of clickable elements & selectors
  node demo.mjs voices [--lang vi-VN]        list free Edge TTS voices
  node demo.mjs tts <spec> [--scenes a,b] [--provider silent] [--force]
  node demo.mjs record <spec> [--scenes a,b] [--headed] [--dry]
  node demo.mjs cards <spec>                 render title/outro cards only
  node demo.mjs assemble <spec> [--draft] [--formats mp4,vertical,square,gif] [--burn]
  node demo.mjs captions <spec>              write .srt/.vtt + chapters without rendering
  node demo.mjs review <spec>                frames, contact sheet, loudness/pacing report
  node demo.mjs build <spec> [--provider p]  tts → record → assemble → review
  node demo.mjs status <spec>                what is done / stale for each scene
  node demo.mjs clean <spec> [--all]         delete unused takes + build/ (--all: every generated file)

<spec> defaults to ./demo.yaml. Paths in the spec are relative to the spec file.`;

async function doctor() {
  const rows = [];
  const ok = (name, good, detail, fix) => rows.push({ name, good, detail, fix });
  const [maj] = process.versions.node.split('.').map(Number);
  ok('node ≥ 18', maj >= 18, process.versions.node, 'Install Node.js 18+');
  for (const bin of ['ffmpeg', 'ffprobe']) ok(bin, !!which(bin), which(bin) || 'missing', 'brew install ffmpeg | apt install ffmpeg | winget install ffmpeg');
  if (which('ffmpeg')) {
    const f = spawnSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8' }).stdout || '';
    ok('ffmpeg subtitles filter (burn captions)', / subtitles /.test(f), / subtitles /.test(f) ? 'libass ok' : 'missing', 'Use an ffmpeg build with libass (optional)');
  }
  const pw = resolveModule('playwright');
  ok('playwright', !!pw, pw ? 'found' : 'missing', 'node demo.mjs setup');
  if (pw) {
    try { const b = await pw.chromium.launch(); await b.close(); ok('chromium', true, 'launches'); }
    catch (e) { ok('chromium', false, String(e.message).split('\n')[0], 'npx playwright install chromium'); }
  }
  ok('yaml parser', !!resolveModule('yaml') || spawnSync('python3', ['-c', 'import yaml']).status === 0, resolveModule('yaml') ? 'npm yaml' : 'python3 PyYAML fallback', 'node demo.mjs setup  (or use demo.json)');
  const edge = which('edge-tts') || spawnSync('python3', ['-c', 'import edge_tts']).status === 0;
  ok('edge-tts (free voices incl. vi-VN)', edge, edge ? 'found' : 'missing', 'pip install edge-tts');
  ok('espeak-ng (offline voice)', !!(which('espeak-ng') || which('espeak')), which('espeak-ng') || 'missing (optional)', 'apt install espeak-ng (optional)');
  for (const k of ['OPENAI_API_KEY', 'ELEVENLABS_API_KEY', 'GOOGLE_TTS_API_KEY']) ok(k, !!process.env[k], process.env[k] ? 'set' : 'not set (optional)', `export ${k}=...`);
  for (const r of rows) log(r.good ? 'ok' : (/optional/.test(r.detail) ? 'dim' : 'warn'), `${r.name.padEnd(38)} ${r.detail}${r.good || !r.fix ? '' : `  → ${r.fix}`}`);
  const critical = rows.filter((r) => !r.good && ['ffmpeg', 'ffprobe', 'playwright', 'chromium', 'node ≥ 18'].includes(r.name));
  if (critical.length) { log('err', `${critical.length} required tool(s) missing.`); process.exitCode = 1; }
  else log('ok', 'Ready to build demos.');
}

async function setup() {
  ensureDir(CACHE_HOME);
  if (!fs.existsSync(path.join(CACHE_HOME, 'package.json'))) fs.writeFileSync(path.join(CACHE_HOME, 'package.json'), '{"name":"demo-builder-runtime","private":true}\n');
  log('info', `Installing playwright + yaml into ${CACHE_HOME}`);
  await run('npm', ['install', '--no-audit', '--no-fund', 'playwright@^1.48', 'yaml@^2'], { cwd: CACHE_HOME, quiet: false });
  log('info', 'Installing Chromium for Playwright');
  await run('npx', ['playwright', 'install', 'chromium'], { cwd: CACHE_HOME, quiet: false });
  if (!which('edge-tts')) log('warn', 'For free neural voices also run: pip install edge-tts');
  if (!which('ffmpeg')) log('warn', 'ffmpeg is required: brew install ffmpeg | apt install ffmpeg | winget install ffmpeg');
  log('ok', 'Setup complete. Run: node demo.mjs doctor');
}

function init(dir, flags) {
  if (!dir) throw new DemoError('Usage: init <dir>');
  ensureDir(dir);
  const target = path.join(dir, 'demo.yaml');
  if (fs.existsSync(target) && !flags.force) throw new DemoError(`${target} already exists (use --force to overwrite)`);
  let tpl = fs.readFileSync(path.join(TOOLKIT_DIR, 'templates', 'demo.yaml'), 'utf8');
  if (flags.title) tpl = tpl.replace(/^title: .*$/m, `title: ${JSON.stringify(flags.title)}`);
  if (flags.lang) tpl = tpl.replace(/^language: .*$/m, `language: ${flags.lang}`);
  if (flags.url) tpl = tpl.replace(/^baseUrl: .*$/m, `baseUrl: ${flags.url}`);
  fs.writeFileSync(target, tpl);
  fs.writeFileSync(path.join(dir, '.gitignore'), 'audio/\nrecordings/\ncards/\nbuild/\nreview/\noutput/\n*.auth.json\n');
  log('ok', `Created ${target}`);
}

function validate(spec) {
  const problems = validateSpec(spec);
  let total = 0;
  log('info', `${spec.title} — ${spec.scenes.length} scene(s), language ${spec.language}, voice ${spec.voice.provider}${spec.voice.voice ? `/${spec.voice.voice}` : ''}`);
  for (const s of spec.scenes) {
    const est = estimateSeconds(s.narration, spec.language);
    const d = Math.max(est + spec.timing.audioDelay + spec.timing.tail, s.duration || 0, s.type === 'card' ? 2.5 : 0);
    total += d;
    log('dim', `${s.id.padEnd(22)} ${s.type.padEnd(6)} ~${d.toFixed(1).padStart(5)}s  ${s.actions.length} action(s)  ${s.narration.slice(0, 60)}${s.narration.length > 60 ? '…' : ''}`);
  }
  log('info', `Estimated length ≈ ${fmtChapter(total)}${spec.targetDuration ? ` (target ${fmtChapter(spec.targetDuration)})` : ''}`);
  if (problems.length) { problems.forEach((p) => log('warn', p)); process.exitCode = 1; } else log('ok', 'Spec is valid.');
  return problems;
}

function status(spec) {
  const manifest = readJson(path.join(spec.dirs.audio, 'manifest.json'), {});
  const tl = readJson(path.join(spec.dirs.recordings, 'timeline.json'), { scenes: {} });
  for (const s of spec.scenes) {
    const a = manifest[s.id]; const r = tl.scenes[s.id];
    const audio = s.narration || s.audio ? (a ? `voice ${a.duration.toFixed(1)}s` : 'voice MISSING') : 'no voice';
    const vis = s.type === 'card' ? (fs.existsSync(path.join(spec.dirs.cards, `${s.id}.png`)) ? 'card ok' : 'card MISSING') : (r ? `rec ${(r.end - r.start).toFixed(1)}s${a && (r.audioEstimated || (r.audioHash && r.audioHash !== a.hash)) ? ' (STALE: voice changed since recording)' : ''}` : 'rec MISSING');
    log(/MISSING|STALE/.test(audio + vis) ? 'warn' : 'ok', `${s.id.padEnd(22)} ${audio.padEnd(16)} ${vis}`);
  }
  const final = path.join(spec.dirs.output, `${spec.output.name}.mp4`);
  log(fs.existsSync(final) ? 'ok' : 'dim', `final: ${fs.existsSync(final) ? final : 'not rendered'}`);
}

function clean(spec, flags) {
  const rm = (p) => { if (fs.existsSync(p)) { fs.rmSync(p, { recursive: true, force: true }); log('dim', `removed ${path.relative(process.cwd(), p) || p}`); } };
  if (flags.all) { for (const k of ['audio', 'recordings', 'cards', 'build', 'review', 'output']) rm(spec.dirs[k]); return; }
  const tl = readJson(path.join(spec.dirs.recordings, 'timeline.json'), { scenes: {} });
  const used = new Set(Object.values(tl.scenes).map((x) => x.file));
  if (fs.existsSync(spec.dirs.recordings)) for (const f of fs.readdirSync(spec.dirs.recordings)) {
    if ((/^take-.*\.webm$/.test(f) && !used.has(f)) || /^error-.*\.png$/.test(f) || f === '.tmp') rm(path.join(spec.dirs.recordings, f));
  }
  rm(spec.dirs.build);
  log('ok', 'Cleaned.');
}

async function main() {
  const { _: [cmd, target], flags } = parseArgs(process.argv.slice(2), ['headed', 'dry', 'force', 'draft', 'burn', 'help', 'all']);
  if (!cmd || cmd === 'help' || flags.help) { console.log(HELP); return; }
  const spec = () => loadSpec(target || flags.spec || 'demo.yaml');
  switch (cmd) {
    case 'doctor': return doctor();
    case 'setup': return setup();
    case 'init': return init(target, flags);
    case 'validate': return validate(spec());
    case 'status': return status(spec());
    case 'clean': return clean(spec(), flags);
    case 'inspect': {
      if (!target) throw new DemoError('Usage: inspect <url> [--spec demo.yaml] [--out dir]');
      const s = flags.spec ? loadSpec(flags.spec) : null;
      const out = path.resolve(flags.out || (s ? path.join(s.dirs.review, 'inspect') : 'inspect'));
      const { inspect } = await import('./lib/record.mjs');
      const r = await inspect(target, { out, spec: s, viewport: s?.viewport, storageState: flags.storage ? path.resolve(flags.storage) : (s?.auth?.storageState ? s.abs(s.auth.storageState) : undefined) });
      log('ok', `${r.count} element(s) → ${r.md}\n  screenshot → ${r.shot}`);
      return;
    }
    case 'voices': { const { listVoices } = await import('./lib/tts.mjs'); console.log(await listVoices(flags.lang)); return; }
    case 'tts': { const { generateVoiceover } = await import('./lib/tts.mjs'); await generateVoiceover(spec(), { scenes: flags.scenes, provider: flags.provider, force: flags.force }); return; }
    case 'record': { const { record } = await import('./lib/record.mjs'); await record(spec(), { scenes: flags.scenes, headed: flags.headed, dry: flags.dry }); return; }
    case 'cards': { const { renderCards } = await import('./lib/cards.mjs'); await renderCards(spec()); return; }
    case 'assemble': case 'render': { const { assemble } = await import('./lib/assemble.mjs'); await assemble(spec(), { draft: flags.draft, formats: flags.formats, burn: flags.burn }); return; }
    case 'captions': {
      const s = spec(); const { plan, buildCues, writeCaptions, writeChapters } = await import('./lib/assemble.mjs');
      const p = plan(s); ensureDir(s.dirs.output);
      const c = writeCaptions(s, buildCues(s, p), path.join(s.dirs.output, s.output.name));
      const ch = writeChapters(p, path.join(s.dirs.output, `${s.output.name}.chapters.txt`));
      log('ok', `captions → ${c.srt}${ch ? `\n  chapters → ${ch}` : ''}`); return;
    }
    case 'review': { const { review } = await import('./lib/review.mjs'); await review(spec()); return; }
    case 'build': {
      const s = spec();
      if (validateSpec(s).length) { validate(s); throw new DemoError('Fix the spec first.'); }
      const { generateVoiceover } = await import('./lib/tts.mjs');
      const { record } = await import('./lib/record.mjs');
      const { assemble } = await import('./lib/assemble.mjs');
      const { review } = await import('./lib/review.mjs');
      log('info', '1/4 voice-over'); await generateVoiceover(s, { provider: flags.provider, force: flags.force });
      log('info', '2/4 recording'); await record(s, { headed: flags.headed });
      log('info', '3/4 assembling'); await assemble(s, { formats: flags.formats, burn: flags.burn });
      log('info', '4/4 review'); await review(s);
      return;
    }
    default: console.log(HELP); process.exitCode = 1;
  }
}

main().catch((e) => {
  log('err', e instanceof DemoError ? e.message : (e.stack || String(e)));
  process.exitCode = 1;
});
