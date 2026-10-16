// Lone Star Flight: pure game logic. No DOM, no Cesium. Loaded by the page as window.LSF and by tests via require().
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;   // CommonJS
  root.LSF = api;                                                           // browser and ESM (via globalThis)
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  'use strict';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

  // ---- units and formatting ----
  const GEOID = -26.5;                // EGM96 geoid height around Austin: ellipsoid = MSL + GEOID
  const ell = (msl) => msl + GEOID;
  const KT_PER_MS = 1.944, FT_PER_M = 3.281;
  function fmtClock(t) { const m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ':' + (s < 10 ? '0' : '') + s; }
  function fmtDist(m) { return m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m'; }
  function fmtHeading(deg) { return ('00' + Math.round(deg)).slice(-3); }

  // ---- navigation (local frame: x east, y north, z up) ----
  function headingDeg(east, north) { return (Math.atan2(east, north) * 180 / Math.PI + 360) % 360; }
  function relBearing(hdg, dx, dy) { const rel = headingDeg(dx, dy) - hdg; return ((rel + 540) % 360) - 180; }
  function vertCue(dz) { return dz > 40 ? '▲ climb' : dz < -40 ? '▼ descend' : ''; }
  function gateHit(dist, r) { return dist < r + 7; }
  // The play area. Past 13 km the jet is turned back toward Austin, harder the faster it goes, so even at Mach 2 it comes
  // round well inside the 20 km hard limit; only a jet that somehow gets past that is put back over Zilker.
  function boundary(x, y) { const r = Math.hypot(x, y); return r > 20000 ? 'respawn' : r > 13000 ? 'warn' : 'ok'; }
  function turnBackRate(speed) { return 0.5 + Math.min(1, Math.max(0, speed / 680)) * 0.9; }   // rad/s of yaw toward home
  // Which way to yaw (+1 left, counter-clockwise from above; -1 right) to point back at the origin. The z of r x f is positive
  // when the heading sits counter-clockwise of straight-out, so turning further left is the short way home. (This was
  // inverted in the game until 2026-10-16, which lined the jet up with the fence instead of turning it away.)
  function turnBackDir(x, y, fx, fy) { return (x * fy - y * fx) >= 0 ? 1 : -1; }

  // ---- engine ----
  // Two-stage afterburner. Stage one is a nudge; hold it STAGE_T seconds and stage two opens the throttle for real.
  // MACH1 is the in-game sound barrier: only stage two can cross it, and crossing it upward is the sonic boom.
  const VMAX = 340, STAGE_T = 2.5, MACH1 = 400, MACH2 = 680, SOUND_MS = 340, BOOM_KICK = 35;
  const BURNER = { boost1: 60, boost2: 370, ceiling1: 395, ceiling2: 760 };
  function burnerStage(burner, held) { return !burner ? 0 : held >= STAGE_T ? 2 : 1; }
  function targetSpeed(throttle, burner, held) { const s = burnerStage(burner, held || 0); return 55 + 275 * throttle + (s === 2 ? BURNER.boost2 : s === 1 ? BURNER.boost1 : 0); }
  function speedCeiling(burner, held) { const s = burnerStage(burner, held || 0); return s === 2 ? BURNER.ceiling2 : s === 1 ? BURNER.ceiling1 : VMAX; }
  function stepThrottle(t, up, down, dt) { if (up) t = clamp(t + dt * 0.6, 0, 1); if (down) t = clamp(t - dt * 0.6, 0, 1); return t; }
  // climbRate: vertical component of the forward vector (-1..1). Diving gains speed, climbing bleeds it.
  // Past the barrier in stage two the jet pulls toward its target twice as hard: Mach 1 is a threshold, not a milestone.
  function stepSpeed(speed, throttle, climbRate, dt, burner, held) {
    const supersonic = burnerStage(burner, held || 0) === 2 && speed >= MACH1;
    speed += (targetSpeed(throttle, burner, held) - speed) * Math.min(1, dt * (supersonic ? 1.1 : 0.55));
    speed -= climbRate * 9.8 * dt * 0.9;
    return clamp(speed, 45, speedCeiling(burner, held));
  }
  function boomCrossing(prevSpeed, speed) { return prevSpeed < MACH1 && speed >= MACH1; }
  function mach2Crossing(prevSpeed, speed) { return prevSpeed < MACH2 && speed >= MACH2; }
  function mach(speed) { return speed / SOUND_MS; }

  // ---- bank-to-turn (arcade) ----
  // The arrow keys command a bank angle, not a roll rate: hold to ramp toward MAX_BANK, release to level.
  // bankL and the returned target are bank angles with left positive. RL is this engine's roll input that banks left.
  const MAX_BANK = 65 * Math.PI / 180;
  function bankController(target, turnRight, bankL, dt, RL) {
    const want = -turnRight * MAX_BANK;
    target += (want - target) * Math.min(1, dt * 2.5);
    const rollIn = clamp(RL * (target - bankL) * 2.5, -1, 1);
    return { target, rollIn };
  }

  // ---- pilot assist ----
  const MARGIN = 12;                  // meters of clearance the probe demands above whatever it sees
  function probeDistance(speed) { return clamp(speed * 1.6, 150, 950); }
  // How far (m) the sampled surface pokes above the predicted flight path there. 0 = clear.
  function penalty(surfaceH, pathZ) { return surfaceH === undefined ? 0 : Math.max(0, surfaceH + MARGIN - pathZ); }
  // Given probe penalties {center,left,right} and height above ground, pick one move or none.
  function chooseManeuver(p, agl) {
    if (!(p.center > 0)) return null;
    const side = p.left <= p.right ? 1 : -1, sidePen = Math.min(p.left, p.right);
    if (sidePen > 20 && p.center > 25) return { type: 'pull', dir: side, say: 'Pull up!' };
    if (p.center < 22 && agl > 35) return { type: 'barrel', dir: side, say: 'Barrel roll!' };
    return { type: 'jink', dir: side, say: side > 0 ? 'Break left!' : 'Break right!' };
  }
  // Precision guard: near a gate, or while the pilot is actively working the pitch, the pilot is in command and the
  // assist flies no moves at all. Nothing can crash with the assist on, so there is nothing to protect against.
  const PRECISE_WALL = 30;   // kept for the diagnostics readout
  function allowManeuver(m, p, precise) { if (!m) return null; if (precise) return null; return m; }
  // Stick inputs for a scripted move at time t. dir: +1 left. bankL: bank angle, + = left wing down.
  // levelDir: the roll input that levels the wings now. RL: the roll input that banks left in this engine.
  function maneuverInputs(type, t, dir, bankL, levelDir, RL) {
    const o = { rollIn: 0, pitchIn: 0, free: false, rollRate: 5.5, pitchRate: 1.8, done: false };
    if (type === 'jink') {
      o.rollRate = 4.5; o.pitchRate = 2.2;
      if (t < 0.35) o.rollIn = RL * dir;
      else if (t < 1.2) { o.pitchIn = 1; o.rollIn = Math.abs(bankL) < 1.45 ? RL * dir * 0.4 : 0; }
      else if (t < 1.7) { o.rollIn = Math.abs(bankL) > 0.1 ? levelDir : 0; o.pitchIn = 0.2; }
      else o.done = true;
    } else if (type === 'barrel') {
      o.rollRate = 5; o.pitchRate = 1.6;
      if (t < 1.3) { o.rollIn = RL * dir; o.pitchIn = 0.55; o.free = true; } else o.done = true;
    } else if (type === 'pull') {
      o.rollRate = 5.2; o.pitchRate = 1.6;
      if (t < 0.7) o.pitchIn = 1;
      else if (t < 1.9) { o.rollIn = RL * dir; o.pitchIn = 0.2; o.free = true; }
      else o.done = true;
    } else if (type === 'vroll') {
      if (t < 1.15) { o.rollIn = 1; o.pitchIn = 0.25; o.free = true; } else o.done = true;
    } else o.done = true;
    return o;
  }
  // The hard floor follows terrain, not rooftops: it may drop instantly but rise only 1.5 m per sample.
  function trackFloor(prev, h) { return prev === undefined ? h : Math.min(h, prev + 1.5); }
  // A ground reading that jumps more than `jump` metres from the current one is held as a suspect and only accepted when the
  // next reading agrees with it. Real cliffs pass one probe later; a coarse tile's face under a jet at Mach does not.
  // Instant-replay director. Reads the recorded tape for moments worth a cut (sonic booms, gate passes, smoke coming on, the
  // burner lighting), gives each its own camera and pace, and fills the stretches between with the chase view, fast-forwarding
  // long dull legs from a high wide camera. Returns contiguous shots {t0, t1, cam, rate, side} covering the whole tape.
  const SHOT_RULES = { boom: { pri: 4, cam: 'orbit', pre: 0.8, post: 3.8, rate: 0.6 }, gate: { pri: 3, cam: 'gate', pre: 3.2, post: 1.6, rate: 0.75 },
    smoke: { pri: 2, cam: 'ground', pre: -1.2, post: 6.0, rate: 1 }, burner: { pri: 1, cam: 'side', pre: 0.4, post: 3.4, rate: 1 } };
  function planShots(frames, o) {
    o = o || {}; const FF_MIN = o.ffMin || 14, FF = o.ff || 3, MIN_SHOT = 2;
    if (!frames || frames.length < 2) return [];
    const t0 = frames[0].t, tE = frames[frames.length - 1].t, ev = [];
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1], b = frames[i];
      if (b.boom) ev.push(['boom', b.t]);
      if (b.g !== undefined && a.g !== undefined && b.g > a.g) ev.push(['gate', b.t]);
      if (b.tc && !a.tc) ev.push(['smoke', b.t]);
      if (b.b && !a.b) ev.push(['burner', b.t]);
    }
    const placed = [];
    ev.map(([k, t]) => ({ k, t, ...SHOT_RULES[k] })).sort((x, y) => y.pri - x.pri || x.t - y.t).forEach((e) => {
      let lo = Math.max(t0, e.t - e.pre), hi = Math.min(tE, e.t + e.post);
      for (const p of placed) {                       // keep the larger free piece beside each higher-priority shot
        if (p.t1 <= lo || p.t0 >= hi) continue;
        if (p.t0 - lo >= hi - p.t1) hi = Math.min(hi, p.t0); else lo = Math.max(lo, p.t1);
      }
      if (hi - lo >= MIN_SHOT) placed.push({ t0: lo, t1: hi, cam: e.cam, rate: e.rate });
    });
    placed.sort((x, y) => x.t0 - y.t0);
    const out = []; let cur = t0, ffN = 0;
    const fill = (a, b) => {
      if (b - a <= 0.05) return;
      if (b - a < FF_MIN) { out.push({ t0: a, t1: b, cam: 'chase', rate: 1 }); return; }
      out.push({ t0: a, t1: a + 3, cam: 'chase', rate: 1 });
      out.push({ t0: a + 3, t1: b - 3, cam: ffN++ % 2 ? 'side' : 'high', rate: FF });
      out.push({ t0: b - 3, t1: b, cam: 'chase', rate: 1 });
    };
    for (const p of placed) { fill(cur, p.t0); out.push(p); cur = p.t1; }
    fill(cur, tE);
    const merged = [];                                 // neighbours with the same camera and pace become one shot
    for (const sh of out) { const m = merged[merged.length - 1]; if (m && m.cam === sh.cam && m.rate === sh.rate) m.t1 = sh.t1; else merged.push({ ...sh }); }
    let k = o.firstSide === -1 ? 1 : 0;               // alternate sides so consecutive cut-aways do not repeat the same angle
    for (const sh of merged) sh.side = sh.cam === 'chase' ? 1 : (k++ % 2 ? -1 : 1);
    return merged;
  }
  function acceptGround(cur, suspect, h, jump, agree) {
    jump = jump === undefined ? 120 : jump; agree = agree === undefined ? 30 : agree;
    if (cur === undefined || Math.abs(h - cur) <= jump) return { ground: h, suspect: undefined };
    if (suspect !== undefined && Math.abs(h - suspect) <= agree) return { ground: h, suspect: undefined };
    return { ground: cur, suspect: h };
  }

  // ---- preferences ----
  function parsePref(v, d) { return v === null || v === undefined ? d : v === '1'; }

  return { clamp, wrapPi, GEOID, ell, KT_PER_MS, FT_PER_M, fmtClock, fmtDist, fmtHeading, headingDeg, relBearing, vertCue, gateHit, boundary,
    VMAX, STAGE_T, MACH1, MACH2, BOOM_KICK, BURNER, burnerStage, targetSpeed, speedCeiling, stepThrottle, stepSpeed, boomCrossing, mach2Crossing, mach, MARGIN, MAX_BANK, bankController, acceptGround, planShots, turnBackRate, turnBackDir, probeDistance, penalty, chooseManeuver, allowManeuver, PRECISE_WALL, maneuverInputs, trackFloor, parsePref };
});
