import test from "node:test";
import assert from "node:assert/strict";

import {
  lowerSeriesCareerMovement,
} from "../src/domain/lowerSeriesCareerMovement.js";
import {
  applyLowerSeriesWorldToDrivers,
  rollLowerSeriesWorld,
} from "../src/domain/lowerSeriesWorld.js";
import { initializeLowerSeriesSeason } from "../src/engine/LowerSeriesEngine.js";

const series=[
  {series_id:"F2",series_name:"Formula Two",series_level:2,start_year:2000,end_year:2015},
  {series_id:"F3",series_name:"Formula Three",series_level:3,start_year:2000,end_year:2015},
  {series_id:"F4",series_name:"Formula Four",series_level:4,start_year:2000,end_year:2015},
];

function previousWorld({
  driverId="D1",
  seriesId="F4",
  level=4,
  position=1,
  starts=7,
  complete=true,
  champion=true,
  reputation=72,
  performance=78,
}={}){
  return {
    version:6,
    authority:"save_world",
    season_year:2007,
    source_season:2007,
    series:series.map((row)=>({...row})),
    teams:{
      OLD:{
        lower_team_id:"OLD",
        series_id:seriesId,
        team_name:"Old Junior Team",
        season_year:2007,
        team_strength:55,
        reliability:90,
        development_environment:55,
      },
    },
    entries:{
      [driverId]:{
        driver_id:driverId,
        series_id:seriesId,
        series_name:series.find((row)=>row.series_id===seriesId)?.series_name||seriesId,
        series_level:level,
        lower_team_id:"OLD",
        team_name:"Old Junior Team",
        placement_status:"placed_with_team",
        placement_source:"save_world_continuity",
        joined_world_year:2006,
      },
    },
    standings:{
      [seriesId]:{
        series_id:seriesId,
        series_name:series.find((row)=>row.series_id===seriesId)?.series_name||seriesId,
        series_level:level,
        complete,
        champion_driver_id:champion?driverId:"D2",
        drivers:[
          {
            position,
            driver_id:driverId,
            starts,
            wins:champion?4:0,
            podiums:champion?6:1,
            points:champion?72:22,
          },
          {position:position===1?2:1,driver_id:"D2",starts,wins:1,podiums:3,points:48},
          {position:3,driver_id:"D3",starts,wins:0,podiums:1,points:28},
        ],
        teams:[],
      },
    },
    prospects:{
      [driverId]:{
        driver_id:driverId,
        season_year:2007,
        series_id:seriesId,
        series_level:level,
        lower_team_id:"OLD",
        prospect_reputation:reputation,
        season_start_reputation:35,
        performance:{
          starts,
          position,
          field_size:3,
          points:champion?72:22,
          wins:champion?4:0,
          podiums:champion?6:1,
          score:performance,
          exposure:1,
        },
        f1_interest:[],
        best_f1_interest:null,
        academy_team_id:null,
      },
    },
    events:[],
    results:[],
    history:[],
  };
}

test("LS7 promotes a strong completed-season prospect exactly one feeder level",()=>{
  const world=previousWorld();
  const driver={
    driver_id:"D1",
    age:20,
    active_lower_series:true,
    status:"lower_series",
    potential_ability:99,
  };
  const entry=world.entries.D1;
  const movement=lowerSeriesCareerMovement(world,driver,entry,{targetYear:2008});

  assert.equal(movement.decision,"promote");
  assert.equal(movement.from_level,4);
  assert.equal(movement.target_level,3);
  assert.equal(movement.f1_ready,false);
  assert.equal(movement.champion,true);

  const changed=lowerSeriesCareerMovement(
    world,
    {...driver,potential_ability:5},
    entry,
    {targetYear:2008}
  );
  assert.deepEqual(changed,movement,"hidden PA must not affect Lower Series movement");
});

test("LS7 does not promote from an incomplete championship or a weak completed season",()=>{
  const incomplete=previousWorld({complete:false,champion:true,reputation:90,performance:95});
  const driver={driver_id:"D1",age:20,active_lower_series:true,status:"lower_series"};
  const incompleteMovement=lowerSeriesCareerMovement(
    incomplete,driver,incomplete.entries.D1,{targetYear:2008}
  );
  assert.equal(incompleteMovement.decision,"stay");
  assert.equal(incompleteMovement.reason,"insufficient_season_signal");

  const weak=previousWorld({
    complete:true,champion:false,position:3,reputation:35,performance:30,
  });
  const weakMovement=lowerSeriesCareerMovement(
    weak,driver,weak.entries.D1,{targetYear:2008}
  );
  assert.equal(weakMovement.decision,"stay");
  assert.equal(weakMovement.target_level,4);
  assert.equal(weakMovement.reason,"performance_stay");
});

test("LS7 rollover promotes to the next active category and never carries the old team across series",()=>{
  const world=previousWorld();
  const lowerSeriesTeams=[
    {lower_team_id:"OLD",team_name:"Old Junior Team",series_id:"F4",valid_from:2007,valid_to:2008},
    {lower_team_id:"NEW",team_name:"F3 Team",series_id:"F3",valid_from:2008,valid_to:2010},
  ];
  const drivers=[
    {driver_id:"D1",age:21,active_lower_series:true,status:"lower_series",lower_series_level:4},
  ];

  const next=rollLowerSeriesWorld(world,{
    targetYear:2008,
    drivers,
    series,
    seriesRules:[],
    lowerSeriesTeams,
  });
  const entry=next.entries.D1;

  assert.equal(entry.series_id,"F3");
  assert.equal(entry.series_level,3);
  assert.equal(entry.placement_source,"career_movement_single_series");
  assert.equal(entry.lower_team_id,null,"a promoted driver must not drag the old team into another series");
  assert.equal(entry.career_movement.decision,"promote");
  assert.equal(entry.career_movement.effective_outcome,"promoted");
  assert.equal(entry.career_movement.from_level,4);
  assert.equal(entry.career_movement.target_level,3);
  assert.equal(entry.career_movement.effective_level,3);

  const projected=applyLowerSeriesWorldToDrivers(drivers,next);
  assert.equal(projected[0].lower_series_level,3);
  assert.equal(projected[0].lower_series_f1_ready,false);
  assert.equal(projected[0].lower_series_career_movement.effective_outcome,"promoted");
});

test("LS7 marks a strong driver F1-ready when the era has no higher Lower Series tier",()=>{
  const world=previousWorld({
    seriesId:"F3",level:3,position:1,champion:true,reputation:80,performance:85,
  });
  const noF2=series.filter((row)=>row.series_id!=="F2");
  const drivers=[
    {driver_id:"D1",age:21,active_lower_series:true,status:"lower_series",lower_series_level:3},
  ];

  const next=rollLowerSeriesWorld(world,{
    targetYear:2008,
    drivers,
    series:noF2,
    seriesRules:[],
    lowerSeriesTeams:[],
  });
  const entry=next.entries.D1;

  assert.equal(entry.series_id,"F3");
  assert.equal(entry.series_level,3);
  assert.equal(entry.placement_source,"career_movement_f1_ready_no_higher_tier");
  assert.equal(entry.career_movement.decision,"promote");
  assert.equal(entry.career_movement.f1_ready,true);
  assert.equal(entry.career_movement.effective_outcome,"f1_ready");
  assert.equal(entry.career_movement.effective_level,3);

  const projected=applyLowerSeriesWorldToDrivers(drivers,next);
  assert.equal(projected[0].lower_series_f1_ready,true);
});

test("LS7 marks strong Level 2 drivers F1 Ready without removing them before an F1 race-seat exists",()=>{
  const world=previousWorld({
    seriesId:"F2",level:2,position:1,champion:true,reputation:85,performance:90,
  });
  const drivers=[
    {driver_id:"D1",age:22,active_lower_series:true,status:"lower_series",lower_series_level:2},
  ];

  const next=rollLowerSeriesWorld(world,{
    targetYear:2008,
    drivers,
    series,
    seriesRules:[],
    lowerSeriesTeams:[],
  });
  const entry=next.entries.D1;

  assert.equal(entry.series_id,"F2");
  assert.equal(entry.series_level,2);
  assert.equal(entry.career_movement.decision,"f1_ready");
  assert.equal(entry.career_movement.f1_ready,true);
  assert.equal(entry.career_movement.effective_outcome,"f1_ready");

  const projected=applyLowerSeriesWorldToDrivers(drivers,next);
  assert.equal(projected[0].active_lower_series,true);
  assert.equal(projected[0].lower_series_f1_ready,true);
  assert.equal(projected[0].lower_series_level,2);

  const excluded=rollLowerSeriesWorld(world,{
    targetYear:2008,
    drivers,
    series,
    seriesRules:[],
    lowerSeriesTeams:[],
    excludedDriverIds:["D1"],
  });
  assert.equal(excluded.entries.D1,undefined,"an actual F1 race seat remains authoritative over Lower Series");
  const left=applyLowerSeriesWorldToDrivers(drivers,excluded,{inactiveDriverIds:["D1"]});
  assert.equal(left[0].active_lower_series,false);
  assert.equal(left[0].lower_series_f1_ready,false);
  assert.equal(left[0].lower_series_resolution,"left_for_f1_race_seat");
});

test("LS7 resolves a multi-series promotion pool deterministically and records the effective promotion",()=>{
  const world=previousWorld();
  const multi=[
    ...series,
    {series_id:"F3B",series_name:"Formula Three B",series_level:3,start_year:2000,end_year:2015},
  ];
  const drivers=[
    {driver_id:"D1",age:21,active_lower_series:true,status:"lower_series",lower_series_level:4},
  ];

  const rolled=rollLowerSeriesWorld(world,{
    targetYear:2008,
    drivers,
    series:multi,
    seriesRules:[],
    lowerSeriesTeams:[],
  });
  assert.equal(rolled.entries.D1.series_id,null);
  assert.equal(rolled.entries.D1.career_movement.effective_outcome,"promotion_pending");
  assert.deepEqual(
    rolled.entries.D1.series_candidates.map((row)=>row.series_id),
    ["F3","F3B"]
  );

  const initialized=initializeLowerSeriesSeason({
    activeYear:2008,
    currentDateISO:"2008-01-01",
    saveMeta:{seed:"ls7-candidate-resolution"},
    contracts:[],
    drivers,
    driverRatings:[{driver_id:"D1",current_ability:65}],
    lowerSeriesWorld:rolled,
  });
  const resolved=initialized.lowerSeriesWorld.entries.D1;

  assert.ok(["F3","F3B"].includes(resolved.series_id));
  assert.equal(resolved.series_level,3);
  assert.equal(resolved.placement_source,"career_movement_candidate_resolution");
  assert.equal(resolved.career_movement.effective_outcome,"promoted");
  assert.equal(resolved.career_movement.resolved_series_id,resolved.series_id);
});
