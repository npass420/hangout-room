// =====================================================================
// clock.js — the dot-matrix wall clock every room uses. It always shows the day and the time (your own clock), the day on
// top and the time under it, like "FRI" over "4:15P". Each room picks its colors and the frame around it.
// =====================================================================
import * as THREE from 'three';

const FONT = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  'A': ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  'D': ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  'E': ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  'F': ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  'H': ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  'I': ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  'M': ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  'N': ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  'O': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  'P': ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  'R': ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  'S': ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  'T': ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  'U': ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  'W': ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000']
};
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const COLS = 37, ROWS = 19, DOT = 12;   // six characters wide; two lines (the day, then the time) with a gap between

// opts: { lit (the color of lit dots), dim (unlit dots), back (behind the dots), width (meters), frame (a material for the
//         frame, or nothing), frameDepth, glow (a soft glow around the frame, for neon rooms) }
export function makeClock(opts = {}) {
  const o = Object.assign({ lit: '#ff2a1f', dim: '#3a1613', back: '#0c0b0a', width: 1.0, frame: null, frameDepth: 0.05 }, opts);
  const c = document.createElement('canvas');
  c.width = COLS * DOT; c.height = ROWS * DOT;
  const ctx = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const w = o.width, h = w * ROWS / COLS;
  const group = new THREE.Group();
  if (o.frame) {
    const f = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, h + 0.06, o.frameDepth), o.frame);
    group.add(f);
  }
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  face.position.z = o.frameDepth / 2 + 0.002;
  group.add(face);
  if (o.glow) {   // a soft halo behind it
    const gc = document.createElement('canvas'); gc.width = gc.height = 128;
    const gg = gc.getContext('2d'), grd = gg.createRadialGradient(64, 64, 10, 64, 64, 64);
    grd.addColorStop(0, o.glow); grd.addColorStop(1, 'rgba(0,0,0,0)');
    gg.fillStyle = grd; gg.fillRect(0, 0, 128, 128);
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(w * 1.7, h * 1.9), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(gc),
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    halo.position.z = -o.frameDepth / 2 + 0.004;
    group.add(halo);
  }
  let shown = '';
  function line(text, row, lit) {   // one line of text, centered, starting at this row of dots
    const start = Math.floor((COLS - (text.length * 6 - 1)) / 2);
    [...text].forEach((ch, i) => {
      (FONT[ch] || FONT[' ']).forEach((bits, r) => [...bits].forEach((b, k) => { if (b === '1') lit.add((row + r) * COLS + start + i * 6 + k); }));
    });
  }
  function update() {
    const d = new Date(), h12 = d.getHours() % 12 || 12;
    const day = DAYS[d.getDay()], time = h12 + ':' + String(d.getMinutes()).padStart(2, '0') + (d.getHours() < 12 ? 'A' : 'P');
    if (day + time === shown) return;   // only redraw when the minute changes
    shown = day + time;
    const lit = new Set();
    line(day, 1, lit);
    line(time, 11, lit);
    ctx.fillStyle = o.back; ctx.fillRect(0, 0, c.width, c.height);
    for (let r = 0; r < ROWS; r++) for (let k = 0; k < COLS; k++) {
      if (r === 9) continue;   // the gap between the lines
      ctx.fillStyle = lit.has(r * COLS + k) ? o.lit : o.dim;
      ctx.beginPath(); ctx.arc(k * DOT + DOT / 2, r * DOT + DOT / 2, DOT * 0.42, 0, Math.PI * 2); ctx.fill();
    }
    tex.needsUpdate = true;
  }
  update();
  return { group, update, height: h };
}