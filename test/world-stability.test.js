import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { newGame } from "../src/game.js";
import {
  canStand,
  HEIGHT,
  LEAK,
  nearest,
  OBJECTS,
  PLOTS,
  REGIONS,
  residentPosition,
  terrain,
  TILE,
  TRAILS,
  WIDTH,
} from "../src/world.js";

test("v1.5 preserves the v1.0 tile map, all fixed geometry and object locations", () => {
  const snapshot = {
    WIDTH,
    HEIGHT,
    TILE,
    REGIONS,
    LEAK,
    TRAILS,
    PLOTS,
    objects: OBJECTS.map(({ id, type, x, y }) => ({ id, type, x, y })),
    tiles: Array.from({ length: HEIGHT }, (_, y) =>
      Array.from({ length: WIDTH }, (_, x) => terrain(x + 0.5, y + 0.5)),
    ),
  };
  assert.equal(
    createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"),
    "e421d85a906c33e83e29532e03543f3670cb7633151718d48473cdbaaad38726",
  );
});

test("shelter radio uses contextual E without adding a collision object", () => {
  const state = newGame();
  state.position = { x: 36.5, y: 21.5 };
  assert.equal(canStand(state.position.x, state.position.y), true);
  assert.equal(nearest(state).type, "shelter");
  assert.equal(
    OBJECTS.some((o) => o.id === "shelter"),
    false,
  );
  state.position = { x: 40.5, y: 21.5 };
  assert.notEqual(nearest(state)?.type, "shelter");
});

test("Seon remains at home during and after treatment", () => {
  const state = newGame(),
    seon = state.residents.find((r) => r.id === "seon");
  const home = residentPosition(state, seon);
  for (const elapsed of [12, 120, 600]) {
    state.elapsed = elapsed;
    seon.treated = true;
    assert.deepEqual(residentPosition(state, seon), home);
  }
});
