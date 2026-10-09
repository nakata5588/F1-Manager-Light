// Real historical 2000 Australian GP: full grid, full circuit, full race distance.
// All car ratings come from the generated Season Pack; the canonical Race Core
// is shared by fast simulation and live execution. No one-lap synthetic track.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { isRaceDriverContract } from "../src/domain/contractRoles.js";
import {
  createRaceWeekendState,completePracticeSession,
  completeQualifyingSession,continueRaceWeekendSession,
} from "../src/engine/RaceWeekendEngine.js";
import { teamCarPerformance } from "../src/domain/carPerformance.js";
import { buildRaceWeekendInput } from "../src/race2/adapters/GameStateInputAdapter.js";
import { createRaceState } from "../src/race2/core/RaceState.js";
import { startRaceState } from "../src/race2/core/RaceSimulation.js";
import { createLiveRaceRunner,runFastRaceToEnd } from "../src/race2/core/RaceRunner.js";
import { projectCanonicalRaceStateToOfficialRows } from "../src/race2/adapters/OfficialRaceResultProjection.js";
import { materializeOfficialRaceRows } from "../src/engine/RaceFinalizationEngine.js";

async function season2000(){
  const file=new URL("../public/data/seasons/2000/season.json",import.meta.url);
  return JSON.parse(await fs.readFile(file,"utf8"));
}

test("2000 Australian GP: 22 historic starters complete 58 laps in canonical Live/Autosim parity",{
  timeout:1_500_000,
},async()=>{
  const pack=await season2000();
  assert.equal(pack.validation?.ok,true,JSON.stringify(pack.validation));
  assert.equal(pack.state.teams.length,11);
  assert.equal(pack.state.carStats.filter(r=>r.generation_source==="historical_results_inference").length,11);
  const gp=pack.state.calendar[0];
  assert.match(String(gp?.gp_name),/Australian/i);
  const ferrari=pack.state.teams.find(t=>String(t.team_name).toLowerCase()==="ferrari");
  assert.ok(ferrari);
  const seats=(pack.state.contracts||[]).filter(isRaceDriverContract);
  const garageByTeam={};
  for(const t of pack.state.teams){
    const tid=String(t.team_id);
    const teamSeats=seats.filter(c=>String(c.team_id)===tid);
    assert.ok(teamSeats.length>=2,`2000 ${t.team_name} must have two race seats`);
    garageByTeam[tid]={
      cars:[1,2].map(slot=>({
        id:`${tid}_race_${slot}`,kind:"race",
        driver_id:String(teamSeats[slot-1].driver_id),
        componentCondition:{engine:100,suspension:100},
      })),
    };
  }
  const date=String(gp?.race_date??gp?.dateISO).slice(0,10);
  let gs={
    ...pack.state,activeYear:2000,currentRound:0,currentDateISO:date,
    saveMeta:{seed:"real-2000-australia-full-distance"},
    team:ferrari,
    driverAttributes:{},driverAvailability:{},medicalHistory:[],
    temporaryDriverAssignments:[],
    standings:{drivers:[],teams:[]},results:[],inbox:[],financeLog:[],
    finances:{balance:10_000_000,budget:10_000_000,season_spend:0,season_income:0},
    settings:{gameplay:{enableInjuryRandomEvents:false,enableFatalities:false}},
    garage:garageByTeam[String(ferrari.team_id)],
    aiTechnicalWorld:{teams:Object.fromEntries(
      pack.state.teams.filter(t=>String(t.team_id)!==String(ferrari.team_id))
        .map(t=>[String(t.team_id),{garage:garageByTeam[String(t.team_id)]}])
    )},
  };
  gs=createRaceWeekendState(gs,{roundIndex:0,gp,engineVersion:"rw2"});
  assert.equal(gs.raceWeekendState.phase,"practice");
  const confirmed=gs.raceEntryState.entries.filter(e=>e.status==="confirmed"&&e.car_id&&e.driver_id);
  assert.equal(confirmed.length,22,"all historical grid slots must have valid physical cars and drivers");
  gs=completePracticeSession(gs,{gp});
  assert.equal(gs.raceWeekendState.phase,"practice_complete");
  let qualifyingSessions=0;
  for(let i=0;i<8&&gs.raceWeekendState.phase!=="grid_ready";i++){
    gs={...gs,currentDateISO:String(gs.raceWeekendState.raceDate).slice(0,10)};
    gs=continueRaceWeekendSession(gs);
    if(gs.raceWeekendState.phase==="qualifying"){
      gs=completeQualifyingSession(gs,{gp});
      qualifyingSessions++;
    }
  }
  assert.ok(qualifyingSessions>=1);
  assert.equal(gs.raceWeekendState.phase,"grid_ready");
  const input=buildRaceWeekendInput(gs,{gp});
  assert.equal(input.engineVersion,"rw2");
  assert.equal(input.year,2000);
  assert.equal(input.entries.length,22);
  assert.equal(input.drivers.length,22);
  if(input.cars.length!==22){
    const carIds=new Set(input.cars.map(c=>c.carId));
    const missing=input.entries.filter(e=>!carIds.has(e.carId)).map(e=>({
      driverId:e.driverId,teamId:e.teamId,carId:e.carId,
      garages:e.teamId===String(ferrari.team_id)
        ?(gs.garage?.cars||[]).map(c=>c.id)
        :(gs.aiTechnicalWorld?.teams?.[e.teamId]?.garage?.cars||[]).map(c=>c.id),
    }));
    console.log("REAL_2000_MISSING_CARS="+JSON.stringify({missing,carCount:input.cars.length,
      inputTeamCount:new Set(input.entries.map(e=>e.teamId)).size,
      weekendEntries:gs.raceWeekendState.entrants.length,
      raceEntries:gs.raceEntryState.entries.length}));
  }
  assert.equal(input.cars.length,22);
  assert.equal(input.startingGrid.length,22);
  assert.equal(new Set(input.cars.map(c=>c.carId)).size,22);
  assert.equal(input.track.laps,58,"must simulate 2000 Albert Park's full 58-lap distance");
  assert.ok(input.track.lengthM>5000&&input.track.lengthM<5500,
    "must use the actual 2000 Albert Park circuit length, not a synthetic track");
  for(const car of input.cars){
    assert.equal(car.performance.race,teamCarPerformance(gs,car.teamId,car.driverId).race);
  }
  const initial=startRaceState(createRaceState(input));
  assert.equal(initial.cars.length,22);
  const fast=runFastRaceToEnd(initial,{maxSteps:150000});
  assert.equal(fast.status,"finished");
  assert.ok(fast.tick>1000);
  const finishers=fast.cars.filter(c=>c.status==="finished");
  assert.ok(finishers.length>0,"full-distance GP needs at least one classified finisher");
  assert.ok(finishers.some(c=>c.completedLaps===58),
    "at least one car must cross the complete race distance");
  const live=createLiveRaceRunner(initial);
  for(let tick=0;tick<fast.tick;tick++)live.step();
  assert.deepEqual(live.getState(),fast,"Live and Autosim must converge to identical canonical state");
  const official=projectCanonicalRaceStateToOfficialRows(gs,fast);
  const archived=materializeOfficialRaceRows(official);
  assert.equal(archived.length,22,"all 22 starting drivers need an official result (including DNF)");
  assert.equal(new Set(archived.map(r=>String(r.driver_id))).size,22);
  assert.ok(archived.every(r=>r.team_id&&r.status));
  const summary={
    gp:gp.gp_name,year:2000,
    track:input.track.trackId,circuit_m:input.track.lengthM,laps:input.track.laps,
    entrants:input.entries.length,starting_grid:input.startingGrid.length,
    finished:finishers.length,dnf:fast.cars.filter(c=>c.dnf||c.status==="dnf").length,
    steps:fast.tick,live_autosim_parity:true,official_results:archived.length,
    classification:archived.map(r=>({
      driver_id:r.driver_id,team_id:r.team_id,position:r.pos,
      status:r.status,finish_ms:r.total_time_ms,
    })),
  };
  console.log("REAL_2000_FULL_RACE_AUDIT="+JSON.stringify(summary));
});
