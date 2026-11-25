// Markdown subset, sentence templates and HTML builders for the user guide (no browser needed).
// Pure functions only, so they can be unit-tested offline.
import { escapeHtml } from './util.mjs';

// ---------- sentence / alt templates (FR-9, FR-10) ----------
/** guide.yaml `manual[].verb` -> annotation verb and sentence template ({L} = the quoted control). Default: look. */
export const MANUAL_VERB = {
  look: { ann: 'Look at', text: 'Look at {L}.' }, find: { ann: 'Find', text: 'Find {L}.' }, click: { ann: 'Click', text: 'Click {L}.' },
  type: { ann: 'Type in', text: 'Type in {L}.' }, select: { ann: 'Choose in', text: 'In {L}, choose an option.' },
  check: { ann: 'Check', text: 'Check {L}.' }, hover: { ann: 'Point to', text: 'Point to {L}.' },
};
const ANNOT_VERB = { click: 'Click', dblclick: 'Double-click', type: 'Type in', fill: 'Type in', select: 'Choose in', check: 'Select', uncheck: 'Clear', upload: 'Upload', hover: 'Point to', goto: 'Open', manual: 'Look at' };

/** Human word for the kind of control, used in alt text and when a label is missing. */
export function roleWord(role, tag, inputType) {
  const r = String(role || '').toLowerCase(); const t = String(tag || '').toLowerCase(); const it = String(inputType || '').toLowerCase();
  if (r === 'link' || t === 'a') return 'link';
  if (r === 'combobox' || r === 'listbox' || t === 'select') return 'drop-down list';
  if (r === 'checkbox' || it === 'checkbox' || it === 'radio' || r === 'radio') return 'check box';
  if (r === 'textbox' || t === 'textarea' || (t === 'input' && !['submit', 'button', 'reset', 'file'].includes(it))) return 'field';
  if (r === 'button' || t === 'button' || ['submit', 'button', 'reset', 'file'].includes(it)) return 'button';
  return 'control';
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Text drawn on the screenshot label, e.g. `Type in "Name"`; `label` override wins. */
export function annotationLabel({ action, label, key, override, verb: manualVerb }) {
  if (override) return clip(String(override), 40);
  if (action === 'press') return clip(`Press ${key || 'a key'}`, 40);
  const verb = action === 'manual' ? (MANUAL_VERB[manualVerb] || MANUAL_VERB.look).ann : (ANNOT_VERB[action] || 'Look at');
  return label ? clip(`${verb} "${label}"`, 40) : verb;
}

/** Template title / sentence / alt text for one steps.json entry (English only; labels are quoted verbatim). */
export function stepTemplate(s) {
  // an explicit `label:` wins for manual steps and fills in when the DOM label is missing (icon buttons) or withheld (masked targets)
  const label = (s.action === 'manual' && s.overrides?.label) || s.target?.label || s.overrides?.label || '';
  const word = roleWord(s.target?.role, s.target?.tag, s.target?.inputType);
  const L = label ? `**${label}**` : `the highlighted ${word}`;
  const value = s.valueRedacted ? null : s.value;
  let text;
  switch (s.action) {
    case 'click': text = `Click ${L}.`; break;
    case 'dblclick': text = `Double-click ${L}.`; break;
    case 'type': case 'fill':
      text = s.target?.isPassword || s.valueRedacted
        ? `In ${label ? `the **${label}** field` : 'the highlighted field'}, type your ${s.target?.isPassword ? 'password' : 'value'}.`
        : `In ${label ? `the **${label}** field` : 'the highlighted field'}, type \`${value ?? ''}\`.`;
      break;
    case 'select': text = `In ${L}, select ${value ? `**${value}**` : 'an option'}.`; break;
    case 'check': text = `Select the ${label ? `**${label}** ` : ''}check box.`; break;
    case 'uncheck': text = `Clear the ${label ? `**${label}** ` : ''}check box.`; break;
    case 'upload': text = `Click ${L} and choose the file to upload.`; break;
    case 'press': text = `Press **${s.key || 'the key'}**.`; break;
    case 'hover': text = `Point to ${L}.`; break;
    case 'goto': text = `Go to the **${s.page?.title || 'next'}** page.`; break;
    case 'manual': text = (MANUAL_VERB[s.verb] || MANUAL_VERB.look).text.replace('{L}', L); break;
    default: text = `${ANNOT_VERB[s.action] || 'Use'} ${L}.`;
  }
  const quoted = label ? `the "${label}" ${word}` : `the highlighted ${word}`;
  return {
    title: s.annotation?.label || annotationLabel({ action: s.action, label, key: s.key, verb: s.verb }),
    text,
    altFull: `Step ${s.n}: ${quoted} is highlighted`,
    altCloseup: `Close-up of ${quoted}`,
  };
}

// ---------- guide.skeleton.md / guide.md ----------
const TODO = (what) => `TODO(guide): ${what}`;

export function skeletonMarkdown(doc, cfg) {
  const t = doc.task;
  const out = [`<!-- guide:meta version=1 locale=${doc.locale?.requested || 'en-US'} -->`, `# ${t.title || TODO('title')}`, '', '## Goal', t.goal || TODO('goal'), ''];
  if (t.prerequisites?.length) out.push('## Prerequisites', ...t.prerequisites.map((p) => `- ${p}`), '');
  out.push('## Steps', '');
  for (const s of doc.steps) {
    const o = s.overrides || {};
    out.push(`<!-- guide:step n=${s.n} id=${s.id} -->`, `### ${s.n}. ${o.title || s.template.title}`, o.text || s.template.text, '');
    out.push(`![${s.template.altFull}](${s.images.full})`);
    if (s.images.closeup) out.push(`![${s.template.altCloseup}](${s.images.closeup})`);
    if (o.note) out.push('', `> **Note:** ${o.note}`);
    if (o.warning) out.push('', `> **Warning:** ${o.warning}`);
    out.push('<!-- /guide:step -->', '');
  }
  out.push('## Expected result', t.expectedResult || TODO('expected result'), '');
  return out.join('\n');
}

/** Step blocks of a guide.md: [{ n, id, text, line }] (text = everything between the markers). */
export function parseStepBlocks(md) {
  const lines = String(md).split('\n'); const blocks = []; let cur = null;
  lines.forEach((ln, i) => {
    const open = /^<!--\s*guide:step\s+n=(\d+)\s+id=(\S+)\s*-->\s*$/.exec(ln);
    if (open) { cur = { n: Number(open[1]), id: open[2], line: i + 1, text: [] }; return; }
    if (/^<!--\s*\/guide:step\s*-->\s*$/.test(ln)) { if (cur) { cur.text = cur.text.join('\n'); blocks.push(cur); } cur = null; return; }
    if (cur) cur.text.push(ln);
  });
  if (cur) { cur.text = cur.text.join('\n'); blocks.push(cur); }
  return blocks;
}

/** Every `![alt](src)` image of a guide.md: [{ alt, src, line }]. */
export function scanImages(md) {
  const out = [];
  String(md).split('\n').forEach((ln, i) => { for (const m of ln.matchAll(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g)) out.push({ alt: m[1], src: m[2], line: i + 1 }); });
  return out;
}

/** Line number (1-based) of a line-leading `<!--` that is never closed by a later `-->`, or null. */
export function findUnclosedComment(md) {
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*<!--/.test(lines[i])) continue;
    const end = commentEnd(lines, i);
    if (end < 0) return i + 1;
    i = end;
  }
  return null;
}
function commentEnd(lines, i) { for (let j = i; j < lines.length; j++) if (lines[j].includes('-->')) return j; return -1; }

// ---------- Markdown subset -> HTML (raw HTML is escaped; nothing is fetched remotely) ----------
function safeHref(u) { return /^(https?:|mailto:|#|[\w./-]+$)/i.test(u) ? u : null; }

function inline(text) {
  const codes = [];
  let s = escapeHtml(text).replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])/g, '<em>$1</em>')
    .replace(/(?<!\w)_(?!\s)(.+?)(?<!\s)_(?!\w)/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => { const h = safeHref(u.replace(/&amp;/g, '&')); return h ? `<a href="${escapeHtml(h)}">${t}</a>` : t; });
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

export function mdToHtml(md) {
  const lines = String(md).replace(/\r\n?/g, '\n').split('\n');
  const html = []; let i = 0; let inStep = false;
  const blank = (l) => !l.trim();
  const special = (l) => /^(#{1,4})\s+/.test(l) || /^\s*([-*]|\d+\.)\s+/.test(l) || /^>/.test(l) || /^!\[.*\]\(.+\)\s*$/.test(l) || /^-{3,}\s*$/.test(l) || /^\s*<!--/.test(l);
  while (i < lines.length) {
    const ln = lines[i];
    if (blank(ln)) { i++; continue; }
    const open = /^\s*<!--\s*guide:step\s+n=(\d+)\s+id=(\S+)\s*-->\s*$/.exec(ln);
    if (open) { if (inStep) html.push('</section>'); html.push(`<section class="step" data-n="${open[1]}" data-id="${escapeHtml(open[2])}">`); inStep = true; i++; continue; }
    if (/^\s*<!--\s*\/guide:step\s*-->\s*$/.test(ln)) { if (inStep) html.push('</section>'); inStep = false; i++; continue; }
    if (/^\s*<!--/.test(ln)) { const end = commentEnd(lines, i); if (end >= 0) { i = end + 1; continue; } } // an unclosed comment is kept as visible text (render reports UNCLOSED_COMMENT)
    const h = /^(#{1,4})\s+(.*?)\s*#*\s*$/.exec(ln);
    if (h) { html.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^-{3,}\s*$/.test(ln)) { html.push('<hr>'); i++; continue; }
    const img = /^!\[([^\]]*)\]\(([^)\s]+)[^)]*\)\s*$/.exec(ln);
    if (img) {
      const closeup = /-closeup\.[a-z]+$/i.test(img[2]);
      html.push(`<figure class="${closeup ? 'closeup' : 'full'}"><img src="${escapeHtml(img[2])}" alt="${escapeHtml(img[1])}"></figure>`); i++; continue;
    }
    if (/^>/.test(ln)) {
      const body = [];
      while (i < lines.length && /^>/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ''));
      const text = body.join(' ').trim();
      const kind = /^\*\*(Note|Warning|Tip):\*\*/i.exec(text);
      html.push(kind ? `<aside class="callout ${kind[1].toLowerCase()}">${inline(text)}</aside>` : `<blockquote>${inline(text)}</blockquote>`);
      continue;
    }
    const li = /^\s*([-*]|\d+\.)\s+/.exec(ln);
    if (li) {
      const ordered = /\d/.test(li[1]); const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i]) && /\d/.test(/^\s*([-*]|\d+\.)/.exec(lines[i])[1]) === ordered) items.push(`<li>${inline(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ''))}</li>`);
      html.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    const para = [];
    while (i < lines.length && !blank(lines[i]) && (para.length === 0 || !special(lines[i]))) para.push(lines[i++].trim());
    html.push(`<p>${inline(para.join(' '))}</p>`);
  }
  if (inStep) html.push('</section>');
  return html.join('\n');
}

// ---------- print HTML (ADR-0005) ----------
const mm = { A4: '296mm', Letter: '278mm' };

export function printHtml({ title, bodyHtml, brand, format = 'A4', logoUri = null, fonts = [], date, lang = 'en' }) {
  const fontFaces = fonts.map((f) => `@font-face{font-family:${JSON.stringify(f.family)};src:url("${f.url}");font-weight:${f.weight || 'normal'};font-style:${f.style || 'normal'}}`).join('\n');
  // the first <h1> of guide.md becomes the cover title; the cover shows it, so drop it from the body
  const h1 = /<h1>([\s\S]*?)<\/h1>/.exec(bodyHtml);
  const coverTitle = h1 ? h1[1] : escapeHtml(title || 'User guide');
  const body = h1 ? bodyHtml.replace(h1[0], '') : bodyHtml;
  return `<!doctype html>
<html lang="${escapeHtml(lang)}"><head><meta charset="utf-8"><title>${escapeHtml(title || 'User guide')}</title>
<style>
${fontFaces}
@page { size: ${format}; margin: 16mm 14mm 18mm; }
@page :first { margin: 0; }
*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;font-family:${brand.font};color:#111827;font-size:11pt;line-height:1.5}
.cover{height:${mm[format] || mm.A4};padding:30mm 24mm;background:${brand.background};color:${brand.text};display:flex;flex-direction:column;justify-content:center;page-break-after:always}
.cover img.logo{max-height:18mm;max-width:60mm;object-fit:contain;margin-bottom:18mm;align-self:flex-start}
.cover h1{font-size:30pt;line-height:1.15;margin:0 0 8mm;border-left:3mm solid ${brand.primary};padding-left:6mm}
.cover .date{opacity:.7;font-size:11pt;margin-top:12mm}
.content{padding:0}
h2{font-size:16pt;color:${brand.primary};margin:8mm 0 3mm;break-after:avoid}
h3{font-size:13pt;margin:6mm 0 2mm;break-after:avoid}
p{margin:0 0 3mm}
code{font-family:Menlo,Consolas,monospace;background:#f3f4f6;padding:0 1mm;border-radius:1mm;font-size:10pt}
ul,ol{margin:0 0 3mm;padding-left:6mm}
section.step{break-inside:avoid;margin-bottom:6mm}
section.step h3{counter-reset:none}
figure{margin:3mm 0;break-inside:avoid}
figure img{display:block;border:.3mm solid #d1d5db;border-radius:1mm}
figure.full img{max-width:100%;max-height:120mm;object-fit:contain}
figure.closeup img{max-width:60%;max-height:70mm;object-fit:contain}
aside.callout{border-left:1.2mm solid ${brand.primary};background:#f9fafb;padding:2mm 4mm;margin:3mm 0;break-inside:avoid}
aside.warning{border-color:#d97706;background:#fffbeb}
aside.tip{border-color:#059669;background:#ecfdf5}
blockquote{margin:3mm 0;padding-left:4mm;border-left:1mm solid #d1d5db;color:#4b5563}
a{color:${brand.primary}}
</style></head><body>
<div class="cover">${logoUri ? `<img class="logo" src="${logoUri}" alt="">` : ''}<h1>${coverTitle}</h1><div class="date">${escapeHtml(date || '')}</div></div>
<main class="content">
${body}
</main></body></html>
`;
}

// ---------- contact sheet ----------
export function contactSheetHtml(doc, { brand, imgBase = '../' } = {}) {
  const cells = doc.steps.map((s) => {
    const flags = [s.flags?.localeMismatch ? '⚠ locale' : '', s.flags?.mutatingHint ? '⚠ data' : '', s.flags?.ambiguous ? '⚠ ambiguous' : ''].filter(Boolean).join(' ');
    return `<div class="cell"><img class="full" src="${escapeHtml(imgBase + s.images.full)}" alt="">${s.images.closeup ? `<img class="close" src="${escapeHtml(imgBase + s.images.closeup)}" alt="">` : ''}
<div class="cap"><b>${String(s.n).padStart(2, '0')}</b> · ${escapeHtml(s.id)} · ${escapeHtml(s.action)}${s.target?.label ? ` · “${escapeHtml(s.target.label)}”` : ''} ${flags ? `<span class="flag">${escapeHtml(flags)}</span>` : ''}</div></div>`;
  }).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;padding:20px;width:1500px;background:#0b0d12;color:#e5e7eb;font-family:${brand.font};font-size:14px}
h1{font-size:20px;margin:0 0 14px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.cell{background:#161a23;border-radius:8px;padding:8px;position:relative}
img.full{width:100%;display:block;border-radius:4px}
img.close{max-height:110px;max-width:60%;margin-top:6px;border-radius:4px;border:1px solid #374151}
.cap{margin-top:6px}.flag{color:#fbbf24}
</style></head><body><h1>${escapeHtml(doc.task?.title || 'User guide')} — ${doc.steps.length} step(s)</h1><div class="grid">
${cells}
</div></body></html>
`;
}
