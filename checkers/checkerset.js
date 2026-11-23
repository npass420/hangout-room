// ===================================================================================================================
// >>>>> START OF FILE 1 of 1: Workshop/pieces/checkerset.js <<<<<
// Workshop/pieces/checkerset.js: a set of checkers (checker.js) that move, capture and get crowned, for the game.
// makeCheckerSet(THREE, { materials, glowLayer, listener, lite }) gives back { piece, group, update, dispose } (lite: the
// lighter pieces, for phones in a busy room; see checker.js):
//   piece(x, z, y, size, gem): a checker standing at x, z on a surface at height y; size its width; gem 'crimson' or
//     'violet' (both on onyx discs). It gives back:
//     setKing(on, now): crowned, the whole piece melts into a glowing glass orb (a black onyx band round its middle)
//       that rises to float an inch up, bobbing and slowly rocking, with a soft glow on the board below; off: back to a
//       checker. now: at once, with no rising and no chime (as when you arrive mid game). king: whether it's crowned.
//     toggleKing(): crowns it, or sets it back (gives back which it is now).
//     moveTo(x, z, over): glides it to x, z (a promise, done when it lands). over: a piece it captures on the way.
//       A checker lifts and flies over to hover above it, bobbing up and down, blasts it with its laser, then glides
//       down onto its new square (about 2.3 seconds in all). A king turns on its bigger laser and holds still half a
//       second, then flies across firing, arcing up over the piece and smashing it as it passes, lands, fires a moment
//       more, and stops (about 2.3 seconds too). Without over, just the glide.
//     The laser leaves glowing burn marks on the surface that cool to a dark scorch and fade.
//     blast(): it heats up to glowing white, then explodes in a burst of sparks of its own color.
//     smash(): it flashes white and shatters at once into glitter that lies on the board twinkling.
//     restore(): it grows back.  place(): where it stands.
//   materials: a list to add their materials to (so they reflect the room); update(seconds): call every frame;
//   dispose(): stops every sound and frees everything the set used.
// VERSION 2
// ===================================================================================================================
import { makeChecker } from './checker.js';
import { makeSounds } from './sounds.js';

export function makeCheckerSet(THREE, { materials = [], glowLayer = 1, listener = null, lite = false } = {}) {
  const group = new THREE.Group(), pieces = [], cache = {};
  const sfx = makeSounds(THREE, listener);
  const FLOAT = 0.0254;     // (a king floats an inch off the surface)
  const RISE = 1.6;         // (seconds to melt into an orb and rise)
  const ease = u => { u = Math.min(Math.max(u, 0), 1); return u * u * (3 - 2 * u); };
  let glowTex = null;
  function glowDot() {      // a soft round glow picture, for where the laser hits, the sparks and the king's glow
    if (glowTex) return glowTex;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,0.55)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, 64, 64);
    return (glowTex = new THREE.CanvasTexture(c));
  }

  function piece(x, z, y, size, gem = 'crimson') {
    const look = makeChecker(THREE, { glowLayer }, { size, stone: 'onyx', gem, light: false, cache, lite });
    materials.push(...look.materials);
    const d = look.group, color = look.color, ORB = look.ORB;
    const radius = size * 0.38;   // (the effects' measure: the laser, the marks, the sparks)
    d.position.set(x, y, z);
    group.add(d);

    // a king's glow on the board below it: a soft pool of its color (drawn, not a real light)
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: glowDot(), color: color.clone(), transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -3 }));
    pool.scale.setScalar(ORB * 4.5); pool.userData.noShadow = true; pool.visible = false;
    group.add(pool);

    // the laser: a bright core inside a softer glow, straight down from the piece to the surface, and a glowing dot
    // where it hits; all in the piece's own color, shining into the glow, flickering
    const glowOf = (opacity, white) => new THREE.MeshBasicMaterial({
      color: color.clone().lerp(new THREE.Color(1, 1, 1), white).multiplyScalar(3), transparent: true, opacity,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true).translate(0, -0.5, 0);   // (hangs down from its top)
    const beamOuter = new THREE.Mesh(beamGeo, glowOf(0.35, 0)), beamCore = new THREE.Mesh(beamGeo, glowOf(0.9, 0.55));
    const spot = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: glowDot(), color: color.clone().multiplyScalar(4), transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    const laser = new THREE.Group();
    laser.add(beamOuter, beamCore, spot);
    laser.traverse(o => { o.layers.enable(glowLayer); o.userData.noShadow = true; });   // (light itself casts no shadow)
    laser.visible = false;
    group.add(laser);

    // the burn marks the laser leaves on the surface: each starts glowing hot in the piece's color, cools to a dark
    // scorch, and fades away (a handful at a time, reused in turn)
    const MARKS = 48, MARK_LIFE = 4, marks = [];
    const markGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    for (let i = 0; i < MARKS; i++) {
      const scorch = new THREE.Mesh(markGeo, new THREE.MeshBasicMaterial({ map: glowDot(), color: 0x000000, transparent: true,
        opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
      const hot = new THREE.Mesh(markGeo, new THREE.MeshBasicMaterial({ map: glowDot(), color: color.clone().multiplyScalar(3),
        transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
        polygonOffset: true, polygonOffsetFactor: -2 }));
      hot.layers.enable(glowLayer);
      scorch.userData.noShadow = hot.userData.noShadow = true;
      scorch.visible = hot.visible = false;
      group.add(scorch, hot);
      marks.push({ scorch, hot, born: -1e9 });
    }
    let nextMark = 0, lastMark = null;
    function burn(t, mx, mz) {   // leave a mark here, if the dot has moved on a little (or held still a while) since the last
      if (lastMark && Math.hypot(mx - lastMark.x, mz - lastMark.z) < radius * 0.07 && t - lastMark.t < 0.25) return;
      const m = marks[nextMark]; nextMark = (nextMark + 1) % MARKS;
      const sz = radius * (0.35 + 0.15 * Math.random());
      for (const o of [m.scorch, m.hot]) { o.position.set(mx, y + 0.0004, mz); o.scale.setScalar(sz); o.rotation.y = Math.random() * 6.3; o.visible = true; }
      m.hot.position.y = y + 0.0006;
      m.born = t; lastMark = { x: mx, z: mz, t };
    }
    function cool(t) {
      for (const m of marks) {
        if (!m.scorch.visible) continue;
        const u = (t - m.born) / MARK_LIFE;
        if (u >= 1) { m.scorch.visible = m.hot.visible = false; continue; }
        m.hot.material.opacity = Math.max(0, 1 - u * 3.2) ** 1.5;       // (glowing hot, cooling fast)
        m.scorch.material.opacity = 0.6 * Math.min(1, u * 6) * (1 - u);   // (the dark scorch, lasting longer)
      }
    }

    // the sparks it bursts into when blasted
    const SPARKS = 320, sparkPos = new Float32Array(SPARKS * 3), sparkVel = [];
    const sparkGeo = new THREE.BufferGeometry(); sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
    const sparkMat = new THREE.PointsMaterial({ map: glowDot(), color: color.clone().multiplyScalar(4), size: radius * 0.12,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const sparks = new THREE.Points(sparkGeo, sparkMat);
    sparks.layers.enable(glowLayer); sparks.frustumCulled = false;
    sparkGeo.setDrawRange(0, 0);   // (always there, drawing none until it bursts: so it's ready to draw, with no stall)
    group.add(sparks);

    // the glitter it shatters into when smashed: shards flying out white, turning back to its own color as they fall,
    // then lying on the board for good, each twinkling in its own time
    const GLITTER = 260, glitPos = new Float32Array(GLITTER * 3), glitCol = new Float32Array(GLITTER * 3), glit = [];
    const glitGeo = new THREE.BufferGeometry();
    glitGeo.setAttribute('position', new THREE.BufferAttribute(glitPos, 3));
    glitGeo.setAttribute('color', new THREE.BufferAttribute(glitCol, 3));
    const glitMat = new THREE.PointsMaterial({ map: glowDot(), vertexColors: true, size: radius * 0.1,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const glitter = new THREE.Points(glitGeo, glitMat);
    glitter.layers.enable(glowLayer); glitter.frustumCulled = false; glitter.userData.noShadow = true;
    glitGeo.setDrawRange(0, 0);   // (drawing none until it shatters)
    group.add(glitter);
    let smashAt = null;

    let king = 0, goal = 0, was = null, bx = x, bz = z, move = null, hit = null, grow = null, burstAt = null;
    // its sounds (made in code: see sounds.js), from where it is; the violet a little deeper than the crimson
    const PITCH = gem === 'violet' ? 0.8 : 1;
    let zapping = null, kingWas = 0, phase = '';
    const sound = (name, o = {}) => sfx.play(name, d, { pitch: PITCH, ...o });
    const heightOf = p => (p.king ? FLOAT + 2 * p.ORB : p.HEIGHT);   // (how tall a piece stands, its top above the board)
    const me = {
      group: d, ORB, HEIGHT: look.HEIGHT,
      get king() { return goal === 1; },
      setKing(on = goal === 0, now = false) {
        goal = on ? 1 : 0;
        if (now) { king = goal; kingWas = goal; }
      },
      toggleKing() { me.setKing(goal === 0); return goal === 1; },
      moveTo(tx, tz, over = null) {
        const target = over ? { piece: over, ...over.place() } : null;
        return new Promise(done => { move = { x0: bx, z0: bz, x1: tx, z1: tz, over: target, start: null, done, struck: false }; });
      },
      blast() { hit = { start: null }; },
      smash() { hit = { start: null, smash: true }; },
      restore() { hit = null; grow = { start: null }; d.visible = true; look.setHeat(0); },
      place: () => ({ x: bx, z: bz }),
      dispose() { if (zapping) { zapping.stop(); zapping = null; } },   // (its held sounds stop)
      tick(t) {
        const dt = was === null ? 0 : Math.min(t - was, 0.1); was = t;
        if (goal !== kingWas) {   // crowned (a rising chime), or set down (a falling one)
          kingWas = goal;
          sound(goal ? 'rise' : 'settle');
        }
        king += Math.sign(goal - king) * Math.min(Math.abs(goal - king), dt / RISE);
        const e = ease(king);
        look.setMorph(e);

        // where it is: resting on its square, or on its way somewhere
        let px = bx, pz = bz, lift = 0, beam = false, big = false;
        if (move) {
          const m = move;
          const first = m.start === null;
          if (first) m.start = t;
          const u = t - m.start, dist = Math.hypot(m.x1 - m.x0, m.z1 - m.z0);
          let finished = false;
          if (goal === 1 && m.over) {   // a king capturing: its bigger laser on, held still half a second; then across, firing,
            // arcing up over the piece (high enough to clear it, even a floating king) and smashing it as it passes; then
            // a moment more firing where it lands, and off
            const CHARGE = 0.5, T = Math.max(1.2, dist / (radius * 8)), AFTER = 0.6;   // (about 2.3 seconds in all)
            const CLEAR = heightOf(m.over.piece) + size * 0.15 - FLOAT;   // (its bottom over the other's top, at the middle)
            big = true; beam = true;
            if (u >= CHARGE && phase !== 'fly') { phase = 'fly'; sound('glide', { length: T }); }
            if (u < CHARGE) { px = m.x0; pz = m.z0; }
            else if (u < CHARGE + T) {
              const v = (u - CHARGE) / T, f = ease(v);
              px = m.x0 + (m.x1 - m.x0) * f; pz = m.z0 + (m.z1 - m.z0) * f;
              lift = CLEAR * Math.sin(Math.PI * f);
            } else { px = m.x1; pz = m.z1; }
            if (!m.struck && u >= CHARGE && Math.hypot(px - m.over.x, pz - m.over.z) < radius * 0.5) { m.struck = true; m.over.piece.smash(); }
            finished = u >= CHARGE + T + AFTER;
          } else if (goal === 1) {   // a king's plain move: straight across at a steady glide, rising a little
            const T = Math.max(1.2, dist / (radius * 5)), f = ease(u / T);
            if (first) sound('glide', { length: T });
            px = m.x0 + (m.x1 - m.x0) * f; pz = m.z0 + (m.z1 - m.z0) * f;
            lift = radius * 0.5 * Math.sin(Math.PI * Math.min(u / T, 1));
            finished = u >= T;
          } else if (m.over) {   // a checker capturing: up and over to hover above it, bobbing up and down as it fires,
            // then down beyond it as its target bursts (about 2.3 seconds in all)
            const UP = 0.7, HOLD = 0.9, DOWN = 0.7, APEX = heightOf(m.over.piece) + size * 0.45;
            const ox = m.over.x, oz = m.over.z;
            if (first) sound('glide', { length: UP });
            if (u >= UP + HOLD && phase !== 'down') { phase = 'down'; sound('glide', { length: DOWN }); }
            if (u < UP) { const f = ease(u / UP); px = m.x0 + (ox - m.x0) * f; pz = m.z0 + (oz - m.z0) * f; lift = APEX * Math.sin(Math.PI / 2 * u / UP); }
            else if (u < UP + HOLD) {
              const h = u - UP;
              px = ox; pz = oz;
              lift = APEX + size * 0.07 * Math.sin(h / HOLD * Math.PI * 3) * Math.sin(Math.PI * h / HOLD);   // (bobbing, easing in and out)
              beam = h > 0.1;
            } else { const f = ease((u - UP - HOLD) / DOWN); px = ox + (m.x1 - ox) * f; pz = oz + (m.z1 - oz) * f; lift = APEX * Math.cos(Math.PI / 2 * Math.min((u - UP - HOLD) / DOWN, 1)); }
            if (!m.struck && u > UP + 0.12) { m.struck = true; m.over.piece.blast(); }
            finished = u >= UP + HOLD + DOWN;
          } else {   // a plain move: a low glide up and over onto the next square
            const T = 1.0, f = ease(u / T);
            if (first) sound('glide', { length: T });
            px = m.x0 + (m.x1 - m.x0) * f; pz = m.z0 + (m.z1 - m.z0) * f;
            lift = radius * 1.2 * Math.sin(Math.PI * Math.min(u / T, 1));
            finished = u >= T;
          }
          if (finished) { bx = m.x1; bz = m.z1; px = bx; pz = bz; lift = 0; move = null; phase = ''; m.done(); }
        }

        // a king rocks and drifts gently as it floats
        const bob = e * 0.004 * Math.sin(t * 2.1);
        d.position.set(px + e * ORB * 0.04 * Math.sin(t * 0.43), y + e * FLOAT + bob + lift, pz + e * ORB * 0.04 * Math.sin(t * 0.37 + 1));
        d.rotation.set(e * 0.07 * Math.sin(t * 0.71), 0, e * 0.06 * Math.sin(t * 0.53 + 1.3));

        // being blasted: it heats up to glowing white, then explodes in a burst of sparks of its own color
        let heat = 0, size1 = 1;
        const HEAT = 1.0;     // (seconds glowing white before it bursts)
        const FLASH = 0.12;   // (seconds flashing white before it shatters, when smashed)
        const middle = () => d.position.y + (e ? ORB : look.HEIGHT * 0.4);
        if (hit && hit.smash) {   // smashed: a quick white flash, then it shatters into glitter
          if (hit.start === null) hit.start = t;
          const u = t - hit.start;
          heat = Math.min(u / FLASH, 1);
          if (u >= FLASH && !hit.burst) {
            hit.burst = t; smashAt = t; d.visible = false; sound('boom'); glitGeo.setDrawRange(0, GLITTER); glit.length = 0;
            const my = middle();
            for (let i = 0; i < GLITTER; i++) {
              const a = Math.random() * Math.PI * 2, up = Math.random() * 1.1 - 0.1, sp = radius * (2 + Math.random() * 6);
              const r2 = Math.sqrt(Math.max(1 - up * up, 0)), at = Math.random() * radius * 0.9;
              glit.push({ v: [Math.cos(a) * r2 * sp, Math.abs(up) * sp, Math.sin(a) * r2 * sp], down: false,
                          ph: Math.random() * 6.3, rate: 1.5 + Math.random() * 3.5 });
              glitPos.set([d.position.x + Math.cos(a) * r2 * at, my + (Math.random() - 0.5) * radius * 0.6, d.position.z + Math.sin(a) * r2 * at], i * 3);
            }
          }
        } else if (hit) {
          if (hit.start === null) { hit.start = t; sound('heat'); }
          const u = t - hit.start;
          heat = ease(u / HEAT);
          if (u >= HEAT && !hit.burst) {   // the burst: the piece gone at once, sparks flying out from all through it
            hit.burst = t; burstAt = t; d.visible = false; sound('boom'); sparkGeo.setDrawRange(0, SPARKS); sparkVel.length = 0;
            const my = middle();
            for (let i = 0; i < SPARKS; i++) {
              const a = Math.random() * Math.PI * 2, up = Math.random() * 1.2 - 0.2, sp = radius * (4 + Math.random() * 9);
              const r2 = Math.sqrt(Math.max(1 - up * up, 0)), at = Math.random() * radius * 0.8;
              sparkVel.push([Math.cos(a) * r2 * sp, Math.abs(up) * sp, Math.sin(a) * r2 * sp]);
              sparkPos.set([d.position.x + Math.cos(a) * r2 * at, my, d.position.z + Math.sin(a) * r2 * at], i * 3);
            }
          }
        }
        if (burstAt !== null) {   // the sparks fly on, whatever the piece does next
          const b = t - burstAt;
          for (let i = 0; i < SPARKS; i++) {
            const v = sparkVel[i];
            v[0] *= 1 - 1.2 * dt; v[2] *= 1 - 1.2 * dt; v[1] -= radius * 22 * dt;
            sparkPos[i * 3] += v[0] * dt; sparkPos[i * 3 + 1] = Math.max(y, sparkPos[i * 3 + 1] + v[1] * dt); sparkPos[i * 3 + 2] += v[2] * dt;
          }
          sparkGeo.attributes.position.needsUpdate = true;
          sparkMat.opacity = 1 - ease(b / 1.6);
          sparkMat.size = radius * (0.16 - 0.08 * Math.min(b / 1.6, 1));
          if (b > 1.6) { sparkGeo.setDrawRange(0, 0); burstAt = null; }
        }
        if (smashAt !== null) {   // the glitter: flying, falling, then lying on the board twinkling (it stays)
          const b = t - smashAt, white = 1 - ease(b / 0.8);   // (white as it shatters, back to its color as it falls)
          for (let i = 0; i < GLITTER; i++) {
            const g = glit[i], j = i * 3;
            if (!g.down) {
              const v = g.v;
              v[0] *= 1 - 1.5 * dt; v[2] *= 1 - 1.5 * dt; v[1] -= radius * 22 * dt;
              glitPos[j] += v[0] * dt; glitPos[j + 1] += v[1] * dt; glitPos[j + 2] += v[2] * dt;
              if (glitPos[j + 1] <= y + 0.0005) { glitPos[j + 1] = y + 0.0005; g.down = true; }
            }
            // in flight, bright; lying on the board, a soft glint, flaring now and then
            const glint = g.down ? 0.35 + 2.4 * Math.pow(Math.max(0, Math.sin(g.ph + t * g.rate)), 12) : 2.5;
            glitCol[j]     = (color.r + (1 - color.r) * white) * glint;
            glitCol[j + 1] = (color.g + (1 - color.g) * white) * glint;
            glitCol[j + 2] = (color.b + (1 - color.b) * white) * glint;
          }
          glitGeo.attributes.position.needsUpdate = true; glitGeo.attributes.color.needsUpdate = true;
          glitMat.size = radius * (0.1 - 0.045 * Math.min(b / 1.2, 1));
        }
        if (!hit && grow) {   // growing back
          if (grow.start === null) grow.start = t;
          size1 = ease((t - grow.start) / 0.5);
          if (t - grow.start > 0.5) grow = null;
        }
        look.setHeat(d.visible ? heat : 0);
        d.scale.setScalar(Math.max(size1, 0.0001));
        pool.visible = d.visible && e > 0.001;
        pool.material.opacity = 0.35 * e;
        pool.position.set(d.position.x, y + 0.0007, d.position.z);

        // the laser: from the piece's underside straight down to the surface, flickering
        laser.visible = beam;
        if (beam && !zapping) zapping = sound('zap', { loop: true, pitch: 1 });   // (the same laser sound for both)
        if (!beam && zapping) { zapping.stop(); zapping = null; }
        if (beam) {
          const from = d.position.y + 0.0005, L = Math.max(from - y, 0.001);
          const fl = 1 + 0.18 * Math.sin(t * 43) + 0.1 * Math.sin(t * 71);
          laser.position.set(d.position.x, 0, d.position.z);
          beamOuter.position.y = beamCore.position.y = from;
          const W = big ? 1.5 : 1;   // (a king's laser: bigger)
          beamOuter.scale.set(radius * 0.11 * W * fl, L, radius * 0.11 * W * fl);
          beamCore.scale.set(radius * 0.035 * W, L, radius * 0.035 * W);
          spot.position.y = y + 0.0008;
          spot.scale.setScalar(radius * 0.9 * W * fl);
          burn(t, d.position.x, d.position.z);
        }
        cool(t);
        if (d.visible) look.update(t);   // (its insides moving)
      },
      free() { look.dispose(); }
    };
    pieces.push(me);
    return me;
  }

  function update(t) { for (const p of pieces) p.tick(t); }
  function dispose() {   // (the whole set taken away: every held sound stops, and everything it used is freed)
    for (const p of pieces) { p.dispose(); p.free(); }
    const done = new Set();
    group.traverse(o => {
      if (o.geometry && !done.has(o.geometry)) { done.add(o.geometry); o.geometry.dispose(); }
      if (o.material && !done.has(o.material)) { done.add(o.material); o.material.dispose(); }
    });
    for (const t of Object.values(cache)) t.dispose();
    if (glowTex) glowTex.dispose();
  }
  return { piece, group, update, dispose };
}
// ===================================================================================================================
// >>>>> END OF FILE 1 of 1: Workshop/pieces/checkerset.js <<<<<
// ===================================================================================================================
