import { WIDTH, HEIGHT, REGIONS, OBJECTS, TRAILS, terrain } from './world.js';
import { weather } from './game.js';

export function canUseMap(state) { return state.status === 'active' && !weather(state).storm; }

// Both maps use the world's tile coordinates directly, independently of the camera.
export function createMapView(svg, detailed = false) {
  const node = (tag, attrs, content) => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    if (content) el.textContent = content;
    svg.append(el); return el;
  };
  svg.setAttribute('viewBox', detailed ? `-3 -3 ${WIDTH + 6} ${HEIGHT + 6}` : '-5 -17 74 74');
  node('rect', { x: 0, y: 0, width: WIDTH, height: HEIGHT, rx: 1, fill: '#593e30', stroke: '#c7a77a', 'stroke-width': .25 });
  let obstacles = '';
  for (let y = 0; y < HEIGHT; y++) for (let x = 0; x < WIDTH; x++) {
    if (['wall', 'crack'].includes(terrain(x, y))) obstacles += `M${x} ${y}h1v1h-1z`;
  }
  node('path', { d: obstacles, fill: '#2c2924' });
  for (const trail of TRAILS) node('polyline', { points: trail.map(p => `${p.x},${p.y}`).join(' '), fill: 'none', stroke: '#c1a477', 'stroke-width': .3, 'stroke-dasharray': '.8 .6' });
  const names = { greenhouse: '공동 온실', wreck: '캡슐 잔해', shelter: 'O₂ 대피소', facility: '폐쇄 설비', pad: '중앙 타워' };
  const colors = { greenhouse: '#92ac7e', wreck: '#d1a365', shelter: '#83c7ca', facility: '#c89078', pad: '#d6cbb0' };
  for (const [key, r] of Object.entries(REGIONS)) {
    node('rect', { ...r, rx: .5, fill: colors[key], 'fill-opacity': .3, stroke: colors[key], 'stroke-width': .4 });
    if (detailed) node('text', { x: r.x + r.width / 2, y: r.y - 1, fill: '#fff0d1', 'font-size': 2, 'text-anchor': 'middle' }, names[key]);
  }
  for (const o of OBJECTS.filter(o => o.type !== 'plot')) {
    const marker = node('rect', { x: o.x - .5, y: o.y - .5, width: 1, height: 1, fill: o.type === 'scrap' ? '#e2ba77' : '#d9e5cd', stroke: '#252a23', 'stroke-width': .15 });
    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title'); title.textContent = o.label; marker.append(title);
  }
  const player = node('circle', { r: detailed ? .8 : 1.25, fill: '#fff2a3', stroke: '#233a39', 'stroke-width': .4, class: 'map-player' });
  return state => {
    const available = canUseMap(state);
    svg.style.display = available ? '' : 'none';
    if (available) { player.setAttribute('cx', state.position.x); player.setAttribute('cy', state.position.y); }
  };
}
