// =====================================================================
// core.js — shared pieces every part of the Hangout Room uses
// =====================================================================
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getDatabase, ref, onValue } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';

// ---------- Online connection (Firebase) ----------
const firebaseConfig = {
  apiKey: "AIzaSyATJ802q3tyJ5XAzek9M_XoDTl24uHxyu4",
  authDomain: "hangout-room-872ee.firebaseapp.com",
  databaseURL: "https://hangout-room-872ee-default-rtdb.firebaseio.com",
  projectId: "hangout-room-872ee",
  storageBucket: "hangout-room-872ee.firebasestorage.app",
  messagingSenderId: "779393375939",
  appId: "1:779393375939:web:ec8f83ec990e0d7458cc76"
};
export const db = getDatabase(initializeApp(firebaseConfig));
export const myId = 'u' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);  // a new id for each tab

// Things several files read and change
export const S = {
  myName: '',
  myHue: -1,          // my rainbow color, picked once when I enter
  presence: {},       // everyone in the room: id -> { name, seat, c }
  seated: -1,         // which seat I'm in (-1 = standing)
  boardView: false,
  atSlot: -1,         // which slot machine I'm playing (-1 = none)
  activeGame: 'othello',
  timeOffset: 0       // how far my clock is from the database's clock
};
onValue(ref(db, '.info/serverTimeOffset'), s => { S.timeOffset = s.val() || 0; });
export function serverNow() { return Date.now() + S.timeOffset; }

// The room file fills these in so the games can ask it to refresh or post in chat
export const hooks = { refreshAll() {}, addSys() {} };

// ---------- Settings ----------
export const ROOM = 9;         // room width and depth (meters)
export const HEIGHT = 3.4;     // ceiling height
export const SEATS = 8;        // chairs around the table
export const CHAIR_R = 1.45;   // distance of chairs from the table center
export const TABLE_Y = 0.78;   // height of the table top surface
export function seatAngle(i) { return (i / SEATS) * Math.PI * 2; }

// Repeatable random numbers so the room looks the same every time
let seed = 7;
export function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }

// ---------- Renderer, scene, camera ----------
// Phones and tablets get a lighter version of the room so it runs smoothly
export const PHONE = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) || Math.min(window.innerWidth, window.innerHeight) < 600;
export const canvas = document.getElementById('c');
export const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, PHONE ? 1.25 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = PHONE ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
renderer.outputColorSpace = THREE.SRGBColorSpace;

export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1410);

export const BASE_FOV = 60;
export const camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.05, 100);
camera.position.set(2.6, 2.6, 2.6);

export const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.8, 0);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 2;
controls.maxDistance = 3.6;
controls.minPolarAngle = Math.PI * 0.33;
controls.maxPolarAngle = Math.PI * 0.48;
controls.update();

// ---------- Helpers ----------
export function paintTexture(w, h, draw, repeatX = 1, repeatY = 1) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 8;
  return t;
}
export function box(w, h, d, mat, x, y, z, parent) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  parent.add(m); return m;
}
export function std(color, roughness = 0.8, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, ...extra });
}
export function easeInOut(k) { return k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; }

// ---------- Rainbow colors and name tags ----------
// ROY G BIV: each person gets the first rainbow color nobody in the room is using
export const RAINBOW = [0xe53935, 0xfb8c00, 0xfdd835, 0x43a047, 0x1e88e5, 0x3949ab, 0x8e24aa];
export const RAINBOW_CSS = ['#e53935', '#fb8c00', '#fdd835', '#43a047', '#1e88e5', '#3949ab', '#8e24aa'];
export function colorIndex(p) { return p && Number.isInteger(p.c) && p.c >= 0 && p.c < 7 ? p.c : 0; }
export function makeLabel(text, color) {
  // Text in a color with a thin white outline, on a soft dark grey pill
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  let size = 34;
  g.font = `bold ${size}px Georgia`;
  while (g.measureText(text).width > 220 && size > 16) { size -= 2; g.font = `bold ${size}px Georgia`; }
  const bw = Math.min(252, g.measureText(text).width + 30);
  g.fillStyle = 'rgba(40,40,40,0.55)';
  g.beginPath();
  if (g.roundRect) g.roundRect((256 - bw) / 2, 8, bw, 48, 22); else g.rect((256 - bw) / 2, 8, bw, 48);
  g.fill();
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round'; g.lineWidth = 5;
  g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 6;
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.strokeText(text, 128, 32);
  g.shadowBlur = 0;
  g.fillStyle = color;
  g.fillText(text, 128, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true }));
  s.scale.set(0.6, 0.15, 1);
  return s;
}

// ---------- Red dot-matrix counters that rise out of the table ----------
export const FONT = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100']
};
const CNT_ROWS = 9, DOT = 16;
const CNT_SUNK = 0.014;   // how far below the surface it hides

// A small flat panel set into the tabletop. cols = how many dot columns wide.
export function makeCounter(cols, w, parent) {
  const cv = document.createElement('canvas');
  cv.width = cols * DOT; cv.height = CNT_ROWS * DOT;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const outer = new THREE.Group();
  const h = w * CNT_ROWS / cols;
  const housing = new THREE.Mesh(new THREE.BoxGeometry(w + 0.016, 0.01, h + 0.016), std(0x3a0e0a, 0.7));
  housing.position.y = -0.003;
  outer.add(housing);
  const faceMat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, color: 0x000000 });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), faceMat);
  face.rotation.x = -Math.PI / 2;      // lying flat, digits upright from the player's seat
  face.position.y = 0.0025;
  outer.add(face);
  outer.visible = false;
  parent.add(outer);
  return { outer, faceMat, ctx: cv.getContext('2d'), cv, tex, cols, shown: -1, anim: null, active: false, seat: -1 };
}
export function drawCounter(cnt, num) {
  if (num === cnt.shown) return;
  cnt.shown = num;
  const digits = String(num);
  const width = digits.length * 6 - 1;
  const start = Math.floor((cnt.cols - width) / 2);
  const lit = new Set();
  [...digits].forEach((ch, i) => {
    (FONT[ch] || FONT['0']).forEach((row, r) => [...row].forEach((bit, c) => {
      if (bit === '1') lit.add((r + 1) * cnt.cols + (start + i * 6 + c));
    }));
  });
  const g = cnt.ctx;
  g.fillStyle = '#0c0b0a'; g.fillRect(0, 0, cnt.cv.width, cnt.cv.height);
  for (let r = 0; r < CNT_ROWS; r++) for (let c = 0; c < cnt.cols; c++) {
    const on = lit.has(r * cnt.cols + c);
    g.fillStyle = on ? '#ff3b2f' : '#34332e';
    g.beginPath(); g.arc(c * DOT + DOT / 2, r * DOT + DOT / 2, DOT * 0.42, 0, Math.PI * 2); g.fill();
    if (on) { g.fillStyle = 'rgba(255,200,180,0.5)'; g.beginPath(); g.arc(c * DOT + DOT / 2 - 2, r * DOT + DOT / 2 - 2, DOT * 0.14, 0, Math.PI * 2); g.fill(); }
  }
  cnt.tex.needsUpdate = true;
}
// Rise a counter out of the table in front of a seat
export function placeCounter(cnt, seat, dist) {
  const a = seatAngle(seat);
  cnt.outer.position.set(Math.sin(a) * dist, TABLE_Y - CNT_SUNK, Math.cos(a) * dist);
  cnt.outer.rotation.y = a;            // top of the digits points toward the middle of the table
  cnt.faceMat.color.setHex(0x000000);
  cnt.outer.visible = true;
  cnt.anim = { type: 'up', t: 0 };
  cnt.active = true; cnt.seat = seat;
}
export function sinkCounter(cnt) {
  cnt.anim = { type: 'down', t: 0 };
  cnt.active = false; cnt.seat = -1;
}
export function animateCounter(cnt, dt) {
  const a = cnt.anim;
  if (!a) return;
  a.t += dt;
  const p = Math.min(a.t / 0.5, 1);
  const k = a.type === 'up' ? easeInOut(p) : 1 - easeInOut(p);
  cnt.outer.position.y = TABLE_Y - CNT_SUNK * (1 - k);   // rise up until flush with the table
  cnt.faceMat.color.setScalar(k);                       // light up as it rises
  if (a.type === 'down' && p >= 1) cnt.outer.visible = false;
  if (p >= 1) cnt.anim = null;
}