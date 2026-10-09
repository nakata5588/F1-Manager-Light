import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { isRaceDriverContract } from "../src/domain/contractRoles.js";
import { teamCarPerformance } from "../src/domain/carPerformance.js";
import { buildRaceWeekendInput } from "../src/race2/adapters/GameStateInputAdapter.js";
import { createRaceState } from "../src/race2/core/RaceState.js";
import { startRaceState } from "../src/race2/core/RaceSimulation.js";
import { runFastRaceToEnd, createLiveRaceRunner } from "../src/race2/core/RaceRunner.js";
import { projectCanonicalRaceStateToOfficialRows } from "../src/race2/adapters/OfficialRaceResultProjection.js";
import { materializeOfficialRaceRows } from "../src/engine/RaceFinalizationEngine.js";
import { materializeNextSeasonCarStats } from "../src/domain/nextSeasonMaterialization.js";

const root=new URL("../",import.meta.url);
async function realPack(){
  return JSON.parse(await fs.readFile(new URL("public/data/seasons/2000/season.json",root),"utf8"));
}
const team=(state,name)=>state.teams.find(t=>String(t.team_name||"").toLowerCase().includes(name.toLowerCase()));

test("real 2000 pack has full historical team field, two-driver inferred cars and proper ranking",async()=>{
  const pack=await realPack();
  assert.equal(pack.validation?.ok,true,JSON.stringify(pack.validation));
  assert.equal(pack.state.teams.length,11,"2000 must have the full 11-team grid");
  const ids=new Set(pack.state.teams.map(t=>String(t.team_id)));
  const derived=pack.state.carStats.filter(r=>r.generation_source==="historical_results_inference");
  assert.equal(derived.length,ids.size,"every 2000 entrant must get a Results-derived car");
  assert.ok(derived.every(r=>ids.has(String(r.team_id))));
  assert.ok(derived.every(r=>r.historical_evidence_driver_count>=2));
  const ferrari=team(pack.state,"Ferrari");
  const mclaren=team(pack.state,"McLaren");
  const williams=team(pack.state,"Williams");
  const minardi=team(pack.state,"Minardi");
  assert.ok(ferrari&&mclaren&&williams&&minardi,"2000 must include four historical benchmark teams");
  const gs={...pack.state,activeYear:2000,team:{team_id:ferrari.team_id}};
  const ratings=[ferrari,mclaren,williams,minardi].map(t=>({name:t.team_name,performance:teamCarPerformance(gs,t.team_id)}));
  const score=name=>ratings.find(r=>r.name.toLowerCase().includes(name.toLowerCase())).performance.race;
  assert.ok(score("Ferrari")>score("Minardi"),JSON.stringify(ratings));
  assert.ok(score("McLaren")>score("Minardi"),JSON.stringify(ratings));
  assert.ok(score("Williams")>score("Minardi"),JSON.stringify(ratings));
  assert.ok(pack.state.driverRatings.length>=20,"driver-rating materializer remains populated");
  console.log("REAL_2000_CAR_SCORES="+JSON.stringify(ratings));
});

test("real 2000 driver entries and car attributes reach canonical race, live/autosim and official Results",async()=>{
  const pack=await realPack();
  const ferrari=team(pack.state,"Ferrari");
  const minardi=team(pack.state,"Minardi");
  assert.ok(ferrari&&minardi);
  const seats=(pack.state.contracts||[]).filter(isRaceDriverContract);
  const ferrariSeat=seats.find(c=>String(c.team_id)===String(ferrari.team_id));
  const minardiSeat=seats.find(c=>String(c.team_id)===String(minardi.team_id));
  assert.ok(ferrariSeat&&minardiSeat,"2000 Ferrari and Minardi need valid race contracts");
  const gp=pack.state.calendar[0];
  assert.ok(gp?.track_id,"2000 first race needs its historical circuit");
  const entrants=[
    {driver_id:String(ferrariSeat.driver_id),team_id:String(ferrari.team_id),car_id:"car_1",status:"confirmed"},
    {driver_id:String(minardiSeat.driver_id),team_id:String(minardi.team_id),car_id:"ai_minardi_car_1",status:"confirmed"},
  ];
  const gs={
    ...pack.state,activeYear:2000,currentRound:0,saveMeta:{seed:"real-2000-race-smoke"},
    team:{team_id:ferrari.team_id},
    garage:{cars:[{id:"car_1",kind:"race",driver_id:entrants[0].driver_id,componentCondition:{engine:100,suspension:100}}]},
    aiTechnicalWorld:{teams:{[minardi.team_id]:{
      garage:{cars:[{id:"ai_minardi_car_1",kind:"race",componentCondition:{engine:100,suspension:100}}]},
    }}},
    raceEntryState:{entries:entrants},
    raceWeekendState:{
      engine_version:"rw2",key:"2000_1_smoke",year:2000,round:1,roundIndex:0,
      gp_id:gp.gp_id,gp_name:gp.gp_name,track_id:gp.track_id,
      entrants,startingGrid:{rows:entrants.map((e,i)=>({driver_id:e.driver_id,team_id:e.team_id,grid:i+1}))},
      race_strategy:{
        track_snapshot:{track_id:gp.track_id,length_m:1200,laps:1},
        weather_snapshot:{state:"SUNNY",wet_race:false},
        rules_snapshot:{refuelling_allowed:true},
      },
    },
  };
  const input=buildRaceWeekendInput(gs,{gp});
  assert.equal(input.engineVersion,"rw2");
  assert.equal(input.year,2000);
  assert.equal(input.cars.length,2,"both real 2000 team cars must reach the engine");
  assert.equal(input.drivers.length,2);
  const sourcePerf=t=>teamCarPerformance(gs,t);
  for(const c of input.cars){
    assert.equal(c.performance.race,sourcePerf(c.teamId).race);
    assert.ok(Number.isFinite(c.performance.power));
  }
  const initial=startRaceState(createRaceState(input));
  assert.equal(initial.cars.length,2);
  const fast=runFastRaceToEnd(initial,{maxSteps:20000});
  assert.equal(fast.status,"finished");
  const live=createLiveRaceRunner(initial);
  for(let tick=0;tick<fast.tick;tick++)live.step();
  assert.deepEqual(live.getState(),fast,"Live and Autosim must use the same 2000 canonical result");
  const official=projectCanonicalRaceStateToOfficialRows(gs,fast);
  const archived=materializeOfficialRaceRows(official);
  assert.equal(archived.length,2);
  assert.equal(new Set(archived.map(r=>r.driver_id)).size,2);
  assert.ok(archived.every(r=>r.team_id&&r.status));
  const future=materializeNextSeasonCarStats(gs,2001);
  assert.ok(future.some(r=>r.team_id===ferrari.team_id));
  assert.ok(future.every(r=>r.generation_source!=="historical_results_inference"),
    "2001 simulated rollover must not import real 2001 Results baselines");
  console.log("REAL_2000_RACE_SMOKE="+JSON.stringify({
    track:gp.track_id,steps:fast.tick,classification:archived.map(r=>({
      team_id:r.team_id,position:r.pos,status:r.status,finish_ms:r.total_time_ms,
    })),
  }));
});
