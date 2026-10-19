import { VERSION } from './game.js';
import { WIDTH, HEIGHT, OBJECTS, PLOTS } from './world.js';

export const SAVE_KEY = 'mars-valley.run.v1';
export const TERMINAL_KEY = 'mars-valley.terminal.v1';
const finite = (n, low, high) => typeof n === 'number' && Number.isFinite(n) && n >= low && n <= high;
const count = n => Number.isInteger(n) && n >= 0 && n <= 1e7;
const listOfNames = xs => Array.isArray(xs) && xs.length <= 3 && xs.every(n => ['선', '홍 선생님', 'DJ'].includes(n));

export function validateSave(s) {
  if (!s || s.version !== VERSION || typeof s.runId !== 'string' || !/^[\da-f-]{36}$/i.test(s.runId)) return false;
  if (!['active', 'dead', 'escaped'].includes(s.status) || !finite(s.elapsed, 0, 1e8)) return false;
  if (!s.position || !finite(s.position.x, 1, WIDTH - 1) || !finite(s.position.y, 1, HEIGHT - 1)) return false;
  if (!['health', 'hunger', 'oxygen'].every(k => finite(s[k], 0, 100))) return false;
  if (!['food', 'parts', 'provisions', 'harvested'].every(k => count(s[k]))) return false;
  if (!finite(s.workerClock, 0, 24)) return false;
  if (!['leakFixed', 'pumpFixed', 'signal', 'engine', 'lifeSupport'].every(k => typeof s[k] === 'boolean')) return false;
  if (![null, 'share', 'ration'].includes(s.policy) || !['pending', 'active', 'saved', 'lost'].includes(s.rescue)) return false;
  if (s.rescueDeadline !== null && !finite(s.rescueDeadline, 0, 1e8)) return false;
  if (s.rescue === 'active' && s.rescueDeadline === null) return false;
  if (!Array.isArray(s.crops) || s.crops.length !== PLOTS.length || !s.crops.every(c =>
    c && typeof c.planted === 'boolean' && typeof c.watered === 'boolean' && finite(c.growth, 0, 90))) return false;
  const people = [['seon', '선'], ['hong', '홍 선생님'], ['dj', 'DJ']];
  if (!Array.isArray(s.residents) || s.residents.length !== 3 || !s.residents.every((r, i) =>
    r && r.id === people[i][0] && r.name === people[i][1] && ['동참', '반대', '유보'].includes(r.stance)
    && typeof r.alive === 'boolean' && typeof r.invited === 'boolean'
    && finite(r.health, 0, 100) && finite(r.hunger, 0, 100) && (r.alive || (!r.invited && r.health === 0)))) return false;
  const scraps = OBJECTS.filter(o => o.type === 'scrap').map(o => o.id);
  if (!Array.isArray(s.searched) || new Set(s.searched).size !== s.searched.length || !s.searched.every(id => scraps.includes(id))) return false;
  if (s.job !== null && !(s.job && scraps.includes(s.job.id) && finite(s.job.remaining, 0, 8))) return false;
  if (typeof s.cause !== 'string' || s.cause.length > 200) return false;
  if (!Array.isArray(s.events) || s.events.length > 12 || !s.events.every(e => e && finite(e.time, 0, s.elapsed)
    && typeof e.text === 'string' && e.text.length <= 500)) return false;
  if (s.status === 'dead' && (s.health !== 0 || !s.cause)) return false;
  if (s.status !== 'dead' && s.health <= 0) return false;
  if (s.status === 'escaped') {
    if (!s.engine || !s.lifeSupport || !s.ending || !['crew', 'stayed', 'lost'].every(k => listOfNames(s.ending[k]))) return false;
  } else if (s.ending !== null) return false;
  return true;
}

function decode(raw) {
  if (!raw || raw.length > 50000) throw new Error('저장 데이터의 크기가 올바르지 않습니다.');
  let state;
  try { state = JSON.parse(raw); } catch { throw new Error('저장 데이터를 읽을 수 없습니다.'); }
  if (!validateSave(state)) throw new Error('저장 버전이나 데이터가 올바르지 않습니다. 새 회차를 선택하면 초기화됩니다.');
  return state;
}

export function loadGame(storage) {
  const raw = storage.getItem(SAVE_KEY);
  if (!raw) return null;
  let state = decode(raw);
  const terminalRaw = storage.getItem(TERMINAL_KEY);
  if (terminalRaw) {
    const terminal = decode(terminalRaw);
    // A terminal record takes precedence even if the normal save failed afterward.
    if (terminal.runId === state.runId && terminal.status !== 'active') state = terminal;
  }
  state.job = null;
  return state;
}

export function saveGame(storage, state) {
  if (!validateSave(state)) throw new Error('게임 상태 검증 실패. 저장하지 않았습니다.');
  const raw = JSON.stringify(state);
  if (state.status !== 'active') storage.setItem(TERMINAL_KEY, raw);
  storage.setItem(SAVE_KEY, raw);
}

export function resetGame(storage, state) {
  if (state.status !== 'active' || state.elapsed !== 0) throw new Error('새 회차만 초기화할 수 있습니다.');
  saveGame(storage, state);
  storage.removeItem(TERMINAL_KEY);
}
