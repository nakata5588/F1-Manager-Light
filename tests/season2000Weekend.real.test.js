import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  createRaceWeekendState,
  completePracticeSession,
  completeQualifyingSession,
  continueRaceWeekendSession,
} from "../src/engine/RaceWeekendEngine.js";
import { isRaceDriverContract } from "../src/domain/contractRoles.js";

test("real 2000 New Game season reaches Practice, Qualifying and the starting grid",async()=>{
  const file=new URL("../public/data/seasons/2000/season.json",import.meta.url);
  const pack=JSON.parse(await fs.readFile(file,"utf8"));
  const state=pack.state;
  assert.equal(pack.validation.ok,true);
  const ferrari=state.teams.find(t=>String(t.team_name).toLowerCase()==="ferrari");
  assert.ok(ferrari);
  const ferrariSeats=state.contracts.filter(c=>isRaceDriverContract(c)&&String(c.team_id)===String(ferrari.team_id));
  assert.ok(ferrariSeats.length>=2,"2000 Ferrari should have two race drivers");
  const gp=state.calendar[0];
  assert.ok(gp?.race_date||gp?.dateISO);
  const date=String(gp?.race_date??gp?.dateISO).slice(0,10);
  let gs={
    ...state,activeYear:2000,currentRound:0,currentDateISO:date,
    saveMeta:{seed:"real-2000-full-weekend-smoke"},
    team:ferrari,
    driverAttributes:{},driverAvailability:{},medicalHistory:[],
    temporaryDriverAssignments:[],
    standings:{drivers:[],teams:[]},
    results:[],inbox:[],financeLog:[],
    finances:{balance:10_000_000,budget:10_000_000,season_spend:0,season_income:0},
    settings:{gameplay:{enableInjuryRandomEvents:false,enableFatalities:false}},
    garage:{cars:ferrariSeats.slice(0,2).map((seat,i)=>({
      id:`car_${i+1}`,kind:"race",driver_id:seat.driver_id,
      componentCondition:{engine:100,suspension:100},
    }))},
  };
  gs=createRaceWeekendState(gs,{roundIndex:0,gp,engineVersion:"rw2"});
  assert.equal(gs.raceWeekendState.phase,"practice");
  assert.equal(gs.raceWeekendState.year,2000);
  assert.ok(gs.raceEntryState.entries.length>=20,
    "real 2000 practice should include the historical grid");
  gs=completePracticeSession(gs,{gp});
  assert.equal(gs.raceWeekendState.phase,"practice_complete");
  assert.ok(gs.raceWeekendState.practice);
  const practice=gs.raceWeekendState.practice;
  assert.ok((practice?.results||practice?.entries||[]).length>=20,
    "Practice must consume the real 2000 entry list");
  let qualifyingSessions=0;
  for(let i=0;i<8;i++){
    gs={...gs,currentDateISO:String(gs.raceWeekendState.raceDate).slice(0,10)};
    gs=continueRaceWeekendSession(gs);
    if(gs.raceWeekendState.phase==="qualifying"){
      gs=completeQualifyingSession(gs,{gp});
      qualifyingSessions++;
    }
    if(gs.raceWeekendState.phase==="grid_ready")break;
  }
  assert.ok(qualifyingSessions>=1,"2000 must complete a qualifying session");
  assert.equal(gs.raceWeekendState.qualifying.status,"completed");
  assert.ok(gs.raceWeekendState.startingGrid.rows.length>=20,
    "2000 qualifying must produce a full starting grid");
  assert.ok(gs.raceWeekendState.startingGrid.rows.every(r=>r.driver_id&&r.team_id));
  console.log("REAL_2000_WEEKEND="+JSON.stringify({
    entries:gs.raceEntryState.entries.length,
    practice:practice?.results?.length??practice?.entries?.length??null,
    qualifyingSessions,
    grid:gs.raceWeekendState.startingGrid.rows.length,
    phase:gs.raceWeekendState.phase,
  }));
});
