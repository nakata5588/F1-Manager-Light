import test from "node:test";
import assert from "node:assert/strict";

import {
  applyLowerSeriesWorldToDrivers,
  lowerSeriesEntry,
  materializeLowerSeriesWorld,
  rollLowerSeriesWorld,
} from "../src/domain/lowerSeriesWorld.js";

const series=[
  {
    series_id:"s_f2_old",
    series_name:"European Formula Two Championship",
    short_name:"F2",
    series_level:2,
    start_year:1967,
    end_year:1980,
    successor_series_id:"s_f2_new",
  },
  {
    series_id:"s_f2_new",
    series_name:"International Formula Two",
    short_name:"F2",
    series_level:2,
    start_year:1981,
    end_year:1984,
  },
  {
    series_id:"s_f3",
    series_name:"British Formula Three",
    short_name:"BF3",
    series_level:3,
    start_year:1970,
    end_year:1990,
  },
  {
    series_id:"s_f3_alt",
    series_name:"European Formula Three",
    short_name:"EF3",
    series_level:3,
    start_year:1975,
    end_year:1990,
  },
  {
    series_id:"s_regional",
    series_name:"Formula Regional Test",
    short_name:"FR",
    series_level:4,
    start_year:1980,
    end_year:1990,
  },
  {
    series_id:"s_future",
    series_name:"Future Series",
    short_name:"FUT",
    series_level:2,
    start_year:1985,
    end_year:null,
  },
];

test("LS2 opening world materializes active series and selected-year team evidence only",()=>{
  const world=materializeLowerSeriesWorld({
    year:1980,
    series,
    seriesRules:[],
    drivers:[
      {driver_id:"D1",display_name:"Resolved Driver",dob:"1959-01-01"},
      {driver_id:"D2",display_name:"Ambiguous Driver",dob:"1961-01-01"},
    ],
    placements:[
      {
        driver_id:"D1",
        active_pre_f1_world:true,
        series_id:"s_f2_old",
        series_name:"European Formula Two Championship",
        series_level:2,
        series_resolution:"historical_series_id",
        series_candidates:[],
      },
      {
        driver_id:"D2",
        active_pre_f1_world:true,
        series_id:null,
        series_name:null,
        series_level:3,
        series_resolution:"candidate_pool",
        series_candidates:[
          {series_id:"s_f3",series_name:"British Formula Three",series_level:3},
          {series_id:"s_f3_alt",series_name:"European Formula Three",series_level:3},
        ],
      },
    ],
    driverCareer:[
      {
        driver_id:"D1",
        year:1980,
        series_id:"s_f2_old",
        series_division:"F2",
        team_name:"Project Four Racing",
      },
      {
        driver_id:"D1",
        year:1981,
        series_id:"s_f2_new",
        series_division:"F2",
        team_name:"Future Historical Team",
      },
    ],
  });

  assert.equal(world.authority,"save_world");
  assert.equal(world.season_year,1980);
  assert.equal(world.series.some((row)=>row.series_id==="s_future"),false);

  const d1=lowerSeriesEntry(world,"D1");
  assert.equal(d1.series_id,"s_f2_old");
  assert.equal(d1.team_name,"Project Four Racing");
  assert.equal(d1.placement_status,"placed_with_team");
  assert.ok(d1.lower_team_id);
  assert.equal(
    Object.values(world.teams).some((row)=>row.team_name==="Future Historical Team"),
    false,
    "future historical team evidence must not enter the opening Save World"
  );

  const d2=lowerSeriesEntry(world,"D2");
  assert.equal(d2.series_id,null);
  assert.equal(d2.placement_status,"candidate_pool");
  assert.deepEqual(
    d2.series_candidates.map((row)=>row.series_id),
    ["s_f3","s_f3_alt"]
  );
  assert.equal(d2.lower_team_id,null);
});

test("LS2 rollover keeps Save World continuity, follows structural successor and adds new entrants without historical future assignments",()=>{
  const opening=materializeLowerSeriesWorld({
    year:1980,
    series,
    seriesRules:[],
    drivers:[{driver_id:"D1",dob:"1958-01-01"}],
    placements:[{
      driver_id:"D1",
      active_pre_f1_world:true,
      series_id:"s_f2_old",
      series_name:"European Formula Two Championship",
      series_level:2,
      series_resolution:"historical_series_id",
      series_candidates:[],
    }],
    driverCareer:[{
      driver_id:"D1",
      year:1980,
      series_id:"s_f2_old",
      series_division:"F2",
      team_name:"Opening Team",
    }],
  });

  const next=rollLowerSeriesWorld(opening,{
    targetYear:1981,
    series,
    seriesRules:[],
    drivers:[
      {
        driver_id:"D1",
        age:23,
        active_lower_series:true,
        status:"lower_series",
      },
      {
        driver_id:"D2",
        age:19,
        active_lower_series:true,
        status:"junior_only",
        lower_series_level:4,
      },
    ],
  });

  const d1=lowerSeriesEntry(next,"D1");
  assert.equal(d1.series_id,"s_f2_new");
  assert.equal(d1.placement_source,"structural_series_successor");
  assert.equal(d1.lower_team_id,null,"a team cannot silently follow a driver into a different series");

  const d2=lowerSeriesEntry(next,"D2");
  assert.equal(d2.series_id,"s_regional");
  assert.equal(d2.placement_source,"single_active_eligible_series");
  assert.equal(d2.team_name,null,"new Save World entrants do not receive future historical teams");

  assert.equal(next.history.length,1);
  assert.equal(next.history[0].season_year,1980);
  assert.equal(next.history[0].entries[0].team_name,"Opening Team");
});

test("LS2 documented age rules can leave a driver structurally unresolved instead of forcing a series",()=>{
  const next=rollLowerSeriesWorld(null,{
    targetYear:1981,
    series:[
      {series_id:"age_limited",series_name:"Age Limited F2",series_level:2,start_year:1980,end_year:1990},
    ],
    seriesRules:[
      {series_rule_id:"age_rule",series_id:"age_limited",valid_from:1980,valid_to:1990,max_age:20},
    ],
    drivers:[
      {driver_id:"D1",dob:"1958-01-01",age:23,active_lower_series:true,status:"lower_series",lower_series_level:2},
    ],
  });

  const row=lowerSeriesEntry(next,"D1");
  assert.equal(row.series_id,null);
  assert.equal(row.placement_status,"unresolved");
  assert.equal(row.placement_source,"no_catalog_match");
});

test("LS2 driver projection follows the Save World and clears lower-series state for an F1 race-seat driver",()=>{
  const world=rollLowerSeriesWorld(null,{
    targetYear:1981,
    series:[{series_id:"s_f3",series_name:"British Formula Three",series_level:3,start_year:1970,end_year:1990}],
    seriesRules:[],
    drivers:[
      {driver_id:"D1",age:20,active_lower_series:true,status:"lower_series",lower_series_level:3},
      {driver_id:"D2",age:20,active_lower_series:true,status:"lower_series",lower_series_level:3},
    ],
    excludedDriverIds:["D2"],
  });

  const projected=applyLowerSeriesWorldToDrivers([
    {driver_id:"D1",active_lower_series:true,status:"lower_series"},
    {driver_id:"D2",active_lower_series:true,status:"lower_series",lower_series_id:"old"},
  ],world,{inactiveDriverIds:["D2"]});

  const d1=projected.find((row)=>row.driver_id==="D1");
  assert.equal(d1.lower_series_id,"s_f3");
  assert.equal(d1.world_runtime_source,"lower_series_world");

  const d2=projected.find((row)=>row.driver_id==="D2");
  assert.equal(d2.active_lower_series,false);
  assert.equal(d2.lower_series_id,null);
  assert.equal(d2.lower_series_resolution,"left_for_f1_race_seat");
});
