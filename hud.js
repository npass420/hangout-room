// hud.js — the rooms' on-screen bits keep out of the way:
//   the panels (who's here, chat, a game's panel) slide off their edge of the screen a moment after the mouse leaves
//   them, leaving a thin glowing sliver; move the mouse near one and it slides back in. A panel stays out while the
//   mouse is on it or you're typing in it, and a new chat message slides the chat in for a few seconds.
//   the room's title and its instructions at the top show when they change (entering, sitting down, standing up),
//   then fade away after a few seconds.
// On phones (narrow screens) nothing slides: the panels there are already opened and closed with the buttons at the top.
// setupHud() once per room; slide(element, 'left' or 'right') for each panel; peek(element, ms) to slide one in briefly.
// VERSION 1

const NEAR = 48;          // how close the mouse has to come to a panel's spot (pixels) to bring it back
const LINGER = 1200;      // how long a panel stays out after the mouse leaves it (ms)
const TITLE_TIME = 4000;  // how long the title and instructions show before fading (ms)

const panels = [];
let mouseX = -1e4, mouseY = -1e4, started = false;
const isPhone = () => window.matchMedia('(max-width: 700px)').matches;

function home(el) {   // where a panel sits when it's out (its layout spot, whatever its slide)
  return { left: el.offsetLeft, top: el.offsetTop, right: el.offsetLeft + el.offsetWidth, bottom: el.offsetTop + el.offsetHeight };
}
function check() {
  const now = performance.now();
  for (const p of panels) {
    const r = home(p.el);
    const near = mouseX > r.left - NEAR && mouseX < r.right + NEAR && mouseY > r.top - NEAR && mouseY < r.bottom + NEAR;
    const busy = p.el.contains(document.activeElement) && document.activeElement !== document.body;
    if (near || busy || now < p.peekUntil) p.leaveAt = now + LINGER;
    p.el.classList.toggle('away', !isPhone() && now > p.leaveAt);
  }
}

export function setupHud() {
  if (started) return;
  started = true;
  const css = document.createElement('style');
  css.textContent = `
    .slide { transition: transform 0.35s ease, box-shadow 0.35s; }
    .slide.away.right { transform: translateX(calc(100% + 16px - 8px)); }
    .slide.away.left { transform: translateX(calc(-100% - 16px + 8px)); }
    .slide.away { box-shadow: 0 3px 10px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(201,162,39,0.6), 0 0 12px rgba(255,214,140,0.45); }
    #ui { transition: opacity 0.8s; }
    #ui.faded { opacity: 0; }
    @media (max-width: 700px) { .slide.away.right, .slide.away.left { transform: none; } }`;
  document.head.appendChild(css);
  window.addEventListener('pointermove', e => { mouseX = e.clientX; mouseY = e.clientY; check(); }, { passive: true });
  document.addEventListener('focusin', check);
  setInterval(check, 200);

  // the title and instructions: shown when their words change, then faded
  const ui = document.getElementById('ui');
  if (ui) {
    let words = '', timer = 0;
    const show = () => {
      const now = ui.textContent;
      if (now === words) return;   // (set again with the same words: nothing new to show)
      words = now;
      ui.classList.remove('faded');
      clearTimeout(timer);
      timer = setTimeout(() => ui.classList.add('faded'), TITLE_TIME);
    };
    new MutationObserver(show).observe(ui, { childList: true, characterData: true, subtree: true });
    window.addEventListener('room-show', () => { words = ''; show(); });   // (shown again as the room appears from the Cave's white)
    show();
  }
}

export function slide(el, side) {
  if (!el || panels.some(p => p.el === el)) return;
  el.classList.add('slide', side === 'left' ? 'left' : 'right');
  panels.push({ el, peekUntil: 0, leaveAt: performance.now() + 4000 });   // (out for a few seconds at first, so you see it's there)
  check();
}

export function peek(el, ms = 4000) {
  const p = panels.find(q => q.el === el);
  if (!p) return;
  p.peekUntil = Math.max(p.peekUntil, performance.now() + ms);
  check();
}
