import test from "node:test";
import assert from "node:assert/strict";

import {
  RACE_WEEKEND_CONTRACT_FIELDS,
  RACE_WEEKEND_CONTRACT_VERSION,
  RACE_WEEKEND_ENGINES,
  isRaceWeekendEngineVersion,
  normalizeRaceWeekendEngineVersion,
} from "../src/race2/contracts/raceContracts.js";
import { buildRaceWeekendInput } from "../src/race2/adapters/GameStateInputAdapter.js";

function fixture(){
  return {
    saveMeta:{seed:"rw8-contracts"},
    activeYear:1980,
    currentRound:0,
    team:{team_id:"T1"},
    pointsSystem:{table:[9,6,4,3,2,1]},
    drivers:[
      {driver_id:"D2",display_name:"Driver Two"},
      {driver_id:"D1",display_name:"Driver One"},
    ],
    driverRatings:[
      {driver_id:"D1",pace:80},
      {driver_id:"D2",pace:79},
    ],
    driverAttributes:{
      D1:{fatigue:5},
      D2:{fatigue:2},
    },
    garage:{
      cars:[
        {id:"car_1",kind:"race",driver_id:"CONTRACTED_D1",componentCondition:{engine:94}},
      ],
    },
    aiTechnicalWorld:{
      version:1,
      teams:{
        T2:{
          garage:{
            cars:[
              {id:"ai_T2_car_1",kind:"race",componentCondition:{engine:91}},
            ],
          },
        },
      },
    },
    raceEntryState:{
      entries:[
        {driver_id:"D2",team_id:"T2",car_id:"ai_T2_car_1",status:"confirmed"},
        {driver_id:"D1",team_id:"T1",car_id:"car_1",status:"confirmed"},
      ],
    },
    raceWeekendState:{
      engine_version:"rw2",
      key:"1980_1_test",
      year:1980,
      roundIndex:0,
      round:1,
      gp_id:"test_gp",
      gp_name:"Test Grand Prix",
      track_id:"test_track",
      raceDate:"1980-05-18",
      entrants:[
        {driver_id:"D2",team_id:"T2",car_id:"ai_T2_car_1",status:"confirmed"},
        {driver_id:"D1",team_id:"T1",car_id:"car_1",status:"confirmed"},
      ],
      qualifying_rule_snapshot:{strategy:"best_time"},
      race_strategy:{
        rules_snapshot:{refuelling_allowed:false},
        track_snapshot:{track_id:"test_track",laps:60,length_m:5000},
        weather_snapshot:{state:"SUNNY",wet_race:false},
      },
      startingGrid:{
        rows:[
          {grid:1,driver_id:"D1",team_id:"T1"},
          {grid:2,driver_id:"D2",team_id:"T2"},
        ],
      },
    },
  };
}

test("RW8 boundary contracts expose the canonical TrackModel, RaceState and CarState",()=>{
  assert.equal(RACE_WEEKEND_CONTRACT_VERSION,4);
  assert.deepEqual(
    Object.keys(RACE_WEEKEND_CONTRACT_FIELDS),
    ["RaceWeekendInput","RaceState","CarState","TrackModel","TrackState","Command","SessionState","RaceWeekendResult"]
  );
  assert.ok(RACE_WEEKEND_CONTRACT_FIELDS.RaceState.includes("track"));
  assert.ok(RACE_WEEKEND_CONTRACT_FIELDS.RaceState.includes("engineVersion"));
  assert.ok(RACE_WEEKEND_CONTRACT_FIELDS.CarState.includes("gridPosition"));
  assert.ok(RACE_WEEKEND_CONTRACT_FIELDS.CarState.includes("completedLaps"));
  assert.ok(RACE_WEEKEND_CONTRACT_FIELDS.CarState.includes("sector"));
  assert.ok(RACE_WEEKEND_CONTRACT_FIELDS.CarState.includes("distanceAlongLapM"));
  assert.ok(RACE_WEEKEND_CONTRACT_FIELDS.CarState.includes("absoluteDistanceM"));
  assert.ok(RACE_WEEKEND_CONTRACT_FIELDS.CarState.includes("targetSpeedKmh"));
  assert.ok(RACE_WEEKEND_CONTRACT_FIELDS.CarState.includes("performance"));
  assert.ok(RACE_WEEKEND_CONTRACT_FIELDS.TrackModel.includes("speedProfile"));
  assert.ok(RACE_WEEKEND_CONTRACT_FIELDS.Command.includes("effectiveAtTick"));
});

test("RW8.0A engine version normalization is explicit and Legacy-safe",()=>{
  assert.equal(normalizeRaceWeekendEngineVersion("rw2"),RACE_WEEKEND_ENGINES.RW2);
  assert.equal(normalizeRaceWeekendEngineVersion("legacy"),RACE_WEEKEND_ENGINES.LEGACY);
  assert.equal(normalizeRaceWeekendEngineVersion("unknown"),RACE_WEEKEND_ENGINES.LEGACY);
  assert.equal(isRaceWeekendEngineVersion("rw2"),true);
  assert.equal(isRaceWeekendEngineVersion("legacy"),true);
  assert.equal(isRaceWeekendEngineVersion("other"),false);
});

test("RW8.0A GameState adapter is deterministic, detached and preserves the full entered field",()=>{
  const gs=fixture();
  const gp={gp_id:"test_gp",gp_name:"Test Grand Prix",track_id:"test_track",race_date:"1980-05-18"};
  const a=buildRaceWeekendInput(gs,{gp});
  const b=buildRaceWeekendInput(gs,{gp});

  assert.deepEqual(a,b);
  assert.equal(a.engineVersion,"rw2");
  assert.equal(a.seed,"rw8-contracts");
  assert.equal(a.track.schemaVersion,2);
  assert.equal(a.track.trackId,"test_track");
  assert.equal(a.track.lengthM,5000);
  assert.equal(a.track.laps,60);
  assert.deepEqual(a.drivers.map((row)=>row.driverId),["D1","D2"]);
  assert.deepEqual(a.cars.map((row)=>row.carId),["ai_T2_car_1","car_1"]);

  const playerCar=a.cars.find((row)=>row.carId==="car_1");
  const aiCar=a.cars.find((row)=>row.carId==="ai_T2_car_1");
  assert.equal(playerCar.driverId,"D1","race entry owns the weekend driver assignment");
  assert.equal(aiCar.driverId,"D2","AI cars without persisted driver IDs use the authoritative race entry");
  assert.equal(aiCar.teamId,"T2");
  assert.equal(aiCar.state.componentCondition.engine,91);
  assert.ok(Number.isFinite(playerCar.performance.race));
  assert.ok(Number.isFinite(playerCar.performance.power));
  assert.ok(Number.isFinite(a.drivers.find((row)=>row.driverId==="D1").performance.raceScore));
  assert.equal(a.track.speedProfile.detailed,false);
  assert.deepEqual(a.startingGrid.map((row)=>row.driver_id),["D1","D2"]);

  a.drivers[0].ratings.pace=1;
  playerCar.state.componentCondition.engine=1;
  aiCar.state.componentCondition.engine=2;
  a.startingGrid[0].grid=99;

  assert.equal(gs.driverRatings.find((row)=>row.driver_id==="D1").pace,80);
  assert.equal(gs.garage.cars.find((row)=>row.id==="car_1").componentCondition.engine,94);
  assert.equal(gs.aiTechnicalWorld.teams.T2.garage.cars[0].componentCondition.engine,91);
  assert.equal(gs.raceWeekendState.startingGrid.rows[0].grid,1);
});
