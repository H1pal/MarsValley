import { canStand, inLeak, isSafe, nearest, OBJECTS, PLOTS, terrain, SPAWN, REGIONS, contains, residentPosition } from './world.js';

export const VERSION = 3;
export const RULES = Object.freeze({ growth: 360, settledGrowth: 90, hunger: 0.12, oxygen: 0.45, cycle: 300 });
export const POLICIES = Object.freeze({
  contribution: { name: '기여도 중심', food: { ran: 1.25, hong: 1.25, dj: 0.25, seon: 0.25 }, oxygen: { ran: 150, hong: 90, dj: 45, seon: 15 }, work: 1.25, morale: { seon: -12, hong: 6, dj: -8 } },
  equal: { name: '완전 균등', food: { ran: 1, hong: 1, dj: 1, seon: 1 }, oxygen: { ran: 100, hong: 100, dj: 100, seon: 100 }, work: 0.8, morale: { seon: 2, hong: -2, dj: 4 } },
  care: { name: '취약자 우선', food: { ran: 1, hong: 1, dj: 1, seon: 2 }, oxygen: { ran: 80, hong: 80, dj: 80, seon: 120 }, work: 0.8, morale: { seon: 8, hong: -8, dj: 6 } },
});
const IDS = ['ran', 'hong', 'dj', 'seon'];
const NAMES = { ran: '란', hong: '홍 선생님', dj: 'DJ', seon: '선' };
const clamp = value => Math.max(0, Math.min(100, value));
const sum = values => Object.values(values).reduce((a, b) => a + b, 0);
const living = state => IDS.filter(id => id === 'ran' || state.residents.find(r => r.id === id).alive);
const person = (state, id) => id === 'ran' ? state : state.residents.find(r => r.id === id);
const oxygenRate = resident => resident.id === 'seon' && !resident.treated ? 0.3 : 0.2;
const storedOxygen = state => state.oxygenStock + sum(Object.fromEntries(IDS.map(id => [id, state.rations[id].oxygen])));
const growthTime = state => state.soilSettled ? RULES.settledGrowth : RULES.growth;

export function newGame() {
  const state = {
    version: VERSION, runId: globalThis.crypto.randomUUID(), status: 'active', elapsed: 0,
    position: { ...SPAWN }, health: 100, hunger: 75, oxygen: 100,
    food: 6, oxygenStock: 600, parts: 0, filters: 0, coils: 0, kits: 0, provisions: 0, harvested: 0,
    crops: PLOTS.map((_, i) => ({ planted: i < 4, watered: i < 4, growth: i < 2 ? 360 : i < 4 ? 25 : 0 })),
    residents: [
      { id: 'seon', name: '선', health: 65, hunger: 65, oxygen: 60, morale: 45 },
      { id: 'hong', name: '홍 선생님', health: 45, hunger: 70, oxygen: 80, morale: 55 },
      { id: 'dj', name: 'DJ', health: 85, hunger: 70, oxygen: 80, morale: 65 },
    ].map(r => ({ ...r, alive: true, treated: false, treatedAt: null, careUntil: 0, careCycle: -1, workerClock: 0 })),
    rations: Object.fromEntries(IDS.map(id => [id, { food: 0, oxygen: 0 }])),
    policy: 'equal', nextPolicy: 'equal', cycle: 0, currentCycle: null, ledger: [], deaths: [],
    policyTime: { contribution: 0, equal: 0, care: 0 },
    leakFixed: false, pumpFixed: false, signal: false, baseFixed: false, filterFixed: false, heatFixed: false,
    projects: { base: null, filter: null, heat: null },
    soil: { phase: 'idle', remaining: 0, observed: 0, settledAt: null }, soilSettled: false,
    sterilization: { until: 0, remaining: 0 }, past: false, injuryWarned: false, meetingWarned: -1,
    searched: [], job: null, cause: '', ending: null,
    events: [{ time: 0, text: '네 사람의 첫 겨울. 임시 균등 배급은 300초마다 갱신되며, 필요한 양과 받은 양을 함께 기록한다.' }],
  };
  beginCycle(state);
  return state;
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

// Largest remainders allocate only existing stock; rotating ties share scarce quarters over time.
function allocate(stock, targets, unit, cycle) {
  const ids = Object.keys(targets), result = Object.fromEntries(ids.map(id => [id, 0]));
  const total = sum(targets), available = Math.min(Math.floor((stock + 1e-8) / unit), Math.round(total / unit));
  if (!total || !available) return result;
  const shares = ids.map(id => ({ id, raw: available * targets[id] / total }));
  for (const share of shares) result[share.id] = Math.floor(share.raw + 1e-10) * unit;
  const left = available - Math.round(sum(result) / unit);
  const tieOrder = IDS.slice(cycle % IDS.length).concat(IDS.slice(0, cycle % IDS.length));
  shares.sort((a, b) => (b.raw % 1) - (a.raw % 1) || tieOrder.indexOf(a.id) - tieOrder.indexOf(b.id));
  for (let i = 0; i < left; i++) result[shares[i].id] += unit;
  return result;
}

export function policyPreview(state, id) {
  const policy = POLICIES[id];
  if (!policy) return null;
  const ids = living(state);
  const targets = resource => Object.fromEntries(ids.map(key => [key, policy[resource][key]]));
  const foodTargets = targets('food'), oxygenTargets = targets('oxygen');
  const foodStock = state.food + IDS.reduce((n, key) => n + state.rations[key].food, 0);
  const food = allocate(foodStock, foodTargets, 0.25, state.cycle + 1);
  const oxygen = allocate(storedOxygen(state), oxygenTargets, 1, state.cycle + 1);
  const cost = { food: sum(foodTargets), oxygen: sum(oxygenTargets) };
  return { id, name: policy.name, food, oxygen, cost,
    shortage: { food: Math.max(0, cost.food - foodStock), oxygen: Math.max(0, cost.oxygen - storedOxygen(state)) },
    people: ids.map(key => {
      const p = person(state, key), rate = key === 'ran' ? RULES.oxygen * (weather(state).storm ? 2 : 1) : oxygenRate(p);
      return { id: key, name: NAMES[key], target: { food: foodTargets[key], oxygen: oxygenTargets[key] },
        allocated: { food: food[key], oxygen: oxygen[key] }, need: { food: 1, oxygen: key === 'seon' ? rate * 300 : 60 },
        exhaustion: { food: p.hunger / (key === 'ran' ? RULES.hunger : 0.09) + food[key] * 35 / (key === 'ran' ? RULES.hunger : 0.09), oxygen: (p.oxygen + oxygen[key]) / rate } };
    }) };
}

function beginCycle(state) {
  for (const id of IDS) {
    state.food += state.rations[id].food;
    state.oxygenStock += state.rations[id].oxygen;
    state.rations[id] = { food: 0, oxygen: 0 };
  }
  state.policy = state.nextPolicy;
  const ids = living(state), policy = POLICIES[state.policy];
  const food = allocate(state.food, Object.fromEntries(ids.map(id => [id, policy.food[id]])), 0.25, state.cycle);
  const oxygen = allocate(state.oxygenStock, Object.fromEntries(ids.map(id => [id, policy.oxygen[id]])), 1, state.cycle);
  state.food = Math.max(0, state.food - sum(food)); state.oxygenStock = Math.max(0, state.oxygenStock - sum(oxygen));
  state.currentCycle = { index: state.cycle, start: state.elapsed, policy: state.policy, broadcast: false,
    people: Object.fromEntries(ids.map(id => [id, { food: food[id], oxygen: oxygen[id], foodUsed: 0, oxygenUsed: 0, hungerZero: 0, oxygenZero: 0,
      seonNeed: 0, care: false, treated: id === 'seon' && person(state, id).treated, dead: false }])) };
  for (const id of ids) state.rations[id] = { food: food[id], oxygen: oxygen[id] };
  const deficient = ids.filter(id => food[id] < 1 || oxygen[id] < (id === 'seon' && !person(state, id).treated ? 90 : 60));
  if (deficient.length) log(state, `이번 배급 부족: ${deficient.map(id => NAMES[id]).join(' · ')}. 추가 배급과 양도로 실제 부족을 보충할 수 있다.`);
}

function rightsFor(state, cycle, current = false) {
  const missing = [];
  for (const [id, p] of Object.entries(cycle.people)) {
    let need = id === 'seon' ? p.seonNeed : 60;
    if (current && id === 'seon') need += Math.max(0, cycle.start + 300 - state.elapsed) * oxygenRate(person(state, id));
    if (p.food < 1 - 1e-8) missing.push(`${NAMES[id]} 식량 1식 미달`);
    if (p.oxygen < need - 1e-7) missing.push(`${NAMES[id]} 산소 ${Math.ceil(need)} 미달`);
    if (p.hungerZero >= 30 - 1e-8) missing.push(`${NAMES[id]} 굶주림 30초`);
    if (p.oxygenZero >= 10 - 1e-8) missing.push(`${NAMES[id]} 무산소 10초`);
    if (p.dead) missing.push(`${NAMES[id]} 해당 주기 사망`);
    if (id === 'seon' && !(current ? person(state,id).treated || person(state,id).careUntil > state.elapsed : p.treated || p.care)) missing.push('선 상처 돌봄 미제공');
  }
  return { ok: !missing.length, missing };
}

function completeCycle(state) {
  const cycle = state.currentCycle, check = rightsFor(state, cycle);
  state.ledger.push({ ...structuredClone(cycle), end: state.elapsed, rights: check.ok, rightsMissing: check.missing });
  for (const resident of state.residents.filter(r => r.alive)) {
    const p = cycle.people[resident.id];
    const delta = POLICIES[cycle.policy].morale[resident.id] - (p.hungerZero >= 30 ? 4 : 0) - (p.oxygenZero >= 10 ? 4 : 0);
    resident.morale = clamp(resident.morale + Math.max(-20, Math.min(10, delta)));
  }
  state.cycle++;
  beginCycle(state);
}

function ending(state, id) {
  const titles = { dead: '꺼진 개인등', together: '같은 겨울의 네 사람', loss: '빈자리와 첫 흙', excluded: '켜진 타워, 닫힌 몫' };
  const dominant = Object.keys(state.policyTime).find(key => state.policyTime[key] > state.elapsed / 2) ?? 'mixed';
  state.ending = { id, title: titles[id], survivors: state.residents.filter(r => r.alive).map(r => r.name),
    lost: state.residents.filter(r => !r.alive).map(r => r.name), rights: id !== 'dead' && settlementRequirements(state).rights, policy: dominant,
    extraSupply: [...state.ledger, state.currentCycle].some(c => c.supplies?.length) };
  state.status = id === 'dead' ? 'dead' : id === 'excluded' ? 'failed' : 'settled';
  state.job = null;
}

function residentDeath(state, resident, cause) {
  resident.alive = false; resident.health = 0;
  state.deaths.push({ id: resident.id, name: resident.name, time: state.elapsed, cause });
  state.currentCycle.people[resident.id].dead = true;
  // An unused dead resident's reservation returns once, never by removing their history.
  for (const resource of ['food', 'oxygen']) {
    const amount = state.rations[resident.id][resource];
    state[resource === 'food' ? 'food' : 'oxygenStock'] += amount;
    state.currentCycle.people[resident.id][resource] -= amount;
    state.rations[resident.id][resource] = 0;
  }
  log(state, `${resident.name} 사망 — ${cause}`);
}

export function move(state, dx, dy, dt) {
  if (state.status !== 'active' || !Number.isFinite(dt) || dt <= 0 || dt > 0.1 || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
  const length = Math.hypot(dx, dy);
  if (!length) return;
  state.job = null;
  const speed = weather(state).storm && !isSafe(state.position) ? 2.4 : 3.4;
  const x = state.position.x + dx / length * speed * dt;
  const y = state.position.y + dy / length * speed * dt;
  if (canStand(x, state.position.y)) state.position.x = x;
  if (canStand(state.position.x, y)) state.position.y = y;
}

function consume(state, id, resource, amount) {
  const used = Math.min(state.rations[id][resource], amount);
  state.rations[id][resource] -= used;
  state.currentCycle.people[id][`${resource}Used`] += used;
  return used;
}

function tend(state, crop, announce = true) {
  let message;
  if (!crop.planted) {
    crop.planted = true; crop.watered = state.pumpFixed; crop.growth = 0;
    message = `감자를 심었다. 급수 후 ${growthTime(state)}초에 수확한다.`;
  } else if (crop.growth >= growthTime(state)) {
    let amount = state.soilSettled ? 3 : 1;
    if (!state.soilSettled && state.sterilization.remaining > 0 && state.elapsed < state.sterilization.until) { amount++; state.sterilization.remaining--; }
    state.food += amount; state.harvested += amount;
    crop.planted = false; crop.watered = false; crop.growth = 0;
    message = `감자 수확. 공동 식량 +${amount}식`;
  } else if (!crop.watered) { crop.watered = true; message = '물을 주었다. 작물이 자란다.'; }
  else message = `수확까지 ${Math.ceil(growthTime(state) - crop.growth)}초.`;
  return announce ? log(state, message) : message;
}

function work(state, dt) {
  for (const r of state.residents) {
    if (!r.alive || r.id === 'seon' || r.health < 30 || r.hunger <= 15) continue;
    r.workerClock += dt * POLICIES[state.policy].work * (r.morale < 30 ? 0.75 : 1) * (r.health < 50 ? 0.75 : 1);
    if (r.workerClock < 24) continue;
    r.workerClock -= 24;
    const crops = state.crops.filter((_, i) => i !== 5 || ['idle', 'settled'].includes(state.soil.phase));
    const crop = crops.find(c => c.planted && c.growth >= growthTime(state)) ?? crops.find(c => c.planted && !c.watered) ?? crops.find(c => !c.planted);
    if (crop) tend(state, crop, false);
  }
}

function advanceJob(state, dt) {
  const job = state.job;
  if (!job) return;
  const target = job.type === 'care' ? residentPosition(state, person(state, 'seon')) : OBJECTS.find(o => o.id === job.id);
  if (!target || Math.hypot(target.x - state.position.x, target.y - state.position.y) > 1.6 || (job.type === 'care' && !person(state,'seon').alive)) { state.job = null; return; }
  job.remaining = Math.max(0, job.remaining - dt);
  if (job.remaining < 1e-8) job.remaining = 0;
  if (state.projects[job.type]) state.projects[job.type].remaining = job.remaining;
  if (job.type === 'soil') state.soil.remaining = job.remaining;
  if (job.remaining > 1e-8) return;
  state.job = null;
  if (job.type === 'search') {
    if (state.searched.includes(job.id)) return;
    const rewards = { 'scrap-0': ['kits', 1, '응급 의료 키트'], 'scrap-1': ['filters', 2, '흙 정화 필터'], 'scrap-2': ['coils', 1, '고효율 난방 코일'], 'scrap-3': ['parts', 2, '수리 자재'], 'scrap-4': ['oxygenStock', 120, '공동 산소'], 'scrap-5': ['food', 2, '공동 식량'] };
    const [key, amount, name] = rewards[job.id];
    if (key === 'oxygenStock' && 600 - storedOxygen(state) < amount - 1e-7) {
      log(state, '비상 산소 120은 잔해에 보관했다. 공동 저장고 여유 120을 확보한 뒤 다시 회수하자.'); return;
    }
    state.searched.push(job.id); state[key] += amount;
    log(state, `잔해 수색 완료. ${name} +${amount}${key === 'kits' ? '개. 한 세트뿐이므로 세 용도를 비교하자.' : ''}`);
  } else if (job.type === 'care') {
    const seon = person(state, 'seon');
    if (seon.careCycle !== state.cycle) { seon.health = clamp(seon.health + 8); seon.careCycle = state.cycle; }
    seon.careUntil = state.elapsed + 300; state.currentCycle.people.seon.care = true;
    log(state, '선의 상처를 다시 묶었다. 300초 동안 상처 악화를 완화한다.');
  } else if (job.type === 'soil') { state.soil.phase = 'water'; log(state, '배양토 처리 완료. E로 급수한 뒤 새싹을 관찰하자.'); }
  else { state[`${job.type}Fixed`] = true; state.projects[job.type].done = true; log(state, `${{ base: '타워 기반', filter: '정화 모듈', heat: '난방 모듈' }[job.type]} 복구 완료.`); }
}

function step(state, dt) {
  const storm = weather(state).storm;
  state.elapsed += dt; state.policyTime[state.policy] += dt;
  state.hunger = clamp(state.hunger - RULES.hunger * dt);
  if (isSafe(state.position)) state.oxygen += consume(state, 'ran', 'oxygen', Math.min(8 * dt, 100 - state.oxygen));
  else state.oxygen = clamp(state.oxygen - RULES.oxygen * (storm ? 2 : 1) * dt);
  const rp = state.currentCycle.people.ran;
  if (!state.hunger) rp.hungerZero += dt;
  if (!state.oxygen) rp.oxygenZero += dt;
  let damage = 0, cause = '';
  if (!state.hunger) { damage += dt; cause = '굶주림'; }
  if (!state.oxygen) { damage += 5 * dt; cause = '산소 고갈'; }
  if (inLeak(state.position) && !state.leakFixed) { damage += 2 * dt; cause = '설비 누출 구역 노출'; }
  state.health = clamp(state.health - damage);
  if (damage) state.job = null;
  if (!damage && isSafe(state.position) && state.hunger > 50) state.health = clamp(state.health + dt * 0.25);
  if (!state.health) { state.cause = cause; state.deaths.push({ id: 'ran', name: '란', time: state.elapsed, cause }); rp.dead = true; ending(state, 'dead'); log(state, `란 사망 — ${cause}. 이 회차는 종료되었습니다.`); return; }
  for (const resident of state.residents.filter(r => r.alive)) {
    const p = state.currentCycle.people[resident.id];
    if (resident.id === 'seon') p.seonNeed += oxygenRate(resident) * dt;
    resident.hunger = clamp(resident.hunger - 0.09 * dt);
    if (resident.hunger <= 65) while (resident.hunger < 80 && state.rations[resident.id].food >= 0.25) resident.hunger = clamp(resident.hunger + consume(state, resident.id, 'food', 0.25) * 35);
    resident.oxygen = clamp(resident.oxygen - oxygenRate(resident) * dt);
    resident.oxygen += consume(state, resident.id, 'oxygen', Math.min(8 * dt, 100 - resident.oxygen));
    if (!resident.hunger) p.hungerZero += dt;
    if (!resident.oxygen) p.oxygenZero += dt;
    const wound = resident.id === 'seon' && !resident.treated ? resident.careUntil >= state.elapsed ? 0.015 : 0.04 : 0;
    const chronic = resident.id === 'hong' && !resident.treated ? 0.02 : 0;
    const cold = state.heatFixed ? 0 : 0.01;
    const loss = (!resident.hunger ? 0.5 : 0) + (!resident.oxygen ? 1 : 0) + wound + chronic + cold;
    const recovery = resident.hunger >= 65 && resident.oxygen >= 50 && state.heatFixed ? 0.01 : 0;
    resident.health = clamp(resident.health + (recovery - loss) * dt);
    if (!resident.health) residentDeath(state, resident, [!resident.oxygen && '산소 배급 부족', !resident.hunger && '식량 배급 부족', wound && '상처 악화', chronic && '만성질환', cold && '거주구 추위'].filter(Boolean).join(' · '));
  }
  state.oxygenStock += Math.min((state.filterFixed ? 1.2 : 0.6) * dt, Math.max(0, 600 - storedOxygen(state)));
  if (state.elapsed >= state.sterilization.until) state.sterilization.remaining = 0;
  for (let i = 0; i < state.crops.length; i++) {
    const crop = state.crops[i];
    if (i === 5 && !['idle','settled'].includes(state.soil.phase)) continue;
    if (crop.planted && (crop.watered || state.pumpFixed)) crop.growth = Math.min(growthTime(state), crop.growth + dt);
  }
  work(state, dt);
  if (state.soil.phase === 'observing' && state.filterFixed && state.heatFixed && state.pumpFixed && state.leakFixed) {
    state.soil.observed = Math.min(90, state.soil.observed + dt);
    if (state.soil.observed >= 90 - 1e-8) {
      state.soil.phase = 'settled'; state.soilSettled = true; state.soil.settledAt = state.elapsed;
      log(state, '싹이 검게 타지 않았어. 이 흙으로 다음 감자를 심을 수 있어.');
    }
  }
  advanceJob(state, dt);
  if (!state.injuryWarned && state.elapsed >= 120) { state.injuryWarned = true; log(state, '선의 상처 악화와 의료품 부족 무전. 키트 처치나 30초 직접 돌봄이 필요하다.'); }
  if (state.meetingWarned !== state.cycle && state.elapsed - state.currentCycle.start >= 180) { state.meetingWarned = state.cycle; log(state, '다음 배급 회의 안내. 게시판의 다음 안은 300초 경계부터 적용된다.'); }
}

export function tick(state, dt) {
  if (state.status !== 'active' || !Number.isFinite(dt) || dt <= 0 || dt > 1) return;
  let remaining = dt;
  while (remaining > 1e-9 && state.status === 'active') {
    const amount = Math.min(remaining, state.currentCycle.start + 300 - state.elapsed);
    if (amount > 1e-9) { step(state, amount); remaining -= amount; }
    if (state.status === 'active' && state.elapsed >= state.currentCycle.start + 300 - 1e-8) { state.elapsed = state.currentCycle.start + 300; completeCycle(state); }
  }
}

export function interact(state) {
  if (state.status !== 'active') return null;
  state.job = null;
  const target = nearest(state);
  if (!target) return { message: '대상 가까이 이동하세요.' };
  switch (target.type) {
    case 'plot': return target.id === 'plot-5' ? { dialog: target } : { message: tend(state, state.crops[Number(target.id.split('-')[1])]) };
    case 'scrap':
      if (state.searched.includes(target.id)) return { message: '이미 수색한 잔해입니다.' };
      state.job = { id: target.id, type: 'search', remaining: 8, duration: 8 };
      return { message: '수색 중 · 8초. 이동·대화·위험에 중단됩니다.' };
    case 'valve':
      state.leakFixed = true; return { message: log(state, '밸브 차단 완료. 누출 배관을 닫았다.') };
    case 'signal':
      if (state.signal) return { message: '구역별 수요 보고를 이미 확보했다.' };
      state.signal = true; return { message: log(state, '구역별 배급 수요와 설비 상태를 확보했다. DJ와 이야기해 보자.') };
    default: return { dialog: target };
  }
}

export function settlementRequirements(state) {
  const missing = [];
  if (!state.leakFixed) missing.push('누출 밸브 차단');
  if (!state.pumpFixed) missing.push('급수 복구');
  if (!state.filterFixed) missing.push('정화 모듈 복구');
  if (!state.heatFixed) missing.push('난방 모듈 복구');
  if (!state.soilSettled) missing.push('첫 배양토 안착');
  if (state.provisions < 8) missing.push(`겨울 비축 ${8 - state.provisions}식 추가`);
  const recent = state.ledger.slice(-2), rightsMissing = [];
  if (!state.soilSettled || recent.length < 2 || recent.some(c => c.start < state.soil.settledAt - 1e-8)) rightsMissing.push('흙 안착 이후 완전한 최근 배급 주기 두 번 필요');
  for (const cycle of recent) { const check = rightsFor(state, cycle); if (!check.ok) rightsMissing.push(`${cycle.index + 1}주기: ${check.missing.join(' · ')}`); }
  const current = rightsFor(state, state.currentCycle, true);
  rightsMissing.push(...current.missing.map(text => `현재: ${text}`));
  return { physical: !missing.length, rights: !rightsMissing.length, missing, rightsMissing, recent, current, survivors: state.residents.filter(r => r.alive), needed: 8 };
}

// Costly actions validate at the rule boundary; disabled UI controls are only hints.
export function act(state, action, value) {
  const fail = message => ({ ok: false, message });
  if (state.status !== 'active') return fail('종료된 회차입니다.');
  const target = nearest(state), type = target?.type;
  const board = type === 'board', shelter = type === 'shelter' && contains(REGIONS.shelter, state.position.x, state.position.y);
  const resident = target?.type === 'resident' ? person(state, target.id) : null;
  if (['policy','reserve','returnFood','finish'].includes(action) && !board) return fail('게시판 가까이 이동하세요.');
  if (['supplement','donate'].includes(action) && !(board || shelter || action === 'donate' && type === 'resident' && target.id === value?.id)) return fail('게시판 또는 대피소 무전에서 배급하세요.');
  if (['base','filter','heat'].includes(action) && type !== 'ship') return fail('타워 가까이 이동하세요.');
  let message;
  switch (action) {
    case 'eat': {
      if (state.hunger > 85) return fail('아직 충분히 배부릅니다.');
      if (state.rations.ran.food < 0.25) return fail('란에게 남은 식량 배급이 없습니다.');
      const amount = consume(state, 'ran', 'food', Math.min(1, state.rations.ran.food));
      state.hunger = clamp(state.hunger + 35 * amount); message = `내 배급 ${amount}식으로 식사했다.`; break;
    }
    case 'policy':
      if (!Object.hasOwn(POLICIES, value)) return fail('알 수 없는 배분안입니다.');
      state.nextPolicy = value; message = `다음 주기 배분안: ${POLICIES[value].name}. 현재 몫은 바뀌지 않는다.`; break;
    case 'supplement': case 'donate': {
      if (!value || !living(state).includes(value.id) || !['food','oxygen'].includes(value.resource)) return fail('살아 있는 공급 대상과 자원을 확인하세요.');
      const { id, resource, amount } = value, unit = resource === 'food' ? 0.25 : 5;
      if (!Number.isFinite(amount) || amount <= 0 || Math.abs(amount / unit - Math.round(amount / unit)) > 1e-8) return fail(`공급은 ${unit} 단위여야 합니다.`);
      const key = resource === 'food' ? 'food' : 'oxygenStock';
      if (action === 'donate') {
        if (id === 'ran' || state.rations.ran[resource] < amount) return fail('양도할 란의 미사용 몫이 부족합니다.');
        state.rations.ran[resource] -= amount; state.currentCycle.people.ran[resource] -= amount;
      } else {
        if (state[key] + 1e-8 < amount) return fail('미배정 공동 재고가 부족합니다.');
        state[key] = Math.max(0, state[key] - amount);
      }
      state.rations[id][resource] += amount; state.currentCycle.people[id][resource] += amount;
      state.currentCycle.supplies ??= [];
      state.currentCycle.supplies.push({ time: state.elapsed, kind: action, id, resource, amount });
      message = `${NAMES[id]}에게 ${resource === 'food' ? '식량' : '산소'} ${amount} ${action === 'donate' ? '양도' : '추가 배급'}.`; break;
    }
    case 'kit': {
      if (!['seon','hong','greenhouse'].includes(value)) return fail('키트 사용처를 선택하세요.');
      if (!(board || resident?.id === value || value === 'greenhouse' && ['pump','plot'].includes(type))) return fail('게시판 또는 해당 대상 가까이 이동하세요.');
      if (!state.kits) return fail('응급 의료 키트가 없습니다. 직접 돌봄과 수동 수리는 가능합니다.');
      if (value !== 'greenhouse') {
        const p = person(state,value);
        if (!p.alive || p.treated) return fail('처치할 수 없는 대상입니다.');
        p.treated = true; p.treatedAt = state.elapsed; p.health = clamp(p.health + (value === 'seon' ? 30 : 25));
        if (value === 'seon') state.currentCycle.people.seon.treated = true;
      } else {
        if (state.sterilization.until > state.elapsed || state.soilSettled) return fail('지금 온실 살균을 적용할 수 없습니다.');
        state.sterilization = { until: state.elapsed + 600, remaining: 4 };
      }
      state.kits--; message = `${value === 'greenhouse' ? '온실 살균' : NAMES[value] + ' 동의 후 처치'} 완료. 한 세트를 소모했다.`; break;
    }
    case 'care': {
      if (value !== 'seon' || resident?.id !== 'seon' || !resident.alive || resident.treated) return fail('상처가 남은 선 가까이에서 돌봄을 시작하세요.');
      state.job = { id: 'seon', type: 'care', remaining: 30, duration: 30 }; message = '30초 연속 돌봄. 중단하면 처음부터 다시 시작한다.'; break;
    }
    case 'pump':
      if (type !== 'pump') return fail('급수 장치 가까이 이동하세요.');
      if (state.pumpFixed) return fail('이미 급수를 복구했습니다.');
      if (state.parts < 1) return fail('수리 자재 1개가 필요합니다.');
      state.parts--; state.pumpFixed = true; message = '자동 급수 복구 완료.'; break;
    case 'base': case 'filter': case 'heat': {
      if (state[`${action}Fixed`]) return fail('이미 복구했습니다.');
      if (!state.leakFixed) return fail('먼저 누출 밸브를 차단하세요.');
      if (action !== 'base' && !state.baseFixed) return fail('먼저 타워 기반을 복구하세요.');
      let project = state.projects[action];
      if (!project) {
        const resource = { base: 'parts', filter: 'filters', heat: 'coils' }[action];
        if (state[resource] < 1) return fail(`${{ parts: '수리 자재', filters: '정화 필터', coils: '난방 코일' }[resource]} 1개가 필요합니다.`);
        state[resource]--;
        const hong = person(state,'hong'), duration = !hong.alive || hong.health < 40 ? 60 : hong.morale < 30 ? 45 : 30;
        project = state.projects[action] = { remaining: duration, duration, done: false };
      }
      state.job = { id: 'ship', type: action, remaining: project.remaining, duration: project.duration }; message = `타워 작업 ${Math.ceil(project.remaining)}초. 중단해도 투입 자원과 진행은 남는다.`; break;
    }
    case 'soil': {
      if (target?.id !== 'plot-5') return fail('공동 텃밭 가까이 이동하세요.');
      if (state.soil.phase === 'settled' || state.soil.phase === 'observing') return fail('관찰 중이거나 이미 안착한 흙입니다.');
      if (!(state.leakFixed && state.pumpFixed && state.filterFixed && state.heatFixed)) return fail('밸브·급수·타워 두 모듈 복구가 필요합니다.');
      if (state.soil.phase === 'water') { state.soil.phase = 'observing'; message = '배양토에 급수했다. 유효 관찰 90초를 기다리자.'; break; }
      if (state.soil.phase === 'idle') {
        if (state.crops[5].planted) return fail('감자를 수확해 빈 텃밭으로 만든 뒤 조성하세요.');
        if (state.filters < 1 || state.food < 2) return fail('정화 필터 1개와 미배정 식량 2식이 필요합니다.');
        state.filters--; state.food -= 2; state.soil.phase = 'processing'; state.soil.remaining = 30;
      }
      state.job = { id: 'plot-5', type: 'soil', remaining: state.soil.remaining, duration: 30 }; message = '배양토 처리 시작. 중단한 처리도 이어서 할 수 있다.'; break;
    }
    case 'farm':
      if (target?.id !== 'plot-5' || !['idle','settled'].includes(state.soil.phase)) return fail('배양토 조성 중에는 일반 경작을 할 수 없습니다.');
      message = tend(state,state.crops[5],false); break;
    case 'reserve':
      if (state.food - 1 < living(state).length) return fail(`다음 배급을 위해 미배정 식량 ${living(state).length}식을 남겨야 합니다.`);
      state.food--; state.provisions++; message = '공동 식량 1식을 겨울 비축으로 옮겼다.'; break;
    case 'returnFood':
      if (state.provisions < 1) return fail('회수할 겨울 비축이 없습니다.');
      state.provisions--; state.food++; message = '겨울 비축 1식을 공동 재고로 회수했다.'; break;
    case 'broadcast':
      if (!(board || resident?.id === 'dj')) return fail('게시판 또는 DJ 가까이 이동하세요.');
      if (state.currentCycle.broadcast) return fail('이번 주기 장부는 이미 방송했습니다.');
      state.currentCycle.broadcast = true; message = '받은 양, 못 받은 양, 남겨 둔 양과 잃은 사람의 이름을 방송했다.'; break;
    case 'past':
      if (resident?.id !== 'seon') return fail('선 가까이 이동하세요.');
      if (resident.health < 30 || resident.oxygen < 30 || resident.hunger < 25) return fail('지금은 선의 호흡과 건강을 먼저 돌봐야 한다.');
      state.past = true; message = '루이 이야기를 몫을 줄이는 이유로 쓰지 않고, 함께 기억하기로 했다.'; break;
    case 'finish': {
      const check = settlementRequirements(state);
      if (!check.physical) return fail(check.missing.join(' · '));
      const id = check.rights && check.survivors.length ? check.survivors.length === 3 ? 'together' : 'loss' : 'excluded';
      ending(state,id); message = state.ending.title; break;
    }
    default: return fail('알 수 없는 행동입니다.');
  }
  return { ok: true, message: log(state, message) };
}

export function locationName(state) {
  const tile = terrain(state.position.x, state.position.y);
  return { greenhouse: '공동 온실', shelter: '산소 대피소', facility: '폐쇄 설비 구역', pad: '중앙 흙 정화·난방 타워' }[tile] ?? (contains(REGIONS.wreck, state.position.x, state.position.y) ? '캡슐 잔해 지대' : '화성 황무지');
}
