import {
  act,
  interact,
  locationName,
  move,
  newGame,
  POLICIES,
  policyPreview,
  settlementRequirements,
  tick,
  weather,
} from "./game.js";
import { canUseMap, createMapView } from "./map.js";
import { render } from "./render.js";
import { hasLegacyGame, loadGame, resetGame, saveGame } from "./storage.js";
import { isSafe, nearest } from "./world.js";

const $ = (id) => document.getElementById(id);
const canvas = $("world"),
  ctx = canvas.getContext("2d");
const dialog = $("dialog"),
  keys = new Set();
let reducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;
const panels = ["map-panel", "mission-panel", "player-panel", "info-panel"].map(
  $,
);
const updateMiniMap = createMapView($("mini-map"));
const updateOverviewMap = createMapView($("overview-map"), true);
let state = newGame(),
  paused = true,
  ownsLock = false,
  storageBlocked = false;
let canPersist = false;
let dialogKind = "",
  lastTime = performance.now(),
  saveClock = 0,
  hudClock = 0;
let lastEvent = "",
  lastPeople = "",
  lastObjectives = "",
  terminalShown = false;

const formatTime = (seconds) =>
  `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
function element(tag, content, className = "") {
  const el = document.createElement(tag);
  el.textContent = content;
  el.className = className;
  return el;
}
function paragraph(content, className = "") {
  $("dialog-body").append(element("p", content, className));
}
function button(
  label,
  callback,
  primary = false,
  parent = $("dialog-actions"),
) {
  const b = element("button", label, primary ? "primary" : "");
  b.addEventListener("click", callback);
  parent.append(b);
  return b;
}
function showDialog(kind, title, tag = "MARS VALLEY") {
  keys.clear();
  paused = true;
  state.job = null;
  dialogKind = kind;
  dialog.classList.toggle("map-dialog", kind === "map");
  panels.forEach((panel) => $("panel-home").append(panel));
  $("dialog-title").textContent = title;
  $("dialog-tag").textContent = tag;
  $("dialog-body").replaceChildren();
  $("dialog-actions").replaceChildren();
  $("dialog-feedback").textContent = "";
  if (!dialog.open) dialog.showModal();
}
function focusDialog() {
  $("dialog-title").tabIndex = -1;
  $("dialog-title").focus();
}
function closeDialog() {
  if (!ownsLock || storageBlocked || state.status !== "active") return;
  panels.forEach((panel) => $("panel-home").append(panel));
  dialog.close();
  dialogKind = "";
  keys.clear();
  paused = false;
  canvas.focus();
  lastTime = performance.now();
}

function showPanel(id, title, tag) {
  if (!ownsLock || !canPersist || state.status !== "active" || storageBlocked)
    return;
  if (id === "map-panel" && !canUseMap(state)) return;
  showDialog(id === "map-panel" ? "map" : "panel", title, tag);
  $("dialog-body").append($(id));
  updateHUD();
  button("닫고 계속하기", closeDialog, true);
  if (id === "map-panel") {
    $("dialog-title").tabIndex = -1;
    $("dialog-title").focus();
  } else focusDialog();
}

function save(reset = false) {
  if (!ownsLock || !canPersist) return false;
  try {
    if (reset) resetGame(localStorage, state);
    else saveGame(localStorage, state);
    storageBlocked = false;
    $("save-error").hidden = true;
    $("save-status").textContent = "회차 저장됨";
    return true;
  } catch (error) {
    paused = true;
    keys.clear();
    storageBlocked = true;
    $("save-error").hidden = false;
    $("save-error").replaceChildren(
      element(
        "span",
        `저장 실패: ${error.message} 진행을 멈췄습니다. 저장 공간이나 브라우저 설정을 확인하세요. `,
      ),
    );
    button(
      "저장 다시 시도",
      () => {
        if (save()) showPause();
      },
      false,
      $("save-error"),
    );
    $("save-status").textContent = "저장 실패";
    return false;
  }
}

const names = { ran: "란", seon: "선", hong: "홍 선생님", dj: "DJ" };
const amount = (value) => Number(value.toFixed(2));
const policyName = (id) => POLICIES[id].name;
const materialCount = () =>
  state.parts + state.filters + state.coils + state.kits;
const myShare = () => state.rations.ran;
const oxygenMinimum = (id) =>
  id === "seon"
    ? state.currentCycle.people.seon.seonNeed +
      Math.max(0, (state.cycle + 1) * 300 - state.elapsed) *
        (state.residents.find((r) => r.id === "seon").treated ? 0.2 : 0.3)
    : 60;

function intro(hasSave = false, legacy = false) {
  showDialog(
    "intro",
    hasSave ? "아직, 함께 버틸 시간이 남아 있다" : "이곳에서 첫 겨울을",
    "MARS VALLEY v1.5 / 마지막 온실",
  );
  paragraph(
    hasSave
      ? `생존 시간 ${formatTime(state.elapsed)}. 정착을 준비하던 기록이 남아 있습니다.`
      : "사라진 지구에서 돌아온 란. 이번에는 화성에 남은 사람들과 살아갈 흙을 만들기로 한다.",
    "lead",
  );
  paragraph(
    "지구 보호소에서 란은 부족한 식량을 루이 대신 선에게 주었다. 그 기억이 남아 있지만, 이번 주민의 몫은 지금 필요한 양을 듣고 결정해야 한다.",
  );
  const voices = element("div", "", "voices");
  for (const [name, line] of [
    ["선 · 부상자", "걸을 수 없어도, 회의에는 내 자리도 있는 거지?"],
    ["홍 선생님 · 기술자", "수리할 사람이 먼저 버텨야 공기를 보낼 수 있어."],
    ["DJ · 방송 진행자", "필요한 양과 받은 양을 같이 기록하자."],
  ]) {
    const v = element("div", "", "voice");
    v.append(element("strong", name), document.createTextNode(line));
    voices.append(v);
  }
  $("dialog-body").append(voices);
  paragraph(
    "WASD / 방향키 이동 · E 농사와 대화 · Q 내 배급으로 식사 · Esc 일시정지. 북쪽에서 필터와 코일, 남쪽에서 수리 자재를 찾아 타워와 공동 텃밭을 복구하세요.",
    "dialog-note",
  );
  paragraph(
    "처음 5분은 임시 균등 배급입니다. 게시판에서 다음 5분의 몫을 정합니다. 주민에게도 식량·산소·돌봄이 필요합니다. 사망하면 처음부터 시작합니다.",
  );
  if (legacy)
    paragraph(
      "기존 탈출 버전 기록은 그대로 보관합니다. 새 v1.5 회차는 별도 저장되며 이전 기록을 정착 성공으로 변환하지 않습니다.",
    );
  button(
    hasSave
      ? "이어서 생존하기"
      : legacy
        ? "기존 기록을 보관하고 v1.5 시작"
        : "공동 온실에서 시작하기",
    () => {
      canPersist = true;
      if (save()) closeDialog();
    },
    true,
  );
  if (hasSave) button("새 회차", confirmRestart);
  focusDialog();
}

function confirmRestart() {
  showDialog("restart", "새 회차를 시작할까요?", "새로운 시작");
  paragraph(
    "현재 v1.5 회차의 농장, 배급, 의료품 선택과 정착 준비가 초기화됩니다. 이전 탈출 버전 기록은 보존합니다.",
  );
  button("취소", () =>
    state.status === "active" ? showPause() : showEnding(),
  );
  button(
    "초기화하고 시작",
    () => {
      state = newGame();
      terminalShown = false;
      saveClock = 0;
      lastPeople = "";
      lastEvent = "";
      lastObjectives = "";
      canPersist = true;
      if (save(true)) intro();
    },
    true,
  );
  focusDialog();
}

function showPause() {
  if (!ownsLock) return;
  if (state.status !== "active") {
    showEnding();
    return;
  }
  showDialog("pause", "설정 · 일시정지", "잠시 숨을 고르는 시간");
  paragraph("회차 시간이 멈췄습니다. 식량·산소·돌봄 시간은 변하지 않습니다.");
  paragraph(
    `생존 ${formatTime(state.elapsed)} · 미배정 식량 ${amount(state.food)}식 · 내 식량 ${amount(myShare().food)}식 · 겨울 비축 ${state.provisions}식`,
  );
  const motion = element("label", "", "motion-control");
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.checked = reducedMotion;
  toggle.addEventListener("change", () => {
    reducedMotion = toggle.checked;
  });
  motion.append(toggle, document.createTextNode("화면 효과 줄이기"));
  $("dialog-body").append(motion);
  button("계속하기", closeDialog, true);
  button("조작 안내", help);
  button("새 회차", confirmRestart);
  focusDialog();
}

function help() {
  if (!ownsLock) return;
  showDialog("help", "살아남기 위한 기록", "정착과 공동 배급");
  for (const line of [
    "WASD 또는 방향키로 이동합니다. 가까운 대상에 E로 대화·농사·작업합니다. Q는 내 배정 식량으로 최대 1식(허기 +35)을 먹습니다. 창고에 식량이 있어도 내 몫이 없으면 게시판에서 추가 배급해야 합니다.",
    "경작대: E 파종, E 급수, 성장 후 E 수확. 미정화 흙은 360초·1식, 첫 흙 안착 후 90초·3식입니다. 선은 치료 후에도 일하지 않으며, 홍과 DJ가 건강에 따라 농사를 돕습니다.",
    "배급은 5분마다 적용됩니다. 게시판에서 고른 안은 다음 주기부터 적용하고, 미결정이면 현재 안을 이어갑니다. 식량과 산소는 예약된 자기 몫에서만 소비합니다.",
    "온실과 O₂ 대피소에서는 내 산소 배정 잔량 안에서 충전됩니다. 오른쪽 위 원형 지도는 지역과 날씨를 보여주며 모래폭풍 중에는 사용할 수 없습니다.",
    "북쪽 잔해: 의료 키트 1개, 필터 2개, 난방 코일 1개. 남쪽과 동쪽 잔해: 수리 자재 2개, 비상 산소, 식량. 수색은 8초이며 이동하면 취소됩니다.",
    "남동쪽 누출 밸브를 E로 차단하고 급수 장치를 자재 1개로 복구합니다. 북동쪽 타워에서 자재 1개로 기반, 필터 1개와 코일 1개로 각 모듈을 설치합니다. 기술자가 돕지 못해도 란이 직접 수리할 수 있습니다.",
    "여섯 번째 경작대에서 감자를 수확한 뒤 필터 1개·미배정 식량 2식으로 배양토를 조성합니다. 처리 30초 후 직접 급수하고 정상 설비에서 90초 관찰합니다. 자원 투입 작업은 중단해도 진행을 보존합니다.",
    "선은 직접 대화해 30초 연속 돌볼 수 있습니다. 키트를 쓰면 상처 악화를 막지만 노동에 복귀하지 않습니다. 키트는 선, 홍, 온실 살균 중 한 용도로만 쓸 수 있습니다.",
    "겨울 비축 8식과 설비·흙을 마련한 뒤 최근 두 완전한 배급 주기와 현재 주기의 생존권을 점검합니다. 전원 생존, 일부 생존, 배제된 정착, 란 사망의 네 결말이 있습니다. 30분은 목표 분량이며 제한 시간이 아닙니다.",
  ])
    paragraph(line);
  button(
    "확인",
    () => (state.status === "active" ? closeDialog() : showEnding()),
    true,
  );
  focusDialog();
}

function perform(action, value, after) {
  if (!ownsLock || storageBlocked) return;
  const result = act(state, action, value);
  if (result.ok && !save()) {
    updateHUD();
    return;
  }
  if (state.status !== "active") {
    showEnding();
    return;
  }
  if (result.ok && after) after();
  $("dialog-feedback").textContent = result.message;
  updateHUD();
}

function stocks() {
  paragraph(
    `미배정 식량 ${amount(state.food)}식 · 산소 ${amount(state.oxygenStock)} · 겨울 비축 ${state.provisions}/8식`,
    "lead",
  );
  paragraph(
    `물자: 의료 키트 ${state.kits}, 정화 필터 ${state.filters}, 난방 코일 ${state.coils}, 수리 자재 ${state.parts}`,
  );
}

function allocationRows() {
  for (const [id, r] of Object.entries(state.rations)) {
    const person =
      id === "ran" ? state : state.residents.find((p) => p.id === id);
    if (id !== "ran" && !person.alive) continue;
    const record = state.currentCycle.people[id];
    paragraph(
      `${names[id]}: 건강 ${Math.ceil(person.health)} · 허기 ${Math.ceil(person.hunger)} · 산소 ${Math.ceil(person.oxygen)}${id === "ran" ? "" : ` · 사기 ${Math.ceil(person.morale)}`} / 내 몫 잔량 식량 ${amount(r.food)}식, 산소 ${amount(r.oxygen)} / 지급 누계 ${amount(record.food)}식, 산소 ${amount(record.oxygen)}`,
    );
  }
}

function discussion() {
  showDialog("board", "오늘의 몫, 내일의 흙", "다음 주기 자원 배분");
  stocks();
  paragraph(
    `현재 ${policyName(state.policy)}. 다음 적용 ${formatTime((state.cycle + 1) * 300)}. 미사용 예약분 반환을 포함한 현재 재고 기준 예상이며 실제 지급은 주기 경계에 다시 계산합니다.`,
  );
  const views = {
    contribution: {
      seon: "나는 여기 누워 있어도 숨을 쉬어. 필요한 양부터 봐 줘.",
      hong: "일하는 사람이 먼저 버텨야 설비도 돌아가.",
      dj: "방송과 돌봄은 이 계산에서 얼마나 인정받는 걸까?",
    },
    equal: {
      seon: "같은 몫을 받는 건 안심돼. 하지만 상처 난 내 호흡은 더 빨라.",
      hong: "같은 양으로 고강도 작업까지 할 수 있는지 살펴야 해.",
      dj: "같이 나눈 다음에도 부족한 사람이 있는지 확인하자.",
    },
    care: {
      seon: "오늘은 내가 더 필요하다는 걸 말해도 되는구나.",
      hong: "선에게 더 주는 이유는 알아. 수리를 맡은 내 몸도 계산해 줘.",
      dj: "아픈 사람을 돌보면서, 돌보는 사람의 소진도 봐야 해.",
    },
  };
  for (const id of Object.keys(POLICIES)) {
    const preview = policyPreview(state, id),
      section = element("section", "", "choice-section");
    section.append(element("h3", preview.name));
    section.append(
      element(
        "p",
        `주기 목표: 식량 ${amount(preview.cost.food)}식 · 산소 ${amount(preview.cost.oxygen)}. 자동 농사 작업 계수 ${POLICIES[id].work}.`,
      ),
    );
    for (const person of preview.people) {
      section.append(
        element(
          "p",
          `${person.name}: 예상 식량 ${amount(person.allocated.food)}/${person.target.food}식, 산소 ${amount(person.allocated.oxygen)}/${person.target.oxygen}. 기본 필요 식량 ${person.need.food}식, 산소 ${amount(person.need.oxygen)}.`,
        ),
      );
      section.append(
        element(
          "p",
          `현재 소모량으로 예상 고갈: 식량 ${formatTime(person.exhaustion.food)}, 산소 ${formatTime(person.exhaustion.oxygen)}${person.id === "ran" ? " (실외 이동 기준)" : ""}. 사기 변화 ${POLICIES[id].morale[person.id] ?? 0}, 낮은 건강·사기는 자동 작업을 늦춥니다.`,
        ),
      );
    }
    if (preview.shortage.food || preview.shortage.oxygen)
      section.append(
        element(
          "p",
          `부족: 식량 ${amount(preview.shortage.food)}식, 산소 ${amount(preview.shortage.oxygen)}. 재고 이상을 지급하지 않습니다.`,
        ),
      );
    for (const r of state.residents.filter((r) => r.alive))
      section.append(element("p", `${r.name}: “${views[id][r.id]}”`));
    button(
      state.nextPolicy === id
        ? `다음 주기 예약됨: ${preview.name}`
        : `다음 5분: ${preview.name}`,
      () => perform("policy", id, discussion),
      state.nextPolicy !== id,
      section,
    );
    $("dialog-body").append(section);
  }
  button("게시판으로", board);
  focusDialog();
}

function supplyDialog(back = board) {
  showDialog("supply", "부족한 몫을 더 마련하는 일", "추가 배급과 내 몫 양도");
  stocks();
  allocationRows();
  paragraph(
    "추가 배급은 공동 미배정 재고, 양도는 란의 미사용 예약분에서 빠집니다. 다른 사람에게 이미 지급한 몫을 회수하지 않습니다.",
  );
  for (const [id, name] of Object.entries(names)) {
    if (id !== "ran" && !state.residents.find((r) => r.id === id).alive)
      continue;
    const section = element("section", "", "choice-section");
    section.append(element("h3", name));
    for (const [resource, units] of [
      ["food", 0.25],
      ["oxygen", 5],
    ]) {
      const label = resource === "food" ? "식량" : "산소";
      button(
        `${label} ${units} 추가 배급`,
        () =>
          perform("supplement", { id, resource, amount: units }, () =>
            supplyDialog(back),
          ),
        false,
        section,
      );
      const target = resource === "food" ? 1 : oxygenMinimum(id);
      const shortage = target - state.currentCycle.people[id][resource];
      if (shortage > 1e-7) {
        const needed =
          resource === "food"
            ? Math.ceil(shortage * 4) / 4
            : Math.ceil(shortage / 5) * 5;
        button(
          `${label} 최저선까지 ${needed} 추가`,
          () =>
            perform("supplement", { id, resource, amount: needed }, () =>
              supplyDialog(back),
            ),
          false,
          section,
        );
      }
      if (id !== "ran")
        button(
          `내 ${label} ${units} 양도`,
          () =>
            perform("donate", { id, resource, amount: units }, () =>
              supplyDialog(back),
            ),
          false,
          section,
        );
    }
    $("dialog-body").append(section);
  }
  button("돌아가기", back);
  focusDialog();
}

function ledgerDialog() {
  showDialog("ledger", "필요한 양과 받은 양", "공동 배급 장부");
  stocks();
  allocationRows();
  const total = Object.values(state.policyTime).reduce((a, b) => a + b, 0);
  paragraph(
    `실제 적용 시간: ${Object.entries(state.policyTime)
      .map(
        ([id, t]) =>
          `${policyName(id)} ${total ? Math.round((t / total) * 100) : 0}%`,
      )
      .join(", ")}`,
  );
  for (const cycle of [...state.ledger].reverse()) {
    const section = element("section", "", "choice-section");
    section.append(
      element(
        "h3",
        `${cycle.index + 1}주기 ${formatTime(cycle.start)}~${formatTime(cycle.end)} / ${policyName(cycle.policy)}`,
      ),
    );
    for (const [id, p] of Object.entries(cycle.people))
      section.append(
        element(
          "p",
          `${names[id]}: 식량 ${amount(p.food)}식, 산소 ${amount(p.oxygen)}, 허기 0 ${amount(p.hungerZero)}초, 산소 0 ${amount(p.oxygenZero)}초${p.dead ? ", 사망" : ""}`,
        ),
      );
    section.append(
      element(
        "p",
        cycle.rights ? "생존권 최저선 충족" : cycle.rightsMissing.join(" / "),
      ),
    );
    $("dialog-body").append(section);
  }
  for (const death of state.deaths)
    paragraph(`${formatTime(death.time)} ${death.name} 사망: ${death.cause}`);
  if (!state.ledger.length)
    paragraph(
      "첫 주기를 진행 중입니다. 완료한 주기의 지급·결핍 내역이 여기에 남습니다.",
    );
  button("게시판으로", board);
  focusDialog();
}

function board() {
  showDialog("board", "공동 온실 게시판", "식량과 첫 겨울");
  stocks();
  paragraph(
    `현재 ${state.cycle + 1}주기: ${policyName(state.policy)}. 다음 ${formatTime((state.cycle + 1) * 300)}부터 ${policyName(state.nextPolicy)}.`,
  );
  paragraph(
    "일하지 못해도 회의와 도움에 접근할 수 있습니다. 다음 배급을 정하고, 실제 부족분을 살피세요.",
  );
  button("주민들과 배분 논의", discussion, true);
  button("추가 배급과 내 몫 양도", () => supplyDialog());
  button("배급 장부 보기", ledgerDialog);
  button("의료 키트 사용 비교", medicalDialog);
  button("장부 그대로 방송", () => perform("broadcast", null, board));
  button("겨울 식량 1식 비축", () => perform("reserve", null, board));
  button("비축 1식 되돌리기", () => perform("returnFood", null, board));
  button("첫 겨울 점검", finishDialog);
  button("돌아가기", closeDialog);
  focusDialog();
}

function medicalDialog() {
  showDialog("medical", "한 개의 응급 의료 키트", "사용처를 고르는 일");
  stocks();
  paragraph(
    "선 치료, 홍 선생님 증상 완화, 온실 살균 중 한 용도로만 씁니다. 확인 전에는 소모하지 않습니다.",
  );
  paragraph(
    "선: 건강 +30, 상처 악화 중단, 호흡 소모 감소. 치료 후에도 노동 불능은 유지합니다. 키트 없이 30초 직접 돌봄으로 악화를 늦출 수 있습니다.",
  );
  paragraph(
    "홍 선생님: 건강 +25, 만성질환 악화 중단. 기술 지원 여유를 마련합니다. 지원이 어려워도 란이 직접 설비를 고칠 수 있습니다.",
  );
  paragraph(
    "온실: 600초 안의 미정화 수확 4회까지 각각 식량 +1식. 필터나 난방 설비를 대체하지 않습니다.",
  );
  for (const id of ["seon", "hong", "greenhouse"])
    button(
      id === "greenhouse" ? "온실 살균 확인" : `${names[id]} 처치 확인`,
      () => confirmKit(id, medicalDialog),
    );
  button("아직 보관한다", board);
  focusDialog();
}

function confirmKit(id, back) {
  showDialog(
    "medical",
    id === "greenhouse"
      ? "온실 살균에 사용할까요?"
      : `${names[id]}에게 사용할까요?`,
    "의료 키트 1개 소모",
  );
  paragraph(
    id === "seon"
      ? "선: “걸어서 갚겠다는 약속은 못 해. 그래도 치료받고 싶어.”"
      : id === "hong"
        ? "홍 선생님: “완치는 아니어도 손에 힘이 돌아올 시간은 벌겠지. 처치를 부탁할게.”"
        : "소독 물품을 쓰면 당장의 수확에서 먹을 수 있는 부분이 늘어납니다. 주민의 상처나 질환에는 쓸 수 없게 됩니다.",
    "lead",
  );
  paragraph(
    "사용하면 다른 두 용도에는 쓸 수 없습니다. 취소하면 키트는 그대로 남습니다. 사망자는 되살릴 수 없습니다.",
  );
  button(
    id === "greenhouse"
      ? "키트 1개로 온실 살균"
      : "동의를 확인하고 키트 1개 사용",
    () => perform("kit", id, back),
    true,
  );
  button("취소", back);
  focusDialog();
}

function residentDialog(id) {
  const r = state.residents.find((person) => person.id === id);
  if (!r?.alive) {
    closeDialog();
    return;
  }
  showDialog(
    "resident",
    r.name,
    { seon: "부상자 / 노동 불능", hong: "고령의 기술자", dj: "방송과 연대" }[
      id
    ],
  );
  const record = state.currentCycle.people[id];
  const lacksShare =
    record.food < 1 - 1e-7 || record.oxygen < oxygenMinimum(id) - 1e-7;
  let line;
  if (r.oxygen < 30 || r.health < 30)
    line =
      id === "seon"
        ? "“지금은 숨과 상처부터 살펴 줘. 배급표의 숫자보다 먼저.”"
        : id === "hong"
          ? "“몸이 버티지 못하겠어. 설명은 할 수 있지만 도구는 네가 잡아 줘.”"
          : "“방송을 잠깐 멈출게. 내 몫도 부족해졌어.”";
  else if (id === "hong" && r.health < 40)
    line = "“설명은 할 수 있어. 오늘 도구는 네가 잡아 줘.”";
  else if (lacksShare)
    line =
      id === "seon"
        ? "“일하지 못하는 나는 굶어야 마땅한가? 자꾸 그런 생각이 들어.”"
        : id === "hong"
          ? "“수리를 맡은 내 몸도 계산에 넣어 줘. 이번 몫이 부족해.”"
          : "“필요한 양도 같이 적어야 해. 안 준 양만 적으면 선택처럼 보여.”";
  else if (id === "dj" && state.deaths.length)
    line =
      "“오늘은 잃은 사람의 이름부터 읽을게. 타워가 켜졌다고 없던 일이 되지는 않아.”";
  else if (state.soilSettled)
    line =
      id === "seon"
        ? "“내가 삽을 들지 못해도 이 흙을 같이 기다렸다고 말해도 되지?”"
        : id === "hong"
          ? "“몫을 남겼다고 설비가 무조건 망가지는 건 아니었군. 걱정은 아직 남아 있어.”"
          : "“오늘 방송 제목은 첫 흙이야. 아직 못 나눈 몫도 같이 읽자.”";
  else if (r.treated)
    line =
      id === "seon"
        ? "“상처가 가라앉았어. 일을 약속하지 않아도 치료해 줘서 고마워.”"
        : "“완치되진 않았어도, 점검할 여유는 생겼어.”";
  else if (id === "seon" && state.past)
    line =
      "“루이 이야기를 내 몫을 줄이는 이유로 쓰지는 말아 줘. 그때 일은 같이 기억할게.”";
  else if (id === "hong" && state.policy === "care")
    line = "“선에게 더 주는 이유는 알아. 수리를 맡은 내 몸도 계산에 넣어 줘.”";
  else if (id === "hong" && state.policy === "contribution")
    line =
      "“내가 먼저 받은 만큼 수리를 끝내겠어. 선에게 얼마가 남는지도 봤지?”";
  else
    line = {
      seon: "“다리가 낫지 않으면, 다음 배급표에도 나는 맨 아래일까?”",
      hong: "“내 손이 떨리면 밸브 하나가 늦어져. 수리하는 사람의 몸도 계산해 줘.”",
      dj: state.signal
        ? "“바깥 구역도 약이 부족해. 키트가 누구에게 가는지 숨기지는 말자.”"
        : "“효율만 따져 약자를 버리면 지구의 그 선별과 뭐가 달라질까?”",
    }[id];
  paragraph(line, "lead");
  const share = state.rations[id];
  paragraph(
    `건강 ${Math.ceil(r.health)} · 허기 ${Math.ceil(r.hunger)} · 산소 ${Math.ceil(r.oxygen)} · 사기 ${Math.ceil(r.morale)}. 배급 잔량: 식량 ${amount(share.food)}식, 산소 ${amount(share.oxygen)}.`,
  );
  paragraph(
    id === "seon"
      ? `노동하지 못해도 숨을 쉬고 식사할 권리가 있습니다. ${r.treated ? "키트 처치 완료." : `직접 돌봄 유효 시간 ${formatTime(Math.max(0, r.careUntil - state.elapsed))}.`}`
      : id === "hong"
        ? "건강 40 이상이면 기술 지원이 가능합니다. 지원이 어렵더라도 란이 수동으로 복구할 수 있습니다."
        : "방송과 돌봄도 공동체를 지탱하는 활동입니다. 반대한다고 배급권이 사라지지 않습니다.",
  );
  if (id === "seon") {
    if (!r.treated)
      button(
        "30초 직접 돌봄 시작",
        () => perform("care", "seon", closeDialog),
        true,
      );
    button("루이와 보호소에 관해 이야기", () =>
      perform("past", null, pastDialog),
    );
  }
  if (id === "seon" || id === "hong")
    button("의료 키트 처치 확인", () =>
      confirmKit(id, () => residentDialog(id)),
    );
  if (id === "dj")
    button("이번 주기 장부 방송", () =>
      perform("broadcast", null, () => residentDialog(id)),
    );
  button("내 식량 0.25식 양도", () =>
    perform("donate", { id, resource: "food", amount: 0.25 }, () =>
      residentDialog(id),
    ),
  );
  button("내 산소 20 양도", () =>
    perform("donate", { id, resource: "oxygen", amount: 20 }, () =>
      residentDialog(id),
    ),
  );
  paragraph("공동 재고의 추가 배급은 게시판이나 O₂ 대피소에서 의결합니다.");
  button("대화 마치기", closeDialog);
  focusDialog();
}

function pastDialog() {
  showDialog("resident", "루이의 이름", "란과 선의 기억");
  paragraph(
    "란: “그때는 루이 대신 너를 골랐어. 이번에도 선택만 잘하면 된다고 생각했는데, 네게 필요한 걸 묻지 않았어.”",
    "lead",
  );
  paragraph(
    "선: “루이 이야기를 내 몫을 줄이는 이유로 쓰지는 말아 줘. 그때 일은 같이 기억할게.”",
  );
  paragraph(
    "기억을 나누어도 건강과 자원이 회복되지는 않습니다. 지금의 몫과 돌봄은 따로 마련해야 합니다.",
  );
  button("선과의 대화로", () => residentDialog("seon"));
  focusDialog();
}

function towerDialog() {
  showDialog("tower", "중앙 흙 정화·난방 타워", "이곳에서 겨울을 나는 일");
  stocks();
  paragraph(
    `밸브 ${state.leakFixed ? "차단" : "미차단"} · 기반 ${state.baseFixed ? "복구" : "미복구"} · 정화 ${state.filterFixed ? "가동" : "정지"} · 난방 ${state.heatFixed ? "가동" : "정지"}`,
  );
  paragraph(
    "정화 모듈은 공동 산소 생산량을 늘리고, 난방 모듈은 거주구의 추위 피해를 막습니다. 가동 후에도 누구에게 공급할지 결정해야 합니다.",
  );
  for (const [id, title, cost] of [
    ["base", "기반 수리", "수리 자재 1"],
    ["filter", "정화 모듈 설치", "정화 필터 1"],
    ["heat", "난방 모듈 설치", "난방 코일 1"],
  ]) {
    const done = {
        base: state.baseFixed,
        filter: state.filterFixed,
        heat: state.heatFixed,
      }[id],
      project = state.projects[id];
    if (!done)
      button(
        project
          ? `${title} 이어서 · ${Math.ceil(project.remaining)}초`
          : `${title} · ${cost}`,
        () => perform(id, null, closeDialog),
        true,
      );
  }
  paragraph(
    "작업 중 이동·위험으로 중단해도 이미 투입한 자원과 진행은 설비에 남습니다. 홍의 지원이 없으면 란이 더 오래 직접 작업합니다.",
  );
  button("돌아가기", closeDialog);
  focusDialog();
}

function soilDialog() {
  showDialog("soil", "공동 텃밭의 첫 흙", "독성 화성토를 거르는 일");
  stocks();
  const phase = state.soil.phase;
  paragraph(
    {
      idle: "기존 감자를 수확해 빈 칸으로 만든 뒤 배양토를 조성할 수 있습니다.",
      processing: `처리 잔량 ${Math.ceil(state.soil.remaining)}초. 필터와 식량은 이미 투입했습니다.`,
      water: "처리를 마쳤습니다. 직접 물을 주면 새싹 관찰을 시작합니다.",
      observing: `관찰 ${Math.floor(state.soil.observed)}/90초. 모달을 닫아야 시간이 흐릅니다.`,
      settled: "싹이 검게 타지 않았어. 이 흙으로 다음 감자를 심을 수 있어.",
    }[phase],
    "lead",
  );
  if (phase === "idle" || phase === "settled")
    button("기존 감자 돌보기", () => perform("farm", null, closeDialog));
  if (phase === "idle") {
    paragraph(
      "밸브 차단·급수 복구·타워 두 모듈 가동 후, 빈 경작대에 정화 필터 1개와 미배정 식량 2식을 투입합니다.",
    );
    button(
      "배양토 조성 · 필터 1, 식량 2식",
      () => perform("soil", null, closeDialog),
      true,
    );
  } else if (phase === "processing" || phase === "water")
    button(
      phase === "water" ? "E 급수와 관찰 시작" : "배양토 처리 이어서",
      () => perform("soil", null, closeDialog),
      true,
    );
  button("돌아가기", closeDialog);
  focusDialog();
}

function shelterDialog() {
  showDialog("shelter", "O₂ 대피소 무전", "쉼터와 주민의 목소리");
  stocks();
  for (const r of state.residents.filter((r) => r.alive))
    paragraph(
      `${r.name}: “${{ hong: "수리하러 나갈 산소가 있어야 안쪽에도 공기를 보낼 수 있어.", seon: "나는 여기에 누워 있어도 숨을 쉬어. 그걸 낭비라고 부르지 마.", dj: "누구의 몫을 줄였는지까지 방송할게." }[r.id]}”`,
    );
  paragraph(
    `내 산소 예약 잔량 ${amount(myShare().oxygen)}. 들어와 쉬는 것은 누구에게나 열려 있지만 충전할 몫은 유한합니다.`,
  );
  button("추가 배급과 내 몫 양도", () => supplyDialog(shelterDialog), true);
  button("돌아가기", closeDialog);
  focusDialog();
}

function finishDialog() {
  const req = settlementRequirements(state);
  showDialog("finish", "첫 겨울 점검", "설비와 사람의 몫");
  paragraph(
    `설비·흙·비축: ${req.physical ? "준비 완료" : req.missing.join(" / ")}`,
    "lead",
  );
  paragraph(
    `최근 두 완료 주기와 현재 주기 생존권: ${req.rights ? "충족" : req.rightsMissing.join(" / ")}`,
  );
  paragraph(
    `생존: 란${req.survivors.length ? ", " + req.survivors.map((r) => r.name).join(", ") : " 혼자"}. 겨울 비축 ${state.provisions}/8식.`,
  );
  for (const d of state.deaths) paragraph(`잃은 사람: ${d.name} / ${d.cause}`);
  paragraph(
    req.rights && req.survivors.length
      ? "공동체의 첫 겨울 준비를 마치고 이번 회차를 확정합니다."
      : "지금 끝내면 생존권 또는 함께 살아남은 주민 조건을 충족하지 못한 결말입니다. 더 준비할 수 있습니다.",
  );
  const finish = button(
    req.rights && req.survivors.length
      ? "첫 겨울 준비를 마친다"
      : "이 상태로 회차를 마친다",
    () => perform("finish"),
    true,
  );
  finish.disabled = !req.physical;
  button("더 준비한다", board);
  focusDialog();
}

function openTarget(target) {
  if (target.type === "board") board();
  else if (target.type === "resident") residentDialog(target.id);
  else if (target.type === "ship") towerDialog();
  else if (target.type === "shelter") shelterDialog();
  else if (target.id === "plot-5") soilDialog();
  else if (target.type === "pump") {
    showDialog("pump", "물을 잇는 일", "공동 온실 / 급수 설비");
    paragraph(
      state.pumpFixed
        ? "자동 급수가 작동합니다. 배양토 관찰에도 물을 공급합니다."
        : "수리 자재 1개로 급수를 복구합니다. 수확과 공동 텃밭을 위해 필요한 설비입니다.",
    );
    if (!state.pumpFixed)
      button(
        "급수 복구 · 수리 자재 1",
        () => perform("pump", null, () => openTarget(target)),
        true,
      );
    button("돌아가기", closeDialog);
    focusDialog();
  }
}

function showEnding() {
  terminalShown = true;
  const ending = state.ending;
  showDialog(
    "ending",
    ending.title,
    state.status === "settled"
      ? "FIRST WINTER / 정착 기록"
      : "END OF RUN / 생존 기록",
  );
  paragraph(
    {
      dead: `란의 사망 원인: ${state.cause}`,
      together:
        "모두가 같은 일을 하지는 않았지만, 모두의 몫을 남겼다. 선은 앉아서 새싹을 보고, 홍은 다음 점검을 적고, DJ는 네 사람의 이름을 방송한다.",
      loss: "첫 흙은 남았다. 빈자리는 지워지지 않는다. 함께 살아남은 사람들은 잃은 사람의 이름과 원인을 기록한다.",
      excluded:
        "타워는 켜졌지만 닫힌 몫이 있다. 설비의 완성이 모두의 생존을 뜻하지는 않았다.",
    }[ending.id],
    "lead",
  );
  paragraph(
    `생존 ${formatTime(state.elapsed)} · 누적 수확 ${state.harvested}식 · 겨울 비축 ${state.provisions}식`,
  );
  paragraph(
    `함께 있는 사람: 란${ending.survivors.length ? ", " + ending.survivors.join(", ") : " 혼자"}. 잃은 사람: ${ending.lost.join(", ") || "없음"}.`,
  );
  paragraph(
    `실제 배분 성향: ${ending.policy === "mixed" ? "혼합" : policyName(ending.policy)}. 최저선 ${ending.rights ? "보장" : "미충족"}.`,
  );
  if (ending.id === "excluded")
    paragraph(settlementRequirements(state).rightsMissing.join(" / "));
  for (const d of state.deaths)
    paragraph(`${formatTime(d.time)} ${d.name} 사망 / ${d.cause}`);
  if (ending.id === "dead")
    paragraph(
      "사망 전으로 되돌릴 수 없습니다. 새 회차는 자원과 관계를 처음부터 시작합니다.",
    );
  button("새로운 회차 시작", confirmRestart, true);
  focusDialog();
}

function updateHUD() {
  $("clock").textContent = formatTime(state.elapsed);
  $("place").textContent = locationName(state);
  for (const name of ["health", "hunger", "oxygen"]) {
    $(name).value = state[name];
    $(`${name}-value`).textContent = Math.ceil(state[name]);
    $(`detail-${name}`).textContent = Math.ceil(state[name]);
  }
  $("food").textContent = amount(state.food);
  $("parts").textContent = materialCount();
  $("provisions").textContent = state.provisions;
  $("detail-food").textContent =
    `${amount(state.food)} / 내 몫 ${amount(myShare().food)}`;
  $("detail-parts").textContent = materialCount();
  $("detail-provisions").textContent = state.provisions;
  $("detail-harvested").textContent = state.harvested;
  $("detail-searched").textContent = state.searched.length;
  const w = weather(state);
  updateMiniMap(state);
  updateOverviewMap(state);
  $("map-button").disabled =
    !ownsLock || !canPersist || storageBlocked || !canUseMap(state);
  $("map-unavailable").hidden = !w.storm;
  $("map-button").setAttribute(
    "aria-label",
    w.storm ? "지도 연결 불가" : "전체 지도 열기",
  );
  $("weather-title").textContent = w.storm
    ? "모래폭풍"
    : w.warning
      ? "폭풍 접근"
      : "맑음";
  $("weather-icon").textContent = w.storm || w.warning ? "≋" : "☀";
  $("weather-detail").textContent =
    `${w.storm ? "종료까지" : "폭풍까지"} ${formatTime(w.remaining)}`;
  const target = nearest(state),
    jobNames = {
      search: "잔해 수색",
      care: "직접 돌봄",
      base: "타워 기반 수리",
      filter: "정화 모듈 설치",
      heat: "난방 모듈 설치",
      soil: "배양토 처리",
    };
  $("interaction").textContent = state.job
    ? `${jobNames[state.job.type]} · ${Math.ceil(state.job.remaining)}초 / 이동하면 중단`
    : target
      ? `${target.label} · E로 ${target.type === "resident" ? "대화" : "상호작용"}`
      : "WASD로 이동 · 가까운 대상에 E";
  const req = settlementRequirements(state);
  $("crew").textContent = `란과 생존 주민 ${req.survivors.length}명`;
  $("needed").textContent =
    `겨울 비축 ${state.provisions}/8식 · 생존권 ${req.rights ? "충족" : "점검 필요"}`;
  const objectives = [
    [state.leakFixed && state.pumpFixed, "누출 차단과 급수 복구"],
    [
      state.baseFixed && state.filterFixed && state.heatFixed,
      "중앙 정화·난방 타워 가동",
    ],
    [state.soilSettled, "공동 텃밭의 첫 흙 안착"],
    [state.provisions >= 8, "겨울 공동 식량 8식 비축"],
    [req.rights, "최근 두 주기와 현재의 생존권 보장"],
  ];
  const objectiveKey = JSON.stringify(objectives);
  if (objectiveKey !== lastObjectives) {
    lastObjectives = objectiveKey;
    $("objectives").replaceChildren();
    objectives.forEach(([done, label], i) => {
      const li = element("li", "", done ? "done" : "");
      li.append(
        element(
          "span",
          done ? "✓" : String(i + 1).padStart(2, "0"),
          "objective-check",
        ),
        element("span", label),
      );
      $("objectives").append(li);
    });
  }
  const peopleKey = JSON.stringify(
    state.residents.map((r) => [
      r.alive,
      Math.ceil(r.health),
      Math.ceil(r.hunger),
      Math.ceil(r.oxygen),
      Math.ceil(r.morale),
    ]),
  );
  if (peopleKey !== lastPeople) {
    lastPeople = peopleKey;
    $("residents").replaceChildren();
    for (const r of state.residents) {
      const row = element("div", "", "resident");
      row.style.setProperty(
        "--person-color",
        { seon: "#b9c88f", hong: "#d6a773", dj: "#a3b9d5" }[r.id],
      );
      const copy = element("div", "", "resident-copy");
      copy.append(
        element("strong", r.name),
        element(
          "small",
          r.alive
            ? `건강 ${Math.ceil(r.health)} · 허기 ${Math.ceil(r.hunger)} · 산소 ${Math.ceil(r.oxygen)} · 사기 ${Math.ceil(r.morale)}`
            : "사망 · 회차 내 복구 불가",
        ),
      );
      row.append(
        element("span", "", "avatar"),
        copy,
        element(
          "span",
          r.alive ? { seon: "요양", hong: "기술", dj: "방송" }[r.id] : "사망",
          "stance",
        ),
      );
      $("residents").append(row);
    }
  }
  const urgent = state.residents.find(
    (r) => r.alive && (r.health < 30 || r.hunger < 25 || r.oxygen < 30),
  );
  let radio =
    "북쪽에서 필터와 코일, 남쪽에서 수리 자재를 찾으세요. 타워를 고친 뒤 공동 텃밭의 첫 흙을 만듭니다.";
  if (state.oxygen < 30)
    radio = `란의 산소 ${Math.ceil(state.oxygen)}. 안전 구역에서도 내 배정 잔량 ${amount(myShare().oxygen)} 안에서만 충전합니다.`;
  else if (state.hunger < 25)
    radio = `란의 허기 ${Math.ceil(state.hunger)}. Q 식사에 쓸 내 몫 ${amount(myShare().food)}식. 추가 배급은 게시판이나 대피소에서 정합니다.`;
  else if (urgent)
    radio = `${urgent.name} 위기: 건강 ${Math.ceil(urgent.health)}, 허기 ${Math.ceil(urgent.hunger)}, 산소 ${Math.ceil(urgent.oxygen)}. 배급과 돌봄을 확인하세요.`;
  else if (state.elapsed - state.cycle * 300 >= 180)
    radio = `다음 배급 ${formatTime((state.cycle + 1) * 300)}: ${policyName(state.nextPolicy)}. 게시판에서 다음 안을 정하세요.`;
  else if (isSafe(state.position))
    radio = `쉼터 안입니다. 산소 예약 잔량 ${amount(myShare().oxygen)}. 주민의 몫은 게시판에서 함께 확인합니다.`;
  $("radio-message").textContent = radio;
  const danger =
    state.oxygen < 30 ||
    state.hunger < 25 ||
    state.health < 30 ||
    Boolean(urgent);
  $("danger-alert").hidden = !danger;
  if (danger) $("danger-alert").textContent = radio;
  const event = state.events[0];
  if (event && lastEvent !== `${event.time}:${event.text}`) {
    lastEvent = `${event.time}:${event.text}`;
    $("latest-log").textContent = `${formatTime(event.time)} — ${event.text}`;
    $("event-history").replaceChildren(
      ...state.events.map((e) =>
        element("li", `${formatTime(e.time)} — ${e.text}`),
      ),
    );
  }
  $("world-state").hidden = !paused || dialog.open;
  $("pause").disabled = !ownsLock || state.status !== "active";
  for (const id of ["mission-button", "player-button", "info-button"])
    $(id).disabled = !ownsLock || !canPersist || state.status !== "active";
  $("interact").disabled = paused || !target || state.status !== "active";
  $("eat").disabled =
    paused ||
    myShare().food <= 0 ||
    state.hunger > 85 ||
    state.status !== "active";
  $("eat").title = `내 배급 잔량 ${amount(myShare().food)}식으로 식사`;
}

function doInteract() {
  if (paused || !ownsLock || state.status !== "active") return;
  const result = interact(state);
  if (result?.dialog) openTarget(result.dialog);
  else if (result?.message) $("latest-log").textContent = result.message;
  save();
  updateHUD();
  if (!dialog.open) canvas.focus();
}
function eat() {
  if (paused || !ownsLock) return;
  const result = act(state, "eat");
  if (result.ok) save();
  $("latest-log").textContent = result.message;
  updateHUD();
  canvas.focus();
}

$("interact").addEventListener("click", doInteract);
$("eat").addEventListener("click", eat);
$("pause").addEventListener("click", showPause);
$("help").addEventListener("click", help);
$("map-button").addEventListener("click", () =>
  showPanel("map-panel", "화성 탐사 지도", "SECTOR 07 / 지형과 구조물"),
);
$("mission-button").addEventListener("click", () =>
  showPanel("mission-panel", "이곳에서 겨울을 나는 일", "미션 / 첫 정착"),
);
$("player-button").addEventListener("click", () =>
  showPanel("player-panel", "내 정보", "RAN / 생존 기록"),
);
$("info-button").addEventListener("click", () =>
  showPanel("info-panel", "게임 정보", "공동체 / 무전 / 기록"),
);
dialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  if (!["intro", "ending", "restart", "error", "locked"].includes(dialogKind))
    closeDialog();
});
document.addEventListener("keydown", (event) => {
  if (event.code === "Escape" && !dialog.open && ownsLock) {
    event.preventDefault();
    showPause();
    return;
  }
  if (
    paused ||
    dialog.open ||
    event.target.closest("button, input, select, textarea, a")
  )
    return;
  if (
    [
      "KeyW",
      "KeyA",
      "KeyS",
      "KeyD",
      "ArrowUp",
      "ArrowDown",
      "ArrowLeft",
      "ArrowRight",
    ].includes(event.code)
  ) {
    event.preventDefault();
    keys.add(event.code);
  }
  if (!event.repeat && event.code === "KeyE") {
    event.preventDefault();
    doInteract();
  }
  if (!event.repeat && event.code === "KeyQ") {
    event.preventDefault();
    eat();
  }
});
document.addEventListener("keyup", (event) => keys.delete(event.code));
function suspend() {
  keys.clear();
  if (ownsLock && !paused && state.status === "active") {
    paused = true;
    save();
    showPause();
  }
}
window.addEventListener("blur", suspend);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) suspend();
});
window.addEventListener("pagehide", () => {
  if (ownsLock) save();
});

function ready() {
  try {
    const saved = loadGame(localStorage);
    if (saved) {
      state = saved;
      canPersist = true;
    }
    if (state.status !== "active") showEnding();
    else intro(Boolean(saved), !saved && hasLegacyGame(localStorage));
  } catch (error) {
    showDialog("error", "저장 기록을 확인해 주세요", "저장 오류");
    paragraph(error.message);
    paragraph(
      "기존 기록은 아직 덮어쓰지 않았습니다. 새 회차를 선택하면 v1.5 기록만 초기화합니다. 이전 탈출 버전의 기록은 보존합니다.",
    );
    button(
      "기록을 초기화하고 새 회차",
      () => {
        state = newGame();
        canPersist = true;
        if (save(true)) intro();
      },
      true,
    );
    focusDialog();
  }
  updateHUD();
}

// An exclusive browser lock prevents stale saves and conflicting deaths across tabs.
if (navigator.locks) {
  navigator.locks
    .request("mars-valley-active-run", { ifAvailable: true }, async (lock) => {
      if (!lock) {
        showDialog("locked", "다른 탭에서 생존 중입니다", "중복 실행 방지");
        paragraph(
          "이 회차를 열어둔 다른 탭을 닫은 뒤 새로고침해 주세요. 동시에 실행하면 저장이 충돌할 수 있어 진행을 막았습니다.",
        );
        button("다시 확인", () => window.location.reload(), true);
        focusDialog();
        return;
      }
      ownsLock = true;
      ready();
      await new Promise((resolve) =>
        window.addEventListener("pagehide", resolve, { once: true }),
      );
      ownsLock = false;
    })
    .catch((error) => {
      showDialog("locked", "회차를 열 수 없습니다", "브라우저 실행 오류");
      paragraph(error.message);
      button("다시 확인", () => window.location.reload(), true);
      focusDialog();
    });
} else {
  showDialog("locked", "지원되는 브라우저가 필요합니다", "브라우저 호환성");
  paragraph(
    "회차 저장 충돌 방지를 위해 Web Locks를 지원하는 최신 Chrome, Edge, Firefox 또는 Safari에서 localhost 주소로 실행해 주세요.",
  );
}
window.addEventListener("pageshow", (event) => {
  if (event.persisted) window.location.reload();
});

function frame(now) {
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(canvas.clientWidth * pixelRatio));
  const height = Math.max(1, Math.round(canvas.clientHeight * pixelRatio));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const dt = Math.min(0.05, Math.max(0, (now - lastTime) / 1000));
  lastTime = now;
  let moving = false;
  if (
    !paused &&
    ownsLock &&
    !storageBlocked &&
    !document.hidden &&
    state.status === "active"
  ) {
    const dx =
      Number(keys.has("KeyD") || keys.has("ArrowRight")) -
      Number(keys.has("KeyA") || keys.has("ArrowLeft"));
    const dy =
      Number(keys.has("KeyS") || keys.has("ArrowDown")) -
      Number(keys.has("KeyW") || keys.has("ArrowUp"));
    moving = Boolean(dx || dy);
    move(state, dx, dy, dt);
    tick(state, dt);
    saveClock += dt;
    if (state.status !== "active" && !terminalShown) {
      save();
      showEnding();
    } else if (saveClock >= 2) {
      saveClock = 0;
      save();
    }
  }
  hudClock += dt;
  if (hudClock >= 0.1) {
    hudClock = 0;
    updateHUD();
  }
  render(ctx, state, moving, reducedMotion, pixelRatio);
  requestAnimationFrame(frame);
}
updateHUD();
requestAnimationFrame(frame);
