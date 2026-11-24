// =====================================================================================================================
// >>>>> START OF FILE: HangoutRoom/pieces/summon.js <<<<<
// Summoning a game from the circle in the middle of the marble table.
//   1  click the circle: its burning ring flares and a shimmer runs once round it; a soft column of gold light rises
//      out of the portal, and up out of it come three of the Workshop's checkers (crimson, violet, crimson), floating
//      together in a slow turning cluster over the table, with "Checkers" glowing above them in gold letters
//   2  click the pieces or the word: the pieces burst into sparks, a cloud of glowing motes streams up out of the
//      portal and settles flat over the table into the shape of a board, first a white glowing silhouette, which fades
//      into the real marble checkerboard (nearly to the corner jewels); then the game's checkers grow up onto it
//   3  click the circle again (with the pieces floating), or press Esc: they sink back into the portal.
//      Esc with the board out: it fades back to white, breaks into motes, and they pour back down into the portal.
//   makeSummon({ top, glowLayer, onChoose, onBoard })   top: the table top's height (the circle at x = 0, z = 0);
//                                  onChoose(): you chose the game; onBoard(on): the board has arrived, or is leaving
//     .group                          add it to the scene
//     .circleClicked()  .choose()  .back()   what clicks and Esc do;  .buildNow() / .dismiss(): someone else did
//     .CELL, .TOP                     one square across, and the squares' top above the table
//     .update(dt)                     every frame
//     .state                          'idle', 'menu', 'board' (or 'busy' while something is happening)
// Anything clickable in it carries userData.summonPick.
// =====================================================================================================================
import * as THREE from 'three';
import { makeChecker } from '../checkers/checker.js';
import { makeCheckerboard, SQUARES_TOP } from '../checkers/checkerboard.js';

const BOARD = 1.15;                   // the checkerboard across: nearly to the table's corner jewels (the table is 1.4)
const RING_R = 0.4 * 0.912;           // the circle's burning ring (its ridge)
const PORTAL_R = 0.17;                // the portal's well, where things come up out of
const FLOAT_Y = 0.36;                 // how high the floating pieces hang over the table
const MOTES = 2600;                   // the motes that build the board
const ease = k => { k = Math.min(1, Math.max(0, k)); return k * k * (3 - 2 * k); };

function glowTexture() {   // (a soft round dot)
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,0.55)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
function wordSprite(text) {   // ("Checkers" in glowing gold)
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const g = c.getContext('2d');
  g.font = 'italic 128px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = 'rgba(255,190,90,0.95)'; g.shadowBlur = 40; g.fillStyle = '#ffe3a0';
  g.fillText(text, 512, 132); g.shadowBlur = 14; g.fillText(text, 512, 132);
  g.shadowBlur = 0; g.fillStyle = '#fff6dc'; g.fillText(text, 512, 132);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, toneMapped: false, opacity: 0 }));
  s.scale.set(0.42, 0.105, 1);
  return s;
}

export function makeSummon({ top = 0.85, glowLayer = 1, onChoose = () => {}, onBoard = () => {} } = {}) {
  const group = new THREE.Group();
  group.position.y = top;
  const dot = glowTexture();
  let state = 'idle', t = 0, phase = null, pt = 0;   // (pt: seconds into the current change)

  // ---------- the shimmer round the ring: a bright arc running once round, and the whole ring flaring ----------
  const shimmer = new THREE.Mesh(new THREE.RingGeometry(RING_R - 0.035, RING_R + 0.035, 128, 1).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({
      uniforms: { sweep: { value: -1 }, flare: { value: 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
      vertexShader: 'varying vec3 vP; void main() { vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float sweep, flare; varying vec3 vP;
        void main() {
          float a = atan(vP.z, vP.x) / 6.2831853 + 0.5, r = length(vP.xz);
          float across = 1.0 - abs(r - ${RING_R.toFixed(4)}) / 0.035;
          float d = abs(fract(a - sweep + 0.5) - 0.5);
          float arc = sweep < 0.0 || sweep > 1.0 ? 0.0 : exp(-d * d / 0.003) * (1.0 - smoothstep(0.85, 1.0, sweep));
          float k = (arc * 2.2 + flare) * pow(max(across, 0.0), 1.6);
          gl_FragColor = vec4(vec3(1.0, 0.82, 0.48) * k, 1.0);
        }`
    }));
  shimmer.position.y = 0.003;
  group.add(shimmer);

  // ---------- the column of light out of the portal ----------
  const column = new THREE.Mesh(new THREE.CylinderGeometry(PORTAL_R * 0.9, PORTAL_R, 0.7, 48, 1, true).translate(0, 0.35, 0),
    new THREE.ShaderMaterial({
      uniforms: { k: { value: 0 }, time: { value: 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
      vertexShader: 'varying vec2 vU; void main() { vU = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float k, time; varying vec2 vU;
        void main() {
          float up = vU.y, rays = 0.6 + 0.4 * sin(vU.x * 60.0 + time * 1.5) * sin(vU.x * 23.0 - time * 0.9 + up * 4.0);
          float a = pow(1.0 - up, 2.2) * rays * k * 0.55;
          gl_FragColor = vec4(vec3(1.0, 0.8, 0.45) * a, 1.0);
        }`
    }));
  column.visible = false;
  group.add(column);

  // ---------- the floating pieces and the word ----------
  const cluster = new THREE.Group();
  cluster.visible = false;
  group.add(cluster);
  const floaters = ['crimson', 'violet', 'crimson'].map((gem, i) => {
    const c = makeChecker(THREE, { glowLayer }, { size: 0.085, stone: 'onyx', gem, light: false });
    const holder = new THREE.Group();
    holder.add(c.group);
    cluster.add(holder);
    return { c, holder, a: i / 3 * Math.PI * 2, tilt: 0.35 + 0.15 * i };
  });
  const word = wordSprite('Checkers');
  cluster.add(word);
  const pickBall = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), new THREE.MeshBasicMaterial({ visible: false }));   // (an easy target to click)
  cluster.add(pickBall);
  cluster.traverse(o => { o.userData.summonPick = true; });

  // ---------- the board, its silhouette, the motes, and the pieces on it ----------
  const board = new THREE.Group();
  board.visible = false;
  group.add(board);
  const loader = new THREE.TextureLoader();
  const built = makeCheckerboard(THREE, { loader, folder: new URL('../checkers/textures/checker/', import.meta.url).href, size: BOARD });
  board.add(built.group);
  built.group.traverse(o => { o.userData.boardPick = true; });   // (a click anywhere on the board counts as the board)
  const boardMats = built.materials;
  const silhouette = new THREE.Mesh(new THREE.BoxGeometry(BOARD, SQUARES_TOP + 0.004, BOARD).translate(0, (SQUARES_TOP + 0.004) / 2, 0),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.5, 1.35), transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
  silhouette.visible = false;
  group.add(silhouette);

  const motesGeo = new THREE.BufferGeometry();
  const mPos = new Float32Array(MOTES * 3), from = new Float32Array(MOTES * 3), to = new Float32Array(MOTES * 3), delay = new Float32Array(MOTES);
  for (let i = 0; i < MOTES; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * PORTAL_R * 0.9;
    from.set([Math.cos(a) * r, -0.02, Math.sin(a) * r], i * 3);
    const onEdge = Math.random() < 0.3;   // (some settle along the board's edges, so its outline shows first)
    let x = (Math.random() - 0.5) * BOARD, z = (Math.random() - 0.5) * BOARD;
    if (onEdge) { if (Math.random() < 0.5) x = Math.sign(x) * BOARD / 2; else z = Math.sign(z) * BOARD / 2; }
    to.set([x, SQUARES_TOP + 0.006, z], i * 3);
    delay[i] = Math.random() * 0.55;
  }
  motesGeo.setAttribute('position', new THREE.BufferAttribute(mPos, 3));
  const motes = new THREE.Points(motesGeo, new THREE.PointsMaterial({ map: dot, size: 0.016, color: new THREE.Color(1.4, 1.2, 0.9),
    transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  motes.frustumCulled = false; motes.visible = false;
  group.add(motes);
  function placeMotes(k, reverse) {   // (k: 0 at the portal .. 1 settled on the board; each mote a little behind or ahead)
    for (let i = 0; i < MOTES; i++) {
      const e = ease((k * 1.55 - delay[i]) / 1.0), f = reverse ? 1 - e : e;
      const fx = from[i * 3], fz = from[i * 3 + 2], tx = to[i * 3], tz = to[i * 3 + 2], ty = to[i * 3 + 1];
      const lift = Math.sin(Math.PI * f) * (0.32 + delay[i] * 0.4);   // (up in an arc out of the portal, and down onto the board)
      const swirl = (1 - f) * 2.2 + delay[i] * 3;
      const sx = fx * Math.cos(swirl) - fz * Math.sin(swirl), sz = fx * Math.sin(swirl) + fz * Math.cos(swirl);
      mPos[i * 3] = sx + (tx - sx) * f; mPos[i * 3 + 1] = -0.02 + (ty + 0.02) * f + lift; mPos[i * 3 + 2] = sz + (tz - sz) * f;
    }
    motesGeo.attributes.position.needsUpdate = true;
  }

  // (the pieces on it are the game's: checkers.js sets them out once the board is here)
  const PLAY = (BOARD / 2 - 0.0254) / (0.5 + 0.151), SQ = PLAY / 8;

  function fadeBoard(o) {
    for (const m of boardMats) { m.transparent = o < 0.999; m.opacity = o; m.depthWrite = o > 0.5; m.needsUpdate = true; }
  }

  // ---------- what happens ----------
  function go(p) { phase = p; pt = 0; }
  function circleClicked() {
    if (state === 'idle') { state = 'busy'; go('rise'); }
    else if (state === 'menu') { state = 'busy'; go('sink'); }
  }
  function choose() { if (state === 'menu') { state = 'busy'; go('build'); onChoose(); } }
  function buildNow() { if (state === 'idle' || state === 'menu') { cluster.visible = state === 'menu'; state = 'busy'; go('build'); } }   // (someone else summoned it)
  function dismiss() { if (state === 'board') { state = 'busy'; go('unbuild'); } }
  function back() {
    if (state === 'menu') { state = 'busy'; go('sink'); }
    else if (state === 'board') { state = 'busy'; go('unbuild'); }
  }

  function update(dt) {
    t += dt; pt += dt;
    column.material.uniforms.time.value = t;
    // the floating cluster turns slowly, each piece bobbing and tipping on its own
    floaters.forEach((f, i) => {
      const a = f.a + t * 0.45;
      f.holder.position.set(Math.cos(a) * 0.085, 0.02 * Math.sin(t * 1.3 + i * 2.1), Math.sin(a) * 0.085);
      f.holder.rotation.set(f.tilt * Math.sin(t * 0.7 + i), t * 0.6 + i, f.tilt * 0.6 * Math.cos(t * 0.5 + i * 1.7));
      f.c.update(t);
    });
    word.position.set(0, 0.16 + 0.008 * Math.sin(t * 1.1), 0);
    const u = shimmer.material.uniforms;
    u.flare.value *= Math.exp(-dt * 1.6);

    if (phase === 'rise') {   // the ring flares, the light rises, the pieces come up out of the portal
      u.sweep.value = pt / 1.1; if (pt < 0.05) u.flare.value = 1.2;
      column.visible = true; column.material.uniforms.k.value = ease(pt / 0.6);
      cluster.visible = true;
      const k = ease((pt - 0.35) / 1.1);
      cluster.position.y = -0.1 + (FLOAT_Y + 0.1) * k;
      cluster.scale.setScalar(Math.max(0.001, k));
      word.material.opacity = ease((pt - 1.1) / 0.6);
      if (pt > 1.8) { phase = null; state = 'menu'; u.sweep.value = -1; }
    } else if (phase === 'sink') {   // back down into the portal
      const k = 1 - ease(pt / 0.9);
      cluster.position.y = -0.1 + (FLOAT_Y + 0.1) * k;
      cluster.scale.setScalar(Math.max(0.001, k));
      word.material.opacity = k;
      column.material.uniforms.k.value = k;
      if (pt > 0.95) { cluster.visible = false; column.visible = false; phase = null; state = 'idle'; }
    } else if (phase === 'build') {   // the pieces burst; motes stream up and settle into the board, white, then marble
      u.sweep.value = pt / 1.0; if (pt < 0.05) u.flare.value = 1.4;
      const k0 = 1 - ease(pt / 0.35);
      cluster.scale.setScalar(Math.max(0.001, 1 + (1 - k0) * 0.5)); word.material.opacity = k0;
      floaters.forEach(f => f.c.setHeat(1 - k0));
      if (pt > 0.35) cluster.visible = false;
      column.material.uniforms.k.value = 1 - ease((pt - 1.4) / 0.8);
      motes.visible = pt > 0.15 && pt < 3.2;
      motes.material.opacity = ease((pt - 0.15) / 0.3) * (1 - ease((pt - 2.4) / 0.7));
      placeMotes((pt - 0.15) / 1.7, false);
      silhouette.visible = pt > 1.2 && pt < 3.4;
      silhouette.material.opacity = 0.9 * ease((pt - 1.2) / 0.6) * (1 - ease((pt - 2.2) / 1.0));
      if (pt > 1.9 && !board.visible) { board.visible = true; fadeBoard(0); }
      if (board.visible) fadeBoard(ease((pt - 1.9) / 1.0));
      if (pt > 4.2) {
        floaters.forEach(f => f.c.setHeat(0)); cluster.scale.setScalar(1);
        column.visible = false; motes.visible = false; silhouette.visible = false; fadeBoard(1);
        phase = null; state = 'board'; u.sweep.value = -1; onBoard(true);
      }
    } else if (phase === 'unbuild') {   // the board goes white, breaks into motes, and they pour back into the portal
      if (pt < 0.05) u.flare.value = 1.0;
      if (pt < 0.05) onBoard(false);
      silhouette.visible = pt < 1.6;
      silhouette.material.opacity = 0.9 * ease(pt / 0.4) * (1 - ease((pt - 0.6) / 0.8));
      fadeBoard(1 - ease(pt / 0.5)); if (pt > 0.5) board.visible = false;
      column.visible = true; column.material.uniforms.k.value = ease((pt - 0.4) / 0.4) * (1 - ease((pt - 2.0) / 0.6));
      motes.visible = pt > 0.4 && pt < 2.6;
      motes.material.opacity = ease((pt - 0.4) / 0.3) * (1 - ease((pt - 2.0) / 0.5));
      placeMotes((pt - 0.5) / 1.6, true);
      if (pt > 2.7) { column.visible = false; motes.visible = false; silhouette.visible = false; phase = null; state = 'idle'; }
    }
  }

  return { group, update, circleClicked, choose, back, buildNow, dismiss, CELL: SQ, TOP: SQUARES_TOP, get state() { return state; } };
}
// >>>>> END OF FILE: HangoutRoom/pieces/summon.js <<<<<
