// Browser-side overlay injected into every page while recording.
// Draws a smooth fake cursor, click ripples, spotlight highlights, callouts, captions,
// zoom, privacy masks and hides distracting elements. Exposed as window.__demo.
// Must be self-contained (it is serialised and run inside the page).
export function overlayInit(cfg) {
  if (window.__demo) return;
  const Z = 2147483000;
  let rootEl = null; let cursorEl = null; let pos = { x: -100, y: -100 };

  function css() {
    const c = cfg.cursor || {};
    return `
      #__demo-root{position:fixed;inset:0;pointer-events:none;z-index:${Z};font-family:${cfg.font};}
      #__demo-cursor{position:fixed;left:0;top:0;width:${c.size}px;height:${c.size}px;transform:translate(-100px,-100px);
        z-index:${Z + 5};pointer-events:none;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35));display:${c.show ? 'block' : 'none'}}
      .__demo-ripple{position:fixed;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;border:3px solid ${c.ring};
        z-index:${Z + 4};pointer-events:none;animation:__demo-ripple .55s ease-out forwards}
      @keyframes __demo-ripple{from{transform:scale(.6);opacity:.95}to{transform:scale(3.6);opacity:0}}
      .__demo-hl{position:fixed;border-radius:10px;border:3px solid ${cfg.primary};z-index:${Z + 1};pointer-events:none;
        transition:opacity .3s ease, all .35s ease;opacity:0}
      .__demo-hl.spot{box-shadow:0 0 0 9999px rgba(8,10,16,.55)}
      .__demo-hl.glow{box-shadow:0 0 0 6px ${cfg.primary}33, 0 0 24px ${cfg.primary}88}
      .__demo-callout{position:fixed;max-width:360px;background:${cfg.primary};color:#fff;padding:10px 14px;border-radius:10px;
        font-size:17px;line-height:1.35;font-weight:600;z-index:${Z + 2};pointer-events:none;box-shadow:0 8px 24px rgba(0,0,0,.25);
        opacity:0;transform:translateY(6px);transition:opacity .3s ease, transform .3s ease}
      .__demo-callout.show,.__demo-hl.show{opacity:1;transform:none}
      #__demo-caption{position:fixed;left:50%;bottom:48px;transform:translateX(-50%);max-width:80%;background:rgba(10,12,18,.82);
        color:#fff;padding:10px 18px;border-radius:10px;font-size:22px;font-weight:600;z-index:${Z + 3};opacity:0;transition:opacity .3s}
      #__demo-caption.show{opacity:1}
      ${cfg.hideScrollbars ? 'html::-webkit-scrollbar,body::-webkit-scrollbar{display:none}html{scrollbar-width:none}' : ''}
    `;
  }

  // Masks/hides go in through the CSSOM, one rule each, each in its own try/catch: a selector that is broken (unclosed quote, paren, comment...)
  // would swallow the rules after it in a text stylesheet and silently unblur everything. insertRule parses one rule, so it can only fail alone.
  function privacyRules(sheet) {
    if (!sheet) return 0;
    let kept = 0;
    const add = (list, body, prop) => {
      for (const sel of list || []) {
        try {
          const i = sheet.insertRule(`${sel}{${body}}`, sheet.cssRules.length);
          const r = sheet.cssRules[i];
          if (!(r && r.type === 1 && r.style.getPropertyValue(prop))) sheet.deleteRule(i); else kept++;
        } catch { /* invalid selector: skipped on its own */ }
      }
    };
    // contain:paint clips overflowing content (floats, absolute children, ::after) to the element's box, so the blur/opaque box of the element covers it.
    // Containment does not apply to inline boxes, so text-shadow is removed and ::before/::after of masked elements are hidden as well.
    add(cfg.mask, 'filter:blur(7px) !important;contain:paint !important;text-shadow:none !important;', 'filter');
    add((cfg.mask || []).map((s) => `:is(${s})::before,:is(${s})::after,:is(${s}) *::before,:is(${s}) *::after`), 'visibility:hidden !important;', 'visibility');
    add(cfg.hide, 'display:none !important;', 'display');
    return kept;
  }
  let privacyKept = 0;
  // Only the privacy rules carry !important in this sheet (css() has none), so this count equals `privacyKept` while all of them are intact.
  const importantRules = (sheet) => [...sheet.cssRules].filter((r) => r.style && [...r.style].some((p) => r.style.getPropertyPriority(p) === 'important')).length;

  function root() {
    if (rootEl && rootEl.isConnected) return rootEl;
    const host = document.documentElement;
    if (!host) return null;
    const style = document.createElement('style'); style.id = '__demo-style'; style.textContent = css();
    host.appendChild(style);
    privacyKept = privacyRules(style.sheet);
    rootEl = document.createElement('div'); rootEl.id = '__demo-root';
    cursorEl = document.createElement('div'); cursorEl.id = '__demo-cursor';
    cursorEl.innerHTML = `<svg viewBox="0 0 24 24" width="100%" height="100%"><path d="M4 2l16 9.5-7 1.6 4.2 7.3-2.9 1.6-4.2-7.3L4.9 19z" fill="${cfg.cursor.color}" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
    // Attach to <html>, not <body>, so zooming <body> does not move the overlay.
    host.appendChild(rootEl); host.appendChild(cursorEl);
    place();
    return rootEl;
  }
  function place() { if (cursorEl) cursorEl.style.transform = `translate(${pos.x - 3}px, ${pos.y - 2}px)`; }

  window.addEventListener('mousemove', (e) => { pos = { x: e.clientX, y: e.clientY }; root(); place(); }, true);
  document.addEventListener('DOMContentLoaded', root);

  const boxes = [];
  function box(rect, pad) {
    return { left: rect.x - pad, top: rect.y - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 };
  }
  window.__demo = {
    ready: () => !!root(),
    // Guide capture: put the stylesheet back when the page removed, replaced or emptied it. Returns true when it had to be re-attached.
    ensurePrivacy() {
      const host = document.documentElement; if (!host) return false;
      root();
      const st = document.getElementById('__demo-style');
      if (st && st.isConnected && st.sheet && !st.sheet.disabled && importantRules(st.sheet) >= privacyKept) return false;
      if (st) st.remove();
      const fresh = document.createElement('style'); fresh.id = '__demo-style'; fresh.textContent = css();
      host.appendChild(fresh);
      privacyKept = privacyRules(fresh.sheet);
      return true;
    },
    move(x, y) { pos = { x, y }; root(); place(); },
    ripple(x, y) {
      if (!cfg.cursor.clickRipple) return;
      const r = document.createElement('div'); r.className = '__demo-ripple';
      r.style.left = `${x}px`; r.style.top = `${y}px`; root().appendChild(r); setTimeout(() => r.remove(), 700);
    },
    highlight(rect, opts = {}) {
      const b = box(rect, opts.padding ?? 8);
      const hl = document.createElement('div'); hl.className = `__demo-hl ${opts.style || 'glow'}`;
      Object.assign(hl.style, { left: `${b.left}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px` });
      root().appendChild(hl); boxes.push(hl);
      requestAnimationFrame(() => hl.classList.add('show'));
      if (opts.label) {
        const c = document.createElement('div'); c.className = '__demo-callout'; c.textContent = opts.label;
        root().appendChild(c); boxes.push(c);
        const vw = window.innerWidth; const vh = window.innerHeight;
        const below = b.top + b.height + 14; const placeBelow = opts.position ? opts.position === 'bottom' : below + 80 < vh;
        c.style.left = `${Math.max(12, Math.min(vw - 372, b.left))}px`;
        if (placeBelow) c.style.top = `${below}px`; else c.style.top = `${Math.max(12, b.top - 14 - 60)}px`;
        requestAnimationFrame(() => c.classList.add('show'));
      }
    },
    clear() {
      while (boxes.length) { const el = boxes.pop(); el.classList.remove('show'); setTimeout(() => el.remove(), 350); }
    },
    caption(text) {
      root();
      let el = document.getElementById('__demo-caption');
      if (!el) { el = document.createElement('div'); el.id = '__demo-caption'; rootEl.appendChild(el); }
      if (!text) { el.classList.remove('show'); return; }
      el.textContent = text; requestAnimationFrame(() => el.classList.add('show'));
    },
    zoom(rect, scale, ms) {
      const b = document.body; if (!b) return;
      b.style.transition = 'none'; b.style.transform = 'none';
      const br = b.getBoundingClientRect(); const sx = window.scrollX; const sy = window.scrollY;
      const vw = window.innerWidth; const vh = window.innerHeight;
      const bx = br.left + sx; const by = br.top + sy;
      const cx = rect ? rect.x + rect.width / 2 + sx : sx + vw / 2;
      const cy = rect ? rect.y + rect.height / 2 + sy : sy + vh / 2;
      const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
      // translate so the target lands in the viewport centre, without exposing empty edges
      const tx = clamp(sx + vw / 2 - bx - scale * (cx - bx), sx + vw - bx - scale * (sx + vw - bx), sx - bx - scale * (sx - bx));
      const ty = clamp(sy + vh / 2 - by - scale * (cy - by), sy + vh - by - scale * (sy + vh - by), sy - by - scale * (sy - by));
      void b.offsetWidth;
      b.style.transformOrigin = '0 0';
      b.style.transition = `transform ${ms}ms cubic-bezier(.4,0,.2,1)`;
      b.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    },
    unzoom(ms) {
      const b = document.body; if (!b) return;
      b.style.transition = `transform ${ms}ms cubic-bezier(.4,0,.2,1)`; b.style.transform = 'none';
    },
  };
}

// ---------- user-guide annotations (static: no transitions, no animation) ----------
// Draw numbered badge + box (+ arrow and label in 'full' mode) for a guide screenshot.
// Run with page.evaluate(guideAnnotate, opts); must be self-contained like overlayInit.
//   o = { rect:{x,y,width,height}|null, n, label, mode:'full'|'closeup', color, text, font, masks:string[], pad }
// Returns { placement, badge:{x,y} } (badge = top-left corner of the badge, viewport px).
export function guideAnnotate(o) {
  const old = document.getElementById('__guide-annot'); if (old) old.remove();
  const vw = window.innerWidth; const vh = window.innerHeight;
  const color = o.color || '#4f46e5'; const textColor = o.text || '#ffffff'; const pad = o.pad ?? 8; const GAP = 30; const M = 8;
  const root = document.createElement('div'); root.id = '__guide-annot';
  const style = document.createElement('style');
  style.textContent = '#__guide-annot,#__guide-annot *{box-sizing:border-box;transition:none !important;animation:none !important;}'
    + `#__guide-annot{position:fixed;left:0;top:0;width:${vw}px;height:${vh}px;pointer-events:none;z-index:2147483600;font-family:${o.font || 'sans-serif'};}`
    + '#__guide-annot .g-abs{position:absolute;}';
  root.appendChild(style);
  document.documentElement.appendChild(root);
  const mk = (css, text) => { const d = document.createElement('div'); d.className = 'g-abs'; d.style.cssText = css; if (text !== undefined) d.textContent = text; root.appendChild(d); return d; };
  const result = { placement: null, badge: null };
  const r = o.rect;
  const hits = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
  const maskRects = [];
  for (const sel of o.masks || []) { try { document.querySelectorAll(sel).forEach((el) => { const b = el.getBoundingClientRect(); if (b.width && b.height) maskRects.push({ x: b.x, y: b.y, width: b.width, height: b.height }); }); } catch { /* bad selector */ } }

  let box = null;
  if (r) {
    box = { x: r.x - pad, y: r.y - pad, width: r.width + pad * 2, height: r.height + pad * 2 };
    mk(`left:${box.x}px;top:${box.y}px;width:${box.width}px;height:${box.height}px;border:3px solid ${color};outline:2px solid #fff;border-radius:6px;box-shadow:0 0 0 4px rgba(0,0,0,.18);`);
    const bx = Math.max(2, Math.min(vw - 32, box.x - 15)); const by = Math.max(2, Math.min(vh - 32, box.y - 15));
    mk(`left:${bx}px;top:${by}px;width:30px;height:30px;border-radius:50%;background:${color};color:${textColor};border:2px solid #fff;font:700 15px/26px ${o.font || 'sans-serif'};text-align:center;box-shadow:0 1px 4px rgba(0,0,0,.35);`, String(o.n));
    result.badge = { x: Math.round(bx), y: Math.round(by) };
  }
  if (o.mode === 'full' && o.label) {
    const pill = mk(`left:0;top:0;max-width:320px;background:${color};color:${textColor};padding:8px 12px;border:2px solid #fff;border-radius:8px;font:600 16px/1.3 ${o.font || 'sans-serif'};box-shadow:0 2px 8px rgba(0,0,0,.35);`, o.label);
    const w = pill.offsetWidth; const h = pill.offsetHeight;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    if (!box) {
      pill.style.left = `${Math.round((vw - w) / 2)}px`; pill.style.top = '16px';
      result.placement = 'top';
    } else {
      const cx = box.x + box.width / 2; const cy = box.y + box.height / 2;
      const cands = {
        below: { x: clamp(cx - w / 2, M, vw - w - M), y: box.y + box.height + GAP },
        above: { x: clamp(cx - w / 2, M, vw - w - M), y: box.y - GAP - h },
        right: { x: box.x + box.width + GAP, y: clamp(cy - h / 2, M, vh - h - M) },
        left: { x: box.x - GAP - w, y: clamp(cy - h / 2, M, vh - h - M) },
      };
      const fits = (c) => c.x >= M && c.y >= M && c.x + w <= vw - M && c.y + h <= vh - M;
      let pick = null;
      for (const k of ['below', 'above', 'right', 'left']) {
        const c = cands[k]; const rc = { x: c.x, y: c.y, width: w, height: h };
        if (fits(c) && !hits(rc, box) && !maskRects.some((m) => hits(rc, m))) { pick = k; break; }
      }
      if (!pick) pick = 'below';
      const c = cands[pick];
      const px = clamp(c.x, M, Math.max(M, vw - w - M)); const py = clamp(c.y, M, Math.max(M, vh - h - M));
      pill.style.left = `${Math.round(px)}px`; pill.style.top = `${Math.round(py)}px`;
      result.placement = pick;
      // arrow: pill edge -> box edge
      let sx; let sy; let ex; let ey;
      if (pick === 'below' || pick === 'above') {
        sx = clamp(cx, px + 14, px + w - 14); ex = clamp(sx, box.x + 6, box.x + box.width - 6);
        sy = pick === 'below' ? py : py + h; ey = pick === 'below' ? box.y + box.height + 3 : box.y - 3;
      } else {
        sy = clamp(cy, py + 10, py + h - 10); ey = clamp(sy, box.y + 6, box.y + box.height - 6);
        sx = pick === 'right' ? px : px + w; ex = pick === 'right' ? box.x + box.width + 3 : box.x - 3;
      }
      const ang = Math.atan2(ey - sy, ex - sx); const L = 12;
      const p1 = `${ex - L * Math.cos(ang - 0.45)},${ey - L * Math.sin(ang - 0.45)}`; const p2 = `${ex - L * Math.cos(ang + 0.45)},${ey - L * Math.sin(ang + 0.45)}`;
      const ns = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('width', String(vw)); svg.setAttribute('height', String(vh)); svg.setAttribute('class', 'g-abs'); svg.style.cssText = 'left:0;top:0;';
      const add = (tag, attrs) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); svg.appendChild(e); };
      add('line', { x1: sx, y1: sy, x2: ex, y2: ey, stroke: '#fff', 'stroke-width': 7, 'stroke-linecap': 'round' });
      add('polygon', { points: `${ex},${ey} ${p1} ${p2}`, fill: '#fff', stroke: '#fff', 'stroke-width': 4, 'stroke-linejoin': 'round' });
      add('line', { x1: sx, y1: sy, x2: ex, y2: ey, stroke: color, 'stroke-width': 3, 'stroke-linecap': 'round' });
      add('polygon', { points: `${ex},${ey} ${p1} ${p2}`, fill: color });
      root.insertBefore(svg, pill);
    }
  }
  return result;
}

export function guideClear() {
  document.querySelectorAll('#__guide-annot').forEach((el) => el.remove());
}
