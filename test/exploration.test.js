import test from 'node:test';
import assert from 'node:assert/strict';
import { act, interact, move, newGame, settlementRequirements, tick, weather } from '../src/game.js';
import { validateSave } from '../src/storage.js';
import { OBJECTS, canStand, isSafe, nearest, REGIONS, RESCUE_POSITION, residentPosition, inLeak } from '../src/world.js';

function approach(state, id) {
  const object=OBJECTS.find(o=>o.id===id) ?? residentPosition(state,state.residents.find(r=>r.id===id));
  state.position={x:object.x,y:object.y+1}; assert.equal(nearest(state)?.id,id);
}
function wait(state, seconds) {
  for(let i=0;i<seconds;i++) { if(state.hunger<65)act(state,'eat'); tick(state,1); assert.equal(state.status,'active'); }
}
function action(state, name, value) { const result=act(state,name,value);assert.equal(result.ok,true,`${name}: ${result.message}`); }
function support(state) {
  if(!state.residents[0].treated) { approach(state,'seon'); action(state,'care','seon');wait(state,30); }
}

// Direct actions isolate game balance from travel skill; every cost and second is real.
for(const [kit, policy] of [['seon','equal'],['hong','equal'],['greenhouse','equal'],['seon','contribution'],['seon','care']])test(`all four settle within 30 minutes: ${policy} policy, ${kit} kit`,()=>{
  const s=newGame();
  for(const id of ['plot-0','plot-1']){approach(s,id);interact(s);}
  for(const id of ['scrap-0','scrap-1','scrap-2','scrap-3','scrap-5']){approach(s,id);interact(s);wait(s,8);}
  approach(s,'board');action(s,'kit',kit);action(s,'policy',policy);
  support(s);
  approach(s,'valve');interact(s);approach(s,'pump');action(s,'pump');
  approach(s,'ship');
  for(const name of ['base','filter','heat']){action(s,name);while(s.job)wait(s,1);}
  s.position={...newGame().position};
  // Auto growers fill the six plots; harvest the reserved conversion plot at maturity.
  while(s.crops[5].planted && s.crops[5].growth<360 || s.elapsed<360){
    if(!s.residents[0].treated && s.residents[0].careUntil-s.elapsed<45)support(s);
    s.position={...newGame().position};wait(s,1);
  }
  approach(s,'plot-5');
  if(s.crops[5].planted)action(s,'farm');
  action(s,'soil');wait(s,30);action(s,'soil');
  s.position={...newGame().position};wait(s,90);assert.equal(s.soilSettled,true);
  while(s.elapsed<1800 && !settlementRequirements(s).rights){
    approach(s,'board');
    for(const [id,p] of Object.entries(s.currentCycle.people)){
      if(p.food<1 && s.food>=1-p.food)action(s,'supplement',{id,resource:'food',amount:1-p.food});
      const amount=Math.ceil(Math.max(0,60-p.oxygen)/5)*5;
      if(amount && s.oxygenStock>=amount)action(s,'supplement',{id,resource:'oxygen',amount});
    }
    if(!s.residents[0].treated && s.residents[0].careUntil-s.elapsed<45)support(s);
    s.position={...newGame().position};wait(s,1);
  }
  approach(s,'board');
  while(s.provisions<8)action(s,'reserve');
  assert.ok(s.elapsed<1800);assert.equal(s.residents.every(r=>r.alive),true);
  assert.equal(settlementRequirements(s).physical,true);assert.equal(settlementRequirements(s).rights,true);
  assert.equal(validateSave(s),true,'complete active route remains saveable');
  action(s,'finish');assert.equal(s.status,'settled');assert.equal(s.ending.id,'together');assert.equal(validateSave(s),true,'settlement evidence remains saveable');
  const snapshot=structuredClone(s);tick(s,1);act(s,'eat');interact(s);assert.deepEqual(s,snapshot);
});

// Traverse the unchanged map through real movement and survival ticks.
function walk(state,goal){
  const queue=[{position:{...state.position},previous:-1}],seen=new Set([`${state.position.x},${state.position.y}`]);let end=-1;
  for(let i=0;i<queue.length;i++){
    const {position}=queue[i];if(goal(position)){end=i;break;}
    for(const[dx,dy]of [[1,0],[-1,0],[0,1],[0,-1]]){const p={x:position.x+dx,y:position.y+dy},key=`${p.x},${p.y}`;if(seen.has(key)||!canStand(p.x,p.y)||(!state.leakFixed&&inLeak(p)))continue;seen.add(key);queue.push({position:p,previous:i});}
  }
  assert.notEqual(end,-1);const path=[];for(let i=end;queue[i].previous!==-1;i=queue[i].previous)path.unshift(queue[i].position);
  for(const p of path){
    for(let steps=0;Math.hypot(p.x-state.position.x,p.y-state.position.y)>1e-7;steps++){
      assert.ok(steps<100);const dx=p.x-state.position.x,dy=p.y-state.position.y,speed=weather(state).storm&&!isSafe(state.position)?2.4:3.4;
      const dt=Math.min(0.05,Math.hypot(dx,dy)/speed);if(state.hunger<65)act(state,'eat');move(state,dx,dy,dt);tick(state,dt);assert.equal(state.status,'active');
    }
    state.position={...p};
  }
}
test('unchanged corridors permit salvage, finite shelter refill, valve and tower approaches',()=>{
  const s=newGame();
  for(const id of ['scrap-0','scrap-1','scrap-2']){walk(s,p=>nearest({...s,position:p})?.id===id);interact(s);wait(s,8);}
  walk(s,p=>p.x===REGIONS.shelter.x+2.5&&p.y===REGIONS.shelter.y+1.5);
  wait(s,13);assert.equal(s.oxygen,100);assert.ok(s.rations.ran.oxygen<100);
  walk(s,p=>nearest({...s,position:p})?.id==='valve');interact(s);assert.equal(s.leakFixed,true);
  walk(s,p=>nearest({...s,position:p})?.id==='ship');assert.ok(s.elapsed<300);assert.equal(s.residents[0].alive,true);
});

test('facility leak remains a real hazard without a scripted resident accident',()=>{
  assert.ok(inLeak(RESCUE_POSITION));const s=newGame();s.position={x:RESCUE_POSITION.x,y:RESCUE_POSITION.y-1};tick(s,1);assert.equal(s.health,98);
  s.leakFixed=true;tick(s,1);assert.equal(s.health,98);assert.equal(isSafe(s.position),false);
});


test('complete walking route settles all four within thirty minutes and preserves save evidence',t=>{
  const s=newGame();
  const reach=id=>walk(s,p=>nearest({...s,position:p})?.id===id);
  const shelter=()=>{
    walk(s,p=>p.x===REGIONS.shelter.x+2.5&&p.y===REGIONS.shelter.y+1.5);
    wait(s,13);
  };
  for(const id of ['plot-0','plot-1']){reach(id);interact(s);}
  for(const id of ['scrap-0','scrap-1','scrap-2','scrap-3','scrap-5']){reach(id);interact(s);wait(s,8);}
  reach('valve');interact(s);shelter();
  reach('seon');action(s,'kit','seon');reach('pump');action(s,'pump');
  for(const project of ['base','filter','heat']){
    reach('ship');action(s,project);
    while(s.job)wait(s,1);
    if(s.oxygen<60)shelter();
  }
  reach('plot-5');
  while(s.crops[5].planted&&s.crops[5].growth<360)wait(s,1);
  if(s.crops[5].planted)action(s,'farm');
  action(s,'soil');wait(s,30);action(s,'soil');wait(s,90);
  assert.equal(s.soilSettled,true);
  while(!settlementRequirements(s).rights&&s.elapsed<1800)wait(s,1);
  reach('board');while(s.provisions<8)action(s,'reserve');
  assert.equal(s.residents.every(r=>r.alive),true);
  assert.ok(s.elapsed<1800,`complete walking route took ${s.elapsed} seconds`);
  assert.equal(validateSave(s),true,'walking route active state remains saveable');
  action(s,'finish');assert.equal(s.status,'settled');assert.equal(s.ending.id,'together');
  assert.equal(validateSave(s),true,'walking route terminal evidence remains saveable');
  t.diagnostic(`All four settled after ${s.elapsed.toFixed(1)} seconds of real walking and survival.`);
});
