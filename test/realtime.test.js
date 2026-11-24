import assert from "node:assert/strict";
import test from "node:test";
import { act, interact, newGame, policyPreview, tick } from "../src/game.js";
import { validateSave } from "../src/storage.js";
import { OBJECTS } from "../src/world.js";

function approach(state, id) {
  const object = OBJECTS.find((o) => o.id === id);
  state.position = { x: object.x, y: object.y + 1 };
}

test("fractional browser frames complete paid jobs at exact zero and remain saveable", () => {
  const state = newGame();
  for (const id of ["scrap-1", "scrap-2", "scrap-3"]) {
    approach(state, id);
    interact(state);
    while (state.job) tick(state, 1 / 60);
  }
  approach(state, "valve");
  interact(state);
  approach(state, "pump");
  assert.equal(act(state, "pump").ok, true);
  approach(state, "ship");
  for (const action of ["base", "filter", "heat"]) {
    assert.equal(act(state, action).ok, true);
    while (state.job) tick(state, 1 / 60);
    assert.equal(state.projects[action].remaining, 0);
    assert.equal(validateSave(state), true);
  }
  state.crops[5] = { planted: false, watered: false, growth: 0 };
  approach(state, "plot-5");
  assert.equal(act(state, "soil").ok, true);
  for (let i = 0; i < 1800; i++) tick(state, 1 / 60);
  assert.equal(state.soil.phase, "water");
  assert.equal(state.soil.remaining, 0);
  assert.equal(validateSave(state), true);
  assert.equal(act(state, "soil").ok, true);
  for (let i = 0; i < 5400; i++) tick(state, 1 / 60);
  assert.equal(state.soilSettled, true);
  assert.equal(validateSave(state), true);
});

test("normal fractional play preserves valid nonnegative stock at every cycle boundary", () => {
  const state = newGame();
  for (let frame = 0; frame < 24001; frame++) {
    if (state.hunger < 60) act(state, "eat");
    tick(state, 0.05);
    if (frame % 100 === 0) {
      assert.ok(state.oxygenStock >= 0);
      assert.equal(validateSave(state), true, `save at ${state.elapsed}`);
    }
  }
  assert.equal(state.cycle, 4);
  assert.equal(validateSave(state), true);
});

test("oxygen depletion previews use the current storm consumption rate", () => {
  const state = newGame();
  const normal = policyPreview(state, "equal").people.find(
    (p) => p.id === "ran",
  ).exhaustion.oxygen;
  state.elapsed = 240;
  const storm = policyPreview(state, "equal").people.find((p) => p.id === "ran")
    .exhaustion.oxygen;
  assert.equal(normal / 2, storm);
});

test("a full reservoir leaves all 120 emergency oxygen in its wreck for later recovery", () => {
  const state = newGame();
  approach(state, "scrap-4");
  interact(state);
  for (let i = 0; i < 8; i++) tick(state, 1);
  assert.equal(state.searched.includes("scrap-4"), false);
  state.position = { ...newGame().position };
  state.oxygen = 20;
  for (let i = 0; i < 10; i++) tick(state, 1);
  approach(state, "scrap-4");
  interact(state);
  for (let i = 0; i < 8; i++) tick(state, 1);
  assert.equal(state.searched.includes("scrap-4"), true);
  assert.equal(validateSave(state), true);
});
