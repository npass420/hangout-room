// =====================================================================
// entrance.js — the way into a room. Outside the entry wall stands the front of the building (a Kindroid picture),
// and its double doors are cut out of the picture as real, solid doors: they swing open as you walk in and shut behind you.
// Inside the room, the same picture's surround (the carved frame around the doorway) is set around the doors and fades
// softly into the wall, with a warm light above, so the inside matches the outside.
// Each room gives its picture and where things sit in it; the rooms call setOpen() during their walk in.
// =====================================================================
import * as THREE from 'three';
import { scene } from './core.js';

const THICK = 0.05;   // how thick the doors are

// How far the surround reaches out from the doorway's middle, in meters, so the room can stop its rails and baseboards at it
export function doorSpan(spec) {
  const d = spec.door, S = spec.height / (d.bottom - d.top);
  return ((d.x1 - d.x0) / 2 + spec.casing.side) * S;
}

// spec: { file (the picture), x, z (the doorway's middle on the entry wall), height (of the doors), roomHalf, roomHeight,
//         door: { x0, x1, top, bottom, spring } where the doors sit in the picture, as parts of its size (spring: where a
//         round top starts curving; leave it out for square doors),
//         casing: { side, top } how much of the picture around the doorway makes the surround inside,
//         edge: the color of the doors' edges }
export function makeEntrance(spec) {
  const d = spec.door, S = spec.height / (d.bottom - d.top);   // the picture's size in meters
  const W = (d.x1 - d.x0) * S, Hd = spec.height, lw = W / 2, arched = d.spring != null;
  const springH = arched ? (d.bottom - d.spring) * S : Hd, archH = arched ? (d.spring - d.top) * S : 0;
  const mid = (d.x0 + d.x1) / 2;
  // The doorway's outline, in pixels of a canvas showing the picture (or part of it): straight sides, round or square top
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

  // ---- Outside: the front of the building, facing out, with the doorway cut out of it ----
  const P = 2048;
  const front = document.createElement('canvas'); front.width = front.height = P;
  const frontMat = new THREE.MeshBasicMaterial({ color: 0x000000, alphaTest: 0.5, toneMapped: false });
  const facade = new THREE.Mesh(new THREE.PlaneGeometry(S, S), frontMat);
  facade.position.set(spec.x + (0.5 - mid) * S, (d.bottom - 0.5) * S, spec.z + 0.012);
  scene.add(facade);
  {   // dark wall all around the picture, out past the corners of the room (only seen on the way in)
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

  // ---- The two doors: solid slabs, each cut to its half of the doorway, hung on its outer edge ----
  // Each half's shape, in meters, 0 to lw across (the doorway's middle is at lw for the left door, at 0 for the right)
  function halfShape(left) {
    const sh = new THREE.Shape();
    if (!arched) { sh.moveTo(0, 0); sh.lineTo(lw, 0); sh.lineTo(lw, Hd); sh.lineTo(0, Hd); sh.lineTo(0, 0); return sh; }
    if (left) {
      sh.moveTo(0, 0); sh.lineTo(lw, 0); sh.lineTo(lw, springH + archH);
      sh.absellipse(lw, springH, lw, archH, Math.PI / 2, Math.PI, false);   // the curve down to the hinge side
      sh.lineTo(0, 0);
    } else {
      sh.moveTo(0, 0); sh.lineTo(lw, 0); sh.lineTo(lw, springH);
      sh.absellipse(0, springH, lw, archH, 0, Math.PI / 2, false);          // the curve up to the middle
      sh.lineTo(0, 0);
    }
    return sh;
  }
  const edgeMat = new THREE.MeshStandardMaterial({ color: spec.edge, roughness: 0.55 });
  const leaves = [], leafPics = [];
  for (const s of [-1, 1]) {   // left, right
    const left = s < 0;
    const hinge = new THREE.Group();
    hinge.position.set(spec.x + s * lw, 0, spec.z - 0.02);
    scene.add(hinge);
    const c = document.createElement('canvas'); c.width = 512; c.height = Math.round(512 * Hd / lw);
    const tex = canvasTex(c);
    tex.repeat.set(1 / lw, 1 / Hd);   // the shapes are measured in meters; the picture covers the whole half
    const shape = halfShape(left);
    const slab = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: THICK, bevelEnabled: false, curveSegments: 40 }),
      [new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }), edgeMat]);   // the side facing into the room, and the edges
    const face = new THREE.Mesh(new THREE.ShapeGeometry(shape, 40), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));   // the side you see from outside
    const holder = new THREE.Group();
    holder.position.x = left ? 0 : -lw;   // the right door reaches back toward the middle from its hinge
    slab.position.z = -THICK - 0.001;
    holder.add(slab, face);
    for (const m of [slab, face]) { m.userData.door = true; m.castShadow = true; }
    hinge.add(holder);
    leaves.push({ hinge, s });
    leafPics.push({ c, tex, left });
  }

  // ---- Inside: the surround from the picture, set around the doorway and fading into the wall ----
  const cs = spec.casing;
  const cx0 = d.x0 - cs.side, cx1 = d.x1 + cs.side, ctop = d.top - cs.top;   // the part of the picture it uses
  const cw = (cx1 - cx0) * S, ch = (d.bottom - ctop) * S;
  const casingCanvas = document.createElement('canvas');
  casingCanvas.width = 1024; casingCanvas.height = Math.round(1024 * ch / cw);
  const casingMat = new THREE.MeshStandardMaterial({ map: canvasTex(casingCanvas), transparent: true, roughness: 0.6, visible: false });
  const casing = new THREE.Mesh(new THREE.PlaneGeometry(cw, ch), casingMat);
  casing.rotation.y = Math.PI;   // facing into the room
  casing.position.set(spec.x, ch / 2, spec.z - THICK - 0.03);
  casing.userData.door = true;
  scene.add(casing);
  // A warm light just inside, above the doorway, so the doors and their surround show their wood and gold
  const glow = new THREE.PointLight(0xffd29a, 5, 4.5, 2);
  glow.position.set(spec.x, Hd + 0.35, spec.z - 0.9);
  scene.add(glow);

  // ---- The picture arrives: cut the doorway out of the front, give each door its half, make the surround ----
  const loaded = new Promise(done => {
    const img = new Image();
    img.onload = () => {
      const N = img.width;
      const g = front.getContext('2d');
      g.drawImage(img, 0, 0, P, P);
      g.globalCompositeOperation = 'destination-out';
      outline(g, P, 0, 0); g.fill();
      frontMat.map = canvasTex(front); frontMat.color.setHex(0xffffff); frontMat.needsUpdate = true;
      for (const lp of leafPics) {   // this door's half of the doorway
        const lg = lp.c.getContext('2d');
        lg.drawImage(img, (lp.left ? d.x0 : mid) * N, d.top * N, (d.x1 - d.x0) / 2 * N, (d.bottom - d.top) * N, 0, 0, lp.c.width, lp.c.height);
        lp.tex.needsUpdate = true;
      }
      // The surround: its part of the picture, with the doorway cut out and the sides and top fading away into the wall
      const cg = casingCanvas.getContext('2d'), CW = casingCanvas.width, CH = casingCanvas.height;
      cg.drawImage(img, cx0 * N, ctop * N, (cx1 - cx0) * N, (d.bottom - ctop) * N, 0, 0, CW, CH);
      cg.globalCompositeOperation = 'destination-out';
      const k = CW / (cx1 - cx0);
      outline(cg, k, cx0 * k, ctop * k); cg.fill();
      const fadeSide = CW * 0.16, fadeTop = CH * 0.1;
      for (const [x0, x1] of [[0, fadeSide], [CW, CW - fadeSide]]) {
        const grd = cg.createLinearGradient(x0, 0, x1, 0);
        grd.addColorStop(0, 'rgba(0,0,0,1)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
        cg.fillStyle = grd; cg.fillRect(Math.min(x0, x1), 0, fadeSide, CH);
      }
      const grd = cg.createLinearGradient(0, 0, 0, fadeTop);
      grd.addColorStop(0, 'rgba(0,0,0,1)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
      cg.fillStyle = grd; cg.fillRect(0, 0, CW, fadeTop);
      casingMat.map.needsUpdate = true; casingMat.visible = true;
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