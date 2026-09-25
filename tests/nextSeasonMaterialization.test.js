import test from "node:test";
import assert from "node:assert/strict";

import {
  materializeNextSeasonCarStats,
  materializeNextSeasonTechnicalWorld,
  materializeTeamNextSeasonCar,
} from "../src/domain/nextSeasonMaterialization.js";
import { materializeNextCareerSeason } from "../src/core/careerBoundary.js";

function packageFor(values={},progress=100,status="completed"){
  const ids=["aero","chassis","powertrain","hybrid","cooling","reliability"];
  const rows=ids.map((id)=>{
    const v=Number(values[id]??80);
    return {
      id,
      applicable:id!=="hybrid",
      projected:v,
      integrated_projected:v,
      validated:v,
    };
  });
  return {
    targetSeason:1981,
    status,
    overall_progress:progress,
    readiness:progress>=100?"validated":progress>=85?"validating":progress>=60?"integrating":"designing",
    technical_philosophy:{id:"balanced"},
    technical_package:{
      version:2,
      targetSeason:1981,
      progress,
      readiness:progress>=100?"validated":progress>=85?"validating":progress>=60?"integrating":"designing",
      philosophy:{id:"balanced"},
      areas:Object.fromEntries(rows.map((row)=>[row.id,row])),
      rows,
    },
  };
}

function fixture(){
  return {
    activeYear:1980,
    currentDateISO:"1980-12-31",
    currentRound:1,
    team:{team_id:"PLAYER",name:"Player",budget:2_000_000},
    finances:{balance:2_000_000},
    teams:[
      {team_id:"PLAYER",team_name:"Player"},
      {team_id:"AI",team_name:"AI"},
    ],
    carStats:[
      {
        year:1980,team_id:"PLAYER",
        chassis_spec:78,aero_spec:80,gearbox_spec:77,
        suspension_spec:76,brakes_spec:74,cooling_spec:75,
        turbo_spec:0,reliability:0.80,weight:595,
      },
      {
        year:1980,team_id:"AI",
        chassis_spec:70,aero_spec:69,gearbox_spec:71,
        suspension_spec:70,brakes_spec:72,cooling_spec:68,
        turbo_spec:0,reliability:0.70,weight:605,
      },
    ],
    dbCarStats:[
      {year:1981,team_id:"PLAYER",chassis_spec:99,aero_spec:99,gearbox_spec:99,suspension_spec:99,brakes_spec:99,cooling_spec:99,reliability:0.99},
      {year:1981,team_id:"AI",chassis_spec:1,aero_spec:1,gearbox_spec:1,suspension_spec:1,brakes_spec:1,cooling_spec:1,reliability:0.01},
    ],
    development:{
      projects:[],parts:[],partUnits:[],manufacturing:[],research:[],
      technicalKnowledge:null,
      technicalStrategy:{id:"next_season_priority"},
      nextSeasonCar:packageFor({aero:84,chassis:82,powertrain:81,cooling:80,reliability:88}),
    },
    aiTechnicalWorld:{
      version:1,
      teams:{
        AI:{
          development:{
            projects:[],parts:[],partUnits:[],manufacturing:[],research:[],
            technicalKnowledge:null,
            technicalStrategy:{id:"future_first"},
            nextSeasonCar:packageFor({aero:76,chassis:75,powertrain:74,cooling:73,reliability:78}),
          },
        },
      },
    },
    standings:{drivers:[],teams:[]},
    results:[],
    historySeasons:[],
    inbox:[],
    drivers:[],driverRatings:[],contracts:[],
    staffCore:[],staffRatings:[],staffContracts:[],
    teamBrands:[],teamEngines:[],facilities:[],sponsorsContracts:[],
    dbCalendar:[],calendar:[],
    dbDrivers:[],dbDriverRatings:[],dbStaffCore:[],dbStaffRatings:[],dbStaffContracts:[],
    dbTeams:[
      {team_id:"PLAYER",founded_year:1970},
      {team_id:"AI",founded_year:1970},
    ],
    dbTeamSeasons:[],dbTeamBrands:[],dbContracts:[],
    dbRules:[],dbEraSafety:[],dbAccidentModel:[],dbPointsSystems:[],
    dbTyres:[],dbPenaltiesRules:[],dbFinancialRules:[],dbAgendaBlocks:[],
  };
}

test("validated package becomes target-year carStats while preserving component character",()=>{
  const state=fixture();
  const source=state.carStats[0];
  const next=materializeTeamNextSeasonCar(
    source,
    state.development.nextSeasonCar,
    1981
  );

  assert.equal(next.year,1981);
  assert.equal(next.aero_spec,84);
  assert.ok(next.chassis_spec>next.suspension_spec);
  assert.ok(next.suspension_spec>next.brakes_spec);
  assert.equal(next.gearbox_spec,81);
  assert.equal(next.cooling_spec,80);
  assert.equal(next.reliability,0.88);
  assert.equal(next.turbo_spec,0,"rollover must not invent a turbo for a naturally aspirated car");
  assert.equal(next.weight,595,"unmodelled physical properties carry forward in 7.7A");
  assert.equal(next.generation_source,"next_season_technical_package");
});

test("an incomplete programme blends toward its achieved package and applies a readiness penalty",()=>{
  const source=fixture().carStats[0];
  const half=materializeTeamNextSeasonCar(
    source,
    packageFor({aero:90,chassis:88,powertrain:87,cooling:86,reliability:92},50,"active"),
    1981
  );
  const full=materializeTeamNextSeasonCar(
    source,
    packageFor({aero:90,chassis:88,powertrain:87,cooling:86,reliability:92},100,"completed"),
    1981
  );

  assert.ok(half.aero_spec>source.aero_spec);
  assert.ok(half.aero_spec<full.aero_spec);
  assert.ok(half.chassis_spec<full.chassis_spec);
  assert.equal(half.next_season_programme_progress,50);
});

test("no usable programme carries the simulated car forward instead of importing history",()=>{
  const state=fixture();
  state.development.nextSeasonCar=null;
  state.aiTechnicalWorld.teams.AI.development.nextSeasonCar=null;
  const rows=materializeNextSeasonCarStats(state,1981);
  const player=rows.find((row)=>row.team_id==="PLAYER");
  const ai=rows.find((row)=>row.team_id==="AI");

  assert.equal(player.chassis_spec,78);
  assert.equal(ai.chassis_spec,70);
  assert.equal(player.generation_source,"simulated_car_carryover");
  assert.equal(ai.generation_source,"simulated_car_carryover");
});

test("AI teams materialise their own Next Season package, independently of the player",()=>{
  const state=fixture();
  const rows=materializeNextSeasonCarStats(state,1981);
  const player=rows.find((row)=>row.team_id==="PLAYER");
  const ai=rows.find((row)=>row.team_id==="AI");

  assert.equal(player.aero_spec,84);
  assert.equal(ai.aero_spec,76);
  assert.equal(player.reliability,0.88);
  assert.equal(ai.reliability,0.78);
});

test("career rollover ignores impossible future historical carStats and archives the player programme",()=>{
  const state=fixture();
  const next=materializeNextCareerSeason(state,1981);
  const player=next.carStats.find((row)=>row.team_id==="PLAYER");
  const ai=next.carStats.find((row)=>row.team_id==="AI");

  assert.equal(player.year,1981);
  assert.notEqual(player.chassis_spec,99);
  assert.notEqual(ai.chassis_spec,1);
  assert.equal(player.generation_source,"next_season_technical_package");
  assert.equal(ai.generation_source,"next_season_technical_package");

  assert.equal(next.development.nextSeasonCar,null);
  assert.equal(next.development.technicalStrategy,null);
  assert.equal(next.development.nextSeasonHistory.length,1);
  assert.equal(next.development.nextSeasonHistory[0].target_season,1981);
  assert.equal(next.development.nextSeasonHistory[0].progress,100);
  assert.equal(next.development.nextSeasonHistory[0].technical_package.version,2);
});

test("player rollover archive is idempotent for the same target season",()=>{
  const state=fixture();
  const once=materializeNextSeasonTechnicalWorld(state,1981);
  const replay={
    ...state,
    development:{
      ...state.development,
      nextSeasonHistory:once.development.nextSeasonHistory,
    },
  };
  const twice=materializeNextSeasonTechnicalWorld(replay,1981);
  assert.equal(twice.development.nextSeasonHistory.length,1);
  assert.equal(twice.development.nextSeasonHistory[0].target_season,1981);
});
