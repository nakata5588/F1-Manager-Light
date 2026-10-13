import test from "node:test";
import assert from "node:assert/strict";
import {createRaceState} from "../src/race2/core/RaceState.js";
import {startRaceState,stepRaceState} from "../src/race2/core/RaceSimulation.js";
import {createLiveRaceRunner,runFastRace} from "../src/race2/core/RaceRunner.js";
import {initialBattleState,resolveSimpleRacePassing,diagnoseSimplePassGate,
  raceBattlePaceMultiplier} from "../src/race2/core/RacePassingSimple.js";
import {RACE_TRAFFIC_HARD_GAP_M} from "../src/race2/core/RaceTraffic.js";

function state(){
  const driver=(id,rating)=>({driverId:id,teamId:id,ratings:{},
    performance:{raceScore:rating,overtaking:rating,defending:rating,
      raceIntelligence:rating,aggression:50,mistakePropensity:10}});
  const car=(id,rating)=>({carId:id,driverId:id,teamId:id,
    performance:{race:rating,power:rating,chassis:rating,reliability:85},
    state:{componentCondition:{engine:100}}});
  const input={
    schemaVersion:7,engineVersion:"rw2",weekendKey:"simple-pass-test",
    seed:"simple-pass-fixed",entries:[
      {carId:"C1",driverId:"C1",teamId:"C1",status:"confirmed"},
      {carId:"C2",driverId:"C2",teamId:"C2",status:"confirmed"},
    ],
    drivers:[driver("C1",70),driver("C2",92)],
    cars:[car("C1",70),car("C2",92)],
    startingGrid:[{grid:1,driver_id:"C1",team_id:"C1"},
      {grid:2,driver_id:"C2",team_id:"C2"}],
    track:{schemaVersion:2,trackId:"simple-test",year:1980,
      lengthM:1000,laps:3,traits:{overtakingDifficulty:50},
      startFinish:{progress:0,distanceM:0},
      sectors:[{sector:1,startM:0,endM:333},{sector:2,startM:333,endM:666},
        {sector:3,startM:666,endM:1000}],
      speedProfile:{source:"neutral",detailed:false,
        samples:[{distanceM:0,severity:0}]},
    },
  };
  return startRaceState(createRaceState(input,{stepMs:100}));
}
function patch(state,patches){
  return {...state,cars:state.cars.map(car=>({
    ...car,...(patches[car.carId]||{}),
  }))};
}
const get=(state,id)=>state.cars.find(c=>c.carId===id);
function manual(state){
  const a=get(state,"C2"),b=get(state,"C1");
  const battle={attemptId:"manual",startedAtMs:0,expiresAtMs:15000};
  return patch(state,{
    C1:{battle:{...initialBattleState(),...battle,
      role:"defender",phase:"side_by_side",opponentCarId:"C2",side:-1}},
    C2:{battle:{...initialBattleState(),...battle,
      role:"attacker",phase:"side_by_side",opponentCarId:"C1",side:1}},
  });
}
test("simple passing never manufactures role-dependent speed",()=>{
  const s=state();assert.equal(raceBattlePaceMultiplier(s,get(s,"C2")),1);
});
test("physical clearance, not a probability roll, completes a pass",()=>{
  const s=manual(patch(state(),{
    C1:{absoluteDistanceM:100,distanceAlongLapM:100,speedMs:40,speedKmh:144},
    C2:{absoluteDistanceM:108,distanceAlongLapM:108,speedMs:42,speedKmh:151.2},
  }));
  const r=resolveSimpleRacePassing(s,s.cars,{stepMs:100});
  const pass=r.events.find(e=>e.type==="overtake_completed");
  assert.ok(pass);assert.equal(pass.payload.fullyClear,true);
  assert.ok(pass.payload.clearanceM>=RACE_TRAFFIC_HARD_GAP_M);
  assert.equal(get({cars:r.cars},"C2").battle.result,"completed");
});
test("physically decisive pass below hard spacing completes while cars yield laterally",()=>{
  const s=manual(patch(state(),{
    C1:{absoluteDistanceM:100,distanceAlongLapM:100,speedMs:40,speedKmh:144},
    C2:{absoluteDistanceM:102,distanceAlongLapM:102,speedMs:42,speedKmh:151.2},
  }));
  const passed=resolveSimpleRacePassing(s,s.cars,{stepMs:100});
  const completion=passed.events.find(e=>e.type==="overtake_completed");
  assert.ok(completion);
  assert.equal(completion.payload.fullyClear,false);
  assert.equal(get({cars:passed.cars},"C2").battle.phase,"yielding");
  assert.equal(get({cars:passed.cars},"C1").battle.phase,"yielding");
  assert.equal(passed.bypassPairs.size,1);
  assert.ok(get({cars:passed.cars},"C2").lateralOffsetM!==0);
  const second={...s,cars:passed.cars,simulationTimeMs:100};
  const stillYielding=resolveSimpleRacePassing(second,second.cars,{stepMs:100});
  assert.equal(stillYielding.events.filter(e=>e.type==="overtake_completed").length,0,
    "one physical crossing can produce only one official completion event");
  assert.equal(stillYielding.bypassPairs.size,1);
});

test("partly-clear completion returns spacing to traffic after 2 second recovery",()=>{
  const s=manual(patch(state(),{
    C1:{absoluteDistanceM:100,distanceAlongLapM:100,speedMs:40,speedKmh:144},
    C2:{absoluteDistanceM:102,distanceAlongLapM:102,speedMs:42,speedKmh:151.2},
  }));
  const pass=resolveSimpleRacePassing(s,s.cars,{stepMs:100});
  const after={...s,cars:pass.cars,simulationTimeMs:2100};
  const recovered=resolveSimpleRacePassing(after,after.cars,{stepMs:100});
  assert.equal(get({cars:recovered.cars},"C2").battle.phase,"none");
  assert.equal(get({cars:recovered.cars},"C1").battle.phase,"none");
  assert.equal(recovered.bypassPairs.size,0);
});

test("not physically clear cannot complete, even with favourable racecraft",()=>{
  const s=manual(patch(state(),{
    C1:{absoluteDistanceM:100,distanceAlongLapM:100,speedMs:41,speedKmh:147.6},
    C2:{absoluteDistanceM:101,distanceAlongLapM:101,speedMs:43,speedKmh:154.8},
  }));
  const r=resolveSimpleRacePassing(s,s.cars,{stepMs:100});
  assert.equal(r.events.some(e=>e.type==="overtake_completed"),false);
});
test("position pass prevents reciprocal spam until a real pit-stint change",()=>{
  const s=manual(patch(state(),{
    C1:{absoluteDistanceM:100,distanceAlongLapM:100,speedMs:40,speedKmh:144},
    C2:{absoluteDistanceM:108,distanceAlongLapM:108,speedMs:42,speedKmh:151.2},
  }));
  const r=resolveSimpleRacePassing(s,s.cars,{stepMs:100});
  const after=patch({...s,simulationTimeMs:30000,cars:r.cars},{
    C1:{absoluteDistanceM:108,distanceAlongLapM:108,speedMs:43,speedKmh:154.8},
    C2:{absoluteDistanceM:100,distanceAlongLapM:100,speedMs:40,speedKmh:144},
  });
  assert.equal(diagnoseSimplePassGate(after,get(after,"C1")).reason,"recent_pair_cooldown");
  const pit={...after,cars:after.cars.map(c=>c.carId==="C2"
    ?{...c,pitState:{...c.pitState,stopSequence:1}}:c)};
  assert.notEqual(diagnoseSimplePassGate(pit,get(pit,"C1")).reason,"recent_pair_cooldown");
});
test("failed close-range yielding expires and hands longitudinal spacing back to RaceTraffic",()=>{
  const s=manual(patch(state(),{
    C1:{absoluteDistanceM:100,distanceAlongLapM:100,speedMs:40,speedKmh:144},
    C2:{absoluteDistanceM:101,distanceAlongLapM:101,speedMs:40,speedKmh:144},
  }));
  const yielding=patch(s,{
    C1:{battle:{...get(s,"C1").battle,phase:"yielding",result:"defended",
      expiresAtMs:100}},
    C2:{battle:{...get(s,"C2").battle,phase:"yielding",result:"failed",
      expiresAtMs:100}},
  });
  const output=resolveSimpleRacePassing(yielding,yielding.cars,{stepMs:100});
  assert.equal(get({cars:output.cars},"C2").battle.phase,"none");
  assert.equal(get({cars:output.cars},"C1").battle.phase,"none");
  assert.equal(output.bypassPairs.size,0);
});

test("local yellow blocks new physical passing",()=>{
  const s=patch(state(),{
    C1:{absoluteDistanceM:100,distanceAlongLapM:100,sector:1,speedMs:45,
      freeTargetSpeedKmh:150},
    C2:{absoluteDistanceM:90,distanceAlongLapM:90,sector:1,speedMs:46,
      freeTargetSpeedKmh:190},
  });
  for(let i=0;i<20;i++){
    const sample={...s,tick:i*10,simulationTimeMs:i*1000};
    const r=resolveSimpleRacePassing(sample,sample.cars,{blockedSectors:[1]});
    assert.equal(r.events.some(e=>e.type==="overtake_started"),false);
  }
});
test("new model is deterministic and pure when diagnosing",()=>{
  const s=patch(state(),{
    C1:{absoluteDistanceM:100,distanceAlongLapM:100,speedMs:45,
      freeTargetSpeedKmh:170},
    C2:{absoluteDistanceM:90,distanceAlongLapM:90,speedMs:47,
      freeTargetSpeedKmh:195},
  });
  const before=JSON.stringify(s);
  assert.deepEqual(diagnoseSimplePassGate(s,get(s,"C2")),
    diagnoseSimplePassGate(s,get(s,"C2")));
  assert.equal(JSON.stringify(s),before);
});
test("Live and Fast use exactly the same new passing core",()=>{
  const s=state(),runner=createLiveRaceRunner(s);
  for(let i=0;i<25;i++)runner.step();
  let fast=s;for(let i=0;i<25;i++)fast=runFastRace(fast,{steps:1});
  assert.deepEqual(runner.getState(),fast);
});
