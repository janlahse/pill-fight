const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// ── Hi-DPI canvas ─────────────────────────────────────────────────────────────

const CANVAS_W = 900;
const CANVAS_H = 600;
const DPR = window.devicePixelRatio || 1;

canvas.width  = CANVAS_W * DPR;
canvas.height = CANVAS_H * DPR;
canvas.style.width  = CANVAS_W + 'px';
canvas.style.height = CANVAS_H + 'px';
ctx.scale(DPR, DPR);

// ── Constants ─────────────────────────────────────────────────────────────────

const GRAVITY      = 0.35;
const JUMP_FORCE   = -12;
const MOVE_SPEED   = 4.5;
const P_ACCEL_GROUND = 0.28;
const P_ACCEL_AIR    = 0.02;
const PROJ_SPEED   = 10;
const PROJ_ACCEL   = 1.1;
const PROJ_RADIUS  = 9;
const PROJ_DAMAGE  = 20;
const SHOOT_COOLDOWN = 90;

const SHIELD_DURATION    = 900;
const GRAVITY_DURATION    = 1200;
const POWERUP_SPAWN_MIN  = 18000; // ms
const POWERUP_SPAWN_MAX  = 28000; // ms
const POWERUP_SIZE       = 32;
const POWERUP_COLOR      = '#00E5FF';
const TRIPLE_COLOR       = '#FF8C00';
const TRIPLE_ANGLE       = Math.PI / 18;
const GRAVITY_COLOR      = '#C084FC';
const MINE_COLOR         = '#4ADE80';
const MINE_TRIGGER_DIST  = 38;
const MINE_WARN_FRAMES   = 100;

const P_W = 30;
const P_H = 58;

const ARENA = { x: 20, y: 55, w: 860, h: 530 };

// Side platforms reachable from floor; center reachable only from side platforms.
const PLATFORMS = [
  { x: ARENA.x + 330, y: ARENA.y + 220, w: 200, h: 14 }, // center, upper tier
  { x: ARENA.x + 30,  y: ARENA.y + 370, w: 160, h: 14 }, // left,  lower tier
  { x: ARENA.x + 670, y: ARENA.y + 370, w: 160, h: 14 }, // right, lower tier
];

// ── Input ─────────────────────────────────────────────────────────────────────

const keys = {};

document.addEventListener('keydown', e => {
  const gameCodes = [
    'KeyW','KeyA','KeyS','KeyD','Space',
    'ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter','Escape',
  ];
  if (gameCodes.includes(e.code)) e.preventDefault();
  keys[e.code] = true;

  if ((e.code === 'Enter' || e.code === 'Space') && gameState === 'start') {
    startCountdown();
  }
  if (e.code === 'Escape') {
    if (gameState === 'playing') gameState = 'paused';
    else if (gameState === 'paused') gameState = 'playing';
  }
  if (e.code === 'KeyR' && (gameState === 'gameover' || gameState === 'paused')) {
    startCountdown();
  }
});
document.addEventListener('keyup', e => { keys[e.code] = false; });

// ── Game state ────────────────────────────────────────────────────────────────

// 'start' | 'countdown' | 'playing' | 'paused' | 'gameover'
let gameState      = 'start';
let countdownStart = 0;

let projectiles  = [];
let particles    = [];
let powerUps     = [];
let mines        = [];
let nextSpawnTime = 0;
let winner       = '';

function makePlayer(x, color) {
  return {
    x, y: ARENA.y + ARENA.h - P_H,
    vx: 0, vy: 0,
    onGround: true,
    hp: 100, maxHp: 100,
    color, cooldown: 0, shield: 0, tripleShots: 0, gravityFrames: 0, mineShot: false, onPlatform: false, dropFrames: 0,
  };
}

let players = [
  makePlayer(ARENA.x + 80,                  '#FFE500'),
  makePlayer(ARENA.x + ARENA.w - 80 - P_W,  '#FF3F3F'),
];

// ── Logic ─────────────────────────────────────────────────────────────────────

function handleInput() {
  const [p1, p2] = players;

  // Player 1 — WASD + Space
  const accel1 = p1.onGround ? P_ACCEL_GROUND : P_ACCEL_AIR;
  if (keys['Space']) {
    let dx = 0, dy = 0;
    if (keys['KeyA']) dx -= 1;
    if (keys['KeyD']) dx += 1;
    if (keys['KeyW']) dy -= 1;
    if (keys['KeyS']) dy += 1;
    if ((dx || dy) && p1.cooldown === 0) fireProjectile(p1, dx, dy);
    p1.vx += (0 - p1.vx) * accel1;
  } else {
    const targetVx1 = keys['KeyA'] ? -MOVE_SPEED : keys['KeyD'] ? MOVE_SPEED : 0;
    p1.vx += (targetVx1 - p1.vx) * accel1;
    if (p1.gravityFrames > 0) {
      p1.vx = keys['KeyA'] ? -MOVE_SPEED : keys['KeyD'] ? MOVE_SPEED : 0;
      const targetVy1 = keys['KeyW'] ? -MOVE_SPEED : keys['KeyS'] ? MOVE_SPEED : 0;
      p1.vy = targetVy1;
    } else {
      if (keys['KeyW'] && p1.onGround) { p1.vy = JUMP_FORCE; p1.onGround = false; }
      if (keys['KeyS'] && p1.onPlatform) p1.dropFrames = 14;
    }
  }

  // Player 2 — Arrows + Enter
  const accel2 = p2.onGround ? P_ACCEL_GROUND : P_ACCEL_AIR;
  if (keys['Enter']) {
    let dx = 0, dy = 0;
    if (keys['ArrowLeft'])  dx -= 1;
    if (keys['ArrowRight']) dx += 1;
    if (keys['ArrowUp'])    dy -= 1;
    if (keys['ArrowDown'])  dy += 1;
    if ((dx || dy) && p2.cooldown === 0) fireProjectile(p2, dx, dy);
    p2.vx += (0 - p2.vx) * accel2;
  } else {
    const targetVx2 = keys['ArrowLeft'] ? -MOVE_SPEED : keys['ArrowRight'] ? MOVE_SPEED : 0;
    p2.vx += (targetVx2 - p2.vx) * accel2;
    if (p2.gravityFrames > 0) {
      p2.vx = keys['ArrowLeft'] ? -MOVE_SPEED : keys['ArrowRight'] ? MOVE_SPEED : 0;
      const targetVy2 = keys['ArrowUp'] ? -MOVE_SPEED : keys['ArrowDown'] ? MOVE_SPEED : 0;
      p2.vy = targetVy2;
    } else {
      if (keys['ArrowUp'] && p2.onGround) { p2.vy = JUMP_FORCE; p2.onGround = false; }
      if (keys['ArrowDown'] && p2.onPlatform) p2.dropFrames = 14;
    }
  }
}

function makeProjectile(player, dirX, dirY) {
  return {
    x: player.x + P_W / 2,
    y: player.y + P_H / 2,
    dirX, dirY,
    speed: PROJ_SPEED * 0.25,
    owner: player,
    color: player.color,
  };
}

function rotateDir(dirX, dirY, angle) {
  return [
    dirX * Math.cos(angle) - dirY * Math.sin(angle),
    dirX * Math.sin(angle) + dirY * Math.cos(angle),
  ];
}

function fireProjectile(player, dx, dy) {
  const len = Math.sqrt(dx * dx + dy * dy);
  const dirX = dx / len, dirY = dy / len;

  const isMineShotNow = player.mineShot;
  if (player.mineShot) player.mineShot = false;

  if (player.tripleShots > 0) {
    player.tripleShots--;
    const [ax, ay] = rotateDir(dirX, dirY, -TRIPLE_ANGLE);
    const [bx, by] = rotateDir(dirX, dirY,  TRIPLE_ANGLE);
    projectiles.push({ ...makeProjectile(player, dirX, dirY), mine: isMineShotNow });
    projectiles.push(makeProjectile(player, ax, ay));
    projectiles.push(makeProjectile(player, bx, by));
  } else {
    projectiles.push({ ...makeProjectile(player, dirX, dirY), mine: isMineShotNow });
  }
  player.cooldown = player.gravityFrames > 0 ? Math.floor(SHOOT_COOLDOWN / 3) : SHOOT_COOLDOWN;
}

function updatePhysics() {
  const floorY = ARENA.y + ARENA.h;
  for (const p of players) {
    if (p.gravityFrames > 0) {
      // Zero-g: free 2D movement, no gravity, arena bounds only
      p.x += p.vx;
      p.y += p.vy;
      p.onGround = false; p.onPlatform = false;
      if (p.x < ARENA.x)                  p.x = ARENA.x;
      if (p.x + P_W > ARENA.x + ARENA.w)  p.x = ARENA.x + ARENA.w - P_W;
      if (p.y < ARENA.y)                 { p.y = ARENA.y; p.vy = 0; }
      if (p.y + P_H > floorY)            { p.y = floorY - P_H; p.vy = 0; }
      p.gravityFrames--;
    } else {
      p.vy += GRAVITY;
      p.x  += p.vx;
      p.y  += p.vy;

      if (p.y + P_H >= floorY) {
        p.y = floorY - P_H; p.vy = 0; p.onGround = true;
      } else {
        p.onGround = false;
      }

      if (p.y < ARENA.y)                     { p.y = ARENA.y; p.vy = 0; }
      if (p.x < ARENA.x)                      p.x = ARENA.x;
      if (p.x + P_W > ARENA.x + ARENA.w)      p.x = ARENA.x + ARENA.w - P_W;

      // One-way platform collision
      p.onPlatform = false;
      if (p.dropFrames > 0) {
        p.dropFrames--;
      } else {
        for (const plat of PLATFORMS) {
          const prevBottom = p.y + P_H - p.vy;
          const overlapX   = p.x + P_W > plat.x && p.x < plat.x + plat.w;
          if (overlapX && p.vy >= 0 && p.y + P_H >= plat.y && prevBottom <= plat.y + 6) {
            p.y = plat.y - P_H;
            p.vy = 0;
            p.onGround   = true;
            p.onPlatform = true;
            break;
          }
        }
      }
    }

    if (p.cooldown > 0) p.cooldown--;
    if (p.shield  > 0) p.shield--;
  }
}

function updateProjectiles() {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const proj = projectiles[i];

    // Accelerate towards max speed
    proj.speed = Math.min(PROJ_SPEED, proj.speed + PROJ_ACCEL);
    proj.x += proj.dirX * proj.speed;
    proj.y += proj.dirY * proj.speed;

    // Out of arena → wall explosion
    if (
      proj.x + PROJ_RADIUS < ARENA.x ||
      proj.x - PROJ_RADIUS > ARENA.x + ARENA.w ||
      proj.y + PROJ_RADIUS < ARENA.y ||
      proj.y - PROJ_RADIUS > ARENA.y + ARENA.h
    ) {
      const ex = Math.max(ARENA.x, Math.min(proj.x, ARENA.x + ARENA.w));
      const ey = Math.max(ARENA.y, Math.min(proj.y, ARENA.y + ARENA.h));
      if (proj.mine) {
        mines.push({ x: ex, y: ey, owner: proj.owner, warnFrames: MINE_WARN_FRAMES });
      } else {
        spawnExplosion(ex, ey, proj.color);
      }
      projectiles.splice(i, 1);
      continue;
    }

    // Hit player (circle vs AABB)
    let hit = false;
    for (const player of players) {
      if (player === proj.owner) continue;
      const nx = Math.max(player.x, Math.min(proj.x, player.x + P_W));
      const ny = Math.max(player.y, Math.min(proj.y, player.y + P_H));
      const dx = proj.x - nx, dy = proj.y - ny;
      if (dx * dx + dy * dy < PROJ_RADIUS * PROJ_RADIUS) {
        if (player.shield > 0) {
          spawnExplosion(proj.x, proj.y, POWERUP_COLOR);
        } else {
          player.hp = Math.max(0, player.hp - PROJ_DAMAGE);
          spawnExplosion(proj.x, proj.y, proj.color);
        }
        projectiles.splice(i, 1);
        hit = true;
        break;
      }
    }
    if (hit) continue;
  }
}

function updateMines() {
  for (let i = mines.length - 1; i >= 0; i--) {
    const mine = mines[i];
    if (mine.warnFrames > 0) mine.warnFrames--;

    for (const player of players) {
      if (player === mine.owner) continue;
      const px = player.x + P_W / 2, py = player.y + P_H / 2;
      const dx = px - mine.x, dy = py - mine.y;
      if (dx * dx + dy * dy < MINE_TRIGGER_DIST * MINE_TRIGGER_DIST) {
        if (player.shield > 0) {
          spawnExplosion(mine.x, mine.y, POWERUP_COLOR, true);
        } else {
          player.hp = Math.max(0, player.hp - PROJ_DAMAGE);
          spawnExplosion(mine.x, mine.y, mine.owner.color, true);
        }
        mines.splice(i, 1);
        break;
      }
    }
  }
}

function checkGameOver() {
  if (players[0].hp <= 0 || players[1].hp <= 0) {
    gameState = 'gameover';
    if (players[0].hp <= 0 && players[1].hp <= 0) winner = 'UNENTSCHIEDEN';
    else if (players[0].hp <= 0) winner = 'SPIELER 2';
    else winner = 'SPIELER 1';
  }
}

// ── Power-ups ─────────────────────────────────────────────────────────────────

function scheduleNextSpawn() {
  nextSpawnTime = performance.now() + POWERUP_SPAWN_MIN
    + Math.random() * (POWERUP_SPAWN_MAX - POWERUP_SPAWN_MIN);
}

function spawnPowerUp() {
  const margin = 80;
  const x = ARENA.x + margin + Math.random() * (ARENA.w - margin * 2 - POWERUP_SIZE);
  // Spawn anywhere in the lower 75% of arena height
  const y = ARENA.y + ARENA.h * 0.25 + Math.random() * (ARENA.h * 0.75 - POWERUP_SIZE);
  const r = Math.random();
  const type = r < 0.25 ? 'shield' : r < 0.50 ? 'triple' : r < 0.75 ? 'gravity' : 'mine';
  powerUps.push({ x, y, type });
}

function updatePowerUps() {
  if (powerUps.length === 0 && performance.now() >= nextSpawnTime) spawnPowerUp();

  for (let i = powerUps.length - 1; i >= 0; i--) {
    const pu = powerUps[i];
    for (const player of players) {
      if (
        player.x < pu.x + POWERUP_SIZE &&
        player.x + P_W > pu.x &&
        player.y < pu.y + POWERUP_SIZE &&
        player.y + P_H > pu.y
      ) {
        const puColor = pu.type === 'triple' ? TRIPLE_COLOR : pu.type === 'gravity' ? GRAVITY_COLOR : pu.type === 'mine' ? MINE_COLOR : POWERUP_COLOR;
        if (pu.type === 'shield') player.shield = SHIELD_DURATION;
        if (pu.type === 'triple') player.tripleShots = 3;
        if (pu.type === 'gravity') player.gravityFrames = GRAVITY_DURATION;
        if (pu.type === 'mine') player.mineShot = true;
        spawnExplosion(pu.x + POWERUP_SIZE / 2, pu.y + POWERUP_SIZE / 2, puColor);
        powerUps.splice(i, 1);
        scheduleNextSpawn(); // timer starts only on pickup
        break;
      }
    }
  }
}

// ── Explosion particles ───────────────────────────────────────────────────────

function spawnExplosion(x, y, color, big = false) {
  const count = big ? 24 : 10;
  const speedMult = big ? 2.8 : 1;
  const radiusMult = big ? 2.5 : 1;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
    const speed = (1.8 + Math.random() * 2.5) * speedMult;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: (3 + Math.random() * 4) * radiusMult,
      alpha: 1,
      color,
    });
  }
}

function updateParticles() {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.92;
    p.vy *= 0.92;
    p.alpha  -= 0.065;
    p.radius *= 0.93;
    if (p.alpha <= 0) particles.splice(i, 1);
  }
}

// ── Start / countdown / reset ─────────────────────────────────────────────────

function startCountdown() {
  resetGameData();
  gameState      = 'countdown';
  countdownStart = performance.now();
}

function goToMenu() {
  resetGameData();
  gameState = 'start';
}

function resetGameData() {
  players[0].x = ARENA.x + 80;
  players[1].x = ARENA.x + ARENA.w - 80 - P_W;
  for (const p of players) {
    p.y = ARENA.y + ARENA.h - P_H;
    p.vx = 0; p.vy = 0;
    p.hp = 100; p.cooldown = 0; p.shield = 0; p.tripleShots = 0; p.gravityFrames = 0; p.mineShot = false; p.dropFrames = 0; p.onPlatform = false; p.onGround = true;
  }
  projectiles = [];
  particles   = [];
  powerUps    = [];
  mines       = [];
  winner      = '';
  // First spawn ~15 s into gameplay (after 3 s countdown)
  nextSpawnTime = performance.now() + 18000;
}

// ── Button helpers ────────────────────────────────────────────────────────────

const BTN_START             = { x: CANVAS_W / 2 - 130, y: CANVAS_H / 2 + 10,  w: 260, h: 54 };
const BTN_PAUSE_RESUME      = { x: CANVAS_W / 2 - 130, y: CANVAS_H / 2 - 75,  w: 260, h: 48 };
const BTN_PAUSE_RESTART     = { x: CANVAS_W / 2 - 130, y: CANVAS_H / 2 - 19,  w: 260, h: 48 };
const BTN_PAUSE_MENU        = { x: CANVAS_W / 2 - 130, y: CANVAS_H / 2 + 37,  w: 260, h: 48 };
const BTN_GAMEOVER_RESTART  = { x: CANVAS_W / 2 - 130, y: CANVAS_H / 2 - 19,  w: 260, h: 48 };
const BTN_GAMEOVER_MENU     = { x: CANVAS_W / 2 - 130, y: CANVAS_H / 2 + 37,  w: 260, h: 48 };

function hitTest(btn, mx, my) {
  return mx >= btn.x && mx <= btn.x + btn.w && my >= btn.y && my <= btn.y + btn.h;
}

canvas.addEventListener('click', e => {
  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left) * (CANVAS_W / rect.width);
  const my = (e.clientY - rect.top)  * (CANVAS_H / rect.height);

  if (gameState === 'start'   && hitTest(BTN_START, mx, my))          startCountdown();
  if (gameState === 'paused'  && hitTest(BTN_PAUSE_RESUME, mx, my))   gameState = 'playing';
  if (gameState === 'paused'  && hitTest(BTN_PAUSE_RESTART, mx, my))  startCountdown();
  if (gameState === 'paused'   && hitTest(BTN_PAUSE_MENU, mx, my))        goToMenu();
  if (gameState === 'gameover' && hitTest(BTN_GAMEOVER_RESTART, mx, my)) startCountdown();
  if (gameState === 'gameover' && hitTest(BTN_GAMEOVER_MENU, mx, my))    goToMenu();
});

// ── Drawing ───────────────────────────────────────────────────────────────────

function pillPath(x, y, w, h) {
  const r = w / 2;
  ctx.beginPath();
  ctx.arc(x + r, y + r, r, Math.PI, 0);
  ctx.lineTo(x + w, y + h - r);
  ctx.arc(x + r, y + h - r, r, 0, Math.PI);
  ctx.closePath();
}

function drawPill(x, y, w, h, fill) {
  pillPath(x, y, w, h);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3;
  ctx.stroke();
}

function drawShieldAura(p) {
  const expiring = p.shield < 90;
  if (expiring && Math.floor(performance.now() / 120) % 2 === 0) return;
  const pad = 7;
  const sx = p.x - pad, sy = p.y - pad, sw = P_W + pad * 2, sh = P_H + pad * 2;
  // Neobrutalism hard shadow
  pillPath(sx + 5, sy + 5, sw, sh);
  ctx.fillStyle = '#000';
  ctx.fill();
  // Cyan filled shield
  pillPath(sx, sy, sw, sh);
  ctx.fillStyle = POWERUP_COLOR;
  ctx.fill();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3;
  ctx.stroke();
}

function drawPowerUp(pu) {
  const bob = Math.sin(performance.now() / 380) * 4;
  const x = pu.x, y = pu.y + bob, s = POWERUP_SIZE;
  const cx = x + s / 2, cy = y + s / 2;
  const color = pu.type === 'triple' ? TRIPLE_COLOR : pu.type === 'gravity' ? GRAVITY_COLOR : pu.type === 'mine' ? MINE_COLOR : POWERUP_COLOR;

  // Hard shadow
  ctx.fillStyle = '#000';
  ctx.fillRect(x + 4, y + 4, s, s);
  // Box
  ctx.fillStyle = color;
  ctx.fillRect(x, y, s, s);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, s, s);

  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';

  if (pu.type === 'shield') {
    // Shield symbol
    ctx.beginPath();
    ctx.moveTo(cx,     cy - 9);
    ctx.lineTo(cx + 7, cy - 5);
    ctx.lineTo(cx + 7, cy + 1);
    ctx.lineTo(cx,     cy + 9);
    ctx.lineTo(cx - 7, cy + 1);
    ctx.lineTo(cx - 7, cy - 5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx,     cy - 5);
    ctx.lineTo(cx + 4, cy - 2);
    ctx.lineTo(cx + 4, cy + 2);
    ctx.lineTo(cx,     cy + 6);
    ctx.lineTo(cx - 4, cy + 2);
    ctx.lineTo(cx - 4, cy - 2);
    ctx.closePath();
    ctx.fill();
  } else if (pu.type === 'gravity') {
    // 4-directional arrows (cross)
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    const dirs = [[0,-1],[0,1],[-1,0],[1,0]];
    for (const [dx, dy] of dirs) {
      const ex = cx + dx * 9, ey = cy + dy * 9;
      ctx.beginPath();
      ctx.moveTo(cx + dx * 2, cy + dy * 2);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      // Arrowhead
      const perpX = dy, perpY = -dx;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - dx * 4 + perpX * 3, ey - dy * 4 + perpY * 3);
      ctx.lineTo(ex - dx * 4 - perpX * 3, ey - dy * 4 - perpY * 3);
      ctx.closePath();
      ctx.fill();
    }
    ctx.lineCap = 'butt';
  } else if (pu.type === 'mine') {
    // Mine symbol: circle with crosshair
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2); ctx.stroke();
    for (const [dx, dy] of [[0,-1],[0,1],[-1,0],[1,0]]) {
      ctx.beginPath();
      ctx.moveTo(cx + dx * 7, cy + dy * 7);
      ctx.lineTo(cx + dx * 10, cy + dy * 10);
      ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
    ctx.lineCap = 'butt';
  } else {
    // Triple shot symbol: three arrows fanning out to the right
    const angles = [-TRIPLE_ANGLE, 0, TRIPLE_ANGLE];
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    for (const a of angles) {
      const ex = cx + Math.cos(a) * 9;
      const ey = cy + Math.sin(a) * 9;
      ctx.beginPath();
      ctx.moveTo(cx - 6, cy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      // Arrowhead
      ctx.beginPath();
      ctx.arc(ex, ey, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.lineCap = 'butt';
  }
}

function drawPlatforms() {
  for (const plat of PLATFORMS) {
    // Hard shadow
    ctx.fillStyle = '#000';
    ctx.fillRect(plat.x + 5, plat.y + 5, plat.w, plat.h);
    // Surface
    ctx.fillStyle = '#FFFDF5';
    ctx.fillRect(plat.x, plat.y, plat.w, plat.h);
    // Border
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 3;
    ctx.strokeRect(plat.x, plat.y, plat.w, plat.h);
  }
}

function drawButton(btn, bgColor, label, fontSize = 18) {
  ctx.fillStyle = '#000';
  ctx.fillRect(btn.x + 5, btn.y + 5, btn.w, btn.h);
  ctx.fillStyle = bgColor;
  ctx.fillRect(btn.x, btn.y, btn.w, btn.h);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3;
  ctx.strokeRect(btn.x, btn.y, btn.w, btn.h);
  ctx.fillStyle = '#000';
  ctx.font = `bold ${fontSize}px monospace`;
  ctx.textAlign = 'center';
  ctx.fillText(label, btn.x + btn.w / 2, btn.y + btn.h / 2 + fontSize * 0.36);
}

function drawArena() {
  ctx.fillStyle = '#000';
  ctx.fillRect(ARENA.x + 6, ARENA.y + 6, ARENA.w, ARENA.h);
  ctx.fillStyle = '#E8DCC8';
  ctx.fillRect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);

  ctx.strokeStyle = 'rgba(0,0,0,0.07)';
  ctx.lineWidth = 1;
  for (let gx = ARENA.x; gx <= ARENA.x + ARENA.w; gx += 40) {
    ctx.beginPath(); ctx.moveTo(gx, ARENA.y); ctx.lineTo(gx, ARENA.y + ARENA.h); ctx.stroke();
  }
  for (let gy = ARENA.y; gy <= ARENA.y + ARENA.h; gy += 40) {
    ctx.beginPath(); ctx.moveTo(ARENA.x, gy); ctx.lineTo(ARENA.x + ARENA.w, gy); ctx.stroke();
  }

  ctx.strokeStyle = '#000';
  ctx.lineWidth = 4;
  ctx.strokeRect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);
}

function drawPlayer(p, index) {
  const shieldVisible = p.shield > 0 &&
    !(p.shield < 90 && Math.floor(performance.now() / 120) % 2 === 0);
  if (shieldVisible) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);
    ctx.clip();
    drawShieldAura(p);
    ctx.restore();
  } else {
    drawPill(p.x + 4, p.y + 4, P_W, P_H, '#000'); // normal shadow
  }
  drawPill(p.x, p.y, P_W, P_H, p.color);

  const eyeY = p.y + P_H * 0.27;
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.arc(p.x + 8,       eyeY, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(p.x + P_W - 8, eyeY, 3.5, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = '#000';
  ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`P${index + 1}`, p.x + P_W / 2, p.y + P_H * 0.62);

  // Gravity duration bar above player
  if (p.gravityFrames > 0) {
    const expiring = p.gravityFrames < 90;
    if (!expiring || Math.floor(performance.now() / 120) % 2 === 0) {
      const barW = P_W + 6, barH = 5;
      const bx = p.x - 3, by = p.y - 20;
      ctx.fillStyle = '#000';
      ctx.fillRect(bx + 2, by + 2, barW, barH);
      ctx.fillStyle = '#333';
      ctx.fillRect(bx, by, barW, barH);
      const fill = (p.gravityFrames / SHIELD_DURATION) * barW;
      ctx.fillStyle = GRAVITY_COLOR;
      ctx.fillRect(bx, by, fill, barH);
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(bx, by, barW, barH);
    }
  }

  // Triple shot dots above player
  if (p.tripleShots > 0) {
    const dotR = 4, gap = 11;
    const totalW = (p.tripleShots - 1) * gap;
    const startX = p.x + P_W / 2 - totalW / 2;
    const dotY = p.gravityFrames > 0 ? p.y - 30 : p.y - 10;
    for (let d = 0; d < p.tripleShots; d++) {
      const dotX = startX + d * gap;
      ctx.beginPath();
      ctx.arc(dotX + 2, dotY + 2, dotR, 0, Math.PI * 2);
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
      ctx.fillStyle = TRIPLE_COLOR;
      ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  // Mine shot indicator dot above player
  if (p.mineShot) {
    const dotR = 4;
    const dotX = p.x + P_W / 2;
    const dotY = p.gravityFrames > 0 ? p.y - 30 : p.y - 10;
    const offset = p.tripleShots > 0 ? (p.tripleShots - 1) * 11 / 2 + 14 : 0;
    const mx = dotX + offset;
    ctx.beginPath(); ctx.arc(mx + 2, dotY + 2, dotR, 0, Math.PI * 2);
    ctx.fillStyle = '#000'; ctx.fill();
    ctx.beginPath(); ctx.arc(mx, dotY, dotR, 0, Math.PI * 2);
    ctx.fillStyle = MINE_COLOR; ctx.fill();
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.stroke();
    // crosshair lines
    ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(mx - 6, dotY); ctx.lineTo(mx + 6, dotY); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(mx, dotY - 6); ctx.lineTo(mx, dotY + 6); ctx.stroke();
  }
}

function drawProjectile(proj) {
  ctx.beginPath();
  ctx.arc(proj.x + 3, proj.y + 3, PROJ_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(proj.x, proj.y, PROJ_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = proj.color;
  ctx.fill();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2.5;
  ctx.stroke();
}

function drawMines() {
  for (const mine of mines) {
    if (mine.warnFrames <= 0) continue;
    const expiring = mine.warnFrames < 30;
    if (expiring && Math.floor(performance.now() / 100) % 2 === 0) continue;
    ctx.font = 'bold 28px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000';
    ctx.fillText('!', mine.x + 3, mine.y + 3);
    ctx.fillStyle = mine.owner.color;
    ctx.fillText('!', mine.x, mine.y);
    ctx.textBaseline = 'alphabetic';
  }
}

function drawParticles() {
  for (const p of particles) {
    ctx.beginPath();
    ctx.arc(p.x + 2, p.y + 2, p.radius, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(0,0,0,${p.alpha * 0.4})`;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.globalAlpha = p.alpha;
    ctx.fillStyle = p.color;
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawHealthBar(x, y, w, h, hp, maxHp, color, label) {
  ctx.fillStyle = '#000';
  ctx.fillRect(x + 3, y + 3, w, h);
  ctx.fillStyle = '#fff';
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, Math.max(0, (hp / maxHp) * w), h);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3;
  ctx.strokeRect(x, y, w, h);
  ctx.fillStyle = '#000';
  ctx.font = 'bold 13px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(`${label}  ${hp} HP`, x + w / 2, y + h / 2 + 5);
}


function drawHUD() {
  drawHealthBar(20,             10, 200, 32, players[0].hp, 100, players[0].color, 'P1');
  drawHealthBar(CANVAS_W - 220, 10, 200, 32, players[1].hp, 100, players[1].color, 'P2');
  // Title — neobrutalism, vertically centered in HUD strip
  const titleY = ARENA.y / 2 + 3;
  ctx.font = 'bold 24px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.letterSpacing = '4px';
  // Hard shadow
  ctx.fillStyle = '#000';
  ctx.fillText('PILL FIGHT', CANVAS_W / 2 + 4, titleY + 4);
  // Stroke + fill
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#000';
  ctx.strokeText('PILL FIGHT', CANVAS_W / 2, titleY);
  ctx.fillStyle = '#FFE500';
  ctx.fillText('PILL FIGHT', CANVAS_W / 2, titleY);
  ctx.textBaseline = 'alphabetic';
  ctx.letterSpacing = '0px';
}

function drawOverlayBox(bx, by, bw, bh, bgColor) {
  ctx.fillStyle = '#000';
  ctx.fillRect(bx + 8, by + 8, bw, bh);
  ctx.fillStyle = bgColor;
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 4;
  ctx.strokeRect(bx, by, bw, bh);
}

function drawStartScreen() {
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const bw = 460;
  const bx = CANVAS_W / 2 - bw / 2;
  const by = BTN_START.y - 106;
  const bh = BTN_START.y + BTN_START.h + 42 - by;

  drawOverlayBox(bx, by, bw, bh, '#FFE500');

  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.font = 'bold 50px monospace';
  ctx.fillText('PILL FIGHT', CANVAS_W / 2, by + 68);
  drawButton(BTN_START, '#FF3F3F', '▶  SPIEL STARTEN', 19);
  ctx.font = '12px monospace';
  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.fillText('[ENTER] / [LEERTASTE] — Spiel starten', CANVAS_W / 2, BTN_START.y + BTN_START.h + 26);
}

function drawCountdownScreen(remaining) {
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const size = 140;
  const cx = CANVAS_W / 2, cy = CANVAS_H / 2;

  drawOverlayBox(cx - size / 2, cy - size / 2, size, size, '#FFE500');

  ctx.fillStyle = '#000';
  ctx.font = 'bold 90px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(String(remaining), cx, cy + 32);
}

function drawPauseScreen() {
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // box spans from first button top - 80 to last button bottom + 20
  const bw = 360;
  const bx = CANVAS_W / 2 - bw / 2;
  const by = BTN_PAUSE_RESUME.y - 80;
  const bh = BTN_PAUSE_MENU.y + BTN_PAUSE_MENU.h + 28 - by;

  drawOverlayBox(bx, by, bw, bh, '#fff');

  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.font = 'bold 38px monospace';
  ctx.fillText('PAUSE', CANVAS_W / 2, by + 50);

  drawButton(BTN_PAUSE_RESUME,  '#FFE500', '▶  FORTSETZEN',  17);
  drawButton(BTN_PAUSE_RESTART, '#FF3F3F', '↺  NEU STARTEN', 17);
  drawButton(BTN_PAUSE_MENU,    '#fff',    '⌂  HAUPTMENÜ',   17);

  ctx.font = '11px monospace';
  ctx.fillStyle = '#555';
  ctx.fillText('[ESC] — Fortsetzen  |  [R] — Neustart', CANVAS_W / 2, by + bh - 10);
}

function drawGameOverScreen() {
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const boxColor =
    winner === 'SPIELER 1' ? '#FFE500' :
    winner === 'SPIELER 2' ? '#FF3F3F' : '#fff';
  const restartColor =
    winner === 'SPIELER 1' ? '#FF3F3F' :
    winner === 'SPIELER 2' ? '#FFE500' : '#ddd';

  const bw = 360;
  const bx = CANVAS_W / 2 - bw / 2;
  const by = BTN_GAMEOVER_RESTART.y - 116;
  const bh = BTN_GAMEOVER_MENU.y + BTN_GAMEOVER_MENU.h + 28 - by;

  drawOverlayBox(bx, by, bw, bh, boxColor);

  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.font = 'bold 38px monospace';
  ctx.fillText('GAME OVER', CANVAS_W / 2, by + 50);
  ctx.font = 'bold 22px monospace';
  ctx.fillText(
    winner === 'UNENTSCHIEDEN' ? 'UNENTSCHIEDEN!' : `${winner} GEWINNT!`,
    CANVAS_W / 2, by + 84,
  );

  drawButton(BTN_GAMEOVER_RESTART, restartColor,  '↺  NEU STARTEN', 17);
  drawButton(BTN_GAMEOVER_MENU,    '#fff',         '⌂  HAUPTMENÜ',   17);

  ctx.font = '11px monospace';
  ctx.fillStyle = '#000';
  ctx.fillText('[R] — Neustart', CANVAS_W / 2, by + bh - 10);
}

// ── Main loop ─────────────────────────────────────────────────────────────────

const TICK_MS = 1000 / 60;
let lastTime = 0;

function gameLoop(timestamp) {
  const delta = Math.min(timestamp - lastTime, 100);
  lastTime = timestamp;
  const steps = Math.max(1, Math.round(delta / TICK_MS));

  for (let s = 0; s < steps; s++) {
    if (gameState === 'playing') {
      handleInput();
      updatePhysics();
      updateProjectiles();
      updateMines();
      updatePowerUps();
      updateParticles();
      checkGameOver();
    } else if (gameState === 'countdown') {
      updateParticles();
      const elapsed = (performance.now() - countdownStart) / 1000;
      if (elapsed >= 3) gameState = 'playing';
    } else {
      updateParticles();
    }
  }

  ctx.fillStyle = '#F2EFE5';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  drawArena();
  for (const proj of projectiles) drawProjectile(proj);
  drawParticles();
  drawMines();
  for (let i = 0; i < players.length; i++) drawPlayer(players[i], i);
  drawPlatforms();
  for (const pu of powerUps) drawPowerUp(pu);

  drawHUD();

  if (gameState === 'start')    drawStartScreen();
  if (gameState === 'paused')   drawPauseScreen();
  if (gameState === 'gameover') drawGameOverScreen();
  if (gameState === 'countdown') {
    const remaining = Math.ceil(3 - (performance.now() - countdownStart) / 1000);
    drawCountdownScreen(remaining);
  }

  requestAnimationFrame(gameLoop);
}

requestAnimationFrame(ts => { lastTime = ts; requestAnimationFrame(gameLoop); });

