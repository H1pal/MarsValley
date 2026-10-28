import { VERSION, settlementRequirements } from './game.js';
import { WIDTH, HEIGHT, OBJECTS, PLOTS } from './world.js';

export const SAVE_KEY = 'mars-valley.run.v3';
export const TERMINAL_KEY = 'mars-valley.terminal.v3';
const IDS = ['ran', 'seon', 'hong', 'dj'];
const PEOPLE = [['seon', '선'], ['hong', '홍 선생님'], ['dj', 'DJ']];
const POLICIES = ['contribution', 'equal', 'care'];
const MAX_BYTES = 5 * 1024 * 1024;
const SCRAPS = OBJECTS.filter(o => o.type === 'scrap').map(o => o.id);
const finite = (n, low = 0, high = 1e8) => typeof n === 'number' && Number.isFinite(n) && n >= low && n <= high;
const count = (n, high = 1e7) => Number.isInteger(n) && finite(n, 0, high);
const meals = n => finite(n, 0, 1e7) && Number.isInteger(n * 4);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, limit = 200) => typeof value === 'string' && value.length <= limit;
const bools = (value, keys) => keys.every(key => typeof value[key] === 'boolean');
const keys = (value, expected) => record(value) && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const dense = values => Array.isArray(values) && Object.keys(values).length === values.length;
const unique = values => new Set(values).size === values.length;
const close = (a, b) => Math.abs(a - b) < 1e-5;

export function validateSave(s) {
  if (!record(s) || s.version !== VERSION || VERSION !== 3 || typeof s.runId !== 'string' || !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(s.runId)) return false;
  if (!['active', 'dead', 'settled', 'failed'].includes(s.status) || !finite(s.elapsed)) return false;
  if (!record(s.position) || !finite(s.position.x, 1, WIDTH - 1) || !finite(s.position.y, 1, HEIGHT - 1)) return false;
  if (!['health', 'hunger', 'oxygen'].every(k => finite(s[k], 0, 100))) return false;
  if (!['food', 'provisions', 'harvested'].every(k => meals(s[k]))) return false;
  if (!count(s.parts, 2) || !count(s.filters, 2) || !count(s.coils, 1) || !count(s.kits, 1) || !finite(s.oxygenStock, 0, 600)) return false;
  if (!bools(s, ['leakFixed', 'pumpFixed', 'signal', 'baseFixed', 'filterFixed', 'heatFixed', 'soilSettled', 'past', 'injuryWarned'])) return false;
  if (!POLICIES.includes(s.policy) || !POLICIES.includes(s.nextPolicy) || !count(s.cycle, 10000) || !Number.isInteger(s.meetingWarned) || s.meetingWarned < -1 || s.meetingWarned > s.cycle) return false;
  if (!keys(s.policyTime, POLICIES) || !POLICIES.every(k => finite(s.policyTime[k], 0, s.elapsed)) || !close(Object.values(s.policyTime).reduce((a, b) => a + b, 0), s.elapsed)) return false;
  if (!keys(s.rations, IDS) || !IDS.every(id => keys(s.rations[id], ['food', 'oxygen']) && meals(s.rations[id].food) && finite(s.rations[id].oxygen, 0, 600))) return false;
  if (s.oxygenStock + IDS.reduce((sum, id) => sum + s.rations[id].oxygen, 0) > 600 + 1e-5) return false;
  if (!dense(s.crops) || s.crops.length !== PLOTS.length || !s.crops.every(c => record(c) && bools(c, ['planted', 'watered']) && finite(c.growth, 0, 360) && (c.planted || (!c.watered && c.growth === 0)))) return false;
  if (!dense(s.residents) || s.residents.length !== PEOPLE.length || !s.residents.every((r, i) => {
    if (!record(r) || r.id !== PEOPLE[i][0] || r.name !== PEOPLE[i][1] || !bools(r, ['alive', 'treated'])) return false;
    if (!['health', 'hunger', 'oxygen', 'morale'].every(k => finite(r[k], 0, 100)) || r.alive !== (r.health > 0)) return false;
    if ((r.treated && !finite(r.treatedAt, 0, s.elapsed)) || (!r.treated && r.treatedAt !== null)) return false;
    if (!finite(r.careUntil, 0, s.elapsed + 300) || !Number.isInteger(r.careCycle) || r.careCycle < -1 || r.careCycle > s.cycle || !finite(r.workerClock, 0, 60)) return false;
    return r.id === 'seon' || (r.careUntil === 0 && r.careCycle === -1 && (r.id === 'hong' || (!r.treated && r.treatedAt === null)));
  })) return false;
  if (!dense(s.searched) || s.searched.length > SCRAPS.length || !unique(s.searched) || !s.searched.every(id => SCRAPS.includes(id))) return false;
  if (!keys(s.projects, ['base', 'filter', 'heat']) || !['base', 'filter', 'heat'].every(type => {
    const project = s.projects[type], fixed = s[`${type}Fixed`];
    return project === null ? !fixed : record(project) && typeof project.done === 'boolean' && [30, 45, 60].includes(project.duration)
      && finite(project.remaining, 0, project.duration) && project.done === (project.remaining < 1e-8) && fixed === project.done;
  })) return false;
  if ((s.projects.base && !s.leakFixed) || ((s.projects.filter || s.projects.heat) && !s.baseFixed)) return false;
  if (!validSoil(s) || !record(s.sterilization) || !finite(s.sterilization.until, 0, s.elapsed + 600) || !count(s.sterilization.remaining, 4)) return false;
  if (!validDeaths(s)) return false;
  if (!validCycle(s.currentCycle, s, false) || s.currentCycle.index !== s.cycle || s.currentCycle.policy !== s.policy || !close(s.currentCycle.start, s.cycle * 300)) return false;
  if (!dense(s.ledger) || s.ledger.length !== s.cycle || s.ledger.length > 10000 || !s.ledger.every((cycle, i) => validCycle(cycle, s, true) && cycle.index === i)) return false;
  if (!validJob(s)) return false;
  if (!text(s.cause) || !dense(s.events) || s.events.length > 12 || !s.events.every(e => record(e) && finite(e.time, 0, s.elapsed) && text(e.text, 500))) return false;
  if (s.status === 'active') return s.health > 0 && s.ending === null;
  return validEnding(s);
}

function validSoil(s) {
  const soil = s.soil;
  if (!record(soil) || !['idle', 'processing', 'water', 'observing', 'settled'].includes(soil.phase) || !finite(soil.remaining, 0, 30) || !finite(soil.observed, 0, 90)) return false;
  if (s.soilSettled !== (soil.phase === 'settled')) return false;
  if (soil.phase === 'settled') return soil.remaining === 0 && close(soil.observed, 90) && finite(soil.settledAt, 0, s.elapsed);
  if (soil.settledAt !== null || (soil.phase !== 'idle' && !(s.leakFixed && s.pumpFixed && s.baseFixed && s.filterFixed && s.heatFixed))) return false;
  if (soil.phase === 'idle') return soil.remaining === 0 && soil.observed === 0;
  if (soil.phase === 'processing') return soil.remaining > 0 && soil.observed === 0;
  return soil.remaining === 0 && (soil.phase !== 'water' || soil.observed === 0);
}

function validCycle(cycle, s, complete) {
  if (!record(cycle) || !count(cycle.index, 10000) || !finite(cycle.start, 0, s.elapsed) || !close(cycle.start, cycle.index * 300)
    || !POLICIES.includes(cycle.policy) || typeof cycle.broadcast !== 'boolean' || !record(cycle.people)) return false;
  const duration = complete ? 300 : s.elapsed - cycle.start;
  if (!finite(duration, 0, 300 + 1e-5) || !Object.hasOwn(cycle.people, 'ran') || Object.keys(cycle.people).length > 4) return false;
  if (!Object.entries(cycle.people).every(([id, p]) => IDS.includes(id) && record(p)
    && ['food', 'foodUsed'].every(k => meals(p[k])) && finite(p.oxygen, 0, 1e7) && finite(p.oxygenUsed, 0, p.oxygen + 1e-5)
    && p.foodUsed <= p.food && finite(p.hungerZero, 0, duration + 1e-5) && finite(p.oxygenZero, 0, duration + 1e-5)
    && finite(p.seonNeed, 0, id === 'seon' ? duration * 0.3 + 1e-5 : 0) && bools(p, ['care', 'treated', 'dead']))) return false;
  const end = complete ? cycle.start + 300 : s.elapsed;
  if (!IDS.every(id => {
    const death = s.deaths.find(d => d.id === id), p = cycle.people[id];
    const present = !death || death.time > cycle.start;
    return present === Object.hasOwn(cycle.people, id) && (!p || p.dead === (!!death && death.time <= end));
  })) return false;
  if (cycle.people.seon) {
    const seon = s.residents[0], death = s.deaths.find(d => d.id === 'seon');
    const until = Math.min(end, death?.time ?? end), duration = Math.max(0, until - cycle.start);
    const untreated = Math.max(0, Math.min(until, seon.treatedAt ?? until) - cycle.start);
    const need = untreated * 0.3 + (duration - untreated) * 0.2, actual = cycle.people.seon.seonNeed;
    // Ran's fatal tick returns before residents consume their final fraction of a second.
    if (!complete && s.status === 'dead' && !death) {
      if (actual > need + 1e-5 || actual < need - 0.3 - 1e-5) return false;
    } else if (!close(actual, need)) return false;
    const treated = seon.treated && (complete ? seon.treatedAt < end : seon.treatedAt <= end);
    if (cycle.people.seon.treated !== treated) return false;
  }
  if (cycle.supplies !== undefined && (!dense(cycle.supplies) || cycle.supplies.length > 10000 || !cycle.supplies.every(entry => record(entry)
    && finite(entry.time, cycle.start, end) && ['supplement', 'donate'].includes(entry.kind) && Object.hasOwn(cycle.people, entry.id)
    && (entry.kind !== 'donate' || entry.id !== 'ran') && ['food', 'oxygen'].includes(entry.resource)
    && entry.amount > 0 && (entry.resource === 'food' ? meals(entry.amount) : finite(entry.amount, 0, 600) && Number.isInteger(entry.amount / 5))))) return false;
  if (complete) {
    const rights = Object.entries(cycle.people).every(([id, p]) => p.food >= 1 - 1e-8 && p.oxygen >= (id === 'seon' ? p.seonNeed : 60) - 1e-7
      && p.hungerZero < 30 - 1e-8 && p.oxygenZero < 10 - 1e-8 && !p.dead && (id !== 'seon' || p.treated || p.care));
    return finite(cycle.end, 0, s.elapsed) && close(cycle.end, end) && cycle.rights === rights
      && dense(cycle.rightsMissing) && cycle.rightsMissing.length <= 24 && cycle.rightsMissing.every(t => text(t, 500)) && cycle.rights === (cycle.rightsMissing.length === 0);
  }
  return IDS.every(id => {
    const resident = s.residents.find(r => r.id === id), p = cycle.people[id];
    if ((!resident || resident.alive) && !p) return false;
    if (!p) return s.rations[id].food === 0 && s.rations[id].oxygen === 0;
    return p.dead === (id === 'ran' ? s.status === 'dead' : !resident.alive)
      && close(p.food - p.foodUsed, s.rations[id].food) && close(p.oxygen - p.oxygenUsed, s.rations[id].oxygen);
  });
}

function validDeaths(s) {
  if (!dense(s.deaths) || s.deaths.length > 4 || !unique(s.deaths.map(d => d?.id))) return false;
  if (!s.deaths.every(d => record(d) && [['ran', '란'], ...PEOPLE].some(([id, name]) => d.id === id && d.name === name)
    && finite(d.time, 0, s.elapsed) && text(d.cause) && d.cause.length > 0)) return false;
  return s.residents.every(r => r.alive !== s.deaths.some(d => d.id === r.id)) && (s.status === 'dead') === s.deaths.some(d => d.id === 'ran');
}

function validJob(s) {
  const job = s.job;
  if (job === null) return true;
  if (s.status !== 'active' || !record(job) || !finite(job.remaining, 0, job.duration) || job.remaining === 0) return false;
  if (job.type === 'search') return SCRAPS.includes(job.id) && !s.searched.includes(job.id) && job.duration === 8;
  if (job.type === 'care') return job.id === 'seon' && job.duration === 30 && s.residents[0].alive && !s.residents[0].treated;
  if (job.type === 'soil') return job.id === 'plot-5' && job.duration === 30 && s.soil.phase === 'processing' && close(job.remaining, s.soil.remaining);
  const project = s.projects[job.type];
  return ['base', 'filter', 'heat'].includes(job.type) && job.id === 'ship' && record(project) && !project.done
    && job.duration === project.duration && close(job.remaining, project.remaining);
}

function validEnding(s) {
  const ending = s.ending, alive = s.residents.filter(r => r.alive).map(r => r.name), lost = s.residents.filter(r => !r.alive).map(r => r.name);
  if (!record(ending) || !text(ending.title) || !ending.title || typeof ending.rights !== 'boolean' || typeof ending.extraSupply !== 'boolean'
    || ![...POLICIES, 'mixed'].includes(ending.policy) || !['survivors', 'lost'].every(k => dense(ending[k]) && unique(ending[k]))) return false;
  if (ending.survivors.length !== alive.length || !ending.survivors.every(name => alive.includes(name)) || ending.lost.length !== lost.length || !ending.lost.every(name => lost.includes(name)) || s.job !== null) return false;
  const dominant = POLICIES.find(policy => s.policyTime[policy] > s.elapsed / 2) ?? 'mixed';
  if (ending.policy !== dominant || ending.extraSupply !== [...s.ledger, s.currentCycle].some(c => !!c.supplies?.length)) return false;
  if (s.status === 'dead') {
    const death = s.deaths.find(d => d.id === 'ran');
    return s.health === 0 && !!s.cause && death.time === s.elapsed && death.cause === s.cause && ending.id === 'dead' && !ending.rights;
  }
  if (s.health <= 0 || !(s.leakFixed && s.pumpFixed && s.baseFixed && s.filterFixed && s.heatFixed && s.soilSettled && s.provisions >= 8)) return false;
  if (ending.rights !== settlementRequirements(s).rights) return false;
  if (s.status === 'settled') return ending.rights && ((ending.id === 'together' && alive.length === 3) || (ending.id === 'loss' && alive.length > 0 && alive.length < 3));
  return ending.id === 'excluded' && (!ending.rights || alive.length === 0);
}

function decode(raw) {
  if (!raw || raw.length > MAX_BYTES) throw new Error('저장 데이터의 크기가 올바르지 않습니다.');
  let state;
  try { state = JSON.parse(raw); } catch { throw new Error('저장 데이터를 읽을 수 없습니다.'); }
  if (!validateSave(state)) throw new Error('저장 버전이나 데이터가 올바르지 않습니다. 새 회차를 선택하면 초기화됩니다.');
  return state;
}

export function hasLegacyGame(storage) {
  return storage.getItem('mars-valley.run.v1') !== null || storage.getItem('mars-valley.terminal.v1') !== null;
}

export function loadGame(storage) {
  const raw = storage.getItem(SAVE_KEY), terminalRaw = storage.getItem(TERMINAL_KEY);
  if (raw === null && terminalRaw === null) return null;
  let state = raw === null ? null : decode(raw);
  if (terminalRaw !== null) {
    const terminal = decode(terminalRaw);
    if (terminal.status === 'active') throw new Error('종료 기록이 올바르지 않습니다.');
    // Terminal-first writes survive a failed ordinary save without resurrecting the run.
    if (!state || terminal.runId === state.runId) state = terminal;
  }
  state.job = null;
  return state;
}

export function saveGame(storage, state) {
  if (!validateSave(state)) throw new Error('게임 상태 검증 실패. 저장하지 않았습니다.');
  const raw = JSON.stringify(state);
  if (raw.length > MAX_BYTES) throw new Error('저장 데이터의 크기가 올바르지 않습니다.');
  if (state.status !== 'active') storage.setItem(TERMINAL_KEY, raw);
  storage.setItem(SAVE_KEY, raw);
}

export function resetGame(storage, state) {
  if (state.status !== 'active' || state.elapsed !== 0) throw new Error('새 회차만 초기화할 수 있습니다.');
  saveGame(storage, state);
  storage.removeItem(TERMINAL_KEY);
}
