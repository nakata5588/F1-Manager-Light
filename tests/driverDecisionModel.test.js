import test from "node:test";
import assert from "node:assert/strict";

import {
  DRIVER_DECISION_MODEL_VERSION,
  driverContractDecision,
  driverDecisionTraits,
  driverTeamCompetitiveness,
} from "../src/domain/driverDecisionModel.js";
import { expectedDriverSalary } from "../src/domain/driverContracts.js";
import {
  driverNegotiations,
  processDriverNegotiations,
  startDriverNegotiation,
} from "../src/engine/NegotiationEngine.js";

function relation(driverId,teamId,score){
  return {
    driver_id:driverId,
    target_type:"team",
    target_id:teamId,
    team_id:teamId,
    trust:score,
    respect:score,
    affinity:score,
    satisfaction:score,
    score,
    active:true,
  };
}

function fixture({
  currentTeamId=null,
  currentRole="Second Driver",
  relationScore=50,
  morale=50,
  stage="prime",
}={}){
  const gs={
    activeYear:1980,
    currentDateISO:"1980-08-01",
    team:{team_id:"T1",team_name:"Front Team"},
    teams:[
      {team_id:"T1",team_name:"Front Team"},
      {team_id:"T2",team_name:"Mid Team"},
      {team_id:"T3",team_name:"Back Team"},
    ],
    standings:{
      teams:[
        {team_id:"T1",position:1,points:80},
        {team_id:"T2",position:2,points:35},
        {team_id:"T3",position:3,points:5},
      ],
      drivers:[],
    },
    drivers:[
      {
        driver_id:"D1",
        display_name:"Decision Driver",
        dob:"1952-01-01",
        status:"eligible",
        canHireF1:true,
      },
    ],
    driverRatings:[
      {
        driver_id:"D1",
        current_ability:84,
        potential_ability:88,
        reputation:82,
        mentality:76,
        pressure_handling:74,
        team_player:70,
        aggression:62,
      },
    ],
    driverLifecycle:{
      D1:{
        driver_id:"D1",
        stage,
        label:stage==="retirement_window"?"Retirement Window":"Prime",
        age:stage==="retirement_window"?39:28,
        headroom:stage==="retirement_window"?0:4,
      },
    },
    driverAttributes:{
      D1:{morale,confidence:55,preparation:50,fatigue:0},
    },
    driverRelationships:{version:2,relations:{},log:[]},
    driverRivalries:{version:1,pairs:{},log:[]},
    contracts:[],
    driverNegotiations:[],
    driverTransferApproaches:[],
    inbox:[],
    finances:{balance:10_000_000,budget:10_000_000},
  };

  if(currentTeamId){
    gs.contracts.push({
      year:1980,
      team_id:currentTeamId,
      team_name:currentTeamId,
      driver_id:"D1",
      driver_name:"Decision Driver",
      role:currentRole,
      salary:900_000,
      contract_start_year:1978,
      contract_until_year:1981,
      status:"active",
      release_clause:250_000,
    });
    gs.driverRelationships.relations["D1|team|"+currentTeamId]=relation("D1",currentTeamId,relationScore);
  }

  return gs;
}

function decision(gs,{teamId="T1",role="Main Driver",years=2,kind="new_contract"}={}){
  const salary=expectedDriverSalary(gs,"D1",{role});
  return driverContractDecision(gs,{
    driverId:"D1",
    teamId,
    kind,
    offer:{salary,years,role},
  });
}

test("D7.1 exposes deterministic career decision traits from live Save World state",()=>{
  const gs=fixture({currentTeamId:"T3",relationScore:80});
  const traits=driverDecisionTraits(gs,"D1");
  assert.equal(traits.career_stage,"prime");
  assert.ok(traits.ambition>60);
  assert.ok(traits.loyalty>50);
  assert.ok(traits.security>=30&&traits.security<=90);
  assert.ok(traits.risk_appetite>=20&&traits.risk_appetite<=85);
  assert.ok(["Main Driver","Second Driver","Reserve Driver","Test Driver"].includes(traits.desired_role));
});

test("D7.1 ambitious drivers value a suitable race role over a reserve role",()=>{
  const gs=fixture();
  const main=decision(gs,{role:"Main Driver"});
  const reserve=decision(gs,{role:"Reserve Driver"});
  assert.ok(main.acceptance_probability>reserve.acceptance_probability);
  assert.ok(main.interest_score>reserve.interest_score);
  const reserveRole=reserve.factors.find((row)=>row.key==="role_fit");
  assert.equal(reserveRole.direction,"negative");
});

test("D7.1 team competitiveness changes a transfer decision without rewriting contract economics",()=>{
  const gs=fixture({currentTeamId:"T3",relationScore:50});
  const front=decision(gs,{teamId:"T1",role:"Main Driver",kind:"transfer"});
  const midfield=decision(gs,{teamId:"T2",role:"Main Driver",kind:"transfer"});

  assert.ok(front.acceptance_probability>midfield.acceptance_probability);
  assert.equal(front.target_team.label,"Front-running");
  assert.equal(midfield.target_team.label,"Midfield");
  assert.equal(driverTeamCompetitiveness(gs,"T3").label,"Backmarker");
});

test("D7.1 loyalty to a healthy current team can resist an otherwise attractive transfer",()=>{
  const loyal=fixture({currentTeamId:"T3",relationScore:88,morale:60});
  const strained=fixture({currentTeamId:"T3",relationScore:22,morale:60});
  const loyalDecision=decision(loyal,{teamId:"T1",kind:"transfer"});
  const strainedDecision=decision(strained,{teamId:"T1",kind:"transfer"});

  assert.ok(loyalDecision.traits.loyalty>strainedDecision.traits.loyalty);
  assert.ok(loyalDecision.acceptance_probability<strainedDecision.acceptance_probability);
  assert.equal(loyalDecision.factors.find((row)=>row.key==="loyalty").direction,"negative");
});

test("D7.1 renewal willingness reads persistent team relationships and morale",()=>{
  const positive=fixture({currentTeamId:"T1",relationScore:85,morale:70});
  const poor=fixture({currentTeamId:"T1",relationScore:20,morale:30});
  const goodDecision=decision(positive,{teamId:"T1",kind:"renewal",role:"Second Driver"});
  const poorDecision=decision(poor,{teamId:"T1",kind:"renewal",role:"Second Driver"});

  assert.ok(goodDecision.acceptance_probability>poorDecision.acceptance_probability);
  assert.equal(goodDecision.factors.find((row)=>row.key==="relationships").direction,"positive");
  assert.equal(poorDecision.factors.find((row)=>row.key==="relationships").direction,"negative");
});

test("D7.1 retirement-window drivers expose long-contract reluctance as a readable factor",()=>{
  const gs=fixture({stage:"retirement_window"});
  const long=decision(gs,{years:5,role:"Main Driver"});
  const security=long.factors.find((row)=>row.key==="contract_security");
  assert.equal(long.career_stage,"retirement_window");
  assert.equal(security.direction,"negative");
  assert.ok(security.delta<=-0.08);
});

test("D7.1 negotiation resolution persists the decision snapshot used by the engine",()=>{
  const gs=fixture();
  const salary=expectedDriverSalary(gs,"D1",{role:"Main Driver"});
  const submitted=startDriverNegotiation(gs,{
    driverId:"D1",
    teamId:"T1",
    teamName:"Front Team",
    offer:{salary,years:2,role:"Main Driver"},
    origin:"player",
  });
  const pending=driverNegotiations(submitted)[0];
  assert.ok(pending);

  const resolved=processDriverNegotiations(
    {...submitted,currentDateISO:pending.response_date},
    {forceOutcomeById:{[pending.id]:"accepted"}}
  );
  const stored=driverNegotiations(resolved).find((row)=>row.id===pending.id);

  assert.equal(stored.status,"accepted");
  assert.equal(stored.driver_decision.model_version,DRIVER_DECISION_MODEL_VERSION);
  assert.equal(stored.driver_decision.driver_id,"D1");
  assert.equal(stored.driver_decision.team_id,"T1");
  assert.ok(Array.isArray(stored.driver_decision.factors));
  assert.ok(stored.driver_decision.factors.length>=5);
});
