// =====================================================================
// arcadegames.js — the two action games for the arcade cabinets: Bricks and Bug Invaders
// The cabinet code (arcade.js) drives each game through the same few parts:
//   create()               a fresh game
//   step(st, dt, inp, ev)  the player's own screen moves the game on (sound names go into ev)
//   pack(st) / unpack(p)   the small copy sent to Firebase, so people watching see it live
//   drift(st, dt)          watchers keep things moving smoothly between copies
//   draw(g, st, o)         paints the cabinet screen
// =====================================================================
const W = 576, H = 480, TOP = 46;   // the screen's pixels; the score line sits above TOP
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function rr(g, x, y, w, h, r) {   // a rounded box
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function hud(g, st, o, left) {   // the top line: level or wave, the player's name and the score
  o.neon(left, 16, 24, 22, '#7af0ff', 'left');
  o.neon(o.name || '', W / 2, 24, 18, o.color);
  o.neon(`SCORE ${st.sc}`, W - 16, 24, 22, '#ffe36b', 'right');
  g.fillStyle = 'rgba(122,240,255,0.25)';
  g.fillRect(0, TOP - 2, W, 2);
}
function blinkOn(o, ms = 500) { return !o.fancy || Math.floor(o.now / ms) % 2 === 0; }
function messages(g, st, o, what) {   // "LEVEL 2" between boards, and the game over screen
  if (st.ph === 'over') {
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(0, TOP, W, H - TOP);
    o.neon('GAME OVER', W / 2, 190, 52, '#ff4fd8');
    o.neon(`SCORE ${st.sc}`, W / 2, 255, 30, '#ffe36b');
    o.neon(`${what} ${st.lv || st.wv}`, W / 2, 295, 20, 'rgba(255,255,255,0.75)');
    if (blinkOn(o, 600)) o.neon('ENTER OR ▶ TO PLAY AGAIN', W / 2, 360, 18, '#ffffff');
  } else if (st.msgT > 0) {
    o.neon(`${what} ${st.lv || st.wv}`, W / 2, 300, 42, '#ffe36b');
  }
}

// =====================================================================
// BRICKS: bounce the ball off your paddle and knock out every brick
// =====================================================================
const BC = 10, BROWS = 6, BW = 52, BH = 18, BG = 4;
const BX0 = (W - (BC * BW + (BC - 1) * BG)) / 2, BY0 = 80;
const ROW_COL = ['#ff4f6d', '#ff9a3d', '#ffd84a', '#5fe36b', '#4fc3ff', '#b38cff'];
const ROW_PTS = [60, 50, 40, 30, 20, 10];   // the top rows are worth more
const PY = 446, PH = 12, BALL = 7;
const PATTERNS = [   // a different board each level, then they come round again (harder)
  (r, c) => 1,                                                               // a full wall
  (r, c) => Math.abs(c - 4.5) <= 5.2 - r * 0.85,                              // a funnel
  (r, c) => r === 0 || r === 5 || (r + c) % 2 === 0,                          // a checkerboard
  (r, c) => c % 3 !== 1,                                                      // pillars
  (r, c) => r === 0 || r === 5 || c === 0 || c === 9 || ((r === 2 || r === 3) && c >= 3 && c <= 6)   // a frame
];
function bricksFor(lv) {   // from level 2 the top row takes two hits; from level 4 the top two rows do
  const p = PATTERNS[(lv - 1) % PATTERNS.length], tough = lv >= 4 ? 2 : lv >= 2 ? 1 : 0;
  const a = [];
  for (let r = 0; r < BROWS; r++) for (let c = 0; c < BC; c++) a.push(p(r, c) ? (r < tough ? 2 : 1) : 0);
  return a;
}
const padW = lv => Math.max(64, 96 - (lv - 1) * 4);
const ballSpeed = lv => Math.min(520, 300 + (lv - 1) * 28);
function bricksBallMove(st, h) {   // move the ball a little, bouncing off the walls
  st.bx += st.vx * h; st.by += st.vy * h;
  if (st.bx < BALL) { st.bx = BALL; st.vx = Math.abs(st.vx); }
  if (st.bx > W - BALL) { st.bx = W - BALL; st.vx = -Math.abs(st.vx); }
  if (st.by < TOP + BALL) { st.by = TOP + BALL; st.vy = Math.abs(st.vy); }
}
function serveReady(st) { st.held = true; st.serve = 2.2; st.bx = st.px; st.by = PY - BALL - 1; st.vx = 0; st.vy = 0; }

const Bricks = {
  title: 'BRICKS', label: '🧱 Bricks', what: 'LEVEL',
  create() {
    const st = { lv: 1, sc: 0, li: 3, px: W / 2, bx: W / 2, by: PY - BALL - 1, vx: 0, vy: 0, sp: ballSpeed(1),
                 held: true, serve: 2.2, br: bricksFor(1), ph: 'play', msgT: 1.6 };
    return st;
  },
  step(st, dt, inp, ev) {
    if (st.ph !== 'play') return;
    if (st.msgT > 0) st.msgT -= dt;
    const pw = padW(st.lv);
    if (inp.px != null) st.px += clamp(inp.px - st.px, -1200 * dt, 1200 * dt);   // finger or mouse on the screen
    else st.px += ((inp.right ? 1 : 0) - (inp.left ? 1 : 0)) * 560 * dt;         // arrow keys or the ◀ ▶ buttons
    st.px = clamp(st.px, pw / 2, W - pw / 2);
    if (st.held) {   // the ball sits on the paddle until you launch it (or it launches by itself)
      st.bx = st.px; st.by = PY - BALL - 1;
      st.serve -= dt;
      if (inp.fire || st.serve <= 0) {
        const a = (Math.random() - 0.5) * 0.7;
        st.vx = st.sp * Math.sin(a); st.vy = -st.sp * Math.cos(a);
        st.held = false;
        ev.push('disc');
      }
      return;
    }
    const n = Math.max(1, Math.ceil(st.sp * dt / 4)), h = dt / n;   // small steps so the ball can't skip through a brick
    for (let i = 0; i < n; i++) {
      bricksBallMove(st, h);
      // the paddle: where it hits sets the angle it goes back up
      if (st.vy > 0 && st.by + BALL >= PY && st.by - BALL <= PY + PH && Math.abs(st.bx - st.px) <= pw / 2 + BALL) {
        let a = clamp((st.bx - st.px) / (pw / 2), -1, 1) * 1.05;
        if (Math.abs(a) < 0.12) a = a < 0 ? -0.12 : 0.12;   // never straight up, so it can't get stuck bouncing in one spot
        st.vx = st.sp * Math.sin(a); st.vy = -st.sp * Math.cos(a);
        st.by = PY - BALL;
        ev.push('disc');
      }
      // the bricks
      if (st.by - BALL < BY0 + BROWS * (BH + BG)) {
        for (let k = 0; k < st.br.length; k++) {
          if (!st.br[k]) continue;
          const r = Math.floor(k / BC), c = k % BC, x = BX0 + c * (BW + BG), y = BY0 + r * (BH + BG);
          const nx = st.bx - clamp(st.bx, x, x + BW), ny = st.by - clamp(st.by, y, y + BH);
          if (nx * nx + ny * ny > BALL * BALL) continue;
          if (Math.abs(nx) > Math.abs(ny)) st.vx = Math.sign(nx) * Math.abs(st.vx);
          else if (ny !== 0) st.vy = Math.sign(ny) * Math.abs(st.vy);
          else st.vy = -st.vy;
          st.br[k]--;
          if (!st.br[k]) {
            st.sc += ROW_PTS[r];
            st.sp = Math.min(ballSpeed(st.lv) * 1.25, st.sp * 1.006);   // it speeds up a touch with every brick
          }
          const m = Math.hypot(st.vx, st.vy) || 1;
          st.vx *= st.sp / m; st.vy *= st.sp / m;
          if (Math.abs(st.vy) < st.sp * 0.3) {   // never let it go nearly flat
            st.vy = (st.vy < 0 ? -1 : 1) * st.sp * 0.3;
            st.vx = (st.vx < 0 ? -1 : 1) * Math.sqrt(st.sp * st.sp - st.vy * st.vy);
          }
          ev.push(st.br[k] ? 'disc' : 'clack');
          if (st.br.every(v => !v)) {   // board cleared: on to the next one
            st.sc += 100 * st.lv;
            st.lv++;
            st.br = bricksFor(st.lv);
            st.sp = ballSpeed(st.lv);
            st.msgT = 1.6;
            serveReady(st);
            ev.push('win');
            return;
          }
          break;   // one brick per little step
        }
      }
      if (st.by - BALL > H) {   // missed it
        st.li--;
        ev.push('out');
        if (st.li <= 0) { st.ph = 'over'; ev.push('card'); }
        else serveReady(st);
        return;
      }
    }
  },
  pack(st) {
    return { lv: st.lv, sc: st.sc, li: st.li, px: Math.round(st.px),
             b: [Math.round(st.bx), Math.round(st.by), Math.round(st.vx), Math.round(st.vy)],
             h: st.held ? 1 : 0, br: st.br.join(''), ph: st.ph, m: st.msgT > 0 ? 1 : 0 };
  },
  unpack(p) {
    p = p || {};
    const b = Array.isArray(p.b) ? p.b : [W / 2, PY - BALL - 1, 0, 0];
    const br = String(p.br || '').split('').map(Number);
    while (br.length < BC * BROWS) br.push(0);
    return { lv: p.lv || 1, sc: p.sc || 0, li: p.li || 0, px: p.px || W / 2, bx: b[0] || 0, by: b[1] || 0, vx: b[2] || 0, vy: b[3] || 0,
             sp: Math.hypot(b[2] || 0, b[3] || 0) || ballSpeed(p.lv || 1), held: !!p.h, serve: 0, br,
             ph: p.ph === 'over' ? 'over' : 'play', msgT: p.m ? 1 : 0 };
  },
  drift(st, dt) {
    if (st.msgT > 0) st.msgT -= dt;
    if (st.ph !== 'play' || st.held) return;
    bricksBallMove(st, dt);
    if (st.by > H) st.by = H;
  },
  draw(g, st, o) {
    o.bg();
    hud(g, st, o, `LEVEL ${st.lv}`);
    for (let k = 0; k < st.br.length; k++) {   // the bricks
      const hp = st.br[k];
      if (!hp) continue;
      const r = Math.floor(k / BC), c = k % BC, x = BX0 + c * (BW + BG), y = BY0 + r * (BH + BG);
      rr(g, x, y, BW, BH, 4);
      g.fillStyle = hp > 1 ? '#d9dee8' : ROW_COL[r];
      g.fill();
      if (hp > 1) { g.fillStyle = ROW_COL[r]; g.fillRect(x + 6, y + 7, BW - 12, 4); }   // silver bricks take two hits
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.fillRect(x + 4, y + 2, BW - 8, 3);
    }
    const pw = padW(st.lv);   // the paddle
    if (o.fancy) { g.shadowColor = o.color; g.shadowBlur = 14; }
    rr(g, st.px - pw / 2, PY, pw, PH, 6);
    g.fillStyle = o.color; g.fill();
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.fillRect(st.px - pw / 2 + 6, PY + 2, pw - 12, 3);
    if (st.ph === 'play') {   // the ball
      if (o.fancy) { g.shadowColor = '#ffffff'; g.shadowBlur = 12; }
      g.fillStyle = '#ffffff';
      g.beginPath(); g.arc(st.bx, st.by, BALL, 0, Math.PI * 2); g.fill();
      g.shadowBlur = 0;
    }
    g.fillStyle = 'rgba(255,255,255,0.8)';   // spare balls, bottom left
    for (let i = 0; i < st.li - 1; i++) { g.beginPath(); g.arc(16 + i * 16, H - 10, 5, 0, Math.PI * 2); g.fill(); }
    if (st.ph === 'play' && st.held && st.msgT <= 0 && blinkOn(o)) o.neon('SPACE OR TAP TO LAUNCH', W / 2, 330, 18, '#ffffff');
    messages(g, st, o, 'LEVEL');
  }
};

// =====================================================================
// BUG INVADERS: rows of bugs march side to side and down; shoot them before they reach you
// =====================================================================
const QC = 9, QR = 5, QX = 46, QY = 34, QW = 32, QH = 24;   // the bugs' grid
const BUG_KIND = [2, 1, 1, 0, 0];   // by row: 2 beetle, 1 ladybug, 0 ant
const BUG_PTS = [10, 20, 30];
const BUG_COL = ['#5fe36b', '#ff4f6d', '#b38cff'];
const SY = 440, SHIP_W = 40;        // your ship
const SH_C = 8, SH_R = 4, SH_CW = 8, SH_CH = 7, SH_Y = 388;   // the three shields, made of little blocks
const SH_X = [W * 0.25, W * 0.5, W * 0.75].map(x => x - SH_C * SH_CW / 2);
const SHOT_V = 520;
function freshShields() {
  const a = [];
  for (let s = 0; s < 3; s++) for (let r = 0; r < SH_R; r++) for (let c = 0; c < SH_C; c++)
    a.push((r === 0 && (c === 0 || c === SH_C - 1)) || (r === SH_R - 1 && (c === 3 || c === 4)) ? 0 : 2);
  return a;
}
function formationStart(wv) { return { fx: (W - ((QC - 1) * QX + QW)) / 2, fy: 76 + Math.min(wv - 1, 4) * 12, dir: 1 }; }
const bombSpeed = st => 160 + st.wv * 12;
function moveFormation(st, dt) {   // the bugs speed up as there are fewer of them
  let minC = QC, maxC = -1, n = 0;
  for (let k = 0; k < st.al.length; k++) if (st.al[k]) { n++; const c = k % QC; minC = Math.min(minC, c); maxC = Math.max(maxC, c); }
  if (!n) return;
  st.fx += st.dir * (28 + st.wv * 6 + (1 - n / (QC * QR)) * 150) * dt;
  const left = st.fx + minC * QX, right = st.fx + maxC * QX + QW;
  if (st.dir > 0 && right > W - 8) { st.fx -= right - (W - 8); st.dir = -1; st.fy += 14; }
  else if (st.dir < 0 && left < 8) { st.fx += 8 - left; st.dir = 1; st.fy += 14; }
}
function hitShield(st, x, y) {   // knocks a chunk off a shield; true if something was there
  for (let s = 0; s < 3; s++) {
    const c = Math.floor((x - SH_X[s]) / SH_CW), r = Math.floor((y - SH_Y) / SH_CH);
    if (c < 0 || c >= SH_C || r < 0 || r >= SH_R) continue;
    const i = s * SH_R * SH_C + r * SH_C + c;
    if (st.sh[i] > 0) { st.sh[i]--; return true; }
  }
  return false;
}
function newWave(st) {
  Object.assign(st, formationStart(st.wv));
  st.al = new Array(QC * QR).fill(1);
  st.sh = freshShields();
  st.shots = []; st.bombs = [];
  st.bombT = 1.5; st.msgT = 1.6;
}
function drawBug(g, kind, x, y, f) {
  const cx = x + QW / 2, cy = y + QH / 2, col = BUG_COL[kind];
  g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 2;   // wiggly legs
  g.beginPath();
  for (const s of [-1, 1]) for (let i = -1; i <= 1; i++) {
    const wig = (f ? 3 : -3) * (i === 0 ? -1 : 1);
    g.moveTo(cx + s * 6, cy + 2 + i * 5); g.lineTo(cx + s * 14, cy + 2 + i * 5 + wig);
  }
  g.stroke();
  g.fillStyle = col;
  if (kind === 0) {   // ant: three little segments and antennae
    g.beginPath(); g.arc(cx, y + 5, 4, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(cx, y + 11, 4, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(cx, y + 18, 6, 5, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = col; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(cx - 2, y + 2); g.lineTo(cx - 7, y - 3 + (f ? 1 : 0)); g.moveTo(cx + 2, y + 2); g.lineTo(cx + 7, y - 3 + (f ? 0 : 1)); g.stroke();
  } else if (kind === 1) {   // ladybug: a round red shell with black spots
    g.beginPath(); g.arc(cx, cy + 2, 10, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#111';
    g.beginPath(); g.arc(cx, y + 3, 5, Math.PI, 0); g.fill();
    g.fillRect(cx - 0.75, cy - 7, 1.5, 18);
    for (const [dx, dy] of [[-5, 0], [5, 0], [-4, 7], [4, 7]]) { g.beginPath(); g.arc(cx + dx, cy + 2 + dy - 2, 2, 0, Math.PI * 2); g.fill(); }
  } else {   // beetle: a long shell with horns
    g.beginPath(); g.ellipse(cx, cy + 3, 9, 10, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(cx, y + 4, 4.5, 0, Math.PI * 2); g.fill();
    g.strokeStyle = col; g.lineWidth = 2;
    g.beginPath(); g.moveTo(cx - 3, y + 2); g.lineTo(cx - 6, y - 4); g.moveTo(cx + 3, y + 2); g.lineTo(cx + 6, y - 4); g.stroke();
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(cx - 0.75, cy - 6, 1.5, 18);
  }
  g.fillStyle = 'rgba(255,255,255,0.3)';
  g.beginPath(); g.arc(cx - 3, cy - 1, 2.5, 0, Math.PI * 2); g.fill();
}
function drawShip(g, x, y, col, s = 1) {
  g.fillStyle = col;
  rr(g, x - 20 * s, y + 6 * s, 40 * s, 12 * s, 4 * s); g.fill();
  g.beginPath(); g.arc(x, y + 6 * s, 10 * s, Math.PI, 0); g.fill();
  g.fillRect(x - 2 * s, y - 6 * s, 4 * s, 10 * s);
  g.fillStyle = 'rgba(255,255,255,0.4)';
  g.fillRect(x - 16 * s, y + 8 * s, 32 * s, 2.5 * s);
}

const Bugs = {
  title: 'BUG INVADERS', label: '🐞 Bug Invaders', what: 'WAVE',
  create() {
    const st = { wv: 1, sc: 0, li: 3, sx: W / 2, cd: 0, deadT: 0, ph: 'play', pops: [] };
    newWave(st);
    return st;
  },
  step(st, dt, inp, ev) {
    if (st.ph !== 'play') return;
    if (st.msgT > 0) st.msgT -= dt;
    if (inp.px != null) st.sx += clamp(inp.px - st.sx, -700 * dt, 700 * dt);
    else st.sx += ((inp.right ? 1 : 0) - (inp.left ? 1 : 0)) * 300 * dt;
    st.sx = clamp(st.sx, SHIP_W / 2 + 4, W - SHIP_W / 2 - 4);
    if (st.deadT > 0) st.deadT -= dt;
    st.cd -= dt;
    if (inp.fire && st.cd <= 0 && st.deadT <= 0 && st.shots.length < 2) {   // up to two shots in the air
      st.shots.push({ x: st.sx, y: SY - 8 });
      st.cd = 0.38;
      ev.push('hop');
    }
    moveFormation(st, dt);
    // the bugs drop slime, often from right above you
    st.bombT -= dt;
    if (st.bombT <= 0 && st.msgT <= 0) {
      st.bombT = Math.max(0.4, 1.3 - st.wv * 0.08) * (0.6 + Math.random() * 0.8);
      if (st.bombs.length < 3 + Math.floor(st.wv / 3)) {
        const cols = [];
        for (let c = 0; c < QC; c++) for (let r = QR - 1; r >= 0; r--) if (st.al[r * QC + c]) { cols.push([c, r]); break; }
        if (cols.length) {
          const dist = q => Math.abs(st.fx + q[0] * QX + QW / 2 - st.sx);
          let pick = cols[Math.floor(Math.random() * cols.length)];
          if (Math.random() < 0.45) pick = cols.reduce((b, q) => (dist(q) < dist(b) ? q : b));
          st.bombs.push({ x: st.fx + pick[0] * QX + QW / 2, y: st.fy + pick[1] * QY + QH });
        }
      }
    }
    // shots and slime move in small steps so nothing slips past
    const n = Math.max(1, Math.ceil(SHOT_V * dt / 8)), h = dt / n, bv = bombSpeed(st);
    let hitMe = false;
    for (let i = 0; i < n && !hitMe; i++) {
      for (const s of st.shots) s.y -= SHOT_V * h;
      for (const b of st.bombs) b.y += bv * h;
      st.shots = st.shots.filter(s => {
        if (s.y < TOP) return false;
        if (hitShield(st, s.x, s.y)) return false;
        const c = Math.floor((s.x - st.fx) / QX), r = Math.floor((s.y - st.fy) / QY);
        if (c >= 0 && c < QC && r >= 0 && r < QR && st.al[r * QC + c]) {
          const bx = st.fx + c * QX, by = st.fy + r * QY;
          if (s.x >= bx && s.x <= bx + QW && s.y >= by && s.y <= by + QH) {
            st.al[r * QC + c] = 0;
            st.sc += BUG_PTS[BUG_KIND[r]];
            st.pops.push({ x: bx + QW / 2, y: by + QH / 2, t: 0, c: BUG_COL[BUG_KIND[r]] });
            ev.push('clack');
            return false;
          }
        }
        const bi = st.bombs.findIndex(b => Math.abs(b.x - s.x) < 7 && Math.abs(b.y - s.y) < 12);   // shoot the slime out of the air
        if (bi >= 0) { st.bombs.splice(bi, 1); st.sc += 5; return false; }
        return true;
      });
      st.bombs = st.bombs.filter(b => {
        if (b.y > H) return false;
        if (hitShield(st, b.x, b.y)) return false;
        if (st.deadT <= 0 && Math.abs(b.x - st.sx) < SHIP_W / 2 && b.y > SY - 6 && b.y < SY + 18) { hitMe = true; return false; }
        return true;
      });
    }
    st.pops.forEach(p => { p.t += dt; });
    st.pops = st.pops.filter(p => p.t < 0.3);
    if (hitMe) {   // slimed!
      st.li--;
      st.deadT = 1.6;
      st.bombs = [];
      ev.push('out');
      if (st.li <= 0) { st.ph = 'over'; ev.push('card'); return; }
    }
    // low bugs eat through the shields, and if they reach you it's over
    if (st.fy + (QR - 1) * QY + QH >= SH_Y) {
      for (let k = 0; k < st.al.length; k++) {
        if (!st.al[k]) continue;
        const bx = st.fx + (k % QC) * QX, by = st.fy + Math.floor(k / QC) * QY;
        if (by + QH >= SY - 4) { st.li = 0; st.ph = 'over'; ev.push('card'); return; }
        if (by + QH >= SH_Y) for (let s = 0; s < 3; s++) for (let r = 0; r < SH_R; r++) for (let c = 0; c < SH_C; c++) {
          const x = SH_X[s] + c * SH_CW, y = SH_Y + r * SH_CH;
          if (x + SH_CW > bx && x < bx + QW && y + SH_CH > by && y < by + QH) st.sh[s * SH_R * SH_C + r * SH_C + c] = 0;
        }
      }
    }
    if (st.al.every(a => !a)) {   // wave cleared: the next one starts lower and faster
      st.wv++;
      newWave(st);
      ev.push('win');
    }
  },
  pack(st) {
    const flat = list => list.flatMap(p => [Math.round(p.x), Math.round(p.y)]);
    return { wv: st.wv, sc: st.sc, li: st.li, sx: Math.round(st.sx), al: st.al.join(''), f: [Math.round(st.fx), Math.round(st.fy), st.dir],
             s: flat(st.shots), bo: flat(st.bombs), sh: st.sh.join(''), d: st.deadT > 0 ? 1 : 0, ph: st.ph, m: st.msgT > 0 ? 1 : 0 };
  },
  unpack(p) {
    p = p || {};
    const pairs = a => { const out = []; if (Array.isArray(a)) for (let i = 0; i + 1 < a.length; i += 2) out.push({ x: a[i] || 0, y: a[i + 1] || 0 }); return out; };
    const al = String(p.al || '').split('').map(Number);
    while (al.length < QC * QR) al.push(0);
    const sh = String(p.sh || '').split('').map(Number);
    while (sh.length < 3 * SH_R * SH_C) sh.push(0);
    const f = Array.isArray(p.f) ? p.f : [0, 76, 1];
    return { wv: p.wv || 1, sc: p.sc || 0, li: p.li || 0, sx: p.sx || W / 2, al, fx: f[0] || 0, fy: f[1] || 0, dir: f[2] < 0 ? -1 : 1,
             shots: pairs(p.s), bombs: pairs(p.bo), sh, cd: 0, bombT: 9, deadT: p.d ? 1 : 0, ph: p.ph === 'over' ? 'over' : 'play',
             msgT: p.m ? 1 : 0, pops: [] };
  },
  drift(st, dt) {
    if (st.msgT > 0) st.msgT -= dt;
    if (st.ph !== 'play') return;
    moveFormation(st, dt);
    for (const s of st.shots) s.y -= SHOT_V * dt;
    const bv = bombSpeed(st);
    for (const b of st.bombs) b.y += bv * dt;
    st.shots = st.shots.filter(s => s.y > TOP);
    st.bombs = st.bombs.filter(b => b.y < H);
  },
  draw(g, st, o) {
    o.bg();
    hud(g, st, o, `WAVE ${st.wv}`);
    const f = Math.floor(o.now / 400) % 2;
    for (let k = 0; k < st.al.length; k++) {   // the bugs
      if (!st.al[k]) continue;
      const r = Math.floor(k / QC);
      drawBug(g, BUG_KIND[r], st.fx + (k % QC) * QX, st.fy + r * QY, f);
    }
    for (const p of st.pops) {   // little bursts where a bug was hit
      g.globalAlpha = 1 - p.t / 0.3;
      g.strokeStyle = p.c; g.lineWidth = 3;
      g.beginPath(); g.arc(p.x, p.y, 6 + p.t * 60, 0, Math.PI * 2); g.stroke();
    }
    g.globalAlpha = 1;
    for (let s = 0; s < 3; s++) for (let r = 0; r < SH_R; r++) for (let c = 0; c < SH_C; c++) {   // the shields
      const hp = st.sh[s * SH_R * SH_C + r * SH_C + c];
      if (!hp) continue;
      g.fillStyle = hp > 1 ? '#4fc3ff' : '#2a6f99';
      g.fillRect(SH_X[s] + c * SH_CW, SH_Y + r * SH_CH, SH_CW - 1, SH_CH - 1);
    }
    g.fillStyle = '#e8fdff';   // your shots
    for (const s of st.shots) g.fillRect(s.x - 1.5, s.y - 8, 3, 12);
    g.fillStyle = '#9dff3a';   // slime drops
    for (const b of st.bombs) {
      g.beginPath(); g.moveTo(b.x - 4, b.y); g.lineTo(b.x, b.y - 11); g.lineTo(b.x + 4, b.y); g.arc(b.x, b.y, 4, 0, Math.PI); g.fill();
    }
    if (st.ph === 'play' && (st.deadT <= 0 || Math.floor(o.now / 120) % 2 === 0)) {   // your ship (blinks after being slimed)
      if (o.fancy) { g.shadowColor = o.color; g.shadowBlur = 12; }
      drawShip(g, st.sx, SY, o.color);
      g.shadowBlur = 0;
    }
    g.fillStyle = 'rgba(122,240,255,0.3)';
    g.fillRect(0, SY + 22, W, 2);
    for (let i = 0; i < st.li - 1; i++) drawShip(g, 18 + i * 26, H - 13, o.color, 0.45);   // spare ships, bottom left
    messages(g, st, o, 'WAVE');
  }
};

export const ACT_GAMES = { bricks: Bricks, bugs: Bugs };