import test from "node:test";
import assert from "node:assert/strict";
import {
  championshipPointsSystem,
  championshipRuleForYear,
  countChampionshipPoints,
  racePointsForResult,
  shortenedRacePointsTable,
} from "../src/domain/championshipRules.js";

test("championship rules cover every major Formula 1 scoring era",()=>{
  const r1950=championshipRuleForYear(1950);
  assert.deepEqual(r1950.racePoints,[8,6,4,3,2]);
  assert.equal(r1950.fastestLap.points,1);
  assert.equal(r1950.constructorChampionship,false);
  assert.deepEqual(r1950.driverCounting,{type:"best",count:4});

  const r1958=championshipRuleForYear(1958);
  assert.equal(r1958.constructorChampionship,true);
  assert.equal(r1958.constructorCarsScoring,"best_one");
  assert.deepEqual(r1958.driverCounting,{type:"best",count:6});

  const r1961=championshipRuleForYear(1961);
  assert.deepEqual(r1961.racePoints,[9,6,4,3,2,1]);
  assert.deepEqual(r1961.constructorRacePoints,[8,6,4,3,2,1]);
  assert.deepEqual(r1961.driverCounting,{type:"best",count:5});

  assert.deepEqual(championshipRuleForYear(1963).driverCounting,{type:"best",count:6});
  assert.equal(championshipRuleForYear(1978).constructorCarsScoring,"best_one");
  assert.equal(championshipRuleForYear(1979).constructorCarsScoring,"all");
  assert.deepEqual(championshipRuleForYear(1980).driverCounting,{
    type:"split",
    segments:[{from:1,to:7,count:5},{from:8,to:14,count:5}],
  });
  assert.deepEqual(championshipRuleForYear(1981).driverCounting,{type:"best",count:11});
  assert.deepEqual(championshipRuleForYear(1991).racePoints,[10,6,4,3,2,1]);
  assert.deepEqual(championshipRuleForYear(2003).racePoints,[10,8,6,5,4,3,2,1]);
  assert.deepEqual(championshipRuleForYear(2010).racePoints,[25,18,15,12,10,8,6,4,2,1]);
  assert.equal(championshipRuleForYear(2014).finalRaceMultiplier,2);
  assert.equal(championshipRuleForYear(2019).fastestLap.points,1);
  assert.equal(championshipRuleForYear(2024).fastestLap.eligibility,"top_10");
  assert.equal(championshipRuleForYear(2025).fastestLap.points,0);
  assert.deepEqual(championshipRuleForYear(2021).sprintPoints,[3,2,1]);
  assert.deepEqual(championshipRuleForYear(2022).sprintPoints,[8,7,6,5,4,3,2,1]);
});

test("1963 counts only a driver's best six results",()=>{
  const events=[
    {round:1,points:9},{round:2,points:9},{round:3,points:9},
    {round:4,points:9},{round:5,points:9},{round:6,points:9},
    {round:7,points:9},{round:8,points:6},{round:9,points:4},
  ];
  assert.equal(events.reduce((sum,row)=>sum+row.points,0),73);
  assert.equal(countChampionshipPoints(events,championshipRuleForYear(1963).driverCounting),54);
});

test("split-season discard rules select the best results inside each half",()=>{
  const events=Array.from({length:14},(_,index)=>({
    round:index+1,
    points:index<7?[9,6,4,3,2,1,1][index]:[9,6,4,3,2,1,1][index-7],
  }));
  assert.equal(countChampionshipPoints(events,championshipRuleForYear(1980).driverCounting),48);
});

test("1988 best-eleven rule can reverse gross-points ordering",()=>{
  const prost=[9,6,9,9,6,6,9,0,6,6,6,0,9,9,6,9].map((points,index)=>({round:index+1,points}));
  const senna=[0,9,0,6,9,9,6,9,9,9,9,0,1,3,9,6].map((points,index)=>({round:index+1,points}));
  assert.equal(prost.reduce((a,b)=>a+b.points,0),105);
  assert.equal(senna.reduce((a,b)=>a+b.points,0),94);
  assert.equal(countChampionshipPoints(prost,championshipRuleForYear(1988).driverCounting),87);
  assert.equal(countChampionshipPoints(senna,championshipRuleForYear(1988).driverCounting),90);
});

test("fastest lap and 2014 final-race bonuses are era aware",()=>{
  assert.equal(racePointsForResult({year:1950,position:1,fastestLap:true}),9);
  assert.equal(racePointsForResult({year:1963,position:1,fastestLap:true}),9);
  assert.equal(racePointsForResult({year:2014,position:1,isFinalRound:true}),50);
  assert.equal(racePointsForResult({year:2019,position:10,fastestLap:true}),2);
  assert.equal(racePointsForResult({year:2019,position:11,fastestLap:true}),0);
  assert.equal(racePointsForResult({year:2025,position:1,fastestLap:true}),25);
});

test("canonical points system enriches legacy database rows instead of trusting broad ranges",()=>{
  const rec=championshipPointsSystem(1963,{points_system_id:"legacy",places_csv:"9,6,4,3,2,1"});
  assert.deepEqual(rec.table,[9,6,4,3,2,1]);
  assert.equal(rec.championship_rules.driverCounting.count,6);
  assert.equal(rec.championship_rules.constructorCarsScoring,"best_one");
});

test("modern shortened-race scoring uses graduated tables",()=>{
  assert.deepEqual(shortenedRacePointsTable(2024,{fraction:0.20,greenLaps:3}),[6,4,3,2,1]);
  assert.deepEqual(shortenedRacePointsTable(2024,{fraction:0.40,greenLaps:3}),[13,10,8,6,5,4,3,2,1]);
  assert.deepEqual(shortenedRacePointsTable(2024,{fraction:0.60,greenLaps:3}),[19,14,12,10,8,6,4,3,2,1]);
  assert.deepEqual(shortenedRacePointsTable(2024,{fraction:0.80,greenLaps:3}),[25,18,15,12,10,8,6,4,2,1]);
});
