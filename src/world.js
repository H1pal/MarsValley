export const WIDTH = 64;
export const HEIGHT = 40;
export const TILE = 32;

// Region geometry is shared by collision, safety checks, and drawing.
export const GREENHOUSE_OFFSET = { x: 4, y: 10 };
export const SPAWN = { x: 11.5, y: 24.5 };
export const REGIONS = {
  greenhouse: { x: 5, y: 12, width: 12, height: 16 },
  wreck: { x: 25, y: 4, width: 19, height: 13 },
  shelter: { x: 34, y: 20, width: 5, height: 4 },
  facility: { x: 48, y: 28, width: 12, height: 9 },
  pad: { x: 54, y: 4, width: 8, height: 7 },
};
export const LEAK = { x: 51, y: 30, width: 5, height: 5 };
export const RESCUE_POSITION = { x: 53.5, y: 32.5 };
export const TRAILS = [
  [
    { x: 16.5, y: 20.5 },
    { x: 36.5, y: 20.5 },
  ],
  [
    { x: 29.5, y: 20.5 },
    { x: 29.5, y: 10.5 },
  ],
  [
    { x: 36.5, y: 21.5 },
    { x: 50.5, y: 21.5 },
    { x: 50.5, y: 8.5 },
    { x: 58.5, y: 8.5 },
  ],
  [
    { x: 49.5, y: 21.5 },
    { x: 49.5, y: 29.5 },
  ],
];
export function contains(region, x, y) {
  return (
    x >= region.x &&
    x < region.x + region.width &&
    y >= region.y &&
    y < region.y + region.height
  );
}

export const PLOTS = [
  { x: 4.5, y: 6.5 },
  { x: 6.5, y: 6.5 },
  { x: 8.5, y: 6.5 },
  { x: 4.5, y: 8.5 },
  { x: 6.5, y: 8.5 },
  { x: 8.5, y: 8.5 },
].map((p) => ({ x: p.x + GREENHOUSE_OFFSET.x, y: p.y + GREENHOUSE_OFFSET.y }));

export const OBJECTS = [
  ...PLOTS.map((p, i) => ({
    ...p,
    id: `plot-${i}`,
    type: "plot",
    label: "공동 경작대",
  })),
  { id: "board", type: "board", x: 7.5, y: 14.5, label: "공동체 게시판" },
  { id: "pump", type: "pump", x: 14.5, y: 14.5, label: "급수 장치" },
  {
    id: "ship",
    type: "ship",
    x: 58.5,
    y: 7.5,
    label: "중앙 흙 정화·난방 타워",
  },
  { id: "valve", type: "valve", x: 48.5, y: 29.5, label: "누출 차단 밸브" },
  { id: "signal", type: "signal", x: 43.5, y: 5.5, label: "낡은 통신기" },
  ...[
    { x: 26.5, y: 7.5 },
    { x: 35.5, y: 10.5 },
    { x: 41.5, y: 14.5 },
    { x: 26.5, y: 31.5 },
    { x: 54.5, y: 34.5 },
    { x: 58.5, y: 24.5 },
  ].map((p, i) => ({
    ...p,
    id: `scrap-${i}`,
    type: "scrap",
    label: `캡슐 잔해 · ${["의료 키트 1개", "정화 필터 2개", "난방 코일 1개", "수리 자재 2개", "비상 산소 120", "공동 식량 2식"][i]}`,
  })),
];

export function terrain(x, y) {
  const tx = Math.floor(x),
    ty = Math.floor(y);
  if (tx <= 0 || ty <= 0 || tx >= WIDTH - 1 || ty >= HEIGHT - 1) return "wall";
  if (contains(REGIONS.greenhouse, tx, ty)) {
    const localX = tx - GREENHOUSE_OFFSET.x,
      localY = ty - GREENHOUSE_OFFSET.y;
    if (
      localX === 1 ||
      localY === 2 ||
      (localY === 17 && localX !== 7) ||
      (localX === 12 && localY !== 10)
    )
      return "wall";
    return "greenhouse";
  }
  if (
    (tx === 24 && ty >= 17 && ty <= 25 && ty !== 20 && ty !== 21) ||
    (ty === 27 && tx >= 36 && tx <= 43 && tx !== 40) ||
    (tx === 46 && ty >= 6 && ty <= 17 && ty !== 10 && ty !== 11)
  )
    return "crack";
  for (const name of ["shelter", "facility", "pad"])
    if (contains(REGIONS[name], tx, ty)) return name;
  return "sand";
}

export function isSafe(position) {
  return ["greenhouse", "shelter"].includes(terrain(position.x, position.y));
}

export function inLeak(position) {
  return contains(LEAK, position.x, position.y);
}

export function canStand(x, y) {
  const radius = 0.23;
  for (const dx of [-radius, radius]) {
    for (const dy of [-radius, radius]) {
      if (["wall", "crack"].includes(terrain(x + dx, y + dy))) return false;
    }
  }
  return !OBJECTS.some(
    (o) => Math.abs(o.x - x) < 0.57 && Math.abs(o.y - y) < 0.57,
  );
}

export function residentPosition(state, resident) {
  const home = {
    seon: { x: 4.5, y: 12.5 },
    hong: { x: 7.5, y: 12.5 },
    dj: { x: 10.5, y: 12.5 },
  };
  for (const p of Object.values(home)) {
    p.x += GREENHOUSE_OFFSET.x;
    p.y += GREENHOUSE_OFFSET.y;
  }
  if (!resident.alive || resident.id === "seon" || resident.id === "dj")
    return home[resident.id];
  // A small deterministic work route: no separate AI or pathfinding system.
  const phase = state.elapsed % 30;
  const offset = phase < 10 ? phase / 10 : phase < 20 ? 1 : (30 - phase) / 10;
  return { x: home[resident.id].x, y: home[resident.id].y - offset * 2 };
}

export function nearest(state) {
  const targets = [
    ...OBJECTS,
    ...state.residents
      .filter((r) => r.alive)
      .map((r) => ({
        ...residentPosition(state, r),
        id: r.id,
        type: "resident",
        label: r.name,
      })),
  ];
  const target = targets
    .map((o) => ({
      ...o,
      distance: Math.hypot(o.x - state.position.x, o.y - state.position.y),
    }))
    .filter((o) => o.distance <= 1.6)
    .sort((a, b) => a.distance - b.distance)[0];
  return (
    target ??
    (contains(REGIONS.shelter, state.position.x, state.position.y)
      ? {
          ...state.position,
          id: "shelter",
          type: "shelter",
          label: "O₂ 대피소 무전",
          distance: 0,
        }
      : null)
  );
}
