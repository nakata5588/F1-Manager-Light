import test from "node:test";
import assert from "node:assert/strict";

import {
  defaultTechnicalStrategy,
  normalizeTechnicalStrategy,
  setTechnicalStrategy,
  technicalStrategyAeroMultipliers,
  technicalStrategyResearchMultipliers,
  technicalStrategySnapshot,
} from "../src/domain/technicalStrategy.js";
import {
  advanceTechnicalResearch,
  normalizeTechnicalResearch,
} from "../src/domain/technicalResearch.js";
import { technicalKnowledgeSnapshot } from "../src/domain/technicalKnowledge.js";
import { buildNextSeasonTechnicalPackage } from "../src/domain/nextSeasonTechnicalPackage.js";

function fixture(){
  return {
    activeYear:1980,
    currentDateISO:"1980-03-01",
    team:{team_id:"PLAYER",budget:6_000_000},
    finances:{balance:6_000_000,budget:6_000_000},
    facilities:[{
      year:1980,team_id:"PLAYER",
      aero_dept_level:8,wind_tunnel_level:8,
      manufacturing_leve:8,_chassis_shop_level:8,
    }],
    hq:{facilityLevels:{}},
    development:{
      projects:[],
      parts:[],
      partUnits:[],
      manufacturing:[],
      research:normalizeTechnicalResearch([]),
      technologyProjects:[],
      aeroTestingUsage:[],
      technicalKnowledge:null,
      technicalStrategy:null,
      nextSeasonCar:null,
    },
    carStats:[{
      year:1980,team_id:"PLAYER",
      chassis_spec:75,aero_spec:76,gearbox_spec:74,
      suspension_spec:74,brakes_spec:74,cooling_spec:73,reliability:0.78,
    }],
    staffContracts:[],
    staffRatings:[],
  };
}

function carryover(level=75){
  const ids=["aero","chassis","powertrain","hybrid","cooling","reliability"];
  const rows=ids.map((id)=>({
    id,label:id,current_level:level,retained_level:level,
    regulation_retention:1,regulation_retention_percent:100,
  }));
  return {
    targetSeason:1981,
    current_average:level,
    retained_average:level,
    retention_percent:100,
    areas:Object.fromEntries(rows.map((row)=>[row.id,row])),
    rows,
  };
}

test("old saves default to Balanced and preserve the previous 1.00x baseline",()=>{
  const strategy=normalizeTechnicalStrategy(undefined);
  const research=technicalStrategyResearchMultipliers(strategy);
  const aero=technicalStrategyAeroMultipliers(strategy);

  assert.deepEqual(strategy,defaultTechnicalStrategy());
  assert.equal(strategy.id,"balanced");
  assert.equal(research.current_car_multiplier,1);
  assert.equal(research.next_season_multiplier,1);
  assert.equal(aero.current_car_multiplier,1);
  assert.equal(aero.next_season_multiplier,1);
});

test("strategy multipliers are zero-sum around Balanced",()=>{
  const current=technicalStrategyResearchMultipliers({id:"current_car_push"});
  const future=technicalStrategyResearchMultipliers({id:"future_first"});
  const currentAero=technicalStrategyAeroMultipliers({id:"current_car_push"});
  const futureAero=technicalStrategyAeroMultipliers({id:"future_first"});

  assert.ok(current.current_car_multiplier>1);
  assert.ok(current.next_season_multiplier<1);
  assert.ok(future.current_car_multiplier<1);
  assert.ok(future.next_season_multiplier>1);
  assert.equal(Number((current.current_car_multiplier+current.next_season_multiplier).toFixed(3)),2);
  assert.equal(Number((future.current_car_multiplier+future.next_season_multiplier).toFixed(3)),2);
  assert.equal(Number((currentAero.current_car_multiplier+currentAero.next_season_multiplier).toFixed(3)),2);
  assert.equal(Number((futureAero.current_car_multiplier+futureAero.next_season_multiplier).toFixed(3)),2);
});

test("Current Car Push generates more spendable RP while Future First generates more persistent knowledge",()=>{
  const base=fixture();
  const opening=technicalKnowledgeSnapshot(base,{teamId:"PLAYER"}).average;

  let current=setTechnicalStrategy(structuredClone(base),{strategyId:"current_car_push",dateISO:"1980-03-01"});
  let future=setTechnicalStrategy(structuredClone(base),{strategyId:"future_first",dateISO:"1980-03-01"});

  current=advanceTechnicalResearch(current,"1980-03-02");
  future=advanceTechnicalResearch(future,"1980-03-02");

  const currentRp=current.development.research.reduce((sum,row)=>sum+row.points,0);
  const futureRp=future.development.research.reduce((sum,row)=>sum+row.points,0);
  const currentKnowledge=technicalKnowledgeSnapshot(current,{teamId:"PLAYER"}).average;
  const futureKnowledge=technicalKnowledgeSnapshot(future,{teamId:"PLAYER"}).average;

  assert.ok(currentRp>futureRp);
  assert.ok(futureKnowledge>currentKnowledge);
  assert.ok(currentKnowledge>=opening);
  assert.ok(futureKnowledge>=opening);
});

test("Future First aero priority improves next-season aero Design capacity but not unrelated areas",()=>{
  const knowledge=carryover(75);
  let current=setTechnicalStrategy(fixture(),{strategyId:"current_car_push"});
  let future=setTechnicalStrategy(fixture(),{strategyId:"future_first"});

  const currentPackage=buildNextSeasonTechnicalPackage(current,{
    teamId:"PLAYER",
    knowledgeCarryover:knowledge,
    programme:{
      targetSeason:1981,overall_progress:60,engineers:5,
      technical_philosophy:{id:"balanced"},
    },
  });
  const futurePackage=buildNextSeasonTechnicalPackage(future,{
    teamId:"PLAYER",
    knowledgeCarryover:knowledge,
    programme:{
      targetSeason:1981,overall_progress:60,engineers:5,
      technical_philosophy:{id:"balanced"},
    },
  });

  assert.ok(futurePackage.areas.aero.design_capacity>currentPackage.areas.aero.design_capacity);
  assert.equal(futurePackage.areas.chassis.design_capacity,currentPackage.areas.chassis.design_capacity);
  assert.ok(futurePackage.resources.aero_strategy_multiplier>currentPackage.resources.aero_strategy_multiplier);
});

test("engineer strategy target respects already committed Current Car projects",()=>{
  let gs=fixture();
  gs.development.projects=[
    {id:"P1",status:"active",engineers:4},
    {id:"P2",status:"active",engineers:4},
  ];
  gs=setTechnicalStrategy(gs,{strategyId:"future_first"});
  const snapshot=technicalStrategySnapshot(gs,{
    teamId:"PLAYER",
    engineeringSupport:80,
    projects:gs.development.projects,
    nextSeasonCar:{status:"active",engineers:2},
  });

  assert.equal(snapshot.engineers.pool,12);
  assert.equal(snapshot.engineers.current_projects,8);
  assert.equal(snapshot.engineers.target_next_season,10);
  assert.equal(snapshot.engineers.feasible_next_season,4);
  assert.equal(snapshot.engineers.blocked_engineers,6);
});

test("strategy state is persistent Save World data with a dated change",()=>{
  const gs=setTechnicalStrategy(fixture(),{
    strategyId:"next_season_priority",
    dateISO:"1980-05-17",
  });
  assert.equal(gs.development.technicalStrategy.id,"next_season_priority");
  assert.equal(gs.development.technicalStrategy.changed_at,"1980-05-17");
  assert.equal(gs.development.technicalStrategy.current_car_share,30);
  assert.equal(gs.development.technicalStrategy.next_season_share,70);
});
