// =====================================================================
// cave.js — the Cave: the front door of the site. The inside of a great snow block igloo (cave.jpg, a Kindroid image),
// dim and quiet, with a glass orb (globe.png) floating over a snow mound in the middle, a neon clock on the wall
// (clock.jpg, with hands that show your own time) and an old carved stone archway on each side.
// Light falls in through the top of the dome and follows the real time of day where you are: golden sun by day, warm
// orange at sunrise and sunset, cool silver moonlight at night, with dust drifting in the beam.
// Pick your name, then touch the orb (the Doodle Gallery), the doorway on the right (the Table Room) or the
// doorway on the left (the Game Room).
// The screen flashes white (or warm gold for a door), fades to black, and only then does that room's code load; a little
// snowflake turns while it does. Then the room fades in and you walk in through its door.
// The galaxy in the middle of the orb turns slowly, stars twinkle inside the glass, and the orb bobs gently.
// Coming back through a room's portal, the Cave fades in from black.
// Every time the page loads, a little tag pops up for a few seconds with the version of each room's files your browser
// has right now (each file says its version on a "VERSION" line at its top), so you can tell when an update has arrived.
// VERSION 2
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
const GLOBE = { x: 0.499, y: 0.475, r: 0.155 };   // the floating orb (big enough to cover the old glass ball painted in the picture)
const CORE = { x: -0.023, y: -0.119, r: 0.34 };   // the bright middle of its galaxy, and how much of it turns (parts of the orb's radius)
const CLOCK = { x: 0.693, y: 0.318, r: 0.046 };   // the neon clock on the wall: its middle and its outer ring
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

// ---------- Versions: which copy of each room's files your browser has, popping up briefly on every load ----------
const VERSIONED = [['Cave', import.meta.url], ['Game Room', new URL('../game/games.js', import.meta.url).href],
                   ['Skee-ball', new URL('../game/skeeball.js', import.meta.url).href]];
(async () => {
  const found = await Promise.all(VERSIONED.map(async ([name, url]) => {
    try {   // read the top of the file the same way the room would load it (from the browser's copy if it has one)
      const text = (await (await fetch(url)).text()).slice(0, 3000);
      const m = text.match(/^\/\/ VERSION (\d+)/m);
      return `${name} v${m ? m[1] : '?'}`;
    } catch (e) { return `${name} v?`; }
  }));
  const tag = document.createElement('div');
  tag.textContent = found.join('   ·   ');
  tag.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:90;pointer-events:none;white-space:nowrap;' +
    'padding:7px 16px;border-radius:14px;background:rgba(8,14,30,0.82);border:1px solid rgba(160,210,255,0.6);color:#e6f3ff;' +
    'font:bold 14px "Trebuchet MS",sans-serif;box-shadow:0 0 14px rgba(120,190,255,0.45);transition:opacity 0.8s';
  document.body.appendChild(tag);
  setTimeout(() => { tag.style.opacity = '0'; setTimeout(() => tag.remove(), 900); }, 5000);
})();

function seeded(s) { return () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- The picture ----------
// cave.jpg is the whole Cave. A tiny copy of it, stretched big, makes a soft blurred backdrop for tall phone screens
// (where the picture fits the width and leaves room above and below). The middle of the orb's galaxy is cut out once
// with softly fading edges, so it can turn on its own while the rest of the orb stays still.
const caveImg = new Image(), orbImg = new Image(), clockImg = new Image();
let caveReady = false, orbReady = false, clockReady = false, soft = null, swirl = null, feathered = null, wings = null, wingsFor = '';
caveImg.onload = () => {
  soft = document.createElement('canvas'); soft.width = soft.height = 48;
  soft.getContext('2d').drawImage(caveImg, 0, 0, 48, 48);
  // For very wide screens: a copy of the picture whose very edges fade a little, so it melts into the mirrored sides
  // (only a thin strip: the arches stay whole)
  feathered = document.createElement('canvas'); feathered.width = caveImg.width; feathered.height = caveImg.height;
  const fg = feathered.getContext('2d'), fw = caveImg.width * 0.015;
  fg.drawImage(caveImg, 0, 0);
  fg.globalCompositeOperation = 'destination-out';
  for (const [x0, x1] of [[0, fw], [caveImg.width, caveImg.width - fw]]) {
    const grd = fg.createLinearGradient(x0, 0, x1, 0);
    grd.addColorStop(0, 'rgba(0,0,0,1)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    fg.fillStyle = grd; fg.fillRect(Math.min(x0, x1), 0, fw, caveImg.height);
  }
  caveReady = true;
};
caveImg.onerror = () => console.warn('cave.jpg did not load');
caveImg.src = new URL('cave.jpg', import.meta.url).href;   // the pictures sit next to this file
orbImg.onload = () => {   // the middle of the galaxy, cut out round with a soft edge, to turn on its own
  const half = orbImg.width / 2, r = CORE.r * half, n = Math.round(r * 2);
  swirl = document.createElement('canvas'); swirl.width = swirl.height = n;
  const sg = swirl.getContext('2d');
  sg.drawImage(orbImg, half + CORE.x * half - r, half + CORE.y * half - r, n, n, 0, 0, n, n);
  sg.globalCompositeOperation = 'destination-in';
  const fade = sg.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  fade.addColorStop(0, '#000'); fade.addColorStop(0.45, '#000'); fade.addColorStop(1, 'rgba(0,0,0,0)');
  sg.fillStyle = fade; sg.fillRect(0, 0, n, n);
  orbReady = true;
};
orbImg.onerror = () => console.warn('globe.png did not load');
orbImg.src = new URL('globe.png', import.meta.url).href;
clockImg.onload = () => { clockReady = true; };
clockImg.onerror = () => console.warn('clock.jpg did not load');
clockImg.src = new URL('clock.jpg', import.meta.url).href;
// Where things sit in clock.jpg (in its pixels): the middle of the dial, its outer neon ring and the edge of its dark face
const DIAL = { x: 507, y: 510, ring: 445, face: 402 };

// ---------- Where the picture sits on screen, worked out again whenever the window changes size ----------
// It fills the screen, but a tall phone screen shows its whole width instead, so both doorways stay in view, and a very
// wide screen doesn't zoom in past the point where the arches get cut off: the sides get a soft blurred mirror of the edges.
let W = 0, H = 0, DPR = 1, D = 0, ox = 0, oy = 0;   // the picture's width on screen and where its corner sits
let sparkles = [], snow = [], stars = [], dust = [], haze = null;
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
  // Stars twinkling inside the orb, slowly circling its galaxy (as parts of the orb's size)
  stars = [];
  for (let i = 0; i < 46; i++) stars.push({ a: rnd() * 7, d: 0.12 + Math.sqrt(rnd()) * 0.8, r: 0.004 + rnd() * 0.009, sp: 0.03 + rnd() * 0.08, ph: rnd() * 7, tw: 1 + rnd() * 3 });
  // Dust drifting in the beam of light (along the beam 0 to 1, and across it -1 to 1)
  dust = [];
  for (let i = 0; i < (PHONE ? 40 : 80); i++) dust.push({ al: rnd(), ac: rnd() * 2 - 1, r: 0.6 + rnd() * 1.6, v: 0.004 + rnd() * 0.012, ph: rnd() * 7 });
  // The soft blue shade toward the edges
  haze = g.createRadialGradient(W / 2, H * 0.5, Math.min(W, H) * 0.3, W / 2, H * 0.5, Math.hypot(W, H) * 0.62);
  haze.addColorStop(0, 'rgba(10,14,40,0)'); haze.addColorStop(1, 'rgba(4,6,20,0.45)');
  beamFor = '';   // the beam of light gets drawn again for the new size
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
  wg.fillStyle = 'rgba(8,12,36,0.12)'; wg.fillRect(0, 0, W, H);
}
// ---------- The light falling in from the top of the dome: the sun by day and the moon by night, on your own clock ----------
// Through the day: [the hour, the light's color, how bright the beam is, how dark the Cave is]
const SKY = [
  [0, [140, 170, 255], 0.55, 0.64], [5, [140, 170, 255], 0.5, 0.64], [6.5, [255, 150, 120], 0.65, 0.56],
  [8, [255, 215, 160], 0.8, 0.5], [12, [255, 240, 215], 0.95, 0.46], [16, [255, 220, 165], 0.85, 0.5],
  [18, [255, 135, 90], 0.75, 0.55], [19.5, [180, 130, 230], 0.5, 0.62], [21, [140, 170, 255], 0.55, 0.64], [24, [140, 170, 255], 0.55, 0.64]];
function skyNow() {
  const d = new Date(), h = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  let i = 0;
  while (h >= SKY[i + 1][0]) i++;
  const [h0, c0, b0, k0] = SKY[i], [h1, c1, b1, k1] = SKY[i + 1], f = (h - h0) / (h1 - h0);
  // how far across the sky the sun (6:30 in the morning to 7 at night) or the moon (the rest) has gone, 0 to 1
  const p = h >= 6.5 && h < 19 ? (h - 6.5) / 12.5 : ((h + 5) % 24) / 11.5;
  return { col: c0.map((c, j) => Math.round(lerp(c, c1[j], f))), bright: lerp(b0, b1, f), dark: lerp(k0, k1, f), p,
           key: Math.floor(h * 12) };   // (the beam's drawn again every five minutes, as the sun or the moon moves)
}
// The beam: in through the top of the dome, slanting across as the sun (or the moon) goes over, onto the snow floor.
// Drawn once into its own picture (soft and blurred), then laid over the Cave every frame.
let beam = null, beamFor = '';
function beamShape(sky) {   // where the beam starts and lands, in the picture's spots, and how wide it is at each end
  return { ut: 0.5 - (0.5 - sky.p) * 0.25, uf: 0.88 - sky.p * 0.76, vt: -0.03, vf: 0.72, wt: 0.05, wf: 0.14 };
}
function makeBeam(sky) {
  beam = beam || document.createElement('canvas');
  beam.width = Math.round(W / 2); beam.height = Math.round(H / 2);
  const b = beam.getContext('2d');
  b.setTransform(0.5, 0, 0, 0.5, 0, 0);
  const px = u => ox + u * D, py = v => oy + v * D;   // (without the drift with the mouse: that's added as it's drawn)
  const c = sky.col.join(','), a = sky.bright, { ut, uf, vt, vf } = beamShape(sky);
  b.filter = `blur(${Math.max(4, D * 0.012)}px)`;
  for (const [wt, wf, k] of [[0.09, 0.22, 0.35], [0.055, 0.14, 0.55], [0.025, 0.065, 0.8]]) {   // soft and wide outside, brighter in the middle
    const gr = b.createLinearGradient(px(ut), py(vt), px(uf), py(vf));
    gr.addColorStop(0, `rgba(${c},${a * k})`); gr.addColorStop(0.6, `rgba(${c},${a * k * 0.6})`); gr.addColorStop(1, `rgba(${c},${a * k * 0.3})`);
    b.fillStyle = gr;
    b.beginPath(); b.moveTo(px(ut - wt), py(vt)); b.lineTo(px(ut + wt), py(vt)); b.lineTo(px(uf + wf), py(vf)); b.lineTo(px(uf - wf), py(vf));
    b.closePath(); b.fill();
  }
  b.filter = 'none';
  b.save(); b.translate(px(uf), py(vf)); b.scale(1, 0.28);   // the pool of light where it lands on the snow
  const pool = b.createRadialGradient(0, 0, 0, 0, 0, 0.24 * D);
  pool.addColorStop(0, `rgba(${c},${a * 0.8})`); pool.addColorStop(1, 'rgba(0,0,0,0)');
  b.fillStyle = pool; b.fillRect(-0.24 * D, -0.24 * D, 0.48 * D, 0.48 * D);
  b.restore();
  const top = b.createRadialGradient(px(ut), py(0), 0, px(ut), py(0), 0.14 * D);   // the bright gap up in the dome
  top.addColorStop(0, `rgba(${c},${a * 0.6})`); top.addColorStop(1, 'rgba(0,0,0,0)');
  b.fillStyle = top; b.fillRect(px(ut) - 0.14 * D, py(0) - 0.14 * D, 0.28 * D, 0.28 * D);
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

  // The Cave in the dark
  const sky = skyNow();
  g.fillStyle = `rgba(4,6,22,${sky.dark})`; g.fillRect(0, 0, W, H);

  // The doors: soft violet light breathing out of each doorway, and a glow over the arch you point at
  g.globalCompositeOperation = 'lighter';
  for (const side of ['left', 'right']) {
    const a = ARCHES[side], d = a.door, open = !!PLACES[side].file, lit = hover === side;
    const cx = sx((d.x0 + d.x1) / 2), cy = sy(d.bottom - (d.bottom - d.top) * 0.4), rr = (d.x1 - d.x0) * D * 1.4;
    const a0 = (0.1 + pulse * 0.05) * (lit ? 1.8 : 1) + (going === side ? k : 0);
    const warm = g.createRadialGradient(cx, cy, 0, cx, cy, rr);
    warm.addColorStop(0, `rgba(210,140,255,${a0})`); warm.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = warm; g.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);
    if (lit || (shake.side === side && now - shake.t < 500)) {
      const r2 = (a.x1 - a.x0) * D * 0.7, ay = sy((a.top + a.bottom) / 2);
      const shine = g.createRadialGradient(cx, ay, 0, cx, ay, r2);
      shine.addColorStop(0, open ? `rgba(255,200,150,${0.12 + pulse * 0.06})` : `rgba(150,215,255,${0.12 + pulse * 0.05})`);
      shine.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = shine; g.fillRect(cx - r2, ay - r2, r2 * 2, r2 * 2);
    }
  }
  g.globalCompositeOperation = 'source-over';

  // The light falling in from the top of the dome (the sun or the moon, on your own clock), with dust drifting in it
  // (behind the orb: at midday it shines round the orb's edges)
  if (caveReady) {
    const key = W + 'x' + H + ':' + sky.key;
    if (beamFor !== key) { makeBeam(sky); beamFor = key; }
    const [bx, by] = offset(DRIFT);
    g.globalCompositeOperation = 'screen';
    g.globalAlpha = 0.93 + 0.07 * Math.sin(t * 0.7) * Math.sin(t * 1.9);   // the light shimmers a little
    g.drawImage(beam, bx, by, W, H);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'lighter';   // dust drifting down through it
    const { ut, uf, vt, vf, wt, wf } = beamShape(sky), c = sky.col.join(',');
    for (const d of dust) {
      const al = (d.al + t * d.v) % 1, u = lerp(ut, uf, al) + d.ac * lerp(wt, wf, al) * 0.8 + Math.sin(t * 0.5 + d.ph) * 0.004;
      const a = sky.bright * 0.7 * Math.sin(Math.PI * al) * (0.4 + 0.6 * Math.max(0, Math.sin(t * 1.3 + d.ph)));
      if (a < 0.03) continue;
      g.fillStyle = `rgba(${c},${a})`;
      g.beginPath(); g.arc(sx(u), sy(lerp(vt, vf, al)), d.r, 0, Math.PI * 2); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  }

  // The orb: floating over the mound with its light on the snow under it, the galaxy in its middle slowly turning,
  // and stars twinkling in the glass
  const glowUp = (hover === 'orb' ? 1.4 : 1) + (going === 'orb' ? k * 1.5 : 0), bob = Math.sin(t * 0.9) * 0.012;
  const X = sx(GLOBE.x), Y = sy(GLOBE.y + bob * GLOBE.r), R = GLOBE.r * D;
  g.globalCompositeOperation = 'lighter';
  g.save(); g.translate(X, sy(GLOBE.y + GLOBE.r * 1.04)); g.scale(1, 0.25);
  const pool = g.createRadialGradient(0, 0, 0, 0, 0, R * 1.3);
  pool.addColorStop(0, `rgba(90,220,255,${(0.26 + pulse * 0.08 - bob * 4) * glowUp})`); pool.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = pool; g.fillRect(-R * 1.3, -R * 1.3, R * 2.6, R * 2.6);
  g.restore();
  const halo = g.createRadialGradient(X, Y, R * 0.9, X, Y, R * 1.9);   // around the glass, not on it
  halo.addColorStop(0, `rgba(80,200,255,${(0.14 + pulse * 0.07) * glowUp})`); halo.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = halo; g.fillRect(X - R * 2, Y - R * 2, R * 4, R * 4);
  g.globalCompositeOperation = 'source-over';
  if (orbReady) {
    g.drawImage(orbImg, X - R, Y - R, R * 2, R * 2);
    const cx = X + CORE.x * R, cy = Y + CORE.y * R, sr = CORE.r * R;
    g.save();   // the galaxy turns (faster and faster as you go through)
    g.translate(cx, cy); g.rotate(-(t * 0.15 + (going === 'orb' ? k * k * 3 : 0)));
    g.drawImage(swirl, -sr, -sr, sr * 2, sr * 2);
    g.restore();
    g.save();
    g.beginPath(); g.arc(X, Y, R * 0.96, 0, Math.PI * 2); g.clip();
    g.globalCompositeOperation = 'lighter';
    const core = g.createRadialGradient(cx, cy, 0, cx, cy, R * 0.45);
    core.addColorStop(0, `rgba(150,255,255,${(0.05 + pulse * 0.07) * glowUp + (going === 'orb' ? k * 0.6 : 0)})`); core.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = core; g.fillRect(cx - R * 0.45, cy - R * 0.45, R * 0.9, R * 0.9);
    for (const st of stars) {   // stars slowly circling the middle, twinkling
      const a = Math.max(0, Math.sin(t * st.tw + st.ph)) ** 3;
      if (a < 0.05) continue;
      const ang = st.a + t * st.sp;
      g.fillStyle = `rgba(220,255,255,${a * 0.9})`;
      g.beginPath(); g.arc(cx + Math.cos(ang) * st.d * R, cy + Math.sin(ang) * st.d * R * 0.85, st.r * R, 0, Math.PI * 2); g.fill();
    }
    g.restore();
  }

  // The neon clock on the wall, showing your own time
  if (clockReady) {
    const cx = sx(CLOCK.x), cy = sy(CLOCK.y), s = CLOCK.r * D / DIAL.ring, fr = DIAL.face * s;
    g.fillStyle = 'rgba(4,5,20,0.94)';   // its dark face
    g.beginPath(); g.arc(cx, cy, fr, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = 'screen';   // the picture's black melts away, leaving the glowing rings and marks
    g.drawImage(clockImg, cx - DIAL.x * s, cy - DIAL.y * s, clockImg.width * s, clockImg.height * s);
    g.globalCompositeOperation = 'lighter';
    const d = new Date(), sec = d.getSeconds() + d.getMilliseconds() / 1000, min = d.getMinutes() + sec / 60, hr = d.getHours() % 12 + min / 60;
    const hand = (turn, len, tail, w, col, alpha) => {
      const a = turn * Math.PI * 2 - Math.PI / 2, c = Math.cos(a), sn = Math.sin(a);
      g.strokeStyle = col; g.globalAlpha = alpha; g.lineWidth = Math.max(1, w * fr); g.lineCap = 'round';
      g.shadowColor = col; g.shadowBlur = Math.max(4, fr * 0.12);
      g.beginPath(); g.moveTo(cx - c * tail * fr, cy - sn * tail * fr); g.lineTo(cx + c * len * fr, cy + sn * len * fr); g.stroke();
    };
    hand(hr / 12, 0.5, 0.08, 0.06, '#ff5fd0', 1);
    hand(min / 60, 0.76, 0.1, 0.034, '#4fb8ff', 1);
    hand(sec / 60, 0.84, 0.16, 0.012, '#e8dcff', 0.75);
    g.globalAlpha = 1; g.shadowBlur = Math.max(4, fr * 0.1); g.shadowColor = '#c9a8ff';
    g.fillStyle = '#f2eaff'; g.beginPath(); g.arc(cx, cy, fr * 0.045, 0, Math.PI * 2); g.fill();
    g.shadowBlur = 0;
    g.globalCompositeOperation = 'source-over';
  }

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