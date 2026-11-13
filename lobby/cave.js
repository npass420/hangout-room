// =====================================================================
// cave.js — the Cave: the front door of the site. The inside of a great snow block igloo (cave.jpg, a Kindroid image),
// with a glowing snow globe on a mound in the middle and an old carved stone archway on each side.
// Pick your name, then touch the snow globe (the Doodle Gallery), the doorway on the right (the Table Room) or the
// doorway on the left (the Game Room).
// The screen flashes white (or warm gold for a door), fades to black, and only then does that room's code load; a little
// snowflake turns while it does. Then the room fades in and you walk in through its door.
// The swirl in the middle of the globe turns slowly, and snow drifts down inside the glass.
// Coming back through a room's portal, the Cave fades in from black.
// =====================================================================
import { sfx } from '../sounds.js';
import { inCave, joinCave, leaveCave } from '../world.js';   // who's online, everywhere (and you, here in the Cave)
inCave();
const PLACES = {
  orb:   { name: 'Doodle Gallery', file: '../studio/studio.js' },
  right: { name: 'Table Room', file: '../table/tables.js' },
  left:  { name: 'Game Room', file: '../game/games.js' }
};

// Where things sit in cave.jpg, measured in parts of the picture's width (across 0 to 1, down 0 to ASPECT)
const ASPECT = 0.935;   // the picture's height, as a part of its width
const GLOBE = { x: 0.499, y: 0.510, r: 0.137, base: 0.590 };   // the glass ball, and where the snow mound starts covering it
const ARCHES = {   // each stone arch (for clicks, the glow and the name), and the doorway inside it
  left:  { x0: 0.032, x1: 0.303, top: 0.297, bottom: 0.640, door: { x0: 0.125, x1: 0.210, top: 0.389, bottom: 0.632 } },
  right: { x0: 0.732, x1: 0.979, top: 0.328, bottom: 0.640, door: { x0: 0.817, x1: 0.894, top: 0.411, bottom: 0.632 } }
};

const cv = document.getElementById('cave');
const g = cv.getContext('2d');
const nameBox = document.getElementById('nameBox');
const nameInput = document.getElementById('nameInput');
const nameTip = document.getElementById('nameTip');
const loadFlake = document.getElementById('loadFlake');
const PHONE = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || Math.min(window.innerWidth, window.innerHeight) < 600;
// Back from a room through its portal: start black and fade in
try {
  if (sessionStorage.getItem('caveFadeIn') === '1') {
    sessionStorage.removeItem('caveFadeIn');
    const veil = document.createElement('div');
    veil.style.cssText = 'position:fixed;inset:0;z-index:100;background:#000;pointer-events:none;transition:opacity 1.2s ease-out';
    document.body.appendChild(veil);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => { veil.style.opacity = '0'; }));
    setTimeout(() => veil.remove(), 1500);
  }
} catch (e) {}

function seeded(s) { return () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- The picture ----------
// cave.jpg is the whole Cave. A tiny copy of it, stretched big, makes a soft blurred backdrop for tall phone screens
// (where the picture fits the width and leaves room above and below). The middle of the globe's swirl is cut out once
// with softly fading edges, so it can turn on its own while everything around it stays still.
const SWIRL = 0.6;   // how much of the globe turns, from its middle out
const caveImg = new Image();
let caveReady = false, soft = null, swirl = null, feathered = null, wings = null, wingsFor = '';
caveImg.onload = () => {
  soft = document.createElement('canvas'); soft.width = soft.height = 48;
  soft.getContext('2d').drawImage(caveImg, 0, 0, 48, 48);
  // For very wide screens: a copy of the picture whose left and right edges fade away, so it melts into the sides
  feathered = document.createElement('canvas'); feathered.width = caveImg.width; feathered.height = caveImg.height;
  const fg = feathered.getContext('2d'), fw = caveImg.width * 0.06;
  fg.drawImage(caveImg, 0, 0);
  fg.globalCompositeOperation = 'destination-out';
  for (const [x0, x1] of [[0, fw], [caveImg.width, caveImg.width - fw]]) {
    const grd = fg.createLinearGradient(x0, 0, x1, 0);
    grd.addColorStop(0, 'rgba(0,0,0,1)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    fg.fillStyle = grd; fg.fillRect(Math.min(x0, x1), 0, fw, caveImg.height);
  }
  const S = caveImg.width, r = GLOBE.r * SWIRL * S, n = Math.round(r * 2);
  swirl = document.createElement('canvas'); swirl.width = swirl.height = n;
  const sg = swirl.getContext('2d');
  sg.drawImage(caveImg, GLOBE.x * S - r, GLOBE.y * S - r, n, n, 0, 0, n, n);
  sg.globalCompositeOperation = 'destination-in';   // keep the middle, fading out toward the edge
  const fade = sg.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  fade.addColorStop(0, '#000'); fade.addColorStop(0.7, '#000'); fade.addColorStop(1, 'rgba(0,0,0,0)');
  sg.fillStyle = fade; sg.fillRect(0, 0, n, n);
  caveReady = true;
};
caveImg.onerror = () => console.warn('cave.jpg did not load');
caveImg.src = new URL('cave.jpg', import.meta.url).href;   // the picture sits next to this file

// ---------- Where the picture sits on screen, worked out again whenever the window changes size ----------
// It fills the screen, but a tall phone screen shows its whole width instead, so both doorways stay in view, and a very
// wide screen doesn't zoom in past the point where the arches get cut off: the sides get a soft blurred mirror of the edges.
let W = 0, H = 0, DPR = 1, D = 0, ox = 0, oy = 0;   // the picture's width on screen and where its corner sits
let sparkles = [], snow = [], flakes = [], haze = null;
const M = 1.05;   // a little bigger than the screen, so it can drift with the mouse without showing an edge
function build() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  if (W / H >= 1 / ASPECT * 0.9) { D = Math.min(Math.max(W, H / ASPECT), H / ASPECT * 1.7) * M; ox = W / 2 - 0.5 * D; oy = H / 2 - 0.49 * D; }
  else { D = W / 0.97; ox = W / 2 - 0.507 * D; oy = H * 0.42 - GLOBE.y * D; }
  const rnd = seeded(7);
  // Glints on the snow floor
  sparkles = [];
  for (let i = 0; i < (PHONE ? 50 : 110); i++) sparkles.push({ u: rnd(), v: 0.66 + rnd() * 0.27, r: 0.6 + rnd() * 1.6, ph: rnd() * 7, sp: 0.8 + rnd() * 2 });
  // Falling snow, in three layers for depth
  snow = [];
  const area = W * H / (1600 * 900);
  for (const [count, size, speed, depth] of [[90, 1.1, 18, 8], [55, 2.2, 34, 22], [16, 4.2, 62, 42]]) {
    for (let i = 0; i < Math.round(count * area * (PHONE ? 0.6 : 1)) + 4; i++) {
      snow.push({ x: rnd() * (W + 80) - 40, y: rnd() * (H + 40) - 20, r: size * (0.7 + rnd() * 0.6),
        v: speed * (0.75 + rnd() * 0.5), ph: rnd() * 7, sw: 6 + rnd() * 16, depth });
    }
  }
  // Tiny flakes drifting inside the snow globe (as parts of the globe's size)
  flakes = [];
  for (let i = 0; i < 40; i++) flakes.push({ x: rnd() * 2 - 1, y: rnd() * 2 - 1, r: 0.006 + rnd() * 0.012, v: 0.02 + rnd() * 0.05, ph: rnd() * 7 });
  // The soft blue shade toward the edges
  haze = g.createRadialGradient(W / 2, H * 0.5, Math.min(W, H) * 0.3, W / 2, H * 0.5, Math.hypot(W, H) * 0.62);
  haze.addColorStop(0, 'rgba(20,30,80,0)'); haze.addColorStop(1, 'rgba(10,16,48,0.5)');
}

// ---------- Looking around a little: the picture drifts with the mouse (or tilting a phone) ----------
let look = { x: 0, y: 0 }, lookTo = { x: 0, y: 0 };
let mouse = { x: -1, y: -1 }, hover = null;
const DRIFT = 12;   // how far the picture moves, in screen spots
function offset(depth) { return [-look.x * depth, -look.y * depth * 0.6]; }
window.addEventListener('pointermove', e => {
  if (e.pointerType === 'mouse') lookTo = { x: (e.clientX / W) * 2 - 1, y: (e.clientY / H) * 2 - 1 };
  mouse = { x: e.clientX, y: e.clientY };
});
window.addEventListener('deviceorientation', e => {
  if (e.gamma == null) return;
  lookTo = { x: clamp(e.gamma / 25, -1, 1), y: clamp((e.beta - 45) / 25, -1, 1) };
});
function makeWings() {   // the sides of a very wide screen: the picture's edges mirrored outward, blurred and a little darker
  wings = document.createElement('canvas'); wings.width = Math.round(W / 2); wings.height = Math.round(H / 2);
  const wg = wings.getContext('2d'), k = 0.5;
  wg.scale(k, k);
  const B = Math.max(W, H) * 1.1;
  wg.drawImage(soft, (W - B) / 2, (H - B) / 2, B, B);
  wg.filter = 'blur(14px)';
  const h = D * ASPECT;
  for (const side of [-1, 1]) {   // flipped copies, butting up against each side of the picture
    wg.save();
    wg.translate(side < 0 ? ox : ox + 2 * D, 0);
    wg.scale(-1, 1);
    wg.drawImage(caveImg, 0, oy, D, h);
    wg.restore();
  }
  wg.filter = 'none';
  wg.fillStyle = 'rgba(8,12,36,0.3)'; wg.fillRect(0, 0, W, H);
}
function sx(u) { return ox + offset(DRIFT)[0] + u * D; }   // a spot in the picture, on screen
function sy(v) { return oy + offset(DRIFT)[1] + v * D; }
function archPath(a) {   // an arch: straight sides and a round top
  const r = (a.x1 - a.x0) / 2, p = new window.Path2D();
  p.moveTo(sx(a.x0), sy(a.bottom));
  p.lineTo(sx(a.x0), sy(a.top + r));
  p.arc(sx(a.x0 + r), sy(a.top + r), r * D, Math.PI, 0);
  p.lineTo(sx(a.x1), sy(a.bottom));
  p.closePath();
  return p;
}
function inArch(a, u, v) {
  const r = (a.x1 - a.x0) / 2;
  if (u < a.x0 || u > a.x1 || v > a.bottom || v < a.top) return false;
  return v >= a.top + r || Math.hypot(u - (a.x0 + r), v - (a.top + r)) <= r;
}
function whatIsAt(x, y) {
  const u = (x - sx(0)) / D, v = (y - sy(0)) / D;
  if (Math.hypot(u - GLOBE.x, v - GLOBE.y) < GLOBE.r * 1.15) return 'orb';
  for (const side of ['left', 'right']) if (inArch(ARCHES[side], u, v)) return side;
  return null;
}

// ---------- Touching things ----------
let note = null;          // a little message near something you touched: { text, side, t }
let shake = { side: null, t: 0 };
let going = null, goneAt = 0;   // where you're headed, and when the flash started
function tryEnter(place) {
  if (going) return;
  const name = myName || nameInput.value.trim().slice(0, 20);
  if (!name) {
    nameBox.classList.remove('nudge'); void nameBox.offsetWidth; nameBox.classList.add('nudge');
    nameInput.focus();
    return;
  }
  setName(name);
  going = place; goneAt = performance.now(); hover = null;
  nameBox.classList.add('leaving');
  leaveCave();   // off to a room: you'll show up there instead
  sfx.whoosh();   // through the portal
}
// Once the screen is black: load the room, say you're here, and wait for it to be ready before showing it
function loadRoom() {
  loadFlake.classList.add('on');
  window.addEventListener('room-ready', () => {
    window.dispatchEvent(new Event('room-show'));   // the room starts its walk in through the door
    loadFlake.classList.remove('on');
    cv.classList.add('gone');                       // and the black fades away
    setTimeout(() => { cv.style.display = 'none'; nameBox.style.display = 'none'; }, 1000);
  }, { once: true });
  import(PLACES[going].file)
    .then(() => document.getElementById('enter').click())
    .catch(e => {
      console.warn('Room load', e);
      loadFlake.textContent = `${PLACES[going].name} couldn't load · tap to try again`;
      loadFlake.classList.add('oops');
      loadFlake.addEventListener('click', () => location.reload());
    });
}
cv.addEventListener('click', e => {
  if (going) return;
  const what = whatIsAt(e.clientX, e.clientY);
  if (what && PLACES[what].file) tryEnter(what);
  else if (what) {
    shake = { side: what, t: performance.now() };
    note = { text: `${PLACES[what].name} is coming soon…`, side: what, t: performance.now() };
  }
});

// ---------- Your name: Enter or the ✓ picks it; then you choose where to go by touching the orb or a door ----------
let myName = '';
function setName(name) {
  myName = name;
  nameInput.value = name;   // the room reads it from here when you go in
  try { localStorage.setItem('hangoutName', name); } catch (e) {}
  document.getElementById('helloText').textContent = `Hi ${name}!`;
  nameTip.textContent = PHONE ? 'Tap the orb ✦ or an open door' : 'Touch the orb ✦ or an open door';
  nameBox.classList.add('named');
  nameInput.blur();
  joinCave(name);   // on the online list, here in the Cave
}
function pickName() {
  const name = nameInput.value.trim().slice(0, 20);
  if (!name) { nameBox.classList.remove('nudge'); void nameBox.offsetWidth; nameBox.classList.add('nudge'); nameInput.focus(); return; }
  setName(name);
}
nameInput.addEventListener('keydown', e => {   // runs before the rooms' own Enter, and stops it
  if (e.key !== 'Enter') return;
  e.preventDefault(); e.stopImmediatePropagation();
  pickName();
});
document.getElementById('nameOk').addEventListener('click', pickName);
document.getElementById('nameChange').addEventListener('click', () => {
  if (going) return;
  myName = '';
  nameBox.classList.remove('named');
  nameTip.textContent = 'then touch the orb ✦ or an open door';
  nameInput.focus(); nameInput.select();
});
{
  let saved = '';
  try { saved = (localStorage.getItem('hangoutName') || '').trim().slice(0, 20); } catch (e) {}
  if (saved) { setName(saved); document.getElementById('helloText').textContent = `Welcome back, ${saved}!`; }
}
window.addEventListener('resize', build);

// ---------- Drawing every frame ----------
function label(text, x, y, size, glowColor, lit) {   // a name floating in the air, glowing softly
  g.font = `italic ${size}px Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'bottom';
  g.shadowColor = glowColor; g.shadowBlur = 12;
  g.fillStyle = lit ? '#ffffff' : 'rgba(240,246,255,0.92)';
  g.fillText(text, x, y);
  g.shadowBlur = 0;
}
let raf = 0;
const t0 = performance.now();
function frame(now) {
  raf = window.requestAnimationFrame(frame);
  const t = (now - t0) / 1000;
  look.x = lerp(look.x, lookTo.x, 0.05); look.y = lerp(look.y, lookTo.y, 0.05);
  if (!going && mouse.x >= 0 && !PHONE) {
    hover = whatIsAt(mouse.x, mouse.y);
    cv.style.cursor = hover ? 'pointer' : 'default';
  }

  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
  // Going somewhere: a flash of light from the globe (or the doorway) fills the screen, then fades to black
  const FLASH = 550, DARK = 450;
  const since = going ? now - goneAt : 0;
  if (going && since >= FLASH + DARK) {   // all black: stop drawing the Cave and load the room
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    window.cancelAnimationFrame(raf);
    loadRoom();
    return;
  }
  const k = going ? Math.min(1, since / FLASH) : 0;
  const pulse = 0.5 + 0.5 * Math.sin(t * 1.6);

  // The picture (and on a tall screen, its soft blurred copy filling the space above and below)
  g.fillStyle = '#0e1430'; g.fillRect(0, 0, W, H);
  if (caveReady) {
    const wide = D < W;
    if (D * ASPECT < H) {
      const B = Math.max(W, H) * 1.1;
      g.drawImage(soft, (W - B) / 2, (H - B) / 2, B, B);
      g.fillStyle = 'rgba(8,12,36,0.35)'; g.fillRect(0, 0, W, H);
    }
    if (wide) {
      if (wingsFor !== W + 'x' + H) { makeWings(); wingsFor = W + 'x' + H; }
      g.drawImage(wings, 0, 0, W, H);
    }
    g.drawImage(wide ? feathered : caveImg, sx(0), sy(0), D, D * ASPECT);
    // A door you touched gives a little shiver
    for (const side of ['left', 'right']) {
      if (shake.side !== side) continue;
      const sh = Math.max(0, 1 - (now - shake.t) / 500);
      if (!sh) continue;
      const a = ARCHES[side], S = caveImg.width;   // (the picture's spots are measured in parts of its width)
      g.save(); g.clip(archPath(a));
      g.drawImage(caveImg, a.x0 * S, a.top * S, (a.x1 - a.x0) * S, (a.bottom - a.top) * S,
        sx(a.x0) + Math.sin(now * 0.08) * sh * 4, sy(a.top), (a.x1 - a.x0) * D, (a.bottom - a.top) * D);
      g.restore();
    }
  }

  // The doors: warm light breathing in each doorway, and a soft glow over the arch you point at
  for (const side of ['left', 'right']) {
    const a = ARCHES[side], open = !!PLACES[side].file, lit = hover === side;
    {
      const d = a.door, cx = sx((d.x0 + d.x1) / 2), cy = sy((d.top + d.bottom) / 2), rr = (d.bottom - d.top) * D * 0.7;
      g.save(); g.clip(archPath(d));
      g.globalCompositeOperation = 'lighter';
      const warm = g.createRadialGradient(cx, cy, 0, cx, cy, rr);
      const a0 = (0.16 + pulse * 0.08) * (lit ? 2 : 1) + (going === side ? k : 0);
      warm.addColorStop(0, `rgba(255,190,140,${a0})`); warm.addColorStop(0.6, `rgba(200,110,255,${a0 * 0.5})`); warm.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = warm; g.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);
      g.restore();
    }
    if (lit || (shake.side === side && now - shake.t < 500)) {   // a soft glow over the whole arch
      const d = a.door, cx = sx((d.x0 + d.x1) / 2), cy = sy((d.top + d.bottom) / 2), rr = (a.x1 - a.x0) * D * 0.75;
      g.save(); g.clip(archPath(a));
      g.globalCompositeOperation = 'lighter';
      const shine = g.createRadialGradient(cx, cy, 0, cx, cy, rr);
      shine.addColorStop(0, open ? `rgba(255,200,150,${0.16 + pulse * 0.08})` : `rgba(150,215,255,${0.14 + pulse * 0.06})`);
      shine.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = shine; g.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);
      g.restore();
    }
  }

  // The snow globe: a soft halo, the galaxy slowly turning inside, and little flakes drifting in the glass
  const glowUp = (hover === 'orb' ? 1.4 : 1) + (going === 'orb' ? k * 1.5 : 0);
  const X = sx(GLOBE.x), Y = sy(GLOBE.y), R = GLOBE.r * D;
  g.globalCompositeOperation = 'lighter';
  const halo = g.createRadialGradient(X, Y, R * 0.95, X, Y, R * 2.2);   // around the glass, not on it
  halo.addColorStop(0, `rgba(170,120,255,${(0.14 + pulse * 0.08) * glowUp})`); halo.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = halo; g.fillRect(X - R * 2.5, Y - R * 2.5, R * 5, R * 5);
  if (swirl) {   // the swirl itself turns (it speeds up as you go through)
    const sr = R * SWIRL;
    g.save();
    g.globalCompositeOperation = 'source-over';
    g.translate(X, Y); g.rotate(-(t * 0.18 + (going === 'orb' ? k * k * 3 : 0)));
    g.drawImage(swirl, -sr, -sr, sr * 2, sr * 2);
    g.restore();
  }
  g.save();
  g.beginPath(); g.arc(X, Y, R * 0.94, 0, Math.PI * 2); g.clip();
  g.beginPath(); g.rect(X - R, Y - R, R * 2, sy(GLOBE.base) - (Y - R)); g.clip();   // the glass only, above the snow
  g.globalCompositeOperation = 'lighter';
  const core = g.createRadialGradient(X, Y, 0, X, Y, R * 0.55);
  core.addColorStop(0, `rgba(255,200,150,${(0.03 + pulse * 0.05) * glowUp + (going === 'orb' ? k * 0.5 : 0)})`); core.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = core; g.fillRect(X - R, Y - R, R * 2, R * 2);
  g.fillStyle = 'rgba(255,255,255,0.85)';
  for (const f of flakes) {   // snow falling slowly inside the globe, round and round
    const fy = ((f.y + 1 + t * f.v) % 2) - 1, fx = f.x + Math.sin(t * 0.8 + f.ph) * 0.05;
    g.beginPath(); g.arc(X + fx * R * 0.9, Y + fy * R * 0.9, f.r * R, 0, Math.PI * 2); g.fill();
  }
  g.restore();
  g.globalCompositeOperation = 'source-over';

  // Glints on the snow floor
  g.globalCompositeOperation = 'lighter';
  for (const s of sparkles) {
    const a = Math.max(0, Math.sin(t * s.sp + s.ph)) ** 6;
    if (a < 0.05) continue;
    g.fillStyle = `rgba(230,245,255,${a})`;
    g.beginPath(); g.arc(sx(s.u), sy(s.v), s.r, 0, Math.PI * 2); g.fill();
  }
  g.globalCompositeOperation = 'source-over';

  // The names
  const fs = clamp(D * 0.016, 13, 30);
  label(PLACES.orb.name, X, sy(GLOBE.y - GLOBE.r) - fs * 0.5, fs, 'rgba(190,140,255,0.95)', hover === 'orb');
  for (const side of ['left', 'right']) {
    const a = ARCHES[side];
    label(PLACES[side].name, clamp(sx((a.x0 + a.x1) / 2), fs * 3.5, W - fs * 3.5), sy(a.top) - fs * 0.3, fs * 0.9,
      PLACES[side].file ? 'rgba(255,170,80,0.9)' : 'rgba(120,220,255,0.9)', hover === side);
  }

  // Falling snow and the soft shade at the edges
  for (const s of snow) {
    s.y += s.v / 60; s.x += Math.sin(t * 0.7 + s.ph) * s.sw / 120;
    if (s.y > H + 20) { s.y = -20; s.x = Math.random() * (W + 80) - 40; }
    const [px, py] = offset(s.depth);
    g.fillStyle = s.depth > 30 ? 'rgba(240,248,255,0.85)' : s.depth > 15 ? 'rgba(230,240,255,0.7)' : 'rgba(210,225,255,0.5)';
    g.beginPath(); g.arc(s.x + px, s.y + py, s.r, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = haze; g.fillRect(0, 0, W, H);

  // A note near a door you touched
  if (note) {
    const age = (now - note.t) / 1000;
    if (age > 2.6) note = null;
    else {
      const a = ARCHES[note.side];
      g.globalAlpha = Math.min(1, age * 4, (2.6 - age) * 2);
      g.font = `${clamp(D * 0.011, 12, 18)}px Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'top';
      g.fillStyle = '#e6f7ff'; g.shadowColor = '#000'; g.shadowBlur = 6;
      g.fillText(note.text, clamp(sx((a.x0 + a.x1) / 2), 150, W - 150), sy(a.bottom) + 8);
      g.shadowBlur = 0; g.globalAlpha = 1;
    }
  }

  // The flash, then the fade to black
  if (going) {
    let fx0, fy0, col;
    if (going === 'orb') { fx0 = X; fy0 = Y; col = '255,255,255'; }
    else { const d = ARCHES[going].door; fx0 = sx((d.x0 + d.x1) / 2); fy0 = sy((d.top + d.bottom) / 2); col = '255,214,150'; }
    const e = k * k * (3 - 2 * k), far = Math.hypot(W, H);
    g.globalCompositeOperation = 'lighter';           // light pouring out of the center, growing to fill everything
    const fl = g.createRadialGradient(fx0, fy0, 0, fx0, fy0, R * 0.4 + far * 1.2 * e);
    fl.addColorStop(0, `rgba(${col},1)`); fl.addColorStop(0.5, `rgba(${col},${e})`); fl.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = fl; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = `rgba(${col},${e * e})`; g.fillRect(0, 0, W, H);   // until it's all light
    const d = Math.max(0, (since - FLASH) / DARK);
    if (d > 0) { g.fillStyle = `rgba(0,0,0,${d * d * (3 - 2 * d)})`; g.fillRect(0, 0, W, H); }
  }
}
build();
raf = window.requestAnimationFrame(frame);