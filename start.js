// =====================================================================
// start.js — the front door. There's no lobby any more: the page opens straight into the Doodle Gallery.
// A cover of falling snow (shaded flakes at every depth, drifting on a gentle wind over a deep night sky) hides the
// room while it loads; then the cover fades and the gallery shows,
// with the name box over it. Type your name (or keep the saved one) and press Enter or ✓ to step in.
// Testing on this PC: localhost:8080/HangoutRoom/?room=game opens the Game Room instead, until the portals exist.
// =====================================================================
const ROOMS = {
  gallery: { name: 'Doodle Gallery', file: './studio/studio.js' },
  game:    { name: 'Game Room', file: './game/games.js' }
};
const LOCAL = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
const asked = LOCAL ? new URLSearchParams(location.search).get('room') : null;
const room = ROOMS[asked] ? asked : 'gallery';

const cover = document.getElementById('cover');
const loadFlake = document.getElementById('loadFlake');
const nameBox = document.getElementById('nameBox');
const nameInput = document.getElementById('nameInput');
const nameTitle = document.getElementById('nameTitle');

// ---------- The name box: a saved name is filled in, so it's one press to come in ----------
let saved = '';
try { saved = (localStorage.getItem('hangoutName') || '').trim().slice(0, 20); } catch (e) {}
if (saved) { nameInput.value = saved; nameTitle.textContent = `Welcome back, ${saved}!`; }
document.getElementById('nameOk').addEventListener('click', () => document.getElementById('enter').click());   // the room's own way in

// ---------- The snow on the cover: far specks, mid flakes, close soft blurred ones, and a few crystals turning ----------
const snow = document.createElement('canvas');
snow.style.cssText = 'position:absolute; inset:0; width:100%; height:100%;';
cover.appendChild(snow);
const sg = snow.getContext('2d');
function sprite(r, blur, crystal) {   // (one flake, drawn once: shaded soft round, or a six-armed crystal)
  const n = Math.ceil(r * 2 + blur * 4 + 4), c = document.createElement('canvas'); c.width = c.height = n;
  const g = c.getContext('2d'), m = n / 2;
  if (crystal) {
    g.strokeStyle = 'rgba(235,246,255,0.95)'; g.lineWidth = Math.max(1, r * 0.09); g.lineCap = 'round';
    g.shadowColor = 'rgba(170,215,255,0.9)'; g.shadowBlur = r * 0.5;
    for (let k = 0; k < 6; k++) {
      const a = k * Math.PI / 3, ex = m + Math.cos(a) * r, ey = m + Math.sin(a) * r;
      g.beginPath(); g.moveTo(m, m); g.lineTo(ex, ey); g.stroke();
      for (const f of [0.5, 0.75]) {   // (the little branches)
        const bx = m + Math.cos(a) * r * f, by = m + Math.sin(a) * r * f, bl = r * 0.28 * (1.1 - f);
        for (const s2 of [-1, 1]) { g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + Math.cos(a + s2 * 0.7) * bl, by + Math.sin(a + s2 * 0.7) * bl); g.stroke(); }
      }
    }
  } else {
    const grd = g.createRadialGradient(m - r * 0.25, m - r * 0.25, 0, m, m, r + blur);   // (lit a little from the top left)
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.45, 'rgba(225,240,255,0.85)');
    grd.addColorStop(0.8, 'rgba(170,205,240,0.35)'); grd.addColorStop(1, 'rgba(150,190,235,0)');
    g.fillStyle = grd; g.beginPath(); g.arc(m, m, r + blur, 0, Math.PI * 2); g.fill();
  }
  return c;
}
const SPRITES = { far: sprite(1.2, 0.6), mid: sprite(2.4, 1.2), near: sprite(5, 6), crystal: sprite(9, 0, true) };
let flakes = [], snowW = 0, snowH = 0, wind = 0, snowLast = performance.now(), snowing = true;
function sizeSnow() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  snowW = snow.width = Math.round(innerWidth * dpr); snowH = snow.height = Math.round(innerHeight * dpr);
  const area = (snowW * snowH) / (1280 * 720);
  flakes = [];
  const add = (kind, n, speed, size, alpha) => { for (let i = 0; i < n * area; i++) flakes.push({ kind, x: Math.random() * snowW, y: Math.random() * snowH,
    v: speed * (0.7 + Math.random() * 0.6) * dpr, s: size * (0.7 + Math.random() * 0.6) * dpr, a: alpha * (0.6 + Math.random() * 0.4),
    ph: Math.random() * 6.28, sw: 0.4 + Math.random() * 0.8, rot: Math.random() * 6.28, spin: (Math.random() - 0.5) * 0.8 }); };
  add('far', 260, 18, 1, 0.55); add('mid', 120, 42, 1, 0.75); add('near', 26, 95, 1, 0.5); add('crystal', 10, 60, 1, 0.9);
}
sizeSnow();
addEventListener('resize', () => { if (snowing) sizeSnow(); });
function drawSnow(now) {
  if (!snowing) return;
  const dt = Math.min((now - snowLast) / 1000, 0.05); snowLast = now;
  wind = Math.sin(now * 0.00023) * 0.6 + Math.sin(now * 0.00061) * 0.3;
  const sky = sg.createLinearGradient(0, 0, 0, snowH);   // (a deep night sky, a faint cold glow low down)
  sky.addColorStop(0, '#020308'); sky.addColorStop(0.65, '#060a16'); sky.addColorStop(1, '#0d1526');
  sg.fillStyle = sky; sg.fillRect(0, 0, snowW, snowH);
  for (const f of flakes) {
    const depth = f.kind === 'far' ? 0.3 : f.kind === 'mid' ? 0.6 : 1;
    f.y += f.v * dt; f.ph += dt * f.sw; f.rot += f.spin * dt;
    f.x += (Math.sin(f.ph) * 14 + wind * 40) * depth * dt * (f.s);
    if (f.y > snowH + 30) { f.y = -30; f.x = Math.random() * snowW; }
    if (f.x > snowW + 30) f.x = -30; else if (f.x < -30) f.x = snowW + 30;
    const img = SPRITES[f.kind], w = img.width * f.s;
    sg.globalAlpha = f.a;
    if (f.kind === 'crystal') { sg.save(); sg.translate(f.x, f.y); sg.rotate(f.rot); sg.drawImage(img, -w / 2, -w / 2, w, w); sg.restore(); }
    else sg.drawImage(img, f.x - w / 2, f.y - w / 2, w, w);
  }
  sg.globalAlpha = 1;
  const vg = sg.createRadialGradient(snowW / 2, snowH / 2, snowH * 0.35, snowW / 2, snowH / 2, snowH * 0.95);   // (darker toward the edges)
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  sg.fillStyle = vg; sg.fillRect(0, 0, snowW, snowH);
  requestAnimationFrame(drawSnow);
}
requestAnimationFrame(drawSnow);

// ---------- Load the room behind the cover, then fade the cover away ----------
window.addEventListener('room-ready', () => {
  window.dispatchEvent(new Event('room-show'));
  loadFlake.classList.remove('on');
  cover.classList.add('gone');
  setTimeout(() => { cover.style.display = 'none'; snowing = false; }, 1400);   // (the snow stops once it's faded)
  nameBox.classList.add('show');
  if (!('ontouchstart' in window)) { nameInput.focus(); nameInput.select(); }   // (no pop-up keyboard on phones until they tap it)
}, { once: true });
import(ROOMS[room].file).catch(e => {
  console.warn('Room load', e);
  loadFlake.textContent = `${ROOMS[room].name} couldn't load · tap to try again`;
  loadFlake.classList.add('oops');
  loadFlake.addEventListener('click', () => location.reload());
});
