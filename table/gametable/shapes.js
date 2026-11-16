// ===================================================================================================================
// Workshop/pieces/shapes.js: shapes and tools the pieces share.
// squareSweep: a shape drawn across (out from the middle, and up) carried round all four sides of a square, its
//   corners very slightly rounded, meeting itself in a clean line at each corner. The checkerboard's top and border
//   and the table's top are made this way.
// wrapStone: lays a picture over a piece like a wrapping, so the pattern carries on over every edge and corner.
// VERSION 1
// ===================================================================================================================

// corners: [[out from the middle, height, how much to round this corner], ...], in order across the shape.
// The surface faces the side the shape turns toward (up when it runs outward, outward when it runs down).
export function squareSweep(THREE, corners) {
  const prof = [];   // the shape across, with each rounded corner made a short curve between its two straight runs
  corners.forEach(([r, y, round], i) => {
    if (!round || i === 0 || i === corners.length - 1) { prof.push([r, y]); return; }
    const [pr, py] = corners[i - 1], [nr, ny] = corners[i + 1];
    const lp = Math.hypot(pr - r, py - y), ln = Math.hypot(nr - r, ny - y);
    const a = [r + (pr - r) * round / lp, y + (py - y) * round / lp], c = [r + (nr - r) * round / ln, y + (ny - y) * round / ln];
    for (let k = 0; k <= 6; k++) {
      const t = k / 6, u = 1 - t;
      prof.push([u * u * a[0] + 2 * u * t * r + t * t * c[0], u * u * a[1] + 2 * u * t * y + t * t * c[1]]);
    }
  });
  const pn = prof.map((p, i) => {   // which way the surface faces at each point of the shape
    const q = prof[Math.max(0, i - 1)], w = prof[Math.min(prof.length - 1, i + 1)];
    const dr = w[0] - q[0], dy = w[1] - q[1], l = Math.hypot(dr, dy) || 1;
    return [-dy / l, dr / l];
  });
  const pos = [], nrm = [];
  for (const [dx, dz] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {   // each side's outward direction
    const tx = -dz, tz = dx;   // along the side
    const at = (i, e) => [dx * prof[i][0] + tx * e * prof[i][0], prof[i][1], dz * prof[i][0] + tz * e * prof[i][0]];
    const nm = i => [dx * pn[i][0], pn[i][1], dz * pn[i][0]];
    for (let i = 0; i < prof.length - 1; i++) {
      const v = [at(i, -1), at(i, 1), at(i + 1, 1), at(i + 1, -1)], n = [nm(i), nm(i), nm(i + 1), nm(i + 1)];
      for (const tri of [[0, 1, 2], [0, 2, 3]]) {
        const [A, B, C] = tri.map(j => v[j]);   // (each triangle turned to face the right way)
        const cx = (B[1] - A[1]) * (C[2] - A[2]) - (B[2] - A[2]) * (C[1] - A[1]);
        const cy = (B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]);
        const cz = (B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]);
        if (Math.hypot(cx, cy, cz) < 1e-12) continue;   // (where the shape meets the middle, a side's triangle is nothing)
        const want = n[tri[0]], order = cx * want[0] + cy * want[1] + cz * want[2] >= 0 ? tri : [tri[0], tri[2], tri[1]];
        for (const j of order) { pos.push(...v[j]); nrm.push(...n[j]); }
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(pos.length / 3 * 2).fill(0), 2));
  return geo;
}

// Flat faces take the picture from above, standing faces from the side. span: how many meters the whole picture
// covers; lift: added to the height first; grainUp: on standing faces, run the picture's width up and down (for wood
// grain along a leg).
export function wrapStone(geo, span, lift = 0, grainUp = false) {
  const pos = geo.attributes.position, nrm = geo.attributes.normal, uv = geo.attributes.uv;
  for (let j = 0; j < pos.count; j++) {
    const x = pos.getX(j), y = pos.getY(j) + lift, z = pos.getZ(j);
    const nx = Math.abs(nrm.getX(j)), ny = Math.abs(nrm.getY(j)), nz = Math.abs(nrm.getZ(j));
    const across = nx > nz ? -z : x;
    if (ny >= Math.max(nx, nz)) uv.setXY(j, 0.5 + x / span, 0.5 - z / span);
    else if (grainUp) uv.setXY(j, 0.5 + y / span, 0.5 + across / span);
    else uv.setXY(j, 0.5 + across / span, 0.5 + y / span);
  }
  uv.needsUpdate = true;
}
// ===================================================================================================================
// END OF Workshop/pieces/shapes.js
// ===================================================================================================================
