import test from "node:test";
import assert from "node:assert/strict";

import { createRaceState } from "../src/race2/core/RaceState.js";
import { startRaceState, stepRaceState } from "../src/race2/core/RaceSimulation.js";
import {
  RACE_BATTLE_LATERAL_OFFSET_M,
  RACE_OVERTAKE_DECISIVE_CLEARANCE_M,
  battleContactProbability,
  initialBattleState,
  overtakeAttemptProbability,
  resolveRaceOvertaking,
} from "../src/race2/core/RaceOvertaking.js";
import { RACE_TRAFFIC_HARD_GAP_M } from "../src/race2/core/RaceTraffic.js";
import { createLiveRaceRunner, runFastRace } from "../src/race2/core/RaceRunner.js";

function input({seed="rw8.6",laps=10,stepMs=100,overtakingDifficulty=50}={}){
  const entries=[
    {driverId:"D1",teamId:"T1",carId:"C1",status:"confirmed"},
    {driverId:"D2",teamId:"T2",carId:"C2",status:"confirmed"},
  ];
  return {
    schemaVersion:7,
    engineVersion:"rw2",
    weekendKey:"rw8.6-overtaking",
    seed,
    entries,
    drivers:[
      {
        driverId:"D1",
        teamId:"T1",
        ratings:{},
        performance:{
          raceScore:72,
          overtaking:45,
          defending:45,
          mistakePropensity:20,
          aggression:40,
        },
      },
      {
        driverId:"D2",
        teamId:"T2",
        ratings:{},
        performance:{
          raceScore:94,
          overtaking:96,
          defending:90,
          mistakePropensity:18,
          aggression:78,
        },
      },
    ],
    cars:[
      {
        carId:"C1",driverId:"D1",teamId:"T1",
        performance:{overall:68,qualifying:68,race:68,reliability:80,chassis:66,power:66},
        state:{componentCondition:{engine:100}},
      },
      {
        carId:"C2",driverId:"D2",teamId:"T2",
        performance:{overall:92,qualifying:92,race:92,reliability:85,chassis:90,power:95},
        state:{componentCondition:{engine:100}},
      },
    ],
    startingGrid:[
      {grid:1,driver_id:"D1",team_id:"T1"},
      {grid:2,driver_id:"D2",team_id:"T2"},
    ],
    track:{
      schemaVersion:2,
      trackId:"battle-test",
      year:1980,
      lengthM:1000,
      laps,
      traits:{overtakingDifficulty},
      startFinish:{progress:0,distanceM:0},
      sectors:[
        {id:"sector_1",sector:1,startM:0,endM:333,lengthM:333},
        {id:"sector_2",sector:2,startM:333,endM:666,lengthM:333},
        {id:"sector_3",sector:3,startM:666,endM:1000,lengthM:334},
      ],
      speedProfile:{
        source:"neutral",
        detailed:false,
        sampleSpacingM:1000,
        windowM:null,
        samples:[{distanceM:0,severity:0}],
      },
    },
    __stepMs:stepMs,
  };
}

function runningState(options={}){
  const data=input(options);
  return startRaceState(createRaceState(data,{stepMs:data.__stepMs||100}));
}

function patchCars(state,patches){
  const byId=new Map(Object.entries(patches||{}));
  return {
    ...state,
    cars:state.cars.map((car)=>({...car,...(byId.get(car.carId)||{})})),
  };
}

function car(state,id){
  return state.cars.find((row)=>row.carId===id);
}

function manualBattle(state,{
  attackerId="C2",
  defenderId="C1",
  expiresAtMs=5000,
  result=null,
}={}){
  const attemptId="manual-battle";
  return {
    ...state,
    cars:state.cars.map((row)=>{
      if(row.carId===attackerId)return {
        ...row,
        lateralOffsetM:RACE_BATTLE_LATERAL_OFFSET_M,
        battle:{
          ...initialBattleState(),
          phase:"side_by_side",
          opponentCarId:defenderId,
          role:"attacker",
          side:1,
          attemptId,
          startedTick:state.tick,
          startedAtMs:state.simulationTimeMs,
          expiresAtMs,
          result,
        },
      };
      if(row.carId===defenderId)return {
        ...row,
        lateralOffsetM:-RACE_BATTLE_LATERAL_OFFSET_M,
        battle:{
          ...initialBattleState(),
          phase:"side_by_side",
          opponentCarId:attackerId,
          role:"defender",
          side:-1,
          attemptId,
          startedTick:state.tick,
          startedAtMs:state.simulationTimeMs,
          expiresAtMs,
          result,
        },
      };
      return row;
    }),
  };
}

test("RW8.6 RaceState starts with explicit neutral battle state",()=>{
  const state=createRaceState(input());
  for(const row of state.cars){
    assert.equal(row.battle.phase,"none");
    assert.equal(row.battle.opponentCarId,null);
    assert.equal(row.lateralOffsetM,0);
  }
});

test("RW8.6 overtaking probability uses canonical attacker/defender performance",()=>{
  let state=runningState();
  state=patchCars(state,{
    C1:{absoluteDistanceM:100,distanceAlongLapM:100,speedMs:40,speedKmh:144},
    C2:{absoluteDistanceM:90,distanceAlongLapM:90,speedMs:55,speedKmh:198},
  });

  const strong=overtakeAttemptProbability(state,car(state,"C2"),car(state,"C1"),{gapM:10});
  const weak=overtakeAttemptProbability(
    state,
    {
      ...car(state,"C2"),
      performance:{
        ...car(state,"C2").performance,
        driver:{raceScore:50,overtaking:35,defending:35,mistakePropensity:20,aggression:40},
        car:{race:55,power:55,chassis:55},
      },
      speedMs:41,
      speedKmh:147.6,
    },
    {
      ...car(state,"C1"),
      performance:{
        ...car(state,"C1").performance,
        driver:{raceScore:90,overtaking:80,defending:95,mistakePropensity:20,aggression:40},
        car:{race:90,power:90,chassis:95},
      },
    },
    {gapM:10}
  );

  assert.ok(strong>weak);
  assert.ok(strong>0.70);
  assert.ok(weak<0.40);
});

test("RW8.6 a deterministic close-range attempt enters canonical side-by-side state",()=>{
  let base=runningState();
  base=patchCars(base,{
    C1:{absoluteDistanceM:100,distanceAlongLapM:100,speedMs:40,speedKmh:144,effectiveCornerSeverity:0},
    C2:{absoluteDistanceM:91,distanceAlongLapM:91,speedMs:58,speedKmh:208.8,effectiveCornerSeverity:0},
  });

  let chosen=null;
  for(let bucket=0;bucket<30&&!chosen;bucket+=1){
    const state={
      ...base,
      tick:bucket*10,
      simulationTimeMs:bucket*1000,
    };
    const resolved=resolveRaceOvertaking(state,state.cars,{stepMs:100});
    if(resolved.events.some((event)=>event.type==="overtake_started")){
      chosen={state,resolved};
    }
  }

  assert.ok(chosen,"expected at least one deterministic attempt window");
  const attacker=car({cars:chosen.resolved.cars},"C2");
  const defender=car({cars:chosen.resolved.cars},"C1");
  assert.equal(attacker.battle.phase,"side_by_side");
  assert.equal(defender.battle.phase,"side_by_side");
  assert.equal(attacker.battle.opponentCarId,"C1");
  assert.equal(defender.battle.opponentCarId,"C2");
  assert.equal(attacker.lateralOffsetM,-defender.lateralOffsetM);
  assert.equal(Math.abs(attacker.lateralOffsetM),RACE_BATTLE_LATERAL_OFFSET_M);

  const again=resolveRaceOvertaking(chosen.state,chosen.state.cars,{stepMs:100});
  assert.deepEqual(again,chosen.resolved);
});

test("RW8.6 active side-by-side battle may close below longitudinal hard gap without overlap",()=>{
  let state=runningState();
  state=patchCars(state,{
    C1:{
      absoluteDistanceM:100,distanceAlongLapM:100,speedMs:40,speedKmh:144,
      performance:{car:null,driver:{mistakePropensity:0,aggression:0}},
    },
    C2:{
      absoluteDistanceM:94,distanceAlongLapM:94,speedMs:50,speedKmh:180,
      performance:{car:null,driver:{mistakePropensity:0,aggression:0}},
    },
  });
  state=manualBattle(state);

  const next=stepRaceState(state);
  const defender=car(next,"C1");
  const attacker=car(next,"C2");
  const longitudinalGap=defender.absoluteDistanceM-attacker.absoluteDistanceM;

  assert.equal(attacker.battle.phase,"side_by_side");
  assert.equal(defender.battle.phase,"side_by_side");
  assert.ok(longitudinalGap<RACE_TRAFFIC_HARD_GAP_M);
  assert.notEqual(attacker.lateralOffsetM,0);
  assert.equal(attacker.lateralOffsetM,-defender.lateralOffsetM);
});

test("RW8.6 active battle still respects the next non-bypassed car in a pack",()=>{
  let state=runningState();
  state=patchCars(state,{
    C1:{
      absoluteDistanceM:100,distanceAlongLapM:100,speedMs:40,speedKmh:144,
      performance:{car:null,driver:{mistakePropensity:0,aggression:0}},
    },
    C2:{
      absoluteDistanceM:94,distanceAlongLapM:94,speedMs:100,speedKmh:360,
      performance:{car:null,driver:{mistakePropensity:0,aggression:0}},
    },
  });
  state={
    ...state,
    cars:[
      ...state.cars,
      {
        ...car(state,"C1"),
        carId:"C3",
        driverId:"D3",
        teamId:"T3",
        gridPosition:3,
        absoluteDistanceM:106,
        distanceAlongLapM:106,
        speedMs:10,
        speedKmh:36,
        performance:{car:null,driver:null},
        battle:initialBattleState(),
        lateralOffsetM:0,
      },
    ],
  };
  state=manualBattle(state);

  const next=stepRaceState(state);
  const attacker=car(next,"C2");
  const nextBlocker=car(next,"C3");

  assert.ok(
    nextBlocker.absoluteDistanceM-attacker.absoluteDistanceM>=RACE_TRAFFIC_HARD_GAP_M-1e-6,
    "bypassing the battle opponent must not bypass the next physical blocker"
  );
});

test("RW8.6 lapping battle resolves from physical track clearance, not classification distance",()=>{
  let state=runningState();
  state=patchCars(state,{
    C1:{
      absoluteDistanceM:1058,distanceAlongLapM:58,lap:2,completedLaps:1,
      speedMs:40,speedKmh:144,
      performance:{car:null,driver:{mistakePropensity:0,aggression:0}},
    },
    C2:{
      absoluteDistanceM:2050,distanceAlongLapM:50,lap:3,completedLaps:2,
      speedMs:50,speedKmh:180,
      performance:{car:null,driver:{mistakePropensity:0,aggression:0}},
    },
  });
  state=manualBattle(state);

  const next=stepRaceState(state);
  const attacker=car(next,"C2");
  const defender=car(next,"C1");

  assert.equal(attacker.battle.phase,"side_by_side");
  assert.equal(defender.battle.phase,"side_by_side");
  assert.ok(
    !next.events.some((event)=>event.type==="overtake_completed"),
    "classification lap advantage must not instantly complete a physical lapping pass"
  );
});

test("RW8.6 a physically decisive attacker completes the overtake and becomes classified ahead",()=>{
  let next=runningState();
  next=patchCars(next,{
    C1:{
      absoluteDistanceM:100,distanceAlongLapM:100,speedMs:40,speedKmh:144,
      performance:{car:null,driver:{mistakePropensity:0,aggression:0}},
    },
    C2:{
      absoluteDistanceM:99,distanceAlongLapM:99,speedMs:120,speedKmh:432,
      performance:{car:null,driver:{mistakePropensity:0,aggression:0}},
    },
  });
  next=manualBattle(next);

  let completed=null;
  for(let index=0;index<20&&!completed;index+=1){
    next=stepRaceState(next);
    if(next.events.some((event)=>event.type==="overtake_completed"))completed=next;
  }

  assert.ok(completed,"expected decisive physical pass to complete within bounded canonical steps");
  const attacker=car(completed,"C2");
  const defender=car(completed,"C1");
  const clearance=attacker.absoluteDistanceM-defender.absoluteDistanceM;

  assert.ok(clearance>=RACE_OVERTAKE_DECISIVE_CLEARANCE_M-1e-6);
  assert.equal(attacker.battle.result,"completed");
  assert.equal(completed.classification[0].carId,"C2");

  if(clearance<RACE_TRAFFIC_HARD_GAP_M){
    assert.equal(attacker.battle.phase,"yielding");
    assert.equal(defender.battle.phase,"yielding");
    assert.notEqual(attacker.lateralOffsetM,0);
  }else{
    assert.equal(attacker.battle.phase,"none");
    assert.equal(defender.battle.phase,"none");
    assert.equal(attacker.lateralOffsetM,0);
  }
});

test("RW8.6 expired battle extends while attacker is ahead but not yet fully clear",()=>{
  let state=runningState();
  state=patchCars(state,{
    C1:{
      absoluteDistanceM:100,distanceAlongLapM:100,speedMs:40,speedKmh:144,
      performance:{car:null,driver:{mistakePropensity:0,aggression:0}},
    },
    C2:{
      absoluteDistanceM:101,distanceAlongLapM:101,speedMs:41,speedKmh:147.6,
      performance:{car:null,driver:{mistakePropensity:0,aggression:0}},
    },
  });
  state=manualBattle(state,{expiresAtMs:50});

  const next=stepRaceState(state);
  const attacker=car(next,"C2");
  const defender=car(next,"C1");

  assert.equal(attacker.battle.phase,"side_by_side");
  assert.equal(defender.battle.phase,"side_by_side");
  assert.ok(attacker.battle.expiresAtMs>100);
  assert.ok(!next.events.some((event)=>event.type==="overtake_failed"));
  assert.notEqual(attacker.lateralOffsetM,0);
});

test("RW8.6 failed battle yields laterally until the hard gap is physically restored",()=>{
  let state=runningState();
  state=patchCars(state,{
    C1:{
      absoluteDistanceM:100,distanceAlongLapM:100,speedMs:42,speedKmh:151.2,
      performance:{car:null,driver:{mistakePropensity:0,aggression:0}},
    },
    C2:{
      absoluteDistanceM:99,distanceAlongLapM:99,speedMs:42,speedKmh:151.2,
      performance:{car:null,driver:{mistakePropensity:0,aggression:0}},
    },
  });
  state=manualBattle(state,{expiresAtMs:50});

  const failed=stepRaceState(state);
  assert.equal(car(failed,"C2").battle.phase,"yielding");
  assert.equal(car(failed,"C2").battle.result,"failed");
  assert.notEqual(car(failed,"C2").lateralOffsetM,0);
  assert.ok(failed.events.some((event)=>event.type==="overtake_failed"));

  let recovered=failed;
  for(let index=0;index<30&&car(recovered,"C2").battle.phase!=="none";index+=1){
    recovered=stepRaceState(recovered);
  }
  assert.equal(car(recovered,"C2").battle.phase,"none");
  assert.equal(car(recovered,"C1").battle.phase,"none");
  assert.equal(car(recovered,"C2").lateralOffsetM,0);
  assert.ok(
    car(recovered,"C1").absoluteDistanceM-car(recovered,"C2").absoluteDistanceM>=
    RACE_TRAFFIC_HARD_GAP_M-1e-6
  );
});

test("RW8.6 contact generation stays pure and leaves consequences to RW8.10",()=>{
  let state=runningState({stepMs:1000});
  const calmAttacker={
    ...car(state,"C2"),
    performance:{car:null,driver:{mistakePropensity:0,aggression:20}},
    effectiveCornerSeverity:0,
  };
  const calmDefender={
    ...car(state,"C1"),
    performance:{car:null,driver:{mistakePropensity:0,aggression:20}},
    effectiveCornerSeverity:0,
  };
  const riskyAttacker={
    ...calmAttacker,
    performance:{car:null,driver:{mistakePropensity:100,aggression:100}},
    effectiveCornerSeverity:1,
  };
  const riskyDefender={
    ...calmDefender,
    performance:{car:null,driver:{mistakePropensity:100,aggression:100}},
    effectiveCornerSeverity:1,
  };

  const calm=battleContactProbability(state,calmAttacker,calmDefender,{stepMs:1000});
  const risky=battleContactProbability(state,riskyAttacker,riskyDefender,{stepMs:1000});
  assert.ok(risky>calm);

  let contactState=null;
  for(let index=0;index<600&&!contactState;index+=1){
    let candidate=runningState({seed:`contact-${index}`,stepMs:1000});
    candidate=patchCars(candidate,{
      C1:{
        absoluteDistanceM:100,distanceAlongLapM:100,speedMs:40,speedKmh:144,
        effectiveCornerSeverity:1,
        performance:{car:null,driver:{mistakePropensity:100,aggression:100}},
      },
      C2:{
        absoluteDistanceM:99,distanceAlongLapM:99,speedMs:40,speedKmh:144,
        effectiveCornerSeverity:1,
        performance:{car:null,driver:{mistakePropensity:100,aggression:100}},
      },
    });
    candidate=manualBattle(candidate);
    const resolved=resolveRaceOvertaking(candidate,candidate.cars,{stepMs:1000});
    if(resolved.events.some((event)=>event.type==="contact")){
      contactState={...candidate,cars:resolved.cars,events:resolved.events};
    }
  }

  assert.ok(contactState,"expected deterministic contact seed in bounded search");
  assert.equal(car(contactState,"C1").dnf,false);
  assert.equal(car(contactState,"C2").dnf,false);
  assert.equal(car(contactState,"C1").damage,null);
  assert.equal(car(contactState,"C2").damage,null);
  assert.equal(car(contactState,"C2").battle.phase,"yielding");
});

test("RW8.6 Live and Fast keep identical battles, events and classification",()=>{
  let initial=runningState({seed:"rw8.6-parity"});
  initial=patchCars(initial,{
    C1:{absoluteDistanceM:100,distanceAlongLapM:100,speedMs:42,speedKmh:151.2,effectiveCornerSeverity:0},
    C2:{absoluteDistanceM:91,distanceAlongLapM:91,speedMs:58,speedKmh:208.8,effectiveCornerSeverity:0},
  });

  const fast=runFastRace(initial,{steps:120});
  const live=createLiveRaceRunner(initial);
  live.advanceElapsed(12000);

  assert.deepEqual(live.getState(),fast);
  assert.deepEqual(live.getState().classification,fast.classification);
  assert.deepEqual(live.getState().events,fast.events);
});


test("RW11B circuit overtaking difficulty changes canonical attempt probability",()=>{
  let easy=runningState({overtakingDifficulty:20});
  let hard=runningState({overtakingDifficulty:90});
  const patch={
    C1:{absoluteDistanceM:100,distanceAlongLapM:100,speedMs:42,speedKmh:151.2},
    C2:{absoluteDistanceM:90,distanceAlongLapM:90,speedMs:48,speedKmh:172.8},
  };
  easy=patchCars(easy,patch);
  hard=patchCars(hard,patch);

  const easyProbability=overtakeAttemptProbability(
    easy,
    car(easy,"C2"),
    car(easy,"C1"),
    {gapM:10}
  );
  const hardProbability=overtakeAttemptProbability(
    hard,
    car(hard,"C2"),
    car(hard,"C1"),
    {gapM:10}
  );

  assert.ok(easyProbability>hardProbability);
  assert.ok(hardProbability<easyProbability*0.75);
});

test("RW11B new battles receive enough physical time to clear the defender",()=>{
  let base=runningState({overtakingDifficulty:50});
  base=patchCars(base,{
    C1:{absoluteDistanceM:100,distanceAlongLapM:100,speedMs:42,speedKmh:151.2,effectiveCornerSeverity:0},
    C2:{absoluteDistanceM:91,distanceAlongLapM:91,speedMs:44,speedKmh:158.4,effectiveCornerSeverity:0},
  });

  let started=null;
  for(let bucket=0;bucket<60&&!started;bucket+=1){
    const state={...base,tick:bucket*10,simulationTimeMs:bucket*1000};
    const resolved=resolveRaceOvertaking(state,state.cars,{stepMs:100});
    const event=resolved.events.find((row)=>row.type==="overtake_started");
    if(event)started={state,resolved,event};
  }

  assert.ok(started,"expected a deterministic physical attempt window");
  assert.ok(started.event.payload.durationMs>=3500);
  assert.ok(started.event.payload.durationMs<=12000);
  assert.ok(started.event.payload.durationMs>2400);
  assert.ok(started.event.payload.closingPotentialMs>=0.75);
  assert.equal(started.event.payload.trackDifficulty,50);
  assert.equal(
    car({cars:started.resolved.cars},"C2").battle.expiresAtMs,
    started.state.simulationTimeMs+started.event.payload.durationMs
  );
});

test("RW11B a car with no physical or performance closing potential does not spam attempts",()=>{
  let base=runningState({overtakingDifficulty:50});
  base=patchCars(base,{
    C1:{
      absoluteDistanceM:100,distanceAlongLapM:100,speedMs:44,speedKmh:158.4,
      performance:{
        car:{race:92,power:92,chassis:92},
        driver:{raceScore:92,overtaking:85,defending:95,mistakePropensity:10,aggression:40},
      },
    },
    C2:{
      absoluteDistanceM:91,distanceAlongLapM:91,speedMs:44,speedKmh:158.4,
      performance:{
        car:{race:60,power:60,chassis:60},
        driver:{raceScore:60,overtaking:55,defending:55,mistakePropensity:10,aggression:40},
      },
    },
  });

  for(let bucket=0;bucket<30;bucket+=1){
    const state={...base,tick:bucket*10,simulationTimeMs:bucket*1000};
    const resolved=resolveRaceOvertaking(state,state.cars,{stepMs:100});
    assert.ok(!resolved.events.some((event)=>event.type==="overtake_started"));
  }
});


test("RW11B canonical dynamics preserve free target speed before traffic limiting",()=>{
  const started=runningState();
  const next=stepRaceState(started);
  assert.ok(car(next,"C1").freeTargetSpeedKmh>0);
  assert.ok(car(next,"C2").freeTargetSpeedKmh>0);
});


test("RW11B a decisive pass in a train keeps lateral separation until hard gap is restored",()=>{
  let state=runningState();
  state=patchCars(state,{
    C1:{
      absoluteDistanceM:100,distanceAlongLapM:100,speedMs:40,speedKmh:144,
      performance:{car:null,driver:{mistakePropensity:0,aggression:0}},
    },
    C2:{
      absoluteDistanceM:100+RACE_OVERTAKE_DECISIVE_CLEARANCE_M,
      distanceAlongLapM:100+RACE_OVERTAKE_DECISIVE_CLEARANCE_M,
      speedMs:41,speedKmh:147.6,
      performance:{car:null,driver:{mistakePropensity:0,aggression:0}},
    },
  });
  state=manualBattle(state,{expiresAtMs:5000});

  const resolved=resolveRaceOvertaking(state,state.cars,{stepMs:100});
  const attacker=car({cars:resolved.cars},"C2");
  const defender=car({cars:resolved.cars},"C1");

  assert.equal(attacker.battle.phase,"yielding");
  assert.equal(attacker.battle.result,"completed");
  assert.equal(defender.battle.result,"lost");
  assert.notEqual(attacker.lateralOffsetM,0);
  assert.ok(resolved.events.some((event)=>event.type==="overtake_completed"));

  let canonical={
    ...state,
    cars:resolved.cars,
    classification:[
      {position:1,carId:"C2"},
      {position:2,carId:"C1"},
    ],
  };
  for(let index=0;index<80&&car(canonical,"C2").battle.phase!=="none";index+=1){
    canonical=stepRaceState(canonical);
  }
  assert.equal(car(canonical,"C2").battle.phase,"none");
  assert.equal(car(canonical,"C1").battle.phase,"none");
  assert.ok(
    car(canonical,"C2").absoluteDistanceM-car(canonical,"C1").absoluteDistanceM>=
      RACE_TRAFFIC_HARD_GAP_M-1e-6
  );
});
