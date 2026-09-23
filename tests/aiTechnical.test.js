import test from "node:test";
import assert from "node:assert/strict";

import {
  aiTechnicalTeamState,
  normalizeAITechnicalWorld,
  planAITechnicalProject,
  tickAITechnicalTeam,
  tickAITechnicalWorld,
} from "../src/engine/AITechnicalEngine.js";
import { availableCarComponentSlots } from "../src/domain/carComponents.js";
import { teamCarCharacteristics } from "../src/domain/carCharacteristics.js";
import { teamCarPerformance } from "../src/domain/carPerformance.js";
import { carReliabilityProfile } from "../src/domain/carReliability.js";
import { combinedQualifyingPerformance } from "../src/domain/driverPerformance.js";
import { migrateGameState, prepareGameStateForSave } from "../src/core/saveSafety.js";

function baseState(){
  return {
    activeYear:1980,
    currentDateISO:"1980-01-01",
    team:{team_id:"PLAYER",budget:5_000_000},
    contracts:[
      {year:1980,team_id:"RENAULT",driver_id:"REN_1",role:"Main Driver",status:"active"},
      {year:1980,team_id:"RENAULT",driver_id:"REN_2",role:"Second Driver",status:"active"},
      {year:1980,team_id:"WILLIAMS",driver_id:"WIL_1",role:"Main Driver",status:"active"},
      {year:1980,team_id:"WILLIAMS",driver_id:"WIL_2",role:"Second Driver",status:"active"},
    ],
    teams:[
      {team_id:"PLAYER",year_from:1980,year_to:1980},
      {team_id:"RENAULT",year_from:1980,year_to:1980},
      {team_id:"WILLIAMS",year_from:1980,year_to:1980},
      {team_id:"HISTORIC_ONLY",team_name:"Historic only"},
    ],
    carStats:[
      {year:1980,team_id:"PLAYER",chassis_spec:82,aero_spec:82,gearbox_spec:80,suspension_spec:80,brakes_spec:80,cooling_spec:80,weight:595},
      {year:1980,team_id:"RENAULT",chassis_spec:76,aero_spec:78,gearbox_spec:74,suspension_spec:75,brakes_spec:77,cooling_spec:72,turbo_spec:82,weight:600},
      {year:1980,team_id:"WILLIAMS",chassis_spec:84,aero_spec:83,gearbox_spec:82,suspension_spec:82,brakes_spec:81,cooling_spec:80,turbo_spec:0,weight:590},
    ],
    teamEngines:[
      {year:1980,team_id:"RENAULT",engine_name:"Renault EF1 Turbo",power:86,reliability:68},
      {year:1980,team_id:"WILLIAMS",engine_name:"Ford Cosworth DFV",power:82,reliability:82},
    ],
    facilities:[
      {year:1980,team_id:"RENAULT",aero_dept_level:7,wind_tunnel_level:7,manufacturing_leve:7,_chassis_shop_level:7},
      {year:1980,team_id:"WILLIAMS",aero_dept_level:8,wind_tunnel_level:8,manufacturing_leve:8,_chassis_shop_level:8},
    ],
    teamOperationalState:{
      RENAULT:{team_id:"RENAULT",morale:50},
      WILLIAMS:{team_id:"WILLIAMS",morale:50},
    },
    development:{projects:[],parts:[],partUnits:[],manufacturing:[]},
    garage:{cars:[]},
  };
}
function withTeamBudget(gs,teamId,budget){
  const seeded=normalizeAITechnicalWorld(gs);
  return {
    ...seeded,
    aiTechnicalWorld:{
      ...seeded.aiTechnicalWorld,
      teams:{
        ...seeded.aiTechnicalWorld.teams,
        [teamId]:{...seeded.aiTechnicalWorld.teams[teamId],budget},
      },
    },
  };
}

test("AI technical world seeds non-player teams with persistent physical-car state",()=>{
  const gs=normalizeAITechnicalWorld(baseState());
  assert.equal(Boolean(aiTechnicalTeamState(gs,"PLAYER")),false);
  assert.equal(aiTechnicalTeamState(gs,"RENAULT").garage.cars.length,2);
  assert.equal(aiTechnicalTeamState(gs,"WILLIAMS").development.partUnits.length,0);
  assert.equal(aiTechnicalTeamState(gs,"HISTORIC_ONLY"),null);
});

test("AI project selection obeys era and fitted technology eligibility",()=>{
  const gs=baseState();
  assert.ok(availableCarComponentSlots(gs,"RENAULT").includes("turbocharger"));
  assert.equal(availableCarComponentSlots(gs,"WILLIAMS").includes("turbocharger"),false);

  const planned=planAITechnicalProject(withTeamBudget(gs,"WILLIAMS",5_000_000),"WILLIAMS");
  const project=aiTechnicalTeamState(planned,"WILLIAMS").development.projects[0];
  assert.ok(project);
  assert.notEqual(project.type,"turbocharger");
});

test("AI planning spends real team technical budget and project takes time",()=>{
  const gs=withTeamBudget(baseState(),"RENAULT",5_000_000);
  const before=aiTechnicalTeamState(gs,"RENAULT").budget;
  const planned=planAITechnicalProject(gs,"RENAULT");
  const state=aiTechnicalTeamState(planned,"RENAULT");
  const project=state.development.projects[0];

  assert.ok(project);
  assert.equal(project.status,"active");
  assert.ok(project.finishes_at>project.started_at);
  assert.ok(project.duration_days>=10);
  assert.equal(state.budget,before-project.cost);
  assert.equal(state.finance_log.at(-1).amount,-project.cost);
});

test("poor AI team does not receive a hidden free upgrade",()=>{
  const gs=withTeamBudget(baseState(),"RENAULT",10_000);
  const planned=planAITechnicalProject(gs,"RENAULT");
  assert.equal(aiTechnicalTeamState(planned,"RENAULT").development.projects.length,0);
  assert.equal(aiTechnicalTeamState(planned,"RENAULT").budget,10_000);
});

test("completed design queues timed manufacture, creates physical units and fits both cars",()=>{
  let gs=planAITechnicalProject(withTeamBudget(baseState(),"RENAULT",8_000_000),"RENAULT");
  let state=aiTechnicalTeamState(gs,"RENAULT");
  const project=state.development.projects[0];

  gs={...gs,currentDateISO:project.finishes_at};
  gs=tickAITechnicalTeam(gs,"RENAULT",{allowPlanning:false});
  state=aiTechnicalTeamState(gs,"RENAULT");

  assert.equal(state.development.projects[0].status,"completed");
  assert.equal(state.development.parts.length,1);
  assert.equal(state.development.manufacturing.length,1);
  assert.equal(state.development.manufacturing[0].status,"active");
  assert.ok(state.development.manufacturing[0].finishes_at>project.finishes_at);

  gs={...gs,currentDateISO:state.development.manufacturing[0].finishes_at};
  gs=tickAITechnicalTeam(gs,"RENAULT",{allowPlanning:false});
  state=aiTechnicalTeamState(gs,"RENAULT");

  assert.equal(state.development.manufacturing[0].status,"completed");
  assert.equal(state.development.partUnits.length,2);
  const slot=state.development.parts[0].slot;
  assert.ok(state.garage.cars[0].installedParts[slot]);
  assert.ok(state.garage.cars[1].installedParts[slot]);
  assert.notEqual(state.garage.cars[0].installedParts[slot],state.garage.cars[1].installedParts[slot]);
});

test("team morale reuses the shared work-rate model for AI project duration",()=>{
  const base=withTeamBudget(baseState(),"RENAULT",8_000_000);
  const low={
    ...base,
    teamOperationalState:{...base.teamOperationalState,RENAULT:{team_id:"RENAULT",morale:10}},
  };
  const high={
    ...base,
    teamOperationalState:{...base.teamOperationalState,RENAULT:{team_id:"RENAULT",morale:90}},
  };
  const lowProject=aiTechnicalTeamState(planAITechnicalProject(low,"RENAULT"),"RENAULT").development.projects[0];
  const highProject=aiTechnicalTeamState(planAITechnicalProject(high,"RENAULT"),"RENAULT").development.projects[0];
  assert.ok(lowProject.duration_days>highProject.duration_days);
});

test("AI technical planning is deterministic for the same save-world state",()=>{
  const a=planAITechnicalProject(withTeamBudget(baseState(),"RENAULT",5_000_000),"RENAULT");
  const b=planAITechnicalProject(withTeamBudget(baseState(),"RENAULT",5_000_000),"RENAULT");
  assert.deepEqual(aiTechnicalTeamState(a,"RENAULT"),aiTechnicalTeamState(b,"RENAULT"));
});


function completeOneAICycle(gs,teamId){
  let next=planAITechnicalProject(gs,teamId);
  let state=aiTechnicalTeamState(next,teamId);
  const project=state.development.projects.find((row)=>row.status==="active");
  next={...next,currentDateISO:project.finishes_at};
  next=tickAITechnicalTeam(next,teamId,{allowPlanning:false});
  state=aiTechnicalTeamState(next,teamId);
  const job=state.development.manufacturing.find((row)=>row.status==="active");
  next={...next,currentDateISO:job.finishes_at};
  return tickAITechnicalTeam(next,teamId,{allowPlanning:false});
}

test("AI fitted upgrades feed the shared Characteristics, Performance and Reliability models",()=>{
  const seeded=withTeamBudget(baseState(),"RENAULT",8_000_000);
  const beforeCharacteristics=teamCarCharacteristics(seeded,"RENAULT","REN_1");
  const beforePerformance=teamCarPerformance(seeded,"RENAULT","REN_1");
  const raceDriver={driver_id:"REN_1"};
  const raceRating={pace:78,qualifying:78,consistency:75,pressure_handling:75,adaptability:75,mentality:75,current_ability:78};
  const beforeQualifying=combinedQualifyingPerformance({gs:seeded,driver:raceDriver,rating:raceRating,teamId:"RENAULT"});

  const upgraded=completeOneAICycle(seeded,"RENAULT");
  const afterCharacteristics=teamCarCharacteristics(upgraded,"RENAULT","REN_1");
  const afterPerformance=teamCarPerformance(upgraded,"RENAULT","REN_1");
  const reliability=carReliabilityProfile(upgraded,"RENAULT","REN_1");
  const afterQualifying=combinedQualifyingPerformance({gs:upgraded,driver:raceDriver,rating:raceRating,teamId:"RENAULT"});

  assert.ok(
    Object.values(afterCharacteristics.upgrade_delta).some((value)=>Math.abs(Number(value||0))>0),
    "AI installed design should alter at least one driving characteristic"
  );
  assert.ok(
    Number(afterPerformance.development_bonus.qualifying)!==Number(beforePerformance.development_bonus.qualifying) ||
    Number(afterPerformance.development_bonus.race)!==Number(beforePerformance.development_bonus.race),
    "AI installed design should alter shared car performance"
  );
  assert.ok(reliability.components.some((row)=>row.design_id),"AI reliability should see the installed physical design");
  assert.notDeepEqual(afterCharacteristics.values,beforeCharacteristics.values);
  assert.notEqual(afterQualifying,beforeQualifying,"Race Weekend qualifying path should consume the AI car upgrade");
});

test("AI technical world ticks deterministically across all AI teams",()=>{
  const a=tickAITechnicalWorld(baseState());
  const b=tickAITechnicalWorld(baseState());
  assert.deepEqual(a.aiTechnicalWorld,b.aiTechnicalWorld);
  assert.ok(aiTechnicalTeamState(a,"RENAULT").development.projects.length>=1);
  assert.ok(aiTechnicalTeamState(a,"WILLIAMS").development.projects.length>=1);
});

test("AI technical save-world survives save preparation and migration",()=>{
  const upgraded=completeOneAICycle(withTeamBudget(baseState(),"RENAULT",8_000_000),"RENAULT");
  const prepared=prepareGameStateForSave(upgraded);
  const loaded=migrateGameState(JSON.parse(JSON.stringify(prepared)));
  assert.deepEqual(loaded.aiTechnicalWorld,prepared.aiTechnicalWorld);
});
