import test from "node:test";
import assert from "node:assert/strict";

import { createNewSaveMeta, extractGameStateFromStoredSave, prepareGameStateForSave } from "../src/core/saveSafety.js";
import {
  activeDriverContract,
  contractEndYear,
  expectedDriverSalary,
  releaseDriverContract,
  reserveSeatCount,
  terminationCost,
} from "../src/domain/driverContracts.js";
import { effectiveContractRule } from "../src/domain/driverTransfers.js";
import {
  acceptCounterOffer,
  acceptTransferCounter,
  availableContractRoles,
  driverNegotiationEligibility,
  driverNegotiations,
  driverTransferApproaches,
  isNegotiationActive,
  isNegotiationClosed,
  negotiationStatusBuckets,
  processDriverNegotiations,
  startDriverNegotiation,
  startDriverRenewal,
  withdrawNegotiation,
} from "../src/engine/NegotiationEngine.js";

function fixture(seed="contract-negotiations"){
  return {
    saveMeta:createNewSaveMeta({year:1980,teamId:"T1",seed}),
    activeYear:1980,
    currentDateISO:"1980-02-01",
    team:{team_id:"T1",team_name:"Player Team",budget:2_000_000},
    finances:{budget:2_000_000,balance:2_000_000,season_spend:0,season_income:0},
    financeLog:[],
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
      {year:1980,team_id:"T1",driver_id:"P1",driver_name:"Player One",role:"Main Driver",salary:700_000,contract_start_year:1979,contract_until_year:1980,status:"active"},
      {year:1980,team_id:"T1",driver_id:"P2",driver_name:"Player Two",role:"Second Driver",salary:600_000,contract_start_year:1980,contract_until_year:1981,status:"active"},
      {year:1980,team_id:"T2",driver_id:"A1",driver_name:"AI One",role:"Main Driver",salary:500_000,contract_start_year:1979,contract_until_year:1980,status:"active"},
      {year:1980,team_id:"T2",driver_id:"A2",driver_name:"AI Two",role:"Second Driver",salary:450_000,contract_start_year:1980,contract_until_year:1980,status:"active"},
    ],
    dbContractRules:[{
      year_from:1979,
      year_to:1985,
      buyout_allowed:"TRUE",
      clauses:{buyout_fee_min:50_000,buyout_fee_max:500_000},
    }],
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


test("player can negotiate a renewal with a currently contracted driver",()=>{
  const gs=fixture("renewal-flow");
  const expected=expectedDriverSalary(gs,"P1");
  const submitted=startDriverRenewal(gs,{
    driverId:"P1",
    teamId:"T1",
    teamName:"Player Team",
    offer:{salary:expected+50_000,years:2,role:"Main Driver"},
    origin:"player",
  });
  const negotiation=submitted.driverNegotiations.find((n)=>n.kind==="renewal");
  assert.ok(negotiation);
  assert.equal(negotiation.status,"submitted");
  assert.equal(submitted.contracts.length,4,"renewal must not create a duplicate contract while pending");

  const resolved=processDriverNegotiations(
    {...submitted,currentDateISO:negotiation.response_date},
    {forceOutcomeById:{[negotiation.id]:"accepted"}}
  );
  const contract=activeDriverContract(resolved,"P1");
  assert.ok(contract);
  assert.equal(contractEndYear(contract,1980),1982);
  assert.equal(contract.salary,expected+50_000);
  assert.equal(contract.renewal_source,"player_renewal");
  assert.equal(resolved.contracts.length,4,"accepted renewal should extend the existing contract");
  assert.ok(resolved.inbox.some((m)=>/renews with Player Team/.test(String(m.subject||""))));
});

test("player can release a driver and immediately open the seat for hiring",()=>{
  const gs=fixture("release-flow");
  const contract=activeDriverContract(gs,"P1");
  const cost=terminationCost(gs,contract);
  assert.equal(cost,315_000);

  const released=releaseDriverContract(gs,"P1");
  const old= released.contracts.find((c)=>c.driver_id==="P1");
  assert.equal(old.status,"released");
  assert.equal(activeDriverContract(released,"P1"),null);
  assert.equal(released.finances.balance,2_000_000-cost);
  assert.equal(released.team.budget,2_000_000-cost);
  assert.ok(released.financeLog.some((tx)=>tx.amount===-cost));
  assert.equal(availableContractRoles(released,"T1").includes("Main Driver"),true);
});

test("release is idempotent and cannot charge termination twice",()=>{
  const first=releaseDriverContract(fixture("release-idempotent"),"P1");
  const second=releaseDriverContract(first,"P1");
  assert.equal(second.finances.balance,first.finances.balance);
  assert.equal(second.financeLog.length,first.financeLog.length);
});


test("negotiation eligibility exposes a real offer path only for available drivers",()=>{
  const gs=fixture("eligibility-free");
  const free=driverNegotiationEligibility(gs,{driverId:"F1",teamId:"T1"});
  assert.equal(free.canNegotiate,true);
  assert.equal(free.reason,"available");
  assert.ok(free.roles.includes("Reserve Driver"));
  assert.ok(free.roles.includes("Test Driver"));
});

test("contracted rival without a release clause requires club approval before personal terms",()=>{
  const gs=fixture("eligibility-contracted");
  const rival=driverNegotiationEligibility(gs,{driverId:"A1",teamId:"T1"});
  assert.equal(rival.canNegotiate,true);
  assert.equal(rival.reason,"transfer_available");
  assert.equal(rival.kind,"transfer");
  assert.equal(rival.contract?.team_id,"T2");
  assert.equal(rival.buyout?.allowed,true);
  assert.equal(rival.buyout?.type,"compensation");
  assert.equal(rival.buyout?.fee,325_000);
  assert.ok(rival.roles.includes("Reserve Driver"));

  const submitted=startDriverNegotiation(gs,{
    driverId:"A1",
    teamId:"T1",
    teamName:"Player Team",
    offer:{salary:1_000_000,years:2,role:"Reserve Driver"},
    origin:"player",
  });
  const approach=driverTransferApproaches(submitted)[0];
  assert.ok(approach);
  assert.equal(approach.status,"submitted");
  assert.equal(approach.seller_team_id,"T2");
  assert.equal(approach.offer_fee,325_000);
  assert.equal(driverNegotiations(submitted).length,0,"personal terms must wait for seller approval");

  const clubApproved=processDriverNegotiations(
    {...submitted,currentDateISO:approach.response_date},
    {forceTransferOutcomeById:{[approach.id]:"accepted"}}
  );
  const negotiation=driverNegotiations(clubApproved).find((n)=>n.kind==="transfer");
  assert.ok(negotiation,"seller approval should open personal terms");
  assert.equal(negotiation.seller_team_id,"T2");
  assert.equal(negotiation.buyout_fee,325_000);
  assert.equal(negotiation.buyout_type,"negotiated_club_fee");

  const resolved=processDriverNegotiations(
    {...clubApproved,currentDateISO:negotiation.response_date},
    {forceOutcomeById:{[negotiation.id]:"accepted"}}
  );

  const oldContract=resolved.contracts.find((row)=>
    row.driver_id==="A1"&&row.team_id==="T2"
  );
  const newContract=activeDriverContract(resolved,"A1");
  assert.equal(oldContract.status,"bought_out");
  assert.equal(newContract.team_id,"T1");
  assert.equal(newContract.role,"Reserve Driver");
  assert.equal(newContract.source,"player_transfer");
  assert.equal(newContract.buyout_fee,325_000);
  assert.equal(resolved.finances.balance,1_675_000);
  assert.ok(resolved.financeLog.some((tx)=>
    tx.category==="Driver Transfer"&&tx.amount===-325_000
  ));
  assert.ok(resolved.inbox.some((m)=>/transfers to Player Team/.test(String(m.subject||""))));
});

test("seller can counter a transfer approach before personal negotiations start",()=>{
  const submitted=startDriverNegotiation(fixture("transfer-counter"),{
    driverId:"A1",
    teamId:"T1",
    teamName:"Player Team",
    offer:{salary:900_000,years:2,role:"Reserve Driver"},
    origin:"player",
  });
  const approach=driverTransferApproaches(submitted)[0];
  const countered=processDriverNegotiations(
    {...submitted,currentDateISO:approach.response_date},
    {forceTransferOutcomeById:{[approach.id]:"countered"}}
  );
  const counter=driverTransferApproaches(countered).find((row)=>row.id===approach.id);
  assert.equal(counter.status,"countered");
  assert.ok(counter.counter_fee>counter.offer_fee);
  assert.equal(driverNegotiations(countered).length,0);

  const accepted=acceptTransferCounter(countered,approach.id);
  const personal=driverNegotiations(accepted).find((n)=>n.kind==="transfer");
  assert.ok(personal);
  assert.equal(personal.buyout_fee,counter.counter_fee);
  assert.equal(driverTransferApproaches(accepted).find((row)=>row.id===approach.id).status,"accepted");
});

test("own contracted driver is not exposed as a new-contract target",()=>{
  const gs=fixture("eligibility-own");
  const own=driverNegotiationEligibility(gs,{driverId:"P1",teamId:"T1"});
  assert.equal(own.canNegotiate,false);
  assert.equal(own.reason,"already_contracted");
});

test("pending player offer disables duplicate Open negotiations action",()=>{
  const submitted=playerOffer(fixture("eligibility-pending"),{driverId:"F1"});
  const state=driverNegotiationEligibility(submitted,{driverId:"F1",teamId:"T1"});
  assert.equal(state.canNegotiate,false);
  assert.equal(state.reason,"active_negotiation");
  assert.ok(state.pending);
});

test("full four-role driver line-up blocks further free-agent approaches",()=>{
  const gs=fixture("eligibility-full");
  gs.contracts.push(
    {year:1980,team_id:"T1",driver_id:"R1",driver_name:"Reserve",role:"Reserve Driver",salary:150_000,status:"active"},
    {year:1980,team_id:"T1",driver_id:"T1D",driver_name:"Tester",role:"Test Driver",salary:125_000,status:"active"}
  );
  gs.drivers.push(
    {driver_id:"R1",display_name:"Reserve",status:"eligible",canHireF1:true},
    {driver_id:"T1D",display_name:"Tester",status:"eligible",canHireF1:true}
  );
  const state=driverNegotiationEligibility(gs,{driverId:"F1",teamId:"T1"});
  assert.equal(state.canNegotiate,false);
  assert.equal(state.reason,"lineup_full");
  assert.deepEqual(state.roles,[]);
});

test("too-young junior remains blocked from an F1 contract",()=>{
  const gs=fixture("eligibility-junior");
  gs.drivers.push({
    driver_id:"J1",
    display_name:"Junior",
    dob:"1964-06-01",
    status:"junior_only",
    active_lower_series:true,
    canHireF1:false,
  });
  const state=driverNegotiationEligibility(gs,{driverId:"J1",teamId:"T1"});
  assert.equal(state.canNegotiate,false);
  assert.equal(state.reason,"not_f1_eligible");
  assert.equal(state.eligibility_reason,"too_young");

  const attempted=startDriverNegotiation(gs,{
    driverId:"J1",
    teamId:"T1",
    teamName:"Player Team",
    offer:{salary:200_000,years:2,role:"Reserve Driver"},
    origin:"player",
  });
  assert.equal(attempted.driverNegotiations.length,0);
});

test("visible lower-series driver can be signed before historical F1 debut",()=>{
  const gs={...fixture("eligibility-senna"),activeYear:1981,currentDateISO:"1981-01-01"};
  gs.drivers.push({
    driver_id:"J2",
    display_name:"Future Champion",
    dob:"1960-03-21",
    f1_rookie_season:1984,
    status:"lower_series",
    active_lower_series:true,
    canHireF1:false,
  });
  const state=driverNegotiationEligibility(gs,{driverId:"J2",teamId:"T1"});
  assert.equal(state.canNegotiate,true);
  assert.equal(state.reason,"available");
  assert.ok(state.roles.includes("Reserve Driver"));

  const submitted=startDriverNegotiation(gs,{
    driverId:"J2",
    teamId:"T1",
    teamName:"Player Team",
    offer:{salary:250_000,years:2,role:"Reserve Driver"},
    origin:"player",
  });
  assert.ok(submitted.driverNegotiations.some((n)=>n.driver_id==="J2"&&n.status==="submitted"));
});


test("fixed release clause overrides calculated compensation and skips club negotiation",()=>{
  const gs=fixture("fixed-clause");
  gs.contracts=gs.contracts.map((row)=>
    row.driver_id==="A2"?{...row,release_clause:125_000}:row
  );
  const state=driverNegotiationEligibility(gs,{driverId:"A2",teamId:"T1"});
  assert.equal(state.canNegotiate,true);
  assert.equal(state.kind,"transfer");
  assert.equal(state.buyout.type,"fixed_clause");
  assert.equal(state.buyout.fee,125_000);

  const submitted=startDriverNegotiation(gs,{
    driverId:"A2",
    teamId:"T1",
    teamName:"Player Team",
    offer:{salary:800_000,years:2,role:"Reserve Driver"},
    origin:"player",
  });
  assert.equal(driverTransferApproaches(submitted).length,0);
  const personal=driverNegotiations(submitted).find((n)=>n.kind==="transfer");
  assert.ok(personal);
  assert.equal(personal.buyout_type,"fixed_clause");
  assert.equal(personal.buyout_fee,125_000);
});


test("contract rules fall back to the database after crossing into a new era",()=>{
  const gs=fixture("contract-rule-era-fallback");
  gs.activeYear=2004;
  gs.contractRules=[{
    year_from:1979,
    year_to:1985,
    buyout_allowed:"TRUE",
    clauses:{buyout_fee_min:50_000,buyout_fee_max:500_000},
    source:"stale_live_snapshot",
  }];
  gs.dbContractRules=[
    ...gs.dbContractRules,
    {
      year_from:1999,
      year_to:2009,
      buyout_allowed:"TRUE",
      clauses:{buyout_fee_min:150_000,buyout_fee_max:1_500_000},
      source:"database_2004_rule",
    },
  ];

  const rule=effectiveContractRule(gs,2004);
  assert.ok(rule);
  assert.equal(rule.source,"database_2004_rule");
  assert.equal(rule.clauses.buyout_fee_min,150_000);
});

test("matching live contract rule still takes priority over database history",()=>{
  const gs=fixture("contract-rule-live-priority");
  gs.activeYear=2004;
  gs.contractRules=[{
    year_from:2003,
    year_to:2005,
    buyout_allowed:"TRUE",
    clauses:{buyout_fee_min:175_000,buyout_fee_max:1_250_000},
    source:"live_2004_rule",
  }];
  gs.dbContractRules=[
    ...gs.dbContractRules,
    {
      year_from:1999,
      year_to:2009,
      buyout_allowed:"TRUE",
      clauses:{buyout_fee_min:150_000,buyout_fee_max:1_500_000},
      source:"database_2004_rule",
    },
  ];

  const rule=effectiveContractRule(gs,2004);
  assert.ok(rule);
  assert.equal(rule.source,"live_2004_rule");
  assert.equal(rule.clauses.buyout_fee_min,175_000);
});


test("negotiation buckets keep only submitted/countered offers active",()=>{
  const negotiations=[
    {id:"n1",status:"submitted"},
    {id:"n2",status:"countered"},
    {id:"n3",status:"accepted"},
    {id:"n4",status:"rejected"},
    {id:"n5",status:"withdrawn"},
    {id:"n6",status:"signed_elsewhere"},
  ];
  const buckets=negotiationStatusBuckets(negotiations);

  assert.deepEqual(buckets.active.map((n)=>n.id),["n1","n2"]);
  assert.deepEqual(buckets.history.map((n)=>n.id),["n3","n4","n5","n6"]);
  assert.equal(isNegotiationActive(negotiations[0]),true);
  assert.equal(isNegotiationActive(negotiations[2]),false);
  assert.equal(isNegotiationClosed(negotiations[2]),true);
  assert.equal(isNegotiationClosed(negotiations[1]),false);
});

test("unknown non-active negotiation statuses stay out of the active visual bucket",()=>{
  const buckets=negotiationStatusBuckets([
    {id:"future",status:"expired"},
    {id:"active",status:"submitted"},
  ]);
  assert.deepEqual(buckets.active.map((n)=>n.id),["active"]);
  assert.deepEqual(buckets.history.map((n)=>n.id),["future"]);
});
