// =====================================================================================================================
// >>>>> START OF FILE: HangoutRoom/game/blocks.js <<<<<
// Building in the Game Room: soft stacking blocks, like the Cave's igloo bricks but in colors. Chunky 40 cm blocks with
// soft rounded edges, each a touch uneven so a wall looks handmade, smooth and soft matte with a gentle sheen.
// Shared live: everyone in the Game Room sees the same blocks (game/blocks in the database).
//   The build button (bottom left, above the chat button): edit mode. Your snowman disappears and you float:
//     W A S D move, Space up, C down, Shift faster, drag to look. Click the button again to land back on your feet.
//   Click a cushion (or a block on it) to pick that square: it gets a gold outline and its 3 by 3 spots show.
//   Numpad 1 to 9 builds on the nine spots of that square, laid out like the numpad: 7 8 9 the far row (away from
//     you, whichever way you face), 1 2 3 the near row. Placing never takes a block away: only the hammer does.
//   The tray along the bottom (pops up in edit mode): the colors (16), the shade and the height, all clickable.
//     Numpad * and / : the next and the last color.   Numpad + and - : brighter and darker (Dark, Normal, Bright,
//     Glow, Glowing; it starts on Normal).   Page Up and Page Down: the height up and down (Auto, then 1 to 15).
//     Auto: each press stacks one more on top, up to 15 high.
//     1 to 15: the block goes at that height (floating if nothing's under it); if that spot's taken, on the next free
//       spot above it, so pressing again keeps stacking up from there.
//   Glow and Glowing blocks are lit from inside like jelly, see-through toward their edges, with a soft halo round
//     them (Glowing's bigger and brighter).
//   The hammer (H, or 🔨 over the paint): click a block and a toy mallet swings down on it: the block squishes
//     flat and pops into soft chunks that bounce on the cushions. Everyone sees blocks pop when they go.
//   The paint (P, or 🖌 over the build button): click a block and it takes the color and shade picked in the tray,
//     with a little splash of paint drops.
//   X-ray (X, or 👁 at the top of the buttons): the blueprint: every block shrinks to a small glowing orb in its color, and a
//     see-through laser lattice lights up along every floor square, all three ways, so you can see the framework and
//     what's inside a build. Click an orb to pick up its color and shade. X again and they grow back.
//   R: clear the whole room, after an "are you sure?" (every block goes, for everyone).
//   T: the test wall, on the picked square and the one beside it: every color in a column, Dark at the bottom up to
//     Glowing on top.
//   Stored as one number per block: the first eight colors are color + 8 x shade code (0 to 39, as before), the next
//     eight 40 + (color - 8) + 8 x shade code (40 to 79). Shade codes: 0 Normal, 1 Dark, 2 Bright, 3 Glow, 4 Glowing.
//   makeBuilder({ scene, camera, canvas, TILE, HX, HZ, RH, onEdit })
//     .editing, .cursor, .onKey(e) (true if it used the key), .pick(hits) (a click in edit mode),
//     .fly(dt, keys, yaw, pitch), .update(dt) (every frame: the hammer, the chunks, the x-ray), .toggle(),
//     .start(): listen for the shared blocks (once you're in the room)
// =====================================================================================================================
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ref, set, remove, update, onValue } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { db } from '../core.js';
import { sfx } from '../sounds.js';

const COLORS = [   // the swatches: name, color (the soft ones first, then the strong ones)
  ['Cream', 0xf3ead2], ['Sky', 0x8cc8f0], ['Lavender', 0xb7a3e6], ['Pink', 0xf3a6c4],
  ['Mint', 0x9adbbd], ['Butter', 0xf6d97a], ['Coral', 0xf08a72], ['Charcoal', 0x3d3f47],
  ['Red', 0xe23b3f], ['Orange', 0xf5862a], ['Yellow', 0xffd02e], ['Green', 0x46b856],
  ['Teal', 0x22b5ad], ['Blue', 0x3a78e6], ['Purple', 0x8a4bd6], ['White', 0xffffff]
];
// the shades, darkest to brightest: name, its code in the database, how it changes the color (times, then toward
// white), and how much it glows
const SHADES = [['Dark', 1, 0.55, 0, 0], ['Normal', 0, 1, 0, 0], ['Bright', 2, 1.1, 0.3, 0], ['Glow', 3, 1, 0.1, 1], ['Glowing', 4, 1, 0.22, 2]];
const NORMAL = 1;
const MAX = 15, MAX_BLOCKS = 12000, MAX_GLOW = 3000, MAX_CHUNKS = 400;
const valueOf = (c, s) => (c < 8 ? c : 40 + c - 8) + 8 * SHADES[s][1];
function decode(v) {   // -> [color, shade]
  v = Math.max(0, Math.floor(v) || 0);
  const hi = v >= 40, w = hi ? v - 40 : v, code = Math.floor(w / 8);
  const s = SHADES.findIndex(x => x[1] === code);
  return [(w % 8) + (hi ? 8 : 0), s < 0 ? NORMAL : s];
}
const WHITE = new THREE.Color(1, 1, 1);
function tint(out, v, jitter = 1) {   // a block's color in its shade
  const [c, s] = decode(v), [, , k, w] = SHADES[s];
  out.setHex(COLORS[c][1]).lerp(WHITE, w).multiplyScalar(k * jitter);
  return out;
}
const glowOf = v => SHADES[decode(v)[1]][4];
const BRUSH_CURSOR = `url("data:image/svg+xml,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='34' height='34'><text x='2' y='28' font-size='26'>🖌</text></svg>")}") 6 26, pointer`;
const HAMMER_CURSOR = `url("data:image/svg+xml,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='34' height='34'><text x='2' y='28' font-size='26'>🔨</text></svg>")}") 8 8, pointer`;

// ---------- The glow shades' look: jelly lit from inside, and the halo round them ----------
const JELLY_VS = `
  attribute float aGlow; varying vec3 vCol, vN, vV; varying vec2 vUv; varying float vGlow;
  void main() {
    vCol = instanceColor; vGlow = aGlow; vUv = uv;
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
    vV = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const JELLY_FS = `
  varying vec3 vCol, vN, vV; varying vec2 vUv; varying float vGlow;
  void main() {
    float facing = abs(dot(normalize(vN), normalize(vV)));     // 1 looking straight in, 0 at the edges
    vec2 c = abs(vUv - 0.5) * 2.0;
    float center = 1.0 - max(c.x, c.y);                          // the middle of each face
    float core = pow(facing, 2.0) * (0.55 + 0.45 * center);      // the light inside shows most through the middle
    vec3 col = vCol * (0.75 + 0.55 * vGlow) * (0.7 + 0.8 * core);
    col = mix(col, vec3(1.0), core * core * (0.18 + 0.14 * vGlow));   // (a little white-hot right in the core)
    col += vCol * pow(1.0 - facing, 3.0) * 0.5;                  // (and a bright rim, like light caught in the jelly)
    float a = mix(0.62, 0.95, core);                              // see-through toward the edges
    gl_FragColor = vec4(col, a);
  }`;
const HALO_VS = `
  varying vec3 vCol, vN, vV;
  void main() {
    vCol = instanceColor;
    vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
    vV = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const HALO_FS = `
  uniform float strength; varying vec3 vCol, vN, vV;
  void main() {
    float f = abs(dot(normalize(vN), normalize(vV)));
    gl_FragColor = vec4(vCol * pow(f, 2.2) * strength, 1.0);
  }`;

export function makeBuilder({ scene, camera, canvas, TILE, HX, HZ, RH, onEdit }) {
  const B = TILE / 3, BASE = 0.12;   // (a block's size, and where the bottom row sits, pressed into the cushion a little)
  const IX0 = Math.ceil(-HX / TILE), IX1 = Math.floor(HX / TILE) - 1, IZ0 = Math.ceil(-HZ / TILE), IZ1 = Math.floor(HZ / TILE) - 1;   // (whole cushions only)
  let editing = false, color = 0, shade = NORMAL, height = 0, sel = null, hammerOn = false, paintOn = false, xray = false, xk = 0;   // (height 0: Auto)
  let blocks = {};   // "ix_iz_u_v_level" -> the stored number (color + shade)
  let order = [], orderGlow = [], orderNodes = [];   // (which block each drawn copy is, so the hammer knows which one it hit)

  // ---------- The blocks: one instanced mesh for the soft ones, one for the glowing ones, and the halos ----------
  const geo = new RoundedBoxGeometry(B * 0.97, B * 0.97, B * 0.97, 4, B * 0.2);
  // (each block lights itself a little in its own color, so the room's purple and pink glow can't tint a white block
  // purple: its true color always shows, the room's light only shading it)
  const selfLit = sh => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * 0.45;');
  };
  const softMat = () => {
    const m = new THREE.MeshPhysicalMaterial({ roughness: 0.62, metalness: 0, sheen: 0.5, sheenRoughness: 0.5, sheenColor: 0xfff4e6, clearcoat: 0.08, clearcoatRoughness: 0.6 });
    m.onBeforeCompile = selfLit;
    return m;
  };
  const mesh = new THREE.InstancedMesh(geo, softMat(), MAX_BLOCKS);
  mesh.count = 0; mesh.castShadow = mesh.receiveShadow = true;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.setColorAt(0, new THREE.Color());
  mesh.userData.blocks = true;
  scene.add(mesh);
  const glowGeo = geo.clone();
  const glowAttr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_GLOW), 1);
  glowGeo.setAttribute('aGlow', glowAttr);
  const glowMesh = new THREE.InstancedMesh(glowGeo, new THREE.ShaderMaterial({ vertexShader: JELLY_VS, fragmentShader: JELLY_FS, transparent: true, toneMapped: false }), MAX_GLOW);
  glowMesh.count = 0;
  glowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  glowMesh.setColorAt(0, new THREE.Color());
  glowMesh.userData.blocks = true;
  scene.add(glowMesh);
  const haloGeo = new THREE.SphereGeometry(B * 0.5, 20, 14);
  const haloMat = (strength) => new THREE.ShaderMaterial({ vertexShader: HALO_VS, fragmentShader: HALO_FS, uniforms: { strength: { value: strength } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const halo = new THREE.InstancedMesh(haloGeo, haloMat(0.55), MAX_GLOW);
  halo.count = 0; halo.raycast = () => {};
  halo.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  halo.setColorAt(0, new THREE.Color());
  scene.add(halo);

  const keyAt = (ix, iz, u, v, l) => `${ix}_${iz}_${u}_${v}_${l}`;
  const spot = (ix, iz, u, v, l) => new THREE.Vector3(ix * TILE + (u + 0.5) * B, BASE + (l + 0.5) * B, iz * TILE + (v + 0.5) * B);
  const spotOfKey = k => { const [ix, iz, u, v, l] = k.split('_').map(Number); return spot(ix, iz, u, v, l); };
  const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return ((h >>> 0) % 10000) / 10000; };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e3 = new THREE.Euler(), sc = new THREE.Vector3(), col = new THREE.Color();
  function rebuild() {
    let n = 0, g = 0;
    order = []; orderGlow = [];
    const shrink = 1 - xk * 0.72;   // (x-ray: the blocks shrink toward their nodes)
    for (const [k, v] of Object.entries(blocks)) {
      const glow = glowOf(v);
      if (glow ? g >= MAX_GLOW : n >= MAX_BLOCKS) continue;
      const p = spotOfKey(k);
      const a = hash(k), b = hash(k + 'b'), d = hash(k + 'c');
      e3.set((b - 0.5) * 0.03, (a - 0.5) * 0.07, (d - 0.5) * 0.03);   // (a touch uneven: each sits a little its own way)
      q.setFromEuler(e3);
      sc.set(0.97 + a * 0.05, 0.96 + b * 0.05, 0.97 + d * 0.05).multiplyScalar(shrink);
      p.x += (b - 0.5) * 0.012; p.z += (a - 0.5) * 0.012;
      m4.compose(p, q, sc);
      tint(col, v, 0.94 + d * 0.08);
      if (glow) {
        glowMesh.setMatrixAt(g, m4); glowMesh.setColorAt(g, col); glowAttr.setX(g, glow);
        sc.setScalar((glow === 2 ? 2.1 : 1.55) * shrink);
        halo.setMatrixAt(g, m4.compose(p, q.identity(), sc)); halo.setColorAt(g, col.multiplyScalar(glow === 2 ? 1 : 0.6));
        orderGlow.push(k); g++;
      } else {
        mesh.setMatrixAt(n, m4); mesh.setColorAt(n, col);
        order.push(k); n++;
      }
    }
    mesh.count = n; glowMesh.count = g; halo.count = g;
    for (const m of [mesh, glowMesh, halo]) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
    }
    glowAttr.needsUpdate = true;
    if (xray || xk > 0) buildNodes();
  }

  // ---------- X-ray, the blueprint: a see-through laser lattice through every spot, glowing orbs where the blocks are ----------
  const nodeGeo = new THREE.SphereGeometry(B * 0.13, 16, 12);
  const nodes = new THREE.InstancedMesh(nodeGeo, new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true }), MAX_BLOCKS);
  nodes.count = 0; nodes.raycast = () => {};
  nodes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  nodes.setColorAt(0, new THREE.Color());
  scene.add(nodes);
  const nodeHalo = new THREE.InstancedMesh(new THREE.SphereGeometry(B * 0.13, 16, 12), haloMat(0.9), MAX_BLOCKS);
  nodeHalo.count = 0;   // (its soft glow is what a click on an orb hits: bigger than the orb, easy to click)
  nodeHalo.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  nodeHalo.setColorAt(0, new THREE.Color());
  scene.add(nodeHalo);
  // the laser lattice: hairlines along every floor square's edges, all three ways, a cage round each square's spots;
  // faint and see-through, brightest close to you and fading off into the distance so it never turns to a fog
  const LASER_VS = 'varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }';
  const LASER_FS = `uniform float strength; varying vec3 vW;
    void main() { float d = distance(vW, cameraPosition);
      float a = strength * (0.25 + 0.75 * smoothstep(9.0, 1.5, d));
      gl_FragColor = vec4(vec3(0.42, 0.9, 1.0) * a, 1.0); }`;
  const linkMat = new THREE.ShaderMaterial({ vertexShader: LASER_VS, fragmentShader: LASER_FS, uniforms: { strength: { value: 0 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const links = new THREE.LineSegments(new THREE.BufferGeometry(), linkMat);
  {
    // (one line per floor square: along the cushions' edges, every three blocks up, and up from every corner)
    const xs = [], zs = [], ys = [];
    for (let ix = IX0; ix <= IX1 + 1; ix++) xs.push(ix * TILE);
    for (let iz = IZ0; iz <= IZ1 + 1; iz++) zs.push(iz * TILE);
    for (let l = 0; l <= MAX; l += 3) ys.push(BASE + l * B);
    const x0 = xs[0], x1 = xs[xs.length - 1], z0 = zs[0], z1 = zs[zs.length - 1], y0 = ys[0], y1 = ys[ys.length - 1];
    const pts = [];
    for (const y of ys) { for (const z of zs) pts.push(x0, y, z, x1, y, z); for (const x of xs) pts.push(x, y, z0, x, y, z1); }
    for (const x of xs) for (const z of zs) pts.push(x, y0, z, x, y1, z);
    links.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  }
  links.raycast = () => {}; links.frustumCulled = false;
  scene.add(links);
  nodes.visible = nodeHalo.visible = links.visible = false;
  function buildNodes() {
    let n = 0;
    orderNodes = [];
    q.identity();
    for (const [k, v] of Object.entries(blocks)) {
      if (n >= MAX_BLOCKS) break;
      const p = spotOfKey(k);
      nodes.setMatrixAt(n, m4.compose(p, q, sc.setScalar(1)));
      tint(col, v);
      col.lerp(WHITE, 0.15).multiplyScalar(1.3);
      nodes.setColorAt(n, col);
      nodeHalo.setMatrixAt(n, m4.compose(p, q, sc.setScalar(3.2)));
      nodeHalo.setColorAt(n, col.multiplyScalar(0.5));
      orderNodes.push(k);
      n++;
    }
    nodes.count = nodeHalo.count = n;
    for (const m of [nodes, nodeHalo]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; m.computeBoundingSphere(); }
  }
  function xrayFrame(dt) {
    const want = xray ? 1 : 0;
    if (xk === want) return;
    const was = xk;
    xk = want > xk ? Math.min(1, xk + dt / 0.35) : Math.max(0, xk - dt / 0.35);
    const e = xk * xk * (3 - 2 * xk);
    mesh.visible = glowMesh.visible = halo.visible = xk < 0.98;
    nodes.visible = nodeHalo.visible = links.visible = xk > 0.5;
    const t = Math.max(0, (e - 0.5) * 2);   // (the nodes and lines come up as the blocks finish shrinking)
    nodes.material.opacity = t;
    nodeHalo.material.uniforms.strength.value = 0.9 * t;
    linkMat.uniforms.strength.value = 0.5 * t;
    mesh.castShadow = xk < 0.5;
    if (was === 0 && xk > 0) buildNodes();
    rebuild();
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
  marks.traverse(o => { o.raycast = () => {}; });   // (the marks never get in the way of a click)
  scene.add(marks);
  function showMarks() {
    marks.visible = editing && !!sel;
    if (!sel) return;
    marks.position.set(sel.ix * TILE, 0, sel.iz * TILE);
    layer.visible = height > 0;
    layer.position.set(TILE / 2, BASE + (height - 0.5) * B, TILE / 2);
  }

  // ---------- The pop: a block squishes flat, then bursts into soft chunks that bounce on the cushions and fade ----------
  const chunkGeo = new RoundedBoxGeometry(B * 0.34, B * 0.34, B * 0.34, 2, B * 0.08);
  const chunks = new THREE.InstancedMesh(chunkGeo, softMat(), MAX_CHUNKS);
  chunks.count = 0; chunks.frustumCulled = false; chunks.castShadow = true;
  chunks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  chunks.raycast = () => {};
  chunks.setColorAt(0, col.set(1, 1, 1));   // (makes its color list)
  scene.add(chunks);
  const parts = [];
  const squishes = [];   // the squishing blocks: each its own little mesh for the moment before it pops
  const squishMat = new Map();   // (one material per stored number, made when first needed)
  function matFor(v) {
    if (!squishMat.has(v)) {
      const m = softMat(); tint(m.color, v);
      if (glowOf(v)) { m.emissive.copy(m.color).multiplyScalar(glowOf(v) * 0.8); m.transparent = true; m.opacity = 0.85; }
      squishMat.set(v, m);
    }
    return squishMat.get(v);
  }
  function burst(p, v, n = 14, size = 1, up = 1) {
    tint(col, v);
    if (glowOf(v)) col.multiplyScalar(1 + glowOf(v) * 0.6);   // (glowing chunks stay bright)
    for (let i = 0; i < n && parts.length < MAX_CHUNKS; i++) {
      const a = Math.random() * Math.PI * 2, out = 0.8 + Math.random() * 1.6;
      parts.push({ p: p.clone().add(new THREE.Vector3((Math.random() - 0.5) * B * 0.6, (Math.random() - 0.3) * B * 0.5, (Math.random() - 0.5) * B * 0.6)),
        v: new THREE.Vector3(Math.cos(a) * out * up, (1.6 + Math.random() * 2.2) * up, Math.sin(a) * out * up),
        r: new THREE.Euler(Math.random() * 6, Math.random() * 6, 0), spin: new THREE.Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, 0),
        s: (0.7 + Math.random() * 0.6) * size, life: 0, end: 1.1 + Math.random() * 0.5, c: col.clone().multiplyScalar(0.9 + Math.random() * 0.2) });
    }
  }
  function pop(k, v, quiet) {   // (a block going: a quick squish, then the burst)
    const m = new THREE.Mesh(geo, matFor(v));
    m.position.copy(spotOfKey(k));
    scene.add(m);
    squishes.push({ m, t: 0, v, y0: m.position.y });
    if (!quiet) { try { sfx.skeeThump(0.6); } catch (e) {} }
  }

  // ---------- The hammer: a toy mallet that swings down onto the block you click ----------
  const hammer = new THREE.Group(), arm = new THREE.Group();
  const L = 0.55;   // (the handle's length, the grip to the head)
  {
    const wood = new THREE.MeshStandardMaterial({ color: 0xb07a48, roughness: 0.55 });
    const head = softMat(); head.color.setHex(0xf08a72);
    const band = softMat(); band.color.setHex(0xf3ead2);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, L, 12), wood);
    handle.rotation.x = Math.PI / 2; handle.position.z = -L / 2;
    const top = new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.15, 0.3, 3, 0.05), head);
    top.rotation.y = Math.PI / 2; top.position.z = -L;
    for (const s of [-1, 1]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.079, 0.079, 0.03, 20), band); r.rotation.z = Math.PI / 2; r.position.set(s * 0.09, 0, -L); arm.add(r); }
    arm.add(handle, top);
  }
  hammer.add(arm);
  hammer.visible = false;
  hammer.traverse(o => { o.raycast = () => {}; });
  scene.add(hammer);
  let swing = null;   // { t, k, done }: the swing in progress, and the block it's coming down on
  const HEAD = 0.075;
  function hit(k) {   // (the moment the hammer lands: the block's gone, for everyone)
    const v = blocks[k];
    if (v == null) return;
    delete blocks[k]; rebuild();
    remove(ref(db, 'game/blocks/' + k)).catch(() => {});
    pop(k, v);
  }
  function smash(k) {
    if (swing && !swing.done) hit(swing.k);   // (a new swing before the last one landed: that one lands now)
    const p = spotOfKey(k), dir = new THREE.Vector3(camera.position.x - p.x, 0, camera.position.z - p.z);
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1);
    dir.normalize();
    hammer.position.set(p.x + dir.x * L, p.y + B / 2 + HEAD, p.z + dir.z * L);
    hammer.rotation.set(0, Math.atan2(dir.x, dir.z), 0);
    hammer.scale.setScalar(1);
    hammer.visible = true;
    swing = { t: 0, k, done: false };
  }
  function swingFrame(dt) {
    if (!swing) return;
    swing.t += dt;
    const t = swing.t;
    let a;
    if (t < 0.1) a = 0.9 + (t / 0.1) * 0.6;                               // (lifting up)
    else if (t < 0.19) { const e = (t - 0.1) / 0.09; a = 1.5 * (1 - e * e); }   // (and down, faster and faster)
    else a = Math.max(0, 0.18 * Math.sin((t - 0.19) * 30) * Math.exp(-(t - 0.19) * 12));   // (a little bounce off it)
    if (t >= 0.19 && !swing.done) { swing.done = true; hit(swing.k); }
    arm.rotation.x = a;
    if (t > 0.45) hammer.scale.setScalar(Math.max(0.001, 1 - (t - 0.45) / 0.15));
    if (t > 0.6) { hammer.visible = false; swing = null; }
  }

  // ---------- Painting: the block clicked takes the tray's color and shade ----------
  function paint(k) {
    const v = valueOf(color, shade);
    if (blocks[k] == null || blocks[k] === v) return;
    blocks[k] = v; rebuild();
    set(ref(db, 'game/blocks/' + k), v).catch(() => {});
    const p = spotOfKey(k); p.y += B * 0.45;
    burst(p, v, 9, 0.35, 0.55);   // (a little splash of paint drops)
    try { sfx.flip(); } catch (e) {}
  }

  // ---------- Placing (never taking away: that's the hammer's job) ----------
  const PAD = { Numpad7: [0, 0], Numpad8: [1, 0], Numpad9: [2, 0], Numpad4: [0, 1], Numpad5: [1, 1], Numpad6: [2, 1], Numpad1: [0, 2], Numpad2: [1, 2], Numpad3: [2, 2] };
  let yawNow = 0;
  function spotFor(code) {   // (the numpad turned to match the way you're facing, so 8 is always the far middle)
    let [a, b] = PAD[code];
    const turns = ((Math.round(-yawNow / (Math.PI / 2)) % 4) + 4) % 4;
    for (let i = 0; i < turns; i++) [a, b] = [2 - b, a];
    return [a, b];
  }
  const top = (u, v) => { for (let l = MAX - 1; l >= 0; l--) if (blocks[keyAt(sel.ix, sel.iz, u, v, l)] != null) return l; return -1; };
  function put(k) { const v = valueOf(color, shade); blocks[k] = v; rebuild(); set(ref(db, 'game/blocks/' + k), v).catch(() => {}); }
  function build(code) {
    if (!sel) return;
    const [u, v] = spotFor(code);
    let l;
    if (height === 0) l = top(u, v) + 1;   // (Auto: on top of what's there)
    else for (l = height - 1; l < MAX && blocks[keyAt(sel.ix, sel.iz, u, v, l)] != null; l++);   // (that height, or the first free spot above it)
    if (l >= MAX) return;
    put(keyAt(sel.ix, sel.iz, u, v, l));
  }
  // T: the test wall: the picked square and the one to its right, each color its own column (eight spots each),
  // Dark at the bottom, then Normal, Bright, Glow and Glowing on top
  function testWall() {
    if (!sel) return;
    const add = {};
    let c = 0;
    for (const dx of [0, 1]) {
      const ix = sel.ix + dx;
      if (ix > IX1) break;
      for (let v = 0; v < 3; v++) for (let u = 0; u < 3; u++) {
        if (u === 1 && v === 1) continue;   // (the middle spot left open)
        SHADES.forEach((_, s) => { const k = keyAt(ix, sel.iz, u, v, s); add[k] = valueOf(c, s); blocks[k] = add[k]; });
        c++;
      }
    }
    rebuild();
    update(ref(db, 'game/blocks'), add).catch(() => {});
  }

  // ---------- R: clear the whole room, once you say you're sure ----------
  const ask = document.createElement('div');
  ask.id = 'clearAsk';
  ask.innerHTML = '<div class="q">This will clear the whole room.<br>Are you sure?</div><div class="row"><button class="h yes">Clear it</button><button class="h no">Keep building</button></div>';
  function clearAll() {
    const gone = {};
    for (const k of Object.keys(blocks)) gone[k] = null;
    blocks = {}; rebuild();
    if (Object.keys(gone).length) update(ref(db, 'game/blocks'), gone).catch(() => {});
  }
  const askOpen = () => ask.classList.contains('up');
  function closeAsk() { ask.classList.remove('up'); }
  ask.querySelector('.yes').addEventListener('click', e => { e.currentTarget.blur(); closeAsk(); clearAll(); });
  ask.querySelector('.no').addEventListener('click', e => { e.currentTarget.blur(); closeAsk(); });

  // ---------- The tray along the bottom, the build button, the hammer and the x-ray ----------
  const css = document.createElement('style');
  css.textContent = `
    #buildBtn { left: 16px; bottom: 68px; font-size: 20px; }
    #buildBtn.on, #paintBtn.on, #hammerBtn.on, #xrayBtn.on { background: rgba(233,201,143,0.92); color: #2a1c10; }
    #paintBtn { left: 16px; bottom: 120px; font-size: 20px; display: none; }
    #hammerBtn { left: 16px; bottom: 172px; font-size: 20px; display: none; }
    #xrayBtn { left: 16px; bottom: 224px; font-size: 20px; display: none; }
    #buildTray { position: fixed; left: 50%; bottom: 14px; z-index: 12; transform: translate(-50%, 160%); transition: transform 0.35s cubic-bezier(.2,1.3,.4,1);
      display: flex; flex-direction: column; align-items: center; gap: 7px; padding: 10px 14px; border-radius: 16px; max-width: calc(100vw - 130px);
      background: rgba(20,16,12,0.82); box-shadow: 0 4px 16px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(201,162,39,0.6); }
    #buildTray.up { transform: translate(-50%, 0); }
    #buildTray .row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; justify-content: center; }
    #buildTray .sw { width: 30px; height: 30px; border-radius: 8px; border: 2px solid rgba(0,0,0,0.35); cursor: pointer; padding: 0;
      box-shadow: inset 0 -5px 8px rgba(0,0,0,0.2), inset 0 4px 6px rgba(255,255,255,0.35); transition: transform 0.12s; }
    #buildTray .sw.on { transform: translateY(-3px) scale(1.12); outline: 3px solid #ffd36a; outline-offset: 2px; }
    #buildTray .h { min-width: 28px; height: 26px; border-radius: 8px; border: none; cursor: pointer; font: 600 13px inherit; padding: 0 7px;
      color: #f3e6cf; background: rgba(255,255,255,0.08); box-shadow: inset 0 0 0 1px rgba(201,162,39,0.45); }
    #buildTray .h.on { background: rgba(233,201,143,0.92); color: #2a1c10; }
    #buildTray .lbl { color: #f3e6cf; opacity: 0.7; font-size: 13px; margin-right: 2px; }
    #clearAsk { position: fixed; left: 50%; top: 50%; z-index: 20; transform: translate(-50%, -50%) scale(0.9); opacity: 0; pointer-events: none;
      transition: opacity 0.2s, transform 0.2s; display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 18px 22px;
      border-radius: 16px; background: rgba(20,16,12,0.92); box-shadow: 0 6px 24px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(201,162,39,0.7); }
    #clearAsk.up { opacity: 1; pointer-events: auto; transform: translate(-50%, -50%) scale(1); }
    #clearAsk .q { color: #f3e6cf; font-size: 17px; text-align: center; line-height: 1.4; }
    #clearAsk .row { display: flex; gap: 10px; }
    #clearAsk .h { height: 34px; border-radius: 9px; border: none; cursor: pointer; font: 600 15px inherit; padding: 0 14px;
      color: #f3e6cf; background: rgba(255,255,255,0.08); box-shadow: inset 0 0 0 1px rgba(201,162,39,0.45); }
    #clearAsk .yes { background: rgba(233,201,143,0.92); color: #2a1c10; }`;
  document.head.appendChild(css);
  const corner = (id, title, icon) => {
    const b = document.createElement('button');
    b.id = id; b.className = 'corner'; b.title = title; b.textContent = icon;
    document.body.appendChild(b);
    return b;
  };
  const btn = corner('buildBtn', 'Build', '🧱');
  const paintBtn = corner('paintBtn', 'Paint (P)', '🖌');
  const hammerBtn = corner('hammerBtn', 'Hammer (H)', '🔨');
  const xrayBtn = corner('xrayBtn', 'X-ray (X)', '👁');
  const tray = document.createElement('div');
  tray.id = 'buildTray';
  const colorRows = [document.createElement('div'), document.createElement('div')];
  for (const r of colorRows) r.className = 'row';
  const shadeRow = document.createElement('div'); shadeRow.className = 'row';
  shadeRow.innerHTML = '<span class="lbl">Shade</span>';
  const heightRow = document.createElement('div'); heightRow.className = 'row';
  heightRow.innerHTML = '<span class="lbl">Height</span>';
  const swatches = COLORS.map(([name], i) => {
    const b = document.createElement('button');
    b.className = 'sw'; b.title = name;
    b.addEventListener('click', () => { b.blur(); color = i; refreshTray(); });
    colorRows[i < 8 ? 0 : 1].appendChild(b);
    return b;
  });
  const shades = SHADES.map(([name], i) => {
    const b = document.createElement('button');
    b.className = 'h'; b.textContent = name;
    b.addEventListener('click', () => { b.blur(); shade = i; refreshTray(); });
    shadeRow.appendChild(b);
    return b;
  });
  const heights = Array.from({ length: MAX + 1 }, (_, i) => {
    const b = document.createElement('button');
    b.className = 'h'; b.textContent = i === 0 ? 'Auto' : String(i);
    b.addEventListener('click', () => { b.blur(); height = i; refreshTray(); showMarks(); });
    heightRow.appendChild(b);
    return b;
  });
  tray.append(...colorRows, shadeRow, heightRow);
  document.body.appendChild(tray);
  document.body.appendChild(ask);
  const css3 = c => `rgb(${Math.min(255, Math.round(c.r * 255))},${Math.min(255, Math.round(c.g * 255))},${Math.min(255, Math.round(c.b * 255))})`;
  function refreshTray() {
    swatches.forEach((b, i) => {   // (the swatches show the colors in the shade you've got, the glows with a halo)
      const c = tint(new THREE.Color(), valueOf(i, shade)).convertLinearToSRGB();
      b.style.background = css3(c);
      b.style.filter = shade >= 3 ? `drop-shadow(0 0 ${shade === 4 ? 9 : 5}px ${css3(c)})` : '';
      b.classList.toggle('on', i === color);
    });
    shades.forEach((b, i) => b.classList.toggle('on', i === shade));
    heights.forEach((b, i) => b.classList.toggle('on', i === height));
  }
  refreshTray();
  function setHammer(on) { hammerOn = on; if (on) paintOn = false; hammerBtn.classList.toggle('on', hammerOn); paintBtn.classList.toggle('on', paintOn); }
  function setPaint(on) { paintOn = on; if (on) hammerOn = false; hammerBtn.classList.toggle('on', hammerOn); paintBtn.classList.toggle('on', paintOn); }
  function setXray(on) { xray = on; xrayBtn.classList.toggle('on', xray); }
  hammerBtn.addEventListener('click', () => { hammerBtn.blur(); setHammer(!hammerOn); });
  paintBtn.addEventListener('click', () => { paintBtn.blur(); setPaint(!paintOn); });
  xrayBtn.addEventListener('click', () => { xrayBtn.blur(); setXray(!xray); });

  // ---------- Edit mode: floating ----------
  const pos = new THREE.Vector3();
  function toggle() {
    editing = !editing;
    btn.classList.toggle('on', editing);
    tray.classList.toggle('up', editing);
    paintBtn.style.display = hammerBtn.style.display = xrayBtn.style.display = editing ? 'block' : 'none';
    if (editing) pos.copy(camera.position);
    else { closeAsk(); setHammer(false); setPaint(false); setXray(false); }
    showMarks();
    if (onEdit) onEdit(editing, pos);
  }
  btn.addEventListener('click', () => { btn.blur(); toggle(); });

  const wrap = (x, n) => ((x % n) + n) % n;
  return {
    get editing() { return editing; },
    get cursor() { return !editing ? null : hammerOn ? HAMMER_CURSOR : paintOn ? BRUSH_CURSOR : null; },
    toggle,
    start() {
      onValue(ref(db, 'game/blocks'), s => {
        const next = s.val() || {};
        const gone = Object.keys(blocks).filter(k => next[k] == null);
        if (gone.length <= 30) for (const k of gone) pop(k, blocks[k], true);   // (someone else's: it pops for you too; a whole clear just goes)
        blocks = next; rebuild();
      });
    },
    onKey(e) {   // (the numpad builds while in edit mode, and the keys for the tray, the hammer, the x-ray, the clear, the test)
      if (!editing) return false;
      if (askOpen()) {   // (the question is up: Enter says yes, Esc no, everything else waits)
        if (e.type === 'keydown') { if (e.key === 'Enter') { closeAsk(); clearAll(); } else if (e.key === 'Escape') closeAsk(); }
        e.preventDefault(); return true;
      }
      if (e.type !== 'keydown') return false;
      if (PAD[e.code]) { e.preventDefault(); if (!e.repeat) build(e.code); return true; }
      if (e.code === 'NumpadMultiply' || e.code === 'NumpadDivide') { e.preventDefault(); color = wrap(color + (e.code === 'NumpadMultiply' ? 1 : -1), COLORS.length); refreshTray(); return true; }
      if (e.code === 'NumpadAdd' || e.code === 'NumpadSubtract') { e.preventDefault(); shade = Math.max(0, Math.min(SHADES.length - 1, shade + (e.code === 'NumpadAdd' ? 1 : -1))); refreshTray(); return true; }
      if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); height = wrap(height + (e.key === 'PageUp' ? 1 : -1), MAX + 1); refreshTray(); showMarks(); return true; }
      if (e.repeat) return false;
      const k = e.key.toLowerCase();
      if (k === 'h') { setHammer(!hammerOn); return true; }
      if (k === 'p') { setPaint(!paintOn); return true; }
      if (k === 'x') { setXray(!xray); return true; }
      if (k === 'r') { ask.classList.add('up'); return true; }
      if (k === 't') { testWall(); return true; }
      return false;
    },
    pick(hits) {   // (a click: with the hammer, the block under the pointer gets smashed; otherwise that square's picked)
      if (xray) {   // (x-ray: a click on an orb picks up its color and shade, ready to build or paint with)
        const o = hits.find(x => x.object === nodeHalo && x.instanceId != null && orderNodes[x.instanceId]);
        if (o) {
          [color, shade] = decode(blocks[orderNodes[o.instanceId]]);
          refreshTray();
          try { sfx.ping(); } catch (e) {}
          return;
        }
      }
      const h = hits.find(x => x.object === mesh || x.object === glowMesh || x.object.userData.floor);
      if (!h) return;
      if (hammerOn || paintOn) {
        const k = h.instanceId == null ? null : h.object === mesh ? order[h.instanceId] : h.object === glowMesh ? orderGlow[h.instanceId] : null;
        if (k) { if (hammerOn) smash(k); else paint(k); }
        return;
      }
      const p = h.point.clone();
      if ((h.object === mesh || h.object === glowMesh) && h.face) p.addScaledVector(h.face.normal, -0.02);   // (just inside the block that was clicked)
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
    },
    update(dt) {   // (every frame: the hammer swinging, the x-ray, blocks squishing, chunks bouncing)
      swingFrame(dt);
      xrayFrame(dt);
      for (let i = squishes.length - 1; i >= 0; i--) {
        const s = squishes[i];
        s.t += dt;
        const e = Math.min(s.t / 0.09, 1);
        s.m.scale.set(1 + 0.3 * e, 1 - 0.62 * e, 1 + 0.3 * e);
        s.m.position.y = s.y0 - B * 0.31 * e;   // (it squishes down onto where it sat)
        if (e >= 1) { scene.remove(s.m); burst(s.m.position, s.v); squishes.splice(i, 1); }
      }
      let n = 0;
      for (let i = parts.length - 1; i >= 0; i--) {
        const c = parts[i];
        c.life += dt;
        if (c.life >= c.end) { parts.splice(i, 1); continue; }
        c.v.y -= 9.8 * dt;
        c.p.addScaledVector(c.v, dt);
        const floorY = 0.1 + B * 0.17 * c.s;
        if (c.p.y < floorY) { c.p.y = floorY; c.v.y = Math.abs(c.v.y) * 0.38; c.v.x *= 0.7; c.v.z *= 0.7; c.spin.multiplyScalar(0.6); }
        c.r.x += c.spin.x * dt; c.r.y += c.spin.y * dt;
        const k = c.s * Math.min(1, (c.end - c.life) / 0.35);
        q.setFromEuler(c.r); sc.setScalar(Math.max(0.001, k));
        chunks.setMatrixAt(n, m4.compose(c.p, q, sc));
        chunks.setColorAt(n, c.c);
        n++;
      }
      chunks.count = n;
      chunks.instanceMatrix.needsUpdate = true;
      if (chunks.instanceColor) chunks.instanceColor.needsUpdate = true;
    }
  };
}
// >>>>> END OF FILE: HangoutRoom/game/blocks.js <<<<<
