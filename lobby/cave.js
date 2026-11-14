// =====================================================================
// cave.js — the Cave: the front door of the site. The inside of a great snow block ice palace (cave4.jpg, from a Kindroid
// image): a round skylight open to the sky high in the dome, a glass orb holding a teal galaxy on a carved ice pedestal in
// a pointed archway in the middle (open to the sky behind it), and four carved archways with wooden doors, two on each side.
// Pick your name, then touch the orb (the Doodle Gallery) or a door. On the left, the front door is the Table Room and the
// door behind it is the Game Room; their frosted glass windows glow blue. The two doors on the right are still sealed
// (their windows are dim). No names float over anything: people find their way.
// The torches and the little floor candles flicker, and the odd ember drifts up from a torch.
// The skylight and the archway behind the orb show a painted sky that slowly drifts, picked by your own clock: dawn from
// 5am, day from 7am, dusk from 5pm and night from 7:30pm (sky_dawn.jpg, sky_day.jpg, sky_dusk.jpg, sky_night.jpg), each
// fading into the next over half an hour. Stars twinkle over the night and dusk skies, and now and then a star shoots.
// The screen flashes white (or warm gold for a door), fades to black, and only then does that room's code load; a little
// snowflake turns while it does. Then the room fades in and you walk in through its door.
// The galaxy in the orb turns slowly, stars twinkle in the glass, and its glow gently breathes.
// Coming back through a room's portal, the Cave fades in from black.
// Every time the page loads, a little tag pops up for a few seconds with the version of each room's files your browser
// has right now (each file says its version on a "VERSION" line at its top), so you can tell when an update has arrived.
// VERSION 7
// =====================================================================
import { sfx } from '../sounds.js';
import { inCave, joinCave, leaveCave } from '../world.js';   // who's online, everywhere (and you, here in the Cave)
inCave();
const PLACES = {
  orb:        { name: 'Doodle Gallery', file: '../studio/studio.js' },
  leftFront:  { name: 'Table Room', file: '../table/tables.js' },
  leftBack:   { name: 'Game Room', file: '../game/games.js' },
  rightBack:  { name: 'A sealed door', file: null },
  rightFront: { name: 'A sealed door', file: null }
};

// Where things sit in cave4.jpg (2600 x 1733 pixels), measured in its own pixels and turned into parts of its width
const PIC = 2600, P = n => n / PIC;
const ASPECT = 1733 / 2600;   // the picture's height, as a part of its width
const GLOBE = { x: P(1284), y: P(1045), r: P(195), base: P(1212) };   // the orb, and where its pedestal starts covering it
const CORE = { x: -0.067, y: 0.01 };   // the bright middle of its galaxy (parts of the orb's radius from its middle)
// Each archway: the outline of its carved ring (points around it, top first going clockwise doesn't matter), and the
// middle of its door (where the light pours from when you go through)
const pts = list => list.map(([x, y]) => [P(x), P(y)]);
const ARCHES = {
  leftFront:  { ring: pts([[40, 1450], [40, 850], [90, 620], [200, 470], [330, 410], [450, 470], [510, 620], [522, 850], [522, 1450]]),
                door: { x: P(185), y: P(1080) } },
  leftBack:   { ring: pts([[675, 1385], [675, 1100], [700, 990], [760, 935], [820, 920], [880, 950], [915, 1050], [925, 1200], [925, 1385]]),
                door: { x: P(760), y: P(1200) } },
  rightBack:  { ring: pts([[1640, 1385], [1640, 1080], [1670, 990], [1720, 950], [1790, 960], [1830, 1030], [1845, 1150], [1825, 1385]]),
                door: { x: P(1760), y: P(1200) } },
  rightFront: { ring: pts([[1945, 1480], [1945, 800], [2000, 600], [2120, 505], [2300, 480], [2450, 530], [2540, 650], [2578, 850], [2582, 1440]]),
                door: { x: P(2400), y: P(1100) } }
};
const SIDES = ['leftBack', 'rightBack', 'leftFront', 'rightFront'];   // (the back doors first: the nearer one wins where they touch)
// The frosted glass in each door: where its cut-out (glass4.png, the four side by side) sits in the picture, and where it
// starts in glass4.png: [x, y, width, height, start in glass4.png], in the picture's pixels
const GLASS = { leftFront: [48, 735, 154, 706, 0], leftBack: [699, 1059, 75, 315, 154],
                rightBack: [1756, 1056, 71, 296, 229], rightFront: [2371, 784, 149, 652, 300] };
// The flames: torches on the arches [x, y, size], and the little candles on the floor
const TORCHES = [[128, 1070, 34], [697, 1172, 20], [1812, 1184, 20], [2474, 1088, 34]];
const CANDLES = [[579, 1435, 14], [612, 1430, 10], [646, 1441, 11], [1983, 1428, 18], [228, 1719, 16], [294, 1726, 18], [2346, 1720, 22]];
// The sky shows through two cut-outs: the skylight up top and the archway behind the orb. skymask4.png says exactly where
// (it sits at SKY_AT in the picture). Each cut-out is [x, y, width, height] in the picture's pixels.
const SKY_AT = { x: 1030, y: 0, w: 550, h: 1300 };
const SKY_VIEWS = [{ at: [1030, 0, 545, 450], shooting: true }, { at: [1030, 680, 530, 620], shooting: false }];
// The painted skies. Each shows its own best part in each cut-out: [left, top, right, bottom] as parts of the sky picture
// (skylight first, then the archway). stars: how strongly the extra stars twinkle over it. color: shown if it hasn't loaded.
const SKIES = {
  dawn:  { file: 'sky_dawn.jpg',  from: [[0, 0, 1, 0.82], [0.22, 0.4, 0.78, 1]],          stars: 0.25, color: [150, 140, 190] },
  day:   { file: 'sky_day.jpg',   from: [[0, 0, 0.62, 0.52], [0.38, 0.42, 0.86, 1]],      stars: 0,    color: [90, 160, 225] },
  dusk:  { file: 'sky_dusk.jpg',  from: [[0.3, 0.04, 0.86, 0.5], [0.3, 0.4, 0.78, 0.97]], stars: 0.6,  color: [70, 50, 110] },
  night: { file: 'sky_night.jpg', from: [[0, 0, 1, 0.749], [0.053, 0.097, 0.904, 1]],     stars: 1,    color: [8, 14, 35] }
};
// When each sky starts, by your clock (hours); it fades in over FADE hours from there
const SKY_TIMES = [[5, 'dawn'], [7, 'day'], [17, 'dusk'], [19.5, 'night']];
const FADE = 0.5;
// What has to be on screen: from the top of the skylight down to the feet of the doors
const VIEW_TOP = P(0), VIEW_BOTTOM = P(1520);

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

// ---------- The pictures ----------
// cave4.jpg is the whole Cave. Its painted sky is cut away (skymask4.png says where), so the live sky shows through from
// behind. A tiny copy of it, stretched big, makes a soft blurred backdrop for tall phone screens. The middle of the orb's
// galaxy is cut out once with softly fading edges, so it can turn on its own while everything around it stays still.
// glass4.png is the shape of each door's frosted glass, used to make the open doors' windows glow and the sealed ones dim.
const SWIRL = 0.42;   // how much of the orb turns, around the middle of its galaxy (part of the orb's radius)
const caveImg = new Image(), maskImg = new Image(), glassImg = new Image();
let caveReady = false, soft = null, swirl = null, cut = null, feathered = null, wings = null;
const glassLit = {}, glassDim = {};   // each window's glass, ready to glow (open doors) or to darken (sealed doors)
const loaded = img => new Promise(done => { img.onload = () => done(true); img.onerror = () => { console.warn(img.src + ' did not load'); done(false); }; });
for (const key in SKIES) {   // each sky is ready once its picture loads
  const sk = SKIES[key];
  sk.img = new Image(); sk.ready = false;
  loaded(sk.img).then(ok => { sk.ready = ok; });
  sk.img.src = new URL(sk.file, import.meta.url).href;
}
Promise.all([loaded(caveImg), loaded(maskImg), loaded(glassImg)]).then(([okCave, okMask, okGlass]) => {
  if (!okCave) return;
  const k = caveImg.width / PIC;   // (in case the picture is ever swapped for a bigger or smaller copy)
  soft = document.createElement('canvas'); soft.width = 48; soft.height = Math.round(48 * ASPECT);
  soft.getContext('2d').drawImage(caveImg, 0, 0, soft.width, soft.height);
  // The picture with its painted sky cut away
  cut = document.createElement('canvas'); cut.width = caveImg.width; cut.height = caveImg.height;
  const cg = cut.getContext('2d');
  cg.drawImage(caveImg, 0, 0);
  if (okMask) {
    cg.globalCompositeOperation = 'destination-out';
    cg.drawImage(maskImg, SKY_AT.x * k, SKY_AT.y * k, SKY_AT.w * k, SKY_AT.h * k);
    cg.globalCompositeOperation = 'source-over';
  }
  // For wide screens: a copy whose very edges fade a little, so it melts into the mirrored sides
  feathered = document.createElement('canvas'); feathered.width = cut.width; feathered.height = cut.height;
  const fg = feathered.getContext('2d'), fw = cut.width * 0.07;
  fg.drawImage(cut, 0, 0);
  fg.globalCompositeOperation = 'destination-out';
  for (const [x0, x1] of [[0, fw], [cut.width, cut.width - fw]]) {
    const grd = fg.createLinearGradient(x0, 0, x1, 0);
    grd.addColorStop(0, 'rgba(0,0,0,1)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    fg.fillStyle = grd; fg.fillRect(Math.min(x0, x1), 0, fw, cut.height);
  }
  // Each window's glass: the picture's own glass (for the glow, so its frost pattern lights up) and a dark copy (to dim it)
  if (okGlass) {
    for (const side of SIDES) {
      const [x, y, w, h, at] = GLASS[side];
      const lit = document.createElement('canvas'); lit.width = w; lit.height = h;
      const lg = lit.getContext('2d');
      lg.drawImage(caveImg, x * k, y * k, w * k, h * k, 0, 0, w, h);
      lg.fillStyle = 'rgba(60,140,255,0.35)'; lg.fillRect(0, 0, w, h);   // a little extra icy blue
      lg.globalCompositeOperation = 'destination-in';
      lg.drawImage(glassImg, at, 0, w, h, 0, 0, w, h);
      glassLit[side] = lit;
      const dim = document.createElement('canvas'); dim.width = w; dim.height = h;
      const dg = dim.getContext('2d');
      dg.fillStyle = 'rgb(6,10,30)'; dg.fillRect(0, 0, w, h);
      dg.globalCompositeOperation = 'destination-in';
      dg.drawImage(glassImg, at, 0, w, h, 0, 0, w, h);
      glassDim[side] = dim;
    }
  }
  const S = caveImg.width, r = GLOBE.r * SWIRL * S, n = Math.round(r * 2);
  const cx = (GLOBE.x + CORE.x * GLOBE.r) * S, cy = (GLOBE.y + CORE.y * GLOBE.r) * S;
  swirl = document.createElement('canvas'); swirl.width = swirl.height = n;
  const sg = swirl.getContext('2d');
  sg.drawImage(caveImg, cx - r, cy - r, n, n, 0, 0, n, n);
  sg.globalCompositeOperation = 'destination-in';   // keep the middle, fading out toward the edge
  const fade = sg.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  fade.addColorStop(0, '#000'); fade.addColorStop(0.45, '#000'); fade.addColorStop(1, 'rgba(0,0,0,0)');
  sg.fillStyle = fade; sg.fillRect(0, 0, n, n);
  caveReady = true;
});
caveImg.src = new URL('cave4.jpg', import.meta.url).href;   // the pictures sit next to this file
maskImg.src = new URL('skymask4.png', import.meta.url).href;
glassImg.src = new URL('glass4.png', import.meta.url).href;

// ---------- Where the picture sits on screen, worked out again whenever the window changes size ----------
// A wide screen shows everything from the skylight down to the feet of the doors, the sides filled with a soft blurred
// mirror of the picture's edges; a tall phone screen shows its whole width instead, with the orb a little above the middle.
let W = 0, H = 0, DPR = 1, D = 0, ox = 0, oy = 0;   // the picture's width on screen and where its corner sits
let sparkles = [], snow = [], flakes = [], haze = null;
const M = 1.03;   // a little bigger than it has to be, so it can drift with the mouse without showing an edge
function build() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  const fitTall = H / (VIEW_BOTTOM - VIEW_TOP) * M;   // tall enough to show the skylight and the doors
  if (W / H >= 0.9) { D = Math.min(W * M, fitTall); ox = W / 2 - 0.5 * D; oy = H / 2 - (VIEW_TOP + VIEW_BOTTOM) / 2 * D; }
  else { D = W / 0.97; ox = W / 2 - 0.5 * D; oy = H * 0.45 - GLOBE.y * D; }
  const rnd = seeded(7);
  // Glints on the snow floor
  sparkles = [];
  for (let i = 0; i < (PHONE ? 50 : 110); i++) sparkles.push({ u: rnd(), v: P(1440) + rnd() * P(280), r: 0.6 + rnd() * 1.6, ph: rnd() * 7, sp: 0.8 + rnd() * 2 });
  // Falling snow, in three layers for depth
  snow = [];
  const area = W * H / (1600 * 900);
  for (const [count, size, speed, depth] of [[90, 1.1, 18, 8], [55, 2.2, 34, 22], [16, 4.2, 62, 42]]) {
    for (let i = 0; i < Math.round(count * area * (PHONE ? 0.6 : 1)) + 4; i++) {
      snow.push({ x: rnd() * (W + 80) - 40, y: rnd() * (H + 40) - 20, r: size * (0.7 + rnd() * 0.6),
        v: speed * (0.75 + rnd() * 0.5), ph: rnd() * 7, sw: 6 + rnd() * 16, depth });
    }
  }
  // Stars twinkling in the orb, slowly circling its galaxy (as parts of the orb's size)
  flakes = [];
  for (let i = 0; i < 46; i++) flakes.push({ a: rnd() * 7, d: 0.12 + Math.sqrt(rnd()) * 0.8, r: 0.004 + rnd() * 0.009, sp: 0.03 + rnd() * 0.08, ph: rnd() * 7, tw: 1 + rnd() * 3 });
  // The soft blue shade toward the edges
  haze = g.createRadialGradient(W / 2, H * 0.5, Math.min(W, H) * 0.3, W / 2, H * 0.5, Math.hypot(W, H) * 0.62);
  haze.addColorStop(0, 'rgba(20,30,80,0)'); haze.addColorStop(1, 'rgba(10,16,48,0.35)');
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
function makeWings() {   // the sides of a wide screen: one blurred, darker copy of the picture, drawn flipped
  // against each side every frame (so it drifts with the picture and the seams always line up)
  const n = 640, h = Math.round(n * ASPECT), p = 24;
  const src = document.createElement('canvas'); src.width = n + p * 2; src.height = h + p * 2;
  const sg = src.getContext('2d');
  sg.drawImage(caveImg, 0, 0, n + p * 2, h + p * 2);   // a stretched copy underneath, so the blur has no empty edges to pull in
  sg.drawImage(caveImg, p, p, n, h);
  wings = document.createElement('canvas'); wings.width = n; wings.height = h;
  const wg = wings.getContext('2d');
  wg.filter = 'blur(5px)';
  wg.drawImage(src, -p, -p);
  wg.filter = 'none';
  wg.fillStyle = 'rgba(10,20,45,0.22)'; wg.fillRect(0, 0, n, h);
}
function sx(u) { return ox + offset(DRIFT)[0] + u * D; }   // a spot in the picture, on screen
function sy(v) { return oy + offset(DRIFT)[1] + v * D; }
function archPath(a) {   // an archway's carved ring, on screen
  const p = new window.Path2D();
  a.ring.forEach(([u, v], i) => (i ? p.lineTo(sx(u), sy(v)) : p.moveTo(sx(u), sy(v))));
  p.closePath();
  return p;
}
function inArch(a, u, v) {   // is this spot inside the ring? (counting how many of its edges a line to the right crosses)
  let inside = false;
  for (let i = 0, j = a.ring.length - 1; i < a.ring.length; j = i++) {
    const [xi, yi] = a.ring[i], [xj, yj] = a.ring[j];
    if ((yi > v) !== (yj > v) && u < (xj - xi) * (v - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function ringBox(a) {   // the left, right and bottom of an archway's ring
  const xs = a.ring.map(p => p[0]), ys = a.ring.map(p => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
}
function whatIsAt(x, y) {
  const u = (x - sx(0)) / D, v = (y - sy(0)) / D;
  if (Math.hypot(u - GLOBE.x, v - GLOBE.y) < GLOBE.r * 1.12) return 'orb';
  for (const side of SIDES) if (inArch(ARCHES[side], u, v)) return side;
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
  else if (what) {   // a sealed door gives a little shiver
    shake = { side: what, t: performance.now() };
    note = { text: 'This door is sealed… for now', side: what, t: performance.now() };
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

// ---------- The sky ----------
// Which sky shows right now, by your own clock: the one whose time came last, fading in over the one before it
function skyNow() {
  const d = new Date(), h = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  let i = SKY_TIMES.length - 1;   // (before 5am it's still the night that began yesterday evening)
  for (let j = 0; j < SKY_TIMES.length; j++) if (h >= SKY_TIMES[j][0]) i = j;
  const since = (h - SKY_TIMES[i][0] + 24) % 24;
  const now = SKY_TIMES[i][1], before = SKY_TIMES[(i + SKY_TIMES.length - 1) % SKY_TIMES.length][1];
  const k = Math.min(1, since / FADE);
  return { now, before, k, stars: SKIES[before].stars * (1 - k) + SKIES[now].stars * k };
}
// Extra stars that twinkle over the painted ones (spots in each view, as parts of its size)
const TWINKLES = SKY_VIEWS.map((view, n) => { const r = seeded(11 + n), out = []; for (let i = 0; i < 38; i++) out.push({ u: r(), v: r(), s: 0.6 + r() * 1.2, ph: r() * 7, tw: 0.6 + r() * 2.2 }); return out; });
let shooting = null, nextShot = 6 + Math.random() * 10;   // a shooting star: { x, y, dx, dy, t } in parts of the view
function paintSky(key, n, x0, y0, w, h, t, alpha) {   // one painted sky in one cut-out, a touch zoomed in so it can wander
  const sk = SKIES[key];
  g.globalAlpha = alpha;
  if (!sk.ready) { g.fillStyle = `rgb(${sk.color})`; g.fillRect(x0 - 20, y0 - 20, w + 40, h + 40); g.globalAlpha = 1; return; }
  const img = sk.img, [f0, f1, f2, f3] = sk.from[n], zoom = 0.94;   // very slowly, in a little circle
  const fw = (f2 - f0) * img.width, fh = (f3 - f1) * img.height, cw = fw * zoom, ch = fh * zoom;
  const wx = (fw - cw) / 2 * (1 + 0.9 * Math.sin(t * 0.011 + n)), wy = (fh - ch) / 2 * (1 + 0.9 * Math.cos(t * 0.008 + n));
  g.drawImage(img, f0 * img.width + wx, f1 * img.height + wy, cw, ch, x0 - 20, y0 - 20, w + 40, h + 40);
  g.globalAlpha = 1;
}
function drawSky(t, dt) {   // behind the picture: the painted sky for the time of day, twinkles and shooting stars
  const sky = skyNow(), [px, py] = offset(DRIFT * -0.5);   // far away, so it drifts with the mouse less than the stone does
  SKY_VIEWS.forEach((view, n) => {
    const [ax, ay, aw, ah] = view.at, x0 = sx(P(ax)) + px, y0 = sy(P(ay)) + py, w = P(aw) * D, h = P(ah) * D;
    if (sky.k < 1) paintSky(sky.before, n, x0, y0, w, h, t, 1);   // the sky that's fading out underneath
    paintSky(sky.now, n, x0, y0, w, h, t, sky.k < 1 ? sky.k : 1);
    if (sky.stars < 0.02) return;
    g.globalCompositeOperation = 'lighter';
    for (const s of TWINKLES[n]) {
      const a = sky.stars * Math.max(0, Math.sin(t * s.tw + s.ph)) ** 4;
      if (a < 0.04) continue;
      const X = x0 + s.u * w, Y = y0 + s.v * h, r = s.s * Math.max(1, D / 1600);
      g.fillStyle = `rgba(235,242,255,${a})`;
      g.beginPath(); g.arc(X, Y, r, 0, Math.PI * 2); g.fill();
      if (a > 0.6) { g.fillStyle = `rgba(200,225,255,${(a - 0.6) * 0.5})`; g.fillRect(X - r * 5, Y - r * 0.25, r * 10, r * 0.5); g.fillRect(X - r * 0.25, Y - r * 5, r * 0.5, r * 10); }
    }
    if (view.shooting && shooting) {   // a streak with a fading tail
      const k = shooting.t / 0.9, X = x0 + (shooting.x + shooting.dx * k) * w, Y = y0 + (shooting.y + shooting.dy * k) * h;
      const tail = g.createLinearGradient(X, Y, X - shooting.dx * w * 0.35, Y - shooting.dy * h * 0.35);
      const a = Math.sin(Math.PI * Math.min(1, k)) * sky.stars;
      tail.addColorStop(0, `rgba(255,255,255,${a})`); tail.addColorStop(1, 'rgba(180,220,255,0)');
      g.strokeStyle = tail; g.lineWidth = Math.max(1.2, D / 1400); g.lineCap = 'round';
      g.beginPath(); g.moveTo(X, Y); g.lineTo(X - shooting.dx * w * 0.35, Y - shooting.dy * h * 0.35); g.stroke();
    }
    g.globalCompositeOperation = 'source-over';
  });
  if (shooting) { shooting.t += dt; if (shooting.t > 0.9) shooting = null; }
  else if ((nextShot -= dt) <= 0) {
    nextShot = 9 + Math.random() * 16;
    if (sky.stars < 0.5) return;   // only when it's dark enough to see one
    const right = Math.random() < 0.5;
    shooting = { x: right ? 0.15 + Math.random() * 0.3 : 0.55 + Math.random() * 0.3, y: 0.1 + Math.random() * 0.25,
                 dx: (right ? 1 : -1) * (0.35 + Math.random() * 0.2), dy: 0.18 + Math.random() * 0.12, t: 0 };
  }
}

// ---------- The flames: torches and floor candles flicker, and embers drift up from the torches ----------
const FLAMES = [...TORCHES.map(f => ({ x: P(f[0]), y: P(f[1]), s: P(f[2]), torch: true })),
                ...CANDLES.map(f => ({ x: P(f[0]), y: P(f[1]), s: P(f[2]), torch: false }))];
FLAMES.forEach((f, i) => { f.ph = i * 1.7; f.ph2 = i * 2.9 + 1; });
let embers = [];
function flicker(f, t) {   // a few wobbles layered together, so it never looks like a steady beat
  return 0.72 + 0.16 * Math.sin(t * 8.3 + f.ph) + 0.08 * Math.sin(t * 21.7 + f.ph2) + 0.07 * Math.sin(t * 3.1 + f.ph * 0.5);
}
function drawFlames(t, dt) {
  g.globalCompositeOperation = 'lighter';
  for (const f of FLAMES) {
    const k = flicker(f, t), X = sx(f.x) + Math.sin(t * 6 + f.ph) * f.s * D * 0.04, Y = sy(f.y), R = f.s * D;
    const wall = g.createRadialGradient(X, Y, 0, X, Y, R * (f.torch ? 4.2 : 3.2));   // warm light on the snow and stone
    wall.addColorStop(0, `rgba(255,150,70,${0.16 * k})`); wall.addColorStop(0.4, `rgba(255,120,50,${0.06 * k})`); wall.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = wall; g.fillRect(X - R * 4.2, Y - R * 4.2, R * 8.4, R * 8.4);
    const core = g.createRadialGradient(X, Y - R * 0.15, 0, X, Y - R * 0.15, R * 0.8);   // the bright heart of the flame
    core.addColorStop(0, `rgba(255,235,180,${0.38 * k})`); core.addColorStop(0.5, `rgba(255,170,80,${0.15 * k})`); core.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = core; g.fillRect(X - R, Y - R * 1.2, R * 2, R * 2);
    if (f.torch && Math.random() < dt * 1.4) embers.push({ x: f.x, y: f.y - f.s * 0.3, vx: (Math.random() - 0.5) * 0.004, vy: -(0.01 + Math.random() * 0.012), life: 0, max: 1.2 + Math.random() * 1.4, r: 0.6 + Math.random() });
  }
  embers = embers.filter(e => (e.life += dt) < e.max);
  for (const e of embers) {
    e.x += (e.vx + Math.sin(e.life * 5 + e.max * 9) * 0.002) * dt; e.y += e.vy * dt;
    const a = Math.sin(Math.PI * e.life / e.max);
    g.fillStyle = `rgba(255,${170 + Math.round(60 * (1 - e.life / e.max))},90,${a * 0.9})`;
    g.beginPath(); g.arc(sx(e.x), sy(e.y), e.r * Math.max(1, D / 1800), 0, Math.PI * 2); g.fill();
  }
  g.globalCompositeOperation = 'source-over';
}

// ---------- Drawing every frame ----------
let raf = 0, last = performance.now();
const t0 = performance.now();
function frame(now) {
  raf = window.requestAnimationFrame(frame);
  const t = (now - t0) / 1000, dt = Math.min(0.1, (now - last) / 1000);
  last = now;
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
      const B = Math.max(W, H / ASPECT) * 1.1;
      g.drawImage(soft, (W - B) / 2, (H - B * ASPECT) / 2, B, B * ASPECT);
      g.fillStyle = 'rgba(8,12,36,0.35)'; g.fillRect(0, 0, W, H);
    }
    if (wide) {   // the flipped blurred copies, butting up against each side of the picture and drifting with it
      if (!wings) makeWings();
      g.drawImage(wings, sx(0), sy(0), D, D * ASPECT);   // under the picture too, so its faded edges melt into the blur
      for (const side of [-1, 1]) {
        g.save();
        g.translate(side < 0 ? sx(0) : sx(0) + 2 * D, 0);
        g.scale(-1, 1);
        g.drawImage(wings, 0, sy(0), D, D * ASPECT);
        g.restore();
      }
    }
    g.save();   // the sky, showing through the skylight and behind the orb (kept inside the picture)
    g.beginPath(); g.rect(sx(0), sy(0), D, D * ASPECT); g.clip();
    drawSky(t, dt);
    g.restore();
    g.drawImage(wide ? feathered : cut, sx(0), sy(0), D, D * ASPECT);
    // A sealed door you touched gives a little shiver
    for (const side of SIDES) {
      if (shake.side !== side) continue;
      const sh = Math.max(0, 1 - (now - shake.t) / 500);
      if (!sh) continue;
      const b = ringBox(ARCHES[side]), S = caveImg.width;   // (the picture's spots are measured in parts of its width)
      g.save(); g.clip(archPath(ARCHES[side]));
      g.drawImage(caveImg, b.x0 * S, b.top * S, (b.x1 - b.x0) * S, (b.bottom - b.top) * S,
        sx(b.x0) + Math.sin(now * 0.08) * sh * 4, sy(b.top), (b.x1 - b.x0) * D, (b.bottom - b.top) * D);
      g.restore();
    }

    // The frosted glass windows: the open doors' glow icy blue and breathe, the sealed doors' stay dim
    for (const side of SIDES) {
      const [x, y, w, h] = GLASS[side], open = !!PLACES[side].file, lit = hover === side || going === side;
      const X = sx(P(x)), Y = sy(P(y)), gw = P(w) * D, gh = P(h) * D;
      if (open && glassLit[side]) {
        const b = 0.32 + 0.14 * Math.sin(t * 1.3 + x * 0.01) + (lit ? 0.3 : 0) + (going === side ? k * 0.8 : 0);
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = Math.min(1, b);
        g.drawImage(glassLit[side], X, Y, gw, gh);
        g.globalAlpha = 1;
        const cx = X + gw / 2, cy = Y + gh * 0.45, rr = Math.max(gw, gh) * 0.75;   // the soft blue light spilling out
        const glow = g.createRadialGradient(cx, cy, 0, cx, cy, rr);
        glow.addColorStop(0, `rgba(90,170,255,${b * 0.22})`); glow.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = glow; g.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);
        g.globalCompositeOperation = 'source-over';
      } else if (!open && glassDim[side]) {
        g.globalAlpha = 0.5;
        g.drawImage(glassDim[side], X, Y, gw, gh);
        g.globalAlpha = 1;
      }
    }
  }

  // The torches and candles
  if (caveReady) drawFlames(t, dt);

  // The archways: a soft glow over the one you point at (or the one you touched)
  g.globalCompositeOperation = 'lighter';
  for (const side of SIDES) {
    const a = ARCHES[side], d = a.door, b = ringBox(a), open = !!PLACES[side].file, lit = hover === side || going === side;
    if (!lit && !(shake.side === side && now - shake.t < 500)) continue;
    const cx = sx(d.x), cy = sy(d.y), rr = (b.x1 - b.x0) * D * 0.9;
    const shine = g.createRadialGradient(cx, cy, 0, cx, cy, rr);
    shine.addColorStop(0, open ? `rgba(255,200,150,${0.12 + pulse * 0.06 + (going === side ? k * 0.5 : 0)})` : `rgba(150,215,255,${0.1 + pulse * 0.05})`);
    shine.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = shine; g.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);
  }
  g.globalCompositeOperation = 'source-over';

  // The orb: its glow gently breathing, the galaxy in its middle slowly turning, and stars twinkling in the glass
  const glowUp = (hover === 'orb' ? 1.4 : 1) + (going === 'orb' ? k * 1.5 : 0);
  const X = sx(GLOBE.x), Y = sy(GLOBE.y), R = GLOBE.r * D;
  const CX = X + CORE.x * R, CY = Y + CORE.y * R;   // the middle of the galaxy
  g.globalCompositeOperation = 'lighter';
  const halo = g.createRadialGradient(X, Y, R * 0.95, X, Y, R * 1.8);   // around the glass, not on it
  halo.addColorStop(0, `rgba(80,200,255,${(0.05 + pulse * 0.06) * glowUp})`); halo.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = halo; g.fillRect(X - R * 2, Y - R * 2, R * 4, R * 4);
  g.globalCompositeOperation = 'source-over';
  if (swirl) {   // the galaxy turns (faster and faster as you go through)
    const sr = R * SWIRL;
    g.save();
    g.translate(CX, CY); g.rotate(-(t * 0.15 + (going === 'orb' ? k * k * 3 : 0)));
    g.drawImage(swirl, -sr, -sr, sr * 2, sr * 2);
    g.restore();
  }
  g.save();
  g.beginPath(); g.arc(X, Y, R * 0.95, 0, Math.PI * 2); g.clip();
  g.beginPath(); g.rect(X - R, Y - R, R * 2, sy(GLOBE.base) - (Y - R)); g.clip();   // the glass only, above the pedestal
  g.globalCompositeOperation = 'lighter';
  const core = g.createRadialGradient(CX, CY, 0, CX, CY, R * 0.45);
  core.addColorStop(0, `rgba(150,255,255,${(0.03 + pulse * 0.06) * glowUp + (going === 'orb' ? k * 0.6 : 0)})`); core.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = core; g.fillRect(CX - R * 0.45, CY - R * 0.45, R * 0.9, R * 0.9);
  for (const f of flakes) {   // stars slowly circling the middle, twinkling
    const a = Math.max(0, Math.sin(t * f.tw + f.ph)) ** 3;
    if (a < 0.05) continue;
    const ang = f.a + t * f.sp;
    g.fillStyle = `rgba(220,255,255,${a * 0.9})`;
    g.beginPath(); g.arc(CX + Math.cos(ang) * f.d * R, CY + Math.sin(ang) * f.d * R * 0.85, f.r * R, 0, Math.PI * 2); g.fill();
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
      const b = ringBox(ARCHES[note.side]);
      g.globalAlpha = Math.min(1, age * 4, (2.6 - age) * 2);
      g.font = `${clamp(D * 0.011, 12, 18)}px Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'top';
      g.fillStyle = '#e6f7ff'; g.shadowColor = '#000'; g.shadowBlur = 6;
      g.fillText(note.text, clamp(sx((b.x0 + b.x1) / 2), 150, W - 150), Math.min(H - 30, sy(b.bottom) + 8));
      g.shadowBlur = 0; g.globalAlpha = 1;
    }
  }

  // The flash, then the fade to black
  if (going) {
    let fx0, fy0, col;
    if (going === 'orb') { fx0 = X; fy0 = Y; col = '255,255,255'; }
    else { const d = ARCHES[going].door; fx0 = sx(d.x); fy0 = sy(d.y); col = '255,214,150'; }
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