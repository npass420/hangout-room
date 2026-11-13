// =====================================================================
// entrance.js — the way into a room. Outside the entry wall stands the front of the building (a Kindroid picture),
// and its double doors are cut out of the picture as real doors: they swing open as you walk in and shut behind you.
// From inside the room you see the same doors (a little darker) in a frame around the doorway.
// Each room gives its picture and where the doors sit in it; the rooms call setOpen() during their walk in.
// =====================================================================
import * as THREE from 'three';
import { scene } from './core.js';

// How wide the doorway is in the room (with its frame), so the room can stop its rails and baseboards at it
export function doorSpan(spec) {
  const d = spec.door, S = spec.height / (d.bottom - d.top);
  return (d.x1 - d.x0) * S / 2 + FRAME;
}
const FRAME = 0.12;   // how wide the frame around the doorway is, inside the room

// spec: { file (the picture, next to the room's file), x, z (the doorway's middle on the entry wall), height (of the doors),
//         door: { x0, x1, top, bottom, spring } where the doors sit in the picture, as parts of its size (spring: where a
//         round top starts curving; leave it out for square doors), frameMat (the frame inside the room) }
export function makeEntrance(spec) {
  const d = spec.door, S = spec.height / (d.bottom - d.top);   // the picture's size in meters
  const W = (d.x1 - d.x0) * S, Hd = spec.height, arched = d.spring != null;
  const springH = arched ? (d.bottom - d.spring) * S : Hd, archH = arched ? (d.spring - d.top) * S : 0;
  const mid = (d.x0 + d.x1) / 2;
  // The door's outline, in pixels of a canvas showing the picture (or part of it): straight sides, round or square top
  function outline(g, px, offX, offY) {
    const X0 = d.x0 * px - offX, X1 = d.x1 * px - offX, B = d.bottom * px - offY, T = d.top * px - offY;
    g.beginPath();
    g.moveTo(X0, B);
    if (arched) {
      const Sy = d.spring * px - offY;
      g.lineTo(X0, Sy);
      g.ellipse((X0 + X1) / 2, Sy, (X1 - X0) / 2, Sy - T, 0, Math.PI, Math.PI * 2);
    } else { g.lineTo(X0, T); g.lineTo(X1, T); }
    g.lineTo(X1, B);
    g.closePath();
  }
  function canvasTex(c) {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    return t;
  }

  // The front of the building, facing out, with the doorway cut out of it
  const P = 2048;
  const front = document.createElement('canvas'); front.width = front.height = P;
  const frontMat = new THREE.MeshBasicMaterial({ color: 0x000000, alphaTest: 0.5, toneMapped: false });
  const facade = new THREE.Mesh(new THREE.PlaneGeometry(S, S), frontMat);
  facade.position.set(spec.x + (0.5 - mid) * S, (d.bottom - 0.5) * S, spec.z + 0.012);
  scene.add(facade);
  // Dark wall all around the picture, out to the corners of the room (only seen on the way in)
  {
    const dark = new THREE.MeshBasicMaterial({ color: 0x050403 });
    const fx = facade.position.x, fy = facade.position.y, L = -spec.roomHalf, R = spec.roomHalf, top = spec.roomHeight + 1, low = -3;
    const side = (x0, x1, y0, y1) => {
      if (x1 <= x0 || y1 <= y0) return;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, y1 - y0), dark);
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, spec.z + 0.014);
      scene.add(m);
    };
    side(L - 2, fx - S / 2 + 0.01, low, top);              // left of the picture
    side(fx + S / 2 - 0.01, R + 2, low, top);              // right of it
    side(fx - S / 2, fx + S / 2, fy + S / 2 - 0.01, top);  // above it
    side(fx - S / 2, fx + S / 2, low, fy - S / 2 + 0.01);  // below it
  }

  // The two doors: each half of the doorway, cut out of the picture, hung on its outer edge
  const leaves = [];
  const leafFront = [], leafBack = [];
  for (const s of [-1, 1]) {   // left, right
    const lw = W / 2;
    const hinge = new THREE.Group();
    hinge.position.set(spec.x + s * W / 2, 0, spec.z - 0.02);
    scene.add(hinge);
    const c = document.createElement('canvas'); c.width = 512; c.height = Math.round(512 * Hd / lw);
    const tex = canvasTex(c);
    const geo = new THREE.PlaneGeometry(lw, Hd);
    const outMat = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, toneMapped: false });   // the side you see from outside
    const inMat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, color: 0x8c8c8c, roughness: 0.6 });   // the side facing into the room
    const o = new THREE.Mesh(geo, outMat), i = new THREE.Mesh(geo, inMat);
    o.position.set(-s * lw / 2, Hd / 2, 0.012);
    i.position.set(-s * lw / 2, Hd / 2, -0.012); i.rotation.y = Math.PI;
    for (const m of [o, i]) { m.userData.door = true; m.castShadow = true; hinge.add(m); }
    leaves.push({ hinge, s });
    leafFront.push({ c, tex, left: s < 0 });
  }

  // The frame around the doorway, inside the room
  {
    const shape = new THREE.Shape(), hole = new THREE.Path(), F = FRAME, rx = W / 2;
    const ring = (p, w, grow) => {
      p.moveTo(-w, 0);
      if (arched) { p.lineTo(-w, springH); p.absellipse(0, springH, w, archH + grow, Math.PI, 0, true); }
      else { p.lineTo(-w, Hd + grow); p.lineTo(w, Hd + grow); }
      p.lineTo(w, 0);
      p.lineTo(-w, 0);
    };
    ring(shape, rx + F, F);
    ring(hole, rx, 0);
    shape.holes.push(hole);
    const frame = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: false, curveSegments: 32 }), spec.frameMat);
    frame.position.set(spec.x, 0, spec.z - 0.07);
    frame.userData.door = true;
    frame.castShadow = true;
    scene.add(frame);
  }

  // The picture arrives: the front gets its doorway cut out, and each door gets its half
  const loaded = new Promise(done => {
    const img = new Image();
    img.onload = () => {
      const g = front.getContext('2d');
      g.drawImage(img, 0, 0, P, P);
      g.globalCompositeOperation = 'destination-out';
      outline(g, P, 0, 0); g.fill();
      frontMat.map = canvasTex(front); frontMat.color.setHex(0xffffff); frontMat.needsUpdate = true;
      for (const lf of leafFront) {   // this door's half of the doorway, shaped to the doorway's top
        const lg = lf.c.getContext('2d'), N = img.width;
        const sx0 = (lf.left ? d.x0 : mid) * N, sw = (d.x1 - d.x0) / 2 * N;
        lg.drawImage(img, sx0, d.top * N, sw, (d.bottom - d.top) * N, 0, 0, lf.c.width, lf.c.height);
        lg.globalCompositeOperation = 'destination-in';
        const k = lf.c.width / ((d.x1 - d.x0) / 2);   // canvas pixels per part of the picture
        outline(lg, k, (lf.left ? d.x0 : mid) * k, d.top * k); lg.fill();
        lf.tex.needsUpdate = true;
      }
      done();
    };
    img.onerror = () => { console.warn(spec.file + ' did not load'); frontMat.color.setHex(0x0a0806); done(); };
    img.src = spec.file;
  });

  return {
    loaded,
    setOpen(k) { for (const l of leaves) l.hinge.rotation.y = -l.s * 1.5 * k; }   // 0 shut, 1 swung wide into the room
  };
}