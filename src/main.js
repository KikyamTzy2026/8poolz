import './style.css';

// ==================== CONSTANTS ====================
const TABLE_W = 900;
const TABLE_H = 480;
const BALL_R = 12;
const POCKET_R = 22;
const FRICTION = 0.985;
const CUSHION_REST = 0.85;
const BALL_REST = 0.95;
const MIN_VEL = 0.05;

const COLORS = {
  0: '#f5f5f5', // cue
  1: '#eab308', 2: '#3b82f6', 3: '#ef4444', 4: '#7c3aed',
  5: '#f97316', 6: '#16a34a', 7: '#8b4513',
  8: '#111111',
  9: '#eab308', 10: '#3b82f6', 11: '#ef4444', 12: '#7c3aed',
  13: '#f97316', 14: '#16a34a', 15: '#8b4513'
};

const STRIPES = new Set([9,10,11,12,13,14,15]);

// ==================== STATE ====================
let canvas, ctx;
let balls = [];
let pockets = [];
let isAiming = false;
let isShooting = false;
let aimStart = null;
let power = 0;
let currentPlayer = 1;
let playerTypes = { 1: null, 2: null }; // 'solid' | 'stripe'
let gamePhase = 'break'; // break | open | playing | over
let winner = null;
let ballsMoving = false;
let scratched = false;
let pocketedThisTurn = [];
let firstContact = null;
let mode = 'local'; // local | online
let roomCode = null;
let isHost = false;
let myPlayer = 1;
let peerConnection = null;
let dataChannel = null;
let waitingForOpponent = false;

// ==================== INIT ====================
function init() {
  canvas = document.createElement('canvas');
  canvas.width = TABLE_W;
  canvas.height = TABLE_H;
  document.body.insertBefore(canvas, document.getElementById('menu'));
  ctx = canvas.getContext('2d');

  setupPockets();
  setupEventListeners();
  setupMenu();
  requestAnimationFrame(loop);
}

function setupPockets() {
  const m = 28; // margin
  pockets = [
    { x: m, y: m },
    { x: TABLE_W / 2, y: m - 4 },
    { x: TABLE_W - m, y: m },
    { x: m, y: TABLE_H - m },
    { x: TABLE_W / 2, y: TABLE_H - m + 4 },
    { x: TABLE_W - m, y: TABLE_H - m }
  ];
}

function setupBalls() {
  balls = [];
  // Cue ball
  balls.push(createBall(0, 220, TABLE_H / 2));

  // Rack - triangle
  const startX = 620;
  const startY = TABLE_H / 2;
  const rows = [
    [1],
    [9, 2],
    [3, 8, 10],
    [11, 4, 12, 5],
    [6, 13, 7, 14, 15]
  ];
  // Standard rack: 8 in center, solids/stripes alternating corners
  const order = [1, 9, 2, 10, 8, 11, 3, 12, 4, 13, 5, 14, 6, 15, 7];
  let idx = 0;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col <= row; col++) {
      const x = startX + row * (BALL_R * 2 * 0.92);
      const y = startY + (col - row / 2) * (BALL_R * 2 * 1.05);
      balls.push(createBall(order[idx++], x, y));
    }
  }
}

function createBall(n, x, y) {
  return {
    n,
    x, y,
    vx: 0, vy: 0,
    r: BALL_R,
    pocketed: false,
    stripe: STRIPES.has(n)
  };
}

// ==================== PHYSICS ====================
function updatePhysics() {
  let anyMoving = false;

  for (const b of balls) {
    if (b.pocketed) continue;
    b.x += b.vx;
    b.y += b.vy;
    b.vx *= FRICTION;
    b.vy *= FRICTION;
    if (Math.abs(b.vx) < MIN_VEL) b.vx = 0;
    if (Math.abs(b.vy) < MIN_VEL) b.vy = 0;
    if (b.vx !== 0 || b.vy !== 0) anyMoving = true;

    // Cushions
    const margin = 28;
    if (b.x - b.r < margin) { b.x = margin + b.r; b.vx = Math.abs(b.vx) * CUSHION_REST; }
    if (b.x + b.r > TABLE_W - margin) { b.x = TABLE_W - margin - b.r; b.vx = -Math.abs(b.vx) * CUSHION_REST; }
    if (b.y - b.r < margin) { b.y = margin + b.r; b.vy = Math.abs(b.vy) * CUSHION_REST; }
    if (b.y + b.r > TABLE_H - margin) { b.y = TABLE_H - margin - b.r; b.vy = -Math.abs(b.vy) * CUSHION_REST; }

    // Pockets
    for (const p of pockets) {
      const dx = b.x - p.x, dy = b.y - p.y;
      if (dx * dx + dy * dy < (POCKET_R - 4) ** 2) {
        b.pocketed = true;
        b.vx = b.vy = 0;
        pocketedThisTurn.push(b.n);
        break;
      }
    }
  }

  // Ball-ball collisions
  for (let i = 0; i < balls.length; i++) {
    for (let j = i + 1; j < balls.length; j++) {
      const a = balls[i], b = balls[j];
      if (a.pocketed || b.pocketed) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const minDist = a.r + b.r;
      if (dist < minDist && dist > 0) {
        // Separate
        const overlap = minDist - dist;
        const nx = dx / dist, ny = dy / dist;
        a.x -= nx * overlap / 2;
        a.y -= ny * overlap / 2;
        b.x += nx * overlap / 2;
        b.y += ny * overlap / 2;

        // Impulse
        const dvx = a.vx - b.vx, dvy = a.vy - b.vy;
        const dvn = dvx * nx + dvy * ny;
        if (dvn > 0) continue;
        const impulse = -(1 + BALL_REST) * dvn / 2;
        a.vx += impulse * nx;
        a.vy += impulse * ny;
        b.vx -= impulse * nx;
        b.vy -= impulse * ny;

        // First contact tracking
        if (firstContact === null) {
          if (a.n === 0) firstContact = b.n;
          else if (b.n === 0) firstContact = a.n;
        }
      }
    }
  }

  ballsMoving = anyMoving;
  return anyMoving;
}

// ==================== RULES ====================
function resolveTurn() {
  const cue = balls.find(b => b.n === 0);
  scratched = cue.pocketed;

  if (scratched) {
    cue.pocketed = false;
    cue.x = 220;
    cue.y = TABLE_H / 2;
    cue.vx = cue.vy = 0;
    // Remove 8 if scratched on 8
    if (pocketedThisTurn.includes(8)) {
      endGame(currentPlayer === 1 ? 2 : 1, 'Scratched on 8-ball!');
      return;
    }
    showMessage('Scratch! Opponent\'s turn');
    switchPlayer();
    resetTurnState();
    return;
  }

  // 8-ball pocketed
  if (pocketedThisTurn.includes(8)) {
    const myType = playerTypes[currentPlayer];
    const remaining = balls.filter(b => !b.pocketed && b.n !== 0 && b.n !== 8 &&
      ((myType === 'solid' && !b.stripe) || (myType === 'stripe' && b.stripe)));
    if (remaining.length === 0 && myType) {
      endGame(currentPlayer, '8-ball pocketed! You win!');
    } else {
      endGame(currentPlayer === 1 ? 2 : 1, 'Early 8-ball! You lose!');
    }
    return;
  }

  // Assign types on first legal pocket after break
  if (gamePhase === 'break' || gamePhase === 'open') {
    const nonCue = pocketedThisTurn.filter(n => n !== 0 && n !== 8);
    if (nonCue.length > 0) {
      const first = nonCue[0];
      const isStripe = STRIPES.has(first);
      playerTypes[currentPlayer] = isStripe ? 'stripe' : 'solid';
      playerTypes[currentPlayer === 1 ? 2 : 1] = isStripe ? 'solid' : 'stripe';
      gamePhase = 'playing';
      updatePlayerUI();
    }
  }

  // Check if legal shot
  let legal = true;
  if (gamePhase === 'playing' && playerTypes[currentPlayer]) {
    const myType = playerTypes[currentPlayer];
    if (firstContact !== null) {
      const hitBall = balls.find(b => b.n === firstContact);
      if (hitBall) {
        const hitCorrect = (myType === 'solid' && !hitBall.stripe && hitBall.n !== 8) ||
                           (myType === 'stripe' && hitBall.stripe);
        if (!hitCorrect && hitBall.n !== 8) legal = false;
      }
    } else {
      legal = false; // no contact
    }
  }

  const pocketedOwn = pocketedThisTurn.some(n => {
    if (n === 0 || n === 8) return false;
    if (!playerTypes[currentPlayer]) return true;
    const b = balls.find(bb => bb.n === n);
    return b && ((playerTypes[currentPlayer] === 'solid' && !b.stripe) ||
                 (playerTypes[currentPlayer] === 'stripe' && b.stripe));
  });

  if (!legal || (!pocketedOwn && pocketedThisTurn.length === 0)) {
    switchPlayer();
  }
  // else same player continues

  resetTurnState();
  updateUI();
}

function resetTurnState() {
  pocketedThisTurn = [];
  firstContact = null;
  scratched = false;
  isShooting = false;
}

function switchPlayer() {
  currentPlayer = currentPlayer === 1 ? 2 : 1;
  updateUI();
}

function endGame(win, msg) {
  winner = win;
  gamePhase = 'over';
  showMessage(`${msg}<br>Player ${win} wins!`, true);
  updateUI();
}

// ==================== RENDER ====================
function draw() {
  // Table felt
  ctx.fillStyle = '#0d5c2e';
  ctx.fillRect(0, 0, TABLE_W, TABLE_H);

  // Wood rails
  const m = 28;
  ctx.fillStyle = '#5c3317';
  ctx.fillRect(0, 0, TABLE_W, m);
  ctx.fillRect(0, TABLE_H - m, TABLE_W, m);
  ctx.fillRect(0, 0, m, TABLE_H);
  ctx.fillRect(TABLE_W - m, 0, m, TABLE_H);

  // Inner cushion highlight
  ctx.strokeStyle = '#3d7a4a';
  ctx.lineWidth = 3;
  ctx.strokeRect(m, m, TABLE_W - m * 2, TABLE_H - m * 2);

  // Pockets
  for (const p of pockets) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, POCKET_R, 0, Math.PI * 2);
    ctx.fillStyle = '#111';
    ctx.fill();
  }

  // Head string / spots
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath();
  ctx.arc(220, TABLE_H / 2, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(TABLE_W - 220, TABLE_H / 2, 3, 0, Math.PI * 2);
  ctx.fill();

  // Balls
  for (const b of balls) {
    if (b.pocketed) continue;
    drawBall(b);
  }

  // Aim line
  if (isAiming && aimStart && !ballsMoving) {
    const cue = balls.find(b => b.n === 0);
    if (cue && !cue.pocketed) {
      const dx = aimStart.x - cue.x;
      const dy = aimStart.y - cue.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 5) {
        const nx = dx / len, ny = dy / len;
        // Direction is opposite of drag
        const aimX = cue.x - nx * 300;
        const aimY = cue.y - ny * 300;

        ctx.beginPath();
        ctx.moveTo(cue.x, cue.y);
        ctx.lineTo(aimX, aimY);
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 6]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Power indicator on stick
        const stickLen = Math.min(len, 120);
        ctx.beginPath();
        ctx.moveTo(cue.x + nx * (BALL_R + 4), cue.y + ny * (BALL_R + 4));
        ctx.lineTo(cue.x + nx * (BALL_R + 4 + stickLen), cue.y + ny * (BALL_R + 4 + stickLen));
        ctx.strokeStyle = '#d4a574';
        ctx.lineWidth = 5;
        ctx.stroke();
      }
    }
  }
}

function drawBall(b) {
  const { x, y, r, n } = b;
  // Shadow
  ctx.beginPath();
  ctx.arc(x + 2, y + 3, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fill();

  // Ball body
  const grad = ctx.createRadialGradient(x - 3, y - 3, 2, x, y, r);
  grad.addColorStop(0, lighten(COLORS[n], 40));
  grad.addColorStop(1, COLORS[n]);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Stripe band
  if (b.stripe && n !== 0) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(x - r, y - 5, r * 2, 10);
    ctx.restore();
  }

  // Number
  if (n !== 0) {
    ctx.fillStyle = n === 8 ? '#fff' : '#111';
    ctx.font = `bold ${n > 9 ? 9 : 10}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // White circle for number
    if (n !== 8) {
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.fillStyle = '#111';
    }
    ctx.fillText(String(n), x, y + 0.5);
  } else {
    // Cue ball red dot
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#dc2626';
    ctx.fill();
  }
}

function lighten(hex, pct) {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.min(255, (num >> 16) + pct);
  const g = Math.min(255, ((num >> 8) & 0xff) + pct);
  const b = Math.min(255, (num & 0xff) + pct);
  return `rgb(${r},${g},${b})`;
}

// ==================== INPUT ====================
function setupEventListeners() {
  canvas.addEventListener('mousedown', onPointerDown);
  canvas.addEventListener('mousemove', onPointerMove);
  canvas.addEventListener('mouseup', onPointerUp);
  canvas.addEventListener('touchstart', e => { e.preventDefault(); onPointerDown(e.touches[0]); }, { passive: false });
  canvas.addEventListener('touchmove', e => { e.preventDefault(); onPointerMove(e.touches[0]); }, { passive: false });
  canvas.addEventListener('touchend', e => { e.preventDefault(); onPointerUp(); }, { passive: false });
}

function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY
  };
}

function onPointerDown(e) {
  if (ballsMoving || gamePhase === 'over') return;
  if (mode === 'online' && currentPlayer !== myPlayer) return;

  const pos = getPos(e);
  const cue = balls.find(b => b.n === 0);
  if (!cue || cue.pocketed) return;

  isAiming = true;
  aimStart = pos;
  power = 0;
  document.getElementById('power-bar-container').style.display = 'block';
}

function onPointerMove(e) {
  if (!isAiming) return;
  aimStart = getPos(e);
  const cue = balls.find(b => b.n === 0);
  if (!cue) return;
  const dx = aimStart.x - cue.x;
  const dy = aimStart.y - cue.y;
  const dist = Math.min(Math.sqrt(dx * dx + dy * dy), 140);
  power = dist / 140;
  document.getElementById('power-bar').style.width = (power * 100) + '%';
}

function onPointerUp() {
  if (!isAiming) return;
  isAiming = false;
  document.getElementById('power-bar-container').style.display = 'none';
  document.getElementById('power-bar').style.width = '0%';

  const cue = balls.find(b => b.n === 0);
  if (!cue || power < 0.05) return;

  const dx = aimStart.x - cue.x;
  const dy = aimStart.y - cue.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 5) return;

  const force = power * 18;
  cue.vx = -(dx / len) * force;
  cue.vy = -(dy / len) * force;

  isShooting = true;
  ballsMoving = true;
  firstContact = null;
  pocketedThisTurn = [];

  if (mode === 'online') {
    sendState('shoot', { vx: cue.vx, vy: cue.vy });
  }
}

// ==================== ONLINE (WebRTC simple) ====================
function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

async function createRoom() {
  roomCode = generateRoomCode();
  isHost = true;
  myPlayer = 1;
  mode = 'online';
  waitingForOpponent = true;

  document.getElementById('room-info').textContent = `Room: ${roomCode} — Waiting for opponent... Share this code!`;
  document.getElementById('room-info').style.display = 'block';

  // For simplicity: use BroadcastChannel for same-browser testing
  // + localStorage signaling for basic cross-tab
  // Real production would use a signaling server (Firebase/Supabase/Ably)

  const bc = new BroadcastChannel('pool-' + roomCode);
  bc.onmessage = (e) => handleSignal(e.data);

  // Also poll localStorage for cross-origin simple demo
  window._poolBC = bc;
  window._poolRoom = roomCode;

  startGame();
  showMessage('Waiting for Player 2...<br>Share code: ' + roomCode, true);
}

function joinRoom(code) {
  roomCode = code.toUpperCase();
  isHost = false;
  myPlayer = 2;
  mode = 'online';

  const bc = new BroadcastChannel('pool-' + roomCode);
  bc.onmessage = (e) => handleSignal(e.data);
  window._poolBC = bc;
  window._poolRoom = roomCode;

  // Announce join
  bc.postMessage({ type: 'join', player: 2 });
  startGame();
  showMessage('Joined room ' + roomCode);
  setTimeout(() => hideMessage(), 1500);
}

function handleSignal(data) {
  if (data.type === 'join' && isHost) {
    waitingForOpponent = false;
    hideMessage();
    showMessage('Player 2 joined!', false);
    setTimeout(() => hideMessage(), 1200);
    // Send current state
    sendState('sync', getFullState());
  }
  if (data.type === 'shoot' && currentPlayer !== myPlayer) {
    const cue = balls.find(b => b.n === 0);
    if (cue) {
      cue.vx = data.vx;
      cue.vy = data.vy;
      ballsMoving = true;
      isShooting = true;
      firstContact = null;
      pocketedThisTurn = [];
    }
  }
  if (data.type === 'sync' && !isHost) {
    applyState(data.state);
  }
  if (data.type === 'turn') {
    currentPlayer = data.player;
    updateUI();
  }
}

function sendState(type, payload = {}) {
  if (window._poolBC) {
    const msg = { type, ...payload };
    if (type === 'sync') msg.state = payload;
    window._poolBC.postMessage(msg);
  }
}

function getFullState() {
  return {
    balls: balls.map(b => ({ n: b.n, x: b.x, y: b.y, vx: b.vx, vy: b.vy, pocketed: b.pocketed })),
    currentPlayer,
    playerTypes,
    gamePhase
  };
}

function applyState(state) {
  if (!state) return;
  state.balls.forEach(sb => {
    const b = balls.find(bb => bb.n === sb.n);
    if (b) {
      b.x = sb.x; b.y = sb.y; b.vx = sb.vx; b.vy = sb.vy; b.pocketed = sb.pocketed;
    }
  });
  currentPlayer = state.currentPlayer;
  playerTypes = state.playerTypes;
  gamePhase = state.gamePhase;
  updateUI();
}

// ==================== UI ====================
function setupMenu() {
  document.getElementById('btn-local').onclick = () => {
    mode = 'local';
    myPlayer = 1;
    startGame();
  };
  document.getElementById('btn-create').onclick = () => createRoom();
  document.getElementById('btn-join').onclick = () => {
    document.getElementById('room-input').style.display = 'block';
    document.getElementById('btn-join-confirm').style.display = 'block';
  };
  document.getElementById('btn-join-confirm').onclick = () => {
    const code = document.getElementById('room-input').value.trim();
    if (code.length >= 4) joinRoom(code);
  };
}

function startGame() {
  document.getElementById('menu').style.display = 'none';
  setupBalls();
  currentPlayer = 1;
  playerTypes = { 1: null, 2: null };
  gamePhase = 'break';
  winner = null;
  ballsMoving = false;
  resetTurnState();
  updateUI();
  updatePlayerUI();
}

function updateUI() {
  document.getElementById('p1').classList.toggle('active', currentPlayer === 1 && gamePhase !== 'over');
  document.getElementById('p2').classList.toggle('active', currentPlayer === 2 && gamePhase !== 'over');

  let status = '';
  if (gamePhase === 'over') {
    status = `Player ${winner} Wins!`;
  } else if (mode === 'online' && currentPlayer !== myPlayer) {
    status = `Opponent's turn`;
  } else {
    status = `Player ${currentPlayer}'s turn`;
  }
  document.getElementById('status').textContent = status;

  // Balls remaining
  updateBallsLeft(1);
  updateBallsLeft(2);
}

function updatePlayerUI() {
  document.getElementById('p1-type').textContent = playerTypes[1] ? (playerTypes[1] === 'solid' ? 'Solids' : 'Stripes') : 'Open';
  document.getElementById('p2-type').textContent = playerTypes[2] ? (playerTypes[2] === 'solid' ? 'Solids' : 'Stripes') : 'Open';
}

function updateBallsLeft(p) {
  const el = document.getElementById(`p${p}-balls`);
  el.innerHTML = '';
  if (!playerTypes[p]) return;
  const type = playerTypes[p];
  for (let n = 1; n <= 15; n++) {
    if (n === 8) continue;
    const isStripe = STRIPES.has(n);
    if ((type === 'solid' && isStripe) || (type === 'stripe' && !isStripe)) continue;
    const b = balls.find(bb => bb.n === n);
    if (b && !b.pocketed) {
      const d = document.createElement('div');
      d.className = 'mini-ball';
      d.style.background = COLORS[n];
      if (isStripe) d.style.boxShadow = 'inset 0 0 0 2px #fff';
      el.appendChild(d);
    }
  }
}

function showMessage(html, persistent = false) {
  const el = document.getElementById('message');
  el.innerHTML = html;
  el.style.display = 'block';
  if (!persistent) {
    setTimeout(hideMessage, 2000);
  }
}

function hideMessage() {
  document.getElementById('message').style.display = 'none';
}

// ==================== LOOP ====================
let wasMoving = false;
function loop() {
  const moving = updatePhysics();
  draw();

  if (wasMoving && !moving && isShooting) {
    // Balls just stopped
    resolveTurn();
    if (mode === 'online') {
      sendState('sync', getFullState());
      sendState('turn', { player: currentPlayer });
    }
  }
  wasMoving = moving;

  requestAnimationFrame(loop);
}

// Start
init();
