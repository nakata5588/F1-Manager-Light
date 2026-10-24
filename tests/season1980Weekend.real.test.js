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
import {resolveQualifyingRules} from "../src/engine/QualifyingRulesEngine.js";

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


test("1980 GP-specific rules reach the real canonical Argentina/Monaco grids",async()=>{
  const pack=JSON.parse(await fs.readFile(
    new URL("../public/data/seasons/1980/season.json",import.meta.url),"utf8"));
  assert.equal(pack.validation?.ok,true);
  const db=pack.state;
  const renault=db.teams.find(t=>String(t.team_name).toLowerCase()==="renault");
  assert.ok(renault);
  const seats=db.contracts.filter(isRaceDriverContract);
  const garageByTeam=Object.fromEntries(db.teams.map(t=>{
    const teamId=String(t.team_id);
    return [teamId,{cars:seats.filter(c=>String(c.team_id)===teamId)
      .slice(0,2).map((c,i)=>({
        id:teamId===String(renault.team_id)?"car_"+(i+1):teamId+"_race_"+(i+1),
        kind:"race",driver_id:c.driver_id,
        componentCondition:{engine:100,suspension:100},
      }))}];
  }));
  for(const [idx,fragment,expectedStarters,expectedEntries] of [
    [0,"argentin",24,28],
    [5,"monaco",20,null],
  ]){
    const gp=db.calendar[idx];
    assert.match(String(gp.gp_name),new RegExp(fragment,"i"));
    const date=String(gp.race_date??gp.dateISO).slice(0,10);
    const gs={
      ...db,activeYear:1980,currentRound:idx,currentDateISO:date,
      saveMeta:{seed:"rw63-real-1980-qualifying-"+fragment},
      team:renault,driverAttributes:{},driverAvailability:{},
      medicalHistory:[],temporaryDriverAssignments:[],
      standings:{drivers:[],teams:[]},results:[],inbox:[],
      finances:{balance:10_000_000,budget:10_000_000},
      garage:garageByTeam[String(renault.team_id)],
      aiTechnicalWorld:{teams:Object.fromEntries(db.teams
        .filter(t=>String(t.team_id)!==String(renault.team_id))
        .map(t=>[String(t.team_id),{garage:garageByTeam[String(t.team_id)]}]))},
    };
    const rule=resolveQualifyingRules(gs,gp);
    assert.equal(rule.max_starters,expectedStarters,
      fragment+" must match canonical track/year override");
    const weekend=createRaceWeekendState(gs,{roundIndex:idx,gp,engineVersion:"rw2"});
    assert.equal(weekend.raceWeekendState.qualifying_rule_snapshot.max_starters,expectedStarters);
    if(expectedEntries!=null){
      assert.equal(weekend.raceEntryState.entries.length,expectedEntries,
        "Argentina 1980 entry limits must apply to canonical team IDs");
    }
    let current=completePracticeSession(weekend,{gp});
    let qualifying=0;
    for(let i=0;i<8&&current.raceWeekendState.phase!=="grid_ready";i++){
      current={...current,currentDateISO:current.raceWeekendState.raceDate};
      current=continueRaceWeekendSession(current);
      if(current.raceWeekendState.phase==="qualifying"){
        current=completeQualifyingSession(current,{gp});
        qualifying++;
      }
    }
    assert.equal(qualifying,2);
    assert.equal(current.raceWeekendState.phase,"grid_ready");
    assert.equal(current.raceWeekendState.startingGrid.rows.length,expectedStarters,
      fragment+" must have actual era/event-specific starter count");
    console.log("REAL_1980_CANONICAL_GRID_RULE="+JSON.stringify({
      gp:gp.gp_name,track:gp.track_id,ruleId:rule.rule_id,
      totalEntries:weekend.raceEntryState.entries.length,
      grid:current.raceWeekendState.startingGrid.rows.length,
      expectedStarters,
    }));
  }
});
