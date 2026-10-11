(function () {
  'use strict';

  /* ============================================================
     CANVAS / PROJECTION
     ============================================================ */
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  let W = 0, H = 0, horizon = 0, FOCAL = 540;

  const CAM_Y     = 3.0;
  const LANES     = [-2.2, 0, 2.2];
  const PLAYER_Z  = 8;
  const GRAVITY   = 26;
  const JUMP_V    = 9.2;
  const TRACK_HW  = 3.3;
  const NEAR      = 1.5;
  const FAR       = 170;
  const JET_HEIGHT = 3.2;

  let camX = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth || window.innerWidth;
    H = canvas.clientHeight || window.innerHeight;
    canvas.width  = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    horizon = H * 0.38;
    FOCAL   = H * 0.90;
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));

  function project(x, y, z) {
    const s = FOCAL / z;
    return { x: W * 0.5 + (x - camX) * s, y: horizon + (CAM_Y - y) * s, s: s };
  }
  function quad(a, b, c, d, fill) {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y);
    ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
  }
  function drawBox(x0, x1, y0, y1, z0, z1, hue) {
    if (z1 <= z0) return;
    const P000 = project(x0, y0, z0), P100 = project(x1, y0, z0);
    const P110 = project(x1, y1, z0), P010 = project(x0, y1, z0);
    const B000 = project(x0, y0, z1), B100 = project(x1, y0, z1);
    const B110 = project(x1, y1, z1), B010 = project(x0, y1, z1);
    const L = (l, s) => 'hsl(' + hue + ', ' + (s || 45) + '%, ' + l + '%)';
    quad(B000, B100, B110, B010, L(17, 40));
    if (y1 < CAM_Y) quad(P010, P110, B110, B010, L(46, 48));
    if (camX < x0) quad(P000, P010, B010, B000, L(25, 42));
    if (camX > x1) quad(P100, P110, B110, B100, L(25, 42));
    quad(P000, P100, P110, P010, L(34, 55));
  }
  function rrect(x, y, w, h, r) {
    if (typeof ctx.roundRect === 'function') {
      ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return;
    }
    r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function hash(n) {
    const x = Math.sin(n * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  }

  /* ============================================================
     AUDIO (Web Audio API — no external files)
     ============================================================ */
  let audioCtx = null;
  let muted = false;

  function initAudio() {
    if (audioCtx) {
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) audioCtx = new AC();
    } catch (e) { audioCtx = null; }
  }

  function tone(freqStart, freqEnd, dur, type, gainVal, delay) {
    if (muted || !audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    const t0 = audioCtx.currentTime + (delay || 0);
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freqStart, t0);
    if (freqEnd && freqEnd !== freqStart) {
      o.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + dur);
    }
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gainVal, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  const SFX = {
    jump:  () => tone(280, 640, 0.16, 'square', 0.07),
    slide: () => tone(520, 140, 0.18, 'sawtooth', 0.05),
    coin:  () => { tone(1046, 1568, 0.10, 'sine', 0.10);
                   tone(1568, 2093, 0.10, 'sine', 0.07, 0.05); },
    power: () => { tone(392, 784, 0.10, 'triangle', 0.10);
                   tone(784, 1568, 0.16, 'triangle', 0.09, 0.09);
                   tone(1568, 2349, 0.20, 'triangle', 0.07, 0.22); },
    crash: () => { tone(180, 50, 0.42, 'sawtooth', 0.13);
                   tone(90, 40, 0.55, 'square', 0.09, 0.02); },
    record:() => { [523, 659, 784, 1046].forEach((f, i) =>
                     tone(f, f * 1.5, 0.16, 'triangle', 0.09, i * 0.09)); },
    click: () => tone(700, 900, 0.05, 'square', 0.04)
  };

  /* ============================================================
     STORAGE
     ============================================================ */
  const LS = {
    best:    'sd_best_v2',
    total:   'sd_totalCoins_v2',
    unlocked:'sd_unlocked_v2',
    skin:    'sd_skin_v2',
    muted:   'sd_muted_v2'
  };
  function lsGet(k, def) {
    try { const v = localStorage.getItem(k); return v === null ? def : v; }
    catch (e) { return def; }
  }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  /* ============================================================
     SKINS
     ============================================================ */
  const SKINS = [
    { id: 'runner', name: 'RUNNER', cost: 0,
      body1: '#4ef0a5', body2: '#17b06b', arm: '#2bd88c',
      leg: '#1e2a44', skin: '#ffd8b0', cap: '#ff5d73', capBrim: '#ff5d73' },
    { id: 'ninja', name: 'NINJA', cost: 100,
      body1: '#5a5a72', body2: '#22222e', arm: '#3a3a4a',
      leg: '#151520', skin: '#c9a48a', cap: '#1a1a26', capBrim: '#ff2d55' },
    { id: 'officer', name: 'OFFICER', cost: 300,
      body1: '#4a8dff', body2: '#1c4bb8', arm: '#3a72dd',
      leg: '#101a3a', skin: '#ffd8b0', cap: '#0d1c48', capBrim: '#ffd166' },
    { id: 'gold', name: 'GOLD', cost: 750,
      body1: '#ffd166', body2: '#c98a00', arm: '#ffb800',
      leg: '#5a3a00', skin: '#ffe9b8', cap: '#8a4b00', capBrim: '#ffd166' },
    { id: 'neon', name: 'NEON', cost: 1500,
      body1: '#ff2df7', body2: '#a300a0', arm: '#ff6bfa',
      leg: '#2a0030', skin: '#ffd8f0', cap: '#00e5ff', capBrim: '#00e5ff' },
    { id: 'shadow', name: 'SHADOW', cost: 3000,
      body1: '#2a2a3a', body2: '#05050a', arm: '#3a3a52',
      leg: '#020205', skin: '#8a8aa0', cap: '#000000', capBrim: '#00e5ff' }
  ];

  let unlockedSkins = [];
  let selectedSkin = 'runner';
  let totalCoins = 0;
  let bestScore = 0;

  function loadStorage() {
    bestScore = parseInt(lsGet(LS.best, '0'), 10) || 0;
    totalCoins = parseInt(lsGet(LS.total, '0'), 10) || 0;
    muted = lsGet(LS.muted, '0') === '1';
    try { unlockedSkins = JSON.parse(lsGet(LS.unlocked, '["runner"]')); }
    catch (e) { unlockedSkins = ['runner']; }
    if (!Array.isArray(unlockedSkins) || !unlockedSkins.length) unlockedSkins = ['runner'];
    selectedSkin = lsGet(LS.skin, 'runner');
    if (unlockedSkins.indexOf(selectedSkin) < 0) selectedSkin = 'runner';
    updateMuteBtn();
  }
  function saveStorage() {
    lsSet(LS.best, String(bestScore));
    lsSet(LS.total, String(totalCoins));
    lsSet(LS.unlocked, JSON.stringify(unlockedSkins));
    lsSet(LS.skin, selectedSkin);
    lsSet(LS.muted, muted ? '1' : '0');
  }
  function getSkin() {
    for (let i = 0; i < SKINS.length; i++) if (SKINS[i].id === selectedSkin) return SKINS[i];
    return SKINS[0];
  }

  /* ============================================================
     OBSTACLE / POWERUP TYPES
     ============================================================ */
  const OBSTACLE_TYPES = {
    low:  { w: 1.9, y0: 0.00, y1: 1.10, d: 0.80, hue: 45  },
    high: { w: 1.9, y0: 1.15, y1: 2.70, d: 0.80, hue: 355 },
    tall: { w: 1.9, y0: 0.00, y1: 2.70, d: 2.60, hue: 210 }
  };
  const POWER_TYPES = ['magnet', 'jetpack', 'shield'];

  /* ============================================================
     GAME STATE
     ============================================================ */
  const GAME = {
    state: 'menu',
    cameraZ: 0, speed: 22, distance: 0, coins: 0, score: 0,
    obstacles: [], pickups: [], particles: [], powerups: [],
    nextSpawnZ: 75, nextPowerZ: 120
  };
  const P = {
    lane: 1, x: 0, y: 0, vy: 0,
    onGround: true, slide: 0, runPhase: 0,
    magnet: 0, jetpack: 0, shield: 0,
    shieldHit: 0
  };
  let overTime = 0;

  /* ============================================================
     DOM REFS
     ============================================================ */
  const $ = id => document.getElementById(id);
  const overlay   = $('overlay');
  const menuPanel = $('menuPanel');
  const skinsPanel= $('skinsPanel');
  const overPanel = $('overPanel');
  const skinGrid  = $('skinGrid');
  const startBtn  = $('startBtn');
  const skinsBtn  = $('skinsBtn');
  const skinsBack = $('skinsBack');
  const retryBtn  = $('retryBtn');
  const homeBtn   = $('homeBtn');
  const muteBtn   = $('muteBtn');
  const touchCtl  = $('touchControls');

  const uiScore = $('uiScore');
  const uiCoins = $('uiCoins');
  const uiBest  = $('uiBest');
  const menuBest= $('menuBest');
  const menuCoins = $('menuCoins');
  const ovScore = $('ovScore');
  const ovCoins = $('ovCoins');
  const ovBest  = $('ovBest');
  const newRecordEl = $('newRecord');

  const pwMagnet = $('pwMagnet');
  const pwJet    = $('pwJet');
  const pwShield = $('pwShield');

  let hudCache = { s: -1, c: -1, b: -1 };

  function updateMuteBtn() { muteBtn.textContent = muted ? '🔇' : '🔊'; }

  /* ============================================================
     RESET / START / GAME OVER
     ============================================================ */
  function reset() {
    GAME.cameraZ = 0; GAME.distance = 0; GAME.speed = 22;
    GAME.coins = 0; GAME.score = 0;
    GAME.obstacles.length = 0;
    GAME.pickups.length = 0;
    GAME.particles.length = 0;
    GAME.powerups.length = 0;
    GAME.nextSpawnZ = 75; GAME.nextPowerZ = 120;
    P.lane = 1; P.x = 0; P.y = 0; P.vy = 0;
    P.onGround = true; P.slide = 0; P.runPhase = 0;
    P.magnet = 0; P.jetpack = 0; P.shield = 0; P.shieldHit = 0;
    camX = 0;
    hudCache.s = hudCache.c = hudCache.b = -1;
    updatePowerUI();
  }

  function showPanel(which) {
    menuPanel.classList.toggle('hidden', which !== 'menu');
    skinsPanel.classList.toggle('hidden', which !== 'skins');
    overPanel.classList.toggle('hidden', which !== 'over');
    overlay.classList.add('show');
    touchCtl.classList.add('hidden');
  }
  function hideOverlay() {
    overlay.classList.remove('show');
  }

  function gotoMenu() {
    reset();
    GAME.state = 'menu';
    menuBest.textContent = bestScore;
    menuCoins.textContent = totalCoins;
    showPanel('menu');
  }

  function startGame() {
    initAudio();
    SFX.click();
    reset();
    GAME.state = 'playing';
    hideOverlay();
    if (isTouch) touchCtl.classList.remove('hidden');
  }

  function gameOver() {
    if (GAME.state !== 'playing') return;
    GAME.state = 'over';
    overTime = performance.now();
    SFX.crash();
    if (navigator.vibrate) try { navigator.vibrate(80); } catch (e) {}

    burst(P.x, P.y + 0.9, PLAYER_Z, 32, '#ff6b81');

    const isRecord = GAME.score > bestScore;
    if (isRecord) { bestScore = GAME.score; SFX.record(); }
    totalCoins += GAME.coins;
    saveStorage();

    ovScore.textContent = GAME.score;
    ovCoins.textContent = GAME.coins;
    ovBest.textContent  = bestScore;
    newRecordEl.classList.toggle('hidden', !isRecord);

    showPanel('over');
  }

  /* ============================================================
     SPAWNING
     ============================================================ */
  function spawnRow(z) {
    const lanes = [0, 1, 2];
    for (let i = lanes.length - 1; i > 0; i--) {
      const j = (Math.random() * (i + 1)) | 0;
      const t = lanes[i]; lanes[i] = lanes[j]; lanes[j] = t;
    }
    const nBlock = Math.random() < 0.35 ? 1 : 2;
    const blocked = lanes.slice(0, nBlock);
    const free    = lanes.slice(nBlock);

    for (let i = 0; i < blocked.length; i++) {
      const r = Math.random();
      const type = r < 0.38 ? 'low' : r < 0.72 ? 'high' : 'tall';
      const def = OBSTACLE_TYPES[type];
      GAME.obstacles.push({
        type, x: LANES[blocked[i]], w: def.w,
        y0: def.y0, y1: def.y1, d: def.d, hue: def.hue, zAbs: z
      });
    }

    if (free.length && Math.random() < 0.68) {
      const lane = free[(Math.random() * free.length) | 0];
      const n = 3 + ((Math.random() * 3) | 0);
      const step = 1.6;
      const start = z - (n - 1) * step * 0.5;
      for (let i = 0; i < n; i++) {
        GAME.pickups.push({
          x: LANES[lane], y: 0.95, zAbs: start + i * step,
          got: false, spin: Math.random() * 6.28
        });
      }
    }
  }

  function spawnPowerup(z) {
    const lanes = [0, 1, 2];
    const lane = lanes[(Math.random() * 3) | 0];
    const type = POWER_TYPES[(Math.random() * POWER_TYPES.length) | 0];
    GAME.powerups.push({
      type, x: LANES[lane], y: 1.2, zAbs: z, got: false,
      spin: Math.random() * 6.28
    });
  }

  /* ============================================================
     PARTICLES
     ============================================================ */
  function burst(worldX, worldY, relZ, count, color) {
    if (relZ < NEAR) return;
    const p = project(worldX, worldY, relZ);
    for (let i = 0; i < (count || 10); i++) {
      const a  = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 260;
      GAME.particles.push({
        x: p.x, y: p.y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 90,
        life: 0.45 + Math.random() * 0.35, max: 0.8,
        r: 2 + Math.random() * 3.5, c: color || '#ffd166'
      });
    }
  }
  function updateParticles(dt) {
    for (let i = GAME.particles.length - 1; i >= 0; i--) {
      const p = GAME.particles[i];
      p.life -= dt;
      if (p.life <= 0) { GAME.particles.splice(i, 1); continue; }
      p.vy += 900 * dt;
      p.x  += p.vx * dt; p.y += p.vy * dt;
    }
  }
  function drawParticles() {
    for (let i = 0; i < GAME.particles.length; i++) {
      const p = GAME.particles[i];
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.max));
      ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /* ============================================================
     INPUT
     ============================================================ */
  const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

  function moveLeft()  { if (GAME.state === 'playing' && P.lane > 0) { P.lane--; SFX.click(); } }
  function moveRight() { if (GAME.state === 'playing' && P.lane < 2) { P.lane++; SFX.click(); } }
  function doJump() {
    if (GAME.state !== 'playing') return;
    if (P.onGround && P.jetpack <= 0) {
      P.vy = JUMP_V; P.onGround = false; P.slide = 0;
      SFX.jump();
    }
  }
  function doSlide() {
    if (GAME.state !== 'playing') return;
    if (!P.onGround) P.vy = Math.min(P.vy, -7);
    if (P.slide <= 0) SFX.slide();
    P.slide = 0.65;
  }
  function tryStartFromInput() {
    if (GAME.state === 'playing') return;
    if (GAME.state === 'over' && performance.now() - overTime < 500) return;
    if (!overlay.classList.contains('show')) return;
    if (!menuPanel.classList.contains('hidden')) startGame();
  }

  window.addEventListener('keydown', function (e) {
    const k = e.key;
    if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' ','Spacebar'].indexOf(k) >= 0) e.preventDefault();
    switch (k) {
      case 'ArrowLeft': case 'a': case 'A': moveLeft();  break;
      case 'ArrowRight': case 'd': case 'D': moveRight(); break;
      case 'ArrowDown': case 's': case 'S': doSlide(); break;
      case 'ArrowUp': case 'w': case 'W':
      case ' ': case 'Spacebar':
        if (GAME.state === 'playing') doJump();
        else tryStartFromInput();
        break;
    }
  }, { passive: false });

  // Swipe
  let touchStart = null;
  canvas.addEventListener('touchstart', function (e) {
    initAudio();
    e.preventDefault();
    const t = e.changedTouches[0];
    touchStart = { x: t.clientX, y: t.clientY, id: t.identifier, time: performance.now() };
  }, { passive: false });

  canvas.addEventListener('touchend', function (e) {
    e.preventDefault();
    if (!touchStart) return;
    let t = null;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === touchStart.id) { t = e.changedTouches[i]; break; }
    }
    if (!t) { touchStart = null; return; }
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    const quick = performance.now() - touchStart.time < 260;
    touchStart = null;
    if (Math.max(adx, ady) < 26) {
      if (quick) tryStartFromInput();
      return;
    }
    if (adx > ady) { if (dx > 0) moveRight(); else moveLeft(); }
    else           { if (dy > 0) doSlide();   else doJump(); }
  }, { passive: false });

  canvas.addEventListener('mousedown', function () { initAudio(); tryStartFromInput(); });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  document.addEventListener('gesturestart', e => e.preventDefault());
  document.addEventListener('dblclick', e => e.preventDefault(), { passive: false });

  // Touch on-screen buttons
  (function bindTouchButtons() {
    const btns = touchCtl.querySelectorAll('.tc-btn');
    for (let i = 0; i < btns.length; i++) {
      const b = btns[i];
      const act = b.getAttribute('data-act');
      const handler = function (e) {
        e.preventDefault(); e.stopPropagation();
        initAudio();
        if (act === 'left')  moveLeft();
        if (act === 'right') moveRight();
        if (act === 'jump')  doJump();
        if (act === 'slide') doSlide();
      };
      b.addEventListener('touchstart', handler, { passive: false });
      b.addEventListener('mousedown', handler);
    }
  })();

  /* ============================================================
     UPDATE
     ============================================================ */
  function stepGame(dt) {
    GAME.speed = Math.min(62, 22 + GAME.distance * 0.022);
    const dz = GAME.speed * dt;
    GAME.cameraZ  += dz;
    GAME.distance += dz;
    GAME.score = Math.floor(GAME.distance) + GAME.coins * 10;

    // power-up timers
    if (P.magnet  > 0) P.magnet  = Math.max(0, P.magnet  - dt);
    if (P.jetpack > 0) P.jetpack = Math.max(0, P.jetpack - dt);
    if (P.shield  > 0) P.shield  = Math.max(0, P.shield  - dt);

    // lateral
    const tx = LANES[P.lane];
    P.x += (tx - P.x) * Math.min(1, dt * 15);
    if (Math.abs(tx - P.x) < 0.008) P.x = tx;

    // vertical / jetpack
    if (P.jetpack > 0) {
      P.onGround = false;
      P.vy = 0;
      P.y += (JET_HEIGHT - P.y) * Math.min(1, dt * 6);
      if (Math.random() < 0.6) {
        const p = project(P.x, P.y + 0.2, PLAYER_Z);
        GAME.particles.push({
          x: p.x + (Math.random() - 0.5) * 16, y: p.y + 12,
          vx: (Math.random() - 0.5) * 40, vy: 120 + Math.random() * 80,
          life: 0.35, max: 0.35, r: 3 + Math.random() * 3,
          c: Math.random() < 0.5 ? '#ffcc33' : '#ff6b3d'
        });
      }
    } else if (!P.onGround) {
      P.vy -= GRAVITY * dt;
      P.y  += P.vy * dt;
      if (P.y <= 0) { P.y = 0; P.vy = 0; P.onGround = true; }
    }

    if (P.slide > 0) P.slide -= dt;
    P.runPhase += dt * (6 + GAME.speed * 0.35);
    camX += (P.x * 0.55 - camX) * Math.min(1, dt * 9);

    // spawning
    while (GAME.nextSpawnZ < GAME.cameraZ + FAR - 10) {
      spawnRow(GAME.nextSpawnZ);
      GAME.nextSpawnZ += GAME.speed * (1.05 + Math.random() * 0.55) + 8;
    }
    if (GAME.cameraZ + GAME.speed * 3 > GAME.nextPowerZ) {
      spawnPowerup(GAME.nextPowerZ);
      GAME.nextPowerZ = GAME.cameraZ + 220 + Math.random() * 260;
    }

    // magnet pull
    if (P.magnet > 0) {
      const pz = GAME.cameraZ + PLAYER_Z;
      for (let i = 0; i < GAME.pickups.length; i++) {
        const c = GAME.pickups[i];
        if (c.got) continue;
        const dzc = c.zAbs - pz;
        if (Math.abs(dzc) > 9) continue;
        const dxc = P.x - c.x;
        const dyc = (P.y + 0.9) - c.y;
        const dist = Math.sqrt(dxc * dxc + dyc * dyc + dzc * dzc);
        if (dist < 7 && dist > 0.01) {
          const pull = Math.min(1, dt * 14) * (1 - dist / 7);
          c.x += dxc * pull;
          c.y += dyc * pull;
        }
      }
    }

    checkCollisions();

    const cullZ = GAME.cameraZ - 6;
    GAME.obstacles = GAME.obstacles.filter(o => o.zAbs > cullZ);
    GAME.pickups   = GAME.pickups.filter(c => !c.got && c.zAbs > cullZ);
    GAME.powerups  = GAME.powerups.filter(p => !p.got && p.zAbs > cullZ);
  }

  function applyPowerup(type) {
    SFX.power();
    if (navigator.vibrate) try { navigator.vibrate(40); } catch (e) {}
    if (type === 'magnet')  P.magnet  = 9;
    if (type === 'jetpack') P.jetpack = 5.5;
    if (type === 'shield')  P.shield  = 8;
    const p = project(P.x, P.y + 1.2, PLAYER_Z);
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 80 + Math.random() * 220;
      GAME.particles.push({
        x: p.x, y: p.y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
        life: 0.6 + Math.random() * 0.4, max: 1.0,
        r: 2 + Math.random() * 4,
        c: type === 'magnet' ? '#ff4d6d' : type === 'jetpack' ? '#a06bff' : '#4dc3ff'
      });
    }
  }

  function checkCollisions() {
    const pz  = GAME.cameraZ + PLAYER_Z;
    const ph  = P.slide > 0 ? 0.95 : 1.70;
    const px0 = P.x - 0.42, px1 = P.x + 0.42;
    const py0 = P.y, py1 = P.y + ph;
    const invincible = P.shield > 0 || P.jetpack > 0;

    if (!invincible) {
      for (let i = 0; i < GAME.obstacles.length; i++) {
        const o = GAME.obstacles[i];
        if (Math.abs(o.zAbs - pz) > o.d * 0.5 + 0.6) continue;
        if (px1 < o.x - o.w * 0.5 || px0 > o.x + o.w * 0.5) continue;
        if (py1 < o.y0 || py0 > o.y1) continue;
        gameOver(); return;
      }
    }

    const collectZRange = P.magnet > 0 ? 3.0 : 1.1;
    const collectXRange = P.magnet > 0 ? 2.5 : 0.95;

    for (let i = 0; i < GAME.pickups.length; i++) {
      const c = GAME.pickups[i];
      if (c.got) continue;
      if (Math.abs(c.zAbs - pz) > collectZRange) continue;
      if (Math.abs(c.x - P.x) > collectXRange) continue;
      if (py0 > 1.5 || py1 < 0.2) continue;
      c.got = true;
      GAME.coins++;
      SFX.coin();
      burst(c.x, c.y, c.zAbs - GAME.cameraZ, 8, '#ffd166');
    }

    for (let i = 0; i < GAME.powerups.length; i++) {
      const pw = GAME.powerups[i];
      if (pw.got) continue;
      if (Math.abs(pw.zAbs - pz) > 1.4) continue;
      if (Math.abs(pw.x - P.x) > 1.3) continue;
      if (py0 > 2.0 || py1 < 0.0) continue;
      pw.got = true;
      applyPowerup(pw.type);
    }
  }

  function update(dt) {
    if (GAME.state === 'playing') {
      const steps = Math.max(1, Math.ceil(dt / 0.02));
      const sdt = dt / steps;
      for (let i = 0; i < steps; i++) {
        if (GAME.state !== 'playing') break;
        stepGame(sdt);
      }
    } else if (GAME.state === 'menu') {
      GAME.cameraZ += 14 * dt;
      P.runPhase += dt * 9;
      camX += (0 - camX) * Math.min(1, dt * 4);
      P.x  += (0 - P.x)  * Math.min(1, dt * 6);
      GAME.nextSpawnZ = GAME.cameraZ + 80;
    }
    updateParticles(dt);
    updatePowerUI();
    updateHud();
  }

  function updateHud() {
    if (GAME.score !== hudCache.s) { uiScore.textContent = GAME.score; hudCache.s = GAME.score; }
    if (GAME.coins !== hudCache.c) { uiCoins.textContent = GAME.coins; hudCache.c = GAME.coins; }
    const b = Math.max(bestScore, GAME.score);
    if (b !== hudCache.b) { uiBest.textContent = b; hudCache.b = b; }
  }

  function updatePowerUI() {
    const setPw = (el, t, max) => {
      if (t > 0) {
        el.classList.add('on');
        el.querySelector('i').style.transform = 'scaleX(' + (t / max) + ')';
      } else el.classList.remove('on');
    };
    setPw(pwMagnet, P.magnet, 9);
    setPw(pwJet,    P.jetpack, 5.5);
    setPw(pwShield, P.shield, 8);
  }

  /* ============================================================
     RENDER
     ============================================================ */
  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, horizon + 60);
    g.addColorStop(0,    '#070b1c');
    g.addColorStop(0.55, '#152046');
    g.addColorStop(1,    '#3b2b60');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, horizon + 62);

    const sx = W * 0.5 - camX * 90;
    const rg = ctx.createRadialGradient(sx, horizon - 40, 10, sx, horizon - 40, Math.max(W, H) * 0.6);
    rg.addColorStop(0,   'rgba(255,150,90,0.40)');
    rg.addColorStop(0.4, 'rgba(255,110,140,0.12)');
    rg.addColorStop(1,   'rgba(255,110,140,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, horizon + 62);

    drawSkyline();
  }
  function drawSkyline() {
    const base  = horizon + 1;
    const bw    = 54;
    const shift = camX * 110;
    const i0 = Math.floor(shift / bw) - 1;
    const i1 = Math.ceil((W + shift) / bw) + 1;
    for (let i = i0; i <= i1; i++) {
      const x  = i * bw - shift;
      const h1 = hash(i * 1.37);
      const h2 = hash(i * 7.13 + 3.1);
      const w  = bw * (0.55 + h1 * 0.35);
      const h  = 24 + h2 * 78;
      ctx.fillStyle = '#0a0f22';
      ctx.fillRect(x, base - h, w, h);
      if (h2 > 0.55) {
        ctx.fillStyle = 'rgba(255,214,120,0.45)';
        for (let wy = base - h + 10; wy < base - 8; wy += 14)
          for (let wx = x + 6; wx < x + w - 8; wx += 12)
            if (hash(wx * 0.31 + wy * 0.77) > 0.6) ctx.fillRect(wx, wy, 4, 5);
      }
    }
  }
  function drawGround() {
    const g = ctx.createLinearGradient(0, horizon, 0, H);
    g.addColorStop(0, '#0d1226');
    g.addColorStop(1, '#03040a');
    ctx.fillStyle = g;
    ctx.fillRect(0, horizon, W, H - horizon + 1);
  }
  function drawRail(x) {
    const w = 0.10;
    const a = project(x - w, 0.02, NEAR);
    const b = project(x + w, 0.02, NEAR);
    const c = project(x + w, 0.02, FAR);
    const d = project(x - w, 0.02, FAR);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y);
    ctx.closePath(); ctx.fill();
  }
  function drawDashes(lx) {
    const period = 6, dashLen = 3;
    const startK = Math.floor((GAME.cameraZ + NEAR) / period);
    const endK   = Math.floor((GAME.cameraZ + FAR) / period);
    ctx.fillStyle = 'rgba(180,205,255,0.18)';
    for (let k = startK; k <= endK; k++) {
      let z0 = k * period - GAME.cameraZ;
      let z1 = z0 + dashLen;
      if (z1 < NEAR || z0 > FAR) continue;
      if (z0 < NEAR) z0 = NEAR;
      if (z1 > FAR)  z1 = FAR;
      const a = project(lx - 0.07, 0.02, z0);
      const b = project(lx + 0.07, 0.02, z0);
      const c = project(lx + 0.07, 0.02, z1);
      const d = project(lx - 0.07, 0.02, z1);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y);
      ctx.closePath(); ctx.fill();
    }
  }
  function drawTrack() {
    const a = project(-TRACK_HW, 0, NEAR);
    const b = project( TRACK_HW, 0, NEAR);
    const c = project( TRACK_HW, 0, FAR);
    const d = project(-TRACK_HW, 0, FAR);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y); ctx.lineTo(d.x, d.y);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, horizon, 0, H);
    g.addColorStop(0,    '#2a3149');
    g.addColorStop(0.35, '#20263a');
    g.addColorStop(1,    '#141827');
    ctx.fillStyle = g; ctx.fill();
    ctx.fillStyle = 'rgba(120,150,220,0.30)';
    drawRail(-TRACK_HW);
    drawRail(TRACK_HW);
    drawDashes(-1.1);
    drawDashes(1.1);
  }

  function drawObstacle(o) {
    const rz = o.zAbs - GAME.cameraZ;
    const z1 = rz + o.d * 0.5;
    if (z1 < NEAR || rz - o.d * 0.5 > FAR) return;
    const z0 = Math.max(rz - o.d * 0.5, NEAR);
    if (z1 <= z0) return;
    const x0 = o.x - o.w * 0.5;
    const x1 = o.x + o.w * 0.5;
    drawBox(x0, x1, o.y0, o.y1, z0, z1, o.hue);
    if (o.type === 'high') {
      drawBox(x0, x0 + 0.13, 0, o.y1, z0, z1, o.hue);
      drawBox(x1 - 0.13, x1, 0, o.y1, z0, z1, o.hue);
    }
  }

  function drawCoin(c) {
    const rz = c.zAbs - GAME.cameraZ;
    if (rz < NEAR || rz > FAR) return;
    const p = project(c.x, c.y, rz);
    const r = 0.30 * p.s;
    if (r < 0.6) return;
    const t  = c.spin + performance.now() * 0.006;
    const rx = Math.max(0.12, Math.abs(Math.cos(t))) * r;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, rx, r, 0, 0, Math.PI * 2);
    const g = ctx.createLinearGradient(p.x - r, p.y - r, p.x + r, p.y + r);
    g.addColorStop(0,    '#fff3b0');
    g.addColorStop(0.45, '#ffcc33');
    g.addColorStop(1,    '#f08c00');
    ctx.fillStyle = g; ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.16);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.stroke();
  }

  function drawPowerup(pw) {
    const rz = pw.zAbs - GAME.cameraZ;
    if (rz < NEAR || rz > FAR) return;
    const pt = project(pw.x, pw.y, rz);
    const r = 0.42 * pt.s;
    if (r < 1) return;

    const t = performance.now() * 0.003;
    const bob = Math.sin(t + pw.zAbs) * 0.14 * pt.s;
    const y = pt.y + bob;

    const colors = {
      magnet:  ['#ff4d6d', '#8a0020'],
      jetpack: ['#a06bff', '#3a1a8a'],
      shield:  ['#4dc3ff', '#0a4a8a']
    };
    const c = colors[pw.type] || colors.magnet;

    // glow
    const g = ctx.createRadialGradient(pt.x, y, 0, pt.x, y, r * 2.0);
    g.addColorStop(0, c[0] + 'cc');
    g.addColorStop(1, c[0] + '00');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(pt.x, y, r * 2.0, 0, Math.PI * 2); ctx.fill();

    // disc
    ctx.beginPath(); ctx.arc(pt.x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = c[1]; ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.16);
    ctx.strokeStyle = c[0]; ctx.stroke();

    // icon
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';
    if (pw.type === 'magnet') {
      ctx.lineWidth = r * 0.28;
      ctx.beginPath(); ctx.arc(pt.x, y + r * 0.18, r * 0.45, Math.PI, 0); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pt.x - r * 0.45, y + r * 0.18); ctx.lineTo(pt.x - r * 0.45, y - r * 0.18);
      ctx.moveTo(pt.x + r * 0.45, y + r * 0.18); ctx.lineTo(pt.x + r * 0.45, y - r * 0.18);
      ctx.stroke();
    } else if (pw.type === 'jetpack') {
      ctx.beginPath();
      ctx.moveTo(pt.x, y - r * 0.55);
      ctx.lineTo(pt.x - r * 0.42, y + r * 0.30);
      ctx.lineTo(pt.x + r * 0.42, y + r * 0.30);
      ctx.closePath(); ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(pt.x, y - r * 0.55);
      ctx.lineTo(pt.x + r * 0.5, y - r * 0.22);
      ctx.lineTo(pt.x + r * 0.5, y + r * 0.15);
      ctx.lineTo(pt.x, y + r * 0.58);
      ctx.lineTo(pt.x - r * 0.5, y + r * 0.15);
      ctx.lineTo(pt.x - r * 0.5, y - r * 0.22);
      ctx.closePath(); ctx.fill();
    }
  }

  function drawPlayerBody(cx, fy, s, skin, sliding, swing) {
    const hWorld  = sliding ? 1.00 : 1.70;
    const bodyH   = hWorld * s;
    const bw      = 0.62 * s;

    const legTop   = fy - bodyH * 0.34;
    const torsoTop = fy - bodyH * 0.78;
    const headR    = bodyH * 0.15;

    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    // legs
    ctx.strokeStyle = skin.leg;
    ctx.lineWidth = Math.max(2, bw * 0.30);
    ctx.beginPath();
    ctx.moveTo(cx, legTop); ctx.lineTo(cx - bw * 0.26 + swing, fy);
    ctx.moveTo(cx, legTop); ctx.lineTo(cx + bw * 0.26 - swing, fy);
    ctx.stroke();

    // torso
    const tg = ctx.createLinearGradient(cx - bw, torsoTop, cx + bw, legTop);
    tg.addColorStop(0, skin.body1);
    tg.addColorStop(1, skin.body2);
    ctx.fillStyle = tg;
    rrect(cx - bw * 0.5, torsoTop, bw, (legTop - torsoTop) + bodyH * 0.08, bw * 0.34);
    ctx.fill();

    // arms
    ctx.strokeStyle = skin.arm;
    ctx.lineWidth = Math.max(2, bw * 0.22);
    ctx.beginPath();
    ctx.moveTo(cx - bw * 0.42, torsoTop + bodyH * 0.10);
    ctx.lineTo(cx - bw * 0.55 - swing * 0.8, torsoTop + bodyH * 0.36);
    ctx.moveTo(cx + bw * 0.42, torsoTop + bodyH * 0.10);
    ctx.lineTo(cx + bw * 0.55 + swing * 0.8, torsoTop + bodyH * 0.36);
    ctx.stroke();

    // head
    const hy = torsoTop - headR * 0.80;
    ctx.fillStyle = skin.skin;
    ctx.beginPath(); ctx.arc(cx, hy, headR, 0, Math.PI * 2); ctx.fill();

    // cap
    ctx.fillStyle = skin.cap;
    ctx.beginPath(); ctx.arc(cx, hy, headR * 1.04, Math.PI, Math.PI * 2); ctx.fill();
    ctx.fillStyle = skin.capBrim;
    ctx.fillRect(cx - headR * 0.15, hy - headR * 0.18, headR * 1.55, headR * 0.30);
  }

  function drawPlayer() {
    const sliding = P.slide > 0;
    const s       = FOCAL / PLAYER_Z;
    const feet    = project(P.x, P.y, PLAYER_Z);
    const cx      = feet.x;
    const fy      = feet.y;

    // shadow
    const gp = project(P.x, 0, PLAYER_Z);
    ctx.globalAlpha = 0.32 * Math.max(0.12, 1 - P.y / 3.2);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(gp.x, gp.y, (0.62 * s) * 0.85, (0.62 * s) * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    const swing = (!sliding && P.onGround && P.jetpack <= 0)
      ? Math.sin(P.runPhase) * (1.70 * s) * 0.11
      : (1.70 * s) * 0.17;

    // shield bubble
    if (P.shield > 0) {
      const alpha = 0.35 + Math.sin(performance.now() * 0.008) * 0.12;
      const radius = 0.95 * s;
      ctx.beginPath();
      ctx.arc(cx, fy - 0.85 * s, radius, 0, Math.PI * 2);
      const sg = ctx.createRadialGradient(cx, fy - 0.85 * s, radius * 0.3, cx, fy - 0.85 * s, radius);
      sg.addColorStop(0, 'rgba(77,195,255,0.05)');
      sg.addColorStop(0.75, 'rgba(77,195,255,' + alpha + ')');
      sg.addColorStop(1, 'rgba(77,195,255,0)');
      ctx.fillStyle = sg;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(120,220,255,' + (alpha + 0.15) + ')';
      ctx.stroke();
    }

    // magnet aura
    if (P.magnet > 0) {
      const tt = performance.now() * 0.004;
      for (let i = 0; i < 3; i++) {
        const rr = (0.9 + i * 0.4) * s;
        const alpha = 0.18 * (1 - i / 3);
        ctx.beginPath();
        ctx.ellipse(cx, fy - 0.6 * s, rr * (0.85 + Math.sin(tt + i) * 0.05),
                    rr * (0.35 + Math.cos(tt + i) * 0.03), 0, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,77,109,' + alpha + ')';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    drawPlayerBody(cx, fy, s, getSkin(), sliding, swing);
  }

  function drawScene() {
    const items = [];
    for (let i = 0; i < GAME.obstacles.length; i++) {
      const o  = GAME.obstacles[i];
      const rz = o.zAbs - GAME.cameraZ;
      if (rz + o.d * 0.5 < NEAR || rz - o.d * 0.5 > FAR) continue;
      items.push({ z: rz, k: 0, o });
    }
    for (let i = 0; i < GAME.pickups.length; i++) {
      const c = GAME.pickups[i];
      if (c.got) continue;
      const rz = c.zAbs - GAME.cameraZ;
      if (rz < NEAR || rz > FAR) continue;
      items.push({ z: rz, k: 1, o: c });
    }
    for (let i = 0; i < GAME.powerups.length; i++) {
      const pw = GAME.powerups[i];
      if (pw.got) continue;
      const rz = pw.zAbs - GAME.cameraZ;
      if (rz < NEAR || rz > FAR) continue;
      items.push({ z: rz, k: 3, o: pw });
    }
    items.push({ z: PLAYER_Z, k: 2 });
    items.sort((a, b) => b.z - a.z);

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if      (it.k === 0) drawObstacle(it.o);
      else if (it.k === 1) drawCoin(it.o);
      else if (it.k === 3) drawPowerup(it.o);
      else                 drawPlayer();
    }
  }

  function drawVignette() {
    const g = ctx.createRadialGradient(
      W / 2, H / 2, Math.min(W, H) * 0.35,
      W / 2, H / 2, Math.max(W, H) * 0.78
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function render() {
    ctx.clearRect(0, 0, W, H);
    drawSky();
    drawGround();
    drawTrack();
    drawScene();
    drawParticles();
    drawVignette();
  }

  /* ============================================================
     MAIN LOOP
     ============================================================ */
  let last = performance.now();
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.1) dt = 0.1;
    if (dt < 0) dt = 0;
    update(dt);
    render();
    requestAnimationFrame(frame);
  }

  /* ============================================================
     SKIN UI
     ============================================================ */
  function renderSkinGrid() {
    skinGrid.innerHTML = '';
    for (let i = 0; i < SKINS.length; i++) {
      const sk = SKINS[i];
      const unlocked = unlockedSkins.indexOf(sk.id) >= 0;
      const cell = document.createElement('div');
      cell.className = 'skinCell' + (selectedSkin === sk.id ? ' selected' : '') + (unlocked ? '' : ' locked');
      cell.setAttribute('data-id', sk.id);

      const preview = document.createElement('canvas');
      preview.width = 108; preview.height = 108;
      const pctx = preview.getContext('2d');
      pctx.scale(2, 2);
      const savedCtx = ctx;
      // draw preview on a fake context by temporarily swapping draw primitives
      drawSkinPreview(pctx, sk);
      cell.appendChild(preview);

      const nm = document.createElement('div');
      nm.className = 'skinName';
      nm.textContent = sk.name;
      cell.appendChild(nm);

      if (!unlocked) {
        const lock = document.createElement('div');
        lock.className = 'skinLock';
        lock.innerHTML = '<span class="lockIcon">🔒</span><span>' + sk.cost + 'c</span>';
        cell.appendChild(lock);
      }
      cell.addEventListener('click', () => onSkinClick(sk, unlocked));
      skinGrid.appendChild(cell);
    }
  }

  function drawSkinPreview(pctx, sk) {
    // Simple 2D preview using a local mini-renderer (independent of main ctx)
    const cx = 54, fy = 96, s = 40;
    pctx.lineCap = 'round'; pctx.lineJoin = 'round';

    const bw = 0.62 * s;
    const bodyH = 1.70 * s;
    const legTop = fy - bodyH * 0.34;
    const torsoTop = fy - bodyH * 0.78;
    const headR = bodyH * 0.15;

    pctx.strokeStyle = sk.leg;
    pctx.lineWidth = Math.max(2, bw * 0.30);
    pctx.beginPath();
    pctx.moveTo(cx, legTop); pctx.lineTo(cx - bw * 0.26, fy);
    pctx.moveTo(cx, legTop); pctx.lineTo(cx + bw * 0.26, fy);
    pctx.stroke();

    const tg = pctx.createLinearGradient(cx - bw, torsoTop, cx + bw, legTop);
    tg.addColorStop(0, sk.body1);
    tg.addColorStop(1, sk.body2);
    pctx.fillStyle = tg;
    // rounded rect
    const rr = bw * 0.34;
    const rx = cx - bw * 0.5, ry = torsoTop, rw = bw, rh = (legTop - torsoTop) + bodyH * 0.08;
    pctx.beginPath();
    pctx.moveTo(rx + rr, ry);
    pctx.arcTo(rx + rw, ry, rx + rw, ry + rh, rr);
    pctx.arcTo(rx + rw, ry + rh, rx, ry + rh, rr);
    pctx.arcTo(rx, ry + rh, rx, ry, rr);
    pctx.arcTo(rx, ry, rx + rw, ry, rr);
    pctx.closePath();
    pctx.fill();

    pctx.strokeStyle = sk.arm;
    pctx.lineWidth = Math.max(2, bw * 0.22);
    pctx.beginPath();
    pctx.moveTo(cx - bw * 0.42, torsoTop + bodyH * 0.10);
    pctx.lineTo(cx - bw * 0.55, torsoTop + bodyH * 0.36);
    pctx.moveTo(cx + bw * 0.42, torsoTop + bodyH * 0.10);
    pctx.lineTo(cx + bw * 0.55, torsoTop + bodyH * 0.36);
    pctx.stroke();

    const hy = torsoTop - headR * 0.80;
    pctx.fillStyle = sk.skin;
    pctx.beginPath(); pctx.arc(cx, hy, headR, 0, Math.PI * 2); pctx.fill();

    pctx.fillStyle = sk.cap;
    pctx.beginPath(); pctx.arc(cx, hy, headR * 1.04, Math.PI, Math.PI * 2); pctx.fill();
    pctx.fillStyle = sk.capBrim;
    pctx.fillRect(cx - headR * 0.15, hy - headR * 0.18, headR * 1.55, headR * 0.30);
  }

  function onSkinClick(sk, unlocked) {
    initAudio();
    if (!unlocked) {
      if (totalCoins >= sk.cost) {
        totalCoins -= sk.cost;
        unlockedSkins.push(sk.id);
        selectedSkin = sk.id;
        saveStorage();
        SFX.power();
        renderSkinGrid();
      } else {
        SFX.crash();
        if (navigator.vibrate) try { navigator.vibrate([30, 40, 30]); } catch (e) {}
      }
      return;
    }
    selectedSkin = sk.id;
    saveStorage();
    SFX.click();
    renderSkinGrid();
  }

  /* ============================================================
     BUTTON BINDINGS
     ============================================================ */
  startBtn.addEventListener('click', startGame);
  retryBtn.addEventListener('click', startGame);
  homeBtn.addEventListener('click', function () {
    initAudio(); SFX.click(); gotoMenu();
  });
  skinsBtn.addEventListener('click', function () {
    initAudio(); SFX.click();
    renderSkinGrid();
    showPanel('skins');
  });
  skinsBack.addEventListener('click', function () {
    initAudio(); SFX.click();
    menuBest.textContent = bestScore;
    menuCoins.textContent = totalCoins;
    showPanel('menu');
  });
  muteBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    muted = !muted;
    updateMuteBtn();
    saveStorage();
    if (!muted) { initAudio(); SFX.click(); }
  });

  /* ============================================================
     BOOT
     ============================================================ */
  loadStorage();
  resize();
  reset();
  GAME.state = 'menu';
  menuBest.textContent = bestScore;
  menuCoins.textContent = totalCoins;

  // If a record already exists, show it in HUD
  uiBest.textContent = bestScore;

  requestAnimationFrame(frame);

  // Wake lock (keeps the screen awake during play on supported browsers)
  let wakeLock = null;
  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    } catch (e) {}
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && GAME.state === 'playing') requestWakeLock();
  });
  const origStart = startGame;
  startGame = function () { origStart(); requestWakeLock(); };

  // Init audio on any first interaction (iOS requirement)
  ['touchstart','mousedown','keydown'].forEach(ev =>
    window.addEventListener(ev, initAudio, { once: true, passive: true })
  );

  // Expose for debugging
  window.SubwayDash = {
    start: startGame,
    state: () => GAME.state,
    score: () => GAME.score,
    resetStorage: () => { localStorage.clear(); location.reload(); }
  };
})();