import test from "node:test";
import assert from "node:assert/strict";

import { raceControlRulesForYear } from "../src/engine/RaceControlEngine.js";
import { damageStateFromComponents } from "../src/engine/CarDamageEngine.js";
import { createRaceState } from "../src/race2/core/RaceState.js";
import { raceTargetSpeedProfile } from "../src/race2/core/RaceDynamics.js";
import { advanceRaceConditions } from "../src/race2/core/RaceConditions.js";
import { startRaceState, stepRaceState } from "../src/race2/core/RaceSimulation.js";
import {
  applyAutomaticCanonicalRedFlagWork,
  applyCanonicalRedFlagDamageRepair,
  applyCanonicalRedFlagRestartStrategy,
  applyCanonicalRedFlagTyreChange,
  canonicalRedFlagWorkWindowOpen,
} from "../src/race2/core/RaceRedFlagWork.js";
import {
  enforceRaceControlAssessment,
  neutralizeBattles,
  raceControlFreezesProgress,
  raceControlOvertakingAllowed,
  raceControlPaceMultiplier,
} from "../src/race2/core/RaceControlLifecycle.js";

function weatherRow(lap,{
  state="SUNNY",
  wetness=0,
  rain=0,
  grip=84,
  trackTemp=30,
  airTemp=22,
  standingWater=0,
  visibility=100,
  spray=0,
  raceability=96,
  hazard=4,
}={}){
  return {
    lap,
    state,
    rain_intensity:rain,
    rain_band:rain>0.7?"HEAVY":rain>0.1?"LIGHT":"NONE",
    track_wetness:wetness,
    wetness_delta:0,
    rubber_level:20,
    grip_index:grip,
    air_temp_c:airTemp,
    track_temp_c:trackTemp,
    spray_index:spray,
    spray_band:spray>0.7?"HEAVY":"NONE",
    visibility_index:visibility,
    visibility_band:visibility<50?"VERY_POOR":"CLEAR",
    standing_water_index:standingWater,
    standing_water_band:standingWater>60?"HEAVY":"NONE",
    raceability_index:raceability,
    raceability_hazard_index:hazard,
    raceability_band:raceability<35?"CRITICAL":"GOOD",
    raceability_factors:{},
    raceability_dominant_factors:[],
  };
}

function input({
  year=2026,
  timeline=[weatherRow(1),weatherRow(2),weatherRow(3),weatherRow(4),weatherRow(5)],
}={}){
  return {
    schemaVersion:13,
    engineVersion:"rw2",
    weekendKey:"rw8.11b-race-control",
    seed:"rw8.11b",
    year,
    entries:[{driverId:"D1",teamId:"T1",carId:"C1",status:"confirmed"}],
    drivers:[{
      driverId:"D1",
      teamId:"T1",
      performance:{
        raceScore:82,
        overtaking:75,
        defending:72,
        mistakePropensity:20,
        aggression:55,
        tyreManagement:76,
      },
    }],
    cars:[{
      carId:"C1",
      driverId:"D1",
      teamId:"T1",
      state:{componentCondition:{engine:100,suspension:100}},
      performance:{
        overall:82,
        qualifying:82,
        race:82,
        reliability:90,
        chassis:82,
        power:82,
      },
      reliability:{
        mechanicalChancePerKm:0,
        accidentChancePerKm:0,
        accidentConditionalRetirementChance:0,
      },
      resourceSetup:{tyres:[]},
    }],
    rules:{race:{refuelling_allowed:false}},
    raceControl:{rules:raceControlRulesForYear(year)},
    weather:{state:timeline[0].state,timeline},
    startingGrid:[{grid:1,driver_id:"D1",team_id:"T1"}],
    track:{
      schemaVersion:2,
      trackId:"rw8-11b-test",
      year,
      lengthM:1000,
      laps:5,
      traits:{tyreWear:50},
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
  };
}

function assessment(state,{
  mode="GREEN",
  source=null,
  referenceLap=1,
  assessmentValue=null,
}={}){
  return {
    ...(state?.raceControlState||{}),
    recommendedMode:mode,
    source,
    referenceLap,
    assessment:assessmentValue,
  };
}

test("RW8.11B assessment preserves the official active mode",()=>{
  const base=startRaceState(createRaceState(input()));
  const state={
    ...base,
    raceControlState:{
      ...base.raceControlState,
      model:"rw8.11b",
      phase:"enforced",
      mode:"SAFETY_CAR",
      minimumReleaseLap:3,
    },
  };
  const result=advanceRaceConditions(state,state.cars,[]);
  assert.equal(result.raceControlState.recommendedMode,"GREEN");
  assert.equal(result.raceControlState.mode,"SAFETY_CAR");
  assert.equal(result.raceControlState.phase,"assessment");
});

test("RW8.11B VSC and Safety Car use shared canonical pace restrictions",()=>{
  const green=startRaceState(createRaceState(input()));
  const car=green.cars[0];
  const greenProfile=raceTargetSpeedProfile(green,car);

  const vsc={
    ...green,
    raceControlState:{...green.raceControlState,mode:"VSC"},
  };
  const safetyCar={
    ...green,
    raceControlState:{...green.raceControlState,mode:"SAFETY_CAR"},
  };
  const vscProfile=raceTargetSpeedProfile(vsc,car);
  const safetyCarProfile=raceTargetSpeedProfile(safetyCar,car);

  assert.equal(raceControlPaceMultiplier("VSC"),0.76);
  assert.equal(raceControlPaceMultiplier("SAFETY_CAR"),0.58);
  assert.ok(vscProfile.targetSpeedKmh<greenProfile.targetSpeedKmh);
  assert.ok(safetyCarProfile.targetSpeedKmh<vscProfile.targetSpeedKmh);
  assert.equal(raceControlOvertakingAllowed(green),true);
  assert.equal(raceControlOvertakingAllowed(vsc),false);
  assert.equal(raceControlOvertakingAllowed(safetyCar),false);
});

test("RW8.11B neutralisation lasts its full lap duration before returning GREEN",()=>{
  const base=startRaceState(createRaceState(input({year:2015})));
  const activated=enforceRaceControlAssessment(
    base,
    assessment(base,{mode:"VSC",source:"incident",referenceLap:2}),
    base.cars
  );
  const control=activated.raceControlState;

  assert.equal(control.mode,"VSC");
  assert.ok(control.minimumReleaseLap>=3);
  assert.ok(control.minimumReleaseLap<=4);
  assert.equal(activated.events.length,1);
  assert.equal(activated.events[0].payload.to,"VSC");

  const held=enforceRaceControlAssessment(
    {...base,raceControlState:control},
    assessment({...base,raceControlState:control},{mode:"GREEN",referenceLap:control.minimumReleaseLap-1}),
    base.cars
  );
  assert.equal(held.raceControlState.mode,"VSC");

  const released=enforceRaceControlAssessment(
    {...base,raceControlState:held.raceControlState},
    assessment({...base,raceControlState:held.raceControlState},{mode:"GREEN",referenceLap:control.minimumReleaseLap}),
    base.cars
  );
  assert.equal(released.raceControlState.mode,"GREEN");
  assert.equal(released.events.at(-1).payload.from,"VSC");
  assert.equal(released.events.at(-1).payload.to,"GREEN");
});

test("RW8.11B control downgrade never opens an intermediate GREEN window",()=>{
  const base=startRaceState(createRaceState(input({year:2015})));
  const safetyCar=enforceRaceControlAssessment(
    base,
    assessment(base,{mode:"SAFETY_CAR",source:"incident",referenceLap:2}),
    base.cars
  );
  const releaseLap=safetyCar.raceControlState.minimumReleaseLap;
  const active={...base,raceControlState:safetyCar.raceControlState};
  const downgraded=enforceRaceControlAssessment(
    active,
    assessment(active,{mode:"VSC",source:"incident",referenceLap:releaseLap}),
    base.cars
  );

  assert.equal(downgraded.raceControlState.mode,"VSC");
  assert.ok(downgraded.raceControlState.minimumReleaseLap>releaseLap);
  assert.equal(downgraded.events.at(-1).payload.from,"SAFETY_CAR");
  assert.equal(downgraded.events.at(-1).payload.to,"VSC");
  assert.equal(raceControlOvertakingAllowed({...base,raceControlState:downgraded.raceControlState}),false);
});

test("RW8.11B a same-level incident extends an active neutralisation",()=>{
  const base=startRaceState(createRaceState(input({year:2015})));
  const first=enforceRaceControlAssessment(
    base,
    assessment(base,{mode:"VSC",source:"incident",referenceLap:2}),
    base.cars
  );
  const firstRelease=first.raceControlState.minimumReleaseLap;
  const active={...base,raceControlState:first.raceControlState};
  const extended=enforceRaceControlAssessment(
    active,
    assessment(active,{mode:"VSC",source:"incident",referenceLap:firstRelease}),
    base.cars
  );

  assert.equal(extended.raceControlState.mode,"VSC");
  assert.ok(extended.raceControlState.minimumReleaseLap>firstRelease);
  assert.equal(extended.events.at(-1).type,"race_control_extended");
});

test("RW8.11B non-green control cancels active side-by-side battle state",()=>{
  const state=startRaceState(createRaceState(input()));
  const cars=[{
    ...state.cars[0],
    lateralOffsetM:1.4,
    battle:{
      phase:"active",
      opponentCarId:"C2",
      role:"attacker",
      side:1,
      attemptId:"battle-1",
      startedTick:1,
      startedAtMs:100,
      expiresAtMs:2500,
      contactRiskPct:12,
      result:null,
      cooldownUntilMs:0,
    },
  }];
  const cleared=neutralizeBattles(cars);
  assert.equal(cleared[0].lateralOffsetM,0);
  assert.equal(cleared[0].battle.phase,"none");
  assert.equal(cleared[0].battle.opponentCarId,null);
});

test("RW23 canonical Red Flag work changes tyres, repairs damage and strategy without moving the car",()=>{
  const started=startRaceState(createRaceState(input({year:1980})));
  const prepared={
    ...started,
    cars:started.cars.map((car)=>({
      ...car,
      absoluteDistanceM:420,
      distanceAlongLapM:420,
      damage:damageStateFromComponents({
        front_wing:60,
        floor:30,
      },{source:"test"}),
      resources:{
        ...car.resources,
        aiControlled:false,
        strategy:{
          ...car.resources.strategy,
          aiControlled:false,
          pitPlan:"no_stop",
          plannedStopLap:null,
        },
        availableTyres:[
          {tyre_id:"dry_a",compound_name:"Dry A",category:"dry",grip_index:78,wear_rate:.018,warmup_time_s:2.5},
          {tyre_id:"wet_a",compound_name:"Wet A",category:"wet",grip_index:70,wear_rate:.022,warmup_time_s:3},
        ],
      },
      tyre:{
        ...car.tyre,
        tyre_id:"dry_a",
        compound:"Dry A",
        category:"dry",
        condition:44,
        stint_number:1,
      },
    })),
  };
  const activated=enforceRaceControlAssessment(
    prepared,
    assessment(prepared,{mode:"RED_FLAG",source:"incident",referenceLap:1}),
    prepared.cars
  );
  let red={
    ...prepared,
    raceControlState:activated.raceControlState,
    session:{...prepared.session,raceControl:activated.raceControlState},
  };
  assert.equal(canonicalRedFlagWorkWindowOpen(red),true);
  const distance=red.cars[0].absoluteDistanceM;

  red=applyCanonicalRedFlagTyreChange(red,{
    driverId:"D1",
    teamId:"T1",
    tyreId:"wet_a",
  });
  assert.equal(red.cars[0].absoluteDistanceM,distance);
  assert.equal(red.cars[0].tyre.tyre_id,"wet_a");
  assert.equal(red.cars[0].tyre.condition,100);
  assert.equal(red.cars[0].tyre.stint_number,2);

  const beforeRepair=red.cars[0].damage.pace_loss_s_per_lap;
  red=applyCanonicalRedFlagDamageRepair(red,{driverId:"D1",teamId:"T1"});
  assert.ok(red.cars[0].damage.pace_loss_s_per_lap<beforeRepair);
  assert.equal(red.cars[0].absoluteDistanceM,distance);

  red=applyCanonicalRedFlagRestartStrategy(red,{
    driverId:"D1",
    teamId:"T1",
    paceMode:"attack",
    pitPlan:"one_stop",
    nextTyreId:"dry_a",
    plannedStopLap:3,
  });
  assert.equal(red.cars[0].resources.paceMode,"attack");
  assert.equal(red.cars[0].resources.strategy.pitPlan,"one_stop");
  assert.equal(red.cars[0].resources.strategy.nextTyreId,"dry_a");
  assert.equal(red.cars[0].resources.strategy.plannedStopLap,3);
  assert.equal(red.cars[0].absoluteDistanceM,distance);

  const workTypes=red.raceControlState.redFlagLifecycle.work_log.map((row)=>row.type);
  assert.deepEqual(workTypes.sort(),["damage_repair","restart_strategy","tyre_change"]);
  assert.equal(red.events.filter((event)=>event.type==="red_flag_work").length,3);
});

test("RW23 canonical Red Flag work rejects other teams and closed work windows",()=>{
  const started=startRaceState(createRaceState(input({year:1980})));
  const car={
    ...started.cars[0],
    resources:{
      ...started.cars[0].resources,
      availableTyres:[
        {tyre_id:"dry_a",compound_name:"Dry A",category:"dry",grip_index:78,wear_rate:.018,warmup_time_s:2.5},
      ],
    },
  };
  const source={...started,cars:[car]};
  const activated=enforceRaceControlAssessment(
    source,
    assessment(source,{mode:"RED_FLAG",source:"incident",referenceLap:1}),
    source.cars
  );
  const red={
    ...source,
    raceControlState:activated.raceControlState,
    session:{...source.session,raceControl:activated.raceControlState},
  };

  assert.equal(
    applyCanonicalRedFlagTyreChange(red,{driverId:"D1",teamId:"OTHER",tyreId:"dry_a"}),
    red
  );
  const locked={
    ...red,
    raceControlState:{
      ...red.raceControlState,
      redFlagLifecycle:{
        ...red.raceControlState.redFlagLifecycle,
        work_locked:true,
      },
    },
  };
  assert.equal(canonicalRedFlagWorkWindowOpen(locked),false);
  assert.equal(
    applyCanonicalRedFlagRestartStrategy(locked,{driverId:"D1",teamId:"T1",paceMode:"attack"}),
    locked
  );
});

test("RW23 AI Red Flag service uses the same canonical work functions and is idempotent once conditions match",()=>{
  const wet=weatherRow(1,{state:"HEAVY_RAIN",wetness:.9,rain:.9,grip:35});
  const started=startRaceState(createRaceState(input({year:2026,timeline:[wet,wet,wet]})));
  const car={
    ...started.cars[0],
    damage:damageStateFromComponents({front_wing:45},{source:"test"}),
    tyre:{
      ...started.cars[0].tyre,
      tyre_id:"dry_a",
      compound:"Dry A",
      category:"dry",
      condition:45,
    },
    resources:{
      ...started.cars[0].resources,
      strategy:{...started.cars[0].resources.strategy,aiControlled:true},
      availableTyres:[
        {tyre_id:"dry_a",compound_name:"Dry A",category:"dry",grip_index:78,wear_rate:.018,warmup_time_s:2.5},
        {tyre_id:"wet_a",compound_name:"Wet A",category:"wet",grip_index:72,wear_rate:.020,warmup_time_s:3},
      ],
    },
  };
  const source={...started,cars:[car]};
  const activated=enforceRaceControlAssessment(
    source,
    assessment(source,{mode:"RED_FLAG",source:"weather",referenceLap:1}),
    source.cars
  );
  const red={
    ...source,
    raceControlState:activated.raceControlState,
    session:{...source.session,raceControl:activated.raceControlState},
  };

  const worked=applyAutomaticCanonicalRedFlagWork(red);
  assert.equal(worked.cars[0].tyre.category,"wet");
  assert.ok(worked.cars[0].damage.pace_loss_s_per_lap<red.cars[0].damage.pace_loss_s_per_lap);
  const again=applyAutomaticCanonicalRedFlagWork(worked);
  assert.equal(again.cars[0].tyre.tyre_id,"wet_a");
  assert.equal(again.cars[0].tyre.stint_number,worked.cars[0].tyre.stint_number);
});

test("RW8.11B Red Flag freezes race distance and resumes through the shared restart lifecycle",()=>{
  const started=startRaceState(createRaceState(input({year:2026})));
  const movingCars=started.cars.map((car)=>({
    ...car,
    absoluteDistanceM:200,
    distanceAlongLapM:200,
    lap:1,
    completedLaps:0,
    sector:1,
    speedMs:50,
    speedKmh:180,
    status:"running",
  }));
  const working={...started,cars:movingCars};
  const activated=enforceRaceControlAssessment(
    working,
    assessment(working,{
      mode:"RED_FLAG",
      source:"incident",
      referenceLap:1,
      assessmentValue:{score:90,severity:"critical"},
    }),
    movingCars
  );
  const red={
    ...working,
    raceControlState:activated.raceControlState,
    session:{...working.session,raceControl:activated.raceControlState},
  };

  assert.equal(red.raceControlState.mode,"RED_FLAG");
  assert.equal(red.raceControlState.redFlagLifecycle.phase,"suspended");
  assert.equal(raceControlFreezesProgress(red),true);

  const frozen=stepRaceState(red);
  assert.equal(frozen.cars[0].absoluteDistanceM,200);
  assert.equal(frozen.cars[0].speedKmh,0);
  assert.equal(frozen.tick,red.tick+1);
  assert.equal(frozen.raceControlState.redFlagLifecycle.phase,"restart_pending");
  assert.equal(frozen.raceControlState.mode,"RED_FLAG");
  assert.equal(raceControlFreezesProgress(frozen),true);
  assert.ok(frozen.events.some((event)=>event.type==="red_flag_restart_ready"));

  const restart=stepRaceState(frozen);
  assert.equal(restart.cars[0].absoluteDistanceM,200);
  assert.equal(restart.cars[0].speedKmh,0);
  assert.equal(restart.raceControlState.redFlagLifecycle.phase,"resumed");
  assert.equal(restart.raceControlState.mode,"GREEN");
  assert.equal(raceControlFreezesProgress(restart),false);

  const resumed=stepRaceState(restart);
  assert.ok(resumed.cars[0].absoluteDistanceM>200);
});
