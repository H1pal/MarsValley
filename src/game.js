import { canStand, inLeak, isSafe, nearest, OBJECTS, PLOTS, terrain } from './world.js';

export const VERSION = 1;
export const RULES = Object.freeze({ growth: 90, hunger: 0.12, oxygen: 0.45, rescueAt: 120, rescueWindow: 240 });
const clamp = value => Math.max(0, Math.min(100, value));

export function newGame() {
  return {
    version: VERSION, runId: globalThis.crypto.randomUUID(), status: 'active', elapsed: 0,
    position: { x: 7.5, y: 14.5 }, health: 100, hunger: 75, oxygen: 100,
    food: 6, parts: 0, provisions: 0, harvested: 0, workerClock: 0,
    crops: PLOTS.map((_, i) => ({ planted: i < 4, watered: i < 4, growth: i < 2 ? 90 : 25 })),
    residents: [
      { id: 'seon', name: '선', stance: '동참', hunger: 80, health: 100, alive: true, invited: false },
      { id: 'hong', name: '홍 선생님', stance: '반대', hunger: 80, health: 100, alive: true, invited: false },
      { id: 'dj', name: 'DJ', stance: '유보', hunger: 80, health: 100, alive: true, invited: false },
    ],
    rescue: 'pending', rescueDeadline: null, leakFixed: false, pumpFixed: false, signal: false,
    policy: null, engine: false, lifeSupport: false, searched: [], job: null,
    cause: '', ending: null, events: [{ time: 0, text: '란은 탈출 계획을 공개했다. 선은 동참, 홍 선생님은 반대, DJ는 판단을 유보했다.' }],
  };
}

export function log(state, text) {
  state.events.unshift({ time: state.elapsed, text });
  state.events = state.events.slice(0, 12);
  return text;
}

export function weather(state) {
  const phase = state.elapsed % 300;
  return { storm: phase >= 240, warning: phase >= 210 && phase < 240,
    remaining: Math.ceil(phase >= 240 ? 300 - phase : 240 - phase) };
}

export function move(state, dx, dy, dt) {
  if (state.status !== 'active' || !Number.isFinite(dt) || dt <= 0 || dt > 0.1) return;
  const length = Math.hypot(dx, dy);
  if (!length) return;
  state.job = null;
  const speed = weather(state).storm && !isSafe(state.position) ? 2.4 : 3.4;
  const x = state.position.x + dx / length * speed * dt;
  const y = state.position.y + dy / length * speed * dt;
  if (canStand(x, state.position.y)) state.position.x = x;
  if (canStand(state.position.x, y)) state.position.y = y;
}

function residentDeath(state, resident, reason) {
  resident.alive = false;
  resident.health = 0;
  resident.invited = false;
  log(state, `${resident.name} 사망 — ${reason}`);
}

function work(state) {
  const workers = state.residents.filter(r => r.alive && r.hunger > 15 && !(r.id === 'seon' && state.rescue === 'active'));
  for (let i = 0; i < workers.length; i++) {
    const crop = state.crops.find(c => c.growth >= RULES.growth && c.planted)
      ?? state.crops.find(c => c.planted && !c.watered)
      ?? state.crops.find(c => !c.planted);
    if (crop) tend(state, crop, false);
  }
}

export function tick(state, dt) {
  if (state.status !== 'active' || !Number.isFinite(dt) || dt <= 0 || dt > 1) return;
  state.elapsed += dt;
  state.hunger = clamp(state.hunger - RULES.hunger * dt);
  const safe = isSafe(state.position);
  state.oxygen = clamp(state.oxygen + (safe ? 8 : -RULES.oxygen * (weather(state).storm ? 2 : 1)) * dt);
  let damage = 0, cause = '';
  if (state.hunger === 0) { damage += dt; cause = '굶주림'; }
  if (state.oxygen === 0) { damage += 5 * dt; cause = '산소 고갈'; }
  if (inLeak(state.position) && !state.leakFixed) { damage += 2 * dt; cause = '설비 누출 구역 노출'; }
  state.health = clamp(state.health - damage);
  if (!damage && safe && state.hunger > 50) state.health = clamp(state.health + dt * 0.25);
  if (state.health <= 0) {
    state.status = 'dead'; state.cause = cause; state.job = null;
    log(state, `란 사망 — ${cause}. 이 회차는 종료되었습니다.`);
    return;
  }

  for (const crop of state.crops) {
    if (crop.planted && (crop.watered || state.pumpFixed)) crop.growth = Math.min(RULES.growth, crop.growth + dt);
  }
  for (const resident of state.residents.filter(r => r.alive)) {
    resident.hunger = clamp(resident.hunger - 0.09 * dt);
    const threshold = state.policy === 'ration' ? 20 : 45;
    if (resident.hunger <= threshold && state.food > 0) {
      state.food--; resident.hunger = clamp(resident.hunger + 35);
    }
    if (resident.hunger === 0) resident.health = clamp(resident.health - dt);
    if (resident.health === 0) residentDeath(state, resident, '식량 부족');
  }
  if (state.rescue === 'pending' && state.elapsed >= RULES.rescueAt) {
    const seon = state.residents.find(r => r.id === 'seon');
    if (seon.alive) {
      state.rescue = 'active'; state.rescueDeadline = state.elapsed + RULES.rescueWindow;
      log(state, '긴급 무전: 설비 구역에서 선의 산소 장치 고장. 4분 안에 수리하거나 대피를 도와야 한다.');
    } else state.rescue = 'lost';
  }
  if (state.rescue === 'active' && state.elapsed >= state.rescueDeadline) {
    const seon = state.residents.find(r => r.id === 'seon');
    if (seon.alive) residentDeath(state, seon, '산소 장치 고장 후 구조 지연');
    state.rescue = 'lost';
  }
  state.workerClock += dt;
  if (state.workerClock >= 24) { state.workerClock -= 24; work(state); }
  if (state.job) {
    const object = OBJECTS.find(o => o.id === state.job.id);
    if (!object || Math.hypot(object.x - state.position.x, object.y - state.position.y) > 1.6) state.job = null;
    else {
      state.job.remaining -= dt;
      if (state.job.remaining <= 0) {
        if (!state.searched.includes(object.id)) {
          state.searched.push(object.id); state.parts += 4;
          log(state, '캡슐 잔해 수색 완료. 부품 4개를 회수했다.');
        }
        state.job = null;
      }
    }
  }
}

function tend(state, crop, announce = true) {
  let message;
  if (!crop.planted) {
    crop.planted = true; crop.watered = state.pumpFixed; crop.growth = 0;
    message = '감자를 심었다. 급수하면 90초 후 수확할 수 있다.';
  } else if (crop.growth >= RULES.growth) {
    state.food += 3; state.harvested += 3;
    crop.planted = false; crop.watered = false; crop.growth = 0;
    message = '감자 수확. 공동 식량 +3';
  } else if (!crop.watered) {
    crop.watered = true; message = '물을 주었다. 탐험하는 동안 작물이 자란다.';
  } else message = `수확까지 ${Math.ceil(RULES.growth - crop.growth)}초. 주민들도 작물을 돌봅니다.`;
  return announce ? log(state, message) : message;
}

export function interact(state) {
  if (state.status !== 'active') return null;
  const target = nearest(state);
  if (!target) return { message: '대상 가까이 이동하세요.' };
  switch (target.type) {
    case 'plot': return { message: tend(state, state.crops[Number(target.id.split('-')[1])]) };
    case 'scrap':
      if (state.searched.includes(target.id)) return { message: '이미 수색한 잔해입니다.' };
      state.job = { id: target.id, remaining: 8 };
      return { message: '수색 중 · 8초. 이동하면 취소됩니다.' };
    case 'valve':
      state.leakFixed = true;
      return { message: log(state, '밸브 차단 완료. 붉은 누출 구역이 안전해졌다.') };
    case 'signal':
      state.signal = true;
      return { message: log(state, '불완전한 외부 신호를 확보했다. 누군가 살아 있다는 보장은 없다. DJ와 이야기해 보자.') };
    default: state.job = null; return { dialog: target };
  }
}

export function canInvite(state, resident) {
  if (!resident.alive) return '사망한 주민입니다.';
  if (resident.id === 'seon' && state.rescue === 'active') return '먼저 선을 구조해야 합니다.';
  if (resident.id === 'hong' && !(state.pumpFixed && state.policy === 'share')) return '홍 선생님: 급수를 복구하고 공동 식사를 우선하겠다는 합의가 필요해요.';
  if (resident.id === 'dj' && !state.signal) return 'DJ: 북동쪽 통신기에서 신호의 단서를 가져와 주세요.';
  return null;
}

export function launchRequirements(state) {
  const crew = state.residents.filter(r => r.alive && r.invited);
  const needed = (1 + crew.length) * 2;
  const missing = [];
  if (!state.engine) missing.push('추진 장치 복구');
  if (!state.lifeSupport) missing.push('생명 유지 장치 복구');
  if (state.provisions < needed) missing.push(`보존식 ${needed - state.provisions}개 추가`);
  if (crew.some(r => r.id === 'seon') && state.rescue === 'active') missing.push('선 구조');
  return { crew, needed, missing };
}

// Every costly action validates before mutating. UI disables are only hints.
export function act(state, action, value) {
  if (state.status !== 'active') return { ok: false, message: '종료된 회차입니다.' };
  const target = nearest(state);
  const requires = { policy: 'board', reserve: 'board', returnFood: 'board', pump: 'pump', engine: 'ship', lifeSupport: 'ship', launch: 'ship', invite: 'resident', rescue: 'resident' };
  if (requires[action] && target?.type !== requires[action]) return { ok: false, message: '해당 시설이나 주민 가까이 이동하세요.' };
  const fail = message => ({ ok: false, message });
  let message;
  switch (action) {
    case 'eat':
      if (state.food < 1) return fail('공동 식량이 없습니다. 온실에서 수확하세요.');
      if (state.hunger > 85) return fail('아직 충분히 배부릅니다. 식량을 아껴두세요.');
      state.food--; state.hunger = clamp(state.hunger + 35); message = '공동 식량으로 식사했다. 허기 +35'; break;
    case 'policy':
      if (!['share', 'ration'].includes(value)) return fail('알 수 없는 제안입니다.');
      // A bounded authored discussion: opinions and consent are shown before this action.
      state.policy = value;
      message = value === 'share' ? '공동 식사 우선에 합의했다. 비축 전 생존 주민당 식량 2개를 남긴다.' : '균등 절약에 합의했다. 식사를 늦추고 비축 전 생존 주민당 식량 1개를 남긴다.';
      break;
    case 'reserve': {
      if (!state.policy) return fail('먼저 주민들과 식량 배분을 논의하세요.');
      const floor = state.residents.filter(r => r.alive).length * (state.policy === 'share' ? 2 : 1);
      if (state.food - 2 < floor) return fail(`합의한 공동 식량 ${floor}개를 남겨야 합니다. 수확 후 다시 시도하세요.`);
      state.food -= 2; state.provisions += 2; message = '공동 식량 2개를 항해용 보존식으로 만들었다.'; break;
    }
    case 'returnFood':
      if (state.provisions < 2) return fail('돌려놓을 보존식이 없습니다.');
      state.provisions -= 2; state.food += 2; message = '보존식 2개를 공동 식량으로 돌려놓았다.'; break;
    case 'pump': case 'engine': case 'lifeSupport': {
      const property = action === 'pump' ? 'pumpFixed' : action;
      if (state[property]) return fail('이미 복구했습니다.');
      const cost = action === 'pump' ? 2 : 4;
      if (state.parts < cost) return fail(`부품 ${cost}개가 필요합니다.`);
      state.parts -= cost; state[property] = true;
      message = { pump: '자동 급수 복구. 주민들의 농사 부담이 줄었다.', engine: '추진 장치 복구 완료.', lifeSupport: '생명 유지 장치 복구 완료.' }[action]; break;
    }
    case 'rescue': {
      if (target.id !== 'seon' || state.rescue !== 'active') return fail('지금 구조할 대상이 없습니다.');
      if (!['repair', 'evacuate'].includes(value)) return fail('구조 방법을 선택하세요.');
      if (value === 'repair' && state.parts < 2) return fail('수리에 부품 2개가 필요합니다. 대피 지원도 가능합니다.');
      if (value === 'repair') state.parts -= 2;
      else {
        if (state.oxygen < 25) return fail('대피를 돕기 위해 산소 25 이상이 필요합니다. 가까운 대피소에서 충전하세요.');
        state.oxygen -= 20;
      }
      state.rescue = 'saved';
      message = value === 'repair' ? '선의 산소 장치를 수리했다. 선은 온실로 귀환했다.' : '산소를 나누고 선의 대피를 도왔다. 선은 온실로 귀환했다.';
      break;
    }
    case 'invite': {
      const resident = state.residents.find(r => r.id === value);
      if (!resident || target.id !== value) return fail('해당 주민 가까이 이동하세요.');
      if (!resident.invited) {
        const reason = canInvite(state, resident);
        if (reason) return fail(reason);
      }
      resident.invited = !resident.invited;
      message = `${resident.name}${resident.invited ? '과 동행하기로 했다.' : '의 동행을 취소했다. 이번에는 화성에 남는다.'}`; break;
    }
    case 'launch': {
      const requirements = launchRequirements(state);
      if (requirements.missing.length) return fail(requirements.missing.join(' · '));
      state.provisions -= requirements.needed; state.status = 'escaped'; state.job = null;
      state.ending = { crew: requirements.crew.map(r => r.name), stayed: state.residents.filter(r => r.alive && !r.invited).map(r => r.name), lost: state.residents.filter(r => !r.alive).map(r => r.name) };
      message = '화성을 떠났다. 저 너머의 생존은 아직 알 수 없다.'; break;
    }
    default: return fail('알 수 없는 행동입니다.');
  }
  return { ok: true, message: log(state, message) };
}

export function locationName(state) {
  const tile = terrain(state.position.x, state.position.y);
  return { greenhouse: '공동 온실', shelter: '산소 대피소', facility: '폐쇄 설비 구역', pad: '외곽 발사대' }[tile] ?? '캡슐 잔해 지대';
}
