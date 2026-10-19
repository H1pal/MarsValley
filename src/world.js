export const WIDTH = 32;
export const HEIGHT = 20;
export const TILE = 32;

export const PLOTS = [
  { x: 4.5, y: 6.5 }, { x: 6.5, y: 6.5 }, { x: 8.5, y: 6.5 },
  { x: 4.5, y: 8.5 }, { x: 6.5, y: 8.5 }, { x: 8.5, y: 8.5 },
];

export const OBJECTS = [
  ...PLOTS.map((p, i) => ({ ...p, id: `plot-${i}`, type: 'plot', label: '공동 경작대' })),
  { id: 'board', type: 'board', x: 3.5, y: 4.5, label: '공동체 게시판' },
  { id: 'pump', type: 'pump', x: 10.5, y: 4.5, label: '급수 장치' },
  { id: 'ship', type: 'ship', x: 28.5, y: 5.5, label: '탈출선' },
  { id: 'valve', type: 'valve', x: 24.5, y: 13.5, label: '누출 차단 밸브' },
  { id: 'signal', type: 'signal', x: 21.5, y: 3.5, label: '낡은 통신기' },
  ...[{ x: 16.5, y: 4.5 }, { x: 19.5, y: 6.5 }, { x: 17.5, y: 15.5 },
    { x: 23.5, y: 16.5 }, { x: 28.5, y: 17.5 }, { x: 29.5, y: 11.5 }]
    .map((p, i) => ({ ...p, id: `scrap-${i}`, type: 'scrap', label: '캡슐 잔해' })),
];

export function terrain(x, y) {
  const tx = Math.floor(x), ty = Math.floor(y);
  if (tx <= 0 || ty <= 0 || tx >= WIDTH - 1 || ty >= HEIGHT - 1) return 'wall';
  if (tx >= 1 && tx <= 12 && ty >= 2 && ty <= 17) {
    if (tx === 1 || ty === 2 || (ty === 17 && tx !== 7) || (tx === 12 && ty !== 10)) return 'wall';
    return 'greenhouse';
  }
  if ((tx === 16 && ty >= 7 && ty <= 11 && ty !== 9)
      || (ty === 14 && tx >= 19 && tx <= 21)) return 'crack';
  if (tx >= 21 && tx <= 23 && ty >= 9 && ty <= 11) return 'shelter';
  if (tx >= 24 && tx <= 30 && ty >= 13 && ty <= 18) return 'facility';
  if (tx >= 26 && tx <= 30 && ty >= 3 && ty <= 7) return 'pad';
  return 'sand';
}

export function isSafe(position) {
  return ['greenhouse', 'shelter'].includes(terrain(position.x, position.y));
}

export function inLeak(position) {
  return position.x >= 26 && position.x < 30 && position.y >= 14 && position.y < 18;
}

export function canStand(x, y) {
  const radius = 0.23;
  for (const dx of [-radius, radius]) {
    for (const dy of [-radius, radius]) {
      if (['wall', 'crack'].includes(terrain(x + dx, y + dy))) return false;
    }
  }
  return !OBJECTS.some(o => Math.abs(o.x - x) < 0.57 && Math.abs(o.y - y) < 0.57);
}

export function residentPosition(state, resident) {
  if (resident.id === 'seon' && state.rescue === 'active') return { x: 27.5, y: 15.5 };
  const home = { seon: { x: 4.5, y: 12.5 }, hong: { x: 7.5, y: 12.5 }, dj: { x: 10.5, y: 12.5 } };
  if (!resident.alive || resident.id === 'dj') return home[resident.id];
  // A small deterministic work route: no separate AI or pathfinding system.
  const phase = state.elapsed % 30;
  const offset = phase < 10 ? phase / 10 : phase < 20 ? 1 : (30 - phase) / 10;
  return { x: home[resident.id].x, y: home[resident.id].y - offset * 2 };
}

export function nearest(state) {
  const targets = [...OBJECTS, ...state.residents.filter(r => r.alive).map(r => ({
    ...residentPosition(state, r), id: r.id, type: 'resident', label: r.name,
  }))];
  return targets.map(o => ({ ...o, distance: Math.hypot(o.x - state.position.x, o.y - state.position.y) }))
    .filter(o => o.distance <= 1.6).sort((a, b) => a.distance - b.distance)[0] ?? null;
}
