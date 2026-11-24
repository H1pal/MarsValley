import assert from "node:assert/strict";
import test from "node:test";
import { newGame } from "../src/game.js";
import { canUseMap } from "../src/map.js";

test("map is usable during a forecast but unavailable throughout every storm", () => {
  const state = newGame();
  for (const cycle of [0, 300, 900]) {
    for (const [phase, allowed] of [
      [0, true],
      [210, true],
      [239.99, true],
      [240, false],
      [299.99, false],
      [300, true],
    ]) {
      state.elapsed = cycle + phase;
      assert.equal(canUseMap(state), allowed, `time ${state.elapsed}`);
    }
  }
  for (const status of ["dead", "settled", "failed"]) {
    state.status = status;
    state.elapsed = 0;
    assert.equal(canUseMap(state), false);
  }
});
