import test from 'node:test';
import assert from 'node:assert/strict';
import { act, interact, move, newGame, policyPreview, POLICIES, settlementRequirements, tick, weather } from '../src/game.js';
import { OBJECTS, nearest, canStand, residentPosition, REGIONS } from '../src/world.js';

function seconds(state, amount) { for (let i = 0; i < amount; i++) tick(state, 1); }
function approach(state, id) {
  const object = OBJECTS.find(o => o.id === id) ?? residentPosition(state, state.residents.find(r => r.id === id));
  state.position = { x: object.x, y: object.y + 1 };
  assert.equal(nearest(state)?.id, id);
}
function alive(state) { return state.residents.filter(r => r.alive); }
function reservoir(state) { return state.oxygenStock + Object.values(state.rations).reduce((a, r) => a + r.oxygen, 0); }

 test('initial reservations are finite and policy totals follow the specification', () => {
  const s = newGame();
  assert.equal(s.version, 3); assert.equal(s.food, 2); assert.equal(s.oxygenStock, 200);
  assert.deepEqual(s.rations.ran, { food: 1, oxygen: 100 });
  for (const [id, food, oxygen] of [['contribution', 3, 300], ['equal', 4, 400], ['care', 5, 360]]) {
    const p = policyPreview(s, id); assert.deepEqual(p.cost, { food, oxygen });
    assert.equal(Object.values(POLICIES[id].food).reduce((a,b) => a+b), food);
  }
});

test('policies change only at an exact boundary, preserve reservations, and rotate quarter ties', () => {
  const s = newGame(); approach(s, 'board'); const before = structuredClone(s.rations);
  assert.equal(act(s, 'policy', 'contribution').ok, true); act(s, 'policy', 'care');
  assert.deepEqual(s.rations, before); assert.equal(s.policy, 'equal');
  seconds(s, 299); tick(s, 1); assert.equal(s.cycle, 1); assert.equal(s.policy, 'care'); assert.equal(s.ledger.length, 1);
  const noFood = newGame(); noFood.food = 0.25; Object.values(noFood.rations).forEach(r => { r.food = 0; });
  const a = policyPreview(noFood, 'equal').food; noFood.cycle++;
  const b = policyPreview(noFood, 'equal').food; assert.notDeepEqual(a, b);
  assert.equal(Object.values(a).reduce((x,y) => x+y), 0.25);
});

test('Q consumes only own quarters and safe-zone oxygen cannot exceed own reservation', () => {
  const s = newGame(); s.hunger = 50; s.rations.ran.food = 0.25; const food = s.food;
  assert.equal(act(s, 'eat').ok, true); assert.equal(s.hunger, 58.75); assert.equal(s.food, food);
  assert.equal(act(s, 'eat').ok, false);
  s.oxygen = 0; s.rations.ran.oxygen = 3; tick(s, 1); assert.equal(s.oxygen, 3); assert.equal(s.rations.ran.oxygen, 0);
  seconds(s, 10); assert.equal(s.oxygen, 3); assert.ok(reservoir(s) <= 600.000001);
});

test('supplement and donation validate quarter amounts and conserve actual rights', () => {
  const s = newGame(); approach(s, 'board'); const food = s.food;
  assert.equal(act(s, 'supplement', { id: 'seon', resource: 'food', amount: 0.1 }).ok, false);
  assert.equal(s.food, food);
  assert.equal(act(s, 'supplement', { id: 'seon', resource: 'food', amount: 0.25 }).ok, true);
  assert.equal(s.food, food - 0.25); assert.equal(s.currentCycle.people.seon.food, 1.25);
  assert.equal(act(s, 'donate', { id: 'seon', resource: 'oxygen', amount: 20 }).ok, true);
  assert.equal(s.rations.ran.oxygen, 80); assert.equal(s.currentCycle.people.ran.oxygen, 80);
  assert.equal(s.currentCycle.people.seon.oxygen, 120);
  assert.equal(act(s, 'donate', { id: 'seon', resource: 'oxygen', amount: 100 }).ok, false);
});

test('salvage gives its exact unique supplies only after eight uninterrupted seconds', () => {
  const s = newGame(); approach(s, 'scrap-0'); interact(s); move(s, 0, 1, 0.1); assert.equal(s.job, null);
  const rewards = [['scrap-0','kits',1],['scrap-1','filters',2],['scrap-2','coils',1],['scrap-3','parts',2]];
  for (const [id, field, count] of rewards) {
    approach(s,id); interact(s); seconds(s,7); assert.equal(s[field],0); tick(s,1); assert.equal(s[field],count);
    interact(s); seconds(s,8); assert.equal(s[field],count);
  }
});

test('medical kit has mutually exclusive uses and Seon never joins farming', () => {
  for (const id of ['seon', 'hong', 'greenhouse']) {
    const s = newGame(); approach(s, 'board'); s.kits = 1;
    assert.equal(act(s, 'kit', id).ok, true); assert.equal(s.kits,0);
    assert.equal(act(s, 'kit', id === 'seon' ? 'hong' : 'seon').ok,false);
    assert.equal(s.filters,0); assert.equal(s.coils,0);
    if (id === 'greenhouse') { assert.equal(s.sterilization.remaining,4); seconds(s,40); assert.equal(s.harvested,4); assert.equal(s.sterilization.remaining,2); }
    if (id === 'seon') { s.residents.slice(1).forEach(r => { r.health=20; }); seconds(s,40); assert.equal(s.harvested,0); }
  }
});

test('care restarts after interruption, heals once per cycle, and has no instant click benefit', () => {
  const s = newGame(); approach(s,'seon'); const seon=s.residents[0]; const initial=seon.health;
  assert.equal(act(s,'care','seon').ok,true); seconds(s,20); move(s,0,1,0.1);
  assert.equal(seon.careUntil,0); approach(s,'seon'); act(s,'care','seon'); assert.equal(s.job.remaining,30);
  seconds(s,30); assert.ok(seon.health > initial); const h=seon.health;
  act(s,'care','seon'); seconds(s,30); assert.ok(seon.health < h); assert.ok(seon.careUntil > s.elapsed);
});

test('paid projects preserve progress and use Hong speed at first start, with a manual alternative', () => {
  const s=newGame(); approach(s,'ship'); s.parts=1; assert.equal(act(s,'base').ok,false);
  s.leakFixed=true; assert.equal(act(s,'base').ok,true); assert.equal(s.parts,0); assert.equal(s.job.duration,30);
  seconds(s,10); move(s,0,1,0.1); assert.equal(s.projects.base.remaining,20);
  approach(s,'ship'); s.residents[1].health=1; act(s,'base'); assert.equal(s.job.remaining,20); seconds(s,20); assert.equal(s.baseFixed,true);
  s.filters=1; act(s,'filter'); assert.equal(s.job.duration,60); seconds(s,60); assert.equal(s.filterFixed,true);
  assert.equal(act(s,'filter').ok,false); assert.equal(s.filters,0);
});

test('soil costs are persistent, excludes auto work and observes ninety valid seconds', () => {
  const s=newGame(); s.leakFixed=s.pumpFixed=s.baseFixed=s.filterFixed=s.heatFixed=true; s.filters=1; s.food=10;
  s.crops[5]={ planted:false,watered:false,growth:0 }; approach(s,'plot-5');
  act(s,'soil'); seconds(s,10); move(s,0,1,0.1); assert.equal(s.soil.remaining,20); assert.equal(s.food,8);
  approach(s,'plot-5'); act(s,'soil'); seconds(s,20); assert.equal(s.soil.phase,'water');
  act(s,'soil'); seconds(s,40); s.heatFixed=false; seconds(s,20); assert.equal(s.soil.observed,40);
  s.heatFixed=true; seconds(s,49); assert.equal(s.soilSettled,false); tick(s,1); assert.equal(s.soilSettled,true);
  assert.equal(s.filters,0); assert.equal(s.crops[5].planted,false);
});

test('rights use integral Seon needs, recent complete windows, current full quotas and historical deprivation', () => {
  const s=newGame(); s.soilSettled=true; s.soil.phase='settled'; s.soil.settledAt=0;
  s.pumpFixed=s.leakFixed=s.baseFixed=s.filterFixed=s.heatFixed=true; s.provisions=8;
  approach(s,'board'); s.kits=1; seconds(s,150); act(s,'kit','seon'); seconds(s,150);
  assert.ok(Math.abs(s.ledger[0].people.seon.seonNeed-75)<1e-8);
  assert.equal(settlementRequirements(s).rights,false);
  // Feed a synthetic completed window to inspect rules independently of growth balance.
  const complete=structuredClone(s.ledger[0]); complete.index=1; complete.start=300; complete.end=600;
  s.ledger.push(complete); assert.equal(settlementRequirements(s).rights,true);
  s.currentCycle.people.ran.oxygen=59; assert.equal(settlementRequirements(s).rights,false);
  s.currentCycle.people.ran.oxygen=100; s.ledger[1].people.dj.oxygenZero=10; assert.equal(settlementRequirements(s).rights,false);
  s.ledger[1].people.dj.oxygenZero=0; s.ledger[1].people.dj.dead=true; assert.equal(settlementRequirements(s).rights,false);
});

test('terminal death blocks all future mutations and resident deaths remain in cycle/death ledger', () => {
  const s=newGame(); s.residents[0].health=0.001; tick(s,1);
  assert.equal(s.residents[0].alive,false); assert.equal(s.deaths[0].id,'seon'); assert.equal(s.currentCycle.people.seon.dead,true);
  const before=s.oxygenStock; tick(s,1); assert.ok(s.oxygenStock-before < 2);
  s.position={x:18,y:12}; s.oxygen=0; s.health=4; tick(s,1); assert.equal(s.status,'dead'); assert.equal(s.cause,'산소 고갈');
  const snapshot=structuredClone(s); tick(s,1);move(s,1,0,0.1);interact(s);act(s,'eat');assert.deepEqual(s,snapshot);
});

test('movement collisions, normalized diagonals, weather and all static approaches remain valid', () => {
  assert.equal(canStand(REGIONS.greenhouse.x+0.5,REGIONS.greenhouse.y+3),false);
  const a=newGame(),b=newGame(); a.position={x:18,y:10};b.position={...a.position};move(a,1,0,0.1);move(b,1,1,0.1);
  assert.ok(Math.abs(Math.hypot(a.position.x-18,a.position.y-10)-Math.hypot(b.position.x-18,b.position.y-10))<1e-9);
  a.elapsed=240;assert.equal(weather(a).storm,true);
  const s=newGame(),queue=[s.position],seen=new Set(),targets=new Set();
  for(let i=0;i<queue.length;i++){const p=queue[i],key=`${p.x},${p.y}`;if(seen.has(key)||!canStand(p.x,p.y))continue;seen.add(key);s.position=p;const t=nearest(s);if(t)targets.add(t.id);for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]])queue.push({x:p.x+dx,y:p.y+dy});}
  for(const object of OBJECTS)assert.ok(targets.has(object.id),object.id);
});

test('reserve uses unallocated food and fixed eight meals never decreases with deaths',()=>{
  const s=newGame();approach(s,'board');assert.equal(act(s,'reserve').ok,false);s.food=5;assert.equal(act(s,'reserve').ok,true);assert.equal(s.food,4);assert.equal(s.provisions,1);
  assert.equal(act(s,'returnFood').ok,true);assert.equal(s.food,5);assert.equal(s.provisions,0);assert.equal(settlementRequirements(s).needed,8);assert.equal(alive(s).length,3);
});

test('short-stock allocation and death returns conserve food and stored oxygen',()=>{
  const s=newGame();s.food=0.75;Object.values(s.rations).forEach(r=>{r.food=0;r.oxygen=0;});s.oxygenStock=7.8;
  const preview=policyPreview(s,'care');
  assert.equal(Object.values(preview.food).reduce((a,b)=>a+b),0.75);
  assert.equal(Object.values(preview.oxygen).reduce((a,b)=>a+b),7);
  assert.ok(Object.values(preview.food).every(v=>v>=0&&Number.isInteger(v*4)));
  s.residents[0].health=0.001;s.rations.seon={food:0.5,oxygen:5};s.currentCycle.people.seon.food=0.5;s.currentCycle.people.seon.oxygen=5;
  const totalFood=s.food+Object.values(s.rations).reduce((a,r)=>a+r.food,0);
  tick(s,1);assert.equal(s.residents[0].alive,false);
  assert.equal(s.food+Object.values(s.rations).reduce((a,r)=>a+r.food,0)+s.currentCycle.people.seon.foodUsed,totalFood);
  const returned=s.food;tick(s,1);assert.equal(s.food,returned);
  assert.equal(s.currentCycle.people.seon.dead,true);
});

test('care need is current, starvation time cannot be repaired by last-second supplies, and morale changes once',()=>{
  const s=newGame();approach(s,'board');act(s,'policy','contribution');
  const morale=s.residents.map(r=>r.morale);seconds(s,299);assert.deepEqual(s.residents.map(r=>r.morale),morale);tick(s,1);
  assert.deepEqual(s.residents.map(r=>r.morale),[morale[0]+2,morale[1]-2,morale[2]+4]);
  act(s,'policy','equal');act(s,'policy','equal');assert.equal(s.policy,'contribution');
  s.currentCycle.people.seon.hungerZero=30;s.food=1;
  assert.equal(act(s,'supplement',{id:'seon',resource:'food',amount:1}).ok,true);
  assert.ok(settlementRequirements(s).current.missing.some(x=>x.includes('굶주림')));
});

function readyEnding(s){
  s.leakFixed=s.pumpFixed=s.baseFixed=s.filterFixed=s.heatFixed=s.soilSettled=true;s.soil={phase:'settled',remaining:0,observed:90,settledAt:0};s.provisions=8;
  s.residents.forEach(r=>{if(r.id==='seon'){r.treated=true;r.treatedAt=0;}});
  const people=Object.fromEntries(['ran',...s.residents.filter(r=>r.alive).map(r=>r.id)].map(id=>[id,{food:1,oxygen:100,foodUsed:0,oxygenUsed:0,hungerZero:0,oxygenZero:0,seonNeed:id==='seon'?60:0,care:false,treated:id==='seon',dead:false}]));
  s.elapsed=600;s.cycle=2;s.policyTime.equal=600;
  s.ledger=[0,1].map(index=>({index,start:index*300,end:(index+1)*300,policy:'equal',broadcast:false,people:structuredClone(people),rights:true,rightsMissing:[]}));
  s.currentCycle={index:2,start:600,policy:'equal',broadcast:false,people:structuredClone(people)};
  if(s.currentCycle.people.seon)s.currentCycle.people.seon.seonNeed=0;
  approach(s,'board');
}
test('four endings are exclusive and finish rechecks current quota and physical requirements',()=>{
  const together=newGame();readyEnding(together);assert.equal(act(together,'finish').ok,true);assert.equal(together.ending.id,'together');
  const loss=newGame();loss.residents[1].alive=false;loss.residents[1].health=0;loss.deaths.push({id:'hong',name:'홍 선생님',time:1,cause:'만성질환'});readyEnding(loss);
  assert.equal(act(loss,'finish').ok,true);assert.equal(loss.ending.id,'loss');assert.deepEqual(loss.ending.lost,['홍 선생님']);
  const excluded=newGame();readyEnding(excluded);excluded.currentCycle.people.ran.food=0.75;assert.equal(act(excluded,'finish').ok,true);assert.equal(excluded.status,'failed');assert.equal(excluded.ending.id,'excluded');
  const solo=newGame();solo.residents.forEach(r=>{r.alive=false;r.health=0;});readyEnding(solo);act(solo,'finish');assert.equal(solo.ending.id,'excluded');
  const unfinished=newGame();approach(unfinished,'board');assert.equal(act(unfinished,'finish').ok,false);
  const dead=newGame();dead.position={x:18,y:12};dead.oxygen=0;dead.health=1;tick(dead,1);assert.equal(dead.ending.id,'dead');assert.equal(act(dead,'finish').ok,false);
});

test('sterilization expires, never buffs settled harvest, and repeated broadcast has no reward',()=>{
  const s=newGame();s.kits=1;approach(s,'board');act(s,'kit','greenhouse');
  const before=s.residents.map(r=>r.morale);act(s,'broadcast');assert.equal(act(s,'broadcast').ok,false);assert.deepEqual(s.residents.map(r=>r.morale),before);
  s.sterilization.until=1;tick(s,1);assert.equal(s.sterilization.remaining,0);
  s.soilSettled=true;s.soil.phase='settled';s.crops[0]={planted:true,watered:true,growth:90};s.sterilization={until:100,remaining:4};
  approach(s,'plot-0');const food=s.food;interact(s);assert.equal(s.food,food+3);assert.equal(s.sterilization.remaining,4);
});
