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

test("real 1980 New Game season reaches Practice, Qualifying and the starting grid",async()=>{
  const file=new URL("../public/data/seasons/1980/season.json",import.meta.url);
  const pack=JSON.parse(await fs.readFile(file,"utf8"));
  const state=pack.state;
  assert.equal(pack.validation.ok,true);
  const renault=state.teams.find(t=>String(t.team_name).toLowerCase()==="renault");
  assert.ok(renault);
  const renaultSeats=state.contracts.filter(c=>isRaceDriverContract(c)&&String(c.team_id)===String(renault.team_id));
  assert.ok(renaultSeats.length>=2,"1980 Renault should have two race drivers");
  const gp=state.calendar[0];
  assert.match(String(gp.gp_name||gp.name||gp.race_name||""),/argentin/i,"1980 opening round must be Argentina");
  assert.ok(gp?.race_date||gp?.dateISO);
  const date=String(gp?.race_date??gp?.dateISO).slice(0,10);
  let gs={
    ...state,activeYear:1980,currentRound:0,currentDateISO:date,
    saveMeta:{seed:"real-1980-full-weekend-smoke"},
    team:renault,
    driverAttributes:{},driverAvailability:{},medicalHistory:[],
    temporaryDriverAssignments:[],
    standings:{drivers:[],teams:[]},
    results:[],inbox:[],financeLog:[],
    finances:{balance:10_000_000,budget:10_000_000,season_spend:0,season_income:0},
    settings:{gameplay:{enableInjuryRandomEvents:false,enableFatalities:false}},
    garage:{cars:renaultSeats.slice(0,2).map((seat,i)=>({
      id:`car_${i+1}`,kind:"race",driver_id:seat.driver_id,
      componentCondition:{engine:100,suspension:100},
    }))},
  };
  gs=createRaceWeekendState(gs,{roundIndex:0,gp,engineVersion:"rw2"});
  assert.equal(gs.raceWeekendState.phase,"practice");
  assert.equal(gs.raceWeekendState.year,1980);
  assert.ok(gs.raceEntryState.entries.length>=20,
    "real 1980 practice should include the historical grid");
  gs=completePracticeSession(gs,{gp});
  assert.equal(gs.raceWeekendState.phase,"practice_complete");
  assert.ok(gs.raceWeekendState.practice);
  const practice=gs.raceWeekendState.practice;
  assert.ok((practice?.results||practice?.entries||[]).length>=20,
    "Practice must consume the real 1980 entry list");
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
  assert.ok(qualifyingSessions>=1,"1980 must complete a qualifying session");
  assert.equal(gs.raceWeekendState.qualifying.status,"completed");
  assert.ok(gs.raceWeekendState.startingGrid.rows.length>=20,
    "1980 qualifying must produce a full starting grid");
  assert.ok(gs.raceWeekendState.startingGrid.rows.every(r=>r.driver_id&&r.team_id));
  console.log("REAL_1980_WEEKEND="+JSON.stringify({
    entries:gs.raceEntryState.entries.length,
    practice:practice?.results?.length??practice?.entries?.length??null,
    qualifyingSessions,
    grid:gs.raceWeekendState.startingGrid.rows.length,
    phase:gs.raceWeekendState.phase,
  }));
});
