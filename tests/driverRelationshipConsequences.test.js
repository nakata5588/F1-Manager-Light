import test from "node:test";
import assert from "node:assert/strict";

import {
  applyRaceRelationshipConsequences,
  driverProfessionalRelationshipClimate,
  driverRelationshipConsequenceProfile,
  raceEngineerPreparationProfile,
  relationshipRaceMentalAdjustment,
  relationshipRaceMoraleDelta,
  relationshipRenewalAcceptanceDelta,
  relationshipRenewalRetentionDelta,
  teamOrderComplianceProfile,
} from "../src/domain/driverRelationshipConsequences.js";
import { issueLiveRaceCommand } from "../src/engine/LiveRaceEngine.js";
import { rngFor } from "../src/core/random.js";

function relation({
  driver="D1",
  type,
  target,
  team="T1",
  trust=50,
  respect=50,
  affinity=50,
  satisfaction=50,
  rivalry=0,
  active=true,
}){
  const score=(trust+respect+affinity+satisfaction)/4;
  return {
    driver_id:driver,
    target_type:type,
    target_id:target,
    team_id:team,
    trust,respect,affinity,satisfaction,rivalry,
    score,
    active,
  };
}

function baseState(relations={},overrides={}){
  return {
    activeYear:1980,
    currentDateISO:"1980-07-01",
    saveMeta:{seed:"d63f-test"},
    team:{team_id:"T1",name:"Player"},
    drivers:[
      {driver_id:"D1",display_name:"Driver One",team_id:"T1"},
      {driver_id:"D2",display_name:"Driver Two",team_id:"T1"},
      {driver_id:"D3",display_name:"Driver Three",team_id:"T2"},
    ],
    driverAttributes:{
      D1:{confidence:50,morale:50,preparation:50,fatigue:0},
      D2:{confidence:50,morale:50,preparation:50,fatigue:0},
      D3:{confidence:50,morale:50,preparation:50,fatigue:0},
    },
    driverRelationships:{version:2,relations,log:[]},
    driverRivalries:{version:1,pairs:{},log:[]},
    ...overrides,
  };
}

function relationMap(rows){
  return Object.fromEntries(rows.map((row)=>[
    [row.driver_id,row.target_type,row.target_id].join("|"),
    row,
  ]));
}

test("D6.3F missing historical staff is neutral rather than a hidden penalty",()=>{
  const gs=baseState(relationMap([
    relation({type:"team",target:"T1"}),
    relation({type:"teammate",target:"D2"}),
  ]));
  const climate=driverProfessionalRelationshipClimate(gs,"D1",{teamId:"T1"});
  assert.equal(climate.score,50);
  assert.equal(climate.known_parts,2);
  assert.equal(relationshipRaceMoraleDelta(gs,"D1",{teamId:"T1"}),0);
  assert.deepEqual(raceEngineerPreparationProfile(gs,"D1",{teamId:"T1"}),{
    known:false,score:null,multiplier:1,label:"No relationship data",
  });
});

test("D6.3F strong and poor professional climates create small bounded morale effects",()=>{
  const strong=baseState(relationMap([
    relation({type:"team",target:"T1",trust:90,respect:85,affinity:80,satisfaction:90}),
    relation({type:"manager",target:"player_manager",trust:90,respect:90,affinity:80,satisfaction:85}),
    relation({type:"race_engineer",target:"E1",trust:85,respect:90,affinity:80,satisfaction:80}),
    relation({type:"teammate",target:"D2",trust:75,respect:85,affinity:70,satisfaction:75}),
  ]));
  const poor=baseState(relationMap([
    relation({type:"team",target:"T1",trust:15,respect:35,affinity:20,satisfaction:10}),
    relation({type:"manager",target:"player_manager",trust:20,respect:30,affinity:20,satisfaction:15}),
    relation({type:"race_engineer",target:"E1",trust:25,respect:30,affinity:20,satisfaction:25}),
    relation({type:"teammate",target:"D2",trust:20,respect:40,affinity:15,satisfaction:20,rivalry:70}),
  ]));
  assert.ok(driverProfessionalRelationshipClimate(strong,"D1",{teamId:"T1"}).score>75);
  assert.ok(relationshipRaceMoraleDelta(strong,"D1",{teamId:"T1"})>0);
  assert.ok(relationshipRaceMoraleDelta(strong,"D1",{teamId:"T1"})<=0.8);

  assert.ok(driverProfessionalRelationshipClimate(poor,"D1",{teamId:"T1"}).score<30);
  assert.ok(relationshipRaceMoraleDelta(poor,"D1",{teamId:"T1"})<0);
  assert.ok(relationshipRaceMoraleDelta(poor,"D1",{teamId:"T1"})>=-0.8);
});

test("D6.3F race engineer relationship changes setup learning only within a narrow band",()=>{
  const excellent=baseState(relationMap([
    relation({type:"race_engineer",target:"E1",trust:100,respect:100,affinity:100,satisfaction:50}),
  ]));
  const poor=baseState(relationMap([
    relation({type:"race_engineer",target:"E1",trust:0,respect:0,affinity:0,satisfaction:50}),
  ]));
  assert.equal(raceEngineerPreparationProfile(excellent,"D1",{teamId:"T1"}).multiplier,1.06);
  assert.equal(raceEngineerPreparationProfile(poor,"D1",{teamId:"T1"}).multiplier,0.94);
});

test("D6.3F renewal consequences reward trust and make a broken relationship harder to retain",()=>{
  const good=baseState(relationMap([
    relation({type:"team",target:"T1",trust:90,satisfaction:90,respect:70,affinity:70}),
    relation({type:"manager",target:"player_manager",trust:90,satisfaction:90,respect:80,affinity:80}),
  ]));
  const bad=baseState(relationMap([
    relation({type:"team",target:"T1",trust:10,satisfaction:10,respect:30,affinity:20}),
    relation({type:"manager",target:"player_manager",trust:15,satisfaction:10,respect:30,affinity:20}),
  ]));
  assert.ok(relationshipRenewalAcceptanceDelta(good,"D1",{teamId:"T1"})>0.08);
  assert.ok(relationshipRenewalRetentionDelta(good,"D1",{teamId:"T1"})>0);
  assert.ok(relationshipRenewalAcceptanceDelta(bad,"D1",{teamId:"T1"})<-0.08);
  assert.ok(relationshipRenewalRetentionDelta(bad,"D1",{teamId:"T1"})<0);
});

test("D6.3F neutral team orders remain reliable while hostility and rivalry create refusal risk",()=>{
  const neutral=baseState(relationMap([
    relation({type:"team",target:"T1"}),
    relation({type:"manager",target:"player_manager"}),
    relation({type:"teammate",target:"D2"}),
  ]));
  const hostile=baseState(relationMap([
    relation({type:"team",target:"T1",trust:15,satisfaction:10,respect:40,affinity:20}),
    relation({type:"manager",target:"player_manager",trust:20,respect:30,affinity:20,satisfaction:15}),
    relation({type:"teammate",target:"D2",trust:15,respect:35,affinity:10,satisfaction:15,rivalry:85}),
  ]),{
    driverRivalries:{
      version:1,
      pairs:{
        "D1|D2":{
          pair_key:"D1|D2",driver_a_id:"D1",driver_b_id:"D2",
          rivalry:90,respect_a_to_b:35,respect_b_to_a:35,status:"defining",active:true,years:[1980],
        },
      },
      log:[],
    },
  });
  const normal=teamOrderComplianceProfile(neutral,"D1","D2",{teamId:"T1"});
  const tense=teamOrderComplianceProfile(hostile,"D1","D2",{teamId:"T1"});
  assert.ok(normal.probability>=0.95);
  assert.equal(normal.at_risk,false);
  assert.ok(tense.probability<0.80);
  assert.equal(tense.at_risk,true);
});

test("D6.3F strong rivalry affects only temporary confidence after a direct race comparison",()=>{
  const gs=baseState({},{
    driverRivalries:{
      version:1,
      pairs:{
        "D1|D3":{
          pair_key:"D1|D3",driver_a_id:"D1",driver_b_id:"D3",
          rivalry:80,respect_a_to_b:75,respect_b_to_a:70,status:"intense",active:true,years:[1980],
        },
      },
      log:[],
    },
  });
  const result={
    year:1980,round:8,gp_id:"GP8",
    classification:[
      {driver_id:"D1",team_id:"T1",position:2,status:"Finished",retired:false},
      {driver_id:"D3",team_id:"T2",position:3,status:"Finished",retired:false},
    ],
  };
  const effect=relationshipRaceMentalAdjustment(gs,"D1",result);
  assert.equal(effect.morale,0);
  assert.ok(effect.confidence>0.6&&effect.confidence<=0.8);
  assert.equal(effect.meta.rival_driver_id,"D3");

  const next=applyRaceRelationshipConsequences(gs,result);
  assert.equal(next.driverAttributes.D1.morale,50);
  assert.ok(next.driverAttributes.D1.confidence>50);
  assert.equal(next.driverAttributes.D3.confidence<50,true);
  assert.ok((next.driverMentalStateLog.D1||[]).some((row)=>row.source==="relationship_consequences"));
});

test("D6.3F consequence profile exposes playtest-facing values",()=>{
  const gs=baseState(relationMap([
    relation({type:"team",target:"T1",trust:70,satisfaction:75,respect:65,affinity:60}),
    relation({type:"manager",target:"player_manager",trust:70,satisfaction:70,respect:70,affinity:60}),
    relation({type:"race_engineer",target:"E1",trust:80,respect:80,affinity:75,satisfaction:70}),
    relation({type:"teammate",target:"D2",trust:65,respect:70,affinity:60,satisfaction:65,rivalry:20}),
  ]));
  const profile=driverRelationshipConsequenceProfile(gs,"D1",{teamId:"T1",teammateId:"D2"});
  assert.ok(profile.climate.score>60);
  assert.ok(profile.engineer.multiplier>1);
  assert.ok(profile.renewal_acceptance_delta>0);
  assert.ok(profile.team_order.probability>0.90);
});

test("D6.3F live team order refusal is deterministic when relationship risk is high",()=>{
  let gs=baseState(relationMap([
    relation({type:"team",target:"T1",trust:0,satisfaction:0,respect:20,affinity:10}),
    relation({type:"manager",target:"player_manager",trust:0,respect:10,affinity:10,satisfaction:0}),
    relation({type:"teammate",target:"D2",trust:0,respect:10,affinity:0,satisfaction:0,rivalry:100}),
  ]),{
    driverRivalries:{
      version:1,
      pairs:{
        "D1|D2":{
          pair_key:"D1|D2",driver_a_id:"D1",driver_b_id:"D2",
          rivalry:100,respect_a_to_b:20,respect_b_to_a:20,status:"defining",active:true,years:[1980],
        },
      },
      log:[],
    },
    raceEntryState:{entries:[
      {driver_id:"D1",team_id:"T1"},
      {driver_id:"D2",team_id:"T1"},
    ]},
    raceWeekendState:{
      key:"1980-test",
      phase:"race",
      race_strategy:{live_commands:{}},
      live_race:{
        status:"running",current_lap:10,current_sector:3,total_laps:50,
        events:[],
        classification:[
          {driver_id:"D1",position:4,retired:false,gap_to_previous_ms:1200},
          {driver_id:"D2",position:5,retired:false,gap_to_previous_ms:900},
        ],
      },
    },
  });

  const profile=teamOrderComplianceProfile(gs,"D1","D2",{teamId:"T1"});
  assert.ok(profile.probability<=0.70);

  // Pick a deterministic career seed whose relationship roll falls above the
  // calculated compliance chance. This proves refusal without hard-coding an RNG value.
  let chosen=null;
  for(let i=1;i<=200;i++){
    const candidate={...gs,saveMeta:{seed:"d63f-refusal-"+i}};
    const roll=rngFor(candidate,"team-order-compliance:1980-test:D1:D2:11").next();
    if(roll>profile.probability){chosen=candidate;break;}
  }
  assert.ok(chosen,"expected to find a deterministic refusal seed");

  const next=issueLiveRaceCommand(chosen,{
    driverId:"D1",type:"team_order",teamOrder:"yield",teammateId:"D2",
  });
  assert.equal(next.raceWeekendState.race_strategy.live_commands.D1,undefined);
  const refusal=next.raceWeekendState.live_race.events.at(-1);
  assert.equal(refusal.type,"driver_feedback");
  assert.equal(refusal.feedback_kind,"team_order_refused");
  assert.equal(refusal.driver_id,"D1");
});
