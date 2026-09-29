import test from "node:test";
import assert from "node:assert/strict";

import {
  completeLowerSeriesSeason,
  initializeLowerSeriesSeason,
  processLowerSeriesTick,
} from "../src/engine/LowerSeriesEngine.js";
import { rollLowerSeriesWorld } from "../src/domain/lowerSeriesWorld.js";
import { triggerDailyTick } from "../src/engine/EventEngine.js";

function baseState(){
  return {
    activeYear:1980,
    currentDateISO:"1980-01-01",
    saveMeta:{seed:"ls3-test-seed"},
    results:[{key:"f1:1980:1",year:1980}],
    contracts:[],
    drivers:[
      {driver_id:"D1",display_name:"Driver One",age:22,active_lower_series:true,status:"lower_series"},
      {driver_id:"D2",display_name:"Driver Two",age:21,active_lower_series:true,status:"lower_series"},
      {driver_id:"D3",display_name:"Driver Three",age:20,active_lower_series:true,status:"lower_series"},
      {driver_id:"D4",display_name:"Driver Four",age:18,active_lower_series:true,status:"junior_only"},
    ],
    driverRatings:[
      {driver_id:"D1",current_ability:78,pace:80,qualifying:77,racecraft:79,consistency:76,aggression:55},
      {driver_id:"D2",current_ability:73,pace:72,qualifying:75,racecraft:73,consistency:74,aggression:50},
      {driver_id:"D3",current_ability:69,pace:70,qualifying:68,racecraft:69,consistency:70,aggression:60},
      {driver_id:"D4",current_ability:64,pace:65,qualifying:64,racecraft:63,consistency:66,aggression:58},
    ],
    lowerSeriesWorld:{
      version:2,
      authority:"save_world",
      season_year:1980,
      source_season:1980,
      series:[
        {series_id:"F2",series_name:"Formula Two",series_level:2},
        {series_id:"F3A",series_name:"Formula Three A",series_level:3},
        {series_id:"F3B",series_name:"Formula Three B",series_level:3},
        {series_id:"FR",series_name:"Formula Regional",series_level:4},
      ],
      teams:{
        T1:{lower_team_id:"T1",series_id:"F2",team_name:"Team One",team_strength:62,reliability:92},
        T2:{lower_team_id:"T2",series_id:"F2",team_name:"Team Two",team_strength:55,reliability:88},
      },
      entries:{
        D1:{
          driver_id:"D1",series_id:"F2",series_name:"Formula Two",series_level:2,
          lower_team_id:"T1",team_name:"Team One",series_candidates:[],placement_status:"placed_with_team",
        },
        D2:{
          driver_id:"D2",series_id:"F2",series_name:"Formula Two",series_level:2,
          lower_team_id:"T2",team_name:"Team Two",series_candidates:[],placement_status:"placed_with_team",
        },
        D3:{
          driver_id:"D3",series_id:null,series_name:null,series_level:3,
          lower_team_id:null,team_name:null,placement_status:"candidate_pool",
          series_candidates:[
            {series_id:"F3A",series_name:"Formula Three A",series_level:3},
            {series_id:"F3B",series_name:"Formula Three B",series_level:3},
          ],
        },
        D4:{
          driver_id:"D4",series_id:"FR",series_name:"Formula Regional",series_level:4,
          lower_team_id:null,team_name:null,series_candidates:[],placement_status:"series_only",
        },
      },
      standings:{},
      events:[],
      results:[],
      history:[],
    },
  };
}

test("LS3 initializes deterministic Save-World placements and schedules only levels 2/3",()=>{
  const a=initializeLowerSeriesSeason(baseState());
  const b=initializeLowerSeriesSeason(baseState());

  assert.equal(a.lowerSeriesWorld.entries.D3.series_id,b.lowerSeriesWorld.entries.D3.series_id);
  assert.ok(["F3A","F3B"].includes(a.lowerSeriesWorld.entries.D3.series_id));
  assert.equal(a.lowerSeriesWorld.entries.D3.placement_source,"save_world_candidate_resolution");

  const f2Events=a.lowerSeriesWorld.events.filter((event)=>event.series_id==="F2");
  assert.equal(f2Events.length,10);
  assert.equal(f2Events[0].event_date,"1980-03-15");

  const chosenF3=a.lowerSeriesWorld.entries.D3.series_id;
  assert.equal(a.lowerSeriesWorld.events.filter((event)=>event.series_id===chosenF3).length,8);
  assert.equal(a.lowerSeriesWorld.events.some((event)=>event.series_id==="FR"),false);
  assert.deepEqual(a.lowerSeriesWorld.results,[]);
});

test("LS3 processes due events deterministically and never writes into F1 results",()=>{
  const scheduled=initializeLowerSeriesSeason(baseState());
  const firstF2=scheduled.lowerSeriesWorld.events.find((event)=>event.series_id==="F2");
  const through={...scheduled,currentDateISO:firstF2.event_date};

  const first=processLowerSeriesTick(through);
  const second=processLowerSeriesTick({...initializeLowerSeriesSeason(baseState()),currentDateISO:firstF2.event_date});

  const result=first.lowerSeriesWorld.results.find((row)=>row.event_id===firstF2.event_id);
  const same=second.lowerSeriesWorld.results.find((row)=>row.event_id===firstF2.event_id);

  assert.ok(result);
  assert.equal(result.status,"completed");
  assert.deepEqual(result.classification,same.classification);
  assert.equal(first.results.length,1,"canonical F1 Results must remain untouched");
  assert.equal(first.results[0].key,"f1:1980:1");

  const standings=first.lowerSeriesWorld.standings.F2;
  assert.ok(standings);
  assert.equal(standings.updated_through_round,1);
  assert.equal(standings.drivers.reduce((sum,row)=>sum+row.starts,0),2);
  assert.equal(
    standings.drivers.reduce((sum,row)=>sum+row.wins,0),
    result.classification.some((row)=>row.status==="finished")?1:0
  );
});

test("LS3 full-season completion creates standings, champion and preserves event statistics",()=>{
  const completed=completeLowerSeriesSeason(baseState());
  const world=completed.lowerSeriesWorld;
  const f2Results=world.results.filter((row)=>row.series_id==="F2");

  assert.equal(f2Results.length,10);
  assert.ok(f2Results.every((row)=>["completed","skipped"].includes(row.status)));
  assert.equal(world.standings.F2.complete,true);
  assert.ok(world.standings.F2.champion_driver_id);
  assert.equal(world.standings.F2.drivers.length,2);

  for(const row of world.standings.F2.drivers){
    assert.equal(row.starts,10);
    assert.equal(row.finishes+row.dnfs,10);
    assert.ok(row.points>=0);
  }
});

test("LS3 excludes an active F1 race-seat driver from subsequent Lower Series events",()=>{
  let state=initializeLowerSeriesSeason(baseState());
  const firstF2=state.lowerSeriesWorld.events.find((event)=>event.series_id==="F2");
  state={...state,currentDateISO:firstF2.event_date};
  state=processLowerSeriesTick(state);

  const secondF2=state.lowerSeriesWorld.events
    .filter((event)=>event.series_id==="F2")
    .sort((a,b)=>a.round-b.round)[1];

  state={
    ...state,
    currentDateISO:secondF2.event_date,
    contracts:[{
      year:1980,team_id:"F1_TEAM",driver_id:"D1",role:"Main Driver",
      status:"active",contract_start_year:1980,contract_until_year:1980,
    }],
  };
  state=processLowerSeriesTick(state);

  const result=state.lowerSeriesWorld.results.find((row)=>row.event_id===secondF2.event_id);
  assert.ok(result);
  assert.equal(result.classification.some((row)=>row.driver_id==="D1"),false);
  assert.equal(state.drivers.find((row)=>row.driver_id==="D1").active_lower_series,false);
});

test("LS3 is idempotent when the same date is processed more than once",()=>{
  const scheduled=initializeLowerSeriesSeason(baseState());
  const firstDate=scheduled.lowerSeriesWorld.events[0].event_date;
  const once=processLowerSeriesTick({...scheduled,currentDateISO:firstDate});
  const twice=processLowerSeriesTick(once);

  assert.deepEqual(twice.lowerSeriesWorld.results,once.lowerSeriesWorld.results);
  assert.deepEqual(twice.lowerSeriesWorld.events,once.lowerSeriesWorld.events);
  assert.deepEqual(twice.lowerSeriesWorld.standings,once.lowerSeriesWorld.standings);
});


test("LS3 completed season is archived inside lowerSeriesWorld and not the F1 Results archive",()=>{
  const completed=completeLowerSeriesSeason(baseState());
  const rolled=rollLowerSeriesWorld(completed.lowerSeriesWorld,{
    targetYear:1981,
    drivers:[],
    series:[],
    seriesRules:[],
    excludedDriverIds:[],
  });

  assert.equal(rolled.history.length,1);
  assert.equal(rolled.history[0].season_year,1980);
  assert.equal(rolled.history[0].events.length,18);
  assert.equal(rolled.history[0].results.length,18);
  assert.ok(rolled.history[0].standings.F2);
  assert.equal(completed.results.length,1);
  assert.equal(completed.results[0].key,"f1:1980:1");
});


test("LS3 runs through the canonical daily EventEngine pipeline even with no queued management event",()=>{
  const scheduled=initializeLowerSeriesSeason(baseState());
  const firstF2=scheduled.lowerSeriesWorld.events.find((event)=>event.series_id==="F2");
  const daily=triggerDailyTick({
    ...scheduled,
    currentDateISO:firstF2.event_date,
    eventsQueue:[],
    inbox:[],
  });

  assert.ok(daily.lowerSeriesWorld.results.some((row)=>row.event_id===firstF2.event_id));
  assert.equal(daily.results.length,1);
  assert.equal(daily.results[0].key,"f1:1980:1");
});


test("LS3.5B assigns tracked prospects to real Save-World teams deterministically",()=>{
  const makeState=()=>{
    const state=baseState();
    state.lowerSeriesWorld={
      ...state.lowerSeriesWorld,
      series:[{series_id:"F2",series_name:"Formula Two",series_level:2}],
      teams:{
        T1:{
          lower_team_id:"T1",series_id:"F2",team_name:"Team One",
          team_strength:50,reliability:90,development_environment:50,
          calibration_status:"neutral_catalog_seed",
        },
        T2:{
          lower_team_id:"T2",series_id:"F2",team_name:"Team Two",
          team_strength:50,reliability:90,development_environment:50,
          calibration_status:"neutral_catalog_seed",
        },
      },
      entries:Object.fromEntries(
        state.drivers.map((driver,index)=>[
          driver.driver_id,
          {
            driver_id:driver.driver_id,
            series_id:"F2",
            series_name:"Formula Two",
            series_level:2,
            lower_team_id:index===0?"T1":null,
            team_name:index===0?"Team One":null,
            series_candidates:[],
            placement_status:index===0?"placed_with_team":"series_only",
            placement_source:index===0?"historical_opening_career_evidence":"single_active_eligible_series",
          },
        ])
      ),
      events:[],
      results:[],
      standings:{},
    };
    return state;
  };

  const a=initializeLowerSeriesSeason(makeState());
  const b=initializeLowerSeriesSeason(makeState());

  assert.deepEqual(a.lowerSeriesWorld.teams,b.lowerSeriesWorld.teams);
  assert.deepEqual(a.lowerSeriesWorld.entries,b.lowerSeriesWorld.entries);
  assert.equal(a.lowerSeriesWorld.entries.D1.lower_team_id,"T1","historical opening assignment must survive");

  const assigned=Object.values(a.lowerSeriesWorld.entries);
  assert.ok(assigned.every((entry)=>entry.lower_team_id),"all four tracked prospects fit in two two-seat teams");
  const counts=new Map();
  for(const entry of assigned){
    counts.set(entry.lower_team_id,(counts.get(entry.lower_team_id)||0)+1);
  }
  assert.ok([...counts.values()].every((count)=>count<=2));

  for(const team of Object.values(a.lowerSeriesWorld.teams)){
    assert.equal(team.performance_profile_year,1980);
    assert.equal(team.performance_profile_model,"lower_series_team_light_v1");
    assert.ok(team.team_strength>=43&&team.team_strength<=57);
    assert.ok(team.reliability>=86&&team.reliability<=94);
    assert.ok(team.development_environment>=41&&team.development_environment<=59);
  }

  assert.ok(
    assigned.slice(1).every((entry)=>entry.lineup_source==="save_world_team_assignment"),
    "only runtime-assigned seats should carry the alternative-world line-up source"
  );
});

test("LS3.5B never invents a team when a series has no factual Save-World teams",()=>{
  const state=baseState();
  state.lowerSeriesWorld={
    ...state.lowerSeriesWorld,
    teams:{},
    entries:{
      D1:{
        driver_id:"D1",series_id:"F2",series_name:"Formula Two",series_level:2,
        lower_team_id:null,team_name:null,series_candidates:[],placement_status:"series_only",
      },
    },
    events:[],
    results:[],
    standings:{},
  };
  const initialized=initializeLowerSeriesSeason(state);
  assert.equal(initialized.lowerSeriesWorld.entries.D1.lower_team_id,null);
  assert.equal(initialized.lowerSeriesWorld.entries.D1.team_name,null);
  assert.deepEqual(initialized.lowerSeriesWorld.teams,{});
});

test("LS3.5B evolves carried team performance only slightly between seasons",()=>{
  const lowerSeriesTeams=[
    {lower_team_id:"T1",team_name:"Team One",series_id:"F2",valid_from:1980,valid_to:1990},
    {lower_team_id:"T2",team_name:"Team Two",series_id:"F2",valid_from:1980,valid_to:1990},
  ];
  const openingState=baseState();
  openingState.lowerSeriesWorld={
    ...openingState.lowerSeriesWorld,
    series:[{series_id:"F2",series_name:"Formula Two",series_level:2}],
    teams:{
      T1:{
        lower_team_id:"T1",series_id:"F2",team_name:"Team One",
        team_strength:50,reliability:90,development_environment:50,
        calibration_status:"neutral_catalog_seed",
      },
      T2:{
        lower_team_id:"T2",series_id:"F2",team_name:"Team Two",
        team_strength:50,reliability:90,development_environment:50,
        calibration_status:"neutral_catalog_seed",
      },
    },
    entries:{
      D1:{
        driver_id:"D1",series_id:"F2",series_name:"Formula Two",series_level:2,
        lower_team_id:"T1",team_name:"Team One",series_candidates:[],placement_status:"placed_with_team",
      },
      D2:{
        driver_id:"D2",series_id:"F2",series_name:"Formula Two",series_level:2,
        lower_team_id:"T2",team_name:"Team Two",series_candidates:[],placement_status:"placed_with_team",
      },
    },
    events:[],
    results:[],
    standings:{},
  };

  const first=initializeLowerSeriesSeason(openingState);
  const firstT1={...first.lowerSeriesWorld.teams.T1};
  const rolled=rollLowerSeriesWorld(first.lowerSeriesWorld,{
    targetYear:1981,
    series:[{series_id:"F2",series_name:"Formula Two",series_level:2,start_year:1970,end_year:1990}],
    seriesRules:[],
    lowerSeriesTeams,
    drivers:[
      {driver_id:"D1",age:23,active_lower_series:true,status:"lower_series",lower_series_level:2},
      {driver_id:"D2",age:22,active_lower_series:true,status:"lower_series",lower_series_level:2},
    ],
  });
  const second=initializeLowerSeriesSeason({
    ...first,
    activeYear:1981,
    currentDateISO:"1981-01-01",
    lowerSeriesWorld:rolled,
  });
  const nextT1=second.lowerSeriesWorld.teams.T1;

  assert.equal(nextT1.performance_profile_year,1981);
  assert.equal(nextT1.performance_profile_model,"lower_series_team_light_v1");
  assert.ok(Math.abs(nextT1.team_strength-firstT1.team_strength)<=2.1);
  assert.ok(Math.abs(nextT1.reliability-firstT1.reliability)<=1.0);
  assert.ok(Math.abs(nextT1.development_environment-firstT1.development_environment)<=0.8);
  assert.equal(second.lowerSeriesWorld.entries.D1.lower_team_id,"T1");
});
