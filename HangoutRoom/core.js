// =====================================================================
// core.js — shared pieces every part of the Doodle Gallery uses
// =====================================================================
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ref, onValue } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { db, myId } from './world.js';

// ---------- Online connection (Firebase): set up in world.js, shared from here too ----------
export { db, myId };

// Things several files read and change
export const S = {
  myName: '',
  myHue: -1,          // my rainbow color, picked once when I enter
  presence: {},       // everyone in the room: id -> { name, c, x, z, b }
  atSketch: false,    // standing at the doodle board
  galleryOpen: false, // looking at a doodle in the gallery viewer
  timeOffset: 0       // how far my clock is from the database's clock
};
onValue(ref(db, '.info/serverTimeOffset'), s => { S.timeOffset = s.val() || 0; });
export function serverNow() { return Date.now() + S.timeOffset; }

// The room file fills these in so the board and gallery can ask it to refresh or post in chat
export const hooks = { refreshAll() {}, addSys() {} };

// ---------- Settings ----------
export const ROOM = 9;         // room width and depth (meters)
export const HEIGHT = 4;       // ceiling height
export const EYE = 1.55;       // how high your eyes are when standing

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
scene.background = new THREE.Color(0x0a0908);

export const BASE_FOV = 60;
export const camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.05, 100);
camera.rotation.order = 'YXZ';   // turn left and right first, then tilt up and down

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
// A soft reflection of a room, so polished and metal things (the marble floor, the gold) pick up a bit of shine
export const envMap = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(renderer), 0.04).texture;
export const goldMat = std(0xc9a227, 0.3, { metalness: 0.9, envMap, envMapIntensity: 0.8 });
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