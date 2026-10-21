import { newGame, tick, move, act, interact, weather, locationName, launchRequirements, canInvite } from './game.js';
import { nearest, isSafe } from './world.js';
import { render } from './render.js';
import { canUseMap, createMapView } from './map.js';
import { loadGame, saveGame, resetGame } from './storage.js';

const $ = id => document.getElementById(id);
const canvas = $('world'), ctx = canvas.getContext('2d');
const dialog = $('dialog'), keys = new Set();
let reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const panels = ['map-panel', 'mission-panel', 'player-panel', 'info-panel'].map($);
const updateMiniMap = createMapView($('mini-map'));
const updateOverviewMap = createMapView($('overview-map'), true);
let state = newGame(), paused = true, ownsLock = false, storageBlocked = false;
let canPersist = false;
let dialogKind = '', lastTime = performance.now(), saveClock = 0, hudClock = 0;
let lastEvent = '', lastPeople = '', lastObjectives = '', terminalShown = false;

const formatTime = seconds => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
function element(tag, content, className = '') {
  const el = document.createElement(tag); el.textContent = content; el.className = className; return el;
}
function paragraph(content, className = '') { $('dialog-body').append(element('p', content, className)); }
function button(label, callback, primary = false, parent = $('dialog-actions')) {
  const b = element('button', label, primary ? 'primary' : '');
  b.addEventListener('click', callback); parent.append(b); return b;
}
function showDialog(kind, title, tag = 'MARS VALLEY') {
  keys.clear(); paused = true; state.job = null; dialogKind = kind;
  dialog.classList.toggle('map-dialog', kind === 'map');
  panels.forEach(panel => $('panel-home').append(panel));
  $('dialog-title').textContent = title; $('dialog-tag').textContent = tag;
  $('dialog-body').replaceChildren(); $('dialog-actions').replaceChildren(); $('dialog-feedback').textContent = '';
  if (!dialog.open) dialog.showModal();
}
function focusDialog() { dialog.querySelector('button')?.focus(); }
function closeDialog() {
  if (!ownsLock || storageBlocked || state.status !== 'active') return;
  panels.forEach(panel => $('panel-home').append(panel));
  dialog.close(); dialogKind = ''; keys.clear(); paused = false; canvas.focus(); lastTime = performance.now();
}

function showPanel(id, title, tag) {
  if (!ownsLock || !canPersist || state.status !== 'active' || storageBlocked) return;
  if (id === 'map-panel' && !canUseMap(state)) return;
  showDialog(id === 'map-panel' ? 'map' : 'panel', title, tag);
  $('dialog-body').append($(id));
  updateHUD();
  button('닫고 계속하기', closeDialog, true);
  if (id === 'map-panel') { $('dialog-title').tabIndex = -1; $('dialog-title').focus(); }
  else focusDialog();
}

function save(reset = false) {
  if (!ownsLock || !canPersist) return false;
  try {
    if (reset) resetGame(localStorage, state); else saveGame(localStorage, state);
    storageBlocked = false;
    $('save-error').hidden = true; $('save-status').textContent = '회차 저장됨'; return true;
  } catch (error) {
    paused = true; keys.clear(); storageBlocked = true;
    $('save-error').hidden = false;
    $('save-error').replaceChildren(element('span', `저장 실패: ${error.message} 진행을 멈췄습니다. 저장 공간이나 브라우저 설정을 확인하세요. `));
    button('저장 다시 시도', () => { if (save()) showPause(); }, false, $('save-error'));
    $('save-status').textContent = '저장 실패'; return false;
  }
}

function intro(hasSave = false) {
  showDialog('intro', hasSave ? '아직, 다음이 남아 있다' : '귀환할 지구는 없다', 'MARS VALLEY / 마지막 온실');
  paragraph(hasSave ? `생존 시간 ${formatTime(state.elapsed)}. 중단한 기록이 남아 있습니다.` : '란은 기후 재난을 이겨낸 지구를 기대했다. 하지만 그곳에는 아무것도 남아 있지 않았다.', 'lead');
  paragraph('화성으로 돌아온 란은 공동 온실의 주민들에게 탈출 계획을 공개한다. 목적지는 불확실하다. 누구와 떠날지는 당신이 결정한다.');
  const voices = element('div', '', 'voices');
  for (const [name, line] of [['선 · 동참', '설비는 오래 못 버텨. 탈출선을 고쳐보자.'], ['홍 선생님 · 반대', '우선 여기 있는 사람들이 먹고살아야 해요.'], ['DJ · 유보', '바깥의 신호를 확인할 수 있다면 생각해 볼게.']]) {
    const v = element('div', '', 'voice'); v.append(element('strong', name), document.createTextNode(line)); voices.append(v);
  }
  $('dialog-body').append(voices);
  paragraph('WASD / 방향키 이동 · E 조사와 농사 · Q 식사 · Esc 일시정지. 먼저 위쪽 경작대에서 감자를 수확하고, 왼쪽 게시판에서 식량을 논의하세요.', 'dialog-note');
  paragraph('사망하면 처음부터 다시 시작합니다. 종료·대화·다른 탭을 보는 동안에는 시간이 멈춥니다.');
  button(hasSave ? '이어서 생존하기' : '온실에서 시작하기', () => { canPersist = true; if (save()) closeDialog(); }, true);
  if (hasSave) button('새 회차', confirmRestart);
  focusDialog();
}

function confirmRestart() {
  showDialog('restart', '새 회차를 시작할까요?', '새로운 시작');
  paragraph('현재 회차의 농장, 물자, 관계, 탈출 준비가 초기화됩니다. 이전 회차로 돌아갈 수 없습니다.');
  button('취소', () => state.status === 'active' ? showPause() : showEnding());
  button('초기화하고 시작', () => {
    state = newGame(); terminalShown = false; saveClock = 0; lastPeople = ''; lastEvent = '';
    canPersist = true;
    if (save(true)) intro();
  }, true);
  focusDialog();
}

function showPause() {
  if (!ownsLock) return;
  if (state.status !== 'active') { showEnding(); return; }
  showDialog('pause', '설정 · 일시정지', '잠시 숨을 고르는 시간');
  paragraph('회차 시간이 멈췄습니다. 식량과 산소는 줄어들지 않습니다.');
  paragraph(`생존 ${formatTime(state.elapsed)} · 공동 식량 ${state.food} · 부품 ${state.parts} · 보존식 ${state.provisions}`);
  const motion = element('label', '', 'motion-control');
  const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.checked = reducedMotion;
  toggle.addEventListener('change', () => { reducedMotion = toggle.checked; });
  motion.append(toggle, document.createTextNode('화면 효과 줄이기'));
  $('dialog-body').append(motion);
  button('계속하기', closeDialog, true); button('조작 안내', help); button('새 회차', confirmRestart);
  focusDialog();
}

function help() {
  if (!ownsLock) return;
  showDialog('help', '살아남기 위한 기록', 'FIELD GUIDE');
  paragraph('WASD 또는 방향키로 이동합니다. 가까운 대상에 E 표시가 나타나면 조사·대화·작업할 수 있습니다. Q는 공동 식량 1개로 식사합니다.');
  paragraph('경작대: E로 파종 → 다시 E로 급수 → 90초 후 E로 수확. 주민들도 24초마다 농사에 참여합니다. 수확물은 공동 창고에 들어갑니다.');
  paragraph('온실 오른쪽 출입구로 나가면 산소가 줄어듭니다. 온실과 지도 중앙의 O₂ 대피소에서는 산소가 충전됩니다. 틈이 난 지형은 우회하세요.');
  paragraph('오른쪽 위 원형 지도를 누르면 전체 지도와 현재 위치, 날씨를 확인합니다. 모래폭풍 중에는 지도 연결이 끊기고 폭풍이 끝나면 복구됩니다.');
  paragraph('지도는 란을 따라 움직이며 가장자리에서 멈춥니다. 지면의 점선과 갈림길 표지를 따라 탐험하세요. 북쪽 잔해 지대의 동쪽 끝에는 통신기가 있습니다.');
  paragraph('잔해 수색에는 8초가 걸립니다. 이동하면 취소됩니다. 폐쇄 설비 구역의 점선 안에서는 체력이 줄어드니 입구 밸브부터 차단하세요.');
  paragraph('북동쪽 발사대에서 부품 8개로 탈출선을 복구합니다. 게시판에서 합의 후 보존식을 만드세요. 출발에는 본인을 포함해 인당 보존식 2개가 필요합니다.');
  paragraph('초대는 주민과 직접 대화합니다. 선은 구조, 홍 선생님은 급수와 공동 식사, DJ는 외부 신호가 중요합니다. 강제로 동행시킬 수는 없습니다.');
  button('확인', () => state.status === 'active' ? closeDialog() : showEnding(), true);
  focusDialog();
}

function perform(action, value, after) {
  if (!ownsLock || storageBlocked) return;
  const result = act(state, action, value);
  if (result.ok) save();
  if (state.status !== 'active') { showEnding(); return; }
  if (result.ok && after) after();
  $('dialog-feedback').textContent = result.message;
  updateHUD();
}

function discussion() {
  showDialog('board', '오늘의 식사, 내일의 항해', '공동체 논의');
  paragraph(`공동 식량 ${state.food}개 · 항해 보존식 ${state.provisions}개. 노동량과 관계없이 모든 생존 주민이 배급 대상입니다.`);
  const living = state.residents.filter(r => r.alive);
  for (const [policy, title, views] of [
    ['share', '공동 식사를 우선한다', { seon: '출발이 늦어져도 함께 버틸 식량은 남겨두자. 찬성.', hong: '일하지 못하는 사람도 먹어야 해요. 찬성합니다.', dj: '주민당 두 끼를 남긴다면 동의해.' }],
    ['ration', '모두 같은 기준으로 잠시 절약한다', { seon: '탈출 준비를 앞당기자. 모두 같은 기준이면 찬성.', hong: '한 끼는 남기고, 부족해지면 다시 논의해요. 조건부 동의.', dj: '배고픈 건 감수할게. 상황은 계속 공유하자.' }],
  ]) {
    const section = element('section', '', 'choice-section'); section.append(element('h3', title));
    for (const r of living) section.append(element('p', `${r.name}: “${views[r.id]}”`));
    if (!living.length) section.append(element('p', '남은 주민이 없습니다. 란이 식량 사용을 결정합니다.'));
    section.append(element('p', policy === 'share' ? '비축 전 주민당 식량 2개를 남깁니다. 주민은 허기 45 이하에서 식사합니다.' : '비축 전 주민당 식량 1개를 남깁니다. 주민은 허기 20 이하까지 식사를 늦춥니다.'));
    button(state.policy === policy ? '현재 합의안' : '의견을 확인하고 합의', () => perform('policy', policy, board), state.policy !== policy, section);
    $('dialog-body').append(section);
  }
  button('게시판으로', board); focusDialog();
}

function board() {
  showDialog('board', '공동 온실 게시판', '식량과 항해 준비');
  paragraph(`공동 식량 ${state.food}개 · 항해 보존식 ${state.provisions}개` , 'lead');
  paragraph(state.policy ? `현재 합의: ${state.policy === 'share' ? '공동 식사 우선' : '균등 절약'}. 합의한 몫을 남기고 보존식을 준비합니다.` : '아직 항해용 식량 비축에 합의하지 않았습니다. 주민들과 먼저 논의하세요.');
  paragraph('비축한 보존식은 필요할 때 공동 식사로 돌려놓을 수 있습니다. 출발에는 본인을 포함해 인당 2개가 필요합니다.');
  button('주민들과 논의', discussion, !state.policy);
  button('보존식 2개 만들기', () => perform('reserve', null, board), Boolean(state.policy));
  button('보존식 2개 돌려놓기', () => perform('returnFood', null, board));
  button('돌아가기', closeDialog); focusDialog();
}

function residentDialog(id) {
  const resident = state.residents.find(r => r.id === id);
  if (!resident?.alive) { closeDialog(); return; }
  showDialog('resident', resident.name, `초기 입장 · ${resident.stance}`);
  if (id === 'seon' && state.rescue === 'active') {
    paragraph(`“산소 장치가 멈췄어. 시간이 없어.” 대응 여유 ${formatTime(Math.max(0, state.rescueDeadline - state.elapsed))}`, 'lead');
    paragraph('부품 2개로 장치를 수리하거나, 자신의 산소 20을 나누고 대피를 도울 수 있습니다. 대피 지원에는 현재 산소 25 이상이 필요합니다.');
    button('부품 2개로 수리', () => perform('rescue', 'repair', () => { closeDialog(); }));
    button('산소를 나누고 대피', () => perform('rescue', 'evacuate', () => { closeDialog(); }), true);
  } else {
    const lines = {
      seon: '“여기 설비는 오래 못 버텨. 떠나려면 고칠 수 있는 것부터 고쳐보자.”',
      hong: '“온실을 버리고 떠나기 전에, 남을 사람들의 생활도 생각해 줘요.”',
      dj: '“확실한 건 없어. 그래도 저 너머에서 들리는 소리를 확인하고 싶어.”',
    };
    paragraph(lines[id], 'lead');
    paragraph(`건강 ${Math.ceil(resident.health)} · 허기 ${Math.ceil(resident.hunger)}. ${resident.invited ? '탈출에 동행하기로 했습니다.' : '현재 탑승 명단에 없습니다.'}`);
    const reason = canInvite(state, resident);
    paragraph(resident.invited ? '동행을 철회해도 공동 식량과 도움을 받을 권리는 유지됩니다.' : reason ?? '함께 떠날 의사가 있습니다. 동행을 제안할 수 있습니다.');
    button(resident.invited ? '동행 철회' : '함께 떠나자고 제안', () => perform('invite', id, () => residentDialog(id)), !resident.invited);
  }
  button('대화 마치기', closeDialog); focusDialog();
}

function ship() {
  showDialog('ship', '이곳 너머를 향해', '탈출선 복구');
  const req = launchRequirements(state);
  paragraph(`회수 부품 ${state.parts}개 · 보존식 ${state.provisions} / ${req.needed}개`, 'lead');
  paragraph(`추진 장치: ${state.engine ? '복구 완료' : '부품 4개 필요'} · 생명 유지 장치: ${state.lifeSupport ? '복구 완료' : '부품 4개 필요'}`);
  paragraph(`탑승 예정: 란${req.crew.length ? ', ' + req.crew.map(r => r.name).join(', ') : ' 혼자'}`);
  if (req.missing.length) paragraph(`남은 준비: ${req.missing.join(' · ')}`);
  else paragraph('출발 준비가 되었습니다. 목적지에서 살아남을 수 있는지는 아직 알 수 없습니다.');
  if (!state.engine) button('추진 장치 복구 · 부품 4', () => perform('engine', null, ship));
  if (!state.lifeSupport) button('생명 유지 복구 · 부품 4', () => perform('lifeSupport', null, ship));
  button('탑승 명단 확인', departure, !req.missing.length);
  button('돌아가기', closeDialog); focusDialog();
}

function departure() {
  showDialog('ship', '정말 출발할까요?', '마지막 확인');
  const req = launchRequirements(state);
  const stayed = state.residents.filter(r => r.alive && !r.invited).map(r => r.name);
  paragraph(`함께 떠날 사람: 란${req.crew.length ? ', ' + req.crew.map(r => r.name).join(', ') : ' 혼자'}`, 'lead');
  paragraph(`화성에 남을 사람: ${stayed.join(', ') || '없음'}. 공동 식량 ${state.food}개가 남습니다.`);
  paragraph(req.missing.length ? `아직 출발할 수 없습니다: ${req.missing.join(' · ')}` : `보존식 ${req.needed}개를 싣고 출발합니다. 이 회차의 선택이 확정됩니다.`);
  const launch = button('화성을 떠난다', () => perform('launch'), true); launch.disabled = req.missing.length > 0;
  button('더 준비하기', ship); focusDialog();
}

function openTarget(target) {
  if (target.type === 'board') board();
  else if (target.type === 'resident') residentDialog(target.id);
  else if (target.type === 'ship') ship();
  else if (target.type === 'pump') {
    showDialog('pump', '물을 잇는 일', '공동 온실 / 급수 설비');
    paragraph(state.pumpFixed ? '자동 급수가 작동합니다. 심은 작물은 따로 물을 주지 않아도 자랍니다.' : '부품 2개로 자동 급수를 복구할 수 있습니다. 주민들의 농사 부담이 줄고 홍 선생님을 설득하는 근거가 됩니다.');
    if (!state.pumpFixed) button('급수 복구 · 부품 2', () => perform('pump', null, () => openTarget(target)), true);
    button('돌아가기', closeDialog); focusDialog();
  }
}

function showEnding() {
  terminalShown = true;
  const escaped = state.status === 'escaped';
  showDialog('ending', escaped ? '우리는 다음을 향해 떠났다' : '이번 생존 기록이 끝났습니다', escaped ? 'DEPARTURE LOG' : 'END OF RUN');
  paragraph(escaped ? '붉은 행성이 창밖으로 멀어진다. 씨앗과 식량, 그리고 선택의 기억을 싣고. 저 너머의 생존은 아직 알 수 없다.' : `사망 원인: ${state.cause}`, 'lead');
  paragraph(`생존 시간 ${formatTime(state.elapsed)} · 누적 수확 ${state.harvested}개 · 수색한 캡슐 ${state.searched.length}개`);
  if (escaped) {
    paragraph(`동행: ${state.ending.crew.join(', ') || '란 혼자'} · 잔류: ${state.ending.stayed.join(', ') || '없음'} · 사망: ${state.ending.lost.join(', ') || '없음'}`);
  } else {
    paragraph('이 회차를 사망 이전으로 되돌릴 수 없습니다. 새로운 회차는 모든 자원과 관계를 처음부터 시작합니다.');
    for (const event of state.events.slice(1, 4)) paragraph(`${formatTime(event.time)} — ${event.text}`);
  }
  button('새로운 회차 시작', confirmRestart, true); focusDialog();
}

function updateHUD() {
  $('clock').textContent = formatTime(state.elapsed); $('place').textContent = locationName(state);
  for (const name of ['health', 'hunger', 'oxygen']) {
    $(name).value = state[name]; $(`${name}-value`).textContent = Math.ceil(state[name]);
    $(`detail-${name}`).textContent = Math.ceil(state[name]);
  }
  for (const name of ['food', 'parts', 'provisions']) {
    $(name).textContent = state[name]; $(`detail-${name}`).textContent = state[name];
  }
  $('detail-harvested').textContent = state.harvested;
  $('detail-searched').textContent = state.searched.length;
  const w = weather(state);
  updateMiniMap(state); updateOverviewMap(state);
  $('map-button').disabled = !ownsLock || !canPersist || storageBlocked || !canUseMap(state);
  $('map-unavailable').hidden = !w.storm;
  $('map-button').setAttribute('aria-label', w.storm ? '지도 연결 불가' : '전체 지도 열기');
  $('weather-title').textContent = w.storm ? '모래폭풍' : w.warning ? '폭풍 접근' : '맑음';
  $('weather-icon').textContent = w.storm || w.warning ? '≋' : '☀';
  $('weather-detail').textContent = `${w.storm ? '종료까지' : '폭풍까지'} ${formatTime(w.remaining)}`;
  const target = nearest(state);
  $('interaction').textContent = state.job ? `캡슐 수색 중 · ${Math.ceil(state.job.remaining)}초 / 이동하면 취소` : target ? `${target.label} · E로 ${target.type === 'resident' ? '대화' : '상호작용'}` : 'WASD로 이동 · 가까운 대상에 E';
  const req = launchRequirements(state);
  $('crew').textContent = `란${req.crew.length ? ', ' + req.crew.map(r => r.name).join(', ') : ''} · ${req.crew.length + 1}명`;
  $('needed').textContent = `출발에 보존식 ${req.needed}개 필요`;
  const objectives = [[state.harvested > 0, '온실에서 식량 확보'], [state.searched.length > 0, '캡슐 잔해에서 부품 수색'], [state.engine && state.lifeSupport, '탈출선의 두 장치 복구'], [state.provisions >= req.needed, `항해 보존식 ${req.needed}개 준비`]];
  const objectiveKey = JSON.stringify(objectives);
  if (objectiveKey !== lastObjectives) {
    lastObjectives = objectiveKey; $('objectives').replaceChildren();
    objectives.forEach(([done, label], i) => {
      const li = element('li', '', done ? 'done' : '');
      li.append(element('span', done ? '✓' : String(i + 1).padStart(2, '0'), 'objective-check'), element('span', label)); $('objectives').append(li);
    });
  }
  const peopleKey = JSON.stringify(state.residents.map(r => [r.alive, r.invited, Math.ceil(r.hunger), state.rescue]));
  if (peopleKey !== lastPeople) {
    lastPeople = peopleKey; $('residents').replaceChildren();
    for (const r of state.residents) {
      const row = element('div', '', 'resident'); row.style.setProperty('--person-color', { seon: '#b9c88f', hong: '#d6a773', dj: '#a3b9d5' }[r.id]);
      const copy = element('div', '', 'resident-copy'); copy.append(element('strong', r.name), element('small', !r.alive ? '사망 · 회차 내 복구 불가' : r.id === 'seon' && state.rescue === 'active' ? '설비 구역 · 구조 요청' : `공동 온실 · 허기 ${Math.ceil(r.hunger)}`));
      row.append(element('span', '', 'avatar'), copy, element('span', !r.alive ? '사망' : r.invited ? '동행' : r.stance, 'stance')); $('residents').append(row);
    }
  }
  let radio = '온실 동쪽 길에서 북쪽으로 가면 잔해 지대, 동쪽으로 계속 가면 O₂ 대피소입니다. 탈출소는 북동쪽, 설비 구역은 남동쪽입니다.';
  if (state.oxygen < 30) radio = `산소 부족 ${Math.ceil(state.oxygen)}%. 온실이나 O₂ 대피소로 즉시 귀환하세요.`;
  else if (state.rescue === 'active') radio = `긴급: 선의 산소 장치 고장. 남동쪽 설비 구역. 대응 여유 ${formatTime(Math.max(0, state.rescueDeadline - state.elapsed))}. 수리 또는 대피 지원이 필요합니다.`;
  else if (state.hunger < 25) radio = '허기가 낮습니다. Q로 식사하세요. 식량이 없으면 온실로 돌아가 수확하세요.';
  else if (isSafe(state.position)) radio = '안전 구역 · 산소 충전 중. 공동 온실의 주민들은 작물을 함께 돌봅니다.';
  if ($('radio-message').textContent !== radio) $('radio-message').textContent = radio;
  const danger = state.oxygen < 30 || state.rescue === 'active' || state.hunger < 25;
  $('danger-alert').hidden = !danger;
  if (danger && $('danger-alert').textContent !== radio) $('danger-alert').textContent = radio;
  const event = state.events[0];
  if (event && lastEvent !== `${event.time}:${event.text}`) {
    lastEvent = `${event.time}:${event.text}`; $('latest-log').textContent = `${formatTime(event.time)} — ${event.text}`;
    $('event-history').replaceChildren(...state.events.map(e => element('li', `${formatTime(e.time)} — ${e.text}`)));
  }
  $('world-state').hidden = !paused || dialog.open;
  $('pause').disabled = !ownsLock || state.status !== 'active';
  for (const id of ['mission-button', 'player-button', 'info-button']) $(id).disabled = !ownsLock || !canPersist || state.status !== 'active';
  $('interact').disabled = paused || !target || state.status !== 'active';
  $('eat').disabled = paused || state.food < 1 || state.hunger > 85 || state.status !== 'active';
}

function doInteract() {
  if (paused || !ownsLock || state.status !== 'active') return;
  const result = interact(state);
  if (result?.dialog) openTarget(result.dialog);
  else if (result?.message) $('latest-log').textContent = result.message;
  save(); updateHUD();
  if (!dialog.open) canvas.focus();
}
function eat() {
  if (paused || !ownsLock) return;
  const result = act(state, 'eat');
  if (result.ok) save();
  $('latest-log').textContent = result.message; updateHUD(); canvas.focus();
}

$('interact').addEventListener('click', doInteract); $('eat').addEventListener('click', eat);
$('pause').addEventListener('click', showPause); $('help').addEventListener('click', help);
$('map-button').addEventListener('click', () => showPanel('map-panel', '화성 탐사 지도', 'SECTOR 07 / 지형과 구조물'));
$('mission-button').addEventListener('click', () => showPanel('mission-panel', '화성을 떠나는 일', '미션 / 탈출 준비'));
$('player-button').addEventListener('click', () => showPanel('player-panel', '내 정보', 'RAN / 생존 기록'));
$('info-button').addEventListener('click', () => showPanel('info-panel', '게임 정보', '공동체 / 무전 / 기록'));
dialog.addEventListener('cancel', event => {
  event.preventDefault();
  if (!['intro', 'ending', 'restart', 'error', 'locked'].includes(dialogKind)) closeDialog();
});
document.addEventListener('keydown', event => {
  if (event.code === 'Escape' && !dialog.open && ownsLock) { event.preventDefault(); showPause(); return; }
  if (paused || dialog.open || event.target.closest('button, input, select, textarea, a')) return;
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
    event.preventDefault(); keys.add(event.code);
  }
  if (!event.repeat && event.code === 'KeyE') { event.preventDefault(); doInteract(); }
  if (!event.repeat && event.code === 'KeyQ') { event.preventDefault(); eat(); }
});
document.addEventListener('keyup', event => keys.delete(event.code));
function suspend() {
  keys.clear();
  if (ownsLock && !paused && state.status === 'active') { paused = true; save(); showPause(); }
}
window.addEventListener('blur', suspend);
document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); });
window.addEventListener('pagehide', () => { if (ownsLock) save(); });

function ready() {
  try {
    const saved = loadGame(localStorage);
    if (saved) { state = saved; canPersist = true; }
    if (state.status !== 'active') showEnding(); else intro(Boolean(saved));
  } catch (error) {
    showDialog('error', '저장 기록을 확인해 주세요', '저장 오류');
    paragraph(error.message); paragraph('기존 기록은 아직 덮어쓰지 않았습니다. 새 회차를 시작하면 현재 기록이 초기화됩니다.');
    button('기록을 초기화하고 새 회차', () => { state = newGame(); canPersist = true; if (save(true)) intro(); }, true); focusDialog();
  }
  updateHUD();
}

// An exclusive browser lock prevents stale saves and conflicting deaths across tabs.
if (navigator.locks) {
  navigator.locks.request('mars-valley-active-run', { ifAvailable: true }, async lock => {
    if (!lock) {
      showDialog('locked', '다른 탭에서 생존 중입니다', '중복 실행 방지');
      paragraph('이 회차를 열어둔 다른 탭을 닫은 뒤 새로고침해 주세요. 동시에 실행하면 저장이 충돌할 수 있어 진행을 막았습니다.');
      button('다시 확인', () => window.location.reload(), true); focusDialog(); return;
    }
    ownsLock = true; ready();
    await new Promise(resolve => window.addEventListener('pagehide', resolve, { once: true }));
    ownsLock = false;
  }).catch(error => {
    showDialog('locked', '회차를 열 수 없습니다', '브라우저 실행 오류'); paragraph(error.message);
    button('다시 확인', () => window.location.reload(), true); focusDialog();
  });
} else {
  showDialog('locked', '지원되는 브라우저가 필요합니다', '브라우저 호환성');
  paragraph('회차 저장 충돌 방지를 위해 Web Locks를 지원하는 최신 Chrome, Edge, Firefox 또는 Safari에서 localhost 주소로 실행해 주세요.');
}
window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });

function frame(now) {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(canvas.clientWidth * pixelRatio));
  const height = Math.max(1, Math.round(canvas.clientHeight * pixelRatio));
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000)); lastTime = now;
  let moving = false;
  if (!paused && ownsLock && !storageBlocked && !document.hidden && state.status === 'active') {
    const dx = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
    const dy = Number(keys.has('KeyS') || keys.has('ArrowDown')) - Number(keys.has('KeyW') || keys.has('ArrowUp'));
    moving = Boolean(dx || dy); move(state, dx, dy, dt); tick(state, dt);
    saveClock += dt;
    if (state.status !== 'active' && !terminalShown) { save(); showEnding(); }
    else if (saveClock >= 2) { saveClock = 0; save(); }
  }
  hudClock += dt;
  if (hudClock >= 0.1) { hudClock = 0; updateHUD(); }
  render(ctx, state, moving, reducedMotion, pixelRatio);
  requestAnimationFrame(frame);
}
updateHUD(); requestAnimationFrame(frame);
