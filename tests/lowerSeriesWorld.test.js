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
    series_id:"s_f4",
    series_name:"Formula Four Test",
    short_name:"F4",
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
  assert.equal(d2.series_id,"s_f4");
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


test("LS3.5A team catalogue materializes factual teams without inventing line-ups",()=>{
  const lowerSeriesTeams=[
    {lower_team_id:"LT1",team_name:"Project Four Racing",series_id:"s_f2_old",valid_from:1979,valid_to:1980},
    {lower_team_id:"LT2",team_name:"Independent Racing",series_id:"s_f2_old",valid_from:1978,valid_to:1980},
    {lower_team_id:"FUTURE",team_name:"Future Team",series_id:"s_f2_new",valid_from:1981,valid_to:1984},
  ];
  const world=materializeLowerSeriesWorld({
    year:1980,
    series,
    seriesRules:[],
    lowerSeriesTeams,
    drivers:[
      {driver_id:"D1",display_name:"Known Driver",dob:"1958-01-01"},
      {driver_id:"D2",display_name:"Unassigned Driver",dob:"1959-01-01"},
    ],
    placements:[
      {
        driver_id:"D1",active_pre_f1_world:true,
        series_id:"s_f2_old",series_name:"European Formula Two Championship",
        series_level:2,series_resolution:"historical_series_id",series_candidates:[],
      },
      {
        driver_id:"D2",active_pre_f1_world:true,
        series_id:"s_f2_old",series_name:"European Formula Two Championship",
        series_level:2,series_resolution:"single_active_eligible_series",series_candidates:[],
      },
    ],
    driverCareer:[{
      driver_id:"D1",year:1980,series_id:"s_f2_old",series_division:"F2",
      team_name:"Project Four Racing",
    }],
  });

  assert.deepEqual(Object.keys(world.teams),["LT1","LT2"]);
  assert.equal(world.teams.LT1.team_strength,50);
  assert.equal(world.teams.LT1.reliability,90);
  assert.equal(world.teams.LT1.development_environment,50);
  assert.equal(world.teams.LT1.source,"lower_series_team_catalog");
  assert.equal(lowerSeriesEntry(world,"D1").lower_team_id,"LT1");
  assert.equal(lowerSeriesEntry(world,"D1").placement_status,"placed_with_team");
  assert.equal(lowerSeriesEntry(world,"D2").lower_team_id,null);
  assert.equal(lowerSeriesEntry(world,"D2").placement_status,"series_only");
  assert.equal(Boolean(world.teams.FUTURE),false,"future team facts must not enter the opening Save World");
});

test("LS3.5A rollover keeps mutable team state only while the factual team remains active",()=>{
  const lowerSeriesTeams=[
    {lower_team_id:"F3A",team_name:"F3 Team A",series_id:"s_f3",valid_from:1980,valid_to:1982},
    {lower_team_id:"F3B",team_name:"F3 Team B",series_id:"s_f3",valid_from:1981,valid_to:1984},
  ];
  const opening=materializeLowerSeriesWorld({
    year:1980,
    series,
    seriesRules:[],
    lowerSeriesTeams,
    drivers:[{driver_id:"D1",dob:"1960-01-01"}],
    placements:[{
      driver_id:"D1",active_pre_f1_world:true,
      series_id:"s_f3",series_name:"British Formula Three",
      series_level:3,series_resolution:"historical_series_id",series_candidates:[],
    }],
    driverCareer:[{
      driver_id:"D1",year:1980,series_id:"s_f3",series_division:"F3",team_name:"F3 Team A",
    }],
  });
  opening.teams.F3A.team_strength=67;
  opening.teams.F3A.reliability=84;
  opening.teams.F3A.development_environment=73;

  const next=rollLowerSeriesWorld(opening,{
    targetYear:1981,
    series,
    seriesRules:[],
    lowerSeriesTeams,
    drivers:[{driver_id:"D1",age:21,active_lower_series:true,status:"lower_series",lower_series_level:3}],
  });

  assert.equal(next.teams.F3A.team_strength,67);
  assert.equal(next.teams.F3A.reliability,84);
  assert.equal(next.teams.F3A.development_environment,73);
  assert.equal(next.teams.F3A.source,"save_world_continuity");
  assert.ok(next.teams.F3B,"newly active factual teams enter with a neutral Save World seed");
  assert.equal(lowerSeriesEntry(next,"D1").lower_team_id,"F3A");

  const afterExpiry=rollLowerSeriesWorld(next,{
    targetYear:1983,
    series,
    seriesRules:[],
    lowerSeriesTeams,
    drivers:[{driver_id:"D1",age:23,active_lower_series:true,status:"lower_series",lower_series_level:3}],
  });
  assert.equal(Boolean(afterExpiry.teams.F3A),false,"expired factual team must not be carried forever");
  assert.ok(afterExpiry.teams.F3B);
  assert.equal(lowerSeriesEntry(afterExpiry,"D1").lower_team_id,null);
});
