// Cut, sync and mix the final video with ffmpeg; write captions, chapters, thumbnail and extra formats.
import fs from 'node:fs';
import path from 'node:path';
import { ffmpeg, probeDuration, ensureDir, readJson, writeJson, log, fail, fmtTime, fmtChapter } from './util.mjs';
import { captionText } from './tts.mjs';
import { sceneNeed } from './record.mjs';
import { renderImageCard } from './cards.mjs';

/** Compute the final timeline: where each scene comes from and how long it lasts. */
export function plan(spec) {
  const manifest = readJson(path.join(spec.dirs.audio, 'manifest.json'), {});
  const timeline = readJson(path.join(spec.dirs.recordings, 'timeline.json'), { scenes: {} });
  let t = 0; const items = []; const problems = [];
  for (const s of spec.scenes) {
    const n = sceneNeed(spec, s, manifest);
    const audio = manifest[s.id];
    if (s.narration && !audio) problems.push(`${s.id}: no voice-over audio (run tts)`);
    const delay = s.audioDelay ?? spec.timing.audioDelay;
    let item;
    if (s.type === 'card') {
      const png = path.join(spec.dirs.cards, `${s.id}.png`);
      if (!fs.existsSync(png)) problems.push(`${s.id}: card image missing (run record or cards)`);
      const duration = Math.max(s.duration || 0, n.need, 2.5);
      item = { id: s.id, type: 'card', png, duration };
    } else {
      const tl = timeline.scenes[s.id];
      if (!tl) { problems.push(`${s.id}: not recorded yet (run record)`); item = { id: s.id, type: 'screen', missing: true, duration: n.need || 3 }; }
      else {
        const seg = Math.max(0.5, tl.end - tl.start - (s.trimEnd || 0) - (s.trimStart || 0));
        item = { id: s.id, type: 'screen', file: path.join(spec.dirs.recordings, tl.file), start: tl.start + (s.trimStart || 0), seg, duration: Math.max(seg, n.need) };
        if (audio && (tl.audioEstimated || (tl.audioHash && tl.audioHash !== audio.hash))) problems.push(`${s.id}: voice-over changed after recording — re-record this scene for exact sync`);
      }
    }
    item.offset = t; item.audio = audio?.file || null; item.audioDuration = audio?.duration || 0; item.audioDelay = delay;
    item.narration = s.narration; item.chapter = s.chapter; item.transition = s.transition ?? (s.type === 'card' ? 'fade' : 'none');
    items.push(item); t += item.duration;
  }
  return { items, total: t, problems };
}

/** Split narration into caption cues timed proportionally to text length. */
export function buildCues(spec, p) {
  const { maxChars, maxLines } = spec.captions;
  const cues = [];
  for (const it of p.items) {
    const text = captionText(it.narration);
    if (!text || !it.audioDuration) continue;
    const sentences = text.match(/[^.!?。？！]+[.!?。？！]*["”']?\s*/g) || [text];
    const chunks = [];
    for (const sentence of sentences) {
      const words = sentence.trim().split(/\s+/); let line = []; let lines = []; let cur = [];
      for (const w of words) {
        if ([...line, w].join(' ').length > maxChars && line.length) {
          lines.push(line.join(' ')); line = [];
          if (lines.length === maxLines) { cur.push(lines.join('\n')); lines = []; }
        }
        line.push(w);
      }
      if (line.length) lines.push(line.join(' '));
      if (lines.length) cur.push(lines.join('\n'));
      chunks.push(...cur);
    }
    const weights = chunks.map((c) => c.replace(/\s/g, '').length + 3);
    const total = weights.reduce((a, b) => a + b, 0);
    let at = it.offset + it.audioDelay;
    chunks.forEach((c, i) => {
      const d = (weights[i] / total) * it.audioDuration;
      cues.push({ start: at, end: at + d - 0.05, text: c }); at += d;
    });
  }
  return cues;
}

export function writeCaptions(spec, cues, base) {
  const srt = cues.map((c, i) => `${i + 1}\n${fmtTime(c.start)} --> ${fmtTime(c.end)}\n${c.text}\n`).join('\n');
  const vtt = 'WEBVTT\n\n' + cues.map((c) => `${fmtTime(c.start, '.')} --> ${fmtTime(c.end, '.')}\n${c.text}\n`).join('\n');
  fs.writeFileSync(`${base}.srt`, srt); fs.writeFileSync(`${base}.vtt`, vtt);
  return { srt: `${base}.srt`, vtt: `${base}.vtt` };
}

export function writeChapters(p, file) {
  const ch = p.items.filter((i) => i.chapter);
  if (!ch.length) return null;
  if (ch[0].offset > 0) ch.unshift({ offset: 0, chapter: 'Intro' });
  fs.writeFileSync(file, ch.map((c) => `${fmtChapter(c.offset)} ${c.chapter}`).join('\n') + '\n');
  return file;
}

async function renderClip(spec, it, out) {
  const { width: W, height: H, fps, background } = spec.output;
  const D = it.duration.toFixed(3);
  const fit = `scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${background.replace('#', '0x')},setsar=1`;
  const inputs = []; let v;
  if (it.type === 'card') { inputs.push('-loop', '1', '-framerate', String(fps), '-t', D, '-i', it.png); v = `[0:v]${fit},fps=${fps}`; }
  else if (it.missing) { inputs.push('-f', 'lavfi', '-t', D, '-i', `color=c=${background.replace('#', '0x')}:s=${W}x${H}:r=${fps}`); v = '[0:v]setsar=1'; }
  else {
    const pad = Math.max(0, it.duration - it.seg + 0.1).toFixed(3);
    inputs.push('-ss', it.start.toFixed(3), '-t', it.seg.toFixed(3), '-i', it.file);
    v = `[0:v]fps=${fps},${fit},tpad=stop_mode=clone:stop_duration=${pad}`;
  }
  v += `,trim=duration=${D}`;
  if (it.transition === 'fade') v += `,fade=t=in:st=0:d=0.35,fade=t=out:st=${Math.max(0, it.duration - 0.35).toFixed(3)}:d=0.35`;
  v += ',format=yuv420p[v]';
  let a;
  if (it.audio) {
    inputs.push('-i', it.audio);
    const ms = Math.round(it.audioDelay * 1000);
    a = `[1:a]aformat=sample_rates=48000:channel_layouts=stereo,adelay=${ms}|${ms},apad,atrim=duration=${D}[a]`;
  } else {
    inputs.push('-f', 'lavfi', '-t', D, '-i', 'anullsrc=r=48000:cl=stereo');
    a = `[1:a]atrim=duration=${D}[a]`;
  }
  await ffmpeg([...inputs, '-filter_complex', `${v};${a}`, '-map', '[v]', '-map', '[a]', '-r', String(fps),
    '-c:v', 'libx264', '-preset', 'medium', '-crf', String(spec.output.crf), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-t', D, out]);
}

export async function assemble(spec, { draft = false, formats, burn } = {}) {
  const p = plan(spec);
  const blocking = p.problems.filter((x) => /not recorded|card image missing/.test(x));
  p.problems.forEach((x) => log('warn', x));
  if (blocking.length && !draft) fail(`Cannot assemble: ${blocking.length} scene(s) missing. Use --draft to render placeholders.`);
  ensureDir(spec.dirs.build); ensureDir(spec.dirs.output);
  const name = spec.output.name;
  const clips = [];
  for (const it of p.items) {
    const out = path.join(spec.dirs.build, `${String(clips.length + 1).padStart(2, '0')}-${it.id}.mp4`);
    log('info', `clip ${it.id} (${it.duration.toFixed(1)}s)`);
    await renderClip(spec, it, out);
    clips.push(out);
  }
  const list = path.join(spec.dirs.build, 'concat.txt');
  fs.writeFileSync(list, clips.map((c) => `file '${c.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
  const joined = path.join(spec.dirs.build, 'joined.mp4');
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined]);

  const cues = buildCues(spec, p);
  const caps = spec.captions.sidecar || spec.captions.burn || burn ? writeCaptions(spec, cues, path.join(spec.dirs.output, name)) : null;
  const chapters = writeChapters(p, path.join(spec.dirs.output, `${name}.chapters.txt`));

  // Final mix: optional music bed (ducked under the voice), loudness normalisation, optional burned captions.
  const final = path.join(spec.dirs.output, `${name}.mp4`);
  const total = await probeDuration(joined);
  const args = ['-i', joined]; let af;
  const music = spec.music?.file ? spec.abs(spec.music.file) : null;
  if (music) {
    args.push('-stream_loop', '-1', '-i', music);
    const vol = spec.music.volume ?? 0.15; const fadeOut = Math.max(0, total - 2.5).toFixed(2);
    const bed = `[1:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${vol},atrim=duration=${total.toFixed(3)},afade=t=in:d=1.5,afade=t=out:st=${fadeOut}:d=2.5[bed]`;
    af = spec.music.duck === false
      ? `${bed};[0:a][bed]amix=inputs=2:duration=first:normalize=0[mix]`
      : `${bed};[0:a]asplit=2[vo][sc];[bed][sc]sidechaincompress=threshold=0.03:ratio=6:attack=15:release=450[duck];[vo][duck]amix=inputs=2:duration=first:normalize=0[mix]`;
    af += `;[mix]loudnorm=I=${spec.loudness}:TP=-1.5:LRA=11[aout]`;
  } else af = `[0:a]loudnorm=I=${spec.loudness}:TP=-1.5:LRA=11[aout]`;
  const doBurn = (burn ?? spec.captions.burn) && caps && cues.length;
  if (doBurn) {
    const esc = caps.srt.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
    args.push('-filter_complex', `${af};[0:v]subtitles='${esc}':force_style='${spec.captions.style}'[vout]`, '-map', '[vout]', '-map', '[aout]',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', String(spec.output.crf), '-pix_fmt', 'yuv420p');
  } else args.push('-filter_complex', af, '-map', '0:v', '-map', '[aout]', '-c:v', 'copy');
  args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', final);
  log('info', `mixing final (${total.toFixed(1)}s${music ? ', music ducked' : ''}${doBurn ? ', burned captions' : ''})`);
  await ffmpeg(args);

  const outputs = { video: final, captions: caps, chapters };
  const want = new Set(formats ? String(formats).split(',') : spec.output.formats);
  if (!draft) {
    if (want.has('vertical')) outputs.vertical = await exportVertical(spec, final, path.join(spec.dirs.output, `${name}-vertical.mp4`));
    if (want.has('square')) outputs.square = await exportSquare(spec, final, path.join(spec.dirs.output, `${name}-square.mp4`));
    if (want.has('gif')) outputs.gif = await exportGif(spec, final, path.join(spec.dirs.output, `${name}-preview.gif`));
    outputs.thumbnail = await exportThumbnail(spec, p, joined, path.join(spec.dirs.output, `${name}-thumbnail.png`));
  }
  writeJson(path.join(spec.dirs.output, `${name}.timeline.json`), { total, items: p.items.map(({ id, type, offset, duration, audioDuration, chapter }) => ({ id, type, offset: +offset.toFixed(3), duration: +duration.toFixed(3), audioDuration: +audioDuration.toFixed(3), chapter })) });
  log('ok', `Final video → ${path.relative(process.cwd(), final)} (${fmtChapter(total)})`);
  return outputs;
}

async function exportVertical(spec, src, out) {
  const fc = '[0:v]split[a][b];[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:2,eq=brightness=-0.08[bg];[b]scale=1080:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]';
  await ffmpeg(['-i', src, '-filter_complex', fc, '-map', '[v]', '-map', '0:a', '-c:v', 'libx264', '-crf', '21', '-preset', 'medium', '-c:a', 'copy', '-movflags', '+faststart', out]);
  log('ok', `vertical 9:16 → ${path.relative(process.cwd(), out)}`); return out;
}
async function exportSquare(spec, src, out) {
  const fc = '[0:v]split[a][b];[a]scale=1080:1080:force_original_aspect_ratio=increase,crop=1080:1080,boxblur=24:2[bg];[b]scale=1080:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]';
  await ffmpeg(['-i', src, '-filter_complex', fc, '-map', '[v]', '-map', '0:a', '-c:v', 'libx264', '-crf', '21', '-c:a', 'copy', '-movflags', '+faststart', out]);
  log('ok', `square 1:1 → ${path.relative(process.cwd(), out)}`); return out;
}
async function exportGif(spec, src, out) {
  const g = spec.output.gif || {}; const start = g.start ?? 0; const dur = g.duration ?? 12; const w = g.width ?? 960; const fps = g.fps ?? 12;
  await ffmpeg(['-ss', String(start), '-t', String(dur), '-i', src, '-filter_complex', `[0:v]fps=${fps},scale=${w}:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, out]);
  log('ok', `GIF preview → ${path.relative(process.cwd(), out)}`); return out;
}
async function exportThumbnail(spec, p, src, out) {
  const th = spec.output.thumbnail || {};
  const firstScreen = p.items.find((i) => i.type === 'screen' && !i.missing);
  const at = th.at ?? (firstScreen ? firstScreen.offset + firstScreen.duration * 0.6 : 1);
  const frame = path.join(spec.dirs.build, 'thumb-frame.png');
  await ffmpeg(['-ss', at.toFixed(2), '-i', src, '-frames:v', '1', frame]);
  if (th.title === false) { fs.copyFileSync(frame, out); return out; }
  await renderImageCard(spec, { title: th.title || spec.title, eyebrow: th.eyebrow, subtitle: th.subtitle, background: frame, layout: 'left', titleSize: 110, width: 1280, height: 720 }, out);
  log('ok', `thumbnail → ${path.relative(process.cwd(), out)}`); return out;
}
