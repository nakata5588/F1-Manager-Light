import test from "node:test";
import assert from "node:assert/strict";
import {
  aggregateHistoricalConstructors,
  constructorChampionForYear,
  constructorChampionshipHistory,
  driverConstructorChampionships,
  teamChampionshipSummary,
} from "../src/domain/championshipHistory.js";

function fixture(){
  return {
    activeYear:1980,
    careerMeta:{sourceSeason:1980},
    dbTeams:[
      {team_id:"LOTUS",team_name:"Lotus"},
      {team_id:"FERRARI",team_name:"Ferrari"},
      {team_id:"MCLAREN",team_name:"McLaren"},
    ],
    dbDriverHistory:[
      {year:1978,series_division:"F1",driver_id:"A",team_id:"LOTUS",team_name:"Lotus",points:64,wins:6,podiums:9,races:16},
      {year:1978,series_division:"F1",driver_id:"B",team_id:"LOTUS",team_name:"Lotus",points:51,wins:2,podiums:7,races:16},
      {year:1978,series_division:"F1",driver_id:"C",team_id:"FERRARI",team_name:"Ferrari",points:48,wins:4,podiums:7,races:16},
      {year:1978,series_division:"F1",driver_id:"D",team_id:"FERRARI",team_name:"Ferrari",points:17,wins:1,podiums:3,races:16},

      {year:1979,series_division:"F1",driver_id:"E",team_id:"FERRARI",team_name:"Ferrari",points:51,wins:3,podiums:6,races:15},
      {year:1979,series_division:"F1",driver_id:"D",team_id:"FERRARI",team_name:"Ferrari",points:47,wins:3,podiums:7,races:15},
      {year:1979,series_division:"F1",driver_id:"A",team_id:"LOTUS",team_name:"Lotus",points:14,wins:0,podiums:1,races:15},
    ],
    dbAchievements:[
      {year:1978,driver_id:"A",driver_name:"Andretti",team_id:"LOTUS",team_name:"Lotus",driver_championship:1},
      {year:1978,driver_id:"C",driver_name:"Reutemann",team_id:"FERRARI",team_name:"Ferrari",driver_championship:3},
      {year:1979,driver_id:"E",driver_name:"Scheckter",team_id:"FERRARI",team_name:"Ferrari",driver_championship:1},
      {year:1979,driver_id:"D",driver_name:"Villeneuve",team_id:"FERRARI",team_name:"Ferrari",driver_championship:2},
    ],
    historySeasons:[],
  };
}

test("historical constructor standings use the same points table as Standings",()=>{
  const gs=fixture();
  const standings=aggregateHistoricalConstructors(gs.dbDriverHistory,1978,gs.dbTeams);
  assert.equal(standings[0].id,"LOTUS");
  assert.equal(standings[0].position,1);
  assert.equal(standings[0].points,115);
  assert.equal(standings[1].id,"FERRARI");
});

test("constructor champion is derived automatically from historical standings",()=>{
  const champion=constructorChampionForYear(fixture(),1978);
  assert.equal(champion.team_id,"LOTUS");
  assert.equal(champion.team_name,"Lotus");
  assert.equal(champion.source,"historical_standings");
});

test("team championship summary counts only P1 driver titles and standings-derived constructor titles",()=>{
  const gs=fixture();
  const lotus=teamChampionshipSummary(gs,"LOTUS");
  const ferrari=teamChampionshipSummary(gs,"FERRARI");

  assert.equal(lotus.driversTitles,1);
  assert.equal(lotus.constructors,1);
  assert.equal(ferrari.driversTitles,1,"P2/P3 must not be counted as Drivers Championships");
  assert.equal(ferrari.constructors,1);
});

test("played Save World standings override the historical future",()=>{
  const gs={
    ...fixture(),
    activeYear:1981,
    careerMeta:{sourceSeason:1980},
    historySeasons:[{
      year:1980,
      standings:{
        teams:[
          {team_id:"FERRARI",team_name:"Ferrari",position:1,points:100},
          {team_id:"LOTUS",team_name:"Lotus",position:2,points:90},
        ],
        drivers:[],
      },
    }],
  };
  const history=constructorChampionshipHistory(gs);
  const champion1980=history.find((row)=>row.year===1980);
  assert.equal(champion1980.team_id,"FERRARI");
  assert.equal(champion1980.source,"save_world");
});


test("driver constructor titles only include seasons where his team was champion",()=>{
  const gs=fixture();
  gs.dbDriverHistory.push(
    {year:1972,series_division:"F1",driver_id:"S",team_id:"MCLAREN",team_name:"McLaren",points:0,wins:0,podiums:0,races:1},
    {year:1972,series_division:"F1",driver_id:"L1",team_id:"LOTUS",team_name:"Lotus",points:61,wins:5,podiums:8,races:12},
    {year:1972,series_division:"F1",driver_id:"L2",team_id:"LOTUS",team_name:"Lotus",points:10,wins:0,podiums:1,races:12},
    {year:1972,series_division:"F1",driver_id:"M1",team_id:"MCLAREN",team_name:"McLaren",points:35,wins:1,podiums:5,races:12}
  );
  const career=[
    {year:1972,series_division:"F1",team_id:"MCLAREN",team_name:"McLaren"},
    {year:1979,series_division:"F1",team_id:"FERRARI",team_name:"Ferrari"},
  ];
  const titles=driverConstructorChampionships(gs,career);
  assert.deepEqual(titles.map((row)=>[row.year,row.team_id]),[[1979,"FERRARI"]]);
});
