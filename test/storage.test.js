import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, tick } from '../src/game.js';
import { loadGame, saveGame, resetGame, validateSave, SAVE_KEY, TERMINAL_KEY } from '../src/storage.js';

function memory() {
  const data = new Map();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
}

test('saving and loading preserves state without simulating offline time', () => {
  const storage = memory(), state = newGame();
  tick(state, 1); saveGame(storage, state);
  assert.deepEqual(loadGame(storage), state);
});

test('death persists and terminal marker defeats a stale active save', () => {
  const storage = memory(), state = newGame();
  saveGame(storage, state); const stale = storage.getItem(SAVE_KEY);
  state.health = 0.1; state.hunger = 0; tick(state, 1); saveGame(storage, state);
  storage.setItem(SAVE_KEY, stale);
  assert.equal(loadGame(storage).status, 'dead');
});

test('explicit new run has fresh identity and is not killed by the previous terminal marker', () => {
  const storage = memory(), state = newGame();
  state.health = 0.1; state.hunger = 0; tick(state, 1); saveGame(storage, state);
  const next = newGame(); saveGame(storage, next);
  assert.equal(loadGame(storage).status, 'active');
  assert.notEqual(next.runId, state.runId);
  assert.equal(loadGame(storage).parts, 0);
});

test('corrupt or incompatible saves are rejected without overwriting data', () => {
  const storage = memory(); storage.setItem(SAVE_KEY, '{broken');
  assert.throws(() => loadGame(storage)); assert.equal(storage.getItem(SAVE_KEY), '{broken');
  const state = newGame(); state.version = 999;
  assert.equal(validateSave(state), false);
  assert.throws(() => saveGame(storage, state));
});

test('save validation rejects negative resources and invalid nested shapes', () => {
  const mutations = [s => { s.food = -1; }, s => { s.residents[0] = null; },
    s => { s.crops = []; }, s => { s.oxygen = Infinity; }, s => { s.searched = ['scrap-0', 'scrap-0']; },
    s => { s.status = 'dead'; }, s => { s.rescue = 'active'; s.rescueDeadline = null; }];
  for (const mutate of mutations) {
    const state = newGame(); mutate(state); assert.equal(validateSave(state), false);
  }
});

test('storage exceptions are exposed to the UI instead of pretending to save', () => {
  assert.throws(() => saveGame({ setItem() { throw new Error('quota'); } }, newGame()), /quota/);
});

test('explicit reset recovers from a corrupt terminal marker', () => {
  const storage = memory(); storage.setItem(TERMINAL_KEY, '{broken');
  resetGame(storage, newGame());
  assert.equal(loadGame(storage).status, 'active');
  assert.equal(storage.getItem(TERMINAL_KEY), null);
});

test('legacy saves migrate to the expanded map without losing progress or overwriting on read', () => {
  const storage = memory(), legacy = newGame();
  legacy.version = 1; legacy.position = { x: 27.5, y: 14.5 };
  legacy.parts = 7; legacy.oxygen = 31; legacy.elapsed = 150;
  legacy.rescue = 'active'; legacy.rescueDeadline = 360;
  legacy.searched = ['scrap-0']; legacy.residents[2].invited = true;
  const raw = JSON.stringify(legacy); storage.setItem(SAVE_KEY, raw);
  const migrated = loadGame(storage);
  assert.equal(migrated.version, 2);
  assert.deepEqual(migrated.position, newGame().position);
  assert.deepEqual({ ...migrated, version: 1, position: legacy.position }, legacy);
  assert.equal(storage.getItem(SAVE_KEY), raw);
  saveGame(storage, migrated);
  assert.deepEqual(loadGame(storage), migrated);
});

test('legacy greenhouse position moves with the greenhouse and invalid old coordinates are rejected', () => {
  const storage = memory(), legacy = newGame(); legacy.version = 1;
  legacy.position = { x: 7.5, y: 14.5 };
  storage.setItem(SAVE_KEY, JSON.stringify(legacy));
  assert.deepEqual(loadGame(storage).position, { x: 11.5, y: 24.5 });
  legacy.position = { x: 50, y: 30 };
  storage.setItem(SAVE_KEY, JSON.stringify(legacy));
  assert.throws(() => loadGame(storage));
});

test('legacy terminal markers still prevent resurrection after map migration', () => {
  const storage = memory(), legacy = newGame();
  legacy.version = 1; legacy.position = { x: 7.5, y: 14.5 };
  storage.setItem(SAVE_KEY, JSON.stringify(legacy));
  legacy.status = 'dead'; legacy.health = 0; legacy.cause = '굶주림';
  storage.setItem(TERMINAL_KEY, JSON.stringify(legacy));
  const migrated = loadGame(storage);
  assert.equal(migrated.version, 2); assert.equal(migrated.status, 'dead');
  assert.equal(migrated.runId, legacy.runId);
  saveGame(storage, migrated);
  assert.equal(loadGame(storage).status, 'dead');
});
