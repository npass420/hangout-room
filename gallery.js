// =====================================================================
// gallery.js — the Doodle Gallery on the left wall
// The newest six doodles from LittleSketch's doodle board hang in frames, each with a little name card.
// Click the wall to open the viewer: flip through every saved doodle, like it, download it as a picture,
// or take it down (only the people who drew it can). sketch.js saves the doodles and loads this file.
// =====================================================================
import * as THREE from 'three';
import { ref, get, set, remove, onValue } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { db, S, hooks, scene, camera, canvas, ROOM, std } from './core.js';

const DW = 1200, DH = 800;          // a doodle's full size
const SLOTS = 6;                    // frames on the wall
const keyOf = name => String(name || '?').replace(/[.#$\[\]\/]/g, '_').slice(0, 20) || '?';
let items = [];                     // every saved doodle, newest first: { id, t, s, a, by, at, likes }
const art = {};                     // id -> { s, l } (the doodle's lines), once loaded
const loading = {};                 // id -> the promise loading it
function namesOf(it) { return Object.values(it.a || {}).map(p => p && p.n).filter(Boolean); }
function likesOf(it) { return Object.keys(it.likes || {}).length; }
function iLike(it) { return !!(S.myName && it.likes && it.likes[keyOf(S.myName)]); }
function mine(it) { return !!(S.myName && it.a && it.a[keyOf(S.myName)]); }
function loadArt(id) {   // fetch a doodle's lines only when it's needed
  if (art[id]) return Promise.resolve(art[id]);
  if (!loading[id]) {
    loading[id] = get(ref(db, 'room/sketch/galleryArt/' + id)).then(s => {
      art[id] = s.val() || { s: 'white', l: [] };
      return art[id];
    }).catch(e => { console.warn('Gallery load', e); delete loading[id]; return null; });
  }
  return loading[id];
}
function paint(g, w, h, a) {   // draw a doodle (sketch.js knows how to draw the lines)
  if (a && hooks.renderDoodle) { hooks.renderDoodle(g, w, h, a.s, Array.isArray(a.l) ? a.l : Object.values(a.l || {})); return true; }
  return false;
}
function paper(g, w, h, text) {   // an empty frame, or one still loading
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#efe9df'; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(60,40,20,0.35)';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `${Math.round(h * 0.16)}px Georgia`;
  g.fillText('🖍️', w / 2, h * 0.4);
  g.font = `italic ${Math.round(h * 0.09)}px Georgia`;
  g.fillText(text, w / 2, h * 0.64);
}

// ---------- The wall: two rows of three frames, between the window and the corner by the door ----------
const wall = new THREE.Group();
wall.position.set(-ROOM / 2 + 0.02, 0, 2.7);
wall.rotation.y = Math.PI / 2;   // facing into the room
scene.add(wall);
const COLS_X = [-0.95, 0, 0.95], ROWS_Y = [2.25, 1.5];
const PW = 0.72, PH = 0.48;      // picture size in meters (3 wide by 2 tall, like the board)
const wood = std(0x3b2414, 0.55);
const frames = [];
for (let j = 0; j < SLOTS; j++) {
  const x = COLS_X[j % 3], y = ROWS_Y[Math.floor(j / 3)];
  const add = (geo, mat, px, py, pz) => { const m = new THREE.Mesh(geo, mat); m.position.set(px, py, pz); m.userData.gallery = true; m.userData.slot = j; wall.add(m); return m; };
  const cv = document.createElement('canvas'); cv.width = 600; cv.height = 400;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  add(new THREE.PlaneGeometry(PW, PH), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, color: 0xe0e0e0 }), x, y, 0.025);
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(PW + 0.08, 0.04, 0.04), wood, x, y + s * (PH / 2 + 0.02), 0.02).castShadow = true;
    add(new THREE.BoxGeometry(0.04, PH + 0.08, 0.04), wood, x + s * (PW / 2 + 0.02), y, 0.02).castShadow = true;
  }
  const ccv = document.createElement('canvas'); ccv.width = 512; ccv.height = 64;
  const ctex = new THREE.CanvasTexture(ccv); ctex.colorSpace = THREE.SRGBColorSpace;
  add(new THREE.PlaneGeometry(0.62, 0.0775), new THREE.MeshBasicMaterial({ map: ctex, toneMapped: false, color: 0xdddddd }), x, y - PH / 2 - 0.085, 0.01);
  frames.push({ g: cv.getContext('2d'), tex, cg: ccv.getContext('2d'), ctex, sig: '' });
}
(function sign() {   // "Doodle Gallery" above the frames
  const c = document.createElement('canvas'); c.width = 1024; c.height = 160;
  const g = c.getContext('2d');
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 84px Georgia';
  g.shadowColor = 'rgba(0,0,0,0.5)'; g.shadowBlur = 8;
  g.fillStyle = '#3b2414'; g.fillText('🖼️ Doodle Gallery', 512, 64);
  g.shadowBlur = 0;
  g.font = 'italic 34px Georgia'; g.fillStyle = 'rgba(59,36,20,0.75)';
  g.fillText('click to look closer', 512, 132);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.234), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
  m.position.set(0, 2.82, 0.01);
  m.userData.gallery = true; m.userData.slot = 0;
  wall.add(m);
})();
function paintCard(f, it) {   // the little name card under a frame
  const g = f.cg, W = 512, H = 64;
  g.fillStyle = '#f4ecd8'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#3b2414'; g.lineWidth = 3; g.strokeRect(2, 2, W - 4, H - 4);
  if (it) {
    const likes = likesOf(it), right = likes ? `❤️ ${likes}` : '';
    g.textBaseline = 'middle';
    g.font = '26px Georgia';
    const rw = right ? g.measureText(right).width + 16 : 0;
    g.textAlign = 'right'; g.fillStyle = '#b0304a'; if (right) g.fillText(right, W - 12, H / 2 + 1);
    let text = `${it.t || 'Untitled'} · ${namesOf(it).join(', ') || it.by || ''}`;
    g.font = 'italic 26px Georgia';
    while (g.measureText(text).width > W - 28 - rw && text.length > 4) text = text.slice(0, -2) + '…';
    g.textAlign = 'left'; g.fillStyle = '#2a1c10'; g.fillText(text, 14, H / 2 + 1);
  }
  f.ctex.needsUpdate = true;
}
function paintFrame(j) {
  const f = frames[j], it = items[j];
  const sig = it ? `${it.id}|${it.t}|${likesOf(it)}|${art[it.id] ? 1 : 0}` : 'empty';
  if (sig === f.sig) return;
  f.sig = sig;
  if (!it) paper(f.g, 600, 400, 'Your doodle here');
  else if (!paint(f.g, 600, 400, art[it.id])) {
    paper(f.g, 600, 400, 'Loading…');
    loadArt(it.id).then(a => { if (a) paintFrame(j); });
  }
  f.tex.needsUpdate = true;
  paintCard(f, it);
}
function paintWall() { for (let j = 0; j < SLOTS; j++) paintFrame(j); }
paintWall();

// ---------- The viewer ----------
const css = document.createElement('style');
css.textContent = `
  #glView { display: none; position: fixed; inset: 0; z-index: 50; background: rgba(12,9,6,0.93); color: #f3e6cf; font-family: Georgia, serif;
            flex-direction: column; align-items: center; justify-content: center; padding: 12px; box-sizing: border-box; }
  #glView.on { display: flex; }
  #glCanvas { width: min(92vw, calc((100vh - 190px) * 1.5)); height: auto; aspect-ratio: 3 / 2; border-radius: 8px;
              box-shadow: 0 8px 30px rgba(0,0,0,0.7); background: #222; touch-action: pan-y; }
  #glTitle { font-size: 24px; color: #ffe9a0; margin: 10px 0 2px; text-align: center; }
  #glInfo { font-size: 14px; opacity: 0.85; text-align: center; }
  #glBtns { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
  #glBtns button { font-family: inherit; font-size: 16px; padding: 8px 16px; border: none; border-radius: 18px; background: #e9c98f; color: #2a1c10; cursor: pointer; box-shadow: 0 3px 10px rgba(0,0,0,0.5); }
  #glBtns button:disabled { opacity: 0.4; cursor: default; }
  #glBtns button.liked { background: #ff9db2; }
  @media (max-width: 700px) { #glCanvas { width: 96vw; } #glTitle { font-size: 19px; } #glBtns button { font-size: 14px; padding: 7px 12px; } }`;
document.head.appendChild(css);
function el(tag, id, text) { const e = document.createElement(tag); if (id) e.id = id; if (text != null) e.textContent = text; return e; }
const view = el('div', 'glView');
const vcv = el('canvas', 'glCanvas'); vcv.width = DW; vcv.height = DH;
const vg = vcv.getContext('2d');
const vTitle = el('div', 'glTitle'), vInfo = el('div', 'glInfo'), vBtns = el('div', 'glBtns');
function vbtn(text, fn) { const b = el('button', '', text); b.addEventListener('click', e => { e.stopPropagation(); fn(); b.blur(); }); vBtns.appendChild(b); return b; }
const prevBtn = vbtn('◀ Newer', () => step(-1));
const likeBtn = vbtn('❤️', toggleLike);
const dlBtn = vbtn('⬇ Download', download);
const delBtn = vbtn('🗑 Take down', takeDown);
const nextBtn = vbtn('Older ▶', () => step(1));
vbtn('✕ Close', closeViewer);
view.append(vcv, vTitle, vInfo, vBtns);
document.body.appendChild(view);
view.addEventListener('click', e => { if (e.target === view) closeViewer(); });   // click the dark area to close

let isOpen = false, idx = 0, shownId = '';
function current() { return items[idx] || null; }
function showItem() {
  if (!isOpen) return;
  if (!items.length) {
    idx = 0; shownId = '';
    paper(vg, DW, DH, 'No doodles yet');
    vTitle.textContent = 'No doodles yet';
    vInfo.textContent = 'Make one on the board by the door: click the board, then 🖍️ Doodle.';
    prevBtn.disabled = nextBtn.disabled = likeBtn.disabled = dlBtn.disabled = true;
    delBtn.style.display = 'none';
    likeBtn.textContent = '❤️';
    return;
  }
  idx = Math.max(0, Math.min(items.length - 1, idx));
  const it = items[idx];
  vTitle.textContent = it.t || 'Untitled';
  const when = it.at ? new Date(it.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  vInfo.textContent = `by ${namesOf(it).join(', ') || it.by || 'someone'}${when ? ' · ' + when : ''} · ${idx + 1} of ${items.length}`;
  prevBtn.disabled = idx === 0;
  nextBtn.disabled = idx === items.length - 1;
  likeBtn.disabled = !S.myName;
  likeBtn.textContent = `❤️ ${likesOf(it)}`;
  likeBtn.classList.toggle('liked', iLike(it));
  delBtn.style.display = mine(it) ? '' : 'none';
  if (shownId === it.id) return;   // already showing this one
  if (paint(vg, DW, DH, art[it.id])) { shownId = it.id; dlBtn.disabled = false; return; }
  shownId = '';
  dlBtn.disabled = true;
  paper(vg, DW, DH, 'Loading…');
  const id = it.id;
  loadArt(id).then(a => { if (a && isOpen && current() && current().id === id) showItem(); });
}
function step(d) { if (!items.length) return; idx = Math.max(0, Math.min(items.length - 1, idx + d)); showItem(); }
function toggleLike() {
  const it = current();
  if (!it || !S.myName) return;
  set(ref(db, `room/sketch/gallery/${it.id}/likes/${keyOf(S.myName)}`), iLike(it) ? null : true).catch(e => console.warn('Gallery like', e));
}
function download() {   // save the doodle as a picture
  const it = current();
  if (!it || shownId !== it.id) return;
  const name = (it.t || 'doodle').replace(/[^a-z0-9 _-]/gi, '').trim() || 'doodle';
  vcv.toBlob(b => {
    if (!b) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = name + '.png';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }, 'image/png');
}
function takeDown() {   // only the people who drew it
  const it = current();
  if (!it || !mine(it)) return;
  if (!confirm(`Take "${it.t || 'Untitled'}" down from the gallery? It can't be brought back.`)) return;
  remove(ref(db, 'room/sketch/gallery/' + it.id))
    .then(() => remove(ref(db, 'room/sketch/galleryArt/' + it.id)))
    .then(() => { if (hooks.banner) hooks.banner('🗑 Taken down', 2); })
    .catch(e => console.warn('Gallery remove', e));
}
export function openViewer(slot = 0) {
  if (isOpen) return;
  isOpen = true; S.galleryOpen = true;
  idx = slot < items.length ? slot : 0; shownId = '';
  view.classList.add('on');
  showItem();
}
function closeViewer() {
  if (!isOpen) return;
  isOpen = false; S.galleryOpen = false;
  view.classList.remove('on');
}
// While the viewer is open it gets the keys (so Esc closes it instead of making you stand up)
window.addEventListener('keydown', e => {
  if (!isOpen) return;
  if (e.key === 'Escape') closeViewer();
  else if (e.key === 'ArrowLeft') step(-1);
  else if (e.key === 'ArrowRight') step(1);
  e.stopImmediatePropagation();
  e.preventDefault();
}, true);
// Swipe left or right on the picture to flip through
let swipeX = null;
vcv.addEventListener('pointerdown', e => { swipeX = e.clientX; });
vcv.addEventListener('pointerup', e => { if (swipeX !== null && Math.abs(e.clientX - swipeX) > 50) step(e.clientX < swipeX ? 1 : -1); swipeX = null; });

// ---------- Clicking the wall in the room ----------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let downAt = null;
function shown(o) { for (; o; o = o.parent) if (!o.visible) return false; return true; }
function canOpen() {
  return !!S.myName && !isOpen && !S.inPool && !(S.atSlot >= 0) && !S.atArcade && !S.atSketch && !S.trailFull && !S.boardView;
}
canvas.addEventListener('pointerdown', e => { downAt = { x: e.clientX, y: e.clientY, id: e.pointerId }; });
window.addEventListener('pointerup', e => {
  const d = downAt;
  downAt = null;
  if (!d || d.id !== e.pointerId || e.target !== canvas || Math.hypot(e.clientX - d.x, e.clientY - d.y) >= 6 || !canOpen()) return;
  ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObjects(scene.children, true).find(h => shown(h.object) && !(h.object.material && h.object.material.blending === THREE.AdditiveBlending));
  if (hit && hit.object.userData.gallery) openViewer(hit.object.userData.slot || 0);   // only if nothing is in front of it
});

// ---------- Listening ----------
onValue(ref(db, 'room/sketch/gallery'), s => {
  const v = s.val() || {};
  items = Object.entries(v).filter(([, m]) => m && m.at).map(([id, m]) => ({ id, ...m })).sort((p, q) => q.at - p.at);
  for (const id of Object.keys(art)) if (!v[id]) { delete art[id]; delete loading[id]; }   // taken down
  paintWall();
  if (isOpen) {
    const at = shownId ? items.findIndex(it => it.id === shownId) : -1;
    if (at >= 0) idx = at;               // stay on the same doodle even if a new one was just added
    else shownId = '';                   // the one you were looking at was taken down
    showItem();
  }
});