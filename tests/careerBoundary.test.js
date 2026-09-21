import test from "node:test";
import assert from "node:assert/strict";
import { createCareerMeta, materializeNextCareerSeason } from "../src/core/careerBoundary.js";

function fixture(){
  return {
    activeYear:1980,
    currentDateISO:"1980-12-31",
    currentRound:1,
    team:{team_id:"T1",name:"Alpha",budget:1_000_000},
    finances:{balance:900_000,season_spend:100_000,season_income:200_000},
    standings:{drivers:[{driver_id:"D1",points:10}],teams:[{team_id:"T1",points:10}]},
    results:[{key:"1980:1",year:1980,round:1,classification:[]}],
    calendar:[{year:1980,round:1,gp_id:"1980:1",gp_name:"Old GP",track_id:"A",race_date:"1980-03-01"}],
    teams:[{team_id:"T1",team_name:"Alpha"}],
    drivers:[{driver_id:"D1",display_name:"Current Driver",dob:"1955-01-01",age:25,status:"eligible"}],
    driverRatings:[{year:1980,driver_id:"D1",current_ability:75,potential_ability:80}],
    contracts:[{year:1980,team_id:"T1",driver_id:"D1",role:"driver",contract_start_year:1980,contract_until_year:1980}],
    staffCore:[{staff_id:"S1",staff_name:"Current Staff",dob:"1940-01-01"}],
    staffRatings:[{year:1980,staff_id:"S1",technical:70}],
    staffContracts:[{year:1980,team_id:"T1",staff_id:"S1",role:"engineer",contract_until_year:1980}],
    teamBrands:[{year:1980,team_id:"T1",team_name:"Alpha"}],
    teamEngines:[{year:1980,team_id:"T1",engine_id:"E1",reliability_override:0.8}],
    facilities:[{year:1980,team_id:"T1",manufacturing_level:5}],
    sponsorsContracts:[],
    inbox:[],
    careerMeta:null,

    dbCalendar:[
      {year:1981,round:1,gp_id:"hist81-1",gp_name:"New GP",track_id:"B",race_date:"1981-03-08",winner_id:"SHOULD_NOT_LEAK"},
      {year:1981,round:2,gp_id:"hist81-2",gp_name:"Second GP",track_id:"C",race_date:"1981-04-12"},
    ],
    dbDrivers:[
      {driver_id:"D1",display_name:"Current Driver",dob:"1955-01-01",career_start_year:1974,f1_rookie_season:1975},
      {driver_id:"D2",display_name:"Future Driver",dob:"1960-05-01",career_start_year:1979,f1_rookie_season:1981,team_id:"HISTORICAL_TEAM",career_end_year:1995},
      {driver_id:"D3",display_name:"Future Lower-Series Star",dob:"1960-03-21",career_start_year:null,f1_rookie_season:1984,career_end_year:1994},
    ],
    dbDriverRatings:[
      {year:1980,driver_id:"D1",current_ability:75},
      {year:1981,driver_id:"D2",current_ability:65,potential_ability:82},
      {year:1984,driver_id:"D3",current_ability:90,potential_ability:98},
    ],
    dbStaffCore:[
      {staff_id:"S1",staff_name:"Current Staff",dob:"1940-01-01"},
      {staff_id:"S2",staff_name:"Future Staff",dob:"1950-01-01",team_id:"HISTORICAL_TEAM"},
    ],
    dbStaffRatings:[
      {year:1980,staff_id:"S1",technical:70},
      {year:1981,staff_id:"S2",technical:62},
    ],
    dbStaffContracts:[
      {year:1981,team_id:"T2",staff_id:"S2",role:"engineer"},
    ],
    dbTeams:[
      {team_id:"T1",team_name:"Alpha",founded_year:1970},
      {team_id:"T2",team_name:"Future Team",founded_year:1981},
    ],
    dbTeamSeasons:[{year:1981,team_id:"T2",team_name:"Future Team"}],
    dbTeamBrands:[{year:1981,team_id:"T2",team_name:"Future Team"}],
    // This historical future assignment must never replace simulated employment.
    dbContracts:[{year:1981,team_id:"T2",driver_id:"D2",role:"driver",contract_until_year:1981}],
    dbRules:[{year:1980,rule:"old"},{year:1981,rule:"new-structure"}],
    dbEraSafety:[{year:1980,era_safety_index:0.4},{year:1981,era_safety_index:0.42}],
    dbAccidentModel:[{year:1980,damage_DNF_prob:0.16},{year:1981,damage_DNF_prob:0.15}],
    dbPointsSystems:[{year_from:1950,year_to:1990,places_csv:"9,6,4,3,2,1"}],
    dbTyres:[],dbPenaltiesRules:[],dbFinancialRules:[],dbAgendaBlocks:[],
  };
}

test("career boundary rolls to next season without importing historical future assignments",()=>{
  const state=fixture();
  state.careerMeta=createCareerMeta(state,1980);
  const next=materializeNextCareerSeason(state,1981);

  assert.equal(next.activeYear,1981);
  assert.equal(next.currentDateISO,"1981-01-01");
  assert.equal(next.calendar.length,2);
  assert.equal(next.calendar[0].winner_id,undefined);
  assert.equal(next.calendar[0].generation_source,"global_calendar_structure");

  assert.deepEqual(next.teams.map(t=>t.team_id),["T1"]);
  assert.ok(next.careerMeta.eligibleTeamCandidateIds.includes("T2"));

  const future=next.drivers.find(d=>d.driver_id==="D2");
  assert.ok(future);
  assert.equal(future.team_id,undefined);
  assert.equal(future.canHireF1,true);
  assert.equal(next.contracts.some(c=>c.driver_id==="D2"),false);

  const earlyStar=next.drivers.find(d=>d.driver_id==="D3");
  assert.ok(earlyStar,"driver should become visible three years before historical F1 debut");
  assert.equal(earlyStar.status,"lower_series");
  assert.equal(earlyStar.canHireF1,true,"historical debut must not block an alternate-history F1 offer");
  assert.equal(earlyStar.canHireAcademy,false);
  assert.equal(earlyStar.f1_rookie_season,1984);
  assert.equal(
    next.driverRatings.some((r)=>r.driver_id==="D3"),
    false,
    "a future historical rating must not leak into an earlier alternate-history season"
  );

  const currentContract=next.contracts.find(c=>c.driver_id==="D1");
  assert.equal(currentContract.contract_until_year,1980);
  assert.equal(currentContract.status,"expired");
  assert.equal(currentContract.continuity_renewal,undefined);
  assert.equal(currentContract.expiry_reason,"contract_end");

  assert.ok(next.staffCore.some(s=>s.staff_id==="S2"));
  assert.equal(next.staffContracts.some(c=>c.staff_id==="S2"),false);

  assert.equal(next.results.length,1);
  assert.equal(next.historySeasons.length,1);
  assert.equal(next.historySeasons[0].year,1980);
  assert.equal(next.rules[0].rule,"new-structure");
});

test("calendar falls back to previous season structure when global reference is missing",()=>{
  const state=fixture();
  state.dbCalendar=[];
  state.careerMeta=createCareerMeta(state,1980);
  const next=materializeNextCareerSeason(state,1981);
  assert.equal(next.calendar.length,1);
  assert.equal(next.calendar[0].year,1981);
  assert.equal(next.calendar[0].race_date,"1981-03-01");
  assert.equal(next.calendar[0].generation_source,"previous_season_calendar_fallback");
});


test("career boundary carries only contracts that are genuinely valid for the new season",()=>{
  const state=fixture();
  state.contracts[0].contract_until_year=1981;
  state.careerMeta=createCareerMeta(state,1980);
  const next=materializeNextCareerSeason(state,1981);
  const carried=next.contracts.find(c=>c.driver_id==="D1");
  assert.equal(carried.status,"active");
  assert.equal(carried.year,1981);
  assert.equal(carried.contract_until_year,1981);
  assert.equal(carried.continuity_renewal,undefined);
});
