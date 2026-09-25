import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalStaffRole,
  raceEngineerEraCoverage,
  resolveStaffId,
  staffRoleDepartment,
  staffRoleLabel,
} from "../src/domain/staffRoles.js";
import { teamEngineeringSupport } from "../src/engine/PracticeSetupEngine.js";
import { forecastAccuracyForTeam } from "../src/engine/WeekendWeatherEngine.js";
import { seedTechnicalKnowledge } from "../src/domain/technicalKnowledge.js";

function fixture(){
  return {
    activeYear:1980,
    contracts:[
      {year:1980,team_id:"T1",driver_id:"D1",role:"Main Driver",status:"active"},
      {year:1980,team_id:"T1",driver_id:"D2",role:"Second Driver",status:"active"},
      {year:1980,team_id:"T2",driver_id:"D3",role:"Main Driver",status:"active"},
      {year:1980,team_id:"T2",driver_id:"D4",role:"Second Driver",status:"active"},
    ],
    staffCore:[
      {staff_id:"S1",staff_name:"Pat Symonds",role_primary:"chief_engineer"},
      {staff_id:"E1",staff_name:"Engineer One",role_primary:"race_engineer"},
      {staff_id:"E2",staff_name:"Engineer Two",role_primary:"race_engineer"},
    ],
    staffContracts:[
      {year:1980,team_id:"T1",staff_id:"S1",staff_name:"Pat Symonds",role:"chief_engineer",status:"active"},
    ],
  };
}

test("D6.3D normalizes staff roles without conflating assigned and primary roles",()=>{
  assert.equal(canonicalStaffRole("Race Engineer"),"race_engineer");
  assert.equal(canonicalStaffRole("strategist"),"chief_strategist");
  assert.equal(staffRoleLabel("technical_director"),"Technical Director");
  assert.equal(staffRoleDepartment("race_engineer"),"Trackside");
  assert.equal(staffRoleDepartment("chief_designer"),"Technical");
});

test("D6.3D resolves missing contract staff IDs from canonical staff identity",()=>{
  const gs=fixture();
  assert.equal(resolveStaffId(gs,{staff_id:null,staff_name:"Pat Symonds",role:"chief_engineer"}),"S1");
  assert.equal(resolveStaffId(gs,{staff_id:"E1",staff_name:"Different Text"}),"E1");
});

test("D6.3D derives Race Engineer era coverage from recorded contracts",()=>{
  const none=fixture();
  assert.deepEqual(
    raceEngineerEraCoverage(none),
    {
      year:1980,
      status:"not_recorded",
      contract_count:0,
      team_count:2,
      teams_with_role:0,
      dedicated_role_recorded:false,
      label:"Dedicated Race Engineer role not recorded for this era",
    }
  );

  const partial={
    ...none,
    staffContracts:[
      ...none.staffContracts,
      {year:1980,team_id:"T1",staff_id:"E1",staff_name:"Engineer One",role:"race_engineer",status:"active"},
    ],
  };
  const partialCoverage=raceEngineerEraCoverage(partial);
  assert.equal(partialCoverage.status,"partial");
  assert.equal(partialCoverage.teams_with_role,1);
  assert.equal(partialCoverage.team_count,2);

  const complete={
    ...partial,
    staffContracts:[
      ...partial.staffContracts,
      {year:1980,team_id:"T2",staff_id:"E2",staff_name:"Engineer Two",role:"race_engineer",status:"active"},
    ],
  };
  const completeCoverage=raceEngineerEraCoverage(complete);
  assert.equal(completeCoverage.status,"complete");
  assert.equal(completeCoverage.teams_with_role,2);
});


test("D6.3D resolved staff identity feeds existing engineering, weather and knowledge systems",()=>{
  const gs={
    activeYear:2004,
    currentDateISO:"2004-03-01",
    team:{team_id:"T1"},
    contracts:[
      {year:2004,team_id:"T1",driver_id:"D1",role:"Main Driver",status:"active"},
      {year:2004,team_id:"T1",driver_id:"D2",role:"Second Driver",status:"active"},
    ],
    staffCore:[
      {staff_id:"S1",staff_name:"Strong Engineer",role_primary:"technical_director"},
    ],
    staffContracts:[
      {year:2004,team_id:"T1",staff_id:null,staff_name:"Strong Engineer",role:"technical_director",contract_start:2004,contract_until:2006,status:"active"},
    ],
    staffRatings:[
      {year:2004,staff_id:"S1",technical:90,data_analysis:90,communication:90,reliability_focus:90,innovation:90},
    ],
    facilities:[{year:2004,team_id:"T1",pitcrew_training_level:5,aero_dept_level:5,wind_tunnel_level:5,_chassis_shop_level:5,manufacturing_leve:5}],
    carStats:[{year:2004,team_id:"T1",aero_spec:60,chassis_spec:60,suspension_spec:60,brakes_spec:60,gearbox_spec:60,reliability:0.7}],
    development:{projects:[]},
    hq:{facilityLevels:{}},
  };

  assert.ok(teamEngineeringSupport(gs,"T1")>80);
  assert.ok(forecastAccuracyForTeam(gs,"T1")>0.75);
  const knowledge=seedTechnicalKnowledge(gs,{teamId:"T1"});
  assert.ok(knowledge.opening_context.staff_quality>80);
});
