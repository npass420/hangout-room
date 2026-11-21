// =====================================================================
// cave.js (362 lines) — the Lobby: the front door of the site. A great slab of white marble (slab.webp, from a Kindroid
// image) floats in deep space, glowing rings and runes carved into its top. Three rubies hover over it, each a portal:
//   the checker piece on the left (a ruby dome on a black stone disc) -> the Table Room (checkers)
//   the round glowing ruby in the middle, over the rings -> the Doodle Gallery
//   the faceted amethyst on the right -> the Game Room
// Behind it all, three nebula pictures (sky1, sky2, sky3) drift at their own speeds, layered so the dark gaps in the
// nearer ones show the farther ones through. Stars twinkle over them, and little motes of light rise from the rings.
// A moment after the Lobby appears, each one's name fades in above it in glowing letters, brightening when you point at it.
// Pick your name, then touch a ruby. It glows up, the screen floods with white from it, and while it's all white that
// room's code loads (a little snowflake turns in the bottom left corner). Then the white fades and you're in the room.
// Coming back through a room's portal, the Lobby fades in from black. On every load a little tag pops up for a few
// seconds with the Lobby's version (VERSION below), so you can tell when an update has arrived.
// =====================================================================
import { sfx } from '../sounds.js';
import { inCave, joinCave, leaveCave } from '../world.js';   // who's online, everywhere (and you, here in the Lobby)
inCave();
const PLACES = {
  table:   { name: 'Table Room', file: '../table/tables.js', gem: 'gem_dome.webp' },
  gallery: { name: 'Doodle Gallery', file: '../studio/studio.js', gem: 'gem_cabochon.webp' },
  game:    { name: 'Game Room', file: '../game/games.js', gem: 'gem_faceted.webp' }
};
// Where each ruby hovers over the slab's top: u across the slab picture, v down it (both as parts of its width and height)
const SPOTS = { table: { u: 0.27, v: 0.36 }, gallery: { u: 0.5, v: 0.27 }, game: { u: 0.73, v: 0.34 } };
const RINGS = { u: 0.5, v: 0.262 };   // the middle of the carved rings
const SLAB_ASPECT = 1266 / 1600;      // the slab picture's height, as a part of its width
const GEM_SIZE = { table: 0.2, gallery: 0.15, game: 0.15 };   // each one's width, as a part of the slab's width
const GLOW = { table: '255,60,60', gallery: '255,60,60', game: '175,80,255' };   // the color each one's light glows
const HOVER = 0.075;                  // how high it floats above its spot, as a part of the slab's width

const cv = document.getElementById('cave');
const g = cv.getContext('2d');
const nameBox = document.getElementById('nameBox');
const nameInput = document.getElementById('nameInput');
const nameTip = document.getElementById('nameTip');
const loadFlake = document.getElementById('loadFlake');
const PHONE = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || Math.min(window.innerWidth, window.innerHeight) < 600;
const TIP = PHONE ? 'Tap a ruby ✦' : 'Touch a ruby ✦';
nameTip.textContent = 'then ' + TIP.charAt(0).toLowerCase() + TIP.slice(1);
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

// ---------- Version: the Lobby's own number, popping up briefly on every load ----------
const VERSION = '1.0';
{
  const tag = document.createElement('div');
  tag.textContent = `Lobby ${VERSION}`;
  tag.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:90;pointer-events:none;' +
    'padding:6px 16px;border-radius:14px;background:rgba(8,14,30,0.82);border:1px solid rgba(160,210,255,0.6);color:#e6f3ff;' +
    'font:bold 14px "Trebuchet MS",sans-serif;box-shadow:0 0 14px rgba(120,190,255,0.45);transition:opacity 0.8s';
  document.body.appendChild(tag);
  setTimeout(() => { tag.style.opacity = '0'; setTimeout(() => tag.remove(), 900); }, 5000);
}

// ---------- The pictures (they sit next to this file) ----------
const here = f => new URL(f, import.meta.url).href;
const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const picture = f => { const img = new Image(); img.src = here(f); return img; };
const ok = img => img.complete && img.naturalWidth > 0;
const skies = ['sky1.jpg', 'sky2.jpg', 'sky3.jpg'].map(picture);
const slab = picture('slab.webp');
const gems = {};
for (const key in PLACES) gems[key] = picture(PLACES[key].gem);
// Each sky layer: how big it's drawn (over the screen's longer side), how fast and how far it drifts, how strongly it
// shows over the ones behind it, and how much it moves with the mouse (the nearer, the more)
const LAYERS = [
  { scale: 1.25, speed: 0.011, swing: 0.05, alpha: 1,    blend: 'source-over', depth: 6 },
  { scale: 1.35, speed: 0.017, swing: 0.07, alpha: 0.55, blend: 'screen',      depth: 12 },
  { scale: 1.45, speed: 0.025, swing: 0.09, alpha: 0.45, blend: 'screen',      depth: 20 }
];

// ---------- Sizes ----------
let W = 0, H = 0, DPR = 1, S = 0, sx0 = 0, sy0 = 0;   // the slab's width on screen and where its corner sits
let stars = [], motes = [];
function build() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth; H = window.innerHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  S = Math.min(W * 0.74, H * 0.72 / SLAB_ASPECT);
  sx0 = (W - S) / 2;
  sy0 = Math.max(H * 0.26, H - S * SLAB_ASPECT - H * 0.03);
  stars = [];
  for (let i = 0; i < (PHONE ? 90 : 180); i++)
    stars.push({ x: Math.random(), y: Math.random(), r: 0.5 + Math.random() ** 3 * 1.8, tw: 0.6 + Math.random() * 2.2, ph: Math.random() * 7 });
  motes = [];
}
window.addEventListener('resize', build);

// Where things are on screen
let look = { x: 0, y: 0 }, lookTo = { x: 0, y: 0 };
let mouse = { x: -1, y: -1 }, hover = null;
const SLAB_DRIFT = 4;
const slabX = u => sx0 - look.x * SLAB_DRIFT + u * S;
const slabY = v => sy0 - look.y * SLAB_DRIFT * 0.6 + v * S;   // (v in parts of the slab's width, so it stays in proportion)
function gemAt(key, t) {   // a ruby's middle and width on screen, bobbing gently (each on its own beat)
  const spot = SPOTS[key], beat = { table: 0, gallery: 2.1, game: 4.2 }[key];
  const w = S * GEM_SIZE[key] * (hover === key ? 1.08 : 1);
  return { x: slabX(spot.u), y: slabY(spot.v * SLAB_ASPECT) - S * HOVER + Math.sin(t * 1.3 + beat) * S * 0.008, w,
           floor: slabY(spot.v * SLAB_ASPECT) };
}
window.addEventListener('pointermove', e => {
  mouse = { x: e.clientX, y: e.clientY };
  lookTo = { x: (e.clientX / W - 0.5) * 2, y: (e.clientY / H - 0.5) * 2 };
});
window.addEventListener('deviceorientation', e => {
  if (e.gamma == null) return;
  lookTo = { x: clamp(e.gamma / 30, -1, 1), y: clamp((e.beta - 45) / 30, -1, 1) };
});
let clock = 0;
function whatIsAt(x, y) {
  for (const key in PLACES) {
    const p = gemAt(key, clock);
    if (Math.hypot((x - p.x) / (p.w * 0.6), (y - p.y) / (p.w * 0.48)) < 1) return key;
  }
  return null;
}

// ---------- Touching a ruby ----------
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
  going = place; goneAt = performance.now(); hover = place;
  nameBox.classList.add('leaving');
  leaveCave();   // off to a room: you'll show up there instead
  sfx.whoosh();   // through the portal
}
// Once the screen is white: load the room, say you're here, and wait for it to be ready before showing it
function loadRoom() {
  loadFlake.style.cssText = 'left:22px;top:auto;bottom:22px;margin:0;font-size:26px;color:#5f9fd6;' +   // (small, in the corner, seen on the white)
    'text-shadow:0 0 10px rgba(110,170,240,0.55)';
  cv.style.transition = 'opacity 1.3s ease-out';
  loadFlake.classList.add('on');
  window.addEventListener('room-ready', () => {
    window.dispatchEvent(new Event('room-show'));
    loadFlake.classList.remove('on');
    cv.classList.add('gone');                       // and the white fades away, with you standing inside
    setTimeout(() => { cv.style.display = 'none'; nameBox.style.display = 'none'; }, 1400);
  }, { once: true });
  import(PLACES[going].file)
    .then(() => document.getElementById('enter').click())
    .catch(e => {
      console.warn('Room load', e);
      loadFlake.style.cssText = 'color:#24405e;text-shadow:none';   // (back in the middle, dark on the white)
      loadFlake.textContent = `${PLACES[going].name} couldn't load · tap to try again`;
      loadFlake.classList.add('oops');
      loadFlake.addEventListener('click', () => location.reload());
    });
}
cv.addEventListener('click', e => {
  if (going) return;
  const what = whatIsAt(e.clientX, e.clientY);
  if (what) tryEnter(what);
});

// ---------- Your name: Enter or the ✓ picks it; then you choose where to go by touching a ruby ----------
let myName = '';
function setName(name) {
  myName = name;
  nameInput.value = name;   // the room reads it from here when you go in
  try { localStorage.setItem('hangoutName', name); } catch (e) {}
  document.getElementById('helloText').textContent = `Hi ${name}!`;
  nameTip.textContent = TIP;
  nameBox.classList.add('named');
  nameInput.blur();
  joinCave(name);   // on the online list, here in the Lobby
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
  nameTip.textContent = 'then ' + TIP.charAt(0).toLowerCase() + TIP.slice(1);
  nameInput.focus(); nameInput.select();
});
{
  let saved = '';
  try { saved = (localStorage.getItem('hangoutName') || '').trim().slice(0, 20); } catch (e) {}
  if (saved) { setName(saved); document.getElementById('helloText').textContent = `Welcome back, ${saved}!`; }
}

// ---------- Drawing ----------
function drawSky(t) {   // the three nebulas, each covering the screen, drifting in slow loops at their own speeds
  g.fillStyle = '#05071a'; g.fillRect(0, 0, W, H);
  const big = Math.max(W, H);
  LAYERS.forEach((L, i) => {
    const img = skies[i];
    if (!ok(img)) return;
    const size = big * L.scale;
    const a = t * L.speed + i * 2;
    const x = (W - size) / 2 + Math.cos(a) * big * L.swing - look.x * L.depth;
    const y = (H - size) / 2 + Math.sin(a * 0.8) * big * L.swing * 0.6 - look.y * L.depth * 0.6;
    g.globalCompositeOperation = L.blend; g.globalAlpha = L.alpha;
    g.drawImage(img, x, y, size, size);
  });
  g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
  g.globalCompositeOperation = 'lighter';   // twinkling stars over it all
  for (const s of stars) {
    const a = Math.max(0, Math.sin(t * s.tw + s.ph)) ** 4;
    if (a < 0.05) continue;
    const x = s.x * W - look.x * 26, y = s.y * H - look.y * 16;
    g.fillStyle = `rgba(215,230,255,${a})`;
    g.beginPath(); g.arc(x, y, s.r, 0, Math.PI * 2); g.fill();
    if (s.r > 1.6) {   // the bigger ones get a little cross of light
      g.fillStyle = `rgba(190,215,255,${a * 0.5})`;
      g.fillRect(x - s.r * 5, y - 0.5, s.r * 10, 1); g.fillRect(x - 0.5, y - s.r * 5, 1, s.r * 10);
    }
  }
  g.globalCompositeOperation = 'source-over';
}
function drawSlab(t, dt) {
  if (!ok(slab)) return;
  // a soft blue glow in the space under the slab, as if it's lit from below
  const cx = slabX(0.5), cy = slabY(SLAB_ASPECT * 0.85);
  const under = g.createRadialGradient(cx, cy, 0, cx, cy, S * 0.6);
  under.addColorStop(0, 'rgba(60,110,255,0.22)'); under.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = under; g.fillRect(cx - S * 0.6, cy - S * 0.6, S * 1.2, S * 1.2);
  g.drawImage(slab, slabX(0), slabY(0), S, S * SLAB_ASPECT);
  // the carved rings breathe with light
  const rx = slabX(RINGS.u), ry = slabY(RINGS.v * SLAB_ASPECT), breathe = 0.5 + 0.5 * Math.sin(t * 0.9);
  g.globalCompositeOperation = 'lighter';
  g.save(); g.translate(rx, ry); g.scale(1, 0.42);
  const glow = g.createRadialGradient(0, 0, 0, 0, 0, S * 0.24);
  glow.addColorStop(0, `rgba(200,225,255,${0.16 + breathe * 0.14})`); glow.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = glow; g.beginPath(); g.arc(0, 0, S * 0.24, 0, Math.PI * 2); g.fill();
  g.restore();
  // little motes of light rising from the rings and fading
  if (motes.length < (PHONE ? 18 : 36) && Math.random() < dt * 8) {
    const a = Math.random() * Math.PI * 2, d = Math.random() * S * 0.2;
    motes.push({ x: rx + Math.cos(a) * d, y: ry + Math.sin(a) * d * 0.42, v: S * (0.02 + Math.random() * 0.03), life: 0, max: 2 + Math.random() * 2.5, r: 0.8 + Math.random() * 1.4 });
  }
  for (const m of motes) {
    m.life += dt; m.y -= m.v * dt; m.x += Math.sin(m.life * 2 + m.max) * 0.2;
    const a = Math.sin(Math.PI * m.life / m.max);
    g.fillStyle = `rgba(210,230,255,${a * 0.8})`;
    g.beginPath(); g.arc(m.x, m.y, m.r, 0, Math.PI * 2); g.fill();
  }
  motes = motes.filter(m => m.life < m.max);
  g.globalCompositeOperation = 'source-over';
}
function drawGem(key, t, flash) {
  const img = gems[key];
  if (!ok(img)) return;
  const p = gemAt(key, t), h = p.w * img.naturalHeight / img.naturalWidth;
  const lit = (hover === key ? 1 : 0) + (going === key ? flash * 2 : 0);
  const breathe = 0.5 + 0.5 * Math.sin(t * 1.6 + p.x * 0.01);
  // its shadow on the slab, and its red light pooling under it
  g.save(); g.translate(p.x, p.floor); g.scale(1, 0.35);
  const sh = g.createRadialGradient(0, 0, 0, 0, 0, p.w * 0.45);
  sh.addColorStop(0, 'rgba(10,5,20,0.45)'); sh.addColorStop(1, 'rgba(10,5,20,0)');
  g.fillStyle = sh; g.beginPath(); g.arc(0, 0, p.w * 0.45, 0, Math.PI * 2); g.fill();
  g.globalCompositeOperation = 'lighter';
  const pool = g.createRadialGradient(0, 0, 0, 0, 0, p.w * 0.6);
  pool.addColorStop(0, `rgba(${GLOW[key]},${0.18 + breathe * 0.1 + lit * 0.2})`); pool.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = pool; g.beginPath(); g.arc(0, 0, p.w * 0.6, 0, Math.PI * 2); g.fill();
  g.restore();
  // a halo behind it
  g.globalCompositeOperation = 'lighter';
  const halo = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.w * 0.85);
  halo.addColorStop(0, `rgba(${GLOW[key]},${0.22 + breathe * 0.12 + lit * 0.25})`); halo.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = halo; g.fillRect(p.x - p.w, p.y - p.w, p.w * 2, p.w * 2);
  g.globalCompositeOperation = 'source-over';
  g.drawImage(img, p.x - p.w / 2, p.y - h / 2, p.w, h);
  if (lit > 0) {   // touched or hovered: it brightens from inside
    g.globalCompositeOperation = 'lighter'; g.globalAlpha = Math.min(0.6, lit * 0.3);
    g.drawImage(img, p.x - p.w / 2, p.y - h / 2, p.w, h);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }
  // its name, fading in above it a moment after the Lobby appears (one after another), glowing
  const order = { table: 0, gallery: 1, game: 2 }[key];
  const fade = clamp((t - 1.2 - order * 0.5) / 1.6, 0, 1);
  if (fade > 0 && !going) {
    const size = clamp(S * 0.028, 13, 30);
    const ty = p.y - h / 2 - size * 0.9 + Math.sin(t * 1.3) * 1.5;
    g.font = `${size}px Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'bottom';
    g.globalAlpha = fade * (0.75 + 0.25 * breathe + (hover === key ? 0.25 : 0));
    g.shadowColor = `rgba(${GLOW[key]},${hover === key ? 1 : 0.9})`;
    g.shadowBlur = size * (hover === key ? 1.1 : 0.7);
    g.fillStyle = '#ffe9e4';
    g.fillText(PLACES[key].name, p.x, ty);
    g.shadowBlur = size * 0.25; g.fillText(PLACES[key].name, p.x, ty);   // (a second pass: a crisp core in the glow)
    g.shadowBlur = 0; g.globalAlpha = 1;
  }
}

let raf = 0, last = performance.now();
const t0 = performance.now();
function frame(now) {
  raf = window.requestAnimationFrame(frame);
  const t = (now - t0) / 1000, dt = Math.min(0.1, (now - last) / 1000);
  last = now; clock = t;
  look.x = lerp(look.x, lookTo.x, 0.05); look.y = lerp(look.y, lookTo.y, 0.05);
  if (!going && mouse.x >= 0 && !PHONE) {
    hover = whatIsAt(mouse.x, mouse.y);
    cv.style.cursor = hover ? 'pointer' : 'default';
  }
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
  // Going somewhere: a flash of white light from the ruby fills the screen, and stays white
  const FLASH = 550, HOLD = 120;
  const since = going ? now - goneAt : 0;
  if (going && since >= FLASH + HOLD) {   // all white: stop drawing and load the room
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    window.cancelAnimationFrame(raf);
    loadRoom();
    return;
  }
  const k = going ? Math.min(1, since / FLASH) : 0;
  drawSky(t);
  drawSlab(t, dt);
  for (const key of ['table', 'game', 'gallery']) drawGem(key, t, k);   // (the middle one last, in front)
  if (going) {   // light pouring out of the ruby, growing to fill everything
    const p = gemAt(going, t), e = k * k * (3 - 2 * k), far = Math.hypot(W, H);
    g.globalCompositeOperation = 'lighter';
    const fl = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.w * 0.3 + far * 1.2 * e);
    fl.addColorStop(0, 'rgba(255,255,255,1)'); fl.addColorStop(0.5, `rgba(255,255,255,${e})`); fl.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = fl; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = `rgba(255,255,255,${e * e})`; g.fillRect(0, 0, W, H);   // until it's all light
  }
}
build();
// Testing on this PC: localhost:8080/HangoutRoom/?room=table (or gallery, or game) goes straight into that room, under
// your saved name. Only on this PC; the live site always starts in the Lobby.
const LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const TEST_ROOM = LOCAL ? new URLSearchParams(location.search).get('room') : null;
if (TEST_ROOM && PLACES[TEST_ROOM]) {
  setName(myName || 'Tester');
  going = TEST_ROOM;
  leaveCave();
  cv.style.visibility = 'hidden'; nameBox.style.display = 'none';
  loadRoom();
} else raf = window.requestAnimationFrame(frame);
// =====================================================================
// END OF cave.js (362 lines)
// =====================================================================
