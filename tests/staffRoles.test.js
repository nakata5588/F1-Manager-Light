import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalStaffRole,
  raceEngineerEraCoverage,
  resolveStaffId,
  staffPrimaryCareerRole,
  staffRecordedRoles,
  staffRoleDepartment,
  staffRoleLabel,
} from "../src/domain/staffRoles.js";
import { staffMarketRoles } from "../src/domain/staffMarket.js";
import { teamEngineeringSupport, teamSetupSupport } from "../src/engine/PracticeSetupEngine.js";
import { forecastAccuracyForTeam } from "../src/engine/WeekendWeatherEngine.js";
import { seedTechnicalKnowledge } from "../src/domain/technicalKnowledge.js";
import {
  STAFF_ROLE_WEIGHTS,
  staffRoleRating,
  staffStrategyDecisionDelta,
  teamStaffCapability,
} from "../src/domain/staffPerformance.js";

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

test("S2.0A2 preserves legacy/map Staff core role fallback",()=>{
  const gs={
    activeYear:1980,
    staffCore:{rows:[{staff_id:"S1",staff_name:"Legacy Principal",role_primary:"team_principal"}]},
    staffContracts:[],
  };
  assert.equal(staffPrimaryCareerRole(gs,"S1"),"team_principal");
  assert.deepEqual(staffMarketRoles(gs,"S1"),["team_principal"]);
});

test("S2.0A2 derives canonical Staff roles from factual career contracts",()=>{
  const gs={
    activeYear:2005,
    staffCore:[{staff_id:"S2004",staff_name:"Historical Engineer"}],
    staffContracts:[
      {year:2004,team_id:"T1",staff_id:"S2004",role:"chief_engineer",contract_start_year:2003,contract_until_year:2004,status:"expired"},
    ],
  };
  assert.deepEqual(staffRecordedRoles(gs,"S2004"),["chief_engineer"]);
  assert.equal(staffPrimaryCareerRole(gs,"S2004"),"chief_engineer");
  assert.deepEqual(staffMarketRoles(gs,"S2004"),["chief_engineer"]);
});

test("S2.0A2 keeps legacy primary role as fallback instead of overriding factual operational history",()=>{
  const gs={
    activeYear:1980,
    staffCore:[{staff_id:"S1",staff_name:"Designer",role_primary:"race_engineer"}],
    staffContracts:[
      {year:1980,team_id:"T1",staff_id:"S1",role:"chief_designer",contract_start_year:1979,contract_until_year:1984},
    ],
  };
  assert.deepEqual(staffRecordedRoles(gs,"S1"),["chief_designer"]);
  assert.deepEqual(staffMarketRoles(gs,"S1"),["chief_designer"]);
});

test("S2.0A2 never leaks future Staff roles into the active career year",()=>{
  const gs={
    activeYear:2004,
    staffCore:[{staff_id:"S1",staff_name:"Career Staff",role_primary:"chief_engineer"}],
    staffContracts:[
      {year:2004,team_id:"T1",staff_id:"S1",role:"chief_engineer",contract_start_year:2003,contract_until_year:2004},
      {year:2008,team_id:"T2",staff_id:"S1",role:"technical_director",contract_start_year:2008,contract_until_year:2010},
    ],
  };
  assert.deepEqual(staffRecordedRoles(gs,"S1"),["chief_engineer"]);
  assert.equal(staffRecordedRoles(gs,"S1",{year:2009})[0],"technical_director");
});

test("S2.0A2 recognizes factual 2004 role families without inventing market eligibility",()=>{
  assert.equal(canonicalStaffRole("Sporting Director"),"sporting_director");
  assert.equal(staffRoleDepartment("Sporting Director"),"Trackside");
  assert.equal(staffRoleDepartment("head_vehicle_performance"),"Technical");
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


test("Staff Overall is role-specific and every role weight totals 100",()=>{
  for(const weights of Object.values(STAFF_ROLE_WEIGHTS)){
    assert.equal(Object.values(weights).reduce((sum,value)=>sum+value,0),100);
  }
  const strategist={
    strategy:96,data_analysis:94,communication:90,technical:52,
    leadership:58,conflict_management:62,reliability_focus:55,
    innovation:45,budget_management:50,motivation:65,negotiation:50,
    pitstop_management:50,driver_development:65,reputation:99,
  };
  const strategyRating=staffRoleRating(strategist,"chief_strategist").score;
  const technicalRating=staffRoleRating(strategist,"technical_director").score;
  assert.ok(strategyRating>technicalRating+15);
});

test("irrelevant Staff attributes and Reputation do not inflate role Overall",()=>{
  const base={
    technical:82,innovation:80,data_analysis:78,reliability_focus:76,
    communication:72,budget_management:68,leadership:65,
    reputation:20,driver_development:10,strategy:10,
  };
  const inflated={...base,reputation:100,driver_development:100,strategy:100};
  assert.equal(
    staffRoleRating(base,"technical_director").score,
    staffRoleRating(inflated,"technical_director").score
  );
});

test("Race Engineer quality improves setup support through the canonical Staff model",()=>{
  const make=(quality)=>({
    activeYear:2004,
    staffCore:[{staff_id:"RE1",role_primary:"race_engineer"}],
    staffContracts:[{year:2004,team_id:"T1",staff_id:"RE1",role:"race_engineer",contract_start:2000,contract_until:2010,status:"active"}],
    staffRatings:[{
      year:2004,staff_id:"RE1",
      communication:quality,technical:quality,data_analysis:quality,strategy:quality,
      motivation:quality,reliability_focus:quality,conflict_management:quality,
    }],
  });
  assert.ok(teamSetupSupport(make(90),"T1")>teamSetupSupport(make(45),"T1")+35);
});

test("Technical Staff improves technical knowledge through the intended capability",()=>{
  const make=(quality)=>({
    activeYear:2004,currentDateISO:"2004-03-01",team:{team_id:"T1"},
    staffCore:[{staff_id:"TD1",role_primary:"technical_director"}],
    staffContracts:[{year:2004,team_id:"T1",staff_id:"TD1",role:"technical_director",contract_start:2000,contract_until:2010,status:"active"}],
    staffRatings:[{
      year:2004,staff_id:"TD1",technical:quality,innovation:quality,data_analysis:quality,
      reliability_focus:quality,communication:quality,budget_management:quality,leadership:quality,
    }],
    facilities:[{year:2004,team_id:"T1",pitcrew_training_level:5,aero_dept_level:5,wind_tunnel_level:5,_chassis_shop_level:5,manufacturing_leve:5}],
    carStats:[{year:2004,team_id:"T1",aero_spec:60,chassis_spec:60,suspension_spec:60,brakes_spec:60,gearbox_spec:60,reliability:0.7}],
    development:{projects:[]},hq:{facilityLevels:{}},
  });
  const weak=seedTechnicalKnowledge(make(40),{teamId:"T1"});
  const strong=seedTechnicalKnowledge(make(90),{teamId:"T1"});
  assert.ok(strong.opening_context.staff_quality>weak.opening_context.staff_quality+35);
  assert.ok(strong.areas.aero.level>weak.areas.aero.level);
});

test("Strategist quality improves decision quality modifier without becoming race pace",()=>{
  const make=(quality)=>({
    activeYear:2004,
    staffCore:[{staff_id:"ST1",role_primary:"chief_strategist"}],
    staffContracts:[{year:2004,team_id:"T1",staff_id:"ST1",role:"chief_strategist",contract_start:2000,contract_until:2010,status:"active"}],
    staffRatings:[{
      year:2004,staff_id:"ST1",strategy:quality,data_analysis:quality,
      communication:quality,technical:quality,leadership:quality,
      conflict_management:quality,reliability_focus:quality,
    }],
  });
  const weak=make(35),strong=make(92);
  assert.ok(teamStaffCapability(strong,"T1","strategy")>teamStaffCapability(weak,"T1","strategy")+45);
  assert.ok(staffStrategyDecisionDelta(strong,"T1")>staffStrategyDecisionDelta(weak,"T1"));
  assert.ok(Math.abs(staffStrategyDecisionDelta(strong,"T1"))<=0.12);
});


test("Staff capability model is independent of Race Weekend engine selection",()=>{
  const make=(engineVersion)=>({
    activeYear:2004,
    raceWeekendState:{engine_version:engineVersion},
    staffCore:[{staff_id:"RE1",role_primary:"race_engineer"}],
    staffContracts:[{
      year:2004,team_id:"T1",staff_id:"RE1",role:"race_engineer",
      contract_start:2000,contract_until:2010,status:"active",
    }],
    staffRatings:[{
      year:2004,staff_id:"RE1",
      communication:88,technical:84,data_analysis:86,strategy:78,
      motivation:80,reliability_focus:76,conflict_management:72,
    }],
  });
  assert.equal(
    teamStaffCapability(make("legacy"),"T1","setup"),
    teamStaffCapability(make("rw2"),"T1","setup")
  );
});
