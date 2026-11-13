// =====================================================================
// portal.js — the way home: a little swirling orb on a gold stand in each room that takes you back to the Cave,
// and the trip itself (a whoosh, a white flash, a fade to black, then the Cave fades in from black).
// The rooms use it for the portal, the 🚪 Leave button and the door. It shares orb.png with the Cave.
// =====================================================================
import * as THREE from 'three';
import { scene, camera, goldMat } from './core.js';
import { sfx } from './sounds.js';

const OX = 0.502, OY = 0.49, OR = 0.39;   // where the glass ball sits in orb.png (the same numbers the Cave uses)
const R = 0.24, ORB_Y = 1.32;             // the ball's size, and how high it floats

function gradientTex(size, stops) {   // a round glow, from the middle out
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, col] of stops) grd.addColorStop(at, col);
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function glow(map, opacity) {
  return new THREE.MeshBasicMaterial({ map, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
}

// ---------- The portal: one per room, standing on the floor at x, z ----------
export function makePortal(x, z) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  scene.add(g);
  // The gold stand: a round foot, a slim column and a ring at the top that the ball floats above
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.05, 48), goldMat);
  foot.position.y = 0.025;
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.95, 24), goldMat);
  column.position.y = 0.5;
  const cup = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.012, 12, 48), goldMat);
  cup.rotation.x = Math.PI / 2; cup.position.y = 0.98;
  for (const m of [foot, column, cup]) m.castShadow = true;
  g.add(foot, column, cup);
  // A soft purple and warm pool of light on the floor around it
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8),
    glow(gradientTex(128, [[0, 'rgb(255,200,150)'], [0.3, 'rgb(120,80,220)'], [1, 'rgb(0,0,0)']]), 0.35));
  pool.rotation.x = -Math.PI / 2; pool.position.y = 0.004;
  g.add(pool);
  const light = new THREE.PointLight(0xa070ff, 1.2, 3.2, 2);   // it lights up the room around it a little
  light.position.y = ORB_Y;
  g.add(light);

  // The ball: always turned to face you, like the Cave's orb, with the galaxy swirling inside
  const ball = new THREE.Group();
  ball.position.y = ORB_Y;
  g.add(ball);
  const swirlCv = document.createElement('canvas'); swirlCv.width = swirlCv.height = 512;
  const sg = swirlCv.getContext('2d');
  sg.fillStyle = '#1a1850'; sg.fillRect(0, 0, 512, 512);   // deep blue until the picture loads
  const swirlTex = new THREE.CanvasTexture(swirlCv);
  swirlTex.colorSpace = THREE.SRGBColorSpace; swirlTex.center.set(0.5, 0.5);
  const swirl2Tex = swirlTex.clone(); swirl2Tex.center.set(0.5, 0.5); swirl2Tex.repeat.set(0.85, 0.85);
  const img = new Image();
  img.onload = () => {   // cut the ball out of the picture, a touch bigger than the clip so its edge stays hidden
    const w = img.width, h = img.height, r = OR * 0.96;
    sg.drawImage(img, (OX - r) * w, (OY - r) * h, r * 2 * w, r * 2 * h, 0, 0, 512, 512);
    swirlTex.needsUpdate = true; swirl2Tex.needsUpdate = true;
  };
  img.src = new URL('lobby/orb.png', import.meta.url).href;
  const face = new THREE.Mesh(new THREE.CircleGeometry(R, 64), new THREE.MeshBasicMaterial({ map: swirlTex, toneMapped: false }));
  const face2 = new THREE.Mesh(new THREE.CircleGeometry(R, 64), glow(swirl2Tex, 0.28));   // a second, faster swirl turning the other way
  face2.position.z = 0.001;
  const shade = new THREE.Mesh(new THREE.CircleGeometry(R, 64), new THREE.MeshBasicMaterial({   // darker toward the edge, so it reads as a ball
    map: gradientTex(128, [[0, 'rgba(8,8,40,0)'], [0.62, 'rgba(8,8,40,0)'], [1, 'rgba(8,8,40,0.55)']]), transparent: true, depthWrite: false, toneMapped: false }));
  shade.position.z = 0.002;
  const core = new THREE.Mesh(new THREE.CircleGeometry(R * 0.5, 48), glow(gradientTex(128, [[0, 'rgb(255,225,190)'], [1, 'rgb(0,0,0)']]), 0.6));   // the warm glow in the middle
  core.position.z = 0.003;
  const shine = new THREE.Mesh(new THREE.CircleGeometry(R * 0.55, 48), glow(gradientTex(128, [[0, 'rgb(150,150,150)'], [1, 'rgb(0,0,0)']]), 1));   // the glass shine
  shine.position.set(-R * 0.38, R * 0.45, 0.004);
  const rim = new THREE.Mesh(new THREE.RingGeometry(R, R * 1.025, 64), new THREE.MeshBasicMaterial({ color: 0xcde6ff, transparent: true, opacity: 0.55, toneMapped: false }));
  rim.position.z = 0.004;
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(R * 5.2, R * 5.2),
    glow(gradientTex(256, [[0, 'rgb(170,120,255)'], [0.25, 'rgb(110,70,230)'], [0.55, 'rgb(40,25,90)'], [1, 'rgb(0,0,0)']]), 0.55));
  halo.position.z = -0.01;
  ball.add(halo, face, face2, shade, core, shine, rim);
  [face2, shade, core, shine, rim].forEach((m, i) => { m.renderOrder = i + 1; });   // the see-through layers, back to front
  g.traverse(o => { if (o.isMesh) o.userData.portal = true; });   // clicking any of it takes you home

  let t = 0;
  return {
    update(dt) {   // call every frame
      t += dt;
      ball.quaternion.copy(camera.quaternion);                // face the camera
      ball.position.y = ORB_Y + Math.sin(t * 1.1) * 0.02;     // bob gently
      swirlTex.rotation = t * 0.35;
      swirl2Tex.rotation = -t * 0.8;
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.6);
      halo.material.opacity = 0.45 + pulse * 0.2;
      core.material.opacity = 0.45 + pulse * 0.3;
      light.intensity = 1.0 + pulse * 0.4;
    }
  };
}

// ---------- The trip home ----------
// leaving() runs right away (stand up, drop the pen, say you've left) and can hand back a promise; the page reloads
// once the screen is black and that's done (or after a moment, if the connection is slow).
let going = false;
export function travelHome(leaving) {
  if (going) return;
  going = true;
  sfx.whoosh();
  const veil = (color, secs) => {
    const v = document.createElement('div');
    v.style.cssText = `position:fixed;inset:0;z-index:100;background:${color};opacity:0;transition:opacity ${secs}s ease-in;pointer-events:auto`;
    document.body.appendChild(v);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => { v.style.opacity = '1'; }));
  };
  veil('radial-gradient(circle, #ffffff 0%, #fff6ec 55%, #f2e6ff 100%)', 0.55);   // the white flash
  setTimeout(() => veil('#000', 0.45), 550);                                      // then black
  let done;
  try { done = Promise.resolve(leaving && leaving()).catch(() => {}); } catch (e) { done = Promise.resolve(); }
  const dark = new Promise(r => setTimeout(r, 1050));
  const slow = new Promise(r => setTimeout(r, 2500));
  Promise.race([Promise.all([done, dark]), slow]).then(() => {
    try { sessionStorage.setItem('caveFadeIn', '1'); } catch (e) {}   // the Cave fades in from black when it loads
    location.reload();
  });
}