// =====================================================================================================================
// >>>>> START OF FILE: HangoutRoom/maker/bench.js <<<<<
// The Maker's stands: six floating white discs in a ring round the middle of the room, each with a neon ring glowing
// under its rim (blue when it's free, the builder's own color when it's taken, their name under it). Click a free
// one and it's yours while you're in the room: you float (your snowman's gone till you land) and build on it, and
// everyone sees what you make as you make it. One stand each; click another free one and your work moves with you.
// When you leave the room your stand frees up, and your work's kept on this computer: it comes back the next time
// you take a stand.
// The tray along the bottom (it pops up while you build): the twelve shapes (click one: it appears in the middle of
// your stand, picked), the 16 colors and 5 finishes (click one: the picked part takes it, and so do new shapes),
// the four tools, and the actions. The keys are on the ⌨ card (top left), from help below.
//   makeBench({ scene, camera, canvas, HX, HZ, RH, noReflect, reflect, banner, addSys, onEdit, flyLimit })
//     .editing  .help  .onKey(e)  .click(hits)  .hover(hits)  .fly(dt, keys, yaw, pitch)  .update(dt, t)
//     .start()  (once you're in: listen for the stands and the saves; again after a reconnect, to hold your stand)
//     .leave()  (going out through the portal: give your stand back)
// In the database: maker/stands/<0..5>: { by, name, c, parts }   (parts: the recipe, see maker/shapes.js)
//                  maker/saveList/<id>: { name, by, t, n }   maker/saveData/<id>: the recipe
// =====================================================================================================================
import * as THREE from 'three';
import { ref, set, get, remove, update, onValue, onDisconnect, runTransaction } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { db, myId, S, makeLabel, RAINBOW, RAINBOW_CSS, colorIndex } from '../core.js';
import { sfx } from '../sounds.js';
import { SHAPES, leaves } from './shapes.js';
import { COLORS, FINISHES, meshOf, outlineOf, placeOn } from './parts.js';

const STANDS = 6;              // how many stands
const RING = 2.8;              // how far out from the middle they stand (m)
const DISC = 0.8;              // a stand's radius
const HOVER = 0.85;            // how high it floats (its middle)
const TOP = HOVER + 0.05;      // its top, where things stand
const MAX_PARTS = 80;          // how many parts one object can have
const SIZE = 0.4;              // a new shape's size (m)
const STEP = { move: 0.05, turn: Math.PI / 12, size: 0.1, stretch: 0.1 };   // one press (Shift: a fifth of it)
const TOOLS = [['move', 'Move', '1'], ['turn', 'Turn', '2'], ['size', 'Size', '3'], ['stretch', 'Stretch', '4']];
const FREE = new THREE.Color(0.3, 0.6, 1.0);
const r4 = v => Math.round(v * 10000) / 10000;

export function makeBench({ scene, camera, canvas, HX, HZ, RH, noReflect, reflect, banner, addSys, onEdit, flyLimit }) {
  // ---------- The stands ----------
  const white = new THREE.MeshPhysicalMaterial({ color: 0xeaedf2, roughness: 0.15, clearcoat: 0.8, clearcoatRoughness: 0.08 });
  const stands = [];
  for (let i = 0; i < STANDS; i++) {
    const a = i / STANDS * Math.PI * 2;   // (one each side of the room, two toward the back and two toward the front: a gap where you come in)
    const g = new THREE.Group();
    g.position.set(Math.cos(a) * RING, 0, Math.sin(a) * RING);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(DISC, DISC, 0.1, 72), white);
    disc.position.y = HOVER;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(DISC, 0.05, 14, 72), white);
    rim.rotation.x = Math.PI / 2; rim.position.y = HOVER;
    const glowMat = new THREE.MeshBasicMaterial({ color: FREE.clone().multiplyScalar(2.5), toneMapped: false });
    const ringGlow = new THREE.Mesh(new THREE.TorusGeometry(DISC - 0.1, 0.013, 8, 72), glowMat);
    ringGlow.rotation.x = Math.PI / 2; ringGlow.position.y = HOVER - 0.06;
    for (const m of [disc, rim]) m.userData.stand = i;
    const parts = new THREE.Group();
    parts.position.y = TOP;
    g.add(disc, rim, ringGlow, parts);
    scene.add(g);
    noReflect.add(parts);
    stands.push({ g, parts, glowMat, label: null, by: null, name: '', c: -1, partsStr: '', meshes: [] });
  }
  let mineAt = -1;               // (which stand is yours: -1 none)
  let parts = [];                // (your object: the list of parts, see maker/shapes.js)
  let picked = -1, pending = null, tool = 'move', color = 0, finish = 0;
  let editing = false, offline = false;   // (offline: the database wouldn't take your stand, so it's only on this computer)
  const undo = [], redo = [];
  let lastKey = '', lastKeyAt = 0;

  function showStand(i) {   // (a stand's ring, its name, and what's on it)
    const st = stands[i], c = st.by ? colorIndex({ c: st.c }) : -1;
    st.glowMat.color.copy(c >= 0 ? new THREE.Color(RAINBOW[c]) : FREE).multiplyScalar(2.5);
    if (st.label) { st.g.remove(st.label); st.label.material.map.dispose(); st.label = null; }
    if (st.by && st.name) { st.label = makeLabel(st.name, RAINBOW_CSS[Math.max(0, c)]); st.label.position.y = HOVER - 0.32; st.g.add(st.label); }
  }
  function drawParts(i, list) {
    const st = stands[i];
    st.parts.clear();
    st.meshes = [];
    list.forEach((node, k) => {
      let m;
      try { m = meshOf(node); } catch (e) { console.warn('Maker part', e); return; }
      placeOn(m, node.t);
      m.userData.part = k; m.userData.onStand = i;
      if (i === mineAt && k === picked && editing) {   // (the outline shows only while you're building)
        const o = outlineOf(node);
        o.material.color.copy(pending === 'cut' ? new THREE.Color(1.0, 0.45, 0.3) : pending === 'join' ? new THREE.Color(0.4, 1.0, 0.55) : new THREE.Color(0.35, 0.7, 1.0)).multiplyScalar(2.2);
        m.add(o);
      }
      st.parts.add(m);
      st.meshes.push(m);
    });
  }
  function valid(list) {   // (someone else's recipe, checked before it's built)
    if (!Array.isArray(list) || list.length > MAX_PARTS) return [];
    const ok = (n, depth) => n && typeof n === 'object' && depth < 14 && Array.isArray(n.t) && n.t.length === 10 && n.t.every(Number.isFinite)
      && (n.o ? (n.o === 'c' || n.o === 'j') && ok(n.a, depth + 1) && ok(n.b, depth + 1) : Number.isInteger(n.s) && n.s >= 0 && n.s < SHAPES.length);
    return list.filter(n => ok(n, 0));
  }

  // ---------- Your stand: taking it, keeping it, giving it back ----------
  const standRef = i => ref(db, 'maker/stands/' + i);
  let sendTimer = 0;
  function changed() {   // (after every change to your object: drawn, kept on this computer, sent to everyone)
    if (picked >= parts.length) picked = parts.length - 1;
    drawParts(mineAt, parts);
    refreshTray();
    try { localStorage.setItem('makerWork', JSON.stringify(parts)); } catch (e) {}
    clearTimeout(sendTimer);
    sendTimer = setTimeout(() => { if (mineAt >= 0 && !offline) update(standRef(mineAt), { parts: JSON.stringify(parts) }).catch(() => {}); }, 200);
  }
  function remember(what) {   // (a step to undo; holding a key down makes one step, not dozens)
    const now = performance.now();
    if (what && what === lastKey && now - lastKeyAt < 700) { lastKeyAt = now; return; }
    lastKey = what || ''; lastKeyAt = now;
    undo.push(JSON.stringify(parts));
    if (undo.length > 150) undo.shift();
    redo.length = 0;
  }
  async function claim(i) {
    if (i === mineAt) { if (!editing) toggle(); return; }
    const was = mineAt;
    let got = false;
    try {
      const r = await runTransaction(standRef(i), cur => {
        if (cur && cur.by && cur.by !== myId) return;   // (someone has it)
        return { by: myId, name: S.myName, c: S.myHue, parts: '[]' };
      });
      got = r.committed;
      if (!got) { banner('That stand\'s taken', 2); return; }
      offline = false;
    } catch (e) {   // (the database said no, or can't be reached: build anyway, just on this computer)
      console.warn('Taking a stand', e);
      offline = true;
      banner('Building on this computer only: the others can\'t see this stand right now', 4);
    }
    if (!offline) onDisconnect(standRef(i)).remove().catch(() => {});
    if (was >= 0) { onDisconnect(standRef(was)).cancel().catch(() => {}); remove(standRef(was)).catch(() => {}); stands[was].parts.clear(); }
    mineAt = i;
    if (offline) { const st = stands[i]; st.by = myId; st.name = S.myName; st.c = S.myHue; showStand(i); }
    if (!parts.length) { try { parts = valid(JSON.parse(localStorage.getItem('makerWork') || '[]')); } catch (e) { parts = []; } }
    picked = -1; pending = null;
    changed();
    sfx.ping();
    if (!editing) toggle();
  }
  function holdStand() {   // (after a reconnect: your stand is put back, as it was)
    if (mineAt < 0 || offline) return;
    set(standRef(mineAt), { by: myId, name: S.myName, c: S.myHue, parts: JSON.stringify(parts) }).catch(() => {});
    onDisconnect(standRef(mineAt)).remove().catch(() => {});
  }

  // ---------- Making changes ----------
  const P = () => parts[picked];
  const V3 = new THREE.Vector3(), Q = new THREE.Quaternion(), SC = new THREE.Vector3();
  function readT(t) { V3.set(t[0], t[1], t[2]); Q.set(t[3], t[4], t[5], t[6]); SC.set(t[7], t[8], t[9]); }
  function writeT(node) {
    const lim = 2.2;
    V3.x = Math.max(-lim, Math.min(lim, V3.x)); V3.z = Math.max(-lim, Math.min(lim, V3.z)); V3.y = Math.max(-TOP + 0.02, Math.min(3, V3.y));
    for (const k of ['x', 'y', 'z']) SC[k] = Math.sign(SC[k] || 1) * Math.max(0.01, Math.min(6, Math.abs(SC[k])));
    Q.normalize();
    node.t = [r4(V3.x), r4(V3.y), r4(V3.z), r4(Q.x), r4(Q.y), r4(Q.z), r4(Q.w), r4(SC.x), r4(SC.y), r4(SC.z)];
  }
  function ways() {   // (away from you, to your right, and up: the room's own directions nearest to the way you face)
    const f = new THREE.Vector3(); camera.getWorldDirection(f); f.y = 0;
    const away = Math.abs(f.x) > Math.abs(f.z) ? new THREE.Vector3(Math.sign(f.x), 0, 0) : new THREE.Vector3(0, 0, Math.sign(f.z) || -1);
    return { away, right: new THREE.Vector3(-away.z, 0, away.x), up: new THREE.Vector3(0, 1, 0) };
  }
  function nearestAxis(dir) {   // (which of the part's own three directions lies closest to dir)
    let best = 0, most = -1;
    ['x', 'y', 'z'].forEach((k, i) => {
      const a = new THREE.Vector3(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0).applyQuaternion(Q);
      const d = Math.abs(a.dot(dir));
      if (d > most) { most = d; best = i; }
    });
    return ['x', 'y', 'z'][best];
  }
  function nudge(code, fine) {   // (the arrows and Page Up / Down, with the tool you've got)
    const node = P(); if (!node) return;
    const k = fine ? 0.2 : 1, w = ways();
    const dir = { ArrowRight: [w.right, 1], ArrowLeft: [w.right, -1], ArrowUp: [w.away, 1], ArrowDown: [w.away, -1], PageUp: [w.up, 1], PageDown: [w.up, -1] }[code];
    if (!dir) return;
    remember(tool + code);
    readT(node.t);
    const [axis, sgn] = dir;
    if (tool === 'move') V3.addScaledVector(axis, sgn * STEP.move * k);
    else if (tool === 'turn') {
      const a = STEP.turn * k;
      const turn = code === 'ArrowLeft' || code === 'ArrowRight' ? new THREE.Quaternion().setFromAxisAngle(w.up, code === 'ArrowLeft' ? a : -a)   // (spin round)
        : code === 'ArrowUp' || code === 'ArrowDown' ? new THREE.Quaternion().setFromAxisAngle(w.right, code === 'ArrowUp' ? -a : a)         // (tip away or toward you)
        : new THREE.Quaternion().setFromAxisAngle(w.away, code === 'PageUp' ? -a : a);                                                      // (roll to the side)
      Q.premultiply(turn);
    } else if (tool === 'size') {
      const f = 1 + STEP.size * k, grow = code === 'ArrowUp' || code === 'PageUp' || code === 'ArrowRight';
      SC.multiplyScalar(grow ? f : 1 / f);
    } else {
      const ax = nearestAxis(axis), f = 1 + STEP.stretch * k;
      SC[ax] *= sgn > 0 ? f : 1 / f;
    }
    writeT(node);
    changed();
  }
  function addShape(s) {
    if (mineAt < 0) return;
    if (parts.length >= MAX_PARTS) { banner(`That's the most parts one object can have (${MAX_PARTS})`, 2.5); return; }
    remember();
    const h = s === 9 ? 0 : SIZE / 2;   // (the dome's base is its bottom: it sits right on the stand)
    parts.push({ s, c: color, f: finish, t: [0, s === 9 ? SIZE / 2 : h, 0, 0, 0, 0, 1, SIZE, SIZE, SIZE] });
    picked = parts.length - 1; pending = null;
    changed();
    sfx.ping();
  }
  function paint(c, f) {
    if (c != null) color = c;
    if (f != null) finish = f;
    const node = P();
    if (node) {
      remember('paint');
      for (const leaf of leaves(node)) { if (c != null) leaf.c = c; if (f != null) leaf.f = f; }
      changed();
    } else refreshTray();
  }
  function copyPicked() {
    const node = P(); if (!node || parts.length >= MAX_PARTS) return;
    remember();
    const twin = JSON.parse(JSON.stringify(node));
    readT(twin.t); V3.addScaledVector(ways().right, 0.15); writeT(twin);
    parts.push(twin); picked = parts.length - 1;
    changed();
  }
  function deletePicked() {
    if (!P()) return;
    remember();
    parts.splice(picked, 1); picked = -1; pending = null;
    changed();
  }
  function combine(op, target) {   // (the picked part cuts into, or joins onto, the one clicked)
    const tool2 = parts[picked], into = parts[target];
    if (!tool2 || !into || target === picked) return;
    remember();
    const at = [into.t[0], into.t[1], into.t[2]];   // (the new part sits where the clicked one was; its pieces keep their places inside it)
    const local = n => { const c = JSON.parse(JSON.stringify(n)); c.t[0] = r4(c.t[0] - at[0]); c.t[1] = r4(c.t[1] - at[1]); c.t[2] = r4(c.t[2] - at[2]); return c; };
    const made = { o: op === 'cut' ? 'c' : 'j', a: local(into), b: local(tool2), t: [at[0], at[1], at[2], 0, 0, 0, 1, 1, 1, 1] };
    const keep = parts.filter((_, k) => k !== picked && k !== target);
    keep.push(made);
    parts = keep; picked = parts.length - 1; pending = null;
    const t0 = performance.now();
    changed();
    if (performance.now() - t0 > 2000) banner('That one took a while: lots of curved cuts make an object heavy', 3);
    sfx.ping();
  }
  function pullApart() {   // (a joined or cut part back into its two pieces, each where it was)
    const node = P(); if (!node || !node.o) return;
    remember();
    const whole = new THREE.Matrix4().compose(new THREE.Vector3(node.t[0], node.t[1], node.t[2]), new THREE.Quaternion(node.t[3], node.t[4], node.t[5], node.t[6]), new THREE.Vector3(node.t[7], node.t[8], node.t[9]));
    const out = [node.a, node.b].map(n => {
      const c = JSON.parse(JSON.stringify(n));
      const m = new THREE.Matrix4().compose(new THREE.Vector3(c.t[0], c.t[1], c.t[2]), new THREE.Quaternion(c.t[3], c.t[4], c.t[5], c.t[6]), new THREE.Vector3(c.t[7], c.t[8], c.t[9]));
      m.premultiply(whole).decompose(V3, Q, SC);
      writeT(c);
      return c;
    });
    parts.splice(picked, 1, ...out);
    changed();
  }
  function dropPicked() {   // (down onto the stand, resting on its lowest point)
    const st = stands[mineAt], m = st && st.meshes[picked], node = P();
    if (!m || !node) return;
    remember();
    const box = new THREE.Box3().setFromObject(m, true);
    readT(node.t);
    V3.y -= box.min.y - st.parts.getWorldPosition(new THREE.Vector3()).y;
    writeT(node);
    changed();
  }
  function doUndo(back) {
    const from = back ? undo : redo, to = back ? redo : undo;
    if (!from.length) return;
    to.push(JSON.stringify(parts));
    parts = JSON.parse(from.pop());
    lastKey = ''; pending = null;
    if (picked >= parts.length) picked = -1;
    changed();
  }
  function newObject() {
    if (!parts.length) return;
    ask('Start a new object?<br>This one\'s kept as Unsaved (in 💾).', 'Start new', () => {
      keepUnsaved(); remember(); parts = []; picked = -1; pending = null; changed();
    });
  }
  function setPending(op) {
    if (!P()) { banner('Pick a part first (click it)', 2); return; }
    if (parts.length < 2) { banner('It needs another part to ' + op + (op === 'cut' ? ' into' : ' onto'), 2); return; }
    pending = pending === op ? null : op;
    drawParts(mineAt, parts); refreshTray();
  }

  // ---------- Saves (shared: anyone can load anyone's) ----------
  let saveList = {};
  function keepUnsaved() { if (parts.length) try { localStorage.setItem('makerUnsaved', JSON.stringify(parts)); } catch (e) {} }
  function doSave() {
    const name = saveName.value.trim();
    if (!name) { saveName.focus(); return; }
    if (!parts.length) { banner('Nothing to save yet', 2); return; }
    const id = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    Promise.all([
      set(ref(db, 'maker/saveData/' + id), JSON.stringify(parts)),
      set(ref(db, 'maker/saveList/' + id), { name: name.slice(0, 30), by: String(S.myName || 'Someone').slice(0, 20), t: Date.now(), n: parts.length })
    ]).then(() => { saveName.value = ''; banner('💾 Saved', 1.5); sfx.ping(); }).catch(() => banner('Couldn\'t save that', 2.5));
  }
  function loadParts(list) { keepUnsaved(); remember(); parts = valid(list); picked = -1; pending = null; changed(); }
  function loadSave(id) {
    if (mineAt < 0) { banner('Take a stand first', 2); return; }
    get(ref(db, 'maker/saveData/' + id)).then(s => { try { loadParts(JSON.parse(s.val() || '[]')); } catch (e) { banner('That save couldn\'t be read', 2.5); } }).catch(() => {});
  }

  // ---------- On screen: the build button, the tray, the saves, the question box ----------
  const css = document.createElement('style');
  css.textContent = `
    #buildBtn { left: 16px; bottom: 68px; font-size: 20px; }
    #buildBtn.on, #saveBtn.on { background: rgba(233,201,143,0.92); color: #2a1c10; }
    #makerTray { position: fixed; left: 50%; bottom: 14px; z-index: 12; transform: translate(-50%, 160%); transition: transform 0.35s cubic-bezier(.2,1.3,.4,1);
      display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 10px 14px; border-radius: 16px; max-width: calc(100vw - 130px);
      background: rgba(20,16,12,0.82); box-shadow: 0 4px 16px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(201,162,39,0.6); }
    #makerTray.up { transform: translate(-50%, 0); }
    #makerTray .row { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; justify-content: center; }
    #makerTray .shp { width: 34px; height: 34px; border-radius: 9px; border: none; cursor: pointer; font-size: 19px; line-height: 34px; padding: 0;
      color: #f3e6cf; background: rgba(255,255,255,0.08); box-shadow: inset 0 0 0 1px rgba(201,162,39,0.45); }
    #makerTray .shp:hover { background: rgba(233,201,143,0.25); }
    #makerTray .sw { width: 26px; height: 26px; border-radius: 7px; border: 2px solid rgba(0,0,0,0.35); cursor: pointer; padding: 0;
      box-shadow: inset 0 -5px 8px rgba(0,0,0,0.2), inset 0 4px 6px rgba(255,255,255,0.35); transition: transform 0.12s; }
    #makerTray .sw.on { transform: translateY(-3px) scale(1.12); outline: 3px solid #ffd36a; outline-offset: 2px; }
    #makerTray .h { min-width: 28px; height: 26px; border-radius: 8px; border: none; cursor: pointer; font: 600 13px inherit; padding: 0 8px;
      color: #f3e6cf; background: rgba(255,255,255,0.08); box-shadow: inset 0 0 0 1px rgba(201,162,39,0.45); }
    #makerTray .h.on { background: rgba(233,201,143,0.92); color: #2a1c10; }
    #makerTray .h:disabled { opacity: 0.35; cursor: default; }
    #makerTray .lbl { color: #f3e6cf; opacity: 0.7; font-size: 13px; margin: 0 2px 0 6px; }
    #makerTray .say { color: #ffe6a0; font-size: 13px; min-height: 17px; text-align: center; }
    #saveBtn { position: absolute; left: -14px; top: -14px; width: 38px; height: 38px; font-size: 17px; z-index: 1; }
    #makerSaves { position: fixed; left: 50%; bottom: 230px; z-index: 16; transform: translateX(-50%); display: none; width: min(420px, calc(100vw - 32px));
      max-height: calc(100vh - 310px); flex-direction: column; gap: 10px; padding: 14px 16px; border-radius: 16px; color: #f3e6cf;
      background: rgba(20,16,12,0.92); box-shadow: 0 6px 24px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(201,162,39,0.7); }
    #makerSaves.up { display: flex; }
    #makerSaves .top { display: flex; justify-content: space-between; align-items: center; color: #ffd36a; }
    #makerSaves .row { display: flex; gap: 8px; }
    #makerSaves input { flex: 1; min-width: 0; height: 34px; border-radius: 9px; border: none; padding: 0 10px; font: 15px inherit;
      background: rgba(255,255,255,0.1); color: #f3e6cf; box-shadow: inset 0 0 0 1px rgba(201,162,39,0.45); }
    #makerSaves .h, #makerAsk .h { height: 34px; min-width: 34px; border-radius: 9px; border: none; cursor: pointer; font: 600 14px inherit; padding: 0 12px;
      color: #f3e6cf; background: rgba(255,255,255,0.08); box-shadow: inset 0 0 0 1px rgba(201,162,39,0.45); }
    #makerSaves .yes, #makerAsk .yes { background: rgba(233,201,143,0.92); color: #2a1c10; }
    #makerSaves .list { overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
    #makerSaves .item { display: flex; gap: 8px; align-items: center; padding: 6px 8px; border-radius: 10px; background: rgba(255,255,255,0.05); }
    #makerSaves .words { flex: 1; min-width: 0; }
    #makerSaves .nm { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 600; }
    #makerSaves .sub, #makerSaves .none { font-size: 12px; opacity: 0.65; }
    #makerAsk { position: fixed; left: 50%; top: 50%; z-index: 20; transform: translate(-50%, -50%) scale(0.9); opacity: 0; pointer-events: none;
      transition: opacity 0.2s, transform 0.2s; display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 18px 22px;
      border-radius: 16px; background: rgba(20,16,12,0.92); box-shadow: 0 6px 24px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(201,162,39,0.7); }
    #makerAsk.up { opacity: 1; pointer-events: auto; transform: translate(-50%, -50%) scale(1); }
    #makerAsk .q { color: #f3e6cf; font-size: 17px; text-align: center; line-height: 1.4; }
    #makerAsk .row { display: flex; gap: 10px; }`;
  document.head.appendChild(css);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const buildBtn = el('button', 'corner', '🛠'); buildBtn.id = 'buildBtn'; buildBtn.title = 'Build (B)';
  const tray = el('div'); tray.id = 'makerTray';
  const say = el('div', 'say');
  const shapeRow = el('div', 'row'), colorRow = el('div', 'row'), toolRow = el('div', 'row'), actRow = el('div', 'row');
  SHAPES.forEach((sh, i) => { const b = el('button', 'shp', sh.icon); b.title = sh.name; b.addEventListener('click', () => { b.blur(); addShape(i); }); shapeRow.appendChild(b); });
  const swatches = COLORS.map(([name, hex], i) => {
    const b = el('button', 'sw'); b.title = name; b.style.background = '#' + hex.toString(16).padStart(6, '0');
    b.addEventListener('click', () => { b.blur(); paint(i, null); });
    colorRow.appendChild(b); return b;
  });
  toolRow.appendChild(el('span', 'lbl', 'Finish'));
  const finishBtns = FINISHES.map((name, i) => { const b = el('button', 'h', name); b.addEventListener('click', () => { b.blur(); paint(null, i); }); toolRow.appendChild(b); return b; });
  toolRow.appendChild(el('span', 'lbl', 'Tool'));
  const toolBtns = TOOLS.map(([id, name, k]) => { const b = el('button', 'h', `${k} ${name}`); b.addEventListener('click', () => { b.blur(); tool = id; refreshTray(); }); toolRow.appendChild(b); return b; });
  const act = (text, title, fn) => { const b = el('button', 'h', text); b.title = title; b.addEventListener('click', () => { b.blur(); fn(); }); actRow.appendChild(b); return b; };
  const cutBtn = act('✂ Cut', 'Cut (K): the picked part carves into the next part you click', () => setPending('cut'));
  const joinBtn = act('🔗 Join', 'Join (J): the picked part joins onto the next part you click', () => setPending('join'));
  const apartBtn = act('⇄ Apart', 'Pull apart (U): a cut or joined part back into its two pieces', pullApart);
  const copyBtn = act('⧉ Copy', 'Copy (N)', copyPicked);
  const dropBtn = act('⤓ Drop', 'Drop onto the stand (G)', dropPicked);
  const delBtn = act('🗑', 'Delete the picked part (Delete)', deletePicked);
  const undoBtn = act('↶', 'Undo (Ctrl+Z)', () => doUndo(true));
  const redoBtn = act('↷', 'Redo (Ctrl+Y)', () => doUndo(false));
  act('✨ New', 'Start a new object (this one\'s kept as Unsaved)', newObject);
  const saveBtn = el('button', 'corner', '💾'); saveBtn.id = 'saveBtn'; saveBtn.title = 'Saved objects';
  tray.append(saveBtn, say, shapeRow, colorRow, toolRow, actRow);
  const saves = el('div'); saves.id = 'makerSaves';
  saves.innerHTML = '<div class="top"><b>Saved objects</b><button class="h x" title="Close">✕</button></div>' +
    '<div class="row"><input id="makerSaveName" maxlength="30" placeholder="Name this object"><button class="h yes" id="makerSaveGo">Save</button></div><div class="list"></div>';
  const saveName = saves.querySelector('#makerSaveName'), saveListEl = saves.querySelector('.list');
  const askBox = el('div'); askBox.id = 'makerAsk';
  askBox.innerHTML = '<div class="q"></div><div class="row"><button class="h yes">OK</button><button class="h no">Cancel</button></div>';
  document.body.append(buildBtn, tray, saves, askBox);
  let askYes = null;
  function ask(html, yesText, yes) {
    askBox.querySelector('.q').innerHTML = html; askBox.querySelector('.yes').textContent = yesText;
    askYes = yes; askBox.classList.add('up');
  }
  const closeAsk = () => { askBox.classList.remove('up'); askYes = null; };
  askBox.querySelector('.yes').addEventListener('click', e => { e.currentTarget.blur(); const f = askYes; closeAsk(); if (f) f(); });
  askBox.querySelector('.no').addEventListener('click', e => { e.currentTarget.blur(); closeAsk(); });
  const setSaves = on => { saves.classList.toggle('up', on); saveBtn.classList.toggle('on', on); if (!on) saveName.blur(); else drawSaves(); };
  saveBtn.addEventListener('click', () => { saveBtn.blur(); setSaves(!saves.classList.contains('up')); });
  saves.querySelector('.x').addEventListener('click', () => setSaves(false));
  saves.querySelector('#makerSaveGo').addEventListener('click', e => { e.currentTarget.blur(); doSave(); });
  saveName.addEventListener('keydown', e => { if (e.key === 'Enter') doSave(); e.stopPropagation(); });
  const escapeHtml = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  function drawSaves() {
    saveListEl.textContent = '';
    const rows = [];
    let unsaved = null;
    try { unsaved = JSON.parse(localStorage.getItem('makerUnsaved') || 'null'); } catch (e) {}
    if (Array.isArray(unsaved) && unsaved.length) rows.push(['unsaved', { name: 'Unsaved (yours, kept automatically)', by: 'This computer', n: unsaved.length }]);
    rows.push(...Object.entries(saveList).filter(([, it]) => it && it.name).sort(([, x], [, y]) => (y.t || 0) - (x.t || 0)));
    if (!rows.length) saveListEl.appendChild(el('div', 'none', 'Nothing saved yet'));
    for (const [id, it] of rows) {
      const row = el('div', 'item'), words = el('div', 'words');
      words.append(el('div', 'nm', it.name), el('div', 'sub', `${it.by || ''} · ${it.n || 0} part${it.n === 1 ? '' : 's'}${it.t ? ' · ' + new Date(it.t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}`));
      const load = el('button', 'h yes', 'Load');
      load.addEventListener('click', () => { load.blur();
        ask(`Load “${escapeHtml(it.name)}” onto your stand?<br>What's there now is kept as Unsaved.`, 'Load it', () => (id === 'unsaved' ? loadParts(unsaved) : loadSave(id))); });
      row.append(words, load);
      if (id !== 'unsaved') {
        const del = el('button', 'h', '🗑'); del.title = 'Delete this save';
        del.addEventListener('click', () => { del.blur(); ask(`Delete the save “${escapeHtml(it.name)}”?<br>This can't be undone.`, 'Delete it',
          () => { remove(ref(db, 'maker/saveList/' + id)).catch(() => {}); remove(ref(db, 'maker/saveData/' + id)).catch(() => {}); }); });
        row.appendChild(del);
      }
      saveListEl.appendChild(row);
    }
  }
  function refreshTray() {
    const node = P();
    swatches.forEach((b, i) => b.classList.toggle('on', i === color));
    finishBtns.forEach((b, i) => b.classList.toggle('on', i === finish));
    toolBtns.forEach((b, i) => b.classList.toggle('on', TOOLS[i][0] === tool));
    for (const b of [copyBtn, dropBtn, delBtn]) b.disabled = !node;
    cutBtn.disabled = joinBtn.disabled = !node || parts.length < 2;
    apartBtn.disabled = !node || !node.o;
    cutBtn.classList.toggle('on', pending === 'cut'); joinBtn.classList.toggle('on', pending === 'join');
    undoBtn.disabled = !undo.length; redoBtn.disabled = !redo.length;
    const what = node ? (node.o ? (node.o === 'c' ? 'Cut part' : 'Joined part') : SHAPES[node.s].name) : '';
    say.textContent = mineAt < 0 ? 'Click a free stand to take it' :
      pending ? `Click the part to ${pending === 'cut' ? 'cut into with' : 'join onto'} the ${what.toLowerCase()} · Esc to stop` :
      node ? `${what} picked · arrows and Page Up / Down: ${TOOLS.find(t => t[0] === tool)[1].toLowerCase()} · Shift for fine steps` :
      parts.length ? 'Click a part to pick it, or a shape to add one' : 'Click a shape to start';
  }
  refreshTray();

  // ---------- Build mode: floating ----------
  const pos = new THREE.Vector3();
  function toggle() {
    if (!editing && mineAt < 0) {   // (no stand yet: the nearest free one)
      let best = -1, bestD = Infinity;
      stands.forEach((st, i) => { if (!st.by) { const d = st.g.position.distanceTo(camera.position); if (d < bestD) { bestD = d; best = i; } } });
      if (best < 0) { banner('Every stand\'s taken right now', 2.5); return; }
      claim(best);
      return;
    }
    editing = !editing;
    buildBtn.classList.toggle('on', editing);
    tray.classList.toggle('up', editing);
    if (editing) pos.copy(camera.position);
    else { closeAsk(); setSaves(false); pending = null; }
    if (mineAt >= 0) drawParts(mineAt, parts);   // (the picked part's outline on or off)
    refreshTray();
    onEdit(editing, pos);
  }
  buildBtn.addEventListener('click', () => { buildBtn.blur(); toggle(); });

  // ---------- Listening (once you're in) ----------
  let listening = false;
  function start() {
    holdStand();
    if (listening) return;
    listening = true;
    onValue(ref(db, 'maker/saveList'), s => { saveList = s.val() || {}; if (saves.classList.contains('up')) drawSaves(); });
    onValue(ref(db, 'maker/stands'), s => {
      const all = s.val() || {};
      for (let i = 0; i < STANDS; i++) {
        const v = all[i] || null, st = stands[i];
        const by = v && v.by ? String(v.by) : null, name = v && v.name ? String(v.name).slice(0, 20) : '', c = v ? v.c : -1;
        if (i === mineAt && offline) continue;   // (yours, on this computer only: the database doesn't know it)
        if (by !== st.by || name !== st.name || c !== st.c) { st.by = by; st.name = name; st.c = c; showStand(i); }
        if (i === mineAt) {
          if (by !== myId && !offline) holdStand();   // (it went while you still had it: a reconnect. Put it back)
          continue;
        }
        const str = v && typeof v.parts === 'string' ? v.parts : '[]';
        if (str !== st.partsStr) {
          st.partsStr = str;
          let list = [];
          try { list = valid(JSON.parse(str)); } catch (e) {}
          drawParts(i, list);
        }
      }
    });
  }

  // ---------- Keys while building ----------
  function onKey(e) {
    if (e.type !== 'keydown') return false;
    if (!editing) {   // (walking about: B takes you into build mode)
      if (e.key.toLowerCase() === 'b' && !e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey) { toggle(); return true; }
      return false;
    }
    if (askBox.classList.contains('up')) {
      if (e.key === 'Enter') { const f = askYes; closeAsk(); if (f) f(); } else if (e.key === 'Escape') closeAsk();
      e.preventDefault(); return true;
    }
    const k = e.key.toLowerCase(), code = e.code;
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); doUndo(!e.shiftKey); return true; }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); doUndo(false); return true; }
    if (e.ctrlKey || e.metaKey || e.altKey) return false;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(code)) {
      if (!P()) return false;   // (nothing picked: the arrows fly you)
      e.preventDefault(); nudge(code, e.shiftKey); return true;
    }
    if (e.repeat) return ['Tab', 'Delete'].includes(code);
    if (code.startsWith('Digit') && +code.slice(5) >= 1 && +code.slice(5) <= 4) { tool = TOOLS[+code.slice(5) - 1][0]; refreshTray(); return true; }
    if (code === 'Tab') { e.preventDefault(); if (parts.length) { picked = (picked + 1) % parts.length; pending = null; drawParts(mineAt, parts); refreshTray(); } return true; }
    if (code === 'Escape') { if (pending) pending = null; else picked = -1; drawParts(mineAt, parts); refreshTray(); return true; }
    if (code === 'Delete' || code === 'Backspace') { e.preventDefault(); deletePicked(); return true; }
    if (k === 'k') { setPending('cut'); return true; }
    if (k === 'j') { setPending('join'); return true; }
    if (k === 'u') { pullApart(); return true; }
    if (k === 'n') { copyPicked(); return true; }
    if (k === 'g') { dropPicked(); return true; }
    if (k === 'b') { toggle(); return true; }
    return false;
  }

  // ---------- Clicks ----------
  function hitInfo(hits) {
    for (const h of hits) {
      let o = h.object;
      while (o && o.userData.part == null && o.userData.stand == null && o.parent) o = o.parent;
      if (o && o.userData.part != null) return { part: o.userData.part, onStand: o.userData.onStand };
      if (o && o.userData.stand != null) return { stand: o.userData.stand };
      return null;   // (the first thing hit is something else: the floor, a wall)
    }
    return null;
  }
  function click(hits) {
    const h = hitInfo(hits);
    if (h && h.part != null && h.onStand === mineAt && editing) {
      if (pending && h.part !== picked) combine(pending, h.part);
      else { picked = h.part; pending = null; drawParts(mineAt, parts); refreshTray(); }
      return true;
    }
    const standAt = h ? (h.stand != null ? h.stand : h.onStand) : null;
    if (standAt != null) {
      const st = stands[standAt];
      if (standAt === mineAt) { if (!editing) toggle(); return true; }
      if (!st.by) { claim(standAt); return true; }
      return false;   // (someone else's: nothing to do but look)
    }
    if (editing) { if (!pending && picked >= 0) { picked = -1; drawParts(mineAt, parts); refreshTray(); } return true; }
    return false;
  }
  function hover(hits) {
    const h = hitInfo(hits);
    if (!h) return null;
    if (h.part != null && h.onStand === mineAt && editing) return 'pointer';
    const standAt = h.stand != null ? h.stand : h.onStand;
    if (standAt != null && (standAt === mineAt || !stands[standAt].by)) return 'pointer';
    return null;
  }

  return {
    get editing() { return editing; },
    help: [
      ['Building (🛠 button, or B)', [['Click a free stand', 'Take it (one each); you float and build on it'], ['W A S D', 'Fly about'], ['Space / C', 'Fly up / down'],
        ['Shift', 'Faster'], ['B', 'Build mode on and off (landing puts you on your feet)'], ['Leaving the room', 'Your stand frees up; your object comes back next time you take one']]],
      ['Parts (the tray)', [['Shapes', 'Click one: it appears in the middle of your stand, picked'], ['Click a part', 'Pick it (Tab: the next one, Esc: none)'],
        ['Colors, Finish', 'The picked part takes it (and so do new shapes)'],
        ['1 2 3 4', 'Tools: Move, Turn, Size, Stretch'],
        ['Arrows', 'Move: along the floor (up is away from you) · Turn: left and right spin it, up and down tip it · Size: bigger, smaller · Stretch: wider (left, right) and deeper (up, down)'],
        ['Page Up / Down', 'Move: up and down · Turn: roll it to the side · Size: bigger, smaller · Stretch: taller, shorter'],
        ['Shift', 'Fine steps (a fifth)'], ['K  ✂', 'Cut: the picked part carves into the next part you click (it becomes the hole)'],
        ['J  🔗', 'Join: the picked part and the next part you click become one'], ['U  ⇄', 'Pull a cut or joined part back apart'],
        ['N  ⧉', 'Copy the picked part'], ['G  ⤓', 'Drop it onto the stand'], ['Delete', 'Delete the picked part'],
        ['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['✨ New', 'Start a new object (this one\'s kept as Unsaved)']]],
      ['Saved objects (💾 on the tray)', [['Save', 'Name your object and save it'], ['Load', 'Put a save on your stand (asks first; what was there is kept as Unsaved)'],
        ['🗑', 'Delete a save (asks first)'], ['Unsaved', 'Yours, kept on this computer: what was on your stand before the last New or Load']]]
    ],
    onKey, click, hover, start, toggle,
    fly(dt, keys, yaw, pitch) {
      const sp = (keys.has('shift') ? 5 : 2.5) * dt;
      const f = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
      const s = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
      pos.x += (-Math.sin(yaw) * f + Math.cos(yaw) * s) * sp;
      pos.z += (-Math.cos(yaw) * f - Math.sin(yaw) * s) * sp;
      pos.y += ((keys.has(' ') ? 1 : 0) - (keys.has('c') ? 1 : 0)) * sp;
      const l = flyLimit();
      if (l.round) { const d = Math.hypot(pos.x, pos.z); if (d > l.round) { pos.x *= l.round / d; pos.z *= l.round / d; } }
      else { pos.x = Math.max(-l.x, Math.min(l.x, pos.x)); pos.z = Math.max(-l.z, Math.min(l.z, pos.z)); }
      pos.y = Math.max(0.4, Math.min(RH - 0.3, pos.y));
      camera.position.copy(pos);
      camera.rotation.set(pitch, yaw, 0);
    },
    update(dt, t) {
      if (mineAt >= 0 && picked >= 0) {   // (the picked part's outline breathes a little)
        const m = stands[mineAt].meshes[picked], o = m && m.children[0];
        if (o && o.material) o.material.opacity = 0.75 + 0.25 * Math.sin(t * 4);
      }
    },
    leave() {
      if (mineAt < 0 || offline) return Promise.resolve();
      onDisconnect(standRef(mineAt)).cancel().catch(() => {});
      const r = remove(standRef(mineAt)).catch(() => {});
      mineAt = -1;
      return r;
    }
  };
}
// >>>>> END OF FILE: HangoutRoom/maker/bench.js <<<<<
