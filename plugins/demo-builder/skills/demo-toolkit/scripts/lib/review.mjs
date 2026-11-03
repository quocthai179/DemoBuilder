// Automated QA: frame grabs per scene, contact sheet, loudness, pacing and sync checks → review/report.md
import fs from 'node:fs';
import path from 'node:path';
import { ffmpeg, run, ensureDir, readJson, log, fmtChapter } from './util.mjs';
import { estimateSeconds } from './spec.mjs';

export async function review(spec) {
  const name = spec.output.name;
  const final = path.join(spec.dirs.output, `${name}.mp4`);
  const tlFile = path.join(spec.dirs.output, `${name}.timeline.json`);
  const dir = ensureDir(spec.dirs.review);
  const findings = []; const add = (sev, msg) => findings.push({ sev, msg });
  if (!fs.existsSync(final) || !fs.existsSync(tlFile)) { add('high', `No final video yet (${path.relative(process.cwd(), final)}). Run assemble first.`); return write(spec, dir, findings, null, []); }

  const tl = readJson(tlFile);
  const manifest = readJson(path.join(spec.dirs.audio, 'manifest.json'), {});
  const silentDraft = Object.values(manifest).length > 0 && Object.values(manifest).every((m) => m.provider === 'silent');
  if (silentDraft) add('high', 'Voice-over is a SILENT pacing draft — generate real audio (tts with edge/openai/elevenlabs/google or your own recording) before delivery.');
  const frames = [];
  for (const it of tl.items) {
    for (const [label, k] of [['start', 0.15], ['mid', 0.55], ['end', 0.92]]) {
      const at = it.offset + it.duration * k;
      const f = path.join(dir, `${String(frames.length).padStart(3, '0')}-${it.id}-${label}.jpg`);
      await ffmpeg(['-ss', at.toFixed(2), '-i', final, '-frames:v', '1', '-vf', 'scale=960:-2', '-q:v', '4', f]);
      frames.push({ id: it.id, label, at, file: f });
    }
  }
  const sheet = path.join(dir, 'contact-sheet.jpg');
  const cols = 3; const rows = Math.ceil(frames.length / cols);
  const list = path.join(dir, 'frames.txt');
  fs.writeFileSync(list, frames.map((f) => `file '${f.file}'`).join('\n') + '\n');
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-vf', `scale=480:-2,tile=${cols}x${rows}:padding=6:margin=6`, '-frames:v', '1', sheet]).catch(() => {});

  // Loudness (EBU R128 integrated) and true peak
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', final, '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-']).catch((e) => ({ stderr: e.message }));
  const I = parseFloat((stderr.match(/I:\s+(-?[\d.]+) LUFS/g) || []).pop()?.match(/-?[\d.]+/)?.[0]);
  const TP = parseFloat((stderr.match(/Peak:\s+(-?[\d.]+) dBFS/g) || []).pop()?.match(/-?[\d.]+/)?.[0]);
  if (!silentDraft && Number.isFinite(I) && Math.abs(I - spec.loudness) > 2) add('medium', `Integrated loudness ${I} LUFS (target ${spec.loudness}).`);
  if (Number.isFinite(TP) && TP > -1) add('medium', `True peak ${TP} dBFS > -1 dBFS — risk of clipping.`);

  // Silence detection on the voice track (dead air)
  const sil = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', final, '-af', 'silencedetect=noise=-45dB:d=3', '-f', 'null', '-']).catch((e) => ({ stderr: e.message }));
  const silences = [...String(sil.stderr).matchAll(/silence_start: ([\d.]+)[\s\S]*?silence_end: ([\d.]+)/g)].map((m) => [parseFloat(m[1]), parseFloat(m[2])]);
  if (!silentDraft) for (const [a, b] of silences) add('low', `Dead air ${(b - a).toFixed(1)}s at ${fmtChapter(a)}–${fmtChapter(b)} — tighten actions or add narration.`);

  // Pacing per scene
  for (const it of tl.items) {
    const scene = spec.scenes.find((s) => s.id === it.id);
    if (!scene) continue;
    if (scene.narration && !it.audioDuration) add('high', `${it.id}: has narration but no audio.`);
    if (it.audioDuration && it.duration - it.audioDuration > 6) add('low', `${it.id}: ${(it.duration - it.audioDuration).toFixed(1)}s of visuals without voice.`);
    const words = scene.narration.split(/\s+/).filter(Boolean).length;
    if (it.audioDuration && words) {
      const wpm = (words / it.audioDuration) * 60;
      const base = estimateSeconds(scene.narration, spec.language) ? (words / estimateSeconds(scene.narration, spec.language)) * 60 : 150;
      if (wpm > base * 1.3) add('medium', `${it.id}: narration is fast (${Math.round(wpm)} wpm) — shorten text or slow the voice.`);
    }
    if (it.type === 'screen' && it.duration > 45) add('low', `${it.id}: ${Math.round(it.duration)}s long — consider splitting into two scenes.`);
  }
  if (spec.targetDuration) {
    const diff = tl.total - spec.targetDuration;
    if (Math.abs(diff) > spec.targetDuration * 0.15) add('medium', `Total ${fmtChapter(tl.total)} vs target ${fmtChapter(spec.targetDuration)} (${diff > 0 ? '+' : ''}${Math.round(diff)}s).`);
  }
  const recDir = spec.dirs.recordings;
  if (fs.existsSync(recDir) && fs.readdirSync(recDir).some((f) => f.startsWith('error-'))) add('low', 'Old error screenshots exist in recordings/ — delete them once fixed.');
  return write(spec, dir, findings, { I, TP, total: tl.total, sheet }, frames);
}

function write(spec, dir, findings, stats, frames) {
  const order = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) => order[a.sev] - order[b.sev]);
  const md = [
    `# Automated review — ${spec.title}`, '',
    stats ? `- Duration: ${fmtChapter(stats.total)}\n- Loudness: ${stats.I ?? '?'} LUFS (target ${spec.loudness}), true peak ${stats.TP ?? '?'} dBFS\n- Contact sheet: ${stats.sheet}` : '',
    '', '## Findings', findings.length ? findings.map((f) => `- **${f.sev}** — ${f.msg}`).join('\n') : '- No automated findings.',
    '', '## Frames to inspect visually', ...frames.map((f) => `- ${f.id} (${f.label}, ${fmtChapter(f.at)}): ${f.file}`),
    '', '> Automated checks cannot see typos in the UI, leaked personal data, wrong screens or awkward cursor moves — open the frames above.',
  ].join('\n');
  const file = path.join(dir, 'report.md');
  fs.writeFileSync(file, md + '\n');
  log(findings.some((f) => f.sev === 'high') ? 'warn' : 'ok', `Review: ${findings.length} finding(s) → ${path.relative(process.cwd(), file)}`);
  return { file, findings, frames };
}
