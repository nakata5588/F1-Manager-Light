import test from "node:test";
import assert from "node:assert/strict";

import {
  applyLowerSeriesEntriesToPlacements,
  lowerSeriesEntryCoverage,
  openingLowerSeriesEntriesForYear,
} from "../src/domain/lowerSeriesEntries.js";
import {
  lowerSeriesEntry,
  materializeLowerSeriesWorld,
} from "../src/domain/lowerSeriesWorld.js";
import { materializeSeasonPack } from "../src/data/seasonPackMaterializer.js";
import { buildFreshCareerState } from "../src/state/newGameRuntime.js";
import {
  seasonPackGlobalDataFromDatabaseState,
  seasonPackStatePatch,
} from "../src/data/seasonPackLoader.js";

const series=[
  {
    series_id:"s_bf3",
    series_name:"British Formula Three",
    short_name:"BF3",
    series_level:3,
    start_year:1951,
    end_year:2014,
  },
];

test("LS9A opening entry filter never leaks a mid-season historical replacement into January",()=>{
  const rows=[
    {
      lower_entry_id:"open",
      year:1983,
      series_id:"s_bf3",
      lower_team_id:"LT_WSR",
      driver_id:"D_SENNA",
      driver_name:"Ayrton Senna",
      round_from:1,
      round_to:20,
    },
    {
      lower_entry_id:"replacement",
      year:1983,
      series_id:"s_bf3",
      lower_team_id:"LT_WSR",
      driver_id:"D_REPLACEMENT",
      driver_name:"Future Replacement",
      round_from:7,
      round_to:20,
    },
    {
      lower_entry_id:"future-season",
      year:1984,
      series_id:"s_bf3",
      lower_team_id:"LT_OTHER",
      driver_id:"D_FUTURE",
      round_from:1,
    },
  ];

  const opening=openingLowerSeriesEntriesForYear(rows,1983);
  assert.deepEqual(opening.map((row)=>row.lower_entry_id),["open"]);

  const coverage=lowerSeriesEntryCoverage(rows,1983);
  assert.equal(coverage.entries,2,"coverage keeps the full historical season for audit purposes");
});

test("LS9A factual entry overrides heuristic series placement and can add a known historical entrant",()=>{
  const placements=[
    {
      driver_id:"D1",
      display_name:"Driver One",
      year:1983,
      stage:"D7.W2",
      authority:"analysis_only",
      placement:"LOWER_SERIES",
      active_pre_f1_world:true,
      series_id:null,
      series_name:null,
      series_level:3,
      series_resolution:"candidate_pool",
      series_candidates:[{series_id:"other",series_name:"Other F3",series_level:3}],
    },
  ];
  const entries=[
    {
      lower_entry_id:"e1",year:1983,series_id:"s_bf3",
      lower_team_id:"LT_WSR",driver_id:"D1",driver_name:"Driver One",round_from:1,
    },
    {
      lower_entry_id:"e2",year:1983,series_id:"s_bf3",
      lower_team_id:"LT_EJR",driver_id:"D2",driver_name:"Driver Two",round_from:1,
    },
  ];

  const resolved=applyLowerSeriesEntriesToPlacements(placements,entries,{
    year:1983,
    series,
    seriesRules:[],
  });

  const d1=resolved.find((row)=>row.driver_id==="D1");
  assert.equal(d1.series_id,"s_bf3");
  assert.equal(d1.series_name,"British Formula Three");
  assert.equal(d1.series_level,3);
  assert.equal(d1.series_resolution,"historical_lower_series_entry");
  assert.deepEqual(d1.series_candidates,[]);

  const d2=resolved.find((row)=>row.driver_id==="D2");
  assert.ok(d2,"a factual entry proves that the driver exists in the junior world");
  assert.equal(d2.active_pre_f1_world,true);
  assert.equal(d2.series_id,"s_bf3");
});

test("LS9A Lower Series world prefers factual entry/team over legacy driver_career evidence",()=>{
  const lowerSeriesTeams=[
    {
      lower_team_id:"LT_WSR",
      team_name:"West Surrey Racing",
      series_id:"s_bf3",
      valid_from:1981,
      valid_to:1984,
    },
  ];
  const lowerSeriesEntries=[
    {
      lower_entry_id:"bf3_1983_senna",
      year:1983,
      series_id:"s_bf3",
      lower_team_id:"LT_WSR",
      team_name:"West Surrey Racing",
      driver_id:"D1",
      driver_name:"Driver One",
      car_no:"1",
      round_from:1,
      source:"Racing Years",
      source_url:"https://example.invalid/race",
    },
  ];

  const world=materializeLowerSeriesWorld({
    year:1983,
    series,
    seriesRules:[],
    lowerSeriesTeams,
    lowerSeriesEntries,
    drivers:[{driver_id:"D1",display_name:"Driver One"}],
    placements:[{
      driver_id:"D1",
      display_name:"Driver One",
      year:1983,
      stage:"D7.W2",
      authority:"analysis_only",
      placement:"LOWER_SERIES",
      active_pre_f1_world:true,
      series_id:"s_bf3",
      series_name:"British Formula Three",
      series_level:3,
      series_resolution:"historical_lower_series_entry",
      series_candidates:[],
    }],
    driverCareer:[{
      year:1983,
      driver_id:"D1",
      series_id:"s_bf3",
      series_division:"F3",
      team_name:"Wrong Legacy Team",
    }],
  });

  const entry=lowerSeriesEntry(world,"D1");
  assert.equal(entry.lower_team_id,"LT_WSR");
  assert.equal(entry.team_name,"West Surrey Racing");
  assert.equal(entry.car_no,"1");
  assert.equal(entry.placement_source,"historical_lower_series_entry");
  assert.equal(entry.factual_lower_entry_id,"bf3_1983_senna");
  assert.equal(entry.opening_source,"Racing Years");
  assert.equal(
    Object.values(world.teams).some((row)=>row.team_name==="Wrong Legacy Team"),
    false
  );
});

test("LS9A Season Pack loader carries only selected opening entries and database fallback knows the new source",()=>{
  const dbState={
    dbLowerSeriesEntries:[
      {year:1983,series_id:"s_bf3",driver_id:"D1",round_from:1},
      {year:1983,series_id:"s_bf3",driver_id:"D2",round_from:8},
      {year:1984,series_id:"s_bf3",driver_id:"D3",round_from:1},
    ],
  };
  const global=seasonPackGlobalDataFromDatabaseState(dbState);
  assert.equal(global.lowerSeriesEntries.length,3);

  const patch=seasonPackStatePatch({
    format:"f1ml-season-pack",
    schemaVersion:2,
    year:1983,
    validation:{ok:true},
    state:{
      lowerSeriesEntries:[
        {year:1983,series_id:"s_bf3",driver_id:"D1",round_from:1},
      ],
    },
  });
  assert.equal(patch.lowerSeriesEntries.length,1);
  assert.equal(patch.lowerSeriesEntries[0].driver_id,"D1");
});

test("LS9A Season Pack materializer retains Round-1 facts, drops later replacements, and adds factual driver placement",()=>{
  const data={
    drivers:[
      {driver_id:"F1A",display_name:"F1 Driver",dob:"1950-01-01",f1_rookie_season:1975},
      {driver_id:"D1",display_name:"Junior Driver",dob:"1963-01-01",f1_rookie_season:1984},
      {driver_id:"D2",display_name:"Midseason Driver",dob:"1962-01-01",f1_rookie_season:1986},
    ],
    teams:[{team_id:"T1",team_name:"F1 Team",founded_year:1970}],
    teamSeasons:[{
      year:1983,team_id:"T1",team_name:"F1 Team",driver_ids:["F1A"],
      first_race_driver_candidates:[
        {driver_id:"F1A",first_round:1,first_source_index:1,exact_entrant:true,confidence:["HIGH"]},
      ],
    }],
    teamBrands:[{year:1983,team_id:"T1",team_name:"F1 Team"}],
    contracts:[{year:1983,team_id:"T1",team_name:"F1 Team",driver_id:"F1A",role:"main_driver"}],
    carStats:[{year:1983,team_id:"T1"}],
    driverCareer:[],
    driverOpeningState:[],
    driverRatings:[
      {year:1983,driver_id:"F1A",current_ability:70,peak_ability:75},
      {year:1983,driver_id:"D1",current_ability:65,peak_ability:85},
    ],
    driverRatingProfiles:[],
    historicalRatingSnapshots:[],
    driverHistory:[],
    calendar:[{year:1983,round:1,gp_id:"GP1",gp_name:"GP",track_id:"A",race_date:"1983-03-01"}],
    qualifyingRules:[{year:1950,session_count:2,max_starters:24}],
    qualifyingRuleOverrides:[],
    rules:[{year:1983,points_system:"9,6,4,3,2,1"}],
    eraSafety:[{year:1983,era_safety_index:0.5}],
    accidentModel:[],
    series,
    seriesRules:[],
    lowerSeriesTeams:[
      {lower_team_id:"LT_WSR",team_name:"West Surrey Racing",series_id:"s_bf3",valid_from:1981,valid_to:1984},
    ],
    lowerSeriesEntries:[
      {lower_entry_id:"open",year:1983,series_id:"s_bf3",lower_team_id:"LT_WSR",team_name:"West Surrey Racing",driver_id:"D1",driver_name:"Junior Driver",round_from:1},
      {lower_entry_id:"late",year:1983,series_id:"s_bf3",lower_team_id:"LT_WSR",team_name:"West Surrey Racing",driver_id:"D2",driver_name:"Midseason Driver",round_from:8},
      {lower_entry_id:"future",year:1984,series_id:"s_bf3",lower_team_id:"LT_WSR",team_name:"West Surrey Racing",driver_id:"D2",round_from:1},
    ],
    driverYearStatus:[],driverDevelopmentHistory:[],driverAvailabilityHistory:[],driverTeamHistory:[],
    teamEngineHistory:[],carCompetitiveness:[],historicalChampionships:{drivers:[],constructors:[]},teamLineageHistory:[],
    staffRatings:[],staffCore:[],teamEngines:[],sponsorsContracts:[],facilities:[],staffContracts:[],
    tyres:[],pointsSystems:[],penaltiesRules:[],financialRules:[],agendaBlocks:[],contractRules:[],
    youthIntakeRules:[],scoutingZones:[],trackLayoutByYear:[],coreTracks:[],
  };

  const pack=materializeSeasonPack(data,1983);

  assert.deepEqual(
    pack.state.lowerSeriesEntries.map((row)=>row.lower_entry_id),
    ["open"]
  );
  const placement=pack.state.driverFeederPlacement.find((row)=>row.driver_id==="D1");
  assert.ok(placement);
  assert.equal(placement.series_id,"s_bf3");
  assert.equal(placement.series_resolution,"historical_lower_series_entry");
  assert.ok(pack.state.drivers.some((row)=>row.driver_id==="D1"));
  const d2Placement=pack.state.driverFeederPlacement.find((row)=>row.driver_id==="D2");
  assert.notEqual(
    d2Placement?.factual_lower_series_entry_id,
    "late",
    "mid-season-only historical replacement must not become a Jan-1 factual placement"
  );
  assert.equal(
    pack.state.lowerSeriesEntries.some((row)=>row.lower_entry_id==="late"),
    false
  );
});


test("LS9A fresh career keeps only selected opening entries and drops the global future entry catalogue",()=>{
  const selected=[{
    lower_entry_id:"open",
    year:1983,
    series_id:"s_bf3",
    lower_team_id:"LT_WSR",
    driver_id:"D1",
    round_from:1,
  }];
  const fresh=buildFreshCareerState({
    lowerSeriesEntries:selected,
    dbLowerSeriesEntries:[
      ...selected,
      {lower_entry_id:"future",year:1984,series_id:"s_bf3",lower_team_id:"LT_WSR",driver_id:"D1",round_from:1},
    ],
  },{});

  assert.deepEqual(fresh.lowerSeriesEntries,selected);
  assert.equal(
    Object.prototype.hasOwnProperty.call(fresh,"dbLowerSeriesEntries"),
    false,
    "future historical line-ups must not cross the New Game isolation boundary"
  );
});
