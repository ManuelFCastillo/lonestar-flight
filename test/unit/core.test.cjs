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
  test('boundary warns at 13 km and respawns at 15 km', () => {
    assert.equal(G.boundary(0, 0), 'ok');
    assert.equal(G.boundary(12999, 0), 'ok');
    assert.equal(G.boundary(0, 13001), 'warn');
    assert.equal(G.boundary(10607, 10607), 'respawn');  // ~15 km diagonal
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
  test('afterburner adds 110 m/s to the target and lifts the ceiling to 450', () => {
    assert.equal(G.targetSpeed(1, true), 440);
    assert.equal(G.targetSpeed(0, true), 165);
    assert.equal(G.stepSpeed(450, 1, -1, 1, true), 450);
    assert.equal(G.stepSpeed(450, 1, 0, 1, false), 340);   // let go of the burner: back under the normal ceiling at once
    let v = 300;
    for (let i = 0; i < 900; i++) v = G.stepSpeed(v, 1, 0, 1 / 60, true);   // 15 s of flight
    assert.ok(Math.abs(v - 440) < 0.5, 'burner settled at ' + v);
  });
});

describe('pilot assist', () => {
  test('probe reaches 1.6 s ahead, clamped to 150..330 m', () => {
    assert.equal(G.probeDistance(50), 150);
    assert.equal(G.probeDistance(150), 240);
    assert.equal(G.probeDistance(340), 330);
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
