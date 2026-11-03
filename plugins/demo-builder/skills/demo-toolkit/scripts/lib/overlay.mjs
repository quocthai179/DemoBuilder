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
    const masks = (cfg.mask || []).join(',\n');
    const hides = (cfg.hide || []).join(',\n');
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
      ${masks ? `${masks}{filter:blur(7px) !important;}` : ''}
      ${hides ? `${hides}{display:none !important;}` : ''}
      ${cfg.hideScrollbars ? 'html::-webkit-scrollbar,body::-webkit-scrollbar{display:none}html{scrollbar-width:none}' : ''}
    `;
  }

  function root() {
    if (rootEl && rootEl.isConnected) return rootEl;
    const host = document.documentElement;
    if (!host) return null;
    const style = document.createElement('style'); style.id = '__demo-style'; style.textContent = css();
    host.appendChild(style);
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
