// =====================================================================================================================
// >>>>> START OF FILE: HangoutRoom/maker/room.js <<<<<
// A Workshop-style room on the site: plain matte white walls, floor and ceiling, a blue neon tube along every edge and
// corner (hot and whiter down its middle, lighting the walls like real neon), soft even light. The Maker
// (maker/maker.js) and the Scene room (maker/scene.js) are both this room, at their own sizes.
// Everything a site room has: the name box, snowmen walking about, chat, who's here, the portal home on the back wall
// (click it to go back to the Doodle Gallery), and the ⌨ instructions button top left.
// The holodeck (H, or the 🌌 button): the room becomes a scene (pieces/holodome.js): black ripple water spreads over
// the floor, the room fades away, and a round wall and a shallow dome rise and close round everyone. It's shared:
// whoever turns it on or picks a scene, everyone in the room sees it. Out on the water you can walk well past where
// the walls were. Running here through the launchers, the 🌌 window also lets you try your own Assets pictures as the
// walls or the dome, just for you.
//   startRoom({ key, title, HX, HZ, RH, dome: { radius, wall, rise }, bench })
//     key: 'maker' or 'scene' (its place in the database); HX, HZ: half the room's width and length; RH: its height
//     bench: (the Maker) makeBench(ctx), the stands and their tools (maker/bench.js)
// =====================================================================================================================
import * as THREE from 'three';
import { ref, set, get, update, remove, push, onValue, onDisconnect,
         query, orderByChild, startAt, endAt, onChildAdded } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { db, myId, S, hooks, EYE, renderer, scene, camera, canvas, BASE_FOV,
         std, RAINBOW, RAINBOW_CSS, colorIndex, makeLabel, PHONE } from '../core.js';
import { sfx, setupMute } from '../sounds.js';
import { inRoom } from '../world.js';
import { setupHud } from '../hud.js';
import { makePortalFrame } from '../pieces/portalframe.js';
import { makeHoloDome } from '../pieces/holodome.js';
import { SCENES } from './scenes.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';

const WHITE = 0xe6e6e6;          // the walls' white
const FILL = 0.6, LAMP = 1.0;    // the even light everywhere, and the soft light from high above
const NEON = new THREE.Color().setHSL(215 / 360, 1, 0.56, THREE.SRGBColorSpace);   // the neon's rich blue
const NEON_R = 0.015;            // the tube's thickness (3 cm across)
const NEON_LEVEL = 2.2;          // how bright the tubes are (past 1 they glow)
const NEON_LIGHT = 4;            // each edge's light into the room
const WALK = 2.2;                // walking speed, meters a second

export function startRoom({ key, title, HX, HZ, RH, dome: domeSize, bench: makeBench }) {
  setupHud();
  document.querySelector('#ui h1').textContent = title;
  document.title = title;
  renderer.toneMappingExposure = 1.0;   // (the Workshop's own light, not the gallery's)

  // ---------- The glow: anything well past white (the neon, the holodeck's build lines) blooms softly ----------
  const target = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.6, 0.4, 1.2);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ---------- The room: white walls and ceiling, and a white floor you can click to walk on ----------
  const room = new THREE.Group();
  scene.add(room);
  const wallMat = new THREE.MeshStandardMaterial({ color: WHITE, roughness: 1, metalness: 0, side: THREE.BackSide, envMapIntensity: 0 });
  const walls = new THREE.Mesh(new THREE.BoxGeometry(HX * 2, RH, HZ * 2), wallMat);
  walls.position.y = RH / 2;
  room.add(walls);
  const floorMat = new THREE.MeshStandardMaterial({ color: WHITE, roughness: 1, metalness: 0, envMapIntensity: 0 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HX * 2, HZ * 2), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.position.y = 0.001;
  floor.userData.floor = true;
  room.add(floor);
  const fill = new THREE.AmbientLight(0xffffff, FILL);
  const lamp = new THREE.DirectionalLight(0xffffff, LAMP);   // (from above and a little behind you, so things show their shape)
  lamp.position.set(1, RH, 3);
  scene.add(fill, lamp, lamp.target);

  // ---------- The neon along every edge and corner (the Workshop's neon) ----------
  const neonU = () => ({ neonColor: { value: NEON.clone() }, level: { value: NEON_LEVEL }, core: { value: 0.55 }, radius: { value: NEON_R },
    knot: { value: 0 }, viewHeight: { value: 1000 }, minPixels: { value: 1.4 } });
  const neonVS = `
    uniform float radius, knot, viewHeight, minPixels;
    varying vec3 vNormal; varying vec3 vView; varying float vThin;
    void main() {
      vec3 center = knot > 0.5 ? vec3(0.0) : vec3(0.0, position.y, 0.0);
      float away = max(-(modelViewMatrix * vec4(center, 1.0)).z, 0.01);
      float pixel = 2.0 * away / (projectionMatrix[1][1] * viewHeight);
      float widen = max(1.0, minPixels * 0.5 * pixel / radius);
      vec3 p = position;
      if (knot > 0.5) p *= widen; else p.xz *= widen;
      vThin = 1.0 / widen;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      vNormal = normalize(normalMatrix * normal);
      vView = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
    }`;
  const neonFS = `
    uniform vec3 neonColor; uniform float level, core;
    varying vec3 vNormal; varying vec3 vView; varying float vThin;
    void main() {
      float facing = clamp(dot(normalize(vNormal), normalize(vView)), 0.0, 1.0);
      float hotMiddle = pow(facing, 6.0);
      vec3 rich = neonColor * level;
      vec3 hot = mix(rich, vec3(level * 1.15), 0.6);
      gl_FragColor = vec4(mix(rich * (0.75 + 0.25 * facing), hot, hotMiddle * core) * mix(1.0, vThin, 0.6), 1.0);
    }`;
  const tubeMat = new THREE.ShaderMaterial({ uniforms: neonU(), vertexShader: neonVS, fragmentShader: neonFS });
  const knotMat = new THREE.ShaderMaterial({ uniforms: neonU(), vertexShader: neonVS, fragmentShader: neonFS });
  knotMat.uniforms.knot.value = 1;
  const neon = new THREE.Group();
  room.add(neon);
  {
    const hx = HX - NEON_R, hz = HZ - NEON_R, low = NEON_R, top = RH - NEON_R, V = (x, y, z) => new THREE.Vector3(x, y, z);
    const tube = (a, b) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(NEON_R, NEON_R, a.distanceTo(b), 12, 1, true), tubeMat);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      neon.add(m);
    };
    for (const y of [low, top]) {
      tube(V(-hx, y, -hz), V(hx, y, -hz)); tube(V(hx, y, -hz), V(hx, y, hz)); tube(V(hx, y, hz), V(-hx, y, hz)); tube(V(-hx, y, hz), V(-hx, y, -hz));
    }
    for (const x of [-hx, hx]) for (const z of [-hz, hz]) tube(V(x, low, z), V(x, top, z));
    const knotGeo = new THREE.SphereGeometry(NEON_R, 12, 6);
    for (const x of [-hx, hx]) for (const y of [low, top]) for (const z of [-hz, hz]) { const k = new THREE.Mesh(knotGeo, knotMat); k.position.set(x, y, z); neon.add(k); }
  }
  RectAreaLightUniformsLib.init();
  const neonLights = [];
  {
    const hx = HX - NEON_R, hz = HZ - NEON_R, low = NEON_R, top = RH - NEON_R, V = (x, y, z) => new THREE.Vector3(x, y, z);
    const edgeLight = (at, toward, w, h) => {
      const l = new THREE.RectAreaLight(NEON, NEON_LIGHT, w, h);
      l.position.copy(at); l.lookAt(at.clone().add(toward));
      room.add(l); neonLights.push(l);
    };
    for (const s of [-1, 1]) {
      edgeLight(V(0, low, s * hz), V(0, 1, -s), HX * 2 - 0.1, 0.04);
      edgeLight(V(s * hx, low, 0), V(-s, 1, 0), 0.04, HZ * 2 - 0.1);
      edgeLight(V(0, top, s * hz), V(0, -1, -s), HX * 2 - 0.1, 0.04);
      edgeLight(V(s * hx, top, 0), V(-s, -1, 0), 0.04, HZ * 2 - 0.1);
    }
    for (const x of [-hx, hx]) for (const z of [-hz, hz]) edgeLight(V(x, RH / 2, z), V(-x, 0, -z), 0.04, RH - 0.1);
  }

  // ---------- Reflections: a snapshot of the room (or the holodeck's scene), used by every shiny thing in it ----------
  const pmrem = new THREE.PMREMGenerator(renderer);
  const noReflect = new Set();   // (left out of the snapshot: people, made things, the walking marker)
  let envNow = null, reflectTimer = 0;
  function reflect(wait = 60) {
    clearTimeout(reflectTimer);
    reflectTimer = setTimeout(() => {
      const hidden = [...noReflect].filter(o => o.visible && !(o === holo.group && holo.formed));   // (the scene itself, once it's formed, is what shines)
      hidden.forEach(o => { o.visible = false; });
      scene.position.y = -1.6;   // (taken from eye height in the middle of the room)
      const env = pmrem.fromScene(scene, 0.02, 0.05, 60);
      scene.position.y = 0;
      hidden.forEach(o => { o.visible = true; });
      if (envNow) envNow.dispose();
      envNow = env; scene.environment = env.texture;
    }, wait);
  }

  // ---------- The holodeck ----------
  const holo = makeHoloDome(domeSize);
  scene.add(holo.group);
  noReflect.add(holo.group);   // (the room's own snapshot is of the room; once the scene's formed, it's of the scene)
  let shared = { on: false, s: 0 }, tryWalls = '', tryDome = '', wasFormed = false, wasGone = true;
  function showScene() {
    const sc = SCENES[Math.max(0, Math.min(SCENES.length - 1, shared.s | 0))];
    holo.pictures({ walls: tryWalls || sc.walls, walls2: tryWalls ? '' : (sc.walls2 || ''), dome: tryWalls || tryDome ? tryDome : (sc.dome || ''), night: sc.night, copies: tryWalls ? 0 : (sc.copies || 0) });
    holo.show(shared.on || !!(tryWalls || tryDome));
    drawHolo();
  }
  function setShared(next) {   // (everyone sees it)
    shared = { ...shared, ...next };
    showScene();
    if (S.myName) set(ref(db, key + '/holo'), { on: !!shared.on, s: shared.s | 0 }).catch(() => {});
  }
  function fadeRoom(k) {   // (the white room fading as the scene forms: 0 there, 1 gone)
    const gone = k >= 1;
    room.visible = !gone;
    portal.group.visible = !gone && k < 0.5;
    for (const m of [wallMat, floorMat]) {
      const want = k > 0;
      if (m.transparent !== want) { m.transparent = want; m.depthWrite = !want; m.needsUpdate = true; }
      m.opacity = 1 - k;
    }
    tubeMat.uniforms.level.value = knotMat.uniforms.level.value = NEON_LEVEL * (1 - k);
    for (const l of neonLights) l.intensity = NEON_LIGHT * (1 - k);
    fill.intensity = FILL * (1 - 0.55 * k); lamp.intensity = LAMP * (1 - 0.6 * k);
  }

  // ---------- The portal home: the gallery's portal frame, on the back wall ----------
  const portal = makePortalFrame({ swirl: key === 'maker' ? 'gold' : 'blue' });   // (its own room's color)
  portal.group.position.set(0, 1.75, HZ - 0.045);
  portal.group.rotation.y = Math.PI;   // (facing into the room)
  scene.add(portal.group);
  const whiteout = document.createElement('div');
  whiteout.style.cssText = 'position:fixed; inset:0; background:radial-gradient(ellipse at center, #fff4d6 0%, #ffd27a 45%, #e6a63c 100%); opacity:0; pointer-events:none; transition:opacity 0.35s; z-index:5;';
  document.body.appendChild(whiteout);
  let leaving = false;
  function goGallery() {
    if (leaving) return;
    leaving = true;
    me.tx = me.tz = null; marker.visible = false;
    const t0 = performance.now();
    (function glowUp() {
      const e = Math.min((performance.now() - t0) / 450, 1);
      portal.flare(e * e);
      if (e < 1) requestAnimationFrame(glowUp);
    })();
    setTimeout(() => { whiteout.style.opacity = '1'; }, 300);
    setTimeout(() => {   // (off this room's list first, so you don't show in two rooms at once)
      let gone = false;
      const go = () => { if (!gone) { gone = true; location.href = location.pathname; } };
      const bye = [remove(ref(db, key + '/presence/' + myId)).catch(() => {})];
      if (bench && bench.leave) bye.push(bench.leave());
      Promise.all(bye).then(go);
      setTimeout(go, 1200);
    }, 700);
  }

  // ---------- Other people: a standing snowman with a name tag, gliding to wherever they walk ----------
  const avatars = {};
  const footShadow = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(0,0,0,0.45)'); grd.addColorStop(0.6, 'rgba(0,0,0,0.2)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    return new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false });
  })();
  function makeAvatar(name, c) {
    const g = new THREE.Group();
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.85), footShadow);
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.01;
    g.add(shadow);
    const mat = std(new THREE.Color(RAINBOW[c]), 0.75);
    for (const [r, y] of [[0.28, 0.28], [0.21, 0.74], [0.15, 1.1]]) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 18), mat);
      b.position.y = y;
      g.add(b);
    }
    const label = makeLabel(name, RAINBOW_CSS[c]);
    label.position.y = 1.47;
    g.add(label);
    g.traverse(o => { o.userData.avatar = true; });
    scene.add(g);
    noReflect.add(g);
    return { g, name, c };
  }
  function limit() {   // (how far out anyone can walk: the room's walls, or out on the holodeck's water)
    return holo.amount > 0.45 ? { round: holo.radius - 0.6 } : { x: HX - 0.4, z: HZ - 0.4 };
  }
  function clampSpot(x, z) {
    const l = limit();
    if (l.round) { const d = Math.hypot(x, z); return d > l.round ? [x / d * l.round, z / d * l.round] : [x, z]; }
    return [Math.max(-l.x, Math.min(l.x, x)), Math.max(-l.z, Math.min(l.z, z))];
  }
  function refreshAvatars() {
    for (const id of Object.keys(avatars)) {
      const p = S.presence[id];
      if (!p || id === myId || p.name !== avatars[id].name || colorIndex(p) !== avatars[id].c) {
        scene.remove(avatars[id].g); noReflect.delete(avatars[id].g);
        delete avatars[id];
      }
    }
    for (const [id, p] of Object.entries(S.presence)) {
      if (id === myId) continue;
      const fresh = !avatars[id];
      if (fresh) avatars[id] = makeAvatar(p.name, colorIndex(p));
      const a = avatars[id];
      a.tx = Number.isFinite(p.x) ? p.x : 0; a.tz = Number.isFinite(p.z) ? p.z : HZ - 1.6;
      if (fresh) a.g.position.set(a.tx, 0, a.tz);
      a.g.visible = !p.e;   // (building, floating about: their snowman's gone till they land)
    }
  }
  function moveAvatars(dt) {
    for (const a of Object.values(avatars)) {
      const p = a.g.position, dx = a.tx - p.x, dz = a.tz - p.z, d = Math.hypot(dx, dz);
      if (d > 0.001) {
        const step = Math.min(d, WALK * 1.2 * dt);
        p.x += dx / d * step; p.z += dz / d * step;
        a.phase = (a.phase || 0) + step * 5;
        a.walking = 1;
      } else a.walking = Math.max(0, (a.walking || 0) - dt * 2);
      p.y = d > 0.001 ? Math.abs(Math.sin(a.phase)) * 0.08 : 0;
    }
  }

  // ---------- Who's online ----------
  const connEl = document.getElementById('conn');
  inRoom(key);
  hooks.refreshAll = refreshAvatars;

  // ---------- Chat (two tabs: what people say, and the room's news) ----------
  const msgs = document.getElementById('msgs');
  const chatInput = document.getElementById('chatInput');
  const newDot = document.getElementById('newDot');
  const tabStyle = document.createElement('style');
  tabStyle.textContent = `#chatTabs { display: flex; gap: 6px; margin-bottom: 6px; }
    #chatTabs button { position: relative; margin: 0; font-size: 13px; padding: 4px 12px; background: rgba(233,201,143,0.25); color: #f3e6cf; }
    #chatTabs button.on { background: #e9c98f; color: #2a1c10; }
    #roomDot { display: none; position: absolute; top: 1px; right: 1px; width: 8px; height: 8px; border-radius: 50%; background: #ff3b2f; }
    #roomLog { display: none; height: 150px; overflow-y: auto; font-size: 14px; margin-bottom: 8px; word-wrap: break-word; }
    #roomLog .sys { font-style: italic; opacity: 0.75; font-size: 13px; }
    body.roomTab #msgs { display: none; }
    body.roomTab #roomLog { display: block; }
    @media (max-width: 700px) { #roomLog { height: 110px; } }`;
  document.head.appendChild(tabStyle);
  const chatTabs = document.createElement('div'); chatTabs.id = 'chatTabs';
  const chatTabBtn = document.createElement('button'); chatTabBtn.textContent = '💬 Chat';
  const roomTabBtn = document.createElement('button'); roomTabBtn.textContent = '🔔 Room';
  const roomDot = document.createElement('span'); roomDot.id = 'roomDot';
  roomTabBtn.appendChild(roomDot);
  chatTabs.append(chatTabBtn, roomTabBtn);
  const roomLog = document.createElement('div'); roomLog.id = 'roomLog';
  msgs.parentNode.insertBefore(chatTabs, msgs);
  msgs.parentNode.insertBefore(roomLog, msgs.nextSibling);
  function showTab(r) {
    document.body.classList.toggle('roomTab', r);
    chatTabBtn.classList.toggle('on', !r); roomTabBtn.classList.toggle('on', r);
    if (r) { roomDot.style.display = 'none'; roomLog.scrollTop = roomLog.scrollHeight; } else msgs.scrollTop = msgs.scrollHeight;
  }
  chatTabBtn.addEventListener('click', () => showTab(false));
  roomTabBtn.addEventListener('click', () => showTab(true));
  showTab(false);
  function addMsg(name, text, mine, c) {
    const div = document.createElement('div');
    const b = document.createElement('b');
    b.textContent = (mine ? 'You' : name) + ': ';
    if (Number.isInteger(c) && c >= 0 && c < 7) b.style.color = RAINBOW_CSS[c];
    div.append(b, document.createTextNode(text));
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    if (!mine) { sfx.ping(); if (!document.body.classList.contains('chatOpen')) newDot.style.display = 'block'; }
  }
  function addSys(text, c) {
    const div = document.createElement('div'); div.className = 'sys';
    const dot = document.createElement('span'); dot.textContent = '● ';
    if (Number.isInteger(c) && c >= 0 && c < 7) dot.style.color = RAINBOW_CSS[c];
    div.append(dot, document.createTextNode(text));
    roomLog.appendChild(div);
    while (roomLog.children.length > 100) roomLog.removeChild(roomLog.firstChild);
    roomLog.scrollTop = roomLog.scrollHeight;
    if (!document.body.classList.contains('roomTab')) roomDot.style.display = 'block';
  }
  hooks.addSys = addSys;
  const banner = document.getElementById('banner');
  let bannerTimer = 0;
  function showBanner(text, secs = 3) {
    banner.textContent = text;
    banner.classList.remove('show'); void banner.offsetWidth; banner.classList.add('show');
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => banner.classList.remove('show'), secs * 1000);
  }
  hooks.banner = showBanner;
  function logJoinsLeaves(before, after) {
    for (const [id, p] of Object.entries(after)) if (id !== myId && !before[id]) { addSys(`${p.name} joined the room`, colorIndex(p)); sfx.join(); }
    for (const [id, p] of Object.entries(before)) if (id !== myId && !after[id]) { addSys(`${p.name} left the room`, colorIndex(p)); sfx.leave(); }
  }
  function sendChat() {
    const text = chatInput.value.trim();
    if (!text || !S.myName) return;
    push(ref(db, 'room/chat'), { name: S.myName, text: text.slice(0, 200), t: Date.now(), id: myId, c: S.myHue });
    chatInput.value = '';
    showTab(false);
  }
  document.getElementById('send').addEventListener('click', sendChat);
  chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
  setupMute(document.getElementById('mute'));

  // ---------- You ----------
  const hint = document.getElementById('hint');
  const HINT_WALK = PHONE ? 'Drag to look · tap the floor to walk' : 'Drag to look · click the floor to walk (or W A S D) · ⌨ top left for every key';
  hint.textContent = HINT_WALK;
  const me = { x: (Math.random() - 0.5) * 1.2, z: HZ - 1.2, tx: null, tz: null, phase: 0, moving: 0 };
  let yaw = 0, pitch = -0.08;
  function mySpot() {
    const x = me.tx != null ? me.tx : me.x, z = me.tz != null ? me.tz : me.z;
    return { x: +x.toFixed(2), z: +z.toFixed(2) };
  }
  let sentAt = 0, sendTimer = 0;
  function sendSpot(now) {
    if (!S.myName) return;
    clearTimeout(sendTimer); sendTimer = 0;
    if (!now && performance.now() - sentAt < 250) { sendTimer = setTimeout(() => sendSpot(true), 250); return; }
    sentAt = performance.now();
    update(ref(db, key + '/presence/' + myId), mySpot()).catch(() => {});
  }
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.17, 0.22, 40),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.7, 1.0).multiplyScalar(1.6), transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false }));
  marker.rotation.x = -Math.PI / 2;
  marker.visible = false;
  scene.add(marker); noReflect.add(marker);
  let markerFade = 0;
  function walkTo(x, z) {
    [me.tx, me.tz] = clampSpot(x, z);
    marker.position.set(me.tx, 0.02, me.tz);
    marker.visible = true; markerFade = 1;
    sendSpot(true);
  }
  function setFov(f) { camera.fov = Math.max(20, Math.min(BASE_FOV, f)); camera.updateProjectionMatrix(); }
  camera.position.set(me.x, EYE, me.z);
  camera.rotation.set(pitch, yaw, 0);

  // ---------- The bench (the Maker's stands), if this room has one ----------
  const bench = makeBench ? makeBench({
    scene, camera, canvas, HX, HZ, RH, noReflect, reflect, banner: showBanner, addSys,
    onEdit(on, at) {   // (building: you float; landing puts you on your feet under where you floated)
      if (S.myName) update(ref(db, key + '/presence/' + myId), { e: on ? 1 : null }).catch(() => {});
      hint.textContent = on ? 'Building · W A S D fly, Space up, C down · click a part to pick it · ⌨ for every key' : HINT_WALK;
      if (!on) { [me.x, me.z] = clampSpot(at.x, at.z); me.tx = me.tz = null; sendSpot(true); }
    },
    flyLimit: () => limit()
  }) : null;

  // ---------- The holodeck window (🌌): the scenes, and (here) your own pictures to try ----------
  const css = document.createElement('style');
  css.textContent = `
    #keysBtn { left: 16px; top: 16px; font-size: 19px; }
    #keysBtn.on, #holoBtn.on { background: rgba(233,201,143,0.92); color: #2a1c10; }
    #keysCard { position: fixed; left: 16px; top: 66px; z-index: 15; display: none; max-height: calc(100vh - 150px); overflow-y: auto;
      padding: 14px 18px; border-radius: 16px; background: rgba(20,16,12,0.9); color: #f3e6cf; font-size: 14px; line-height: 1.5;
      box-shadow: 0 4px 16px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(201,162,39,0.6); }
    #keysCard.up { display: block; }
    #keysCard h4 { margin: 8px 0 4px; color: #ffd36a; font-size: 14px; letter-spacing: 0.05em; }
    #keysCard h4:first-child { margin-top: 0; }
    #keysCard td { padding: 1px 0; vertical-align: top; }
    #keysCard td:first-child { padding-right: 14px; white-space: nowrap; color: #ffe6a0; font-weight: 600; }
    #holoBtn { left: 16px; bottom: ${bench ? 120 : 68}px; font-size: 19px; }
    #holoCard { position: fixed; left: 68px; bottom: ${bench ? 120 : 68}px; z-index: 15; display: none; width: 260px; max-height: calc(100vh - 200px);
      flex-direction: column; gap: 6px; padding: 12px 14px; border-radius: 16px; color: #f3e6cf; font-size: 14px;
      background: rgba(20,16,12,0.9); box-shadow: 0 4px 16px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(201,162,39,0.6); }
    #holoCard.up { display: flex; }
    #holoCard b { color: #ffd36a; font-weight: normal; }
    #holoCard .list { overflow-y: auto; display: flex; flex-direction: column; gap: 3px; }
    #holoCard .it { padding: 4px 9px; border-radius: 8px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    #holoCard .it:hover { background: rgba(233,201,143,0.18); }
    #holoCard .it.on { background: rgba(233,201,143,0.92); color: #2a1c10; }
    #holoCard .sub { font-size: 12px; opacity: 0.65; margin-top: 6px; }`;
  document.head.appendChild(css);
  const holoBtn = document.createElement('button');
  holoBtn.id = 'holoBtn'; holoBtn.className = 'corner'; holoBtn.title = 'Holodeck (H)'; holoBtn.textContent = '🌌';
  const holoCard = document.createElement('div');
  holoCard.id = 'holoCard';
  document.body.append(holoBtn, holoCard);
  holoBtn.addEventListener('click', () => { holoBtn.blur(); holoCard.classList.toggle('up'); drawHolo(); });
  let mine = null, trail = [], tryFor = 'walls';   // (your Assets pictures, when running here; where you are in them; walls or dome)
  fetch('/Workshop/assets', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(j => { mine = j; drawHolo(); }).catch(() => {});
  function item(list, text, on, click) {
    const d = document.createElement('div');
    d.className = 'it' + (on ? ' on' : ''); d.textContent = text;
    d.addEventListener('click', click);
    list.appendChild(d);
  }
  function drawHolo() {
    holoBtn.classList.toggle('on', shared.on || !!(tryWalls || tryDome));
    if (!holoCard.classList.contains('up')) return;
    holoCard.textContent = '';
    const head = document.createElement('b'); head.textContent = 'Holodeck';
    const list = document.createElement('div'); list.className = 'list';
    holoCard.append(head, list);
    item(list, 'Off', !shared.on, () => setShared({ on: false }));
    SCENES.forEach((sc, i) => item(list, sc.name, shared.on && (shared.s | 0) === i, () => setShared({ on: true, s: i })));
    if (!mine) return;
    const sub = document.createElement('div'); sub.className = 'sub';
    sub.textContent = 'Try your own pictures (only you see them):';
    const list2 = document.createElement('div'); list2.className = 'list';
    holoCard.append(sub, list2);
    item(list2, (tryFor === 'walls' ? '● ' : '○ ') + 'Walls' + (tryWalls ? ': ' + tryWalls.split('/').pop() : ''), false, () => { tryFor = 'walls'; drawHolo(); });
    item(list2, (tryFor === 'dome' ? '● ' : '○ ') + 'Dome' + (tryDome ? ': ' + tryDome.split('/').pop() : ''), false, () => { tryFor = 'dome'; drawHolo(); });
    if (tryWalls || tryDome) item(list2, '✕ Stop trying mine', false, () => { tryWalls = tryDome = ''; showScene(); });
    let f = mine;
    for (const s of trail) f = f && f[s];
    if (!f || typeof f !== 'object') { trail = []; f = mine; }
    if (trail.length) item(list2, '‹ Back', false, () => { trail.pop(); drawHolo(); });
    for (const [name, v] of Object.entries(f)) {
      if (v && typeof v === 'object') item(list2, '▸ ' + name, false, () => { trail.push(name); drawHolo(); });
      else item(list2, '   ' + name, v === tryWalls || v === tryDome, () => { if (tryFor === 'walls') tryWalls = v; else tryDome = v; showScene(); });
    }
  }

  // ---------- The instructions: the ⌨ button (top left) opens a card with every key ----------
  const KEYS = [
    ['Walking', [['W A S D / arrows', 'Walk (left and right arrows turn)'], ['Click the floor', 'Walk there'], ['Drag', 'Look around'],
      ['Scroll', 'Zoom'], ['R', 'Look straight ahead again'], ['Portal (back wall)', 'Click it to go back to the Doodle Gallery']]],
    ['Holodeck (🌌)', [['H', 'Holodeck on and off, for everyone in the room'], ['🌌 button', 'Pick the scene (everyone sees it)' + (location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? ', or try your own pictures as the walls or the dome (just for you)' : '')],
      ['Out on the water', 'Walk anywhere inside the dome, well past where the walls were']]],
    ...(bench ? bench.help : [])
  ];
  const keysBtn = document.createElement('button');
  keysBtn.id = 'keysBtn'; keysBtn.className = 'corner'; keysBtn.title = 'Instructions'; keysBtn.textContent = '⌨';
  const keysCard = document.createElement('div');
  keysCard.id = 'keysCard';
  keysCard.innerHTML = KEYS.map(([head, rows]) => `<h4>${head}</h4><table>${rows.map(([k, w]) => `<tr><td>${k}</td><td>${w}</td></tr>`).join('')}</table>`).join('');
  document.body.append(keysBtn, keysCard);
  keysBtn.addEventListener('click', () => { keysBtn.blur(); keysBtn.classList.toggle('on', keysCard.classList.toggle('up')); });

  // ---------- Entering ----------
  const nameBox = document.getElementById('nameBox');
  const nameInput = document.getElementById('nameInput');
  try { nameInput.value = localStorage.getItem('hangoutName') || ''; } catch (e) {}
  function enterRoom() {
    if (S.myName) return;
    const name = nameInput.value.trim().slice(0, 20);
    if (!name) { nameInput.focus(); return; }
    S.myName = name;
    try { localStorage.setItem('hangoutName', name); } catch (e) {}
    nameBox.style.display = 'none';
    const meRef = ref(db, key + '/presence/' + myId);
    onValue(ref(db, '.info/connected'), s => {
      if (s.val() === true) {
        onDisconnect(meRef).remove();
        get(ref(db, key + '/presence')).then(ps => {
          if (S.myHue < 0) {
            const used = new Set(Object.entries(ps.val() || {}).filter(([id]) => id !== myId).map(([, p]) => colorIndex(p)));
            let hue = 0;
            while (hue < 7 && used.has(hue)) hue++;
            if (hue >= 7) hue = Object.keys(ps.val() || {}).length % 7;
            S.myHue = hue;
          }
          set(meRef, { name: S.myName, c: S.myHue, t: Date.now(), ...mySpot(), ...(bench && bench.editing ? { e: 1 } : {}) });
          if (bench) bench.start();
        });
        connEl.textContent = 'Online';
      } else connEl.textContent = 'Reconnecting…';
    });
    let firstPresence = true;
    onValue(ref(db, key + '/presence'), s => {
      const next = s.val() || {};
      if (!firstPresence) logJoinsLeaves(S.presence, next);
      firstPresence = false;
      S.presence = next;
      refreshAvatars();
    });
    const joinTime = Date.now() - 60000;
    onChildAdded(query(ref(db, 'room/chat'), orderByChild('t'), startAt(joinTime)), s => {
      const m = s.val();
      if (m && m.name && m.text) addMsg(m.name, m.text, m.id === myId, m.c);
    });
    get(query(ref(db, 'room/chat'), orderByChild('t'), endAt(Date.now() - 3600000))).then(s => { s.forEach(ch => { remove(ch.ref); }); });
  }
  document.getElementById('enter').addEventListener('click', enterRoom);
  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') enterRoom(); });
  // (the holodeck's shared state: who turned it on, and which scene)
  onValue(ref(db, key + '/holo'), s => {
    const v = s.val() || {};
    const was = shared.on;
    shared = { on: !!v.on, s: Number.isInteger(v.s) ? v.s : 0 };
    if (was !== shared.on && S.myName) sfx.ping();
    showScene();
  });

  // ---------- Keys ----------
  const keys = new Set();
  const typing = () => { const a = document.activeElement; return !!(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')); };
  window.addEventListener('keydown', e => {
    if (typing() || !S.myName) return;
    if (bench && bench.onKey(e)) return;
    const k = e.key.toLowerCase();
    if (k === 'h' && !e.repeat) { setShared({ on: !shared.on }); return; }
    if (k === 'r' && !e.ctrlKey) { setFov(BASE_FOV); pitch = -0.08; return; }
    if (['w', 'a', 's', 'd', 'c', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'shift'].includes(k)) {
      keys.add(k);
      if (k.startsWith('arrow') || k === ' ') e.preventDefault();
    }
  });
  window.addEventListener('keyup', e => { if (bench) bench.onKey(e); keys.delete(e.key.toLowerCase()); });
  window.addEventListener('blur', () => keys.clear());
  function keyWalk(dt) {
    if (!keys.size || typing()) return 0;
    if (keys.has('arrowleft')) yaw += 1.8 * dt;
    if (keys.has('arrowright')) yaw -= 1.8 * dt;
    const f = (keys.has('w') || keys.has('arrowup') ? 1 : 0) - (keys.has('s') || keys.has('arrowdown') ? 1 : 0);
    const sd = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
    if (!f && !sd) return 0;
    let mx = -Math.sin(yaw) * f + Math.cos(yaw) * sd, mz = -Math.cos(yaw) * f - Math.sin(yaw) * sd;
    const len = Math.hypot(mx, mz); mx /= len; mz /= len;
    me.tx = me.tz = null; marker.visible = false;
    [me.x, me.z] = clampSpot(me.x + mx * WALK * dt, me.z + mz * WALK * dt);
    sendSpot(false);
    return WALK * dt;
  }
  canvas.addEventListener('wheel', e => { e.preventDefault(); setFov(camera.fov + e.deltaY * 0.03); }, { passive: false });

  // ---------- Mouse / touch ----------
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let down = null, lastX = 0, lastY = 0;
  function shown(o) { for (; o; o = o.parent) if (!o.visible) return false; return true; }
  function hitsAt(e) {
    pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(scene.children, true).filter(h => shown(h.object) && !h.object.userData.avatar && h.object !== marker
      && !h.object.isSprite && !h.object.isLine && !(h.object.material && h.object.material.blending === THREE.AdditiveBlending));
  }
  function pickUnder(hits) {
    const hit = hits[0];
    if (!hit) return null;
    const u = hit.object.userData;
    if (u.portalFrame) return { portalFrame: true };
    if (u.floor) return { floor: hit.point };
    return null;
  }
  const touchPts = new Map();
  let pinchDist = 0;
  const pinchSpread = () => { const [a, b] = [...touchPts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  canvas.addEventListener('pointerdown', e => {
    if (document.activeElement && document.activeElement.tagName === 'INPUT') document.activeElement.blur();
    touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touchPts.size === 2) { pinchDist = pinchSpread(); down = null; return; }
    down = { x: e.clientX, y: e.clientY };
    lastX = e.clientX; lastY = e.clientY;
  });
  const endTouch = e => { touchPts.delete(e.pointerId); if (touchPts.size < 2) pinchDist = 0; };
  window.addEventListener('pointercancel', e => { down = null; endTouch(e); });
  window.addEventListener('pointermove', e => {
    if (touchPts.has(e.pointerId)) touchPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touchPts.size === 2 && pinchDist > 0) { const d = pinchSpread(); if (d > 0) setFov(camera.fov * pinchDist / d); pinchDist = d; return; }
    if (down) {   // (drag to look: the view follows the mouse)
      const k = 0.004 * (camera.fov / BASE_FOV);
      yaw -= (e.clientX - lastX) * k;
      pitch = Math.max(-1.3, Math.min(1.3, pitch - (e.clientY - lastY) * k));
    }
    lastX = e.clientX; lastY = e.clientY;
    if (!down && e.target === canvas && !PHONE) {
      const hits = hitsAt(e);
      const p = pickUnder(hits);
      canvas.style.cursor = (bench && bench.hover(hits)) || (p ? 'pointer' : 'grab');
    }
  });
  window.addEventListener('pointerup', e => {
    const wasTap = down && e.target === canvas && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6;
    down = null;
    endTouch(e);
    if (!wasTap || !S.myName) return;
    const hits = hitsAt(e);
    if (bench && bench.click(hits, me)) return;
    if (bench && bench.editing) return;
    const p = pickUnder(hits);
    if (!p) return;
    if (p.portalFrame) goGallery();
    else if (p.floor) walkTo(p.floor.x, p.floor.z);
  });
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    bloom.setSize(window.innerWidth, window.innerHeight);
  });

  // ---------- The frame loop ----------
  const clock = new THREE.Clock();
  const size = new THREE.Vector2();
  const feet = [];
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1), t = clock.elapsedTime;
    if (bench && bench.editing) bench.fly(dt, keys, yaw, pitch);
    else {
      let went = keyWalk(dt);
      if (me.tx != null) {
        const dx = me.tx - me.x, dz = me.tz - me.z, d = Math.hypot(dx, dz), step = Math.min(d, WALK * dt);
        if (d > 0.001) { me.x += dx / d * step; me.z += dz / d * step; went += step; }
        if (d - step < 0.001) { me.x = me.tx; me.z = me.tz; me.tx = me.tz = null; }
      }
      if (holo.amount < 0.45) {   // (the scene's going: anyone out on the water glides back inside the walls)
        const [cx, cz] = clampSpot(me.x, me.z);
        if (Math.hypot(cx - me.x, cz - me.z) > 0.01) { me.x += (cx - me.x) * Math.min(1, dt * 3); me.z += (cz - me.z) * Math.min(1, dt * 3); went += 0.01; sendSpot(false); }
      }
      me.phase += went * 4.2;
      me.moving += ((went > 0 ? 1 : 0) - me.moving) * Math.min(1, dt * 8);
      camera.position.set(me.x, EYE + Math.abs(Math.sin(me.phase)) * 0.04 * me.moving, me.z);
      camera.rotation.set(pitch, yaw, 0);
    }
    if (marker.visible && me.tx == null) {
      markerFade -= dt * 2.5;
      marker.material.opacity = Math.max(0, markerFade) * 0.8;
      if (markerFade <= 0) marker.visible = false;
    } else if (marker.visible) marker.material.opacity = 0.8;
    moveAvatars(dt);
    // the holodeck: forming or taking down, the room fading the other way, ripples where everyone stands
    feet.length = 0;
    if (!(bench && bench.editing)) feet.push({ x: me.x, z: me.z, s: 0.3 + 0.7 * me.moving });
    for (const a of Object.values(avatars)) if (a.g.visible && feet.length < 8) feet.push({ x: a.g.position.x, z: a.g.position.z, s: 0.3 + 0.7 * (a.walking || 0) });
    holo.update(dt, t, camera.position, feet);
    fadeRoom(holo.roomFade);
    if (holo.formed && !wasFormed) reflect(200);        // (the scene's all round you: things reflect it)
    if (!holo.group.visible && !wasGone) reflect(60);   // (back in the room: they reflect the room again)
    wasFormed = holo.formed; wasGone = !holo.group.visible;
    if (bench) bench.update(dt, t);
    portal.update(t);
    renderer.getDrawingBufferSize(size);
    tubeMat.uniforms.viewHeight.value = knotMat.uniforms.viewHeight.value = size.y;
    composer.render();
  });

  // ---------- Coming in: everything drawn once behind start.js's cover, then the cover fades ----------
  const frames = n => new Promise(r => { const f = () => (--n <= 0 ? r() : window.requestAnimationFrame(f)); window.requestAnimationFrame(f); });
  (async () => {
    reflect(0);
    await frames(4);
    renderer.compile(scene, camera);
    composer.render();
    await frames(2);
    window.dispatchEvent(new Event('room-ready'));
  })();
}
// >>>>> END OF FILE: HangoutRoom/maker/room.js <<<<<
