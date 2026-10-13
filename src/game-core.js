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
  function boundary(x, y) { const r = Math.hypot(x, y); return r > 15000 ? 'respawn' : r > 13000 ? 'warn' : 'ok'; }

  // ---- engine ----
  const VMAX = 340, VMAX_BURNER = 450, BURNER_BOOST = 110;   // m/s
  function targetSpeed(throttle, burner) { return 55 + 275 * throttle + (burner ? BURNER_BOOST : 0); }
  function stepThrottle(t, up, down, dt) { if (up) t = clamp(t + dt * 0.6, 0, 1); if (down) t = clamp(t - dt * 0.6, 0, 1); return t; }
  // climbRate: vertical component of the forward vector (-1..1). Diving gains speed, climbing bleeds it. Afterburner lifts the ceiling.
  function stepSpeed(speed, throttle, climbRate, dt, burner) {
    speed += (targetSpeed(throttle, burner) - speed) * Math.min(1, dt * 0.55);
    speed -= climbRate * 9.8 * dt * 0.9;
    return clamp(speed, 45, burner ? VMAX_BURNER : VMAX);
  }

  // ---- pilot assist ----
  const MARGIN = 12;                  // meters of clearance the probe demands above whatever it sees
  function probeDistance(speed) { return clamp(speed * 1.6, 150, 330); }
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

  // ---- preferences ----
  function parsePref(v, d) { return v === null || v === undefined ? d : v === '1'; }

  return { clamp, wrapPi, GEOID, ell, KT_PER_MS, FT_PER_M, fmtClock, fmtDist, fmtHeading, headingDeg, relBearing, vertCue, gateHit, boundary,
    VMAX, VMAX_BURNER, BURNER_BOOST, targetSpeed, stepThrottle, stepSpeed, MARGIN, probeDistance, penalty, chooseManeuver, maneuverInputs, trackFloor, parsePref };
});
