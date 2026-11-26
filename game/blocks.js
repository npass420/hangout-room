// =====================================================================================================================
// >>>>> START OF FILE: HangoutRoom/game/blocks.js <<<<<
// Building in the Game Room: soft stacking blocks, like the Cave's igloo bricks but in colors. Chunky 40 cm blocks with
// soft rounded edges, each a touch uneven so a wall looks handmade, smooth and soft matte with a gentle sheen.
// Shared live: everyone in the Game Room sees the same blocks (game/blocks in the database).
//   The build button (bottom left, above the chat button): edit mode. Your snowman disappears and you float:
//     W A S D move, Space up, C down, Shift faster, drag to look. Click the button again to land back on your feet.
//   Click a cushion (or a block on it) to pick that square: it gets a gold outline and its 3 by 3 spots show.
//   Numpad 1 to 9 builds on the nine spots of that square, laid out like the numpad: 7 8 9 the far row (away from
//     you, whichever way you face), 1 2 3 the near row.
//   The tray along the bottom (pops up in edit mode): the colors, and the height.
//     Auto: each press stacks one more on top, up to 9 high. Hold Numpad 0 and press a number to take the top one off.
//     1 to 9: places the block at exactly that height, floating if nothing's under it; press again to take it away.
//   makeBuilder({ scene, camera, TILE, HX, HZ, RH, presenceRef, update })
//     .editing, .onKey(e) (true if it used the key), .pick(e) (a click in edit mode), .fly(dt, keys, yaw, pitch)
//     .toggle(), .start(): listen for the shared blocks (once you're in the room)
// =====================================================================================================================
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ref, set, remove, onValue } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { db } from '../core.js';

const COLORS = [   // the swatches: name, color
  ['Cream', 0xf3ead2], ['Sky', 0x8cc8f0], ['Lavender', 0xb7a3e6], ['Pink', 0xf3a6c4],
  ['Mint', 0x9adbbd], ['Butter', 0xf6d97a], ['Coral', 0xf08a72], ['Charcoal', 0x3d3f47]
];
const MAX = 9, MAX_BLOCKS = 12000;

export function makeBuilder({ scene, camera, canvas, TILE, HX, HZ, RH, onEdit }) {
  const B = TILE / 3, BASE = 0.12;   // (a block's size, and where the bottom row sits, pressed into the cushion a little)
  const IX0 = Math.ceil(-HX / TILE), IX1 = Math.floor(HX / TILE) - 1, IZ0 = Math.ceil(-HZ / TILE), IZ1 = Math.floor(HZ / TILE) - 1;   // (whole cushions only)
  let editing = false, color = 0, height = 0, sel = null;   // (height 0: Auto)
  let blocks = {};   // "ix_iz_u_v_level" -> color index

  // ---------- The blocks: one instanced mesh, each block its own color and its own slight unevenness ----------
  const geo = new RoundedBoxGeometry(B * 0.97, B * 0.97, B * 0.97, 4, B * 0.2);
  const mat = new THREE.MeshPhysicalMaterial({ roughness: 0.62, metalness: 0, sheen: 0.5, sheenRoughness: 0.5, sheenColor: 0xfff4e6, clearcoat: 0.08, clearcoatRoughness: 0.6 });
  // (each block lights itself a little in its own color, so the room's purple and pink glow can't tint a white block
  // purple: its true color always shows, the room's light only shading it)
  mat.onBeforeCompile = sh => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * 0.45;');
  };
  const mesh = new THREE.InstancedMesh(geo, mat, MAX_BLOCKS);
  mesh.count = 0; mesh.castShadow = mesh.receiveShadow = true;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.userData.blocks = true;
  scene.add(mesh);
  const keyAt = (ix, iz, u, v, l) => `${ix}_${iz}_${u}_${v}_${l}`;
  const spot = (ix, iz, u, v, l) => new THREE.Vector3(ix * TILE + (u + 0.5) * B, BASE + (l + 0.5) * B, iz * TILE + (v + 0.5) * B);
  const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return ((h >>> 0) % 10000) / 10000; };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e3 = new THREE.Euler(), sc = new THREE.Vector3(), col = new THREE.Color();
  function rebuild() {
    let n = 0;
    for (const [k, c] of Object.entries(blocks)) {
      if (n >= MAX_BLOCKS) break;
      const [ix, iz, u, v, l] = k.split('_').map(Number), p = spot(ix, iz, u, v, l);
      const a = hash(k), b = hash(k + 'b'), d = hash(k + 'c');
      e3.set((b - 0.5) * 0.03, (a - 0.5) * 0.07, (d - 0.5) * 0.03);   // (a touch uneven: each sits a little its own way)
      q.setFromEuler(e3);
      sc.set(0.97 + a * 0.05, 0.96 + b * 0.05, 0.97 + d * 0.05);
      p.x += (b - 0.5) * 0.012; p.z += (a - 0.5) * 0.012;
      mesh.setMatrixAt(n, m4.compose(p, q, sc));
      col.setHex(COLORS[c] ? COLORS[c][1] : COLORS[0][1]).multiplyScalar(0.94 + d * 0.08);
      mesh.setColorAt(n, col);
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }

  // ---------- The picked square: a gold outline, its nine spots marked, and (with a height picked) that layer ----------
  const gold = new THREE.MeshBasicMaterial({ color: 0xffd36a, toneMapped: false });
  const faint = new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.45, depthWrite: false, toneMapped: false });
  const marks = new THREE.Group();
  for (const [w, d, x, z] of [[TILE, 0.04, TILE / 2, 0], [TILE, 0.04, TILE / 2, TILE], [0.04, TILE, 0, TILE / 2], [0.04, TILE, TILE, TILE / 2]]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.03, d), gold); bar.position.set(x, 0.2, z); marks.add(bar);
  }
  for (const k of [1, 2]) {   // (the lines between the nine spots)
    const a = new THREE.Mesh(new THREE.BoxGeometry(TILE, 0.015, 0.015), faint); a.position.set(TILE / 2, 0.2, k * B); marks.add(a);
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.015, TILE), faint); b.position.set(k * B, 0.2, TILE / 2); marks.add(b);
  }
  const layer = new THREE.Mesh(new THREE.BoxGeometry(TILE, B, TILE), new THREE.MeshBasicMaterial({ color: 0xffe6a0, transparent: true, opacity: 0.12, depthWrite: false, toneMapped: false }));
  const layerEdge = new THREE.LineSegments(new THREE.EdgesGeometry(layer.geometry), new THREE.LineBasicMaterial({ color: 0xffd36a, transparent: true, opacity: 0.8, toneMapped: false }));
  layer.add(layerEdge);
  marks.add(layer);
  marks.visible = false;
  scene.add(marks);
  function showMarks() {
    marks.visible = editing && !!sel;
    if (!sel) return;
    marks.position.set(sel.ix * TILE, 0, sel.iz * TILE);
    layer.visible = height > 0;
    layer.position.set(TILE / 2, BASE + (height - 0.5) * B, TILE / 2);
  }

  // ---------- Placing and taking away ----------
  const PAD = { Numpad7: [0, 0], Numpad8: [1, 0], Numpad9: [2, 0], Numpad4: [0, 1], Numpad5: [1, 1], Numpad6: [2, 1], Numpad1: [0, 2], Numpad2: [1, 2], Numpad3: [2, 2] };
  let yawNow = 0, zeroHeld = false;
  function spotFor(code) {   // (the numpad turned to match the way you're facing, so 8 is always the far middle)
    let [a, b] = PAD[code];
    const turns = ((Math.round(-yawNow / (Math.PI / 2)) % 4) + 4) % 4;
    for (let i = 0; i < turns; i++) [a, b] = [2 - b, a];
    return [a, b];
  }
  const top = (u, v) => { for (let l = MAX - 1; l >= 0; l--) if (blocks[keyAt(sel.ix, sel.iz, u, v, l)] != null) return l; return -1; };
  function build(code) {
    if (!sel) return;
    const [u, v] = spotFor(code);
    const path = l => ref(db, 'game/blocks/' + keyAt(sel.ix, sel.iz, u, v, l));
    if (height === 0) {
      const t = top(u, v);
      if (zeroHeld) { if (t >= 0) { delete blocks[keyAt(sel.ix, sel.iz, u, v, t)]; rebuild(); remove(path(t)).catch(() => {}); } return; }
      if (t + 1 >= MAX) return;
      blocks[keyAt(sel.ix, sel.iz, u, v, t + 1)] = color; rebuild();
      set(path(t + 1), color).catch(() => {});
    } else {
      const l = height - 1, k = keyAt(sel.ix, sel.iz, u, v, l);
      if (blocks[k] != null) { delete blocks[k]; rebuild(); remove(path(l)).catch(() => {}); }
      else { blocks[k] = color; rebuild(); set(path(l), color).catch(() => {}); }
    }
  }

  // ---------- The tray along the bottom, and the build button ----------
  const css = document.createElement('style');
  css.textContent = `
    #buildBtn { left: 16px; bottom: 68px; font-size: 20px; }
    #buildBtn.on { background: rgba(233,201,143,0.92); color: #2a1c10; }
    #buildTray { position: fixed; left: 50%; bottom: 14px; z-index: 12; transform: translate(-50%, 160%); transition: transform 0.35s cubic-bezier(.2,1.3,.4,1);
      display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 16px;
      background: rgba(20,16,12,0.82); box-shadow: 0 4px 16px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(201,162,39,0.6); }
    #buildTray.up { transform: translate(-50%, 0); }
    #buildTray .row { display: flex; gap: 7px; align-items: center; }
    #buildTray .sw { width: 34px; height: 34px; border-radius: 9px; border: 2px solid rgba(0,0,0,0.35); cursor: pointer; padding: 0;
      box-shadow: inset 0 -5px 8px rgba(0,0,0,0.2), inset 0 4px 6px rgba(255,255,255,0.35); transition: transform 0.12s; }
    #buildTray .sw.on { transform: translateY(-4px) scale(1.12); outline: 3px solid #ffd36a; outline-offset: 2px; }
    #buildTray .h { min-width: 30px; height: 28px; border-radius: 8px; border: none; cursor: pointer; font: 600 14px inherit; padding: 0 8px;
      color: #f3e6cf; background: rgba(255,255,255,0.08); box-shadow: inset 0 0 0 1px rgba(201,162,39,0.45); }
    #buildTray .h.on { background: rgba(233,201,143,0.92); color: #2a1c10; }
    #buildTray .lbl { color: #f3e6cf; opacity: 0.7; font-size: 13px; margin-right: 2px; }`;
  document.head.appendChild(css);
  const btn = document.createElement('button');
  btn.id = 'buildBtn'; btn.className = 'corner'; btn.title = 'Build'; btn.textContent = '🧱';
  document.body.appendChild(btn);
  const tray = document.createElement('div');
  tray.id = 'buildTray';
  const colorRow = document.createElement('div'); colorRow.className = 'row';
  const heightRow = document.createElement('div'); heightRow.className = 'row';
  heightRow.innerHTML = '<span class="lbl">Height</span>';
  const swatches = COLORS.map(([name, hex], i) => {
    const b = document.createElement('button');
    b.className = 'sw'; b.title = name; b.style.background = '#' + hex.toString(16).padStart(6, '0');
    b.addEventListener('click', () => { b.blur(); color = i; refreshTray(); });
    colorRow.appendChild(b);
    return b;
  });
  const heights = Array.from({ length: MAX + 1 }, (_, i) => {
    const b = document.createElement('button');
    b.className = 'h'; b.textContent = i === 0 ? 'Auto' : String(i);
    b.addEventListener('click', () => { b.blur(); height = i; refreshTray(); showMarks(); });
    heightRow.appendChild(b);
    return b;
  });
  tray.append(colorRow, heightRow);
  document.body.appendChild(tray);
  function refreshTray() {
    swatches.forEach((b, i) => b.classList.toggle('on', i === color));
    heights.forEach((b, i) => b.classList.toggle('on', i === height));
  }
  refreshTray();

  // ---------- Edit mode: floating ----------
  const pos = new THREE.Vector3();
  function toggle() {
    editing = !editing;
    btn.classList.toggle('on', editing);
    tray.classList.toggle('up', editing);
    if (editing) pos.copy(camera.position);
    showMarks();
    if (onEdit) onEdit(editing, pos);
  }
  btn.addEventListener('click', () => { btn.blur(); toggle(); });

  return {
    get editing() { return editing; },
    toggle,
    start() { onValue(ref(db, 'game/blocks'), s => { blocks = s.val() || {}; rebuild(); }); },
    onKey(e) {   // (the numpad builds while in edit mode)
      if (!editing) return false;
      if (e.code === 'Numpad0') { zeroHeld = e.type === 'keydown'; e.preventDefault(); return true; }
      if (e.type !== 'keydown') return false;
      if (PAD[e.code]) { e.preventDefault(); if (!e.repeat) build(e.code); return true; }
      return false;
    },
    pick(hits) {   // (a click: the cushion, or a block, under the pointer picks that square)
      const h = hits.find(x => x.object === mesh || x.object.userData.floor);
      if (!h) return;
      const p = h.point.clone();
      if (h.object === mesh && h.face) p.addScaledVector(h.face.normal, -0.02);   // (just inside the block that was clicked)
      const ix = Math.floor(p.x / TILE), iz = Math.floor(p.z / TILE);
      if (ix < IX0 || ix > IX1 || iz < IZ0 || iz > IZ1) return;
      sel = { ix, iz };
      showMarks();
    },
    fly(dt, keys, yaw, pitch) {   // (floating: W A S D along the way you face, Space up, C down, Shift faster)
      yawNow = yaw;
      const sp = (keys.has('shift') ? 6 : 3) * dt;
      const f = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
      const s = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
      pos.x += (-Math.sin(yaw) * f + Math.cos(yaw) * s) * sp;
      pos.z += (-Math.cos(yaw) * f - Math.sin(yaw) * s) * sp;
      pos.y += ((keys.has(' ') ? 1 : 0) - (keys.has('c') ? 1 : 0)) * sp;
      pos.x = Math.max(-HX + 0.3, Math.min(HX - 0.3, pos.x));
      pos.z = Math.max(-HZ + 0.3, Math.min(HZ - 0.3, pos.z));
      pos.y = Math.max(0.5, Math.min(RH - 0.3, pos.y));
      camera.position.copy(pos);
      camera.rotation.set(pitch, yaw, 0);
    }
  };
}
// >>>>> END OF FILE: HangoutRoom/game/blocks.js <<<<<
