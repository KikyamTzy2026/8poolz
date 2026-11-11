import './style.css';

// ============ CONSTANTS ============
const W = 900, H = 480, M = 32, R = 12, PR = 22, SUB = 5, TIME_LIMIT = 120;
const COLORS = { 0:'#f5f5f5',1:'#eab308',2:'#2563eb',3:'#dc2626',4:'#7c3aed',5:'#f97316',6:'#16a34a',7:'#7f1d1d',8:'#111',
  9:'#eab308',10:'#2563eb',11:'#dc2626',12:'#7c3aed',13:'#f97316',14:'#16a34a',15:'#7f1d1d' };
const isStripe = n => n >= 9;
const $ = id => document.getElementById(id);

// ============ STATE ============
let canvas, ctx, balls = [], pockets = [];
let aiming = false, dragStart = null, dragNow = null, power = 0;
let turn = 1, types = { 1: null, 2: null }, phase = 'break', winner = null;
let moving = false, shooting = false, wasMoving = false, pocketed = [], first = null;
let mode = 'local', myPlayer = 1, bc = null;
let names = { 1: 'Player 1', 2: 'Player 2' };
let timeLeft = TIME_LIMIT, timerOn = false, lastT = 0;

// ============ INIT ============
function init() {
  canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  $('hud').after(canvas);
  ctx = canvas.getContext('2d');
  pockets = [
    { x: M - 9, y: M - 9 }, { x: W / 2, y: M - 14 }, { x: W - M + 9, y: M - 9 },
    { x: M - 9, y: H - M + 9 }, { x: W / 2, y: H - M + 14 }, { x: W - M + 9, y: H - M + 9 }
  ];
  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  setupMenu();
  setupBalls();
  requestAnimationFrame(loop);
}

function setupBalls() {
  balls = [mk(0, 230, H / 2)];
  const order = [1, 9, 2, 10, 8, 11, 3, 12, 4, 13, 5, 14, 6, 15, 7];
  const gap = 2 * R + 0.6, dx = gap * Math.sqrt(3) / 2;
  let i = 0;
  for (let row = 0; row < 5; row++)
    for (let col = 0; col <= row; col++)
      balls.push(mk(order[i++], 640 + row * dx, H / 2 + (col - row / 2) * gap));
}
const mk = (n, x, y) => ({ n, x, y, vx: 0, vy: 0, out: false });
const cue = () => balls[0];

// ============ PHYSICS ============
function step() {
  let any = false;
  for (let s = 0; s < SUB; s++) {
    for (const b of balls) {
      if (b.out) continue;
      b.x += b.vx / SUB; b.y += b.vy / SUB;
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > 0) {
        const ns = sp * Math.pow(0.9925, 1 / SUB) - 0.012 / SUB;
        if (ns < 0.03) { b.vx = b.vy = 0; } else { b.vx *= ns / sp; b.vy *= ns / sp; any = true; }
      }
      let nearPocket = false;
      for (const p of pockets) {
        const d = Math.hypot(b.x - p.x, b.y - p.y);
        if (d < PR) { b.out = true; b.vx = b.vy = 0; pocketed.push(b.n); break; }
        if (d < PR + 12) nearPocket = true;
      }
      if (b.out || nearPocket) continue;
      if (b.x < M + R) { b.x = M + R; b.vx = Math.abs(b.vx) * 0.8; }
      if (b.x > W - M - R) { b.x = W - M - R; b.vx = -Math.abs(b.vx) * 0.8; }
      if (b.y < M + R) { b.y = M + R; b.vy = Math.abs(b.vy) * 0.8; }
      if (b.y > H - M - R) { b.y = H - M - R; b.vy = -Math.abs(b.vy) * 0.8; }
    }
    for (let i = 0; i < balls.length; i++) for (let j = i + 1; j < balls.length; j++) {
      const a = balls[i], b = balls[j];
      if (a.out || b.out) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      if (d >= 2 * R || d === 0) continue;
      const nx = dx / d, ny = dy / d, ov = (2 * R - d) / 2;
      a.x -= nx * ov; a.y -= ny * ov; b.x += nx * ov; b.y += ny * ov;
      const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      if (rel > 0) {
        const j2 = rel * 1.96 / 2;
        a.vx -= j2 * nx; a.vy -= j2 * ny; b.vx += j2 * nx; b.vy += j2 * ny;
        if (first === null && (a.n === 0 || b.n === 0)) first = a.n === 0 ? b.n : a.n;
      }
    }
  }
  return any;
}

// ============ RULES ============
const mine = (p, n) => types[p] && n !== 0 && n !== 8 && (types[p] === 'stripe') === isStripe(n);
const left = p => balls.filter(b => !b.out && mine(p, b.n)).length;
const other = p => (p === 1 ? 2 : 1);

function resolveTurn() {
  const c = cue();
  const scratch = c.out;
  if (scratch) { c.out = false; c.x = 230; c.y = H / 2; c.vx = c.vy = 0; }
  if (pocketed.includes(8)) {
    const clear = types[turn] && left(turn) === 0 && !scratch;
    return endGame(clear ? turn : other(turn), clear ? '8-ball pocketed!' : scratch ? 'Scratched on the 8!' : 'Early 8-ball!');
  }
  if ((phase === 'break' || phase === 'open') && !scratch) {
    const f = pocketed.find(n => n !== 0);
    if (f) { types[turn] = isStripe(f) ? 'stripe' : 'solid'; types[other(turn)] = isStripe(f) ? 'solid' : 'stripe'; }
  }
  phase = types[1] ? 'playing' : 'open';
  let foul = scratch || first === null;
  if (!foul && types[turn]) foul = first === 8 ? left(turn) > 0 : !mine(turn, first);
  const scored = pocketed.some(n => n !== 0 && (!types[turn] || mine(turn, n) || (n === 8)));
  if (foul || !scored) turn = other(turn);
  if (foul) flash(scratch ? 'Scratch!' : 'Foul!');
  pocketed = []; first = null; shooting = false;
  updateUI();
}

function endGame(w, msg) {
  winner = w; phase = 'over'; timerOn = false; shooting = false;
  showMsg(`${msg}<br>🏆 ${names[w]} wins!<br><button class="btn" onclick="location.reload()">Play Again</button>`, true);
  updateUI();
}

function timeUp() {
  timerOn = false;
  const s1 = 7 - left(1), s2 = 7 - left(2);
  if (!types[1] || s1 === s2) { phase = 'over'; showMsg(`⏱ Time's up!<br>Draw<br><button class="btn" onclick="location.reload()">Play Again</button>`, true); updateUI(); }
  else endGame(s1 > s2 ? 1 : 2, "⏱ Time's up!");
}

// ============ RENDER ============
function draw() {
  ctx.clearRect(0, 0, W, H);
  const rail = ctx.createLinearGradient(0, 0, 0, H);
  rail.addColorStop(0, '#6b3a1c'); rail.addColorStop(.5, '#4a2610'); rail.addColorStop(1, '#6b3a1c');
  ctx.fillStyle = rail; ctx.fillRect(0, 0, W, H);
  const felt = ctx.createRadialGradient(W / 2, H / 2, 60, W / 2, H / 2, 480);
  felt.addColorStop(0, '#17a05a'); felt.addColorStop(1, '#0b5c33');
  ctx.fillStyle = felt; ctx.fillRect(M, M, W - 2 * M, H - 2 * M);
  ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.lineWidth = 4; ctx.strokeRect(M, M, W - 2 * M, H - 2 * M);
  ctx.fillStyle = '#e8c97a';
  for (let i = 1; i < 8; i++) { if (i === 4) continue; dia(M + i * (W - 2 * M) / 8, M / 2); dia(M + i * (W - 2 * M) / 8, H - M / 2); }
  for (let i = 1; i < 4; i++) { dia(M / 2, M + i * (H - 2 * M) / 4); dia(W - M / 2, M + i * (H - 2 * M) / 4); }
  ctx.fillStyle = 'rgba(255,255,255,.25)';
  ctx.beginPath(); ctx.arc(230, H / 2, 3, 0, 7); ctx.arc(640, H / 2, 3, 0, 7); ctx.fill();
  for (const p of pockets) {
    const g = ctx.createRadialGradient(p.x, p.y, 3, p.x, p.y, PR + 2);
    g.addColorStop(0, '#000'); g.addColorStop(1, '#1a1a1a');
    ctx.beginPath(); ctx.arc(p.x, p.y, PR, 0, 7); ctx.fillStyle = g; ctx.fill();
    ctx.strokeStyle = '#b8892f'; ctx.lineWidth = 3; ctx.stroke();
  }
  for (const b of balls) if (!b.out) drawBall(b);
  if (aiming && !moving && canTurn()) drawAim();
}
function dia(x, y) { ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 7); ctx.fill(); }

function drawBall(b) {
  const { x, y, n } = b;
  ctx.beginPath(); ctx.arc(x + 2, y + 3, R, 0, 7); ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.arc(x, y, R, 0, 7); ctx.clip();
  ctx.fillStyle = isStripe(n) ? '#f5f5f5' : COLORS[n]; ctx.fillRect(x - R, y - R, 2 * R, 2 * R);
  if (isStripe(n)) { ctx.fillStyle = COLORS[n]; ctx.fillRect(x - R, y - 6, 2 * R, 12); }
  ctx.restore();
  if (n) {
    ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.fillStyle = '#111'; ctx.font = 'bold 8px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(n, x, y + .5);
  } else { ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 7); ctx.fillStyle = '#dc2626'; ctx.fill(); }
  const sh = ctx.createRadialGradient(x - 4, y - 5, 1, x - 3, y - 4, 9);
  sh.addColorStop(0, 'rgba(255,255,255,.75)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.beginPath(); ctx.arc(x, y, R, 0, 7); ctx.fillStyle = sh; ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = 1; ctx.stroke();
}

function aimDir() {
  const dx = dragStart.x - dragNow.x, dy = dragStart.y - dragNow.y, l = Math.hypot(dx, dy);
  return l < 4 ? null : { x: dx / l, y: dy / l };
}

function drawAim() {
  const c = cue(), d = aimDir();
  if (!d) return;
  let t = 700, hit = null;
  for (const b of balls) {
    if (b === c || b.out) continue;
    const fx = b.x - c.x, fy = b.y - c.y, proj = fx * d.x + fy * d.y;
    if (proj < 0) continue;
    const perp = fx * fx + fy * fy - proj * proj;
    if (perp > 4 * R * R) continue;
    const tt = proj - Math.sqrt(4 * R * R - perp);
    if (tt < t) { t = tt; hit = b; }
  }
  const gx = c.x + d.x * t, gy = c.y + d.y * t;
  ctx.setLineDash([8, 6]); ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(gx, gy); ctx.stroke(); ctx.setLineDash([]);
  if (hit) {
    ctx.beginPath(); ctx.arc(gx, gy, R, 0, 7); ctx.stroke();
    const ox = hit.x - gx, oy = hit.y - gy, ol = Math.hypot(ox, oy) || 1;
    ctx.beginPath(); ctx.moveTo(hit.x, hit.y); ctx.lineTo(hit.x + ox / ol * 45, hit.y + oy / ol * 45);
    ctx.strokeStyle = 'rgba(251,191,36,.9)'; ctx.stroke();
  }
  const pull = R + 8 + power * 70, len = 260;
  const sx = c.x - d.x * pull, sy = c.y - d.y * pull, ex = sx - d.x * len, ey = sy - d.y * len;
  const g = ctx.createLinearGradient(sx, sy, ex, ey);
  g.addColorStop(0, '#f3e2b3'); g.addColorStop(.12, '#c98b3d'); g.addColorStop(1, '#3b2008');
  ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(0,0,0,.3)'; ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(sx + 2, sy + 3); ctx.lineTo(ex + 2, ey + 3); ctx.stroke();
  ctx.strokeStyle = g; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
  ctx.strokeStyle = '#4da3ff'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx - d.x * 4, sy - d.y * 4); ctx.stroke();
  ctx.lineCap = 'butt';
}

// ============ INPUT ============
const canTurn = () => !moving && phase !== 'over' && timerOn && (mode === 'local' || turn === myPlayer);
function pos(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
}
function onDown(e) {
  if (!canTurn()) return;
  aiming = true; dragStart = pos(e); dragNow = dragStart; power = 0;
}
function onMove(e) {
  if (!aiming) return;
  dragNow = pos(e);
  power = Math.min(Math.hypot(dragStart.x - dragNow.x, dragStart.y - dragNow.y) / 150, 1);
  $('power-bar').style.width = power * 100 + '%';
}
function onUp() {
  if (!aiming) return;
  aiming = false; $('power-bar').style.width = '0%';
  const d = aimDir();
  if (!d || power < 0.04 || !canTurn()) return;
  fire(d.x * power * 20, d.y * power * 20);
  if (mode === 'online') send('shoot', { vx: cue().vx, vy: cue().vy });
}
function fire(vx, vy) {
  cue().vx = vx; cue().vy = vy; shooting = true; moving = true; first = null; pocketed = [];
}

// ============ ONLINE (same-browser BroadcastChannel) ============
function openChannel(code) {
  bc = new BroadcastChannel('pool-' + code);
  bc.onmessage = e => handle(e.data);
}
function send(type, payload = {}) { if (bc) bc.postMessage({ type, ...payload }); }
function handle(d) {
  if (d.type === 'join' && myPlayer === 1) {
    names[2] = d.name || 'Player 2';
    hideMsg(); flash(`${names[2]} joined!`);
    startGame(false); send('sync', { state: fullState() });
  }
  if (d.type === 'shoot' && turn !== myPlayer) fire(d.vx, d.vy);
  if (d.type === 'sync' && d.state) applyState(d.state);
}
const fullState = () => ({ balls: balls.map(b => ({ ...b })), turn, types, phase, names, timeLeft });
function applyState(s) {
  balls = s.balls; turn = s.turn; types = s.types; phase = s.phase; names = s.names; timeLeft = s.timeLeft;
  moving = false; shooting = false; timerOn = phase !== 'over'; updateUI();
}

// ============ UI ============
function setupMenu() {
  const nm = id => $(id).value.trim() || null;
  $('btn-local').onclick = () => {
    mode = 'local'; myPlayer = 1;
    names = { 1: nm('name-1') || 'Player 1', 2: nm('name-2') || 'Player 2' };
    $('menu').style.display = 'none'; startGame(true);
  };
  $('btn-create').onclick = () => {
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    mode = 'online'; myPlayer = 1; names = { 1: nm('name-1') || 'Player 1', 2: 'Waiting...' };
    openChannel(code); $('menu').style.display = 'none'; startGame(false);
    showMsg(`Waiting for opponent...<br>Room code: ${code}`, true);
  };
  $('btn-join').onclick = () => { $('room-input').style.display = 'block'; $('btn-join-confirm').style.display = 'block'; };
  $('btn-join-confirm').onclick = () => {
    const code = $('room-input').value.trim().toUpperCase();
    if (code.length < 4) return;
    mode = 'online'; myPlayer = 2; names = { 1: 'Player 1', 2: nm('name-1') || 'Player 2' };
    openChannel(code); $('menu').style.display = 'none'; startGame(false);
    send('join', { name: names[2] });
  };
}

function startGame(run) {
  setupBalls(); turn = 1; types = { 1: null, 2: null }; phase = 'break'; winner = null;
  moving = shooting = false; pocketed = []; first = null; timeLeft = TIME_LIMIT;
  timerOn = run || mode === 'online' && myPlayer === 2 ? true : run; lastT = performance.now();
  if (mode === 'online') timerOn = true;
  updateUI();
}

function fmt(s) { s = Math.max(0, Math.ceil(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }

function updateUI() {
  for (const p of [1, 2]) {
    $('p' + p).classList.toggle('active', turn === p && phase !== 'over');
    $(`p${p}-name`).textContent = names[p] + (mode === 'online' && p === myPlayer ? ' (You)' : '');
    $(`p${p}-type`).textContent = types[p] ? (types[p] === 'solid' ? 'Solids' : 'Stripes') : 'Open table';
    const el = $(`p${p}-balls`); el.innerHTML = '';
    if (!types[p]) continue;
    for (let n = 1; n <= 15; n++) {
      if (!mine(p, n) || balls.find(b => b.n === n).out) continue;
      const d = document.createElement('div'); d.className = 'mini-ball'; d.style.background = COLORS[n];
      if (isStripe(n)) d.style.boxShadow = 'inset 0 0 0 2px #fff';
      el.appendChild(d);
    }
  }
  $('status').textContent = phase === 'over' ? 'Game over'
    : mode === 'online' && turn !== myPlayer ? `${names[turn]}'s turn` : `${names[turn]}, your shot`;
}

function showMsg(html, persist = false) {
  const el = $('message'); el.innerHTML = html; el.style.display = 'block';
  if (!persist) setTimeout(hideMsg, 1800);
}
const flash = t => showMsg(t);
const hideMsg = () => { $('message').style.display = 'none'; };

// ============ LOOP ============
function loop(t) {
  moving = step() || (shooting && moving && balls.some(b => !b.out && (b.vx || b.vy)));
  if (!moving && shooting && wasMoving) {
    resolveTurn();
    if (mode === 'online' && myPlayer === turn || mode === 'online') send('sync', { state: fullState() });
  }
  wasMoving = moving;
  if (timerOn) {
    timeLeft -= (t - lastT) / 1000;
    if (timeLeft <= 0) { timeLeft = 0; if (!moving) timeUp(); }
  }
  lastT = t;
  const tm = $('timer'); tm.textContent = fmt(timeLeft); tm.classList.toggle('low', timerOn && timeLeft <= 20);
  draw();
  requestAnimationFrame(loop);
}

init();
