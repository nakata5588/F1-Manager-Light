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
