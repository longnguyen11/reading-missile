
(() => {
  // ===========================
  // FIXED VIRTUAL WIDTH + consistent experience:
  // - Game world is fixed: VW x VH (e.g. 360 x 640).
  // - Canvas scales uniformly to fit screen; gameplay is identical on all devices.
  // - Input is mapped from screen -> world.
  // ===========================

  const VW = 360;
  const VH = 640;

  // ---------- Cookies ----------
  function setCookie(name, value, days = 365) {
    const d = new Date();
    d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
    document.cookie = `${name}=${encodeURIComponent(value)};expires=${d.toUTCString()};path=/;SameSite=Lax`;
  }
  function getCookie(name) {
    const n = name + "=";
    for (const part of document.cookie.split(";").map(s => s.trim())) {
      if (part.startsWith(n)) return decodeURIComponent(part.slice(n.length));
    }
    return null;
  }
  const COOKIE_WORDS = "rmd_words_v7";
  const COOKIE_OPTS  = "rmd_opts_v7";

  // ---------- DOM ----------
  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d");

  const panelOverlay = document.getElementById("panelOverlay");
  const cogBtn = document.getElementById("cogBtn");
  const closePanelBtn = document.getElementById("closePanel");

  const btnMic = document.getElementById("btnMic");
  const btnPause = document.getElementById("btnPause");
  const btnReset = document.getElementById("btnReset");
  const saveSettings = document.getElementById("saveSettings");

  const wordsBox = document.getElementById("wordsBox");
  const matchSel = document.getElementById("matchSel");
  const spawnSel = document.getElementById("spawnSel");
  const speedSel = document.getElementById("speedSel");
  const cooldownSel = document.getElementById("cooldownSel");

  const $micPill = document.getElementById("micPill");
  const $score = document.getElementById("score");
  const $hits = document.getElementById("hits");
  const $misses = document.getElementById("misses");
  const $streak = document.getElementById("streak");
  const $level = document.getElementById("level");
  const $lives = document.getElementById("lives");
  const $heard = document.getElementById("heard");
  const $liveHeard = document.getElementById("liveHeard");
  const $liveLives = document.getElementById("liveLives");
  const $matchText = document.getElementById("matchText");
  const $matchBadge = document.getElementById("matchBadge");

  const speechSupport = document.getElementById("speechSupport");
  const cookieStatus = document.getElementById("cookieStatus");

  // ---------- View transform (screen <-> world) ----------
  const view = {
    dpr: Math.max(1, Math.min(3, window.devicePixelRatio || 1)),
    scale: 1,
    offX: 0,
    offY: 0,
    cssW: 0,
    cssH: 0,
  };

  function resize() {
    view.cssW = Math.floor(window.innerWidth);
    view.cssH = Math.floor(window.innerHeight);

    canvas.width = Math.floor(view.cssW * view.dpr);
    canvas.height = Math.floor(view.cssH * view.dpr);
    canvas.style.width = view.cssW + "px";
    canvas.style.height = view.cssH + "px";

    // uniform scale to fit (letterbox)
    view.scale = Math.min(view.cssW / VW, view.cssH / VH);
    view.offX = (view.cssW - VW * view.scale) / 2;
    view.offY = (view.cssH - VH * view.scale) / 2;
  }
  window.addEventListener("resize", resize);
  resize();

  function screenToWorld(clientX, clientY) {
    // map into world coords, accounting for letterboxing
    const x = (clientX - view.offX) / view.scale;
    const y = (clientY - view.offY) / view.scale;
    return { x, y };
  }

  // ---------- State ----------
  const state = {
    w: VW,
    h: VH,

    paused: true,
    micConnected: false,

    score: 0,
    hits: 0,
    misses: 0,
    streak: 0,
    lives: 5,

    missiles: [],
    bullets: [],
    particles: [],
    explosions: [],
    gifts: [],

    lastTime: performance.now(),
    spawnTimer: 0,
    targetId: null,

    lastLockAt: 0,
    lockCooldownMs: 10,

    words: ["read","seed","sad","seat", "mad","rat","at","sat", "ram","am","see","eat"],
    matchMode: "fuzzy",
    spawnMode: "low",
    speedMode: "chill",

    minWordFontPx: 10,
    fallMultiplier: 0.5,
    difficultyStepPct: 0.15,

    freezeUntil: 0,
    slowUntil: 0,
    tripleUntil: 0,

    cannonAngle: -Math.PI/2,
    cannonAngleTarget: -Math.PI/2,
  };

  // ---------- UI helpers ----------
  function setBadge(kind, text) {
    $matchBadge.className = "badge " + kind;
    $matchBadge.textContent = text;
    $matchText.textContent = text;
  }
  function updateHUD() {
    $score.textContent = String(state.score);
    $hits.textContent = String(state.hits);
    $misses.textContent = String(state.misses);
    $streak.textContent = String(state.streak);
    $lives.textContent = String(state.lives);
    if ($liveLives) $liveLives.textContent = String(state.lives);
    const steps = Math.floor(state.hits / 10);
    $level.textContent = String(1 + steps);
  }
  function setMicUI(listening) {
    $micPill.textContent = "Mic: " + (listening ? "on" : "off");
    $micPill.style.color = listening ? "rgba(74,222,128,0.95)" : "rgba(255,255,255,0.70)";
    btnMic.textContent = listening ? "Disconnect" : "Connect Mic";
  }

  function setHeardText(transcript) {
    const heard = normalizeEnglish(transcript) || "...";
    $heard.textContent = heard;
    $liveHeard.textContent = heard;
  }

  // ---------- Panel + pause behavior ----------
  function syncPanelFields() {
    wordsBox.value = state.words.join("\n");
    matchSel.value = state.matchMode;
    spawnSel.value = state.spawnMode;
    speedSel.value = state.speedMode;
    cooldownSel.value = String(state.lockCooldownMs);
    cookieStatus.textContent = getCookie(COOKIE_WORDS) ? "Cookie: loaded" : "Cookie: ready";
    cookieStatus.className = "badge";
  }
  function pauseGame(reason) {
    state.paused = true;
    if (panelOverlay.style.display !== "flex") syncPanelFields();
    panelOverlay.style.display = "flex";
    btnPause.textContent = "Resume";
    setBadge("warn", reason || "Paused");
  }

  function resumeGame() {
    if (!state.micConnected) {
      state.paused = true;
      panelOverlay.style.display = "flex";
      btnPause.textContent = "Resume";
      setBadge("bad", "Connect mic to start");
      return;
    }
    state.paused = false;
    panelOverlay.style.display = "none";
    btnPause.textContent = "Pause";
    setBadge("warn", "Listening... say a word");
  }
  cogBtn.addEventListener("click", () => pauseGame());
  closePanelBtn.addEventListener("click", () => resumeGame());
  panelOverlay.addEventListener("click", (e) => {
    if (e.target === panelOverlay) resumeGame(); // click outside resumes/ closes
  });

  // ---------- Save settings (cookie) ----------
  function parseWords(text) {
    const raw = (text || "").split(/[\n,]+/g).map(s => s.trim()).filter(Boolean);
    const uniq = [];
    const seen = new Set();
    for (const w of raw) {
      const key = w.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      uniq.push(w.slice(0, 24));
    }
    return uniq.length ? uniq : ["cat","dog","apple"];
  }

  function loadFromCookie() {
    const w = getCookie(COOKIE_WORDS);
    if (w) state.words = parseWords(w);

    const o = getCookie(COOKIE_OPTS);
    if (o) {
      try {
        const obj = JSON.parse(o);
        if (obj.matchMode) state.matchMode = obj.matchMode;
        if (obj.spawnMode) state.spawnMode = obj.spawnMode;
        if (obj.speedMode) state.speedMode = obj.speedMode;
        if (obj.lockCooldownMs) state.lockCooldownMs = obj.lockCooldownMs;
      } catch (_) {}
    }
  }

  function saveToCookie() {
    setCookie(COOKIE_WORDS, state.words.join("\n"));
    setCookie(COOKIE_OPTS, JSON.stringify({
      matchMode: state.matchMode,
      spawnMode: state.spawnMode,
      speedMode: state.speedMode,
      lockCooldownMs: state.lockCooldownMs
    }));
  }

  saveSettings.addEventListener("click", () => {
    state.words = parseWords(wordsBox.value);
    state.matchMode = matchSel.value;
    state.spawnMode = spawnSel.value;
    state.speedMode = speedSel.value;
    state.lockCooldownMs = parseInt(cooldownSel.value, 10) || 10;
    saveToCookie();
    cookieStatus.textContent = "Cookie: saved";
    cookieStatus.className = "badge good";
    // collapse immediately after saving (keeps menu from lingering)
    resumeGame();
  });

  // Load settings immediately (ensures words cookie is respected)
  loadFromCookie();

  // ---------- Math/helpers ----------
  function rand(min, max) { return min + Math.random() * (max - min); }
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }
  function angleLerp(a, b, t) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }
  function difficultyFactor() {
    const steps = Math.floor(state.hits / 10);
    return 1 + steps * state.difficultyStepPct;
  }
  function isFrozen(nowMs) { return nowMs < state.freezeUntil; }
  function slowFactor(nowMs) { return nowMs < state.slowUntil ? 0.7 : 1.0; }
  function spawnIntervalFactor(nowMs) { return nowMs < state.slowUntil ? (1/0.7) : 1.0; }
  function tripleActive(nowMs) { return nowMs < state.tripleUntil; }

  // ---------- Matching ----------
  function normalizeEnglish(s) {
    return (s || "").toLowerCase().trim().replace(/[^a-z0-9'\s-]+/g, "").replace(/\s+/g, " ");
  }
  const FILLER_TOKENS = new Set(["the","a","an","um","uh","like","i","it","is","its","this","that","my","your","you","me"]);

  function recentWordCandidates(transcript, maxWords = 2) {
    const s = normalizeEnglish(transcript);
    if (!s) return [];

    const tokens = s.split(" ").filter(Boolean).filter(t => !FILLER_TOKENS.has(t));
    const out = [];
    const seen = new Set();

    for (let i = tokens.length - 1; i >= 0 && out.length < maxWords; i--) {
      const t = tokens[i];
      if (seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }

    return out;
  }

  function phoneticish(w) {
    w = normalizeEnglish(w).replace(/'/g, "");
    w = w
      .replace(/ph/g, "f").replace(/ght/g, "t").replace(/kn/g, "n").replace(/wr/g, "r").replace(/wh/g, "w")
      .replace(/qu/g, "kw").replace(/ck/g, "k").replace(/dg/g, "j").replace(/tch/g, "ch")
      .replace(/ch/g, "c").replace(/sh/g, "c").replace(/th/g, "d").replace(/x/g, "ks").replace(/z/g, "s");
    w = w.replace(/c(?=[eiy])/g, "s").replace(/c/g, "k");
    w = w.replace(/(.)\1+/g, "$1");
    if (w.length > 3) w = w[0] + w.slice(1).replace(/[aeiouy]/g, "");
    return w;
  }
  function levenshtein(a, b) {
    a = a || ""; b = b || "";
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    const v0 = new Array(n + 1), v1 = new Array(n + 1);
    for (let j = 0; j <= n; j++) v0[j] = j;
    for (let i = 0; i < m; i++) {
      v1[0] = i + 1;
      const ai = a.charCodeAt(i);
      for (let j = 0; j < n; j++) {
        const cost = ai === b.charCodeAt(j) ? 0 : 1;
        v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
      }
      for (let j = 0; j <= n; j++) v0[j] = v1[j];
    }
    return v0[n];
  }
  function transcriptCandidates(transcript) {
    const s = normalizeEnglish(transcript);
    if (!s) return [];
    const tokens = s.split(" ").filter(Boolean);
    const cands = new Set();
    for (const t of tokens) if (!FILLER_TOKENS.has(t)) cands.add(t);
    for (let i = 0; i < tokens.length - 1; i++) {
      const a = tokens[i], b = tokens[i + 1];
      if (!FILLER_TOKENS.has(a) && !FILLER_TOKENS.has(b)) cands.add(a + b);
    }
    cands.add(s);
    return Array.from(cands);
  }

  function isMatchEnglish(transcript, targetWord, mode) {
    const word = normalizeEnglish(targetWord);
    const cands = transcriptCandidates(transcript);
    if (!word || cands.length === 0) return false;
    if (cands.includes(word)) return true;

    const wPh = phoneticish(word);
    for (const t of cands) {
      const tn = normalizeEnglish(t);
      if (!tn) continue;

      const dRaw = levenshtein(tn, word);
      const allowRawStrict = word.length <= 3 ? 0 : word.length <= 5 ? 1 : word.length <= 8 ? 2 : 3;
      const allowRawFuzzy  = word.length <= 3 ? 1 : word.length <= 5 ? 2 : word.length <= 8 ? 3 : 4;
      const allowRaw = (mode === "strict") ? allowRawStrict : allowRawFuzzy;
      if (dRaw <= allowRaw) return true;

      if (mode === "fuzzy") {
        const dPh = levenshtein(phoneticish(tn), wPh);
        const allowPh = word.length <= 3 ? 1 : word.length <= 6 ? 2 : 3;
        if (dPh <= allowPh) return true;
      }
    }
    return false;
  }

  function isLikelyPartialMatchEnglish(transcript, targetWord, mode) {
    const word = normalizeEnglish(targetWord);
    const cands = transcriptCandidates(transcript);
    if (!word || cands.length === 0 || word.length < 4) return false;

    const minPrefix = Math.max(3, word.length - 1);
    const wordPh = phoneticish(word);

    for (const t of cands) {
      const tn = normalizeEnglish(t);
      if (!tn) continue;
      if (tn.length < minPrefix || tn.length >= word.length) continue;

      if (word.startsWith(tn)) return true;

      if (mode === "fuzzy") {
        const tp = phoneticish(tn);
        if (!tp) continue;
        if (tp.length >= Math.max(2, wordPh.length - 1) && tp.length < wordPh.length && wordPh.startsWith(tp)) {
          return true;
        }
      }
    }
    return false;
  }

  // ---------- Entities ----------
  let nextId = 1;

  function baseFallSpeed() {
    return state.speedMode === "chill" ? 55 : state.speedMode === "fast" ? 105 : 80;
  }
  function baseSpawnInterval() {
    const base = state.spawnMode === "low" ? 1.35 : state.spawnMode === "high" ? 0.65 : 0.95;
    return Math.max(0.30, base);
  }

  function spawnMissile(nowMs) {
    const word = state.words[Math.floor(Math.random() * state.words.length)] || "word";
    const size = clamp(26 + word.length * 3, 28, 64);
    const x = rand(40, state.w - 40);
    const y = -60;

    const diff = difficultyFactor();
    const slow = slowFactor(nowMs);
    const vy = (baseFallSpeed() * state.fallMultiplier * diff * slow) + rand(-4, 10);
    const vx = rand(-14, 14);

    state.missiles.push({ id: nextId++, word, x, y, vx, vy, r:size, wobble: rand(0, Math.PI*2), claimed:false, remove:false });
  }

  function spawnExplosion(x, y, baseRadius = 7) {
    state.explosions.push({ x, y, t:0, dur:1.5, r0: baseRadius, remove:false });
  }

  function spawnImpactParticles(x, y) {
    for (let i = 0; i < 46; i++) {
      state.particles.push({ x, y, vx: rand(-260,260), vy: rand(-320,140), life: rand(0.55,1.1), size: rand(2,6), remove:false });
    }
  }

  function spawnGift(nowMs) {
    const x = rand(40, state.w - 40);
    const y = -40;
    const gifts = [
      { type:"triple", colorA:"rgba(251,191,36,0.95)", colorB:"rgba(255,255,255,0.92)" },
    ];
    const pick = gifts[Math.floor(Math.random() * gifts.length)];

    const diff = difficultyFactor();
    const slow = slowFactor(nowMs);
    const vy = (65 * state.fallMultiplier * diff * slow) + rand(0, 12);

    state.gifts.push({ id: nextId++, type:pick.type, colorA:pick.colorA, colorB:pick.colorB, x, y, vx: rand(-8,8), vy, r:22, remove:false });
  }

  function activateGift(g, nowMs) {
    if (!g || g.remove) return;
    g.remove = true;
    if (g.type === "triple") {
      state.tripleUntil = Math.max(state.tripleUntil, nowMs + 30000);
      setBadge("good", "Triple shot! 30s");
    }
  }

  // Intercept solver
  function interceptTime(sx, sy, tx, ty, tvx, tvy, s) {
    const rx = tx - sx, ry = ty - sy, vx = tvx, vy = tvy;
    const a = (vx*vx + vy*vy) - (s*s);
    const b = 2 * (rx*vx + ry*vy);
    const c = (rx*rx + ry*ry);

    if (Math.abs(a) < 1e-6) {
      if (Math.abs(b) < 1e-6) return null;
      const t = -c / b;
      return t > 0 ? t : null;
    }
    const disc = b*b - 4*a*c;
    if (disc < 0) return null;
    const sqrt = Math.sqrt(disc);
    const t1 = (-b - sqrt) / (2*a);
    const t2 = (-b + sqrt) / (2*a);
    let t = null;
    if (t1 > 0 && t2 > 0) t = Math.min(t1, t2);
    else if (t1 > 0) t = t1;
    else if (t2 > 0) t = t2;
    if (t != null && t > 3.0) t = 3.0;
    return t;
  }

  function makeBullet(startX, startY, target, speed) {
    const t = interceptTime(startX, startY, target.x, target.y, target.vx, target.vy, speed);
    let aimX = target.x, aimY = target.y;
    if (t != null) { aimX = target.x + target.vx * t; aimY = target.y + target.vy * t; }
    const dx = aimX - startX, dy = aimY - startY;
    const dist = Math.max(1, Math.hypot(dx, dy));
    const vx = (dx / dist) * speed;
    const vy = (dy / dist) * speed;
    return { x:startX, y:startY, vx, vy, t:0, targetId: target.id, remove:false };
  }

  function shootPrimaryAndMaybeExtras(primaryTarget, nowMs) {
    const startX = state.w * 0.5;
    const startY = state.h - 46;
    const speed = 620;

    const b0 = makeBullet(startX, startY, primaryTarget, speed);
    state.cannonAngleTarget = Math.atan2(b0.vy, b0.vx);
    state.bullets.push(b0);

    if (!tripleActive(nowMs)) return;
    const others = state.missiles
      .filter(m => !m.remove && m.id !== primaryTarget.id)
      .sort((a,b) => Math.hypot(a.x-startX,a.y-startY) - Math.hypot(b.x-startX,b.y-startY));

    if (others[0]) state.bullets.push(makeBullet(startX, startY, others[0], speed));
    if (others[1]) state.bullets.push(makeBullet(startX, startY, others[1], speed));
  }

  // ---------- Input (fixed world) ----------
  function pickMissileAt(wx, wy) {
    let best = null, bestD = Infinity;
    for (const m of state.missiles) {
      if (m.remove) continue;
      const d = Math.hypot(m.x - wx, m.y - wy);
      if (d < m.r && d < bestD) { best = m; bestD = d; }
    }
    return best;
  }
  function pickGiftAt(wx, wy) {
    let best = null, bestD = Infinity;
    for (const g of state.gifts) {
      if (g.remove) continue;
      const d = Math.hypot(g.x - wx, g.y - wy);
      if (d < g.r && d < bestD) { best = g; bestD = d; }
    }
    return best;
  }

  canvas.addEventListener("pointerdown", (e) => {
    const pt = screenToWorld(e.clientX, e.clientY);

    // ignore clicks outside world (letterbox area)
    if (pt.x < 0 || pt.x > state.w || pt.y < 0 || pt.y > state.h) return;

    const g = pickGiftAt(pt.x, pt.y);
    if (g) { activateGift(g, performance.now()); return; }

    const m = pickMissileAt(pt.x, pt.y);
    if (m) {
      state.targetId = m.id;
      setBadge("warn", `Target set: ${m.word}`);
    }
  }, { passive:true });

  // ---------- Render ----------
  function drawGift(g, tNow) {
    const bob = Math.sin((tNow + g.id * 77) * 0.004) * 2;
    const w = 34, h = 28;
    const x = g.x, y = g.y + bob;

    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.beginPath();
    ctx.ellipse(x, y + 18, 16, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.fillStyle = g.colorA;
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 2;
    roundRect(ctx, x - w/2, y - h/2, w, h, 8);
    ctx.fill(); ctx.stroke();

    ctx.fillStyle = g.colorB;
    roundRect(ctx, x - 4, y - h/2, 8, h, 4); ctx.fill();
    roundRect(ctx, x - w/2, y - 4, w, 8, 4); ctx.fill();

    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    ctx.ellipse(x - 7, y - h/2 - 2, 7, 5, -0.4, 0, Math.PI * 2);
    ctx.ellipse(x + 7, y - h/2 - 2, 7, 5, 0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  function render(nowMs) {
    // Clear full screen in device pixels, then set world transform
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Letterbox background fade on sides (optional, subtle)
    // (no gameplay effect)
    ctx.fillStyle = "rgba(0,0,0,0.0)";
    ctx.fillRect(0,0,canvas.width,canvas.height);

    // World transform
    ctx.setTransform(view.dpr * view.scale, 0, 0, view.dpr * view.scale, view.dpr * view.offX, view.dpr * view.offY);

    // stars (world)
    ctx.save();
    ctx.globalAlpha = 0.35;
    for (let i = 0; i < 55; i++) {
      const x = (i * 997) % state.w;
      const y = ((i * 571) % state.h) * 0.45;
      ctx.fillRect(x, y, 1.5, 1.5);
    }
    ctx.restore();

    // cannon
    const baseX = state.w * 0.5;
    const baseY = state.h - 38;

    ctx.save();
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 2;
    roundRect(ctx, baseX - 54, baseY - 14, 108, 30, 14);
    ctx.fill(); ctx.stroke();

    // turret
    ctx.fillStyle = "rgba(96,165,250,0.30)";
    ctx.strokeStyle = "rgba(96,165,250,0.55)";
    ctx.lineWidth = 2;
    roundRect(ctx, baseX - 26, baseY - 48, 52, 36, 16);
    ctx.fill(); ctx.stroke();

    const pivotX = baseX + 6;
    const pivotY = baseY - 34;

    ctx.translate(pivotX, pivotY);
    ctx.rotate(state.cannonAngle);

    ctx.fillStyle = "rgba(96,165,250,0.42)";
    ctx.strokeStyle = "rgba(96,165,250,0.60)";
    ctx.lineWidth = 2;
    roundRect(ctx, 0, -7, 40, 14, 8);
    ctx.fill(); ctx.stroke();

    ctx.fillStyle = "rgba(96,165,250,0.95)";
    ctx.beginPath();
    ctx.arc(40, 0, 4.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // missiles
    for (const m of state.missiles) {
      if (m.remove) continue;
      const isClaimed = m.claimed;

      const bodyW = clamp(64 + m.word.length * 7, 92, 220);
      const bodyH = 48;

      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(m.x, m.y - 28);
      ctx.lineTo(m.x - m.vx * 0.14, m.y - 60);
      ctx.stroke();

      ctx.fillStyle = isClaimed ? "rgba(74,222,128,0.16)" : "rgba(255,255,255,0.10)";
      ctx.strokeStyle = isClaimed ? "rgba(74,222,128,0.45)" : "rgba(255,255,255,0.16)";
      ctx.lineWidth = 2;
      roundRect(ctx, m.x - bodyW/2, m.y - bodyH/2, bodyW, bodyH, 14);
      ctx.fill(); ctx.stroke();

      const maxFont = 24;
      const computed = maxFont - (m.word.length * 0.75);
      const fontPx = clamp(computed, state.minWordFontPx, maxFont);
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = `700 ${fontPx}px system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(m.word, m.x, m.y);
      ctx.restore();
    }

    // gifts
    for (const g of state.gifts) if (!g.remove) { ctx.save(); drawGift(g, nowMs); ctx.restore(); }

    // bullets
    for (const b of state.bullets) {
      if (b.remove) continue;
      ctx.save();
      ctx.fillStyle = "rgba(251,191,36,0.95)";
      ctx.beginPath();
      ctx.arc(b.x, b.y, 7.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = "rgba(251,191,36,0.95)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - b.vx * 0.03, b.y - b.vy * 0.03);
      ctx.stroke();
      ctx.restore();
    }

    // explosions
    for (const ex of state.explosions) {
      const p = clamp(ex.t / ex.dur, 0, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      const r = ex.r0 * (1 + 9 * ease);
      const a = 1 - p;

      ctx.save();
      ctx.globalAlpha = a * 0.7;
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(ex.x, ex.y, r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.globalAlpha = a * 0.45;
      ctx.strokeStyle = "rgba(251,191,36,0.95)";
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(ex.x, ex.y, r * 0.7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // particles
    for (const p of state.particles) {
      if (p.remove) continue;
      const a = clamp(p.life / 1.1, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = (p.size > 4) ? "rgba(251,191,36,0.95)" : "rgba(251,113,133,0.95)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // paused/frozen overlay in WORLD coordinates
    const frozen = isFrozen(nowMs);
    if (state.paused || frozen) {
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.50)";
      ctx.fillRect(0, 0, state.w, state.h);

      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = "700 22px system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const msg = frozen ? "Frozen!" : (state.micConnected ? "Paused" : "Connect mic to start");
      ctx.fillText(msg, state.w/2, state.h/2 - 8);

      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.font = "14px system-ui";
      const sub = frozen ? "Hang tight..." : (state.micConnected ? "Use the Settings button anytime" : "Open Settings to connect mic");
      ctx.fillText(sub, state.w/2, state.h/2 + 18);
      ctx.restore();
    }
  }

  // ---------- Loop ----------
  function step(nowMs) {
    const dt = Math.min(0.033, (nowMs - state.lastTime) / 1000);
    state.lastTime = nowMs;

    // smooth rotate cannon
    state.cannonAngle = angleLerp(state.cannonAngle, state.cannonAngleTarget, 1 - Math.pow(0.001, dt));

    const frozen = isFrozen(nowMs);

    if (!state.paused && !frozen) {
      // spawn ramp
      const steps = Math.floor(state.hits / 10);
      const baseInt = baseSpawnInterval();
      const add = steps * state.difficultyStepPct;
      const diffInterval = Math.max(0.20, baseInt * (1 - add));
      const interval = diffInterval * spawnIntervalFactor(nowMs);

      state.spawnTimer += dt;
      while (state.spawnTimer >= interval) {
        state.spawnTimer -= interval;
        spawnMissile(nowMs);
      }

      // update missiles
      const diff = difficultyFactor();
      const slow = slowFactor(nowMs);
      const desiredVyBase = baseFallSpeed() * state.fallMultiplier * diff * slow;

      for (const m of state.missiles) {
        if (m.remove) continue;
        m.vy = m.vy * 0.92 + desiredVyBase * 0.08;

        m.wobble += dt * 2.2;
        m.x += m.vx * dt + Math.sin(m.wobble) * 6 * dt;
        m.y += m.vy * dt;

        if (m.x < 28) { m.x = 28; m.vx = Math.abs(m.vx); }
        if (m.x > state.w - 28) { m.x = state.w - 28; m.vx = -Math.abs(m.vx); }

        if (m.y > state.h - 60) {
          if (!m.claimed) {
            m.remove = true;
            state.misses += 1;
            state.lives = Math.max(0, state.lives - 1);
            state.streak = 0;
            state.score = Math.max(0, state.score - 3);
            setBadge("bad", `Missed ${m.word} - ${state.lives} lives left`);
            spawnExplosion(m.x, state.h - 64, 8);
            spawnImpactParticles(m.x, state.h - 64);
            updateHUD();
            if (state.lives === 0) {
              pauseGame("Game over - no lives left");
            }
          } else {
            m.remove = true;
            spawnExplosion(m.x, state.h - 64, 8);
            spawnImpactParticles(m.x, state.h - 64);
          }
        }
      }

      // gifts
      for (const g of state.gifts) {
        if (g.remove) continue;
        const gSlow = slowFactor(nowMs);
        g.vy = g.vy * 0.92 + (65 * state.fallMultiplier * diff * gSlow) * 0.08;

        g.x += g.vx * dt;
        g.y += g.vy * dt;

        if (g.x < 30) { g.x = 30; g.vx = Math.abs(g.vx); }
        if (g.x > state.w - 30) { g.x = state.w - 30; g.vx = -Math.abs(g.vx); }
        if (g.y > state.h - 60) activateGift(g, nowMs);
      }

      // bullets
      for (const b of state.bullets) {
        if (b.remove) continue;
        b.t += dt;
        b.x += b.vx * dt;
        b.y += b.vy * dt;

        const tgt = state.missiles.find(m => m.id === b.targetId && !m.remove);
        if (tgt) {
          const d = Math.hypot(tgt.x - b.x, tgt.y - b.y);
          if (d < 20) {
            b.remove = true;
            spawnExplosion(tgt.x, tgt.y, 7);
            spawnImpactParticles(tgt.x, tgt.y);
            tgt.remove = true;
            setBadge("good", `Hit ${tgt.word}`);
          }
        }
        if (b.t > 2.2) b.remove = true;
      }

      // explosions
      for (const ex of state.explosions) {
        if (ex.remove) continue;
        ex.t += dt;
        const p = clamp(ex.t / ex.dur, 0, 1);
        const ease = 1 - Math.pow(1 - p, 3);
        const r = ex.r0 * (1 + 9 * ease);

        for (const m of state.missiles) {
          if (m.remove) continue;
          if (Math.hypot(m.x - ex.x, m.y - ex.y) <= r) {
            m.remove = true;
            spawnImpactParticles(m.x, m.y);
          }
        }
        for (const g of state.gifts) {
          if (g.remove) continue;
          if (Math.hypot(g.x - ex.x, g.y - ex.y) <= r) {
            activateGift(g, nowMs);
          }
        }

        if (ex.t >= ex.dur) ex.remove = true;
      }

      // particles
      for (const p of state.particles) {
        if (p.remove) continue;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 520 * dt;
        p.life -= dt;
        if (p.life <= 0) p.remove = true;
      }

      // cleanup
      state.bullets = state.bullets.filter(b => !b.remove);
      state.explosions = state.explosions.filter(ex => !ex.remove);
      state.particles = state.particles.filter(p => !p.remove);
      state.gifts = state.gifts.filter(g => !g.remove && g.y < state.h + 120);
      state.missiles = state.missiles.filter(m => !m.remove && m.y < state.h + 160);
    }

    render(nowMs);
    requestAnimationFrame(step);
  }

            // ---------- Mic / Speech ----------
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const cap = window.Capacitor || null;
  const capPlatform = cap && typeof cap.getPlatform === "function" ? cap.getPlatform() : null;
  const nativeVosk = capPlatform === "android" && cap && cap.Plugins && cap.Plugins.VoskSpeech
    ? cap.Plugins.VoskSpeech
    : null;
  const nativeDefaultSpeech = capPlatform === "android" && cap
    ? ((cap.Plugins && cap.Plugins.SpeechRecognition) || (typeof cap.registerPlugin === "function" ? cap.registerPlugin("SpeechRecognition") : null))
    : null;
  const nativeSpeech = nativeVosk || nativeDefaultSpeech;
  const usingVosk = !!nativeVosk;
  const speechOk = !!(nativeSpeech || SpeechRecognition);

  let rec = null;
  let listening = false;
  let keepListening = false;
  let reconnectTimer = null;
  let reconnectFailures = 0;
  let manualStop = false;
  let nativePartialListenerReady = false;
  let nativeStateListenerReady = false;
  let nativeStartPending = false;

  const MAX_RECONNECT_FAILURES = 60;
  const TRANSIENT_SPEECH_ERRORS = new Set(["aborted", "network", "no-speech"]);

  if (!speechOk) {
    speechSupport.textContent = "Not supported";
    speechSupport.style.color = "rgba(251,113,133,0.95)";
    setBadge("bad", "Speech recognition not available");
  } else if (nativeSpeech) {
    speechSupport.textContent = usingVosk ? "Supported (Android Vosk)" : "Supported (Android native)";
    speechSupport.style.color = "rgba(74,222,128,0.95)";
    setBadge("warn", "Connect mic to start");
  } else {
    speechSupport.textContent = "Supported (browser)";
    speechSupport.style.color = "rgba(251,191,36,0.95)";
    setBadge("warn", "Connect mic to start");
  }

  function clearReconnectTimer() {
    if (!reconnectTimer) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function cleanupBrowserRecognizer() {
    rec = null;
    listening = false;
    setMicUI(false);
  }

  function applyMicDisconnectedUI(reason) {
    state.micConnected = false;
    listening = false;
    setMicUI(false);
    pauseGame(reason || "Mic disconnected");
  }

  function scheduleReconnect(isFailure = false) {
    if (!keepListening) return;

    if (isFailure) {
      reconnectFailures += 1;
      if (reconnectFailures >= MAX_RECONNECT_FAILURES) {
        pauseForMic("Mic disconnected");
        return;
      }
    } else {
      reconnectFailures = 0;
    }

    clearReconnectTimer();
    const delayMs = isFailure
      ? Math.min(2200, 180 * Math.pow(1.5, reconnectFailures - 1))
      : 30;
    if (isFailure) setBadge("warn", "Mic reconnecting...");

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      startListening(true);
    }, delayMs);
  }

  function pauseForMic(reason) {
    keepListening = false;
    manualStop = false;
    reconnectFailures = 0;
    clearReconnectTimer();
    applyMicDisconnectedUI(reason || "Mic disconnected");
  }

  function unpauseForMic() {
    reconnectFailures = 0;
    state.micConnected = true;
    listening = true;
    setMicUI(true);
    resumeGame();
  }

  function handleRecognizedSpeech(transcript, isFinal, showMissFeedback = isFinal) {
    if (!state.micConnected) return false;

    const spoken = normalizeEnglish(transcript);
    if (!spoken) return false;

    reconnectFailures = 0;

    const nowMs = performance.now();
    if (nowMs - state.lastLockAt < state.lockCooldownMs) return false;

    const candidates = state.missiles.filter(m => !m.remove && !m.claimed);
    if (!candidates.length) return false;

    const target = state.targetId
      ? state.missiles.find(m => m.id === state.targetId && !m.remove && !m.claimed)
      : null;

    const allowPartial = !isFinal;

    let matched = null;
    if (target) {
      const targetMatch = isMatchEnglish(spoken, target.word, state.matchMode)
        || (allowPartial && isLikelyPartialMatchEnglish(spoken, target.word, state.matchMode));
      if (targetMatch) matched = target;
    }

    if (!matched) {
      for (const m of candidates.sort((a, b) => b.y - a.y)) {
        const matchedNow = isMatchEnglish(spoken, m.word, state.matchMode)
          || (allowPartial && isLikelyPartialMatchEnglish(spoken, m.word, state.matchMode));
        if (matchedNow) {
          matched = m;
          break;
        }
      }
    }

    if (matched) {
      state.lastLockAt = nowMs;
      matched.claimed = true;
      shootPrimaryAndMaybeExtras(matched, nowMs);

      state.hits += 1;
      state.streak += 1;
      state.score += 10 + Math.min(20, state.streak);

      if (state.streak > 0 && state.streak % 7 === 0) {
        spawnGift(nowMs);
        setBadge("good", "Gift dropped!");
      } else {
        setBadge("good", `Locked ${matched.word}`);
      }

      state.targetId = null;
      updateHUD();
      return true;
    }

    if (showMissFeedback && isFinal) setBadge("warn", "Almost - try again!");
    return false;
  }

  function handleRecognizedAlternatives(alternatives, isFinal) {
    const options = (Array.isArray(alternatives) ? alternatives : [alternatives])
      .map(t => normalizeEnglish(t))
      .filter(Boolean);

    if (!options.length) {
      setHeardText("");
      return false;
    }

    const stream = [];
    for (const option of options.slice(0, 4)) {
      for (const w of recentWordCandidates(option, 2)) stream.push(w);
    }

    const words = [];
    const seen = new Set();
    for (const w of stream) {
      if (seen.has(w)) continue;
      seen.add(w);
      words.push(w);
      if (words.length >= 6) break;
    }

    const hearing = words[0] || options[0];
    setHeardText(hearing);

    for (const word of words) {
      if (handleRecognizedSpeech(word, isFinal, false)) return true;
    }

    if (isFinal) setBadge("warn", "Almost - try again!");
    return false;
  }

  async function ensureNativePermission() {
    if (!nativeSpeech) return false;
    const status = await nativeSpeech.checkPermissions();
    if (status.speechRecognition === "granted") return true;
    const requested = await nativeSpeech.requestPermissions();
    return requested.speechRecognition === "granted";
  }

  async function ensureNativeListeners() {
    if (nativeSpeech && !nativePartialListenerReady) {
      await nativeSpeech.addListener("partialResults", (data) => {
        const matches = data && Array.isArray(data.matches) ? data.matches : [];
        handleRecognizedAlternatives(matches, false);
      });
      nativePartialListenerReady = true;
    }

    if (nativeSpeech && !nativeStateListenerReady) {
      await nativeSpeech.addListener("listeningState", (data) => {
        const status = data && data.status ? data.status : "";

        if (status === "started") {
          unpauseForMic();
          return;
        }

        if (status === "stopped") {
          listening = false;
          setMicUI(keepListening);
          if (keepListening && !manualStop) {
            scheduleReconnect(false);
          }
        }
      });
      nativeStateListenerReady = true;
    }
  }

  function startListening(isReconnect = false) {
    if (nativeSpeech) {
      void startNativeListening(isReconnect);
      return;
    }
    startBrowserListening(isReconnect);
  }

  async function startNativeListening(isReconnect = false) {
    if (!nativeSpeech || nativeStartPending || listening) return;

    if (!isReconnect) {
      keepListening = true;
      manualStop = false;
      reconnectFailures = 0;
      clearReconnectTimer();
    }

    nativeStartPending = true;

    try {
      const available = await nativeSpeech.available();
      if (!available.available) {
        pauseForMic("Speech recognition not available");
        return;
      }

      const hasPermission = await ensureNativePermission();
      if (!hasPermission) {
        pauseForMic("Mic permission denied");
        return;
      }

      await ensureNativeListeners();
      if (!usingVosk) unpauseForMic();

      const startOptions = {
        language: "en-US",
        maxResults: 5,
        partialResults: true,
        popup: false
      };
      if (usingVosk) startOptions.words = state.words;

      // Most native plugins return quickly when partialResults=true.
      await nativeSpeech.start(startOptions);
      if (usingVosk) unpauseForMic();
    } catch (err) {
      listening = false;
      if (keepListening && !manualStop) {
        state.micConnected = true;
        setMicUI(true);
        scheduleReconnect(true);
        return;
      }

      const msg = err && err.message ? String(err.message) : "Could not start mic";
      pauseForMic(msg);
    } finally {
      nativeStartPending = false;
    }
  }

  function startBrowserListening(isReconnect = false) {
    if (!SpeechRecognition || listening || rec) return;

    if (!isReconnect) {
      keepListening = true;
      manualStop = false;
      reconnectFailures = 0;
      clearReconnectTimer();
    }

    rec = new SpeechRecognition();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = true;

    rec.onresult = (event) => {
      if (!state.micConnected) return;

      const alternatives = [];
      let isFinal = false;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        isFinal = res.isFinal;
        const altCount = Math.min(4, res.length || 1);
        for (let j = 0; j < altCount; j++) {
          const alt = res[j] && res[j].transcript ? res[j].transcript : "";
          if (alt) alternatives.push(alt);
        }
        break;
      }

      handleRecognizedAlternatives(alternatives, isFinal);
    };

    rec.onerror = (e) => {
      const err = e && e.error ? e.error : "unknown";
      cleanupBrowserRecognizer();
      if (keepListening && TRANSIENT_SPEECH_ERRORS.has(err)) {
        scheduleReconnect(true);
        return;
      }
      pauseForMic(`Mic error: ${err}`);
    };

    rec.onend = () => {
      const endedByUser = manualStop;
      manualStop = false;
      cleanupBrowserRecognizer();
      if (endedByUser) return;
      if (keepListening) {
        scheduleReconnect(false);
        return;
      }
      pauseForMic("Mic disconnected");
    };

    try {
      rec.start();
      unpauseForMic();
    } catch (_) {
      cleanupBrowserRecognizer();
      if (keepListening) {
        scheduleReconnect(true);
        return;
      }
      pauseForMic("Could not start mic");
    }
  }

  function stopListening() {
    keepListening = false;
    manualStop = true;
    reconnectFailures = 0;
    clearReconnectTimer();

    if (nativeSpeech) {
      listening = false;
      setMicUI(false);
      nativeSpeech.stop().catch(() => {});
    } else {
      try { rec && rec.stop(); } catch (_) {}
      cleanupBrowserRecognizer();
    }

    applyMicDisconnectedUI("Mic disconnected");
  }

  btnMic.addEventListener("click", () => {
    if (!speechOk) return;
    if (listening || keepListening || nativeStartPending) stopListening();
    else startListening();
  });

  btnPause.addEventListener("click", () => {
    if (isFrozen(performance.now())) return;
    if (state.paused) resumeGame();
    else pauseGame();
  });

  btnReset.addEventListener("click", () => {
    state.score = 0; state.hits = 0; state.misses = 0; state.streak = 0; state.lives = 5;
    state.missiles = []; state.bullets = []; state.particles = []; state.explosions = []; state.gifts = [];
    state.targetId = null;
    state.lastLockAt = 0;
    state.freezeUntil = 0; state.slowUntil = 0; state.tripleUntil = 0;
    setHeardText("");
    updateHUD();
    setBadge("warn", state.micConnected ? "Listening... say a word" : "Connect mic to start");
  });

  // ---------- Final init ----------
  updateHUD();
  setMicUI(false);
  setHeardText("");
  pauseGame("Connect mic to start");

  requestAnimationFrame(step);
})();


























