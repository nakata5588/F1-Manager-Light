import test from "node:test";
import assert from "node:assert/strict";
import { materializeSeasonPack } from "../src/data/seasonPackMaterializer.js";
import { f1HireEligibility } from "../src/domain/driverEligibility.js";

function rating(driverId,current=65,peak=80){
  return {
    year:1980,
    driver_id:driverId,
    display_name:driverId,
    current_ability:current,
    peak_ability:peak,
    current_pace:current,
    current_qualifying:current,
    current_racecraft:current,
    current_consistency:current,
  };
}

function fixture(){
  const opening=(driver_id,display_name,world,availability,extra={})=>({
    year:1980,
    opening_date:"1980-01-01",
    driver_id,
    display_name,
    opening_world_status:world,
    opening_availability:availability,
    runtime_visibility:"ACTIVE_WORLD",
    runtime_market_policy:"APPROACHABLE",
    confidence:"HIGH",
    ...extra,
  });

  return {
    drivers:[
      {driver_id:"D1",display_name:"Opening One",dob:"1950-01-01",f1_rookie_season:1975},
      {driver_id:"D2",display_name:"Opening Two",dob:"1951-01-01",f1_rookie_season:1976},
      {driver_id:"P1",display_name:"Prospect One",dob:"1958-01-01",f1_rookie_season:1983},
      {driver_id:"Q1",display_name:"Review One",dob:"1956-01-01",f1_rookie_season:1982},
      {driver_id:"DEAD",display_name:"Past Driver",dob:"1948-01-01",death_date:"1978-01-01"},
      {driver_id:"LEAK",display_name:"Season Outcome Leak",dob:"1952-01-01",f1_rookie_season:1979},
    ],
    teams:[{team_id:"T1",team_name:"Canonical Team",founded_year:1970}],
    teamSeasons:[{year:1980,team_id:"T1",team_name:"Canonical Team",driver_ids:["LEAK"]}],
    teamBrands:[{year:1980,team_id:"T1",team_name:"Canonical Team"}],
    carStats:[{year:1980,team_id:"T1"}],
    contracts:[
      {year:1980,team_id:"T1",team_name:"Canonical Team",driver_id:"D1",role:"test_driver"},
    ],
    driverTeamHistory:[
      {year:1980,team_id:"T1",driver_id:"LEAK",first_round:1},
    ],
    driverCareer:[
      {year:1980,series_division:"F1",team_id:"T1",driver_id:"LEAK",races:10},
    ],
    driverOpeningState:[
      opening("D1","Opening One","F1_CONTRACTED_RACE_SEAT","F1_CONTRACTED",{
        opening_team_id:"T1",opening_team_name:"Canonical Team",opening_role:"main_driver",
        runtime_market_policy:"TRANSFER_RULES",
      }),
      opening("D2","Opening Two","F1_CONTRACTED_RACE_SEAT","F1_CONTRACTED",{
        opening_team_id:"T1",opening_team_name:"Canonical Team",opening_role:"second_driver",
        runtime_market_policy:"TRANSFER_RULES",
      }),
      opening("P1","Prospect One","PROSPECT","OTHER_SERIES_COMMITMENT",{
        series_context:"EUROPEAN_F2",
      }),
      opening("Q1","Review One","NEEDS_RESEARCH","MARKET_STATUS_RESEARCH",{
        runtime_market_policy:"VISIBLE_BLOCK_DIRECT_NEGOTIATION",
      }),
      opening("DEAD","Past Driver","DECEASED","DECEASED_UNAVAILABLE",{
        runtime_visibility:"EXCLUDE_ACTIVE_WORLD",
        runtime_market_policy:"BLOCKED",
      }),
    ],
    historicalRatingSnapshots:[
      rating("D1",72,82),
      rating("D2",69,79),
      rating("P1",61,86),
      rating("Q1",64,75),
    ],
    driverRatings:[],
    calendar:[{year:1980,round:1,gp_id:"GP1",gp_name:"Opening GP",track_id:"A",race_date:"1980-03-01"}],
    qualifyingRules:[{year:1950,session_count:2,max_starters:24}],
    qualifyingRuleOverrides:[],
    rules:[{year:1980,points_system:"9,6,4,3,2,1"}],
    eraSafety:[{year:1980,era_safety_index:0.4}],
    accidentModel:[{year:1980,damage_DNF_prob:0.15}],
    teamEngines:[],facilities:[],sponsorsContracts:[],
    staffContracts:[],staffRatings:[],staffCore:[],
    tyres:[],pointsSystems:[],penaltiesRules:[],financialRules:[],agendaBlocks:[],
    contractRules:[],youthIntakeRules:[],scoutingZones:[],coreTracks:[],trackLayoutByYear:[],
    driverHistory:[],
  };
}

test("opening state is authoritative and blocks season-outcome grid leakage",()=>{
  const pack=materializeSeasonPack(fixture(),1980);
  assert.equal(pack.validation.ok,true,JSON.stringify(pack.validation));

  const ids=new Set(pack.state.drivers.map((d)=>String(d.driver_id)));
  assert.deepEqual([...ids].sort(),["D1","D2","P1","Q1"].sort());
  assert.equal(ids.has("LEAK"),false,"full-season participation must not create a Jan-1 driver");
  assert.equal(ids.has("DEAD"),false,"pre-season deceased driver must not enter the active world");

  const raceContracts=pack.state.contracts.filter((c)=>/main|second|race/i.test(String(c.role||"")));
  assert.equal(raceContracts.length,2);
  assert.deepEqual(raceContracts.map((c)=>String(c.driver_id)).sort(),["D1","D2"]);
  assert.equal(pack.state.contracts.some((c)=>c.source==="season_results_bootstrap"),false);
  assert.equal(pack.state.contracts.some((c)=>c.source==="ai_grid_bootstrap"),false);
  assert.ok(pack.state.contracts.every((c)=>c.opening_state_seed===true));

  const d1=pack.state.contracts.find((c)=>c.driver_id==="D1");
  assert.equal(d1.role,"Main Driver","opening role must override stale test-driver contract metadata");
});

test("opening market policy is honest and scoped to the New Game season",()=>{
  const pack=materializeSeasonPack(fixture(),1980);
  const prospect=pack.state.drivers.find((d)=>d.driver_id==="P1");
  const review=pack.state.drivers.find((d)=>d.driver_id==="Q1");

  assert.equal(prospect.opening_availability,"OTHER_SERIES_COMMITMENT");
  assert.equal(prospect.status,"lower_series");
  assert.equal(f1HireEligibility(pack.state,prospect,1980).eligible,true);

  const blocked=f1HireEligibility(pack.state,review,1980);
  assert.equal(blocked.eligible,false);
  assert.equal(blocked.reason,"market_status_research");

  const alternateFuture=f1HireEligibility({...pack.state,activeYear:1981},review,1981);
  assert.equal(alternateFuture.eligible,true,"opening uncertainty must not hard-lock alternate history after rollover");
});
