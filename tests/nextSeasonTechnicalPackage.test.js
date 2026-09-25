import test from "node:test";
import assert from "node:assert/strict";

import {
  buildNextSeasonTechnicalPackage,
  nextSeasonTechnicalPhilosophy,
} from "../src/domain/nextSeasonTechnicalPackage.js";
import {
  advanceNextSeasonCarDay,
  normalizeNextSeasonCarProgramme,
  setNextSeasonCarEngineers,
  startNextSeasonCarProgramme,
} from "../src/domain/nextSeasonCar.js";

function carryover(level=75){
  const ids=["aero","chassis","powertrain","hybrid","cooling","reliability"];
  const rows=ids.map((id)=>({
    id,
    label:id,
    current_level:level,
    retained_level:level,
    regulation_retention:1,
    regulation_retention_percent:100,
    research_xp:0,
    project_xp:0,
  }));
  return {
    version:1,
    targetSeason:1981,
    current_average:level,
    retained_average:level,
    retention_percent:100,
    areas:Object.fromEntries(rows.map((row)=>[row.id,row])),
    rows,
  };
}

function fixture(){
  return {
    activeYear:1980,
    currentDateISO:"1980-03-01",
    team:{team_id:"PLAYER",budget:8_000_000},
    finances:{balance:8_000_000,budget:8_000_000,season_spend:0},
    facilities:[{
      year:1980,team_id:"PLAYER",
      aero_dept_level:8,wind_tunnel_level:8,
      manufacturing_leve:8,_chassis_shop_level:8,
    }],
    hq:{facilityLevels:{}},
    development:{
      projects:[],parts:[],partUnits:[],manufacturing:[],research:[],
      technologyProjects:[],aeroTestingUsage:[],
      technicalKnowledge:null,nextSeasonCar:null,
    },
    carStats:[{
      year:1980,team_id:"PLAYER",
      chassis_spec:78,aero_spec:80,gearbox_spec:76,
      suspension_spec:77,brakes_spec:77,cooling_spec:75,
      reliability:0.80,
    }],
    financeLog:[],
  };
}

test("technical philosophy creates explicit target trade-offs instead of a free global bonus",()=>{
  const gs=fixture();
  const knowledge=carryover(75);
  const balanced=buildNextSeasonTechnicalPackage(gs,{
    teamId:"PLAYER",
    knowledgeCarryover:knowledge,
    programme:{
      targetSeason:1981,overall_progress:15,engineers:4,
      technical_philosophy:{id:"balanced"},
    },
  });
  const aero=buildNextSeasonTechnicalPackage(gs,{
    teamId:"PLAYER",
    knowledgeCarryover:knowledge,
    programme:{
      targetSeason:1981,overall_progress:15,engineers:4,
      technical_philosophy:{id:"aero_efficiency"},
    },
  });

  assert.equal(balanced.philosophy.id,"balanced");
  assert.equal(aero.philosophy.id,"aero_efficiency");
  assert.ok(aero.areas.aero.concept_target>balanced.areas.aero.concept_target);
  assert.ok(aero.areas.cooling.concept_target<balanced.areas.cooling.concept_target);
  assert.ok(aero.philosophy.complexity>balanced.philosophy.complexity);
});

test("Concept maturity grows from programme progress without touching current carStats",()=>{
  let gs=fixture();
  const baseline=structuredClone(gs.carStats);
  gs=startNextSeasonCarProgramme(gs,{
    teamId:"PLAYER",
    engineers:4,
    engineeringSupport:80,
    philosophyId:"mechanical_grip",
  });

  assert.equal(gs.development.nextSeasonCar.technical_philosophy.id,"mechanical_grip");
  assert.equal(gs.development.nextSeasonCar.technical_package.concept.maturity,0);
  assert.deepEqual(gs.carStats,baseline);

  gs={...gs,currentDateISO:"1980-03-02"};
  gs=advanceNextSeasonCarDay(gs,{teamId:"PLAYER"});

  assert.ok(gs.development.nextSeasonCar.technical_package.concept.maturity>0);
  assert.equal(gs.development.nextSeasonCar.technical_package.design.maturity,0);
  assert.deepEqual(gs.carStats,baseline);
});

test("Design converts a mature concept into a stronger and more certain projected package",()=>{
  const gs=fixture();
  const knowledge=carryover(72);
  const conceptComplete=buildNextSeasonTechnicalPackage(gs,{
    teamId:"PLAYER",
    knowledgeCarryover:knowledge,
    programme:{
      targetSeason:1981,overall_progress:15,engineers:5,
      technical_philosophy:{id:"balanced"},
    },
  });
  const designMid=buildNextSeasonTechnicalPackage(gs,{
    teamId:"PLAYER",
    knowledgeCarryover:knowledge,
    programme:{
      targetSeason:1981,overall_progress:37.5,engineers:5,
      technical_philosophy:{id:"balanced"},
    },
  });
  const designComplete=buildNextSeasonTechnicalPackage(gs,{
    teamId:"PLAYER",
    knowledgeCarryover:knowledge,
    programme:{
      targetSeason:1981,overall_progress:60,engineers:5,
      technical_philosophy:{id:"balanced"},
    },
  });

  assert.equal(conceptComplete.concept.maturity,100);
  assert.equal(conceptComplete.design.maturity,0);
  assert.equal(designMid.design.maturity,50);
  assert.equal(designComplete.design.maturity,100);
  assert.ok(designMid.overall.projected>conceptComplete.overall.projected);
  assert.ok(designComplete.overall.projected>designMid.overall.projected);
  assert.ok(designComplete.overall.confidence>conceptComplete.overall.confidence);
  assert.ok(designComplete.overall.uncertainty<conceptComplete.overall.uncertainty);
  assert.equal(designComplete.stage_scope.materialized_to_car_stats,false);
});

test("engineer reallocation immediately changes future Design capacity, not current car performance",()=>{
  let gs=fixture();
  const baseline=structuredClone(gs.carStats);
  gs=startNextSeasonCarProgramme(gs,{
    teamId:"PLAYER",
    engineers:2,
    engineeringSupport:80,
    philosophyId:"balanced",
  });
  const before=gs.development.nextSeasonCar.technical_package.design.gain_capacity;

  gs=setNextSeasonCarEngineers(gs,{
    teamId:"PLAYER",
    engineers:5,
    engineeringSupport:80,
  });
  const after=gs.development.nextSeasonCar.technical_package.design.gain_capacity;

  assert.equal(gs.development.nextSeasonCar.engineers,5);
  assert.ok(after>before);
  assert.deepEqual(gs.carStats,baseline);
});

test("old next-season saves default safely to Balanced philosophy with no fabricated package",()=>{
  const old={
    targetSeason:1981,
    status:"active",
    phase:"concept",
    overall_progress:4,
    engineers:3,
  };
  const normalized=normalizeNextSeasonCarProgramme(old,{activeYear:1980});

  assert.equal(normalized.technical_philosophy.id,"balanced");
  assert.equal(normalized.technical_package,null);
});

test("philosophy lookup is deterministic and invalid ids fall back to Balanced",()=>{
  assert.equal(nextSeasonTechnicalPhilosophy("reliability").id,"reliability");
  assert.equal(nextSeasonTechnicalPhilosophy("does_not_exist").id,"balanced");
});


function carryoverByArea(values){
  const base=carryover(75);
  for(const [id,value] of Object.entries(values||{})){
    if(!base.areas[id])continue;
    base.areas[id]={...base.areas[id],current_level:value,retained_level:value};
  }
  base.rows=Object.values(base.areas);
  base.current_average=base.rows.reduce((sum,row)=>sum+row.current_level,0)/base.rows.length;
  base.retained_average=base.rows.reduce((sum,row)=>sum+row.retained_level,0)/base.rows.length;
  return base;
}

test("Integration detects deterministic package bottlenecks and protects coherent designs",()=>{
  const gs=fixture();
  const coherent=buildNextSeasonTechnicalPackage(gs,{
    teamId:"PLAYER",
    knowledgeCarryover:carryover(76),
    programme:{
      targetSeason:1981,overall_progress:85,engineers:6,
      technical_philosophy:{id:"balanced"},
    },
  });
  const imbalanced=buildNextSeasonTechnicalPackage(gs,{
    teamId:"PLAYER",
    knowledgeCarryover:carryoverByArea({
      aero:90,chassis:68,powertrain:86,cooling:61,reliability:72,
    }),
    programme:{
      targetSeason:1981,overall_progress:85,engineers:6,
      technical_philosophy:{id:"balanced"},
    },
  });

  assert.equal(coherent.integration.maturity,100);
  assert.equal(imbalanced.integration.maturity,100);
  assert.ok(coherent.integration.projected_quality>imbalanced.integration.projected_quality);
  assert.ok(imbalanced.integration.bottlenecks.some((row)=>row.id==="aero_chassis_correlation"));
  assert.ok(imbalanced.integration.bottlenecks.some((row)=>row.id==="powertrain_cooling_margin"));
  assert.ok(imbalanced.areas.aero.integrated_projected<=imbalanced.areas.aero.projected);
  assert.ok(imbalanced.areas.cooling.integrated_projected<=imbalanced.areas.cooling.projected);
});

test("Integration ignores technical families that do not exist in the target era",()=>{
  const gs=fixture();
  const early=buildNextSeasonTechnicalPackage(gs,{
    teamId:"PLAYER",
    knowledgeCarryover:carryover(75),
    programme:{
      targetSeason:1981,overall_progress:85,engineers:5,
      technical_philosophy:{id:"balanced"},
    },
  });
  const hybridEra=buildNextSeasonTechnicalPackage(gs,{
    teamId:"PLAYER",
    knowledgeCarryover:carryover(75),
    programme:{
      targetSeason:2015,overall_progress:85,engineers:5,
      technical_philosophy:{id:"balanced"},
    },
  });

  assert.equal(early.areas.hybrid.applicable,false);
  assert.equal(hybridEra.areas.hybrid.applicable,true);
  assert.ok(!early.integration.bottlenecks.some((row)=>row.areas.includes("hybrid")));
});

test("Design locks at 60% and Integration locks at 85% so later knowledge cannot rewrite completed phases",()=>{
  const gs=fixture();
  const designLocked=buildNextSeasonTechnicalPackage(gs,{
    teamId:"PLAYER",
    knowledgeCarryover:carryover(70),
    programme:{
      targetSeason:1981,overall_progress:60,engineers:5,
      technical_philosophy:{id:"balanced"},
    },
  });
  const afterNewKnowledge=buildNextSeasonTechnicalPackage(gs,{
    teamId:"PLAYER",
    knowledgeCarryover:carryover(92),
    programme:{
      targetSeason:1981,overall_progress:72,engineers:5,
      technical_philosophy:{id:"balanced"},
      technical_package:designLocked,
    },
  });

  assert.equal(designLocked.design.locked,true);
  assert.equal(afterNewKnowledge.areas.aero.projected,designLocked.areas.aero.projected);
  assert.equal(afterNewKnowledge.areas.chassis.projected,designLocked.areas.chassis.projected);

  const integrationLocked=buildNextSeasonTechnicalPackage(gs,{
    teamId:"PLAYER",
    knowledgeCarryover:carryover(92),
    programme:{
      targetSeason:1981,overall_progress:85,engineers:5,
      technical_philosophy:{id:"balanced"},
      technical_package:afterNewKnowledge,
    },
  });
  const validating=buildNextSeasonTechnicalPackage(gs,{
    teamId:"PLAYER",
    knowledgeCarryover:carryover(99),
    programme:{
      targetSeason:1981,overall_progress:95,engineers:9,
      technical_philosophy:{id:"balanced"},
      technical_package:integrationLocked,
    },
  });

  assert.equal(integrationLocked.integration.locked,true);
  assert.equal(validating.areas.aero.integrated_projected,integrationLocked.areas.aero.integrated_projected);
  assert.equal(validating.areas.chassis.integrated_projected,integrationLocked.areas.chassis.integrated_projected);
});

test("Validation is deterministic, bounded and closes uncertainty without random rolls",()=>{
  const gs=fixture();
  const knowledge=carryoverByArea({
    aero:82,chassis:78,powertrain:77,cooling:74,reliability:80,
  });
  const integrated=buildNextSeasonTechnicalPackage(gs,{
    teamId:"PLAYER",
    knowledgeCarryover:knowledge,
    programme:{
      targetSeason:1981,overall_progress:85,engineers:6,
      technical_philosophy:{id:"aero_efficiency"},
    },
  });
  const completedA=buildNextSeasonTechnicalPackage(gs,{
    teamId:"PLAYER",
    knowledgeCarryover:knowledge,
    programme:{
      targetSeason:1981,overall_progress:100,engineers:6,
      technical_philosophy:{id:"aero_efficiency"},
      technical_package:integrated,
    },
  });
  const completedB=buildNextSeasonTechnicalPackage(gs,{
    teamId:"PLAYER",
    knowledgeCarryover:knowledge,
    programme:{
      targetSeason:1981,overall_progress:100,engineers:6,
      technical_philosophy:{id:"aero_efficiency"},
      technical_package:integrated,
    },
  });

  assert.deepEqual(completedA,completedB);
  assert.equal(completedA.validation.maturity,100);
  assert.equal(completedA.readiness,"validated");
  assert.ok(completedA.validation.uncertainty<integrated.validation.uncertainty);
  for(const row of completedA.rows.filter((item)=>item.applicable!==false)){
    assert.ok(row.validated>=0&&row.validated<=100);
    assert.ok(Math.abs(row.validation_correction_at_completion)<=2.2);
    assert.ok(row.validation_uncertainty<=row.uncertainty);
  }
  assert.equal(completedA.stage_scope.materialized_to_car_stats,false);
});

test("final Validation uses the allocated engineers before releasing them and never mutates carStats",()=>{
  let gs=fixture();
  const baseline=structuredClone(gs.carStats);
  gs=startNextSeasonCarProgramme(gs,{
    teamId:"PLAYER",
    engineers:4,
    engineeringSupport:80,
    philosophyId:"balanced",
  });
  const seededPackage=buildNextSeasonTechnicalPackage(gs,{
    teamId:"PLAYER",
    knowledgeCarryover:gs.development.nextSeasonCar.knowledge_carryover,
    programme:{
      ...gs.development.nextSeasonCar,
      overall_progress:99,
      engineers:20,
    },
  });
  gs={
    ...gs,
    currentDateISO:"1980-03-02",
    development:{
      ...gs.development,
      nextSeasonCar:{
        ...gs.development.nextSeasonCar,
        status:"active",
        overall_progress:99,
        phase:"validation",
        engineers:20,
        last_progress_date:"1980-03-01",
        technical_package:seededPackage,
      },
    },
  };

  gs=advanceNextSeasonCarDay(gs,{teamId:"PLAYER"});

  assert.equal(gs.development.nextSeasonCar.status,"completed");
  assert.equal(gs.development.nextSeasonCar.readiness,"validated");
  assert.equal(gs.development.nextSeasonCar.engineers,0);
  assert.equal(gs.development.nextSeasonCar.technical_package.resources.engineers,20);
  assert.equal(gs.development.nextSeasonCar.technical_package.validation.maturity,100);
  assert.deepEqual(gs.carStats,baseline);
});

test("a legacy Stage 7.4A package can be upgraded safely during 7.4B calculation",()=>{
  const gs=fixture();
  const upgraded=buildNextSeasonTechnicalPackage(gs,{
    teamId:"PLAYER",
    knowledgeCarryover:carryover(75),
    programme:{
      targetSeason:1981,
      overall_progress:70,
      engineers:5,
      technical_philosophy:{id:"balanced"},
      technical_package:{version:1,overall:{projected:77}},
    },
  });

  assert.equal(upgraded.version,2);
  assert.ok(upgraded.integration);
  assert.ok(upgraded.validation);
  assert.equal(upgraded.stage_scope.integration,true);
  assert.equal(upgraded.stage_scope.validation,true);
});
