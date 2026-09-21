import test from "node:test";
import assert from "node:assert/strict";

import { createNewSaveMeta, extractGameStateFromStoredSave, prepareGameStateForSave } from "../src/core/saveSafety.js";
import { expectedDriverSalary, reserveSeatCount } from "../src/domain/driverContracts.js";
import {
  acceptCounterOffer,
  availableContractRoles,
  driverNegotiations,
  isNegotiationActive,
  processDriverNegotiations,
  startDriverNegotiation,
  withdrawNegotiation,
} from "../src/engine/NegotiationEngine.js";

function fixture(seed="contract-negotiations"){
  return {
    saveMeta:createNewSaveMeta({year:1980,teamId:"T1",seed}),
    activeYear:1980,
    currentDateISO:"1980-02-01",
    team:{team_id:"T1",team_name:"Player Team"},
    teams:[
      {team_id:"T1",team_name:"Player Team"},
      {team_id:"T2",team_name:"AI Team"},
    ],
    drivers:[
      {driver_id:"P1",display_name:"Player One",status:"eligible",canHireF1:true},
      {driver_id:"P2",display_name:"Player Two",status:"eligible",canHireF1:true},
      {driver_id:"A1",display_name:"AI One",status:"eligible",canHireF1:true},
      {driver_id:"A2",display_name:"AI Two",status:"eligible",canHireF1:true},
      {driver_id:"F1",display_name:"Free Driver",status:"eligible",canHireF1:true},
      {driver_id:"F2",display_name:"Free Two",status:"eligible",canHireF1:true},
    ],
    driverRatings:[
      {driver_id:"P1",current_ability:75,reputation:70},
      {driver_id:"P2",current_ability:73,reputation:67},
      {driver_id:"A1",current_ability:70,reputation:62},
      {driver_id:"A2",current_ability:68,reputation:60},
      {driver_id:"F1",current_ability:72,pace:73,consistency:70,reputation:65,market_value:700_000},
      {driver_id:"F2",current_ability:64,pace:65,reputation:52,market_value:300_000},
    ],
    driverCareer:[],
    contracts:[
      {year:1980,team_id:"T1",driver_id:"P1",role:"Main Driver",status:"active"},
      {year:1980,team_id:"T1",driver_id:"P2",role:"Second Driver",status:"active"},
      {year:1980,team_id:"T2",driver_id:"A1",role:"Main Driver",status:"active"},
      {year:1980,team_id:"T2",driver_id:"A2",role:"Second Driver",status:"active"},
    ],
    driverNegotiations:[],
    inbox:[],
  };
}

function playerOffer(gs,{driverId="F1",salary=null,years=1,role="Reserve Driver"}={}){
  const expected=expectedDriverSalary(gs,driverId);
  return startDriverNegotiation(gs,{
    driverId,
    teamId:"T1",
    teamName:"Player Team",
    offer:{salary:salary??expected,years,role},
    origin:"player",
  });
}

test("player contract offer remains pending until its response date",()=>{
  const gs=fixture();
  const next=playerOffer(gs);
  const negotiation=next.driverNegotiations[0];

  assert.equal(next.contracts.length,4,"submitting an offer must not sign a contract immediately");
  assert.equal(negotiation.status,"submitted");
  assert.equal(negotiation.offer.role,"Reserve Driver");
  assert.ok(negotiation.response_date>"1980-02-01");
  assert.equal(reserveSeatCount(next,"T1"),0);
  assert.ok(next.inbox.some((m)=>/Contract offer submitted/.test(String(m.subject||""))));
  assert.equal(availableContractRoles(next,"T1").includes("Reserve Driver"),false,"pending reserve offer occupies the negotiation slot");
});

test("driver can counter and player can accept the counter-offer",()=>{
  const submitted=playerOffer(fixture("counter-flow"));
  const negotiation=submitted.driverNegotiations[0];
  const due={...submitted,currentDateISO:negotiation.response_date};

  const countered=processDriverNegotiations(due,{
    forceOutcomeById:{[negotiation.id]:"countered"},
  });
  const counter=driverNegotiations(countered).find((n)=>n.id===negotiation.id);

  assert.equal(counter.status,"countered");
  assert.ok(counter.counter_offer.salary>=counter.offer.salary);
  assert.equal(reserveSeatCount(countered,"T1"),0);
  assert.ok(countered.inbox.some((m)=>/Counter-offer/.test(String(m.subject||""))));

  const accepted=acceptCounterOffer(countered,negotiation.id);
  const final=driverNegotiations(accepted).find((n)=>n.id===negotiation.id);
  const contract=accepted.contracts.find((c)=>c.negotiation_id===negotiation.id);

  assert.equal(final.status,"accepted");
  assert.ok(contract);
  assert.equal(contract.role,"Reserve Driver");
  assert.equal(contract.salary,counter.counter_offer.salary);
  assert.equal(contract.source,"player_negotiation");
  assert.equal(reserveSeatCount(accepted,"T1"),1);
});

test("rejected offer creates no contract and informs the player",()=>{
  const submitted=playerOffer(fixture("reject-flow"),{salary:150_000});
  const negotiation=submitted.driverNegotiations[0];
  const due={...submitted,currentDateISO:negotiation.response_date};

  const rejected=processDriverNegotiations(due,{
    forceOutcomeById:{[negotiation.id]:"rejected"},
  });
  const final=driverNegotiations(rejected).find((n)=>n.id===negotiation.id);

  assert.equal(final.status,"rejected");
  assert.equal(reserveSeatCount(rejected,"T1"),0);
  assert.equal(rejected.contracts.some((c)=>c.negotiation_id===negotiation.id),false);
  assert.ok(rejected.inbox.some((m)=>/Offer rejected/.test(String(m.subject||""))));
});

test("stronger competing offer can win the same driver and close the losing negotiation",()=>{
  let gs=fixture("competition-flow");
  const expected=expectedDriverSalary(gs,"F1");

  gs=startDriverNegotiation(gs,{
    driverId:"F1",
    teamId:"T1",
    teamName:"Player Team",
    offer:{salary:expected*0.90,years:1,role:"Reserve Driver"},
    origin:"player",
  });
  const player=gs.driverNegotiations.find((n)=>n.origin==="player");

  gs=startDriverNegotiation(gs,{
    driverId:"F1",
    teamId:"T2",
    teamName:"AI Team",
    offer:{salary:expected*1.20,years:2,role:"Reserve Driver"},
    origin:"ai",
  });
  const ai=gs.driverNegotiations.find((n)=>n.origin==="ai");
  assert.ok(player&&ai);

  const responseDate=[player.response_date,ai.response_date].sort().at(-1);
  const resolved=processDriverNegotiations({...gs,currentDateISO:responseDate},{
    forceOutcomeById:{[player.id]:"accepted",[ai.id]:"accepted"},
  });

  const contract=resolved.contracts.find((c)=>String(c.driver_id)==="F1");
  assert.ok(contract);
  assert.equal(contract.team_id,"T2","higher-quality AI offer should resolve first");
  const playerFinal=resolved.driverNegotiations.find((n)=>n.id===player.id);
  const aiFinal=resolved.driverNegotiations.find((n)=>n.id===ai.id);
  assert.equal(aiFinal.status,"accepted");
  assert.equal(playerFinal.status,"signed_elsewhere");
  assert.ok(resolved.inbox.some((m)=>/Negotiation ended/.test(String(m.subject||""))));
});

test("withdrawn negotiation frees the role for another approach",()=>{
  const submitted=playerOffer(fixture("withdraw-flow"));
  const negotiation=submitted.driverNegotiations[0];
  assert.equal(availableContractRoles(submitted,"T1").includes("Reserve Driver"),false);

  const withdrawn=withdrawNegotiation(submitted,negotiation.id);
  assert.equal(withdrawn.driverNegotiations[0].status,"withdrawn");
  assert.equal(availableContractRoles(withdrawn,"T1").includes("Reserve Driver"),true);
});

test("negotiations survive save and load round-trip",()=>{
  const submitted=playerOffer(fixture("save-flow"),{driverId:"F2",years:2});
  const saved=prepareGameStateForSave(submitted);
  const loaded=extractGameStateFromStoredSave({meta:{name:"Negotiation save"},gameState:saved});

  assert.deepEqual(loaded.driverNegotiations,submitted.driverNegotiations);
  assert.equal(loaded.contracts.some((c)=>String(c.driver_id)==="F2"),false);
});

test("same save seed produces the same negotiation response timing",()=>{
  const first=playerOffer(fixture("same-seed"));
  const second=playerOffer(fixture("same-seed"));
  assert.deepEqual(first.driverNegotiations,second.driverNegotiations);
});
