import test from "node:test";
import assert from "node:assert/strict";
import {
  driverRelationship,
  relationshipKey,
  synchronizeDriverRelationships,
} from "../src/domain/driverRelationships.js";
import { applyRaceTeammateDynamics } from "../src/domain/driverTeammateDynamics.js";

function fixture(){
  return {
    activeYear:1980,
    currentDateISO:"1980-01-01",
    team:{team_id:"T1",team_name:"Player"},
    contracts:[
      {year:1980,team_id:"T1",driver_id:"D1",role:"Main Driver",status:"active"},
      {year:1980,team_id:"T1",driver_id:"D2",role:"Second Driver",status:"active"},
      {year:1980,team_id:"T1",driver_id:"D3",role:"Reserve Driver",status:"active"},
      {year:1980,team_id:"T2",driver_id:"D4",role:"Main Driver",status:"active"},
      {year:1980,team_id:"T2",driver_id:"D5",role:"Second Driver",status:"active"},
    ],
    staffContracts:[
      {year:1980,team_id:"T1",staff_id:"P1",role:"team_principal",status:"active"},
      {year:1980,team_id:"T1",staff_id:"E1",role:"race_engineer",status:"active"},
      {year:1980,team_id:"T2",staff_id:"P2",role:"team_principal",status:"active"},
    ],
  };
}

test("D6.3A seeds neutral team, teammate, manager and staff relationships",()=>{
  const next=synchronizeDriverRelationships(fixture(),{source:"test_seed"});

  const team=driverRelationship(next,"D1","team","T1");
  assert.equal(team.trust,50);
  assert.equal(team.respect,50);
  assert.equal(team.affinity,50);
  assert.equal(team.satisfaction,50);
  assert.equal(team.status,"neutral");
  assert.equal(team.active,true);
  assert.equal(team.expected_role,"Main Driver");
  assert.equal(team.current_role,"Main Driver");

  assert.ok(driverRelationship(next,"D1","teammate","D2"));
  assert.ok(driverRelationship(next,"D2","teammate","D1"));
  assert.equal(driverRelationship(next,"D1","teammate","D3"),null);

  assert.ok(driverRelationship(next,"D1","manager","player_manager"));
  assert.equal(driverRelationship(next,"D1","manager","player_manager").expected_role,"Main Driver");
  assert.equal(driverRelationship(next,"D4","manager","player_manager"),null);

  assert.ok(driverRelationship(next,"D1","team_principal","P1"));
  assert.ok(driverRelationship(next,"D1","race_engineer","E1"));
  assert.ok(driverRelationship(next,"D4","team_principal","P2"));
});

test("D6.3A backfill preserves evolved relationships and only adds missing records",()=>{
  const base=fixture();
  const seeded=synchronizeDriverRelationships(base);
  const key=relationshipKey("D1","team","T1");
  const evolved={
    ...seeded,
    driverRelationships:{
      ...seeded.driverRelationships,
      relations:{
        ...seeded.driverRelationships.relations,
        [key]:{
          ...seeded.driverRelationships.relations[key],
          trust:73,
          affinity:64,
          source:"gameplay_event",
        },
      },
    },
  };

  evolved.staffContracts=[
    ...evolved.staffContracts,
    {year:1980,team_id:"T1",staff_id:"E2",role:"race_engineer",status:"active"},
  ];
  const synced=synchronizeDriverRelationships(evolved,{source:"backfill"});

  assert.equal(synced.driverRelationships.relations[key].trust,73);
  assert.equal(synced.driverRelationships.relations[key].affinity,64);
  assert.equal(synced.driverRelationships.relations[key].source,"gameplay_event");
  assert.ok(driverRelationship(synced,"D1","race_engineer","E1")?.active);
  assert.ok(driverRelationship(synced,"D2","race_engineer","E2")?.active);
  assert.equal(driverRelationship(synced,"D2","race_engineer","E1")?.active,false);
});

test("D6.3A keeps former team and teammate links as inactive history",()=>{
  const seeded=synchronizeDriverRelationships(fixture());
  const moved={
    ...seeded,
    contracts:seeded.contracts.map((row)=>{
      if(row.driver_id==="D1")return {...row,team_id:"T2"};
      if(row.driver_id==="D4")return {...row,status:"released"};
      return row;
    }),
  };
  const synced=synchronizeDriverRelationships(moved,{source:"transfer_sync"});

  assert.equal(driverRelationship(synced,"D1","team","T1").active,false);
  assert.equal(driverRelationship(synced,"D1","teammate","D2").active,false);
  assert.equal(driverRelationship(synced,"D1","team","T2").active,true);
  assert.equal(driverRelationship(synced,"D1","teammate","D5").active,true);
});

test("D6.3A supports Create Team selected drivers before canonical contracts exist",()=>{
  const state={
    activeYear:1980,
    currentDateISO:"1980-01-01",
    team:{team_id:"CUSTOM"},
    selectedDrivers:[{driver_id:"D7"},{driver_id:"D8"}],
    contracts:[],
    staffContracts:[],
  };
  const next=synchronizeDriverRelationships(state);
  assert.ok(driverRelationship(next,"D7","team","CUSTOM"));
  assert.ok(driverRelationship(next,"D8","manager","player_manager"));
});

test("D6.3A leaves unrelated legacy state unchanged when nothing can be seeded",()=>{
  const legacy={
    activeYear:1980,
    currentDateISO:"1980-05-18",
    currentRound:5,
    team:{team_id:"T1"},
    contracts:[],
    staffContracts:[],
  };
  const synced=synchronizeDriverRelationships(legacy,{source:"legacy_backfill"});
  assert.equal(synced,legacy);
  assert.equal(Object.prototype.hasOwnProperty.call(synced,"driverRelationships"),false);
});


test("D6.3B race and qualifying comparisons build teammate rivalry gradually",()=>{
  let gs=synchronizeDriverRelationships(fixture());
  const result={
    gp_id:"GP1",round:1,
    qualifying:[
      {driver_id:"D1",team_id:"T1",position:2},
      {driver_id:"D2",team_id:"T1",position:1},
    ],
    classification:[
      {driver_id:"D1",team_id:"T1",position:1,status:"Finished",retired:false},
      {driver_id:"D2",team_id:"T1",position:3,status:"Finished",retired:false},
    ],
  };
  gs=applyRaceTeammateDynamics(gs,result);
  const d1=driverRelationship(gs,"D1","teammate","D2");
  const d2=driverRelationship(gs,"D2","teammate","D1");
  assert.ok(d1.rivalry>0);
  assert.ok(d2.rivalry>d1.rivalry,"losing to a team-mate should create slightly more competitive pressure");
  assert.ok(d1.satisfaction>50);
  assert.ok(d2.satisfaction<50);
  assert.ok(gs.driverRelationships.log.some((entry)=>entry.source==="teammate_race"));
});

test("D6.3B mechanical DNF does not count as a sporting teammate defeat",()=>{
  let gs=synchronizeDriverRelationships(fixture());
  const before=structuredClone(driverRelationship(gs,"D1","teammate","D2"));
  gs=applyRaceTeammateDynamics(gs,{
    gp_id:"GP2",round:2,qualifying:[],
    classification:[
      {driver_id:"D1",team_id:"T1",position:20,status:"DNF",retired:true,retirement_reason:"Engine"},
      {driver_id:"D2",team_id:"T1",position:2,status:"Finished",retired:false},
    ],
  });
  const after=driverRelationship(gs,"D1","teammate","D2");
  assert.equal(after.satisfaction,before.satisfaction);
  assert.equal(after.rivalry,before.rivalry);
});

test("D6.3B teammate collision strongly damages trust and raises rivalry",()=>{
  let gs=synchronizeDriverRelationships(fixture());
  gs=applyRaceTeammateDynamics(gs,{
    gp_id:"GP3",round:3,qualifying:[],
    classification:[
      {driver_id:"D1",team_id:"T1",position:18,status:"DNF",retired:true,retirement_reason:"Collision",incident_with_driver_id:"D2"},
      {driver_id:"D2",team_id:"T1",position:6,status:"Finished",retired:false},
    ],
  });
  const d1=driverRelationship(gs,"D1","teammate","D2");
  const d2=driverRelationship(gs,"D2","teammate","D1");
  assert.equal(d1.trust,44);
  assert.equal(d2.trust,44);
  assert.equal(d1.rivalry,8);
  assert.equal(d2.rivalry,8);
});

test("D6.3B completed let-through orders are recorded as teammate dynamics",()=>{
  let gs=synchronizeDriverRelationships(fixture());
  gs=applyRaceTeammateDynamics(gs,{
    gp_id:"GP4",round:4,qualifying:[],
    raceStrategy:{
      strategies:{
        D1:{strategy_decisions:[{lap:12,action:"team_order",order:"yield",teammate_id:"D2"}]},
      },
    },
    classification:[
      {driver_id:"D1",team_id:"T1",position:4,status:"Finished",retired:false},
      {driver_id:"D2",team_id:"T1",position:3,status:"Finished",retired:false},
    ],
  });
  const yielding=driverRelationship(gs,"D1","teammate","D2");
  const beneficiary=driverRelationship(gs,"D2","teammate","D1");
  assert.ok(yielding.satisfaction<49);
  assert.ok(beneficiary.respect>51);
  assert.ok(gs.driverRelationships.log.some((entry)=>entry.source==="team_order_yield"));
});
