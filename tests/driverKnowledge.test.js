import test from "node:test";
import assert from "node:assert/strict";
import {
  DRIVER_KNOWLEDGE_LEVELS,
  driverKnowledgeState,
  presentDriverKnowledgeValue,
} from "../src/domain/driverKnowledge.js";
import { driverScoutingFamiliarity, specificScoutingPlan } from "../src/domain/scoutingPolicy.js";

function baseState(){
  return {
    activeYear:1980,
    careerMeta:{sourceSeason:1980},
    team:{team_id:"T1",team_name:"Player Team"},
    drivers:[
      {driver_id:"D1",display_name:"Own Driver",status:"eligible"},
      {driver_id:"D2",display_name:"Rival Driver",status:"eligible"},
      {driver_id:"D3",display_name:"Regional Prospect",status:"lower_series",active_lower_series:true},
      {driver_id:"D4",display_name:"Unknown Prospect",status:"lower_series",active_lower_series:true},
      {driver_id:"D5",display_name:"Academy Driver",status:"junior_only",active_lower_series:true},
      {driver_id:"D6",display_name:"Fully Scouted",status:"lower_series",active_lower_series:true},
    ],
    driverRatings:[
      {driver_id:"D1",current_ability:82,potential_ability:88,pace:84},
      {driver_id:"D2",current_ability:80,potential_ability:85,pace:81},
      {driver_id:"D3",current_ability:67,potential_ability:86,pace:69},
      {driver_id:"D4",current_ability:66,potential_ability:90,pace:65},
      {driver_id:"D5",current_ability:64,potential_ability:89,pace:63},
      {driver_id:"D6",current_ability:70,potential_ability:91,pace:72},
    ],
    contracts:[
      {year:1980,team_id:"T1",driver_id:"D1",role:"main_driver",status:"active"},
      {year:1980,team_id:"T2",driver_id:"D2",role:"main_driver",status:"active"},
    ],
    academy:{
      drivers:[{driver_id:"D5",status:"active",mode:"academy"}],
    },
    scouting:{
      assignments:[
        {
          id:"regional_1",
          mode:"region",
          status:"completed",
          completed_at:"1980-03-10",
          discovered_ids:["D3"],
        },
        {
          id:"driver_1",
          mode:"driver",
          status:"completed",
          completed_at:"1980-03-15",
          prospect_id:"D6",
        },
      ],
    },
    driverCareer:[
      {year:1979,driver_id:"D2",series_division:"F1",starts:10},
    ],
  };
}

test("knowledge policy separates own, public, regional, full scout and unknown drivers",()=>{
  const gs=baseState();
  assert.equal(driverKnowledgeState(gs,"D1").level,DRIVER_KNOWLEDGE_LEVELS.OWN);
  assert.equal(driverKnowledgeState(gs,"D2").level,DRIVER_KNOWLEDGE_LEVELS.PUBLIC);
  assert.equal(driverKnowledgeState(gs,"D3").level,DRIVER_KNOWLEDGE_LEVELS.DISCOVERED);
  assert.equal(driverKnowledgeState(gs,"D4").level,DRIVER_KNOWLEDGE_LEVELS.UNKNOWN);
  assert.equal(driverKnowledgeState(gs,"D5").level,DRIVER_KNOWLEDGE_LEVELS.ACADEMY);
  assert.equal(driverKnowledgeState(gs,"D6").level,DRIVER_KNOWLEDGE_LEVELS.SCOUTED);
});

test("own and fully scouted drivers reveal exact ability while public drivers only expose ranges",()=>{
  const gs=baseState();
  const own=driverKnowledgeState(gs,"D1");
  const publicDriver=driverKnowledgeState(gs,"D2");
  const scouted=driverKnowledgeState(gs,"D6");

  const ownAbility=presentDriverKnowledgeValue(own,"current_ability",82,{kind:"ability"});
  const publicAbility=presentDriverKnowledgeValue(publicDriver,"current_ability",80,{kind:"ability"});
  const scoutedPotential=presentDriverKnowledgeValue(scouted,"potential_ability",91,{kind:"potential"});

  assert.equal(ownAbility.visibility,"exact");
  assert.equal(ownAbility.label,"82");
  assert.equal(publicAbility.visibility,"range");
  assert.ok(publicAbility.min<=80&&publicAbility.max>=80);
  assert.notEqual(publicAbility.sortValue,80);
  assert.equal(scoutedPotential.visibility,"exact");
  assert.equal(scoutedPotential.label,"91");
});

test("regional scouting exposes estimate ranges without revealing exact midpoint",()=>{
  const gs=baseState();
  const knowledge=driverKnowledgeState(gs,"D3");
  const ability=presentDriverKnowledgeValue(knowledge,"pace",69,{kind:"attribute"});
  const potential=presentDriverKnowledgeValue(knowledge,"potential_ability",86,{kind:"potential"});

  assert.equal(ability.visibility,"range");
  assert.equal(potential.visibility,"range");
  assert.ok(ability.min<=69&&ability.max>=69);
  assert.ok(potential.min<=86&&potential.max>=86);
  assert.notEqual(ability.sortValue,69);
  assert.notEqual(potential.sortValue,86);
});

test("unknown prospects expose broad rating estimates without leaking private condition",()=>{
  const gs=baseState();
  const knowledge=driverKnowledgeState(gs,"D4");

  const pace=presentDriverKnowledgeValue(knowledge,"pace",65,{kind:"attribute"});
  const potential=presentDriverKnowledgeValue(knowledge,"potential_ability",90,{kind:"potential"});
  assert.equal(pace.visibility,"range");
  assert.equal(potential.visibility,"range");
  assert.ok(pace.min<=65&&pace.max>=65);
  assert.ok(potential.min<=90&&potential.max>=90);
  assert.equal(presentDriverKnowledgeValue(knowledge,"fatigue",12,{kind:"condition"}).label,"?");
  assert.equal(knowledge.canSeeCondition,false);
  assert.equal(knowledge.canSeeDevelopmentHistory,false);
});

test("light scouting narrows estimates while deep scouting reveals exact ratings",()=>{
  const gs=baseState();
  const unknown=driverKnowledgeState(gs,"D4");
  const before=presentDriverKnowledgeValue(unknown,"pace",65,{kind:"attribute"});

  gs.scouting.assignments.push({
    id:"driver_light",mode:"driver",depth:"light",status:"completed",
    completed_at:"1980-03-20",prospect_id:"D4",
  });
  const light=driverKnowledgeState(gs,"D4");
  const lightValue=presentDriverKnowledgeValue(light,"pace",65,{kind:"attribute"});
  assert.equal(light.level,DRIVER_KNOWLEDGE_LEVELS.SCOUTED_LIGHT);
  assert.equal(lightValue.visibility,"range");
  assert.ok((lightValue.max-lightValue.min)<(before.max-before.min));

  gs.scouting.assignments.push({
    id:"driver_deep",mode:"driver",depth:"deep",status:"completed",
    completed_at:"1980-03-25",prospect_id:"D4",
  });
  const deep=driverKnowledgeState(gs,"D4");
  assert.equal(deep.level,DRIVER_KNOWLEDGE_LEVELS.SCOUTED);
  assert.equal(presentDriverKnowledgeValue(deep,"pace",65,{kind:"attribute"}).label,"65");
});

test("a later light report never downgrades previously unlocked deep knowledge",()=>{
  const gs=baseState();
  gs.scouting.assignments.push({
    id:"deep_first",mode:"driver",depth:"deep",status:"completed",
    completed_at:"1980-03-20",prospect_id:"D4",
  });
  gs.scouting.assignments.push({
    id:"light_later",mode:"driver",depth:"light",status:"completed",
    completed_at:"1980-03-25",prospect_id:"D4",
  });
  const knowledge=driverKnowledgeState(gs,"D4");
  assert.equal(knowledge.level,DRIVER_KNOWLEDGE_LEVELS.SCOUTED);
  assert.equal(presentDriverKnowledgeValue(knowledge,"pace",65,{kind:"attribute"}).label,"65");
});

test("reputation and F1 experience reduce scouting duration, and light reports are quicker",()=>{
  const gs=baseState();
  gs.drivers.push({driver_id:"STAR",display_name:"Established Star",reputation:90,status:"eligible"});
  gs.driverRatings.push({driver_id:"STAR",current_ability:88,potential_ability:90,pace:89,reputation:90});
  gs.driverCareer.push({year:1978,driver_id:"STAR",series_division:"F1",starts:16});
  gs.driverCareer.push({year:1979,driver_id:"STAR",series_division:"F1",starts:15});
  gs.contracts.push({year:1980,team_id:"T2",driver_id:"STAR",role:"Main Driver",status:"active"});

  const star=driverScoutingFamiliarity(gs,"STAR");
  const youth=driverScoutingFamiliarity(gs,"D4");
  assert.ok(star.score>youth.score);

  const starDeep=specificScoutingPlan(gs,"STAR",{depth:"deep",travelDays:4,networkQuality:60,weeklyCost:20000});
  const youthDeep=specificScoutingPlan(gs,"D4",{depth:"deep",travelDays:4,networkQuality:60,weeklyCost:20000});
  const youthLight=specificScoutingPlan(gs,"D4",{depth:"light",travelDays:4,networkQuality:60,weeklyCost:20000});
  assert.ok(starDeep.duration<youthDeep.duration);
  assert.ok(youthLight.duration<youthDeep.duration);
  assert.ok(youthLight.cost<youthDeep.cost);
});

test("only current team drivers expose private condition while Academy keeps full rating knowledge",()=>{
  const gs=baseState();
  const own=driverKnowledgeState(gs,"D1");
  const academy=driverKnowledgeState(gs,"D5");

  assert.equal(own.canSeeCondition,true);
  assert.equal(academy.canSeeCondition,false);
  assert.equal(academy.canSeeDevelopmentHistory,true);
  assert.equal(
    presentDriverKnowledgeValue(academy,"potential_ability",89,{kind:"potential"}).label,
    "89"
  );
});
