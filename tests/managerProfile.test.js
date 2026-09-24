import test from "node:test";
import assert from "node:assert/strict";

import {
  createManagerProfile,
  deriveManagerAttributes,
  managerGameplayEffects,
} from "../src/domain/managerProfile.js";
import { deriveBoardState } from "../src/domain/boardState.js";
import { contractAcceptanceChance, expectedDriverSalary } from "../src/domain/driverContracts.js";
import { applyRaceTeamMorale } from "../src/domain/teamMorale.js";

function playerManager(overrides={}){
  return createManagerProfile({
    first_name:"Test",
    last_name:"Manager",
    nationality_name:"Portuguese",
    date_of_birth:"1945-01-01",
    background:"newcomer",
    experience_level:"experienced",
    ...overrides,
  },{
    year:1980,
    team:{team_id:"T1",team_name:"Player Team"},
  });
}

function baseState(manager=null){
  return {
    activeYear:1980,
    currentDateISO:"1980-03-01",
    team:{team_id:"T1",team_name:"Player Team"},
    manager,
    teams:[
      {team_id:"T1",team_name:"Player Team"},
      {team_id:"T2",team_name:"AI Team"},
    ],
    teamBrands:[
      {team_id:"T1",board_expectation:"midfield"},
      {team_id:"T2",board_expectation:"midfield"},
    ],
    standings:{teams:[],drivers:[]},
    calendar:Array.from({length:14},(_,i)=>({round:i+1})),
    results:[],
    drivers:[
      {driver_id:"D3",display_name:"Free Star",status:"eligible"},
    ],
    driverRatings:[
      {driver_id:"D3",current_ability:76,pace:80,reputation:70,market_value:1_500_000},
    ],
    contracts:[],
    teamOperationalState:{T1:{morale:50},T2:{morale:50}},
    teamMoraleLog:{},
  };
}

test("manager backgrounds are balanced trade-offs rather than free overall points",()=>{
  const newcomer=deriveManagerAttributes({background:"newcomer",experience:"experienced"});
  const engineer=deriveManagerAttributes({background:"engineer",experience:"experienced"});
  const commercial=deriveManagerAttributes({background:"commercial",experience:"experienced"});

  const total=(row)=>Object.values(row).reduce((sum,value)=>sum+value,0);
  assert.equal(total(newcomer),total(engineer));
  assert.equal(total(newcomer),total(commercial));
  assert.ok(engineer.technical>newcomer.technical);
  assert.ok(engineer.commercial<newcomer.commercial);
  assert.ok(commercial.negotiation>newcomer.negotiation);
  assert.ok(commercial.technical<newcomer.technical);
});

test("experience trades starting strength and reputation for growth potential",()=>{
  const rookie=playerManager({experience_level:"rookie"});
  const veteran=playerManager({experience_level:"veteran"});

  assert.ok(veteran.attributes.leadership>rookie.attributes.leadership);
  assert.ok(veteran.reputation>rookie.reputation);
  assert.ok(rookie.potential>veteran.potential);
});

test("manager gameplay modifiers only apply to the player team",()=>{
  const manager=playerManager({
    attributes:{
      leadership:90,personnel:90,negotiation:90,technical:90,commercial:90,race_management:90,
    },
  });
  const gs=baseState(manager);
  const player=managerGameplayEffects(gs,{teamId:"T1"});
  const ai=managerGameplayEffects(gs,{teamId:"T2"});

  assert.equal(player.active,true);
  assert.ok(player.contractAcceptanceDelta>0);
  assert.ok(player.relationshipPositiveMultiplier>1);
  assert.ok(player.relationshipNegativeMultiplier<1);
  assert.ok(player.technicalTimeMultiplier<1);
  assert.equal(ai.active,false);
  assert.equal(ai.contractAcceptanceDelta,0);
  assert.equal(ai.relationshipPositiveMultiplier,1);
  assert.equal(ai.relationshipNegativeMultiplier,1);
  assert.equal(ai.technicalTimeMultiplier,1);
});

test("leadership changes board confidence modestly without replacing objectives",()=>{
  const low=baseState(playerManager({attributes:{leadership:20}}));
  const high=baseState(playerManager({attributes:{leadership:90}}));
  const lowBoard=deriveBoardState(low);
  const highBoard=deriveBoardState(high);

  assert.ok(highBoard.confidence>lowBoard.confidence);
  assert.ok(highBoard.confidence-lowBoard.confidence<0.10);
  assert.deepEqual(
    highBoard.objectives.map((row)=>row.id),
    lowBoard.objectives.map((row)=>row.id)
  );
});

test("negotiation skill improves player contract acceptance but never buffs an AI team",()=>{
  const weak=baseState(playerManager({attributes:{negotiation:20}}));
  const strong=baseState(playerManager({attributes:{negotiation:90}}));
  const expected=expectedDriverSalary(strong,"D3");
  const offer={salary:expected,years:2,role:"Main Driver"};

  const weakPlayer=contractAcceptanceChance(weak,"D3",offer,{teamId:"T1"});
  const strongPlayer=contractAcceptanceChance(strong,"D3",offer,{teamId:"T1"});
  const weakAI=contractAcceptanceChance(weak,"D3",offer,{teamId:"T2"});
  const strongAI=contractAcceptanceChance(strong,"D3",offer,{teamId:"T2"});

  assert.ok(strongPlayer>weakPlayer);
  assert.equal(strongAI,weakAI);
});

test("people management amplifies good morale and cushions bad morale for the player team",()=>{
  const weak=baseState(playerManager({attributes:{leadership:20,personnel:20}}));
  const strong=baseState(playerManager({attributes:{leadership:90,personnel:90}}));

  const winRace=[{team_id:"T1",driver_id:"D3",position:1,pos:1,points:10,retired:false}];
  const dnfRace=[
    {team_id:"T1",driver_id:"D3",retired:true,retirement_reason:"Mechanical"},
    {team_id:"T1",driver_id:"D4",retired:true,retirement_reason:"Mechanical"},
  ];

  const weakWin=applyRaceTeamMorale(weak,{race:winRace,gp:{name:"Test GP"}});
  const strongWin=applyRaceTeamMorale(strong,{race:winRace,gp:{name:"Test GP"}});
  assert.ok(strongWin.teamOperationalState.T1.morale>weakWin.teamOperationalState.T1.morale);

  const weakDnf=applyRaceTeamMorale(weak,{race:dnfRace,gp:{name:"Test GP"}});
  const strongDnf=applyRaceTeamMorale(strong,{race:dnfRace,gp:{name:"Test GP"}});
  assert.ok(strongDnf.teamOperationalState.T1.morale>weakDnf.teamOperationalState.T1.morale);
});

test("technical and race-management modifiers stay deliberately bounded",()=>{
  const manager=playerManager({
    attributes:{technical:99,race_management:99},
  });
  const effects=managerGameplayEffects(baseState(manager),{teamId:"T1"});

  assert.ok(effects.technicalTimeMultiplier>=0.94);
  assert.ok(effects.technicalRiskMultiplier>=0.90);
  assert.ok(effects.raceExecutionErrorMultiplier>=0.92);
  assert.ok(Math.abs(effects.raceStrategyQualityDelta)<=0.05);
});
