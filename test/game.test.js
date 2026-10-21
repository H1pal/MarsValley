import test from 'node:test';
import assert from 'node:assert/strict';
import { act, interact, launchRequirements, move, newGame, tick, weather } from '../src/game.js';
import { OBJECTS, nearest, canStand, residentPosition, REGIONS, RESCUE_POSITION } from '../src/world.js';

function seconds(state, amount) { for (let i = 0; i < amount; i++) tick(state, 1); }
function approach(state, id) {
  const object = OBJECTS.find(o => o.id === id);
  state.position = { x: object.x, y: object.y + 1 };
  assert.equal(nearest(state)?.id, id);
}

test('plants need water, mature, and share harvest without duplicate rewards', () => {
  const state = newGame();
  state.residents.forEach(r => { r.hunger = 0; }); // no healthy workers
  approach(state, 'plot-4');
  interact(state);
  seconds(state, 10);
  assert.equal(state.crops[4].growth, 0);
  interact(state);
  seconds(state, 90);
  const before = state.food;
  interact(state);
  assert.equal(state.food, before + 3);
  interact(state);
  assert.equal(state.food, before + 3);
  assert.equal(state.crops[4].growth, 0);
});

test('residents work the greenhouse while the player explores', () => {
  const state = newGame();
  state.position = { x: 15, y: 10 };
  seconds(state, 24);
  assert.equal(state.harvested, 6);
  assert.equal(state.crops[0].planted, true);
});

test('outside oxygen drains, shelter restores it, and storm makes it more costly', () => {
  const state = newGame();
  state.position = { x: 18, y: 12 };
  seconds(state, 10);
  assert.ok(Math.abs(state.oxygen - 95.5) < 0.001);
  state.elapsed = 240;
  assert.equal(weather(state).storm, true);
  seconds(state, 10);
  assert.ok(Math.abs(state.oxygen - 86.5) < 0.001);
  state.position = { x: REGIONS.shelter.x + 1.5, y: REGIONS.shelter.y + 1.5 };
  seconds(state, 2);
  assert.equal(state.oxygen, 100);
});

test('oxygen death is terminal and blocks all further actions and simulation', () => {
  const state = newGame();
  state.position = { x: 18, y: 12 }; state.oxygen = 0; state.health = 4;
  tick(state, 1);
  assert.equal(state.status, 'dead');
  assert.equal(state.cause, '산소 고갈');
  const snapshot = structuredClone(state);
  tick(state, 1); move(state, 1, 0, 0.1); interact(state); act(state, 'eat');
  assert.deepEqual(state, snapshot);
});

test('hunger can kill even in the greenhouse', () => {
  const state = newGame(); state.hunger = 0; state.health = 0.5;
  tick(state, 1);
  assert.equal(state.status, 'dead');
  assert.equal(state.cause, '굶주림');
});

test('movement has collisions and diagonal speed is normalized', () => {
  assert.equal(canStand(REGIONS.greenhouse.x + 0.5, REGIONS.greenhouse.y + 3), false);
  const a = newGame(), b = newGame();
  a.position = { x: 18, y: 10 }; b.position = { ...a.position };
  move(a, 1, 0, 0.1); move(b, 1, 1, 0.1);
  assert.ok(Math.abs(Math.hypot(a.position.x - 18, a.position.y - 10) - Math.hypot(b.position.x - 18, b.position.y - 10)) < 1e-9);
});

test('salvage requires proximity and completion and can only be claimed once', () => {
  const state = newGame(); approach(state, 'scrap-0'); interact(state);
  move(state, 0, 1, 0.1); assert.equal(state.job, null);
  approach(state, 'scrap-0'); interact(state); seconds(state, 8);
  assert.equal(state.parts, 4);
  interact(state); seconds(state, 8); assert.equal(state.parts, 4);
});

test('failed actions leave resources unchanged and cannot repair remotely', () => {
  const state = newGame(); state.parts = 20;
  assert.equal(act(state, 'engine').ok, false); assert.equal(state.parts, 20);
  approach(state, 'ship'); state.parts = 3;
  assert.equal(act(state, 'engine').ok, false); assert.equal(state.parts, 3);
  state.parts = 4; assert.equal(act(state, 'engine').ok, true);
  assert.equal(act(state, 'engine').ok, false); assert.equal(state.parts, 0);
});

test('discussion protects agreed communal reserve and permits returning provisions', () => {
  const state = newGame(); approach(state, 'board');
  assert.equal(act(state, 'reserve').ok, false);
  act(state, 'policy', 'share');
  assert.equal(act(state, 'reserve').ok, false);
  state.food = 8; assert.equal(act(state, 'reserve').ok, true);
  assert.equal(state.food, 6); assert.equal(state.provisions, 2);
  act(state, 'returnFood'); assert.equal(state.food, 8); assert.equal(state.provisions, 0);
});

test('rescue offers a no-parts alternative and prevents scheduled resident death', () => {
  const state = newGame(); seconds(state, 120);
  assert.equal(state.rescue, 'active');
  state.position = { x: RESCUE_POSITION.x, y: RESCUE_POSITION.y - 1 }; state.oxygen = 50;
  assert.equal(nearest(state).id, 'seon');
  assert.equal(act(state, 'rescue', 'repair').ok, false);
  assert.equal(act(state, 'rescue', 'evacuate').ok, true);
  assert.equal(state.oxygen, 30);
  state.position = { ...newGame().position }; seconds(state, 250);
  assert.equal(state.residents[0].alive, true);
  assert.equal(state.rescue, 'saved');
});

test('ignoring the warned rescue can kill a resident and clears their invitation', () => {
  const state = newGame(); state.residents[0].invited = true;
  seconds(state, 361);
  assert.equal(state.rescue, 'lost');
  assert.equal(state.residents[0].alive, false);
  assert.equal(state.residents[0].invited, false);
});

test('departure requirements scale with crew and are rechecked at launch', () => {
  const state = newGame(); approach(state, 'ship');
  state.engine = true; state.lifeSupport = true; state.provisions = 2;
  state.residents[0].invited = true;
  assert.equal(launchRequirements(state).needed, 4);
  assert.equal(act(state, 'launch').ok, false);
  assert.equal(state.provisions, 2);
  state.provisions = 4; assert.equal(act(state, 'launch').ok, true);
  assert.deepEqual(state.ending.crew, ['선']);
  assert.deepEqual(state.ending.stayed, ['홍 선생님', 'DJ']);
});

test('complete solo route grows food, salvages, agrees allocation, repairs and escapes', () => {
  const state = newGame();
  for (const id of ['plot-0', 'plot-1']) { approach(state, id); interact(state); }
  approach(state, 'board'); act(state, 'policy', 'share'); act(state, 'reserve');
  for (const id of ['scrap-0', 'scrap-1']) { approach(state, id); interact(state); seconds(state, 8); }
  approach(state, 'ship'); act(state, 'engine'); act(state, 'lifeSupport');
  assert.equal(act(state, 'launch').ok, true);
  assert.equal(state.status, 'escaped');
  assert.equal(state.harvested, 6);
  assert.deepEqual(state.ending.crew, []);
});

test('malformed simulation steps do not advance time', () => {
  const state = newGame();
  for (const dt of [-1, NaN, Infinity, 10]) tick(state, dt);
  assert.equal(state.elapsed, 0);
});

test('all three residents can be rescued, persuaded and supplied for departure', () => {
  const state = newGame();
  seconds(state, 120);
  for (const id of ['scrap-0', 'scrap-1', 'scrap-2']) {
    approach(state, id); interact(state); seconds(state, 8);
  }
  approach(state, 'valve'); interact(state);
  assert.equal(state.leakFixed, true);
  state.position = { x: RESCUE_POSITION.x, y: RESCUE_POSITION.y - 1 };
  assert.equal(act(state, 'rescue', 'repair').ok, true);
  approach(state, 'pump'); assert.equal(act(state, 'pump').ok, true);
  approach(state, 'signal'); interact(state);
  approach(state, 'board'); act(state, 'policy', 'share');
  for (let i = 0; i < 4; i++) assert.equal(act(state, 'reserve').ok, true);
  for (const resident of state.residents) {
    const position = residentPosition(state, resident);
    state.position = { x: position.x, y: position.y + 1 };
    assert.equal(act(state, 'invite', resident.id).ok, true);
  }
  approach(state, 'ship'); act(state, 'engine'); act(state, 'lifeSupport');
  assert.equal(launchRequirements(state).needed, 8);
  assert.equal(act(state, 'launch').ok, true);
  assert.deepEqual(state.ending.crew, ['선', '홍 선생님', 'DJ']);
  assert.deepEqual(state.ending.stayed, []);
});

test('every static interaction has a reachable approach from the greenhouse', () => {
  const state = newGame(), queue = [state.position], seen = new Set();
  const reachableTargets = new Set();
  while (queue.length) {
    const position = queue.shift();
    const key = `${position.x},${position.y}`;
    if (seen.has(key) || !canStand(position.x, position.y)) continue;
    seen.add(key); state.position = position;
    const target = nearest(state); if (target) reachableTargets.add(target.id);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) queue.push({ x: position.x + dx, y: position.y + dy });
  }
  for (const object of OBJECTS) assert.ok(reachableTargets.has(object.id), `${object.id} must be reachable`);
});

test('resident starvation is real when the community has no food or active growers', () => {
  const state = newGame(); state.food = 0;
  state.crops.forEach(c => { c.planted = false; c.growth = 0; });
  state.residents.forEach(r => { r.hunger = 0; r.health = 1; });
  tick(state, 1);
  assert.equal(state.residents.filter(r => r.alive).length, 0);
  assert.equal(state.status, 'active');
});
