// Voice-over generation. Providers: edge (free), openai, elevenlabs, google, espeak (offline), silent (pacing draft), file (your own recording).
import fs from 'node:fs';
import path from 'node:path';
import { run, ffmpeg, which, probeDuration, ensureDir, readJson, writeJson, hash, log, fail } from './util.mjs';
import { estimateSeconds, selectScenes } from './spec.mjs';

const DEFAULT_VOICES = {
  edge: { vi: 'vi-VN-HoaiMyNeural', en: 'en-US-AvaMultilingualNeural', ja: 'ja-JP-NanamiNeural', ko: 'ko-KR-SunHiNeural', zh: 'zh-CN-XiaoxiaoNeural', fr: 'fr-FR-DeniseNeural', de: 'de-DE-KatjaNeural', es: 'es-ES-ElviraNeural', th: 'th-TH-PremwadeeNeural', id: 'id-ID-GadisNeural' },
  openai: 'alloy',
  elevenlabs: '21m00Tcm4TlvDq8ikWAM',
  google: null,
};

export function applyLexicon(text, lexicon = {}) {
  let out = text;
  for (const [word, say] of Object.entries(lexicon || {})) {
    const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, 'gu'), say);
  }
  // Strip lightweight markup used in scripts: [pause], *emphasis*, (stage directions)
  return out.replace(/\[pause(?::\s*[\d.]+s?)?\]/gi, ', ').replace(/\*([^*]+)\*/g, '$1').replace(/\s+/g, ' ').trim();
}

export function captionText(text) {
  return String(text || '').replace(/\[pause(?::\s*[\d.]+s?)?\]/gi, ' ').replace(/\*([^*]+)\*/g, '$1').replace(/\s+/g, ' ').trim();
}

function defaultVoice(provider, language) {
  const d = DEFAULT_VOICES[provider];
  if (!d || typeof d === 'string') return d;
  return d[String(language).slice(0, 2).toLowerCase()] || d.en;
}

async function edgeTts(text, v, language, outBase) {
  const bin = which('edge-tts');
  const voice = v.voice || defaultVoice('edge', language);
  const args = ['--voice', voice, `--rate=${v.rate || '+0%'}`, `--pitch=${v.pitch || '+0Hz'}`, `--volume=${v.volume || '+0%'}`, '--text', text, '--write-media', `${outBase}.mp3`];
  if (bin) await run(bin, args);
  else if (which('python3')) await run('python3', ['-m', 'edge_tts', ...args]).catch((e) => fail(`edge-tts not available (pip install edge-tts). ${e.message}`));
  else fail('edge-tts not installed. Run: pip install edge-tts  (or pipx install edge-tts)');
  return `${outBase}.mp3`;
}

async function httpAudio(url, init, outFile, label) {
  const res = await fetch(url, init);
  if (!res.ok) fail(`${label} TTS failed: HTTP ${res.status} ${(await res.text()).slice(0, 400)}`);
  fs.writeFileSync(outFile, Buffer.from(await res.arrayBuffer()));
  return outFile;
}

async function openaiTts(text, v, language, outBase) {
  const key = process.env.OPENAI_API_KEY || fail('OPENAI_API_KEY is not set');
  const body = { model: v.model || 'gpt-4o-mini-tts', voice: v.voice || defaultVoice('openai'), input: text, response_format: 'mp3' };
  if (v.instructions) body.instructions = v.instructions;
  if (v.speed) body.speed = v.speed;
  return httpAudio(`${process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'}/audio/speech`, {
    method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, `${outBase}.mp3`, 'OpenAI');
}

async function elevenTts(text, v, language, outBase) {
  const key = process.env.ELEVENLABS_API_KEY || fail('ELEVENLABS_API_KEY is not set');
  const voice = v.voice || defaultVoice('elevenlabs');
  const body = { text, model_id: v.model || 'eleven_multilingual_v2', voice_settings: { stability: v.stability ?? 0.5, similarity_boost: v.similarity ?? 0.75, style: v.style ?? 0.2, use_speaker_boost: true } };
  if (v.languageCode) body.language_code = v.languageCode;
  return httpAudio(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
    method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg' }, body: JSON.stringify(body),
  }, `${outBase}.mp3`, 'ElevenLabs');
}

async function googleTts(text, v, language, outBase) {
  const key = process.env.GOOGLE_TTS_API_KEY || fail('GOOGLE_TTS_API_KEY is not set');
  const rate = v.speakingRate ?? 1.0;
  const res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: { text }, voice: { languageCode: language, ...(v.voice ? { name: v.voice } : {}) }, audioConfig: { audioEncoding: 'MP3', speakingRate: rate } }),
  });
  if (!res.ok) fail(`Google TTS failed: HTTP ${res.status} ${(await res.text()).slice(0, 400)}`);
  const json = await res.json();
  fs.writeFileSync(`${outBase}.mp3`, Buffer.from(json.audioContent, 'base64'));
  return `${outBase}.mp3`;
}

async function espeakTts(text, v, language, outBase) {
  const bin = which('espeak-ng') || which('espeak') || fail('espeak-ng is not installed (apt install espeak-ng / brew install espeak-ng)');
  await run(bin, ['-v', v.voice || String(language).slice(0, 2), '-s', String(v.wpm || 165), '-w', `${outBase}.wav`, text]);
  return `${outBase}.wav`;
}

async function silentTts(text, v, language, outBase) {
  const secs = Math.max(1, estimateSeconds(text, language) / (v.speed || 1));
  await ffmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', secs.toFixed(2), `${outBase}.wav`]);
  return `${outBase}.wav`;
}

const PROVIDERS = { edge: edgeTts, openai: openaiTts, elevenlabs: elevenTts, google: googleTts, espeak: espeakTts, silent: silentTts };
export const PROVIDER_NAMES = [...Object.keys(PROVIDERS), 'file'];

/** Generate narration audio for each scene; writes audio/manifest.json. Cached by text+voice hash. */
export async function generateVoiceover(spec, { scenes: sceneFlag, provider: providerOverride, force = false } = {}) {
  ensureDir(spec.dirs.audio);
  const manifestFile = path.join(spec.dirs.audio, 'manifest.json');
  const manifest = readJson(manifestFile, {});
  const scenes = selectScenes(spec, sceneFlag);
  for (const scene of scenes) {
    const v = { ...scene.voice };
    if (providerOverride) v.provider = providerOverride;
    const outBase = path.join(spec.dirs.audio, scene.id);

    if (scene.audio) { // user-supplied recording
      const file = spec.abs(scene.audio);
      const duration = await probeDuration(file);
      manifest[scene.id] = { file, duration, provider: 'file', hash: hash('file', file, fs.statSync(file).mtimeMs) };
      log('ok', `${scene.id}: using recorded audio ${path.basename(file)} (${duration.toFixed(1)}s)`);
      continue;
    }
    if (!scene.narration) { delete manifest[scene.id]; continue; }

    const text = applyLexicon(scene.narration, { ...(spec.voice.lexicon || {}), ...(v.lexicon || {}) });
    const key = hash(v.provider, v.voice, v.rate, v.pitch, v.model, v.instructions, v.speed, spec.language, text);
    const prev = manifest[scene.id];
    if (!force && prev && prev.hash === key && fs.existsSync(prev.file)) { log('dim', `${scene.id}: cached (${prev.duration.toFixed(1)}s)`); continue; }

    const fn = PROVIDERS[v.provider] || fail(`Unknown voice provider "${v.provider}". Use one of: ${PROVIDER_NAMES.join(', ')}`);
    for (const ext of ['.mp3', '.wav']) fs.rmSync(outBase + ext, { force: true });
    const file = await fn(text, v, scene.voice.language || spec.language, outBase);
    const duration = await probeDuration(file);
    const est = estimateSeconds(scene.narration, spec.language);
    manifest[scene.id] = { file, duration, provider: v.provider, voice: v.voice || defaultVoice(v.provider, spec.language), hash: key, chars: text.length };
    log('ok', `${scene.id}: ${v.provider} → ${path.basename(file)} ${duration.toFixed(1)}s${est ? ` (script estimate ${est.toFixed(1)}s)` : ''}`);
    writeJson(manifestFile, manifest);
  }
  writeJson(manifestFile, manifest);
  return manifest;
}

export async function listVoices(language) {
  const bin = which('edge-tts');
  const args = ['--list-voices'];
  const { stdout } = bin ? await run(bin, args) : await run('python3', ['-m', 'edge_tts', ...args]);
  const lines = stdout.toString().split('\n');
  const want = language ? String(language).toLowerCase() : null;
  return lines.filter((l, i) => i < 2 || !want || l.toLowerCase().includes(want)).join('\n');
}
