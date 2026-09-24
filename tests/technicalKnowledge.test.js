import test from "node:test";
import assert from "node:assert/strict";

import {
  applyTechnicalKnowledgeGains,
  nextSeasonKnowledgeCarryover,
  seedTechnicalKnowledge,
  technicalKnowledgeSnapshot,
  technicalLearningContext,
} from "../src/domain/technicalKnowledge.js";
import {
  advanceTechnicalResearch,
  setTechnicalResearchFocus,
} from "../src/domain/technicalResearch.js";
import { processPlayerTechnicalLifecycle } from "../src/domain/playerTechnicalLifecycle.js";

function fixture(){
  return {
    activeYear:1980,
    currentDateISO:"1980-03-01",
    team:{team_id:"T1",budget:6_000_000},
    finances:{balance:6_000_000,budget:6_000_000},
    carStats:[{
      year:1980,team_id:"T1",
      chassis_spec:80,aero_spec:82,gearbox_spec:78,suspension_spec:80,
      brakes_spec:79,cooling_spec:77,turbo_spec:74,
      kers_spec:null,ers_mgu_k:null,ers_mgu_h:null,battery_pack:null,
      reliability:0.80,
    }],
    dbCarStats:[{
      year:1981,team_id:"T1",
      chassis_spec:99,aero_spec:99,gearbox_spec:99,suspension_spec:99,
      brakes_spec:99,cooling_spec:99,turbo_spec:99,reliability:0.99,
    }],
    facilities:[{
      year:1980,team_id:"T1",
      aero_dept_level:8,wind_tunnel_level:8,
      manufacturing_leve:8,_chassis_shop_level:8,
    }],
    hq:{facilityLevels:{}},
    staffContracts:[{
      year:1980,staff_id:"S1",team_id:"T1",role:"technical_director",status:"active",
    }],
    staffRatings:[{
      year:1980,staff_id:"S1",technical:90,innovation:88,data_analysis:84,
      reliability_focus:82,communication:78,
    }],
    development:{
      projects:[],parts:[],partUnits:[],manufacturing:[],
      research:[],technologyProjects:[],aeroTestingUsage:[],
      technicalKnowledge:null,nextSeasonCar:null,
    },
    garage:{
      cars:[
        {id:"car_1",kind:"race",installedParts:{},componentCondition:{}},
        {id:"car_2",kind:"race",installedParts:{},componentCondition:{}},
      ],
      serviceJobs:[],baseComponentStock:{},
    },
  };
}

test("opening technical knowledge is calibrated from the current Save World, not future historical car outcomes",()=>{
  const gs=fixture();
  const a=seedTechnicalKnowledge(gs,{teamId:"T1"});
  const changedFuture={
    ...gs,
    dbCarStats:[{...gs.dbCarStats[0],aero_spec:10,chassis_spec:10,gearbox_spec:10}],
  };
  const b=seedTechnicalKnowledge(changedFuture,{teamId:"T1"});

  assert.equal(a.areas.aero.level,b.areas.aero.level);
  assert.equal(a.areas.chassis.level,b.areas.chassis.level);
  assert.ok(a.areas.aero.level<96);
  assert.ok(a.areas.aero.level>60);
});

test("stronger technical staff and facilities accelerate future knowledge learning",()=>{
  const strong=fixture();
  const baseLedger=technicalKnowledgeSnapshot(strong,{teamId:"T1"});
  strong.development.technicalKnowledge={
    ...baseLedger,
    areas:Object.fromEntries(Object.entries(baseLedger.areas).map(([id,row])=>[
      id,{...row,level:50,opening_level:50},
    ])),
  };

  const weak=structuredClone(strong);
  weak.facilities[0]={
    ...weak.facilities[0],
    aero_dept_level:2,wind_tunnel_level:2,manufacturing_leve:2,_chassis_shop_level:2,
  };
  weak.staffRatings[0]={
    ...weak.staffRatings[0],
    technical:40,innovation:40,data_analysis:40,reliability_focus:40,communication:40,
  };

  assert.ok(
    technicalLearningContext(strong,{teamId:"T1"}).multiplier>
    technicalLearningContext(weak,{teamId:"T1"}).multiplier
  );

  const learnedStrong=applyTechnicalKnowledgeGains(
    strong,[{area:"aero",gain:5}],
    {teamId:"T1",eventId:"strong",source:"project"}
  );
  const learnedWeak=applyTechnicalKnowledgeGains(
    weak,[{area:"aero",gain:5}],
    {teamId:"T1",eventId:"weak",source:"project"}
  );
  assert.ok(
    learnedStrong.development.technicalKnowledge.areas.aero.level>
    learnedWeak.development.technicalKnowledge.areas.aero.level
  );
});

test("daily Research creates RP and persistent knowledge once per in-game day",()=>{
  let gs=fixture();
  gs.development.research=setTechnicalResearchFocus([], "aero", 100);
  const opening=technicalKnowledgeSnapshot(gs,{teamId:"T1"}).areas.aero.level;

  const once=advanceTechnicalResearch(gs,"1980-03-02");
  const twice=advanceTechnicalResearch(once,"1980-03-02");
  const aeroResearch=once.development.research.find((row)=>row.id==="aero");

  assert.ok(aeroResearch.points>0);
  assert.ok(once.development.technicalKnowledge.areas.aero.level>opening);
  assert.equal(
    twice.development.technicalKnowledge.areas.aero.level,
    once.development.technicalKnowledge.areas.aero.level
  );
  assert.equal(
    twice.development.technicalKnowledge.history.length,
    once.development.technicalKnowledge.history.length
  );
});

test("a completed Blueprint teaches the team even before any physical unit is manufactured",()=>{
  const gs=fixture();
  const opening=technicalKnowledgeSnapshot(gs,{teamId:"T1"}).areas.aero.level;
  gs.currentDateISO="1980-04-10";
  gs.development.projects=[{
    id:"front_knowledge",
    name:"Front Wing Knowledge Test",
    type:"aero_front",
    objective_id:"downforce",
    status:"active",
    started_at:"1980-03-01",
    finishes_at:"1980-04-05",
    target_design_perf:2.2,
    perf_delta:2.2,
    research_points_used:8,
    engineers:4,
  }];

  const next=processPlayerTechnicalLifecycle(gs);
  const blueprint=next.development.parts.find((part)=>part.created_from==="front_knowledge");

  assert.ok(blueprint);
  assert.equal(next.development.partUnits.length,0);
  assert.ok(next.development.technicalKnowledge.areas.aero.level>opening);
  assert.ok(next.development.technicalKnowledge.areas.reliability.level>
    technicalKnowledgeSnapshot(gs,{teamId:"T1"}).areas.reliability.level);
  assert.ok(next.development.technicalKnowledge.history.some((row)=>
    row.event_id==="project_front_knowledge_knowledge"&&row.source==="project"
  ));
});

test("legacy completed projects contribute to old-save knowledge backfill",()=>{
  const plain=fixture();
  const upgraded=fixture();
  upgraded.development.projects=[{
    id:"old_blueprint",
    type:"chassis",
    objective_id:"lightweight",
    status:"completed",
    actual_design_perf:3,
  }];

  const base=seedTechnicalKnowledge(plain,{teamId:"T1"});
  const migrated=seedTechnicalKnowledge(upgraded,{teamId:"T1"});
  assert.ok(migrated.areas.chassis.level>base.areas.chassis.level);
});

test("regulation retention caps transferable knowledge without deleting current expertise",()=>{
  const gs=fixture();
  const ledger=technicalKnowledgeSnapshot(gs,{teamId:"T1"});
  gs.development.technicalKnowledge={
    ...ledger,
    areas:Object.fromEntries(Object.entries(ledger.areas).map(([id,row])=>[
      id,{...row,level:80,opening_level:80},
    ])),
  };

  const impact={
    severity:"major",
    knowledge_retention:{
      aero:{factor:0.50,percent:50,label:"Low"},
      chassis:{factor:0.72,percent:72,label:"Moderate"},
      powertrain:{factor:1,percent:100,label:"Full"},
      hybrid:{factor:1,percent:100,label:"Full"},
      cooling:{factor:0.90,percent:90,label:"High"},
      reliability:{factor:1,percent:100,label:"Full"},
    },
  };
  const carry=nextSeasonKnowledgeCarryover(gs,{
    teamId:"T1",targetSeason:1981,regulationImpact:impact,
  });

  assert.equal(carry.areas.aero.current_level,80);
  assert.equal(carry.areas.aero.retained_level,40);
  assert.equal(carry.areas.chassis.retained_level,57.6);
  assert.equal(gs.development.technicalKnowledge.areas.aero.level,80);
  assert.ok(carry.retention_percent<100);
});
