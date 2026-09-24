import test from "node:test";
import assert from "node:assert/strict";
import {
  driverRelationship,
  relationshipKey,
  synchronizeDriverRelationships,
} from "../src/domain/driverRelationships.js";

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

  assert.ok(driverRelationship(next,"D1","teammate","D2"));
  assert.ok(driverRelationship(next,"D2","teammate","D1"));
  assert.equal(driverRelationship(next,"D1","teammate","D3"),null);

  assert.ok(driverRelationship(next,"D1","manager","player_manager"));
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
  assert.ok(driverRelationship(synced,"D1","race_engineer","E2"));
  assert.ok(driverRelationship(synced,"D2","race_engineer","E2"));
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
