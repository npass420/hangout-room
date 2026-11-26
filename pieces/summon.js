// =====================================================================================================================
// >>>>> START OF FILE: HangoutRoom/pieces/summon.js <<<<<
// Summoning a game from the circle in the middle of the marble table.
//   1  click the circle: its burning ring flares and a shimmer runs once round it; a soft column of gold light rises
//      out of the portal, and up out of it come the games, side by side right above the circle, each turning slowly
//      with its name glowing above it in gold: Checkers (one crimson checker and one violet) and Othello (one disc
//      white side up and one black side up)
//   2  click a game: its pieces burst into sparks, a stream of gold star dust swirls up out of the portal and showers
//      down over the table, and that game's board forms out of it from the middle outward, a band of glittering gold
//      running at its forming edge: the marble checkerboard (its gold rim lines lighting last, and its own soft
//      lights: a warm key from above and a cool edge light from low across it), or the crystal and gold Othello
//      board (pieces/othelloboard.js). (The pieces only come onto it in the game itself: checkers.js, othello.js.)
//   3  click the circle again (with the pieces floating), or press Esc: they sink back into the portal.
//      Esc with the board out: it dissolves from its corners inward into gold dust, which pours back into the portal.
//   makeSummon({ top, glowLayer, onChoose, onBoard, renderer })   top: the table top's height (the circle at x = 0, z = 0);
//                                  renderer: for the board's soft reflections;
//                                  onChoose(game): you chose a game ('checkers' or 'othello'); onBoard(on): the board has arrived, or is leaving
//     .group                          add it to the scene
//     .circleClicked()  .choose(game)  .back()   what clicks and Esc do;  .buildNow(game) / .dismiss(): someone else did
//     .game                           the game whose board is out (or forming): 'checkers' or 'othello'
//     .board                          the Othello board (its flood() and restore() for a game's end)
//     .CELL, .TOP                     one square across, and the squares' top above the table (the game's board)
//     .cellOf(game), .topOf(game)     the same for either game
//     .update(dt)                     every frame
//     .state                          'idle', 'menu', 'board' (or 'busy' while something is happening)
// Anything clickable in it carries userData.summonPick: the game it picks.
// =====================================================================================================================
import * as THREE from 'three';
import { makeChecker } from '../checkers/checker.js';
import { makeCheckerboard, SQUARES_TOP, LIFT } from '../checkers/checkerboard.js';
import { softEnv } from '../checkers/pieceenv.js';
import { makeOthelloDisc } from './othellodisc.js';
import { makeOthelloBoard } from './othelloboard.js';

const BOARD = 1.15;                   // the checkerboard across: nearly to the table's corner jewels (the table is 1.4)
const RING_R = 0.4 * 0.912;           // the circle's burning ring (its ridge)
const PORTAL_R = 0.17;                // the portal's well, where things come up out of
const FLOAT_Y = 0.36;                 // how high the floating pieces hang over the table
const MOTES = 2600;                   // the motes that build the board
const CHOICE_X = 0.15;                // the two games, either side of the circle's middle
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
  s.scale.set(0.3, 0.075, 1);
  return s;
}

export function makeSummon({ top = 0.85, glowLayer = 1, onChoose = () => {}, onBoard = () => {}, renderer = null } = {}) {
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

  // ---------- the two games floating over the circle, each with its name ----------
  const cluster = new THREE.Group();
  cluster.visible = false;
  group.add(cluster);
  const env0 = renderer ? softEnv(renderer) : null;
  function choice(game, x, name, pieces) {   // (one game: its two pieces circling slowly side by side, its name above)
    const g = new THREE.Group(); g.position.x = x; cluster.add(g);
    const holders = pieces.map((p, i) => { const h = new THREE.Group(); h.add(p.group); g.add(h); return { h, p, i }; });
    const w = wordSprite(name); g.add(w);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), new THREE.MeshBasicMaterial({ visible: false }));   // (an easy target to click)
    g.add(ball);
    g.traverse(o => { o.userData.summonPick = game; });
    return { g, holders, word: w };
  }
  const checkersChoice = choice('checkers', -CHOICE_X, 'Checkers', ['crimson', 'violet'].map(gem => {
    const c = makeChecker(THREE, { glowLayer }, { size: 0.085, stone: 'onyx', gem, light: false });
    return { group: c.group, update: t => c.update(t), heat: k => c.setHeat(k) };
  }));
  const othelloChoice = choice('othello', CHOICE_X, 'Othello', [true, false].map(white => {
    const d = makeOthelloDisc({ cell: 0.1, white });
    if (env0) for (const m of d.materials) m.envMap = env0;
    const holder = new THREE.Group(); holder.add(d.group); d.group.position.y = -0.008;   // (turning about its middle)
    return { group: holder, update: t => d.update(t), heat: () => {} };
  }));
  const choices = [checkersChoice, othelloChoice];
  const words = choices.map(c => c.word);
  const floaters = choices.flatMap(c => c.holders.map(h => h.p));

  // ---------- the board, its silhouette, the motes, and the pieces on it ----------
  const board = new THREE.Group();
  board.visible = false;
  group.add(board);
  const loader = new THREE.TextureLoader();
  const built = makeCheckerboard(THREE, { loader, folder: new URL('../checkers/textures/checker/', import.meta.url).href, size: BOARD });
  board.add(built.group);
  built.group.traverse(o => { o.userData.boardPick = true; });   // (a click anywhere on the board counts as the board)
  const boardMats = built.materials;
  // the Othello board (the Workshop's crystal and gold board): its lit materials form the same way; anything else on
  // it (its glows and gold decals) shows once it's whole
  const othello = makeOthelloBoard({ size: BOARD });
  othello.group.visible = false;
  board.add(othello.group);
  othello.group.traverse(o => { o.userData.boardPick = true; });
  const othelloLate = [];
  othello.group.traverse(o => { if (o.material && !o.material.isMeshStandardMaterial) othelloLate.push(o); });
  let game = 'checkers', picked = 'checkers';
  const showGame = g => { game = g; built.group.visible = g === 'checkers'; othello.group.visible = g === 'othello'; };
  // its forming: everything past the forming edge (a circle growing from the middle) isn't there yet; a band of gold
  // glitter burns at the edge itself
  const REVEAL_MAX = BOARD * 0.76;   // (past the corners)
  const RU = { uReveal: { value: 0 }, uTime: { value: 0 } };
  const env = renderer ? softEnv(renderer) : null;
  for (const m of boardMats) {
    if (env) { m.envMap = env; m.envMapIntensity = Math.max(m.envMapIntensity || 1, 0.9); }
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, RU);
      sh.vertexShader = 'varying vec3 vBoardP;\n' + sh.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\n vBoardP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = `varying vec3 vBoardP; uniform float uReveal, uTime;
        float hb(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n` + sh.fragmentShader
        .replace('void main() {', `void main() {
          float boardR = length(vBoardP.xz - boardMid);
          if (boardR > uReveal) discard;`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          if (uReveal < ${REVEAL_MAX.toFixed(3)}) {
            float edge = smoothstep(0.07, 0.0, uReveal - boardR);
            vec2 cell = vBoardP.xz * 420.0, id = floor(cell), f = fract(cell);
            float h = hb(id), dotk = smoothstep(0.35, 0.0, length(f - vec2(h, hb(id + 9.0))));
            float tw = pow(0.5 + 0.5 * sin(uTime * (4.0 + h * 9.0) + h * 50.0), 2.0);
            totalEmissiveRadiance += vec3(1.0, 0.68, 0.24) * edge * (0.6 + dotk * step(0.55, h) * tw * 5.0);
          }`);
      sh.fragmentShader = sh.fragmentShader.replace('varying vec3 vBoardP;', 'varying vec3 vBoardP; uniform vec2 boardMid;');
      sh.uniforms.boardMid = MID;
    };
    m.customProgramCacheKey = () => 'boardReveal';
    m.needsUpdate = true;
  }
  const MID = { value: new THREE.Vector2(0, 0) };   // (the board's middle in the room: kept up to date each frame)
  othello.group.traverse(o => {   // (the Othello board's own looks kept, the forming added on)
    const m = o.material;
    if (!m || !m.isMeshStandardMaterial || m.userData.reveal) return;
    m.userData.reveal = true;
    const own = m.onBeforeCompile, ownKey = m.customProgramCacheKey ? m.customProgramCacheKey.bind(m) : () => '';
    m.onBeforeCompile = (sh, r) => {
      if (own) own.call(m, sh, r);
      sh.uniforms.uReveal = RU.uReveal; sh.uniforms.boardMid = MID;
      sh.vertexShader = 'varying vec3 vRevealP;\n' + sh.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\n vRevealP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = 'varying vec3 vRevealP; uniform float uReveal; uniform vec2 boardMid;\n' + sh.fragmentShader
        .replace('void main() {', 'void main() {\n if (length(vRevealP.xz - boardMid) > uReveal) discard;');
    };
    m.customProgramCacheKey = () => ownKey() + 'Reveal';
    m.needsUpdate = true;
  });
  function setReveal(r) { RU.uReveal.value = r; }

  // its rim: a fine glowing gold line set into the black top right round the squares, and a softer one along the top's
  // outer edge, each with a faint glow washing onto the stone beside it
  const rim = new THREE.Group();
  board.add(rim);
  {
    const PLAY0 = (BOARD / 2 - 0.0254) / (0.5 + 0.151), RIM_Y = LIFT + 0.03 + 0.0005, OUTER = BOARD / 2 - 0.0254 - 0.006;
    const lineMat = (k) => new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.7, 0.28).multiplyScalar(k), toneMapped: false });
    const washCv = document.createElement('canvas'); washCv.width = 4; washCv.height = 64;
    { const g = washCv.getContext('2d'), grd = g.createLinearGradient(0, 0, 0, 64);
      grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.5, 'rgba(255,255,255,1)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd; g.fillRect(0, 0, 4, 64); }
    const washTex = new THREE.CanvasTexture(washCv);
    const washMat = op => new THREE.MeshBasicMaterial({ map: washTex, color: 0xffa640, transparent: true, opacity: op, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false });
    const loop = (half, width, k, washW, washOp) => {
      for (let s = 0; s < 4; s++) {
        const side = new THREE.Group(); side.rotation.y = s * Math.PI / 2; rim.add(side);
        const line = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + width, 0.0008, width), lineMat(k));
        line.position.set(0, RIM_Y, half); side.add(line);
        const wash = new THREE.Mesh(new THREE.PlaneGeometry(half * 2 + washW, washW).rotateX(-Math.PI / 2), washMat(washOp));
        wash.position.set(0, RIM_Y + 0.0006, half); side.add(wash);
      }
    };
    loop(PLAY0 / 2 + 0.0045, 0.0016, 2.6, 0.026, 0.45);   // (round the squares)
    loop(OUTER, 0.0011, 1.6, 0.018, 0.25);                // (along the outer edge)
  }
  rim.visible = false;

  // its own soft lights: a warm key from above, a cool light from low across it to catch the bevels
  const key = new THREE.SpotLight(0xffe0b0, 0, 0, 0.62, 0.85, 2);
  key.position.set(0.3, 1.45, 0.22); key.target.position.set(0, 0, 0);
  const edgeLight = new THREE.SpotLight(0xa8bcff, 0, 0, 0.5, 0.9, 2);
  edgeLight.position.set(-1.1, 0.42, -0.7); edgeLight.target.position.set(0, 0, 0);
  group.add(key, key.target, edgeLight, edgeLight.target);
  let lit = 0;

  const motesGeo = new THREE.BufferGeometry();
  const mPos = new Float32Array(MOTES * 3), from = new Float32Array(MOTES * 3), to = new Float32Array(MOTES * 3), delay = new Float32Array(MOTES), mSeed = new Float32Array(MOTES);
  for (let i = 0; i < MOTES; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * PORTAL_R * 0.9;
    from.set([Math.cos(a) * r, -0.02, Math.sin(a) * r], i * 3);
    const onEdge = Math.random() < 0.3;   // (some settle along the board's edges, so its outline shows first)
    let x = (Math.random() - 0.5) * BOARD, z = (Math.random() - 0.5) * BOARD;
    if (onEdge) { if (Math.random() < 0.5) x = Math.sign(x) * BOARD / 2; else z = Math.sign(z) * BOARD / 2; }
    to.set([x, SQUARES_TOP + 0.006, z], i * 3);
    delay[i] = Math.hypot(x, z) / (BOARD * 0.71) * 0.5 + Math.random() * 0.15;   // (the outer ones land later, as the board forms outward)
    mSeed[i] = Math.random();
  }
  motesGeo.setAttribute('position', new THREE.BufferAttribute(mPos, 3));
  motesGeo.setAttribute('seed', new THREE.BufferAttribute(mSeed, 1));
  const MU = { opacity: { value: 0 }, time: { value: 0 }, px: { value: 400 } };
  const motes = new THREE.Points(motesGeo, new THREE.ShaderMaterial({   // (gold star dust: mostly fine glitter, a few star flares)
    uniforms: MU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform float time, px; attribute float seed; varying float vS, vTw;
      void main() {
        vS = seed; vTw = pow(0.5 + 0.5 * sin(time * (4.0 + seed * 10.0) + seed * 70.0), 2.0);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = px * (0.006 + 0.012 * seed * seed + step(0.95, seed) * 0.035) * (0.5 + 0.7 * vTw) / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform float opacity; varying float vS, vTw;
      void main() {
        vec2 q = gl_PointCoord - 0.5;
        float core = exp(-dot(q, q) * 70.0);
        float beams = exp(-abs(q.x) * 34.0) * exp(-abs(q.y) * 5.0) + exp(-abs(q.y) * 34.0) * exp(-abs(q.x) * 5.0);
        float a = (core + beams * step(0.85, vS) * vTw) * opacity * (0.35 + 0.65 * vTw);
        vec3 col = mix(vec3(1.0, 0.66, 0.22), vec3(1.0, 0.93, 0.78), step(0.9, vS));
        gl_FragColor = vec4(col * a * 2.2, a);
      }`
  }));
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


  // ---------- what happens ----------
  function go(p) { phase = p; pt = 0; }
  function circleClicked() {
    if (state === 'idle') { state = 'busy'; go('rise'); }
    else if (state === 'menu') { state = 'busy'; go('sink'); }
  }
  function choose(g) { if (state === 'menu') { picked = g === 'othello' ? 'othello' : 'checkers'; showGame(picked); state = 'busy'; go('build'); onChoose(game); } }
  function buildNow(g) { if (state === 'idle' || state === 'menu') { picked = g === 'othello' ? 'othello' : 'checkers'; showGame(picked); cluster.visible = state === 'menu'; state = 'busy'; go('build'); } }   // (someone else summoned it)
  function dismiss() { if (state === 'board') { state = 'busy'; go('unbuild'); } }
  function back() {
    if (state === 'menu') { state = 'busy'; go('sink'); }
    else if (state === 'board') { state = 'busy'; go('unbuild'); }
  }

  function update(dt) {
    t += dt; pt += dt;
    column.material.uniforms.time.value = t;
    RU.uTime.value = t; MU.time.value = t;
    MU.px.value = (window.innerHeight || 800) * Math.min(window.devicePixelRatio || 1, 2) * 0.5;
    { const w = new THREE.Vector3(); board.getWorldPosition(w); MID.value.set(w.x, w.z); }
    const litWant = board.visible && game === 'checkers' ? 1 : 0;   // (the checkerboard's lights ease up as it forms, and away as it goes)
    lit += Math.sign(litWant - lit) * Math.min(Math.abs(litWant - lit), dt / 1.2);
    key.intensity = 2.6 * lit; edgeLight.intensity = 0.9 * lit;
    // the floating cluster turns slowly, each piece bobbing and tipping on its own
    if (cluster.visible) choices.forEach((ch, ci) => {   // (each game's two pieces circling each other slowly, tipping and turning)
      ch.holders.forEach(({ h, p, i }) => {
        const a = i * Math.PI + t * 0.5 + ci;
        h.position.set(Math.cos(a) * 0.05, 0.015 * Math.sin(t * 1.3 + i * 2.1 + ci), Math.sin(a) * 0.05);
        h.rotation.set(0.5 + 0.2 * Math.sin(t * 0.7 + i + ci), t * 0.6 + i * 2, 0.25 * Math.cos(t * 0.5 + i * 1.7));
        p.update(t);
      });
      ch.word.position.set(0, 0.12 + 0.008 * Math.sin(t * 1.1 + ci), 0);
    });
    const u = shimmer.material.uniforms;
    u.flare.value *= Math.exp(-dt * 1.6);

    if (phase === 'rise') {   // the ring flares, the light rises, the pieces come up out of the portal
      u.sweep.value = pt / 1.1; if (pt < 0.05) u.flare.value = 1.2;
      column.visible = true; column.material.uniforms.k.value = ease(pt / 0.6);
      cluster.visible = true;
      const k = ease((pt - 0.35) / 1.1);
      cluster.position.y = -0.1 + (FLOAT_Y + 0.1) * k;
      cluster.scale.setScalar(Math.max(0.001, k));
      for (const w of words) w.material.opacity = ease((pt - 1.1) / 0.6);
      if (pt > 1.8) { phase = null; state = 'menu'; u.sweep.value = -1; }
    } else if (phase === 'sink') {   // back down into the portal
      const k = 1 - ease(pt / 0.9);
      cluster.position.y = -0.1 + (FLOAT_Y + 0.1) * k;
      cluster.scale.setScalar(Math.max(0.001, k));
      for (const w of words) w.material.opacity = k;
      column.material.uniforms.k.value = k;
      if (pt > 0.95) { cluster.visible = false; column.visible = false; phase = null; state = 'idle'; }
    } else if (phase === 'build') {   // the pieces burst; gold dust swirls up and showers down; the board forms outward
      u.sweep.value = pt / 1.0; if (pt < 0.05) u.flare.value = 1.4;
      const k0 = 1 - ease(pt / 0.35);
      cluster.scale.setScalar(Math.max(0.001, 1 + (1 - k0) * 0.5)); for (const w of words) w.material.opacity = k0;
      for (const ch of choices) ch.g.visible = ch === (picked === 'othello' ? othelloChoice : checkersChoice);   // (the one chosen bursts)
      floaters.forEach(f => f.heat(1 - k0));
      if (pt > 0.35) cluster.visible = false;
      column.material.uniforms.k.value = 1 - ease((pt - 1.4) / 0.8);
      motes.visible = pt > 0.15 && pt < 3.6;
      MU.opacity.value = ease((pt - 0.15) / 0.3) * (1 - ease((pt - 2.6) / 0.9));
      placeMotes((pt - 0.15) / 1.9, false);
      if (pt > 0.9 && !board.visible) { board.visible = true; setReveal(0); for (const o of othelloLate) o.visible = false; othello.restore(); }
      if (board.visible) setReveal(REVEAL_MAX * ease((pt - 0.9) / 2.0));
      rim.visible = pt > 2.7 && game === 'checkers';
      for (const o of othelloLate) o.visible = pt > 2.9;
      if (pt > 4.0) {
        floaters.forEach(f => f.heat(0)); cluster.scale.setScalar(1); for (const ch of choices) ch.g.visible = true;
        column.visible = false; motes.visible = false; setReveal(REVEAL_MAX); rim.visible = game === 'checkers';
        for (const o of othelloLate) o.visible = true;
        phase = null; state = 'board'; u.sweep.value = -1; onBoard(true);
      }
    } else if (phase === 'unbuild') {   // the board dissolves from its corners inward into gold dust, which pours back into the portal
      if (pt < 0.05) u.flare.value = 1.0;
      if (pt < 0.05) onBoard(false);
      rim.visible = false; for (const o of othelloLate) o.visible = false;
      setReveal(REVEAL_MAX * (1 - ease(pt / 1.4))); if (pt > 1.4) board.visible = false;
      column.visible = true; column.material.uniforms.k.value = ease((pt - 0.5) / 0.4) * (1 - ease((pt - 2.4) / 0.6));
      motes.visible = pt > 0.05 && pt < 3.0;
      MU.opacity.value = ease((pt - 0.05) / 0.3) * (1 - ease((pt - 2.3) / 0.6));
      placeMotes((pt - 0.05) / 2.2, true);
      if (pt > 3.1) { column.visible = false; motes.visible = false; phase = null; state = 'idle'; }
    }
  }

  const cellOf = g => (g === 'othello' ? othello.CELL : SQ), topOf = g => (g === 'othello' ? othello.TOP : SQUARES_TOP);
  return { group, update, circleClicked, choose, back, buildNow, dismiss, cellOf, topOf, board: othello,
    get game() { return game; }, get CELL() { return cellOf(game); }, get TOP() { return topOf(game); }, get state() { return state; } };
}

// ---------- The Workshop's look at it: the board forming out of gold dust, staying a while, dissolving, over and over ----------
export function build() {
  const s = makeSummon({ top: 0 });
  const holder = new THREE.Group();
  holder.add(s.group);
  let t = 0, last = performance.now(), step = -1;
  const ticker = new THREE.Mesh(new THREE.PlaneGeometry(0.001, 0.001), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
  ticker.frustumCulled = false;   // (an invisible speck, drawn every frame, so it's driven by its own drawing and stops when unloaded)
  holder.add(ticker);
  ticker.onBeforeRender = () => {
    const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000); last = now;
    t += dt;
    const cycle = t % 13;
    if (cycle < 1 && step !== 0 && s.state === 'idle') { step = 0; s.buildNow(Math.floor(t / 13) % 2 ? 'othello' : 'checkers'); }
    if (cycle > 8.5 && step !== 1 && s.state === 'board') { step = 1; s.dismiss(); }
    s.update(dt);
  };
  return holder;
}
// >>>>> END OF FILE: HangoutRoom/pieces/summon.js <<<<<
