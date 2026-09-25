import test from "node:test";
import assert from "node:assert/strict";
import {
  driverRaceEngineerAssignment,
  raceEngineerAssignmentStatus,
  synchronizeDriverStaffAssignments,
} from "../src/domain/driverStaffAssignments.js";
import { driverRelationship, synchronizeDriverRelationships } from "../src/domain/driverRelationships.js";

function fixture({engineers=1}={}){
  const staffCore=[
    {staff_id:"P1",staff_name:"Principal",role_primary:"team_principal"},
    {staff_id:"E1",staff_name:"Engineer One",role_primary:"race_engineer"},
    {staff_id:"E2",staff_name:"Engineer Two",role_primary:"race_engineer"},
  ];
  const staffContracts=[
    {year:2000,team_id:"T1",staff_id:"P1",staff_name:"Principal",role:"team_principal",status:"active"},
  ];
  if(engineers>=1)staffContracts.push({year:2000,team_id:"T1",staff_id:"E1",staff_name:"Engineer One",role:"race_engineer",status:"active"});
  if(engineers>=2)staffContracts.push({year:2000,team_id:"T1",staff_id:"E2",staff_name:"Engineer Two",role:"race_engineer",status:"active"});
  return {
    activeYear:2000,
    currentDateISO:"2000-03-01",
    team:{team_id:"T1",team_name:"Player"},
    contracts:[
      {year:2000,team_id:"T1",driver_id:"D1",role:"Main Driver",status:"active"},
      {year:2000,team_id:"T1",driver_id:"D2",role:"Second Driver",status:"active"},
    ],
    staffCore,
    staffContracts,
  };
}

test("D6.3D shares one recorded Race Engineer across both race drivers when necessary",()=>{
  const next=synchronizeDriverStaffAssignments(fixture({engineers:1}));
  const d1=driverRaceEngineerAssignment(next,"D1");
  const d2=driverRaceEngineerAssignment(next,"D2");
  assert.equal(d1.staff_id,"E1");
  assert.equal(d2.staff_id,"E1");
  assert.equal(d1.assignment_mode,"shared");
  assert.equal(d2.assignment_mode,"shared");
  assert.equal(raceEngineerAssignmentStatus(next,"T1").status,"covered");
});

test("D6.3D rebalances shared assignments when a second engineer becomes available",()=>{
  const shared=synchronizeDriverStaffAssignments(fixture({engineers:1}));
  const expanded={
    ...shared,
    staffContracts:[
      ...shared.staffContracts,
      {year:2000,team_id:"T1",staff_id:"E2",staff_name:"Engineer Two",role:"race_engineer",status:"active"},
    ],
  };
  const next=synchronizeDriverStaffAssignments(expanded);
  const d1=driverRaceEngineerAssignment(next,"D1");
  const d2=driverRaceEngineerAssignment(next,"D2");
  assert.equal(d1.assignment_mode,"dedicated");
  assert.equal(d2.assignment_mode,"dedicated");
  assert.notEqual(d1.staff_id,d2.staff_id);
  assert.deepEqual(new Set([d1.staff_id,d2.staff_id]),new Set(["E1","E2"]));
});

test("D6.3D never invents a Race Engineer when the era data records none",()=>{
  const gs=fixture({engineers:0});
  const next=synchronizeDriverStaffAssignments(gs);
  assert.equal(next,gs);
  assert.equal(driverRaceEngineerAssignment(next,"D1"),null);
  assert.equal(raceEngineerAssignmentStatus(next,"T1").status,"not_recorded");

  const relationships=synchronizeDriverRelationships(gs);
  assert.equal(
    Object.values(relationships.driverRelationships.relations).some((row)=>row.target_type==="race_engineer"),
    false
  );
});

test("D6.3D Race Engineer relationships follow explicit driver assignments",()=>{
  const next=synchronizeDriverRelationships(fixture({engineers:2}));
  const d1Assignment=driverRaceEngineerAssignment(next,"D1");
  const d2Assignment=driverRaceEngineerAssignment(next,"D2");

  assert.equal(d1Assignment.staff_id,"E1");
  assert.equal(d2Assignment.staff_id,"E2");
  assert.ok(driverRelationship(next,"D1","race_engineer","E1"));
  assert.equal(driverRelationship(next,"D1","race_engineer","E2"),null);
  assert.ok(driverRelationship(next,"D2","race_engineer","E2"));
  assert.equal(driverRelationship(next,"D2","race_engineer","E1"),null);
  assert.ok(driverRelationship(next,"D1","team_principal","P1"));
});
