import test from "node:test";
import assert from "node:assert/strict";

import {
  activeDriverContracts,
  changeDriverContractRole,
  driverLineupSlots,
  swapRaceDriverRoles,
} from "../src/domain/driverContracts.js";
import { contractRoleLabel, driverRoleSlot } from "../src/domain/contractRoles.js";
import { driverRelationship } from "../src/domain/driverRelationships.js";

function fixture(){
  return {
    activeYear:1981,
    currentDateISO:"1981-03-15",
    team:{team_id:"T1",team_name:"Player Team"},
    contracts:[
      {year:1981,team_id:"T1",driver_id:"D1",driver_name:"Main One",role:"Main Driver",status:"active",contract_until_year:1982},
      {year:1981,team_id:"T1",driver_id:"D2",driver_name:"Second Two",role:"Second Driver",status:"active",contract_until_year:1982},
      {year:1981,team_id:"T1",driver_id:"D3",driver_name:"Reserve Three",role:"Reserve Driver",status:"active",contract_until_year:1982},
      {year:1981,team_id:"T1",driver_id:"D4",driver_name:"Test Four",role:"Test Driver",status:"active",contract_until_year:1982},
    ],
    dbContracts:[
      {year:1981,team_id:"T1",driver_id:"OLD",driver_name:"Historical Driver",role:"Main Driver",status:"active"},
    ],
    driverAttributes:{
      D1:{morale:50,confidence:50,fatigue:0,preparation:50},
      D2:{morale:50,confidence:50,fatigue:0,preparation:50},
      D3:{morale:50,confidence:50,fatigue:0,preparation:50},
      D4:{morale:50,confidence:50,fatigue:0,preparation:50},
    },
    driverRatings:[
      {driver_id:"D1",reputation:70},
      {driver_id:"D2",reputation:68},
      {driver_id:"D3",reputation:60},
      {driver_id:"D4",reputation:55},
    ],
  };
}

function roleOf(gs,driverId){
  return gs.contracts.find((row)=>row.driver_id===driverId)?.role;
}

test("live contracts remain authoritative over historical seed rows",()=>{
  const gs=fixture();
  const active=activeDriverContracts(gs,{teamId:"T1"});
  assert.deepEqual(active.map((row)=>row.driver_id),["D1","D2","D3","D4"]);

  const withExplicitEmptyLive={...gs,contracts:[]};
  assert.deepEqual(activeDriverContracts(withExplicitEmptyLive,{teamId:"T1"}),[]);
});

test("lineup resolves explicit Main, Second, Reserve and Test slots",()=>{
  const lineup=driverLineupSlots(fixture(),"T1");
  assert.equal(lineup.main.driver_id,"D1");
  assert.equal(lineup.second.driver_id,"D2");
  assert.equal(lineup.reserve.driver_id,"D3");
  assert.equal(lineup.test.driver_id,"D4");
});

test("generic historical race-driver roles fill both race seats without using standings",()=>{
  const gs=fixture();
  gs.contracts=[
    {...gs.contracts[0],driver_id:"G1",role:"Driver"},
    {...gs.contracts[1],driver_id:"G2",role:"Race Driver"},
    gs.contracts[2],
    gs.contracts[3],
  ];
  const lineup=driverLineupSlots(gs,"T1");
  assert.equal(lineup.main.driver_id,"G1");
  assert.equal(lineup.second.driver_id,"G2");
  assert.equal(contractRoleLabel({role:"Driver"}),"Race Driver");
});

test("promoting Test Driver into occupied Second seat swaps atomically",()=>{
  const gs=fixture();
  const next=changeDriverContractRole(gs,{
    driverId:"D4",
    targetRole:"Second Driver",
    teamId:"T1",
    swapIfOccupied:true,
  });

  assert.equal(roleOf(next,"D4"),"Second Driver");
  assert.equal(roleOf(next,"D2"),"Test Driver");

  const lineup=driverLineupSlots(next,"T1");
  assert.equal(lineup.second.driver_id,"D4");
  assert.equal(lineup.test.driver_id,"D2");

  assert.equal(next.driverAttributes.D4.morale,53);
  assert.equal(next.driverAttributes.D4.confidence,52);
  assert.equal(next.driverRatings.find((r)=>r.driver_id==="D4").reputation,56);

  assert.equal(next.driverAttributes.D2.morale,45);
  assert.equal(next.driverAttributes.D2.confidence,47);
  assert.equal(next.driverRatings.find((r)=>r.driver_id==="D2").reputation,68);

  assert.equal(gs.driverAttributes.D4.morale,50,"input state must stay immutable");
  assert.equal(next.driverRelationships.relations["D1|teammate|D4"].active,true);
  assert.equal(next.driverRelationships.relations["D4|teammate|D1"].active,true);
  assert.equal(next.driverRelationships.relations["D4|teammate|D2"].active,false);
  assert.ok(next.driverRelationships.relations["D4|teammate|D2"].rivalry>0);
  assert.ok(driverRelationship(next,"D4","team","T1").satisfaction>50);
  assert.ok(driverRelationship(next,"D4","manager","player_manager").satisfaction>50);
  assert.ok(driverRelationship(next,"D2","team","T1").satisfaction<50);
  assert.equal(driverRelationship(next,"D4","team","T1").current_role,"Second Driver");
});

test("promotion into a vacant race seat changes role without terminating the contract",()=>{
  const gs=fixture();
  gs.contracts=gs.contracts.filter((row)=>row.driver_id!=="D2");

  const next=changeDriverContractRole(gs,{
    driverId:"D3",
    targetRole:"Second Driver",
    teamId:"T1",
  });

  const contract=next.contracts.find((row)=>row.driver_id==="D3");
  assert.equal(contract.role,"Second Driver");
  assert.equal(contract.status,"active");
  assert.equal(contract.role_changed_from,"Reserve Driver");
  assert.equal(contract.role_changed_at,"1981-03-15");
  assert.equal(next.driverAttributes.D3.morale,53);
  assert.equal(next.driverAttributes.D3.confidence,52);
  assert.equal(next.driverRelationships.relations["D1|teammate|D3"].active,true);
  assert.equal(next.driverRelationships.relations["D3|teammate|D1"].active,true);
});

test("occupied target can be rejected when swap is disabled",()=>{
  const gs=fixture();
  const next=changeDriverContractRole(gs,{
    driverId:"D4",
    targetRole:"Main Driver",
    teamId:"T1",
    swapIfOccupied:false,
  });
  assert.strictEqual(next,gs);
});

test("Swap race drivers changes Main and Second safely in live state",()=>{
  const gs=fixture();
  const next=swapRaceDriverRoles(gs,{teamId:"T1"});

  assert.equal(roleOf(next,"D1"),"Second Driver");
  assert.equal(roleOf(next,"D2"),"Main Driver");
  assert.equal(driverRoleSlot(roleOf(next,"D1")),"second");
  assert.equal(driverRoleSlot(roleOf(next,"D2")),"main");

  assert.equal(next.driverAttributes.D1.morale,47);
  assert.equal(next.driverAttributes.D1.confidence,48);
  assert.equal(next.driverAttributes.D2.morale,52);
  assert.equal(next.driverAttributes.D2.confidence,52);
  assert.ok(next.driverRelationships?.relations?.["D1|teammate|D2"]?.rivalry>0);
  assert.ok(next.driverRelationships?.relations?.["D2|teammate|D1"]?.rivalry>0);
});

test("role changes cannot mutate another team's contract",()=>{
  const gs=fixture();
  gs.contracts.push({
    year:1981,team_id:"T2",driver_id:"X1",role:"Test Driver",status:"active",contract_until_year:1982,
  });
  const next=changeDriverContractRole(gs,{
    driverId:"X1",
    targetRole:"Main Driver",
    teamId:"T1",
  });
  assert.strictEqual(next,gs);
});
