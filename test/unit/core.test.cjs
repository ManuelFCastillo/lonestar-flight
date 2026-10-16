const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
require('../../src/game-core.js');   // package is type:module, so this loads as ESM and registers globalThis.LSF
const G = globalThis.LSF;

describe('formatting', () => {
  test('fmtClock pads seconds', () => {
    assert.equal(G.fmtClock(0), '0:00');
    assert.equal(G.fmtClock(65), '1:05');
    assert.equal(G.fmtClock(600), '10:00');
    assert.equal(G.fmtClock(59.9), '0:59');
  });
  test('fmtDist switches to km at 1000 m', () => {
    assert.equal(G.fmtDist(999), '999 m');
    assert.equal(G.fmtDist(1000), '1.0 km');
    assert.equal(G.fmtDist(12345), '12.3 km');
    assert.equal(G.fmtDist(0.4), '0 m');
  });
  test('fmtHeading is three digits', () => {
    assert.equal(G.fmtHeading(5), '005');
    assert.equal(G.fmtHeading(90), '090');
    assert.equal(G.fmtHeading(271.4), '271');
  });
  test('ellipsoid height applies the Austin geoid offset', () => {
    assert.equal(G.ell(150), 123.5);
    assert.equal(G.GEOID, -26.5);
  });
});

describe('navigation', () => {
  test('headingDeg: north is 0, east 90, south 180, west 270', () => {
    assert.equal(G.headingDeg(0, 1), 0);
    assert.equal(G.headingDeg(1, 0), 90);
    assert.equal(G.headingDeg(0, -1), 180);
    assert.equal(G.headingDeg(-1, 0), 270);
  });
  test('relBearing is signed and wraps across north', () => {
    assert.equal(G.relBearing(90, 0, 1), -90);             // flying east, gate due north: turn left 90
    assert.equal(G.relBearing(90, 1, 0), 0);               // dead ahead
    assert.ok(Math.abs(G.relBearing(350, Math.sin(10 * Math.PI / 180), Math.cos(10 * Math.PI / 180)) - 20) < 1e-9);
    assert.ok(Math.abs(G.relBearing(10, Math.sin(350 * Math.PI / 180), Math.cos(350 * Math.PI / 180)) + 20) < 1e-9);
  });
  test('vertCue only speaks beyond 40 m', () => {
    assert.equal(G.vertCue(41), '▲ climb');
    assert.equal(G.vertCue(40), '');
    assert.equal(G.vertCue(-40), '');
    assert.equal(G.vertCue(-41), '▼ descend');
  });
  test('gateHit allows 7 m of slack around the ring', () => {
    assert.equal(G.gateHit(34.9, 28), true);
    assert.equal(G.gateHit(35, 28), false);
  });
  test('boundary warns at 13 km and respawns only past 20 km', () => {
    assert.equal(G.boundary(0, 0), 'ok');
    assert.equal(G.boundary(12999, 0), 'ok');
    assert.equal(G.boundary(0, 13001), 'warn');
    assert.equal(G.boundary(10607, 10607), 'warn');     // ~15 km diagonal: was a respawn, and at Mach 2 read as a crash
    assert.equal(G.boundary(14200, 14200), 'respawn');  // ~20.1 km
  });

  test('the turn-back brings a jet heading straight out at Mach 2 round well inside the hard limit', () => {
    assert.ok(G.turnBackRate(680) > G.turnBackRate(150));
    let x = 12900, y = 0, a = 0.2, rMax = 0; const v = 680, dt = 1 / 60;   // just inside the warning ring, flying outward
    for (let t = 0; t < 20; t += dt) {
      if (G.boundary(x, y) !== 'ok') a += G.turnBackDir(x, y, Math.cos(a), Math.sin(a)) * G.turnBackRate(v) * dt;   // the rule the game uses
      x += Math.cos(a) * v * dt; y += Math.sin(a) * v * dt; rMax = Math.max(rMax, Math.hypot(x, y));
      assert.notEqual(G.boundary(x, y), 'respawn');
    }
    assert.ok(rMax < 15000, 'max radius ' + Math.round(rMax));
    assert.ok(Math.hypot(x, y) < 13000, 'it ends up back inside the warning ring');
  });

  test('turnBackDir picks the short way home', () => {
    assert.equal(G.turnBackDir(13000, 0, Math.cos(0.3), Math.sin(0.3)), 1);    // east of home, heading a little north of east: turn left, via north
    assert.equal(G.turnBackDir(13000, 0, Math.cos(-0.3), Math.sin(-0.3)), -1); // heading a little south of east: turn right, via south
    assert.equal(G.turnBackDir(0, -13000, 1, 0), 1);                           // south of home heading east: turn left, to the north
  });
  test('wrapPi keeps angles in (-pi, pi]', () => {
    assert.ok(Math.abs(G.wrapPi(3 * Math.PI) - Math.PI) < 1e-9);
    assert.ok(Math.abs(G.wrapPi(-0.5) + 0.5) < 1e-9);
    assert.ok(Math.abs(G.wrapPi(2 * Math.PI + 0.25) - 0.25) < 1e-9);
  });
});

describe('engine', () => {
  test('throttle maps 0..1 onto 55..330 m/s', () => {
    assert.equal(G.targetSpeed(0), 55);
    assert.equal(G.targetSpeed(1), 330);
    assert.equal(G.targetSpeed(0.5), 192.5);
  });
  test('stepThrottle moves 0.6 per second and clamps', () => {
    assert.ok(Math.abs(G.stepThrottle(0.5, true, false, 0.5) - 0.8) < 1e-9);
    assert.equal(G.stepThrottle(0.9, true, false, 1), 1);
    assert.equal(G.stepThrottle(0.1, false, true, 1), 0);
    assert.equal(G.stepThrottle(0.3, false, false, 1), 0.3);
    assert.ok(Math.abs(G.stepThrottle(0.5, true, true, 0.5) - 0.5) < 1e-9);   // both keys cancel out
  });
  test('level flight converges on the throttle target', () => {
    let v = 150;
    for (let i = 0; i < 600; i++) v = G.stepSpeed(v, 0.6, 0, 1 / 60);
    assert.ok(Math.abs(v - G.targetSpeed(0.6)) < 0.5, 'settled at ' + v);
  });
  test('diving gains speed and climbing bleeds it, within limits', () => {
    const level = G.stepSpeed(200, 0.5, 0, 0.1);
    assert.ok(G.stepSpeed(200, 0.5, -0.5, 0.1) > level);
    assert.ok(G.stepSpeed(200, 0.5, 0.5, 0.1) < level);
    assert.equal(G.stepSpeed(340, 1, -1, 1), 340);
    assert.equal(G.stepSpeed(45, 0, 1, 1), 45);
  });
  test('afterburner has two stages: a nudge, then the real thing after 2.5 s', () => {
    assert.equal(G.burnerStage(false, 10), 0);
    assert.equal(G.burnerStage(true, 0), 1);
    assert.equal(G.burnerStage(true, 2.49), 1);
    assert.equal(G.burnerStage(true, 2.5), 2);
    assert.equal(G.targetSpeed(1, true, 0), 390);
    assert.equal(G.targetSpeed(1, true, 3), 700);
    assert.equal(G.speedCeiling(true, 0), 395);
    assert.equal(G.speedCeiling(true, 3), 760);
    assert.equal(G.stepSpeed(760, 1, 0, 1, false, 0), 340);   // let go of the burner: back under the normal ceiling at once
    let v = 300, peak = 0;
    for (let i = 0; i < 900; i++) { v = G.stepSpeed(v, 1, -1, 1 / 60, true, 3); peak = Math.max(peak, v); }   // 15 s in stage two, diving
    assert.ok(peak <= 760, 'ceiling held, peak ' + peak);
    v = 300;
    for (let i = 0; i < 900; i++) v = G.stepSpeed(v, 1, 0, 1 / 60, true, 3);
    assert.ok(Math.abs(v - 700) < 0.5, 'stage two settled at ' + v);
  });
  test('past Mach 1 the jet accelerates about twice as hard', () => {
    const below = G.stepSpeed(380, 1, 0, 0.1, true, 3) - 380;
    const above = G.stepSpeed(420, 1, 0, 0.1, true, 3) - 420;
    assert.ok(above / (700 - 420) > 1.8 * (below / (700 - 380)), 'supersonic pull ' + above + ' vs subsonic ' + below);
    assert.equal(G.BOOM_KICK, 35);
  });
  test('the sound barrier sits above stage one and the boom fires once, on the way up', () => {
    assert.ok(G.speedCeiling(true, 0) < G.MACH1, 'stage one must not be able to boom');
    assert.ok(G.speedCeiling(true, 3) > G.MACH1);
    assert.equal(G.boomCrossing(399, 400), true);
    assert.equal(G.boomCrossing(400, 401), false);
    assert.equal(G.boomCrossing(401, 399), false);
    assert.ok(G.targetSpeed(1, true, 3) > G.MACH2, 'Mach 2 must be reachable in level flight');
    assert.equal(G.mach2Crossing(679, 680), true);
    assert.equal(G.mach2Crossing(680, 700), false);
    assert.ok(Math.abs(G.mach(340) - 1) < 1e-9);
    assert.ok(Math.abs(G.mach(510) - 1.5) < 1e-9);
  });
});

describe('bank-to-turn', () => {
  test('holding right ramps the bank target toward 65 degrees and never past it', () => {
    let target = 0;
    for (let i = 0; i < 300; i++) target = G.bankController(target, 1, 0, 1 / 60, -1).target;
    assert.ok(Math.abs(target + G.MAX_BANK) < 1e-3, 'target ' + target);   // right turn = negative (left-positive convention)
    assert.ok(Math.abs(target) <= G.MAX_BANK + 1e-9);
  });
  test('releasing levels the wings: target decays to zero and the roll command points back to level', () => {
    let target = -G.MAX_BANK;
    for (let i = 0; i < 300; i++) target = G.bankController(target, 0, 0, 1 / 60, -1).target;
    assert.ok(Math.abs(target) < 1e-3);
    const r = G.bankController(0, 0, -0.8, 0.016, -1);   // banked 0.8 rad right, no input
    assert.ok(r.rollIn < 0, 'should roll left (RL = -1) to level');
  });
  test('the roll command obeys the engine sign and saturates', () => {
    const cesium = G.bankController(-G.MAX_BANK, 1, 0, 0.016, -1);   // wants right, is level, RL=-1 (right = +1)
    assert.equal(cesium.rollIn, 1);
    const three = G.bankController(-G.MAX_BANK, 1, 0, 0.016, 1);     // same, in the engine where +1 banks left
    assert.equal(three.rollIn, -1);
  });
});

describe('pilot assist', () => {
  test('probe reaches 1.6 s ahead, clamped to 150..950 m', () => {
    assert.equal(G.probeDistance(50), 150);
    assert.equal(G.probeDistance(150), 240);
    assert.equal(G.probeDistance(340), 544);
    assert.equal(G.probeDistance(620), 950);
  });
  test('penalty is zero when clear by the margin, else the shortfall', () => {
    assert.equal(G.penalty(undefined, 100), 0);
    assert.equal(G.penalty(80, 100), 0);               // 80 + 12 < 100
    assert.equal(G.penalty(88, 100), 0);               // exactly on the margin
    assert.equal(G.penalty(100, 100), 12);
    assert.equal(G.penalty(150, 100), 62);
  });
  test('no move when the path is clear', () => {
    assert.equal(G.chooseManeuver({ center: 0, left: 50, right: 50 }, 300), null);
  });
  test('breaks toward the clearer side', () => {
    assert.deepEqual(G.chooseManeuver({ center: 40, left: 0, right: 30 }, 300), { type: 'jink', dir: 1, say: 'Break left!' });
    assert.deepEqual(G.chooseManeuver({ center: 40, left: 30, right: 0 }, 300), { type: 'jink', dir: -1, say: 'Break right!' });
  });
  test('barrel rolls over a small obstacle only with height to spare', () => {
    assert.equal(G.chooseManeuver({ center: 10, left: 0, right: 0 }, 100).type, 'barrel');
    assert.equal(G.chooseManeuver({ center: 10, left: 0, right: 0 }, 30).type, 'jink');
    assert.equal(G.chooseManeuver({ center: 22, left: 0, right: 0 }, 100).type, 'jink');
  });
  test('pulls up only when both sides are blocked too', () => {
    assert.equal(G.chooseManeuver({ center: 60, left: 30, right: 40 }, 100).type, 'pull');
    assert.equal(G.chooseManeuver({ center: 60, left: 30, right: 10 }, 100).type, 'jink');   // right side is open enough
    assert.equal(G.chooseManeuver({ center: 20, left: 30, right: 40 }, 100).type, 'barrel'); // boxed in but the obstacle is small: roll over it
  });
  test('precision guard: near a gate or hands-on the pilot is in command, no moves at all', () => {
    const small = { center: 15, left: 0, right: 0 }, wall = { center: 60, left: 30, right: 40 };
    const barrel = G.chooseManeuver(small, 100), pull = G.chooseManeuver(wall, 100);
    assert.equal(barrel.type, 'barrel');
    assert.equal(G.allowManeuver(barrel, small, false), barrel);         // normal flight: fine
    assert.equal(G.allowManeuver(barrel, small, true), null);            // lining up a gate: leave the pilot alone
    assert.equal(G.allowManeuver(pull, wall, true), null);               // even a wall: assist cannot crash, the pilot flies
    assert.equal(G.allowManeuver(pull, wall, false), pull);
    assert.equal(G.allowManeuver(null, small, true), null);
  });
  test('jink timeline: roll in, pull around, roll out, done', () => {
    const RL = -1, dir = 1;
    assert.equal(G.maneuverInputs('jink', 0.1, dir, 0, 1, RL).rollIn, RL * dir);
    const mid = G.maneuverInputs('jink', 0.6, dir, 0.5, 1, RL);
    assert.equal(mid.pitchIn, 1);
    assert.equal(mid.rollIn, RL * dir * 0.4);                                   // still rolling toward 83 degrees
    assert.equal(G.maneuverInputs('jink', 0.6, dir, 1.5, 1, RL).rollIn, 0);     // holds the bank once there
    assert.equal(G.maneuverInputs('jink', 1.4, dir, 1.0, 0.7, RL).rollIn, 0.7); // levels with whatever direction levels
    assert.equal(G.maneuverInputs('jink', 1.4, dir, 0.05, 0.7, RL).rollIn, 0);  // already level
    assert.equal(G.maneuverInputs('jink', 1.8, dir, 0, 1, RL).done, true);
  });
  test('barrel and victory rolls run free of auto-level, then finish', () => {
    const b = G.maneuverInputs('barrel', 0.5, -1, 0, 1, -1);
    assert.equal(b.free, true); assert.equal(b.rollIn, 1); assert.equal(b.done, false);
    assert.equal(G.maneuverInputs('barrel', 1.31, -1, 0, 1, -1).done, true);
    assert.equal(G.maneuverInputs('vroll', 1.0, 1, 0, 1, -1).free, true);
    assert.equal(G.maneuverInputs('vroll', 1.2, 1, 0, 1, -1).done, true);
  });
  test('pull: nose first, roll second', () => {
    assert.equal(G.maneuverInputs('pull', 0.3, 1, 0, 1, -1).pitchIn, 1);
    assert.equal(G.maneuverInputs('pull', 0.3, 1, 0, 1, -1).rollIn, 0);
    assert.equal(G.maneuverInputs('pull', 1.0, 1, 0, 1, -1).rollIn, -1);
    assert.equal(G.maneuverInputs('pull', 2.0, 1, 0, 1, -1).done, true);
  });
  test('every move keeps inputs in range and ends within 3 s', () => {
    for (const type of ['jink', 'barrel', 'pull', 'vroll']) {
      let done = false;
      for (let t = 0; t <= 3; t += 0.05) {
        const o = G.maneuverInputs(type, t, 1, 0.3, 1, -1);
        assert.ok(Math.abs(o.rollIn) <= 1 && Math.abs(o.pitchIn) <= 1, type + ' at ' + t);
        if (o.done) { done = true; break; }
      }
      assert.ok(done, type + ' never finished');
    }
    assert.equal(G.maneuverInputs('nope', 0, 1, 0, 1, -1).done, true);
  });
  test('floor tracking drops instantly but rises 1.5 m per sample', () => {
    assert.equal(G.trackFloor(undefined, 120), 120);
    assert.equal(G.trackFloor(120, 300), 121.5);   // a rooftop under the jet does not become the floor
    assert.equal(G.trackFloor(120, 100), 100);
  });

  test('planShots: a short quiet tape is one chase shot at normal speed', () => {
    const f = [{ t: 0 }, { t: 4 }, { t: 8 }];
    assert.deepEqual(G.planShots(f), [{ t0: 0, t1: 8, cam: 'chase', rate: 1, side: 1 }]);
  });

  test('planShots: a long quiet leg is fast-forwarded from a wide camera between chase shots', () => {
    const sh = G.planShots([{ t: 0 }, { t: 60 }]);
    assert.deepEqual(sh.map((s) => [s.cam, s.rate]), [['chase', 1], ['high', 3], ['chase', 1]]);
    assert.equal(sh[0].t0, 0); assert.equal(sh[sh.length - 1].t1, 60);
  });

  test('planShots: a gate pass gets the gate camera, slowed, framed around the pass', () => {
    const f = []; for (let t = 0; t <= 30; t += 0.5) f.push({ t, g: t < 20 ? 0 : 1 });
    const gs = G.planShots(f).find((s) => s.cam === 'gate');
    assert.deepEqual([gs.t0, gs.t1, gs.rate], [16.8, 21.6, 0.75]);
  });

  test('planShots: a boom outranks a gate pass at the same moment; the gate keeps the free part before it', () => {
    const f = []; for (let t = 0; t <= 40; t += 0.5) f.push({ t, g: t < 20 ? 0 : 1, boom: t === 20.5 ? 1 : 0 });
    const sh = G.planShots(f), orbit = sh.find((s) => s.cam === 'orbit'), gate = sh.find((s) => s.cam === 'gate');
    assert.deepEqual([orbit.t0, orbit.t1], [19.7, 24.3]);
    assert.deepEqual([gate.t0, gate.t1], [16.8, 19.7]);
  });

  test('planShots: shots are contiguous, cover the tape, and consecutive cut-aways alternate sides', () => {
    const f = []; for (let t = 0; t <= 120; t += 0.5) f.push({ t, g: Math.floor(t / 25), tc: t > 10 && t < 30, b: t > 50 && t < 70, boom: t === 60 ? 1 : 0 });
    const sh = G.planShots(f);
    assert.equal(sh[0].t0, 0); assert.equal(sh[sh.length - 1].t1, 120);
    for (let i = 1; i < sh.length; i++) { assert.equal(sh[i].t0, sh[i - 1].t1); assert.ok(sh[i].t1 > sh[i].t0); }
    const cuts = sh.filter((s) => s.cam !== 'chase');
    for (let i = 1; i < cuts.length; i++) assert.notEqual(cuts[i].side, cuts[i - 1].side);
    assert.ok(new Set(cuts.map((s) => s.cam)).size >= 4);   // gate, ground, side, orbit all appear: no single repeating loop
  });

  test('acceptGround holds a sudden jump as a suspect until a second reading agrees', () => {
    assert.deepEqual(G.acceptGround(undefined, undefined, 150), { ground: 150, suspect: undefined });   // first reading is taken as is
    assert.deepEqual(G.acceptGround(150, undefined, 190), { ground: 190, suspect: undefined });         // 40 m: ordinary terrain
    const spike = G.acceptGround(150, undefined, 600);                                                  // a coarse tile face 450 m up
    assert.deepEqual(spike, { ground: 150, suspect: 600 });
    assert.deepEqual(G.acceptGround(150, 600, 155), { ground: 155, suspect: undefined });               // the next probe is normal: spike dropped
    assert.deepEqual(G.acceptGround(150, 600, 590), { ground: 590, suspect: undefined });               // two readings agree: it was a cliff
  });
});

describe('preferences', () => {
  test('parsePref falls back to the default and reads "1" as true', () => {
    assert.equal(G.parsePref(null, true), true);
    assert.equal(G.parsePref(undefined, false), false);
    assert.equal(G.parsePref('1', false), true);
    assert.equal(G.parsePref('0', true), false);
    assert.equal(G.parsePref('garbage', true), false);
  });
});
