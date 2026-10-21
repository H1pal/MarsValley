import test from 'node:test';
import assert from 'node:assert/strict';
import { act, interact, move, newGame, tick, weather } from '../src/game.js';
import { canStand, isSafe, nearest, REGIONS, RESCUE_POSITION, inLeak } from '../src/world.js';

// Find a walkable route, then traverse it through real movement and simulation.
// No teleporting, free resources, or time shortcuts on these exploration routes.
function walk(state, goal) {
  const queue = [{ position: { ...state.position }, previous: -1 }];
  const seen = new Set([`${state.position.x},${state.position.y}`]);
  let end = -1;
  for (let i = 0; i < queue.length; i++) {
    const { position } = queue[i];
    if (goal(position)) { end = i; break; }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const next = { x: position.x + dx, y: position.y + dy }, key = `${next.x},${next.y}`;
      if (seen.has(key) || !canStand(next.x, next.y) || (!state.leakFixed && inLeak(next))) continue;
      seen.add(key); queue.push({ position: next, previous: i });
    }
  }
  assert.notEqual(end, -1, 'destination has a safe walkable approach');
  const path = [];
  for (let i = end; queue[i].previous !== -1; i = queue[i].previous) path.unshift(queue[i].position);
  for (const p of path) {
    for (let steps = 0; Math.hypot(p.x - state.position.x, p.y - state.position.y) > 1e-7; steps++) {
      assert.ok(steps < 100, 'movement must not get stuck');
      const dx = p.x - state.position.x, dy = p.y - state.position.y;
      const speed = weather(state).storm && !isSafe(state.position) ? 2.4 : 3.4;
      const dt = Math.min(0.05, Math.hypot(dx, dy) / speed);
      move(state, dx, dy, dt); tick(state, dt);
      assert.equal(state.status, 'active');
      assert.ok(state.oxygen > 25, 'route retains oxygen for emergency evacuation');
    }
    // Remove floating point drift after physically reaching the cell.
    state.position = { ...p };
  }
}
function reach(state, id) { walk(state, position => nearest({ ...state, position })?.id === id); }
function wait(state, seconds) { for (let i = 0; i < seconds; i++) tick(state, 1); }

test('expanded routes support storm rescue, all companions, and escape within 30 minutes', () => {
  const state = newGame();
  wait(state, 240); // Rescue already active; the trip starts in a storm.
  assert.equal(weather(state).storm, true);
  for (const id of ['scrap-0', 'scrap-1', 'scrap-2']) {
    reach(state, id); assert.equal(interact(state).message.includes('수색 중'), true); wait(state, 8);
  }
  walk(state, p => p.x === REGIONS.shelter.x + 2.5 && p.y === REGIONS.shelter.y + 1.5);
  wait(state, 13); assert.equal(state.oxygen, 100);
  reach(state, 'valve'); interact(state);
  reach(state, 'seon');
  assert.ok(state.elapsed < state.rescueDeadline, 'rescue reachable before the existing deadline');
  assert.equal(act(state, 'rescue', 'repair').ok, true);
  reach(state, 'signal'); interact(state);
  reach(state, 'pump'); assert.equal(act(state, 'pump').ok, true);
  reach(state, 'board'); act(state, 'policy', 'share');
  for (let i = 0; i < 4; i++) assert.equal(act(state, 'reserve').ok, true);
  for (const id of ['seon', 'hong', 'dj']) { reach(state, id); assert.equal(act(state, 'invite', id).ok, true); }
  reach(state, 'ship');
  assert.equal(act(state, 'engine').ok, true); assert.equal(act(state, 'lifeSupport').ok, true);
  assert.equal(act(state, 'launch').ok, true);
  assert.deepEqual(state.ending.crew, ['선', '홍 선생님', 'DJ']);
  assert.ok(state.elapsed < 1800);
});

test('expanded facility leak and rescue position agree with the world geometry', () => {
  assert.ok(inLeak(RESCUE_POSITION));
  const state = newGame(); state.position = { x: RESCUE_POSITION.x, y: RESCUE_POSITION.y - 1 };
  tick(state, 1); assert.equal(state.health, 98);
  state.leakFixed = true; tick(state, 1); assert.equal(state.health, 98);
  assert.equal(isSafe(state.position), false);
});
