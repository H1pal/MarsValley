import assert from "node:assert/strict";
import test from "node:test";
import { act, interact, newGame, tick } from "../src/game.js";
import {
  SAVE_KEY,
  TERMINAL_KEY,
  hasLegacyGame,
  loadGame,
  resetGame,
  saveGame,
  validateSave,
} from "../src/storage.js";

import { OBJECTS } from "../src/world.js";

function approach(state, id) {
  const object = OBJECTS.find((o) => o.id === id);
  state.position = { x: object.x, y: object.y + 1 };
}
function seconds(state, amount) {
  for (let i = 0; i < amount; i++) tick(state, 1);
}

function memory() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  };
}

test("saving and loading preserves state without simulating offline time", () => {
  const storage = memory(),
    state = newGame();
  tick(state, 1);
  saveGame(storage, state);
  assert.deepEqual(loadGame(storage), state);
});

test("death persists and terminal marker defeats a stale active save", () => {
  const storage = memory(),
    state = newGame();
  saveGame(storage, state);
  const stale = storage.getItem(SAVE_KEY);
  state.health = 0.1;
  state.hunger = 0;
  tick(state, 1);
  saveGame(storage, state);
  storage.setItem(SAVE_KEY, stale);
  assert.equal(loadGame(storage).status, "dead");
});

test("explicit new run has fresh identity and is not killed by the previous terminal marker", () => {
  const storage = memory(),
    state = newGame();
  state.health = 0.1;
  state.hunger = 0;
  tick(state, 1);
  saveGame(storage, state);
  const next = newGame();
  saveGame(storage, next);
  assert.equal(loadGame(storage).status, "active");
  assert.notEqual(next.runId, state.runId);
  assert.equal(loadGame(storage).parts, 0);
});

test("corrupt or incompatible saves are rejected without overwriting data", () => {
  const storage = memory();
  storage.setItem(SAVE_KEY, "{broken");
  assert.throws(() => loadGame(storage));
  assert.equal(storage.getItem(SAVE_KEY), "{broken");
  const state = newGame();
  state.version = 999;
  assert.equal(validateSave(state), false);
  assert.throws(() => saveGame(storage, state));
});

test("save validation rejects negative resources and invalid nested shapes", () => {
  const mutations = [
    (s) => {
      s.food = -1;
    },
    (s) => {
      s.residents[0] = null;
    },
    (s) => {
      s.crops = [];
    },
    (s) => {
      s.oxygen = Infinity;
    },
    (s) => {
      s.searched = ["scrap-0", "scrap-0"];
    },
    (s) => {
      s.status = "dead";
    },
    (s) => {
      s.crops[0].growth = Infinity;
    },
  ];
  for (const mutate of mutations) {
    const state = newGame();
    mutate(state);
    assert.equal(validateSave(state), false);
  }
});

test("storage exceptions are exposed to the UI instead of pretending to save", () => {
  assert.throws(
    () =>
      saveGame(
        {
          setItem() {
            throw new Error("quota");
          },
        },
        newGame(),
      ),
    /quota/,
  );
});

test("explicit reset recovers from a corrupt terminal marker", () => {
  const storage = memory();
  storage.setItem(TERMINAL_KEY, "{broken");
  resetGame(storage, newGame());
  assert.equal(loadGame(storage).status, "active");
  assert.equal(storage.getItem(TERMINAL_KEY), null);
});

const LEGACY_SAVE_KEY = "mars-valley.run.v1";
const LEGACY_TERMINAL_KEY = "mars-valley.terminal.v1";

test("v1.5 uses distinct persistence keys", () => {
  assert.equal(SAVE_KEY, "mars-valley.run.v3");
  assert.equal(TERMINAL_KEY, "mars-valley.terminal.v3");
});

test("legacy active escaped dead and corrupt records remain read-only and are never simulated", () => {
  for (const raw of [
    '{"version":1,"status":"active"}',
    '{"version":2,"status":"escaped"}',
    '{"version":1,"status":"dead"}',
    "{broken",
    "",
  ]) {
    const storage = memory();
    storage.setItem(LEGACY_SAVE_KEY, raw);
    storage.setItem(LEGACY_TERMINAL_KEY, raw);
    assert.equal(hasLegacyGame(storage), true);
    assert.equal(loadGame(storage), null);
    resetGame(storage, newGame());
    assert.equal(loadGame(storage).status, "active");
    assert.equal(storage.getItem(LEGACY_SAVE_KEY), raw);
    assert.equal(storage.getItem(LEGACY_TERMINAL_KEY), raw);
  }
});

test("legacy terminal alone prompts an explicit new run and never kills a v3 run", () => {
  const storage = memory();
  assert.equal(hasLegacyGame(storage), false);
  storage.setItem(LEGACY_TERMINAL_KEY, '{"status":"dead"}');
  assert.equal(hasLegacyGame(storage), true);
  assert.equal(loadGame(storage), null);
  saveGame(storage, newGame());
  assert.equal(loadGame(storage).status, "active");
  assert.equal(storage.getItem(LEGACY_TERMINAL_KEY), '{"status":"dead"}');
});

test("a v3 terminal record survives a failed ordinary save and no ordinary save", () => {
  const storage = memory(),
    state = newGame();
  state.health = 0.1;
  state.hunger = 0;
  tick(state, 1);
  storage.setItem(TERMINAL_KEY, JSON.stringify(state));
  assert.equal(loadGame(storage).status, "dead");
  assert.equal(storage.getItem(SAVE_KEY), null);
});

test("a malformed terminal marker is preserved and blocks resurrection", () => {
  const storage = memory();
  saveGame(storage, newGame());
  storage.setItem(TERMINAL_KEY, "{broken");
  assert.throws(() => loadGame(storage));
  assert.equal(storage.getItem(TERMINAL_KEY), "{broken");
});

test("v3 validation checks nested supplies reservations rights timing and duplicate references", () => {
  const mutations = [
    (s) => {
      s.food = 0.1;
    },
    (s) => {
      s.rations.ran.food = 0.1;
    },
    (s) => {
      s.rations.seon.oxygen = -1;
    },
    (s) => {
      delete s.rations.dj;
    },
    (s) => {
      s.oxygenStock = Infinity;
    },
    (s) => {
      s.kits = 2;
    },
    (s) => {
      s.filters = -1;
    },
    (s) => {
      s.coils = NaN;
    },
    (s) => {
      s.residents[0].morale = 101;
    },
    (s) => {
      s.residents[0].oxygen = -1;
    },
    (s) => {
      s.residents[0].treated = true;
      s.residents[0].treatedAt = null;
    },
    (s) => {
      s.residents[0].treatedAt = s.elapsed + 1;
    },
    (s) => {
      s.residents[0].alive = false;
    },
    (s) => {
      s.policy = "share";
    },
    (s) => {
      s.nextPolicy = null;
    },
    (s) => {
      s.currentCycle.start = 1;
    },
    (s) => {
      s.currentCycle.index = 1;
    },
    (s) => {
      s.currentCycle.people.seon.oxygenUsed = -1;
    },
    (s) => {
      s.currentCycle.people.ran.food = 0.1;
    },
    (s) => {
      s.currentCycle.people.seon.hungerZero = 301;
    },
    (s) => {
      s.currentCycle.people.hong = null;
    },
    (s) => {
      s.currentCycle.people.fake = { ...s.currentCycle.people.ran };
    },
    (s) => {
      s.currentCycle.people.ran.foodUsed = s.currentCycle.people.ran.food + 1;
    },
    (s) => {
      s.currentCycle.people.seon.seonNeed = 91;
    },
    (s) => {
      s.policyTime.equal = -1;
    },
    (s) => {
      s.policyTime.equal = 1;
    },
    (s) => {
      s.projects.base = { remaining: -1, duration: 30, done: false };
    },
    (s) => {
      s.projects.filter = { remaining: 50, duration: 30, done: false };
    },
    (s) => {
      s.projects.heat = { remaining: 0, duration: 30, done: true };
    },
    (s) => {
      s.soil.phase = "forged";
    },
    (s) => {
      s.soil.observed = NaN;
    },
    (s) => {
      s.soilSettled = true;
    },
    (s) => {
      s.sterilization.remaining = 5;
    },
    (s) => {
      s.deaths = [{ id: "alien", name: "Alien", time: 0, cause: "x" }];
    },
    (s) => {
      s.ledger = [structuredClone(s.currentCycle)];
    },
    (s) => {
      s.job = { type: "search", id: "ship", remaining: 8, duration: 8 };
    },
    (s) => {
      s.job = { type: "base", id: "ship", remaining: 30, duration: 30 };
    },
    (s) => {
      s.job = { type: "soil", id: "plot-0", remaining: 30, duration: 30 };
    },
    (s) => {
      s.job = { type: "care", id: "hong", remaining: 30, duration: 30 };
    },
    (s) => {
      s.job = { type: "search", id: "scrap-0", remaining: -1, duration: 8 };
    },
  ];
  for (const mutate of mutations) {
    const state = newGame();
    mutate(state);
    assert.equal(validateSave(state), false, mutate.toString());
  }
});

test("validation rejects arbitrary JSON values without throwing", () => {
  for (const value of [null, false, 3, "text", [], {}, { version: 3 }])
    assert.equal(validateSave(value), false);
});

test("forged terminal states cannot become settlement records", () => {
  for (const status of ["dead", "settled", "failed", "escaped"]) {
    const state = newGame();
    state.status = status;
    assert.equal(validateSave(state), false);
  }
});

test("paid tower work and soil processing survive reload while active jobs are canceled", () => {
  const storage = memory();
  let state = newGame();
  state.parts = 2;
  state.filters = 2;
  state.coils = 1;
  state.leakFixed = true;
  approach(state, "pump");
  assert.equal(act(state, "pump").ok, true);
  approach(state, "ship");
  assert.equal(act(state, "base").ok, true);
  seconds(state, 10);
  const paid = structuredClone(state.projects.base);
  saveGame(storage, state);
  state = loadGame(storage);
  assert.equal(state.job, null);
  assert.deepEqual(state.projects.base, paid);
  assert.equal(state.parts, 0);
  assert.equal(act(state, "base").ok, true);
  seconds(state, 20);
  for (const action of ["filter", "heat"]) {
    assert.equal(act(state, action).ok, true);
    seconds(state, 30);
  }
  approach(state, "plot-5");
  state.crops[5] = { planted: false, watered: false, growth: 0 };
  assert.equal(act(state, "soil").ok, true);
  seconds(state, 10);
  const soil = structuredClone(state.soil),
    filters = state.filters,
    food = state.food;
  saveGame(storage, state);
  state = loadGame(storage);
  assert.equal(state.job, null);
  assert.deepEqual(state.soil, soil);
  assert.equal(act(state, "soil").ok, true);
  seconds(state, 20);
  assert.equal(state.filters, filters);
  assert.equal(state.food, food);
  assert.equal(state.soil.phase, "water");
  assert.equal(act(state, "soil").ok, true);
  seconds(state, 90);
  assert.equal(state.soilSettled, true);
  saveGame(storage, state);
  assert.deepEqual(loadGame(storage), state);
});

test("search jobs are validated before being canceled on reload", () => {
  const storage = memory(),
    state = newGame();
  approach(state, "scrap-0");
  interact(state);
  seconds(state, 2);
  saveGame(storage, state);
  assert.equal(loadGame(storage).job, null);
  assert.equal(loadGame(storage).kits, 0);
  const raw = JSON.parse(storage.getItem(SAVE_KEY));
  raw.job.id = "ship";
  storage.setItem(SAVE_KEY, JSON.stringify(raw));
  assert.throws(() => loadGame(storage));
});

test("cycle history and treatment timing persist and forged successful history is rejected", () => {
  const storage = memory(),
    state = newGame();
  approach(state, "board");
  state.kits = 1;
  seconds(state, 150);
  assert.equal(act(state, "kit", "seon").ok, true);
  seconds(state, 150);
  assert.equal(state.residents[0].treatedAt, 150);
  assert.ok(Math.abs(state.ledger[0].people.seon.seonNeed - 75) < 1e-5);
  assert.equal(state.cycle, 1);
  assert.equal(state.ledger.length, 1);
  saveGame(storage, state);
  assert.deepEqual(loadGame(storage), state);
  const mutations = [
    (s) => {
      s.ledger[0].end = 299;
    },
    (s) => {
      s.ledger[0].people.seon.seonNeed = 0;
    },
    (s) => {
      s.ledger.push(structuredClone(s.ledger[0]));
    },
    (s) => {
      delete s.ledger[0].people.hong;
    },
    (s) => {
      s.ledger[0].people.ran.food = 0;
      s.ledger[0].rights = true;
      s.ledger[0].rightsMissing = [];
    },
    (s) => {
      s.currentCycle.supplies = [
        {
          time: 0,
          kind: "supplement",
          id: "seon",
          resource: "food",
          amount: 1,
        },
      ];
    },
    (s) => {
      s.currentCycle.supplies = [
        { time: 300, kind: "donate", id: "ran", resource: "oxygen", amount: 5 },
      ];
    },
  ];
  for (const mutate of mutations) {
    const forged = structuredClone(state);
    mutate(forged);
    assert.equal(validateSave(forged), false, mutate.toString());
  }
});

test("a resident death and returning only unused reservations remain valid on reload", () => {
  const storage = memory(),
    state = newGame();
  state.residents[0].health = 0.001;
  tick(state, 1);
  assert.equal(state.residents[0].alive, false);
  saveGame(storage, state);
  assert.deepEqual(loadGame(storage), state);
  seconds(state, 300);
  assert.equal(state.status, "active");
  saveGame(storage, state);
  assert.deepEqual(loadGame(storage), state);
});

test("partial terminal writes preserve death when normal storage writes fail", () => {
  const storage = memory(),
    state = newGame();
  saveGame(storage, state);
  state.health = 0.1;
  state.hunger = 0;
  tick(state, 1);
  const failing = {
    ...storage,
    setItem(key, value) {
      if (key === SAVE_KEY) throw new Error("quota");
      storage.setItem(key, value);
    },
  };
  assert.throws(() => saveGame(failing, state), /quota/);
  assert.equal(loadGame(storage).status, "dead");
});

test("settled loss and excluded terminal records preserve their outcome and defeat stale active saves", () => {
  for (const outcome of ["together", "loss", "excluded"]) {
    const storage = memory(),
      state = newGame();
    state.leakFixed =
      state.pumpFixed =
      state.baseFixed =
      state.filterFixed =
      state.heatFixed =
        true;
    for (const type of ["base", "filter", "heat"])
      state.projects[type] = { remaining: 0, duration: 30, done: true };
    state.soil = { phase: "settled", remaining: 0, observed: 90, settledAt: 0 };
    state.soilSettled = true;
    state.provisions = 8;
    state.food = 100;
    state.kits = 1;
    approach(state, "board");
    assert.equal(act(state, "kit", "seon").ok, true);
    if (outcome === "loss") {
      state.residents[1].health = 0.001;
      tick(state, 1);
    }
    const duration =
      outcome === "excluded" ? 0 : outcome === "loss" ? 899 : 600;
    for (let i = 0; i < duration; i++) {
      if (state.hunger <= 65) act(state, "eat");
      tick(state, 1);
    }
    saveGame(storage, state);
    const stale = storage.getItem(SAVE_KEY);
    assert.equal(act(state, "finish").ok, true);
    assert.equal(state.ending.id, outcome);
    saveGame(storage, state);
    storage.setItem(SAVE_KEY, stale);
    assert.deepEqual(loadGame(storage), state);
    const forged = structuredClone(state);
    forged.ending.survivors = ["unknown"];
    assert.equal(validateSave(forged), false);
  }
});

test("terminal validation rejects inconsistent death metadata without writing either record", () => {
  const original = newGame();
  original.health = 0.1;
  original.hunger = 0;
  tick(original, 1);
  for (const mutate of [
    (s) => {
      s.health = 1;
    },
    (s) => {
      s.deaths.at(-1).time = 0;
    },
    (s) => {
      s.cause = "forged";
    },
    (s) => {
      s.ending.policy = "care";
    },
  ]) {
    const storage = memory(),
      forged = structuredClone(original);
    mutate(forged);
    assert.equal(validateSave(forged), false, mutate.toString());
    assert.throws(() => saveGame(storage, forged));
    assert.equal(storage.getItem(SAVE_KEY), null);
    assert.equal(storage.getItem(TERMINAL_KEY), null);
  }
});
