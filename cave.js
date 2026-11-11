// =====================================================================
// cave.js — the Cave: the front door of the site. A night igloo drawn flat like a Flash cartoon, with the
// swirling orb in the middle (orb.png) and two frozen ancient doors on the sides. Pick your name, touch the orb,
// and a portal opens out of its white center into the Doodle Gallery. An open door (the Table Room) opens onto its room.
// Each room's code loads only when you pick it, and gets itself fully ready behind the Cave before the portal opens.
// More places later: give a door its file in PLACES below and it thaws open.
// =====================================================================
const PLACES = {
  orb:   { name: 'Doodle Gallery', file: './studio.js' },
  left:  { name: 'Table Room', file: './tables.js' },
  right: { name: 'Game Room', file: null }
};

const cv = document.getElementById('cave');
const g = cv.getContext('2d');
const nameBox = document.getElementById('nameBox');
const nameInput = document.getElementById('nameInput');
const nameTip = document.getElementById('nameTip');
const PHONE = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || Math.min(window.innerWidth, window.innerHeight) < 600;
const DEG = Math.PI / 180;
const M = 40;   // extra edge drawn around the layers, so they can drift with the mouse without showing a gap

function seeded(s) { return () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const lerp = (a, b, k) => a + (b - a) * k;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- The orb picture: cut the glass ball out of orb.png once, so the background never shows ----------
const OX = 0.502, OY = 0.49, OR = 0.39;   // where the ball sits in the picture (center and radius, as parts of its size)
const orbImg = new Image();
let orbCut = null;
orbImg.onload = () => {
  const S = PHONE ? 512 : 1024, c = document.createElement('canvas');
  c.width = c.height = S;
  const w = orbImg.width, h = orbImg.height;
  c.getContext('2d').drawImage(orbImg, (OX - OR) * w, (OY - OR) * h, OR * 2 * w, OR * 2 * h, 0, 0, S, S);
  orbCut = c;
};
orbImg.src = 'orb.png';

// ---------- Sizes and the look of the room, worked out again whenever the window changes size ----------
let W = 0, H = 0, DPR = 1, cx = 0, hy = 0, F = 0, e0 = 0;
let orb = { x: 0, y: 0, r: 0 };
let wallLayer = null, floorLayer = null, doors = {}, stars = [], sparkles = [], snow = [], haze = null;

// A point on the inside of the dome: across (az) and up (el), both angles, seen from the middle of the room
function P(az, el) { return [cx + F * Math.tan(az), hy - F * Math.tan(el) / Math.cos(az)]; }
function floorY(x) { const u = (x - cx) / F; return hy - F * Math.tan(e0) * Math.sqrt(1 + u * u); }   // where the wall meets the floor

function layer() {
  const c = document.createElement('canvas');
  c.width = Math.ceil((W + M * 2) * DPR); c.height = Math.ceil((H + M * 2) * DPR);
  const x = c.getContext('2d');
  x.setTransform(DPR, 0, 0, DPR, M * DPR, M * DPR);   // draw in screen spots; the extra edge is just more of the same
  return [c, x];
}

function build() {
  DPR = Math.min(window.devicePixelRatio || 1, PHONE ? 2 : 2);
  W = window.innerWidth; H = window.innerHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  cx = W / 2; hy = H * 0.5;
  F = Math.max(W * 0.55, H * 0.75);
  e0 = -Math.atan(H * 0.2 / F);
  orb = { x: cx, y: H * 0.47, r: Math.min(W * 0.2, H * 0.17) };
  const LW = Math.max(2, Math.min(W, H) / 320);   // outline thickness
  const rnd = seeded(7);

  // ---------- The dome: rows of chunky snow blocks ----------
  const [wc, w] = layer();
  wallLayer = wc;
  w.fillStyle = '#0e1430'; w.fillRect(-M, -M, W + M * 2, H + M * 2);
  w.lineJoin = 'round';
  const STEP = 4.6 * DEG;
  const rows = [];
  for (let el = e0 - STEP * 1.2; hy - F * Math.tan(el) > -M - H * 0.4 && el < 80 * DEG; el += STEP) rows.push(el);   // up until it's above the screen
  const azMax = Math.atan((W / 2 + M + 20) / F);
  stars = [];
  rows.forEach((lo, k) => {
    const hi = lo + STEP, mid = (lo + hi) / 2;
    const bw = Math.min(16 * DEG, 7.5 * DEG / Math.cos(mid));    // blocks stay about the same size as the dome narrows
    const shift = (k % 2 ? bw / 2 : 0) + (rnd() - 0.5) * bw * 0.3;   // every other row is staggered, like real bricks
    const up = clamp((mid - e0) / (70 * DEG), 0, 1);               // 0 at the floor, 1 near the top
    for (let a = -azMax - bw + shift; a < azMax + bw; a += bw) {
      const a0 = Math.max(-azMax, a + (rnd() - 0.5) * bw * 0.12), a1 = Math.min(azMax, a + bw + (rnd() - 0.5) * bw * 0.12);
      if (a1 <= a0) continue;
      const L = lerp(50, 22, up) + (rnd() - 0.5) * 6;             // lighter low down, darker up in the dome
      const shape = (b0, b1) => {                                   // one slice of a block, from height b0 to b1
        w.beginPath();
        for (let i = 0; i <= 6; i++) { const [x, y] = P(lerp(a0, a1, i / 6), b1); i ? w.lineTo(x, y) : w.moveTo(x, y); }
        for (let i = 6; i >= 0; i--) { const [x, y] = P(lerp(a0, a1, i / 6), b0); w.lineTo(x, y); }
        w.closePath();
      };
      const fill = (b0, b1, light) => { shape(b0, b1); w.fillStyle = `hsl(220, ${lerp(42, 50, up)}%, ${light}%)`; w.fill(); };
      fill(lo, hi, L);                                              // the block
      fill(hi - STEP * 0.22, hi, L + 9);                            // a lit top edge
      fill(lo, lo + STEP * 0.16, L - 9);                            // a shaded bottom edge
      shape(lo, hi);                                                // the groove around it
      w.strokeStyle = '#141a3a'; w.lineWidth = LW; w.stroke();
      // Stars glittering inside the snow (more of them higher up)
      if (rnd() < lerp(0.35, 0.95, up)) {
        const n = 1 + Math.floor(rnd() * (1 + up * 2));
        for (let s = 0; s < n; s++) {
          const [x, y] = P(lerp(a0, a1, 0.15 + rnd() * 0.7), lerp(lo, hi, 0.2 + rnd() * 0.6));
          const kind = rnd();
          stars.push({ x, y, r: (0.6 + rnd() * 1.4) * (PHONE ? 0.8 : 1), ph: rnd() * 7, sp: 0.6 + rnd() * 1.8,
            col: kind < 0.6 ? '255,255,255' : kind < 0.82 ? '127,243,255' : '255,214,107' });
        }
      }
    }
  });
  // The top of the dome fades into the night
  const top = w.createLinearGradient(0, -M, 0, hy);
  top.addColorStop(0, 'rgba(6,8,24,0.75)'); top.addColorStop(1, 'rgba(6,8,24,0)');
  w.fillStyle = top; w.fillRect(-M, -M, W + M * 2, hy + M);

  // ---------- The two frozen ancient doors ----------
  doors = {};
  const tall = H > W;   // phones held upright get wider doors, nearer the edges
  const doorW = tall ? W * 0.23 : Math.min(W * 0.17, H * 0.24), doorH = doorW * 2.1;   // the size on screen
  const az = Math.atan(W * (tall ? 0.34 : 0.32) / F), hw = doorW * Math.cos(az) ** 2 / (2 * F);
  const doorTop = Math.atan(Math.tan(e0) + doorH * Math.cos(az) / F);
  for (const [side, s] of [['left', -1], ['right', 1]]) {
    const d = { az: s * az, hw, top: doorTop };
    d.uv = (u, v) => P(d.az + u * d.hw, lerp(e0, d.top, v));
    d.open = !!PLACES[side].file;
    drawDoor(w, d, LW, rnd);
    doors[side] = d;
  }

  // ---------- The floor: smooth snow, drifts along the wall, a mound under the orb ----------
  const [fc, f] = layer();
  floorLayer = fc;
  f.lineJoin = 'round';
  const fg = f.createLinearGradient(0, hy, 0, H + M);
  fg.addColorStop(0, '#5d71a6'); fg.addColorStop(0.5, '#7e93c6'); fg.addColorStop(1, '#a3b7e2');
  const xs = []; for (let x = -M - 10; x <= W + M + 10; x += 8) xs.push(x);
  // The drifts: a bumpy snow line in front of the wall, with a pile at the foot of each door
  const pile = x => {
    let p = 0;
    for (const d of Object.values(doors)) { const [dx] = d.uv(0, 0), dw = Math.abs(d.uv(1, 0)[0] - dx) * 1.5; p += Math.max(0, 1 - ((x - dx) / dw) ** 2) * H * 0.045; }
    return p;
  };
  const driftTop = x => floorY(x) - H * 0.018 * (1.2 + 0.6 * Math.sin(x * 0.011 + 1) + 0.4 * Math.sin(x * 0.027 + 3)) - pile(x);
  f.beginPath();
  xs.forEach((x, i) => { const y = driftTop(x); i ? f.lineTo(x, y) : f.moveTo(x, y); });
  f.lineTo(W + M + 10, H + M); f.lineTo(-M - 10, H + M); f.closePath();
  f.fillStyle = fg; f.fill();
  // A lit edge and outline along the top of the drifts
  f.beginPath(); xs.forEach((x, i) => { const y = driftTop(x); i ? f.lineTo(x, y) : f.moveTo(x, y); });
  f.strokeStyle = '#141a3a'; f.lineWidth = LW; f.stroke();
  f.beginPath(); xs.forEach((x, i) => { const y = driftTop(x) + LW * 1.6; i ? f.lineTo(x, y) : f.moveTo(x, y); });
  f.strokeStyle = 'rgba(200,218,255,0.55)'; f.lineWidth = LW * 1.4; f.stroke();
  // Soft waves in the snow, flat lighter bands like a cartoon
  for (let i = 0; i < 4; i++) {
    const y = lerp(H * 0.78, H * 1.02, i / 3), amp = H * 0.012;
    f.beginPath();
    for (let x = -M; x <= W + M; x += 10) f.lineTo(x, y + Math.sin(x * 0.006 + i * 2) * amp);
    f.lineTo(W + M, y + H * 0.03); f.lineTo(-M, y + H * 0.03); f.closePath();
    f.fillStyle = 'rgba(190,210,250,0.10)'; f.fill();
  }
  // The mound under the orb
  const my = H * 0.745, mrx = orb.r * 1.55, mry = orb.r * 0.34;
  f.beginPath(); f.ellipse(orb.x, my, mrx, mry, 0, 0, Math.PI * 2);
  const mg = f.createLinearGradient(0, my - mry, 0, my + mry);
  mg.addColorStop(0, '#9fb3e3'); mg.addColorStop(1, '#7186bd');
  f.fillStyle = mg; f.fill();
  f.beginPath(); f.ellipse(orb.x, my, mrx, mry, 0, Math.PI, Math.PI * 2);
  f.strokeStyle = '#141a3a'; f.lineWidth = LW; f.stroke();
  f.beginPath(); f.ellipse(orb.x, my + LW * 1.5, mrx * 0.92, mry * 0.85, 0, Math.PI * 1.1, Math.PI * 1.9);
  f.strokeStyle = 'rgba(220,232,255,0.6)'; f.lineWidth = LW * 1.4; f.stroke();
  orb.floor = my - mry * 0.3;
  // Glints on the snow
  sparkles = [];
  const n = PHONE ? 50 : 110;
  for (let i = 0; i < n; i++) {
    const x = rnd() * W, y = lerp(floorY(x) + H * 0.03, H, Math.pow(rnd(), 0.8));
    sparkles.push({ x, y, r: 0.7 + rnd() * 1.6 * (y / H), ph: rnd() * 7, sp: 0.8 + rnd() * 2 });
  }

  // ---------- Falling snow, in three layers for depth ----------
  snow = [];
  const area = W * H / (1600 * 900);
  for (const [count, size, speed, depth] of [[90, 1.1, 18, 8], [55, 2.2, 34, 22], [16, 4.2, 62, 42]]) {
    for (let i = 0; i < Math.round(count * area * (PHONE ? 0.6 : 1)) + 4; i++) {
      snow.push({ x: rnd() * (W + 80) - 40, y: rnd() * (H + 40) - 20, r: size * (0.7 + rnd() * 0.6),
        v: speed * (0.75 + rnd() * 0.5), ph: rnd() * 7, sw: 6 + rnd() * 16, depth });
    }
  }

  // The cold blue haze toward the edges
  haze = g.createRadialGradient(cx, H * 0.55, Math.min(W, H) * 0.25, cx, H * 0.55, Math.hypot(W, H) * 0.62);
  haze.addColorStop(0, 'rgba(30,50,110,0)'); haze.addColorStop(1, 'rgba(14,24,62,0.62)');
}

// ---------- One ancient door, carved in stone, frozen over ----------
function drawDoor(w, d, LW, rnd) {
  const VS = 0.66;                                               // where the arch starts curving
  const inner = u => VS + (1 - VS) * Math.sqrt(Math.max(0, 1 - u * u));
  const OU = 1.3, outer = u => VS + (1.13 - VS) * Math.sqrt(Math.max(0, 1 - (u / OU) ** 2));
  const path = (pts) => { w.beginPath(); pts.forEach(([u, v], i) => { const [x, y] = d.uv(u, v); i ? w.lineTo(x, y) : w.moveTo(x, y); }); w.closePath(); };
  const archPts = (fn, U, n = 28) => { const p = [[-U, 0]]; for (let i = 0; i <= n; i++) { const u = -U + 2 * U * i / n; p.push([u, Math.min(1.2, fn(u))]); } p.push([U, 0]); return p; };
  d.shape = { archPts, inner, outer, OU };

  // The stone frame: jamb stones up the sides, wedge stones around the arch, a big keystone at the top
  const stone = (pts, L) => {
    path(pts); w.fillStyle = `hsl(225, 22%, ${L}%)`; w.fill();
    w.strokeStyle = '#121735'; w.lineWidth = LW; w.stroke();
  };
  for (const s of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const v0 = i * VS / 3, v1 = (i + 1) * VS / 3;
      stone([[s * 1, v0], [s * OU, v0], [s * OU, v1], [s * 1, v1]], 30 + rnd() * 6);
    }
  }
  const N = 9;
  for (let i = 0; i < N; i++) {
    const t0 = Math.PI - Math.PI * i / N, t1 = Math.PI - Math.PI * (i + 1) / N;
    const pts = [];
    const key = i === Math.floor(N / 2);
    for (let j = 0; j <= 4; j++) { const t = lerp(t0, t1, j / 4); pts.push([Math.cos(t), VS + (1 - VS) * Math.sin(t)]); }
    for (let j = 4; j >= 0; j--) { const t = lerp(t0, t1, j / 4); pts.push([OU * Math.cos(t), VS + (1.13 - VS + (key ? 0.05 : 0)) * Math.sin(t)]); }
    stone(pts, key ? 36 : 28 + rnd() * 7);
  }
  // Cracks and chips in the old stone
  w.strokeStyle = 'rgba(10,14,36,0.7)'; w.lineWidth = LW * 0.6;
  for (let i = 0; i < 5; i++) {
    const s = rnd() < 0.5 ? -1 : 1, v = rnd() * VS;
    let [x, y] = d.uv(s * (1.05 + rnd() * 0.2), v);
    w.beginPath(); w.moveTo(x, y);
    for (let j = 0; j < 3; j++) { x += (rnd() - 0.5) * LW * 6; y += LW * (2 + rnd() * 4); w.lineTo(x, y); }
    w.stroke();
  }

  if (d.open) { drawOpenDoor(w, d, LW, rnd, path, archPts, inner); return; }
  // The door itself: two great stone leaves with a carved ring of runes
  path(archPts(inner, 1));
  w.fillStyle = '#26304f'; w.fill();
  w.save(); w.clip();
  w.strokeStyle = '#141a3a'; w.lineWidth = LW * 1.3;
  w.beginPath(); { const [x0, y0] = d.uv(0, 0), [x1, y1] = d.uv(0, 1); w.moveTo(x0, y0); w.lineTo(x1, y1); } w.stroke();
  const ringV = 0.45, aspect = d.hw / (d.top - e0);
  for (const [rr, col, lw] of [[0.62, '#141a3a', LW * 1.6], [0.62, 'rgba(120,230,255,0.28)', LW * 0.7], [0.4, '#141a3a', LW]]) {
    w.beginPath();
    for (let i = 0; i <= 48; i++) { const t = i / 48 * Math.PI * 2; const [x, y] = d.uv(rr * Math.cos(t), ringV + rr * aspect * Math.sin(t)); i ? w.lineTo(x, y) : w.moveTo(x, y); }
    w.strokeStyle = col; w.lineWidth = lw; w.stroke();
  }
  // Runes around the ring: little carved marks, faintly glowing
  for (let i = 0; i < 12; i++) {
    const t = i / 12 * Math.PI * 2, r = 0.51;
    const [x, y] = d.uv(r * Math.cos(t), ringV + r * aspect * Math.sin(t));
    const sz = Math.abs(d.uv(1, 0)[0] - d.uv(0, 0)[0]) * 0.06;
    w.beginPath();
    const kind = i % 3;
    if (kind === 0) { w.moveTo(x, y - sz); w.lineTo(x, y + sz); w.moveTo(x - sz * 0.6, y - sz * 0.3); w.lineTo(x + sz * 0.6, y + sz * 0.3); }
    else if (kind === 1) { w.moveTo(x - sz * 0.6, y + sz); w.lineTo(x, y - sz); w.lineTo(x + sz * 0.6, y + sz); }
    else { w.arc(x, y, sz * 0.6, 0, Math.PI * 2); }
    w.strokeStyle = 'rgba(130,235,255,0.55)'; w.lineWidth = LW * 0.7; w.stroke();
  }
  // Frozen over: a sheet of ice with bright streaks and cracks
  w.fillStyle = 'rgba(160,215,255,0.32)'; w.fillRect(-M, -M, W + M * 2, H + M * 2);
  for (const [u0, wdt] of [[-0.9, 0.35], [-0.2, 0.18], [0.35, 0.12]]) {
    path([[u0, -0.1], [u0 + wdt, -0.1], [u0 + wdt + 0.9, 1.3], [u0 + 0.9, 1.3]]);
    w.fillStyle = 'rgba(235,250,255,0.18)'; w.fill();
  }
  w.strokeStyle = 'rgba(235,250,255,0.6)'; w.lineWidth = LW * 0.6;
  for (let i = 0; i < 4; i++) {
    let u = (rnd() - 0.5) * 1.4, v = 0.15 + rnd() * 0.7;
    w.beginPath(); { const [x, y] = d.uv(u, v); w.moveTo(x, y); }
    for (let j = 0; j < 4; j++) { u += (rnd() - 0.5) * 0.35; v += (rnd() - 0.5) * 0.18; const [x, y] = d.uv(u, v); w.lineTo(x, y); }
    w.stroke();
  }
  w.restore();
  path(archPts(inner, 1));
  w.strokeStyle = 'rgba(215,242,255,0.75)'; w.lineWidth = LW * 1.8; w.stroke();   // frost along the edge of the opening
  w.strokeStyle = '#121735'; w.lineWidth = LW; w.stroke();
  // Icicles hanging from the arch
  for (let i = 0; i < 11; i++) {
    const u = -0.85 + 1.7 * i / 10 + (rnd() - 0.5) * 0.08, v = inner(u) - 0.005;
    const len = 0.04 + rnd() * 0.1 * (1 - Math.abs(u) * 0.5), wd = 0.05 + rnd() * 0.03;
    path([[u - wd, v + 0.01], [u + wd, v + 0.01], [u, v - len]]);
    w.fillStyle = 'rgba(220,244,255,0.95)'; w.fill();
    w.strokeStyle = '#121735'; w.lineWidth = LW * 0.6; w.stroke();
  }
  doorOutline(d, archPts, inner, outer, OU);
}
// Remember the opening's outline, for clicks and the shimmer
function doorOutline(d, archPts, inner, outer, OU) {
  d.path = new window.Path2D();
  archPts(inner, 1).forEach(([u, v], i) => { const [x, y] = d.uv(u, v); i ? d.path.lineTo(x, y) : d.path.moveTo(x, y); });
  d.path.closePath();
  d.hit = new window.Path2D();
  archPts(outer, OU).forEach(([u, v], i) => { const [x, y] = d.uv(u, v); i ? d.hit.lineTo(x, y) : d.hit.moveTo(x, y); });
  d.hit.closePath();
  [d.labelX, d.labelY] = d.uv(0, 1.22);
  d.size = Math.abs(d.uv(1, 0.5)[0] - d.uv(-1, 0.5)[0]);
}

// ---------- A door that's open: the ice is gone, the stone leaves stand open, and warm light comes through ----------
function drawOpenDoor(w, d, LW, rnd, path, archPts, inner) {
  path(archPts(inner, 1));
  const [bx, by] = d.uv(0, 0), [, ty] = d.uv(0, 1);
  const warm = w.createRadialGradient(bx, by, 0, bx, by, (by - ty) * 1.1);
  warm.addColorStop(0, '#ffd89a'); warm.addColorStop(0.45, '#d48a3e'); warm.addColorStop(1, '#4a2410');
  w.fillStyle = warm; w.fill();
  w.save(); w.clip();
  // The two stone leaves, swung open against the sides of the arch
  for (const s of [-1, 1]) {
    path([[s * 1, 0], [s * 0.72, 0.06], [s * 0.72, 0.9], [s * 1, 1.05]]);
    w.fillStyle = '#2a3352'; w.fill();
    w.strokeStyle = '#141a3a'; w.lineWidth = LW; w.stroke();
    path([[s * 0.86, 0.3], [s * 0.78, 0.32], [s * 0.78, 0.6], [s * 0.86, 0.6]]);
    w.strokeStyle = 'rgba(130,235,255,0.35)'; w.lineWidth = LW * 0.7; w.stroke();
  }
  w.restore();
  path(archPts(inner, 1));
  w.strokeStyle = '#121735'; w.lineWidth = LW; w.stroke();
  // A few drips left from the melted ice
  for (let i = 0; i < 6; i++) {
    const u = -0.8 + 1.6 * rnd(), v = inner(u) - 0.01, [x, y] = d.uv(u, v);
    w.beginPath(); w.ellipse(x, y + LW * 2, LW * 0.9, LW * 1.6, 0, 0, Math.PI * 2);
    w.fillStyle = 'rgba(220,244,255,0.85)'; w.fill();
  }
  const { outer, OU } = d.shape;
  doorOutline(d, archPts, inner, outer, OU);
}

// ---------- Looking around a little: the layers drift with the mouse (or tilting a phone) ----------
let look = { x: 0, y: 0 }, lookTo = { x: 0, y: 0 };
let mouse = { x: -1, y: -1 }, hover = null;
const DEPTH = { wall: 10, floor: 16, orb: 22 };
function offset(depth) { return [-look.x * depth, -look.y * depth * 0.6]; }
window.addEventListener('pointermove', e => {
  if (e.pointerType === 'mouse') lookTo = { x: (e.clientX / W) * 2 - 1, y: (e.clientY / H) * 2 - 1 };
  mouse = { x: e.clientX, y: e.clientY };
});
window.addEventListener('deviceorientation', e => {
  if (e.gamma == null) return;
  lookTo = { x: clamp(e.gamma / 25, -1, 1), y: clamp((e.beta - 45) / 25, -1, 1) };
});

function whatIsAt(x, y) {
  const [ox, oy] = offset(DEPTH.orb);
  if (Math.hypot(x - (orb.x + ox), y - (orb.y + oy + bob)) < orb.r * 1.1) return 'orb';
  const [wx, wy] = offset(DEPTH.wall);
  g.setTransform(1, 0, 0, 1, 0, 0);
  for (const side of ['left', 'right']) if (doors[side] && g.isPointInPath(doors[side].hit, x - wx, y - wy)) return side;
  return null;
}

// ---------- Touching things ----------
let note = null;          // a little message near something you touched: { text, x, y, t }
let shake = { side: null, t: 0 };
let wantIn = null, waitFrom = 0, roomIsReady = false, entering = 0, goingTo = 'orb';
window.addEventListener('room-ready', () => { roomIsReady = true; });   // the room has everything loaded and built
function tryEnter(place) {
  if (wantIn || entering) return;   // already on the way somewhere (only one room can load)
  const name = myName || nameInput.value.trim().slice(0, 20);
  if (!name) {
    nameBox.classList.remove('nudge'); void nameBox.offsetWidth; nameBox.classList.add('nudge');
    nameInput.focus();
    return;
  }
  setName(name);
  wantIn = place; waitFrom = performance.now();
  import(PLACES[place].file).catch(e => {   // load just that room's code
    console.warn('Room load', e);
    wantIn = null;
    note = { text: `${PLACES[place].name} couldn't load, try again in a moment`, side: place === 'orb' ? null : place, t: performance.now() };
  });
}
cv.addEventListener('click', e => {
  if (wantIn || entering) return;
  const what = whatIsAt(e.clientX, e.clientY);
  if (what && PLACES[what].file) tryEnter(what);
  else if (what) {
    shake = { side: what, t: performance.now() };
    note = { text: `${PLACES[what].name} is still frozen shut… coming soon`, side: what, t: performance.now() };
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
}
function pickName() {
  const name = nameInput.value.trim().slice(0, 20);
  if (!name) { nameBox.classList.remove('nudge'); void nameBox.offsetWidth; nameBox.classList.add('nudge'); nameInput.focus(); return; }
  setName(name);
}
nameInput.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  pickName();
});
document.getElementById('nameOk').addEventListener('click', pickName);
document.getElementById('nameChange').addEventListener('click', () => {
  if (wantIn || entering) return;
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
let bob = 0, raf = 0, spin = 0, lastNow = 0;
const t0 = performance.now();
const PORTAL = 1600;   // how long the portal takes to open all the way (ms)
function frame(now) {
  raf = window.requestAnimationFrame(frame);
  const t = (now - t0) / 1000, dt = Math.min(0.05, lastNow ? (now - lastNow) / 1000 : 0);
  lastNow = now;
  look.x = lerp(look.x, lookTo.x, 0.05); look.y = lerp(look.y, lookTo.y, 0.05);
  bob = Math.sin(t * 1.1) * H * 0.006;
  if (!entering && mouse.x >= 0 && !PHONE) {
    hover = whatIsAt(mouse.x, mouse.y);
    cv.style.cursor = hover ? 'pointer' : 'default';
  }
  // The room you picked has finished getting ready behind the Cave: go in, and open the portal onto it
  if (wantIn && !entering && roomIsReady) {
    entering = now; goingTo = wantIn; wantIn = null; hover = null;
    nameBox.classList.add('leaving');
    document.getElementById('enter').click();          // the room says you're here
    window.dispatchEvent(new Event('room-show'));      // and starts drawing itself, under the Cave
  }
  // charge: 0 to 1 while the room gets ready (the orb or door winds up); k: 0 to 1 as the portal opens
  const charge = wantIn ? Math.min(1, (now - waitFrom) / 900) : entering ? 1 : 0;
  const k = entering ? Math.min(1, (now - entering) / PORTAL) : 0;
  const into = wantIn || (entering ? goingTo : null);
  spin += dt * (0.12 + (into === 'orb' ? charge * 0.9 + k * 3 : 0));   // the swirl speeds up as it winds up

  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
  // A gentle lean toward where you're going while the portal opens
  const [pcx, pcy] = portalCenter(into);
  if (entering) {
    const e = k * k * (3 - 2 * k), push = 1 + e * (goingTo === 'orb' ? 0.35 : 0.9);
    g.translate(pcx, pcy); g.scale(push, push); g.translate(-pcx, -pcy);
  }
  const pulse = 0.5 + 0.5 * Math.sin(t * 1.6);
  const glowUp = (hover === 'orb' || into === 'orb' ? 1.35 : 1) + (into === 'orb' ? charge * 0.5 : 0);

  // The wall and doors
  const [wx, wy] = offset(DEPTH.wall);
  g.drawImage(wallLayer, wx - M, wy - M, W + M * 2, H + M * 2);
  g.globalCompositeOperation = 'lighter';
  const wg = g.createRadialGradient(orb.x + wx, orb.y + wy, orb.r * 0.5, orb.x + wx, orb.y + wy, Math.max(W, H) * 0.6);
  wg.addColorStop(0, `rgba(150,100,255,${(0.16 + pulse * 0.06) * glowUp})`); wg.addColorStop(0.45, 'rgba(90,60,200,0.05)'); wg.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = wg; g.fillRect(-M, -M, W + M * 2, H + M * 2);
  for (const s of stars) {   // the stars in the snow twinkle
    const a = Math.max(0, Math.sin(t * s.sp + s.ph)) ** 3;
    if (a < 0.05) continue;
    g.fillStyle = `rgba(${s.col},${a})`;
    g.beginPath(); g.arc(s.x + wx, s.y + wy, s.r * (0.6 + a * 0.8), 0, Math.PI * 2); g.fill();
    if (a > 0.8 && s.r > 1.3) { g.fillRect(s.x + wx - s.r * 3, s.y + wy - 0.5, s.r * 6, 1); g.fillRect(s.x + wx - 0.5, s.y + wy - s.r * 3, 1, s.r * 6); }
  }
  for (const side of ['left', 'right']) {   // frost shimmer on a door you point at, and a shiver when touched
    const d = doors[side], sh = shake.side === side ? Math.max(0, 1 - (now - shake.t) / 500) : 0;
    const a = (hover === side ? 0.22 : 0.07) + 0.05 * Math.sin(t * 2 + (side === 'left' ? 0 : 2)) + sh * 0.3
      + (into === side ? charge * (0.3 + 0.12 * Math.sin(t * 7)) : 0);   // winding up: the doorway brightens and throbs
    g.save(); g.translate(wx + Math.sin(now * 0.08) * sh * 4, wy);
    g.fillStyle = d.open ? `rgba(255,190,110,${a * 1.3})` : `rgba(140,225,255,${a})`; g.fill(d.path);
    g.restore();
  }
  g.globalCompositeOperation = 'source-over';
  // Door names above the arches
  for (const side of ['left', 'right']) {
    const d = doors[side], fs = clamp(d.size * 0.15, 12, 30);
    g.font = `italic ${fs}px Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'bottom';
    g.shadowColor = d.open ? 'rgba(255,170,80,0.9)' : 'rgba(120,220,255,0.9)'; g.shadowBlur = 10;
    g.fillStyle = hover === side ? '#ffffff' : 'rgba(215,240,255,0.85)';
    g.fillText(PLACES[side].name, d.labelX + wx, d.labelY + wy);
    g.shadowBlur = 0;
  }

  // The floor
  const [fx, fy] = offset(DEPTH.floor);
  g.drawImage(floorLayer, fx - M, fy - M, W + M * 2, H + M * 2);
  g.globalCompositeOperation = 'lighter';
  const pool = g.createRadialGradient(orb.x + fx, orb.floor + fy, 0, orb.x + fx, orb.floor + fy, orb.r * 2.6);
  pool.addColorStop(0, `rgba(255,200,150,${(0.32 + pulse * 0.1) * glowUp})`); pool.addColorStop(0.35, `rgba(160,100,255,${0.2 * glowUp})`); pool.addColorStop(1, 'rgba(0,0,0,0)');
  g.save(); g.translate(orb.x + fx, orb.floor + fy); g.scale(1, 0.32); g.translate(-(orb.x + fx), -(orb.floor + fy));
  g.fillStyle = pool; g.fillRect(orb.x + fx - orb.r * 3, orb.floor + fy - orb.r * 3, orb.r * 6, orb.r * 6);
  g.restore();
  for (const s of sparkles) {
    const a = Math.max(0, Math.sin(t * s.sp + s.ph)) ** 6;
    if (a < 0.05) continue;
    g.fillStyle = `rgba(230,245,255,${a})`;
    g.beginPath(); g.arc(s.x + fx, s.y + fy, s.r, 0, Math.PI * 2); g.fill();
  }

  // The orb
  const [ox, oy] = offset(DEPTH.orb);
  const X = orb.x + ox, Y = orb.y + oy + bob, R = orb.r * (hover === 'orb' ? 1.03 : 1);
  const halo = g.createRadialGradient(X, Y, R * 0.6, X, Y, R * 2.6);
  halo.addColorStop(0, `rgba(170,120,255,${(0.42 + pulse * 0.16) * glowUp})`); halo.addColorStop(0.4, 'rgba(110,70,230,0.14)'); halo.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = halo; g.fillRect(X - R * 3, Y - R * 3, R * 6, R * 6);
  g.globalCompositeOperation = 'source-over';
  g.save();
  g.beginPath(); g.arc(X, Y, R, 0, Math.PI * 2); g.clip();
  g.fillStyle = '#1a1850'; g.fill();
  if (orbCut) {
    const S = R * 2 * (OR / 0.375);   // the picture's ball is a touch bigger than the clip, so its edge stays hidden
    g.translate(X, Y);
    g.save(); g.rotate(spin); g.drawImage(orbCut, -S / 2, -S / 2, S, S); g.restore();
    g.globalCompositeOperation = 'screen'; g.globalAlpha = 0.28;   // a second, faster swirl turning the other way, for life in the middle
    g.save(); g.rotate(-t * 0.31 - spin * 1.5); g.scale(0.82, 0.82); g.drawImage(orbCut, -S / 2, -S / 2, S, S); g.restore();
    g.globalAlpha = 1; g.globalCompositeOperation = 'lighter';
    const hot = into === 'orb' ? charge : 0;            // the white center swells and burns brighter as it winds up
    const core = g.createRadialGradient(0, 0, 0, 0, 0, R * (0.45 + hot * 0.2));
    core.addColorStop(0, `rgba(255,${225 + hot * 30},${190 + hot * 65},${Math.min(1, 0.35 + pulse * 0.25 + hot * 0.45)})`);
    core.addColorStop(0.35, `rgba(255,235,220,${hot * 0.35})`); core.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = core; g.fillRect(-R, -R, R * 2, R * 2);
    g.translate(-X, -Y);
  }
  g.globalCompositeOperation = 'source-over';
  const edgeShade = g.createRadialGradient(X, Y, R * 0.62, X, Y, R);   // darker toward the edge, so it reads as a ball
  edgeShade.addColorStop(0, 'rgba(8,8,40,0)'); edgeShade.addColorStop(1, 'rgba(8,8,40,0.5)');
  g.fillStyle = edgeShade; g.fillRect(X - R, Y - R, R * 2, R * 2);
  g.globalCompositeOperation = 'screen';   // the glass shine stays still while the galaxy turns inside
  const shine = g.createRadialGradient(X - R * 0.38, Y - R * 0.45, 0, X - R * 0.38, Y - R * 0.45, R * 0.55);
  shine.addColorStop(0, 'rgba(255,255,255,0.55)'); shine.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = shine; g.fillRect(X - R, Y - R, R * 2, R * 2);
  g.restore();
  g.beginPath(); g.arc(X, Y, R, 0, Math.PI * 2);
  g.strokeStyle = 'rgba(205,230,255,0.55)'; g.lineWidth = Math.max(1.5, R * 0.018); g.stroke();
  g.beginPath(); g.arc(X, Y, R * 0.93, Math.PI * 1.08, Math.PI * 1.42);
  g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = Math.max(2, R * 0.03); g.lineCap = 'round'; g.stroke();
  g.beginPath(); g.arc(X + R * 0.42, Y + R * 0.52, R * 0.04, 0, Math.PI * 2); g.fillStyle = 'rgba(255,255,255,0.5)'; g.fill();
  // Its name, floating just above it
  const fs = clamp(R * 0.17, 14, 30);
  g.font = `italic ${fs}px Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'bottom';
  g.shadowColor = 'rgba(190,140,255,0.95)'; g.shadowBlur = 12;
  g.fillStyle = hover === 'orb' ? '#fff6dc' : 'rgba(255,240,210,0.9)';
  g.fillText(PLACES.orb.name, X, Y - R * 1.12);
  g.shadowBlur = 0;

  // Falling snow and the haze
  for (const s of snow) {
    s.y += s.v / 60; s.x += Math.sin(t * 0.7 + s.ph) * s.sw / 120;
    if (s.y > H + 20) { s.y = -20; s.x = Math.random() * (W + 80) - 40; }
    const [sx, sy] = offset(s.depth);
    g.fillStyle = s.depth > 30 ? 'rgba(240,248,255,0.85)' : s.depth > 15 ? 'rgba(230,240,255,0.7)' : 'rgba(210,225,255,0.5)';
    g.beginPath(); g.arc(s.x + sx, s.y + sy, s.r, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = haze; g.fillRect(-M, -M, W + M * 2, H + M * 2);

  // A note near a door you touched
  if (note) {
    const age = (now - note.t) / 1000;
    if (age > 2.6) note = null;
    else {
      const d = doors[note.side] || { size: 200, uv: () => [orb.x, 0], labelY: orb.y + orb.r * 1.3 }, a = Math.min(1, age * 4, (2.6 - age) * 2);
      g.globalAlpha = a; g.font = `${clamp(d.size * 0.1, 12, 18)}px Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'top';
      g.fillStyle = '#e6f7ff'; g.shadowColor = '#000'; g.shadowBlur = 6;
      const [nx] = d.uv(0, 0);
      g.fillText(note.text, clamp(nx + wx, 150, W - 150), d.labelY + wy + 8);
      g.shadowBlur = 0; g.globalAlpha = 1;
    }
  }

  // While the room gets ready: a quiet word under where you're going, if it takes more than a moment
  if (wantIn && now - waitFrom > 700) {
    const a = Math.min(1, (now - waitFrom - 700) / 400) * (0.75 + 0.25 * Math.sin(t * 4));
    const at = wantIn === 'orb' ? [orb.x, orb.y + orb.r * 1.25 + bob, 18] : [doors[wantIn].uv(0, 0)[0] + offset(DEPTH.wall)[0], doors[wantIn].uv(0, 0)[1] + 12, 16];
    g.globalAlpha = a; g.font = `italic ${at[2]}px Georgia, serif`; g.textAlign = 'center'; g.textBaseline = 'top';
    g.fillStyle = '#ffffff'; g.shadowColor = wantIn === 'orb' ? 'rgba(40,10,90,1)' : 'rgba(70,30,0,1)'; g.shadowBlur = 8;
    g.fillText(`Opening the ${PLACES[wantIn].name}…`, at[0], at[1]);
    g.shadowBlur = 0; g.globalAlpha = 1;
  }

  // The portal: a hole opens out of the white center (or the doorway) and grows until the room behind fills the screen
  if (entering) {
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawPortal(pcx, pcy, k, goingTo === 'orb', t);
    if (k >= 1) {   // all the way open: the Cave is gone
      window.cancelAnimationFrame(raf);
      cv.style.display = 'none';
      nameBox.style.display = 'none';
    }
  }
}

// Where the portal opens: the orb's white center, or the middle of the doorway (both as they sit on screen right now)
function portalCenter(place) {
  if (place === 'orb' || !place) { const [ox, oy] = offset(DEPTH.orb); return [orb.x + ox, orb.y + oy + bob]; }
  const [dx, dy] = doors[place].uv(0, 0.42), [wx, wy] = offset(DEPTH.wall);
  return [dx + wx, dy + wy];
}
function drawPortal(x, y, k, isOrb, t) {
  const far = Math.max(Math.hypot(x, y), Math.hypot(W - x, y), Math.hypot(x, H - y), Math.hypot(W - x, H - y));
  const start = isOrb ? 0.04 : 0.1;                       // a breath of white-hot light first, then it opens
  const o = Math.max(0, (k - start) / (1 - start));
  const r = (far * 1.25 + 40) * o * o * (0.35 + 0.65 * o); // slow at first, then rushing out past the edges
  const warm = !isOrb;
  // A flare at the center just as it starts, so the hole is born out of the light
  if (k < 0.35) {
    const a = Math.sin(Math.min(1, k / 0.35) * Math.PI);
    const fl = g.createRadialGradient(x, y, 0, x, y, orb.r * 0.9);
    fl.addColorStop(0, `rgba(255,${warm ? 236 : 248},${warm ? 200 : 255},${a})`); fl.addColorStop(1, 'rgba(255,255,255,0)');
    g.globalCompositeOperation = 'lighter'; g.fillStyle = fl; g.fillRect(x - orb.r, y - orb.r, orb.r * 2, orb.r * 2);
  }
  if (r < 1) { g.globalCompositeOperation = 'source-over'; return; }
  // Cut the hole: fully clear inside, with a soft edge
  g.globalCompositeOperation = 'destination-out';
  const hole = g.createRadialGradient(x, y, 0, x, y, r);
  hole.addColorStop(0, 'rgba(0,0,0,1)'); hole.addColorStop(0.8, 'rgba(0,0,0,1)'); hole.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = hole; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  // The rim: a glowing band, with streaks of light swirling around it
  g.globalCompositeOperation = 'lighter';
  const fade = 1 - Math.max(0, (k - 0.85) / 0.15);         // the rim fades as it leaves the screen
  const band = g.createRadialGradient(x, y, r * 0.7, x, y, r * 1.12);
  const c1 = warm ? '255,190,110' : '190,150,255', c2 = warm ? '255,236,200' : '235,225,255';
  band.addColorStop(0, `rgba(${c1},0)`); band.addColorStop(0.55, `rgba(${c2},${0.55 * fade})`); band.addColorStop(1, `rgba(${c1},0)`);
  g.fillStyle = band; g.beginPath(); g.arc(x, y, r * 1.12, 0, Math.PI * 2); g.fill();
  const lw = Math.max(2, r * 0.025);
  for (const [rr, dir, dash, alpha] of [[0.9, 1, 0.22, 0.9], [0.84, -1.4, 0.13, 0.6], [0.97, 0.7, 0.4, 0.45]]) {
    const len = 2 * Math.PI * r * rr;
    g.setLineDash([len * dash * 0.6, len * dash * 0.4]); g.lineDashOffset = -dir * t * r * 1.6;
    g.beginPath(); g.arc(x, y, r * rr, 0, Math.PI * 2);
    g.strokeStyle = `rgba(${c2},${alpha * fade})`; g.lineWidth = lw * (rr > 0.95 ? 0.6 : 1); g.lineCap = 'round'; g.stroke();
  }
  g.setLineDash([]); g.lineDashOffset = 0;
  g.globalCompositeOperation = 'source-over';
}
build();
raf = window.requestAnimationFrame(frame);