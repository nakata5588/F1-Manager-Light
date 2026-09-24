import test from "node:test";
import assert from "node:assert/strict";

import {
  aiTechnicalPlanningAssessment,
  aiTechnicalTeamState,
  applyAIRaceComponentWear,
  normalizeAITechnicalWorld,
  planAITechnicalProject,
  processAITechnicalMaintenance,
  tickAITechnicalTeam,
  tickAITechnicalWorld,
} from "../src/engine/AITechnicalEngine.js";
import { availableCarComponentSlots } from "../src/domain/carComponents.js";
import { processTechnologyAdoption } from "../src/domain/technologyAdoption.js";
import { teamCarCharacteristics } from "../src/domain/carCharacteristics.js";
import { teamCarPerformance } from "../src/domain/carPerformance.js";
import { carReliabilityProfile } from "../src/domain/carReliability.js";
import { combinedQualifyingPerformance } from "../src/domain/driverPerformance.js";
import { migrateGameState, prepareGameStateForSave } from "../src/core/saveSafety.js";

function baseState(){
  return {
    activeYear:1980,
    currentDateISO:"1980-01-01",
    calendar:[
      {gp_id:"ARG",date:"1980-01-13"},
      {gp_id:"BRA",date:"1980-01-27"},
      {gp_id:"RSA",date:"1980-03-01"},
      {gp_id:"BEL",date:"1980-05-04"},
      {gp_id:"GBR",date:"1980-07-13"},
      {gp_id:"USA",date:"1980-10-05"},
    ],
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

  const planned=planAITechnicalProject(withTeamBudget(gs,"WILLIAMS",5_000_000),"WILLIAMS",{force:true});
  const project=aiTechnicalTeamState(planned,"WILLIAMS").development.projects[0];
  assert.ok(project);
  assert.notEqual(project.type,"turbocharger");
});

test("AI prioritizes a meaningful current-car weakness over speculative rival technology",()=>{
  const seeded=stateAtPlanningReview("WILLIAMS","1980-02-01",5_000_000);
  const weak={
    ...seeded,
    carStats:(seeded.carStats||[]).map((row)=>
      row.team_id==="WILLIAMS"?{...row,chassis_spec:55,aero_spec:56,gearbox_spec:58}:row
    ),
  };
  const assessment=aiTechnicalPlanningAssessment(weak,"WILLIAMS");
  assert.equal(assessment.action,"develop");
  assert.equal(assessment.prefer_technology,false);
  assert.ok(Number(assessment.need.gap)>=Number(assessment.gap_threshold));
  assert.ok(assessment.technology,"rival Turbo should remain visible as a future opportunity");
});

test("AI can fund a discovered rival technology before developing its own component",()=>{
  const gs=stateAtPlanningReview("WILLIAMS","1980-02-01",5_000_000);
  const assessment=aiTechnicalPlanningAssessment(gs,"WILLIAMS");
  assert.equal(assessment.action,"adopt_technology");
  assert.equal(assessment.technology.slot,"turbocharger");

  const before=aiTechnicalTeamState(gs,"WILLIAMS").budget;
  let planned=planAITechnicalProject(gs,"WILLIAMS");
  let state=aiTechnicalTeamState(planned,"WILLIAMS");
  const project=state.technology_projects[0];
  assert.ok(project);
  assert.equal(project.status,"active");
  assert.ok(state.budget<before);
  assert.equal(availableCarComponentSlots(planned,"WILLIAMS").includes("turbocharger"),false);
  assert.ok(planned.inbox.some((row)=>/Williams begins Turbocharger/i.test(row.subject)));

  planned=processTechnologyAdoption({...planned,currentDateISO:project.finishes_at});
  state=aiTechnicalTeamState(planned,"WILLIAMS");
  assert.equal(state.technology_projects[0].status,"completed");
  assert.ok(state.technology_unlocks.turbocharger);
  assert.equal(availableCarComponentSlots(planned,"WILLIAMS").includes("turbocharger"),true);
});

test("AI planning spends real team technical budget and project takes time",()=>{
  const gs=withTeamBudget(baseState(),"RENAULT",5_000_000);
  const before=aiTechnicalTeamState(gs,"RENAULT").budget;
  const planned=planAITechnicalProject(gs,"RENAULT",{force:true});
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
  const planned=planAITechnicalProject(gs,"RENAULT",{force:true});
  assert.equal(aiTechnicalTeamState(planned,"RENAULT").development.projects.length,0);
  assert.equal(aiTechnicalTeamState(planned,"RENAULT").budget,10_000);
});

test("completed design queues timed manufacture, creates physical units and fits both cars",()=>{
  let gs=planAITechnicalProject(withTeamBudget(baseState(),"RENAULT",8_000_000),"RENAULT",{force:true});
  let state=aiTechnicalTeamState(gs,"RENAULT");
  const project=state.development.projects[0];

  gs={...gs,currentDateISO:project.finishes_at};
  gs=tickAITechnicalTeam(gs,"RENAULT",{allowPlanning:false});
  state=aiTechnicalTeamState(gs,"RENAULT");

  assert.equal(state.development.projects[0].status,"completed");
  assert.equal(state.development.parts.length,1);
  assert.ok(state.development.technicalKnowledge);
  assert.ok(state.development.technicalKnowledge.history.some((row)=>row.source==="project"));
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

test("AI Development 2.0 projects use an objective-driven technical brief",()=>{
  let gs=planAITechnicalProject(withTeamBudget(baseState(),"RENAULT",8_000_000),"RENAULT",{force:true});
  let state=aiTechnicalTeamState(gs,"RENAULT");
  const project=state.development.projects[0];

  assert.ok(project.objective_id);
  assert.ok(project.objective_label);
  assert.ok(project.technical_projection);
  assert.equal(project.technical_projection.objective.id,project.objective_id);

  gs={...gs,currentDateISO:project.finishes_at};
  gs=tickAITechnicalTeam(gs,"RENAULT",{allowPlanning:false});
  state=aiTechnicalTeamState(gs,"RENAULT");
  const design=state.development.parts[0];

  assert.equal(design.development_focus,project.objective_id);
  assert.equal(design.technical_profile.objective.id,project.objective_id);
  assert.equal(Number(design.perf),Number(project.target_design_perf));
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
  const lowProject=aiTechnicalTeamState(planAITechnicalProject(low,"RENAULT",{force:true}),"RENAULT").development.projects[0];
  const highProject=aiTechnicalTeamState(planAITechnicalProject(high,"RENAULT",{force:true}),"RENAULT").development.projects[0];
  assert.ok(lowProject.duration_days>highProject.duration_days);
});

test("AI technical planning is deterministic for the same save-world state",()=>{
  const a=planAITechnicalProject(withTeamBudget(baseState(),"RENAULT",5_000_000),"RENAULT",{force:true});
  const b=planAITechnicalProject(withTeamBudget(baseState(),"RENAULT",5_000_000),"RENAULT",{force:true});
  assert.deepEqual(aiTechnicalTeamState(a,"RENAULT"),aiTechnicalTeamState(b,"RENAULT"));
});


function completeOneAICycle(gs,teamId){
  let next=planAITechnicalProject(gs,teamId,{force:true});
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

test("AI technical world ticks deterministically and does not auto-develop on day one",()=>{
  const a=tickAITechnicalWorld(baseState());
  const b=tickAITechnicalWorld(baseState());
  assert.deepEqual(a.aiTechnicalWorld,b.aiTechnicalWorld);
  assert.equal(aiTechnicalTeamState(a,"RENAULT").development.projects.length,0);
  assert.equal(aiTechnicalTeamState(a,"WILLIAMS").development.projects.length,0);
  assert.ok(aiTechnicalTeamState(a,"RENAULT").planning.next_review_date>"1980-01-01");
});

test("AI technical save-world survives save preparation and migration",()=>{
  const upgraded=completeOneAICycle(withTeamBudget(baseState(),"RENAULT",8_000_000),"RENAULT");
  const prepared=prepareGameStateForSave(upgraded);
  const loaded=migrateGameState(JSON.parse(JSON.stringify(prepared)));
  assert.deepEqual(loaded.aiTechnicalWorld,prepared.aiTechnicalWorld);
});


function setAIUnitCondition(gs,teamId,unitId,condition){
  const state=aiTechnicalTeamState(gs,teamId);
  return {
    ...gs,
    aiTechnicalWorld:{
      ...gs.aiTechnicalWorld,
      teams:{
        ...gs.aiTechnicalWorld.teams,
        [teamId]:{
          ...state,
          development:{
            ...state.development,
            partUnits:state.development.partUnits.map((unit)=>
              String(unit.id)===String(unitId)?{...unit,condition}:unit
            ),
          },
        },
      },
    },
  };
}

test("AI race cars accumulate shared component wear independently",()=>{
  const seeded=normalizeAITechnicalWorld(baseState());
  const worn=applyAIRaceComponentWear(seeded,{
    gp:{gp_id:"ARG"},
    race:[
      {
        driver:{driver_id:"REN_1"},
        retired:true,
        retirement_reason:"Accident",
        incident_severity:"high",
        laps_completed:18,
        race_laps:54,
      },
      {
        driver:{driver_id:"REN_2"},
        retired:false,
        laps_completed:54,
        race_laps:54,
      },
    ],
  });

  const state=aiTechnicalTeamState(worn,"RENAULT");
  const car1=state.garage.cars[0];
  const car2=state.garage.cars[1];
  assert.ok(Number(car1.componentCondition.aero_front)<Number(car2.componentCondition.aero_front));
  assert.ok(Number(car1.componentCondition.gearbox)<100);
  assert.ok(Number(car2.componentCondition.gearbox)<100);
  assert.ok(state.componentWearLog.length>0);
  assert.equal((worn.garage?.cars||[]).length,0,"AI wear must not mutate the player's garage");
});

test("AI developed physical units wear and immediately feed performance and reliability",()=>{
  let gs=completeOneAICycle(withTeamBudget(baseState(),"RENAULT",8_000_000),"RENAULT");
  const beforeState=aiTechnicalTeamState(gs,"RENAULT");
  const slot=beforeState.development.parts[0].slot;
  const unitId=beforeState.garage.cars[0].installedParts[slot];
  const beforePerformance=teamCarPerformance(gs,"RENAULT","REN_1");
  const beforeReliability=carReliabilityProfile(gs,"RENAULT","REN_1");

  gs=applyAIRaceComponentWear(gs,{
    gp:{gp_id:"BRA"},
    race:[{
      driver:{driver_id:"REN_1"},
      retired:true,
      retirement_reason:"Collision",
      incident_severity:"critical",
      laps_completed:42,
      race_laps:55,
    }],
  });

  const afterState=aiTechnicalTeamState(gs,"RENAULT");
  const unit=afterState.development.partUnits.find((row)=>row.id===unitId);
  const afterPerformance=teamCarPerformance(gs,"RENAULT","REN_1");
  const afterReliability=carReliabilityProfile(gs,"RENAULT","REN_1");

  assert.ok(Number(unit.condition)<100);
  assert.ok(
    Number(afterPerformance.qualifying)<Number(beforePerformance.qualifying) ||
    Number(afterPerformance.race)<Number(beforePerformance.race) ||
    Number(afterReliability.reliability_pct)<Number(beforeReliability.reliability_pct),
    "physical wear must affect the same live car model used by racing"
  );
});

test("AI maintenance pays for a timed developed-unit restore and refits it after completion",()=>{
  let gs=completeOneAICycle(withTeamBudget(baseState(),"RENAULT",8_000_000),"RENAULT");
  let state=aiTechnicalTeamState(gs,"RENAULT");
  const slot=state.development.parts[0].slot;
  const unitId=state.garage.cars[0].installedParts[slot];
  gs=setAIUnitCondition(gs,"RENAULT",unitId,20);

  state=aiTechnicalTeamState(gs,"RENAULT");
  const beforeBudget=state.budget;
  const maintained=processAITechnicalMaintenance(gs,"RENAULT",state);
  const activeJob=maintained.garage.serviceJobs.find((job)=>job.status==="active");

  assert.ok(activeJob,"worn developed unit should enter the workshop when affordable");
  assert.equal(activeJob.kind,"restore_part_unit");
  assert.equal(activeJob.unit_id,unitId);
  assert.ok(maintained.budget<beforeBudget);
  assert.equal(maintained.garage.cars[0].installedParts[slot],undefined);
  assert.equal(maintained.finance_log.at(-1).category,"Maintenance");

  gs={
    ...gs,
    currentDateISO:activeJob.finishes_at,
    aiTechnicalWorld:{
      ...gs.aiTechnicalWorld,
      teams:{...gs.aiTechnicalWorld.teams,RENAULT:maintained},
    },
  };
  gs=tickAITechnicalTeam(gs,"RENAULT",{allowPlanning:false});
  state=aiTechnicalTeamState(gs,"RENAULT");
  const restored=state.development.partUnits.find((unit)=>unit.id===unitId);

  assert.equal(state.garage.serviceJobs.find((job)=>job.id===activeJob.id).status,"completed");
  assert.equal(restored.condition,100);
  assert.equal(state.garage.cars[0].installedParts[slot],unitId);
});

test("AI maintenance cannot repair a worn developed unit without money or a spare",()=>{
  let gs=completeOneAICycle(withTeamBudget(baseState(),"RENAULT",8_000_000),"RENAULT");
  let state=aiTechnicalTeamState(gs,"RENAULT");
  const slot=state.development.parts[0].slot;
  const unitId=state.garage.cars[0].installedParts[slot];
  gs=setAIUnitCondition(gs,"RENAULT",unitId,20);
  state={...aiTechnicalTeamState(gs,"RENAULT"),budget:0};

  const maintained=processAITechnicalMaintenance(gs,"RENAULT",state);
  const installedId=maintained.garage.cars[0].installedParts[slot];
  const unit=maintained.development.partUnits.find((row)=>row.id===unitId);

  assert.equal(installedId,unitId);
  assert.equal(unit.condition,20);
  assert.equal(maintained.garage.serviceJobs.filter((job)=>job.status==="active").length,0);
  assert.equal(maintained.budget,0);
});

test("AI race wear is deterministic for the same race state",()=>{
  const fixture=normalizeAITechnicalWorld(baseState());
  const input={
    gp:{gp_id:"MON"},
    race:[
      {driver:{driver_id:"REN_1"},retired:false,laps_completed:76,race_laps:76},
      {driver:{driver_id:"REN_2"},retired:true,retirement_reason:"Gearbox",laps_completed:31,race_laps:76},
    ],
  };
  assert.deepEqual(
    applyAIRaceComponentWear(fixture,input).aiTechnicalWorld,
    applyAIRaceComponentWear(fixture,input).aiTechnicalWorld
  );
});


function stateAtPlanningReview(teamId="RENAULT",date="1980-02-01",budget=5_000_000){
  const seeded=withTeamBudget(baseState(),teamId,budget);
  return {...seeded,currentDateISO:date};
}

test("normal AI planning waits for a scheduled technical review instead of developing because idle",()=>{
  const seeded=normalizeAITechnicalWorld(baseState());
  const assessment=aiTechnicalPlanningAssessment(seeded,"RENAULT");
  const planned=planAITechnicalProject(seeded,"RENAULT");

  assert.equal(assessment.action,"hold");
  assert.equal(assessment.reason,"review_not_due");
  assert.equal(aiTechnicalTeamState(planned,"RENAULT").development.projects.length,0);
});

test("AI starts a project at review only when a meaningful competitive component gap exists",()=>{
  const gs=stateAtPlanningReview("RENAULT","1980-02-01",5_000_000);
  const assessment=aiTechnicalPlanningAssessment(gs,"RENAULT");
  assert.equal(assessment.action,"develop");
  assert.equal(assessment.reason,"competitive_technical_gap");
  assert.ok(assessment.need.gap>=assessment.gap_threshold);
  assert.ok(assessment.need.benchmark>assessment.need.current);

  const planned=planAITechnicalProject(gs,"RENAULT");
  const state=aiTechnicalTeamState(planned,"RENAULT");
  assert.equal(state.development.projects.length,1);
  assert.equal(state.planning.last_decision.action,"develop");
  assert.equal(state.development.projects[0].planning_trigger,"competitive_technical_gap");
});

test("newsworthy live AI development is visible in the player Inbox",()=>{
  const gs=stateAtPlanningReview("RENAULT","1980-02-01",5_000_000);
  const planned=planAITechnicalProject(gs,"RENAULT");
  const news=(planned.inbox||[]).find((row)=>row.from==="Paddock Technical Watch");

  assert.ok(news,"first live AI project of the season should generate technical news");
  assert.equal(news.type,"DEV");
  assert.match(news.subject,/Renault/i);
  assert.match(news.body,/real AI technical project/i);
  assert.ok(news.actions.some((action)=>String(action.route).startsWith("/Car")));
});

test("front-running AI can deliberately do nothing when no technical opportunity or meaningful weakness exists",()=>{
  let gs=stateAtPlanningReview("WILLIAMS","1980-02-01",5_000_000);
  gs={
    ...gs,
    carStats:gs.carStats.map((row)=>row.team_id==="RENAULT"?{
      ...row,
      chassis_spec:80,aero_spec:80,gearbox_spec:80,suspension_spec:80,
      brakes_spec:80,cooling_spec:80,turbo_spec:0,
    }:row),
    teamEngines:gs.teamEngines.map((row)=>row.team_id==="RENAULT"?{
      ...row,engine_name:"Renault EF1",power:80,reliability:80,
    }:row),
  };
  const assessment=aiTechnicalPlanningAssessment(gs,"WILLIAMS");
  const planned=planAITechnicalProject(gs,"WILLIAMS");

  assert.equal(assessment.action,"hold");
  assert.equal(assessment.reason,"no_meaningful_competitive_gap");
  assert.ok(Number(assessment.need.gap)<Number(assessment.gap_threshold));
  assert.equal(aiTechnicalTeamState(planned,"WILLIAMS").development.projects.length,0);
  assert.equal(aiTechnicalTeamState(planned,"WILLIAMS").technology_projects.length,0);
  assert.equal(aiTechnicalTeamState(planned,"WILLIAMS").planning.last_decision.action,"hold");
});

test("AI protects a technical cash reserve even when it can technically afford the next project",()=>{
  const seeded={...normalizeAITechnicalWorld(baseState()),currentDateISO:"1980-02-01"};
  const original=aiTechnicalTeamState(seeded,"RENAULT");
  const probe=aiTechnicalPlanningAssessment(seeded,"RENAULT");
  const constrainedBudget=probe.total_commitment+Math.max(10_000,probe.reserve_floor-50_000);
  const gs={
    ...seeded,
    aiTechnicalWorld:{
      ...seeded.aiTechnicalWorld,
      teams:{
        ...seeded.aiTechnicalWorld.teams,
        RENAULT:{...original,budget:constrainedBudget},
      },
    },
  };
  const assessment=aiTechnicalPlanningAssessment(gs,"RENAULT");
  assert.equal(assessment.action,"hold");
  assert.equal(assessment.reason,"budget_reserve");
  assert.ok(assessment.budget>=assessment.total_commitment);
  assert.ok(assessment.budget_after_commitment<assessment.reserve_floor);
});

test("AI uses concurrent project slots instead of a seasonal project allowance",()=>{
  let gs=stateAtPlanningReview("RENAULT","1980-06-01",8_000_000);
  const seeded=aiTechnicalTeamState(gs,"RENAULT");
  const probe=aiTechnicalPlanningAssessment(gs,"RENAULT",{force:true});

  const completed=Array.from({length:10},(_,index)=>({
    id:`completed_${index+1}`,
    type:index%2?"aero_front":"gearbox",
    status:"completed",
    started_at:"1980-02-01",
    completed_at:"1980-03-01",
    engineers:3,
  }));
  gs={
    ...gs,
    aiTechnicalWorld:{
      ...gs.aiTechnicalWorld,
      teams:{
        ...gs.aiTechnicalWorld.teams,
        RENAULT:{
          ...seeded,
          development:{...seeded.development,projects:completed},
          planning:{...seeded.planning,next_review_date:"1980-06-01"},
        },
      },
    },
  };

  const afterCompleted=aiTechnicalPlanningAssessment(gs,"RENAULT",{force:true});
  assert.notEqual(afterCompleted.reason,"season_capacity_reached");
  assert.equal(afterCompleted.action,"develop");

  const active=Array.from({length:probe.project_slots},(_,index)=>({
    id:`active_${index+1}`,
    type:index%2?"aero_front":"gearbox",
    status:"active",
    started_at:"1980-05-01",
    finishes_at:"1980-07-01",
    engineers:1,
  }));
  gs={
    ...gs,
    aiTechnicalWorld:{
      ...gs.aiTechnicalWorld,
      teams:{
        ...gs.aiTechnicalWorld.teams,
        RENAULT:{
          ...seeded,
          development:{...seeded.development,projects:active},
          planning:{...seeded.planning,next_review_date:"1980-06-01"},
        },
      },
    },
  };

  const full=aiTechnicalPlanningAssessment(gs,"RENAULT",{force:true});
  assert.equal(full.action,"hold");
  assert.equal(full.reason,"technical_capacity_busy");
  assert.equal(full.concurrent_projects,full.project_slots);
});

test("AI will not start an upgrade too late to design manufacture and fit before season end",()=>{
  let gs=stateAtPlanningReview("RENAULT","1980-10-04",5_000_000);
  const state=aiTechnicalTeamState(gs,"RENAULT");
  gs={
    ...gs,
    aiTechnicalWorld:{
      ...gs.aiTechnicalWorld,
      teams:{
        ...gs.aiTechnicalWorld.teams,
        RENAULT:{...state,planning:{...state.planning,next_review_date:"1980-10-04"}},
      },
    },
  };
  const assessment=aiTechnicalPlanningAssessment(gs,"RENAULT");
  assert.equal(assessment.action,"hold");
  assert.equal(assessment.reason,"too_late_to_deliver");
  assert.ok(assessment.days_to_season_end<assessment.delivery_days);
});

test("after committing a package AI schedules another review before the design cycle ends",()=>{
  const gs=stateAtPlanningReview("RENAULT","1980-02-01",5_000_000);
  const planned=planAITechnicalProject(gs,"RENAULT");
  const state=aiTechnicalTeamState(planned,"RENAULT");
  const project=state.development.projects[0];

  assert.ok(project);
  assert.ok(project.engineers>=1);
  assert.ok(state.planning.next_review_date>project.started_at);
  assert.ok(state.planning.next_review_date<project.finishes_at);
  assert.equal(state.planning.last_need,project.type);
});

test("old AI technical saves gain planning guardrails without losing their live technical world",()=>{
  const old=normalizeAITechnicalWorld(baseState());
  const state=aiTechnicalTeamState(old,"RENAULT");
  const legacy={
    ...old,
    currentDateISO:"1980-04-01",
    aiTechnicalWorld:{
      version:1,
      teams:{
        ...old.aiTechnicalWorld.teams,
        RENAULT:{
          ...state,
          initial_budget:undefined,
          planning:{last_date:"1980-02-01",last_need:"gearbox",cycle:2},
        },
      },
    },
  };
  const migrated=normalizeAITechnicalWorld(legacy);
  const next=aiTechnicalTeamState(migrated,"RENAULT");

  assert.ok(next.initial_budget>=next.budget);
  assert.equal(next.planning.season_year,1980);
  assert.ok(next.planning.next_review_date>"1980-04-01");
  assert.equal(next.garage.cars.length,state.garage.cars.length);
});
