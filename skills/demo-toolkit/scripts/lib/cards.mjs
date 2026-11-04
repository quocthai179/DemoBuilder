// Render title / chapter / outro cards and thumbnails as PNG via a headless browser.
import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, escapeHtml, fileToDataUri, log, requireModule } from './util.mjs';

export function cardHtml(spec, card, { width, height }) {
  const b = { ...spec.brand, ...(card.brand || {}) };
  const logo = b.logo && fs.existsSync(spec.abs(b.logo)) ? fileToDataUri(spec.abs(b.logo)) : null;
  const bg = card.background && fs.existsSync(spec.abs(card.background)) ? fileToDataUri(spec.abs(card.background)) : null;
  const scale = width / 1920;
  const align = card.layout === 'left' ? 'flex-start' : 'center';
  const textAlign = card.layout === 'left' ? 'left' : 'center';
  if (card.html) return card.html;
  const bullets = (card.bullets || []).map((x) => `<li>${escapeHtml(x)}</li>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box;margin:0;padding:0}
    html,body{width:${width}px;height:${height}px;overflow:hidden}
    body{font-family:${b.font};color:${b.text};background:${b.background};
      background-image:${bg ? `linear-gradient(90deg, ${b.background}f2 0%, ${b.background}b3 55%, ${b.background}40 100%), url(${bg})` : `radial-gradient(1200px 700px at 85% 10%, ${b.primary}55, transparent 60%), radial-gradient(900px 600px at 5% 95%, ${b.accent}33, transparent 60%)`};
      background-size:cover;background-position:center;display:flex;flex-direction:column;justify-content:center;align-items:${align};
      padding:${120 * scale}px ${160 * scale}px;text-align:${textAlign}}
    .logo{height:${72 * scale}px;margin-bottom:${48 * scale}px}
    .eyebrow{font-size:${30 * scale}px;letter-spacing:.14em;text-transform:uppercase;color:${b.accent};font-weight:700;margin-bottom:${24 * scale}px}
    h1{font-size:${(card.titleSize || 96) * scale}px;line-height:1.08;font-weight:800;letter-spacing:-.02em;max-width:${1500 * scale}px;${bg ? "text-shadow:0 4px 28px rgba(0,0,0,.55);" : ""}}
    .sub{font-size:${40 * scale}px;line-height:1.35;opacity:.86;margin-top:${32 * scale}px;max-width:${1300 * scale}px}
    ul{margin-top:${48 * scale}px;list-style:none;display:flex;flex-direction:column;gap:${20 * scale}px;align-items:${align}}
    li{font-size:${36 * scale}px;padding-left:${44 * scale}px;position:relative;text-align:left}
    li:before{content:"";position:absolute;left:0;top:.45em;width:${18 * scale}px;height:${18 * scale}px;border-radius:50%;background:${b.primary}}
    .cta{margin-top:${64 * scale}px;display:inline-block;background:${b.primary};color:#fff;font-weight:700;font-size:${36 * scale}px;
      padding:${22 * scale}px ${44 * scale}px;border-radius:${16 * scale}px}
    .foot{position:absolute;bottom:${56 * scale}px;font-size:${26 * scale}px;opacity:.6}
  </style></head><body>
    ${logo ? `<img class="logo" src="${logo}">` : ''}
    ${card.eyebrow ? `<div class="eyebrow">${escapeHtml(card.eyebrow)}</div>` : ''}
    <h1>${escapeHtml(card.title || spec.title)}</h1>
    ${card.subtitle ? `<div class="sub">${escapeHtml(card.subtitle)}</div>` : ''}
    ${bullets ? `<ul>${bullets}</ul>` : ''}
    ${card.cta ? `<div class="cta">${escapeHtml(card.cta)}</div>` : ''}
    ${card.footer ? `<div class="foot">${escapeHtml(card.footer)}</div>` : ''}
  </body></html>`;
}

export async function renderCards(spec, { browser, only } = {}) {
  const cards = spec.scenes.filter((s) => s.type === 'card' && (!only || only.includes(s.id)));
  if (!cards.length) return [];
  ensureDir(spec.dirs.cards);
  const own = !browser;
  if (own) browser = await requireModule('playwright').chromium.launch();
  const { width, height } = spec.output;
  const page = await browser.newPage({ viewport: { width, height } });
  const out = [];
  try {
    for (const card of cards) {
      await page.setContent(cardHtml(spec, card, { width, height }), { waitUntil: 'load' });
      await page.evaluate(() => document.fonts && document.fonts.ready);
      const file = path.join(spec.dirs.cards, `${card.id}.png`);
      await page.screenshot({ path: file });
      out.push(file);
      log('ok', `card ${card.id} → ${path.relative(process.cwd(), file)}`);
    }
  } finally {
    await page.close();
    if (own) await browser.close();
  }
  return out;
}

export async function renderImageCard(spec, card, file) {
  const browser = await requireModule('playwright').chromium.launch();
  try {
    const w = card.width || spec.output.width; const h = card.height || spec.output.height;
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.setContent(cardHtml(spec, card, { width: w, height: h }), { waitUntil: 'load' });
    await page.screenshot({ path: file });
  } finally { await browser.close(); }
  return file;
}
