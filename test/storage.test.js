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
