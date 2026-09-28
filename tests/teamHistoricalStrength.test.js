import test from "node:test";
import assert from "node:assert/strict";
import {
  materializeHistoricalTeamStrengths,
  teamHistoricalStrength,
} from "../src/domain/teamHistoricalStrength.js";

const teamSeasons=[
  ...Array.from({length:10},(_,i)=>({year:1970+i,team_id:"A"})),
  {year:1978,team_id:"B"},
  {year:1979,team_id:"B"},
  {year:1980,team_id:"B"},
];

const history=[
  {year:1977,team_id:"A",series_division:"F1",wins:4,podiums:8,starts:32,points:80},
  {year:1978,team_id:"A",series_division:"F1",wins:3,podiums:7,starts:32,points:70},
  {year:1979,team_id:"A",series_division:"F1",wins:2,podiums:6,starts:30,points:60},
  {year:1978,team_id:"B",series_division:"F1",wins:0,podiums:0,starts:30,points:5},
  {year:1979,team_id:"B",series_division:"F1",wins:0,podiums:1,starts:30,points:10},
  // Future evidence must never leak into 1980.
  {year:1980,team_id:"B",series_division:"F1",wins:12,podiums:20,starts:30,points:200},
];

const championships={
  constructors:[
    {year:1977,constructor_id:"A",position:1},
    {year:1977,constructor_id:"B",position:8},
    {year:1978,constructor_id:"A",position:1},
    {year:1978,constructor_id:"B",position:7},
    {year:1979,constructor_id:"A",position:2},
    {year:1979,constructor_id:"B",position:6},
    {year:1980,constructor_id:"B",position:1},
  ],
  drivers:[
    {year:1977,constructor_id:"A",position:1},
    {year:1980,constructor_id:"B",position:1},
  ],
};

test("established successful Team opens stronger than a recent backmarker without using current car data",()=>{
  const a=teamHistoricalStrength({
    teamId:"A",year:1980,teamSeasons,driverHistory:history,historicalChampionships:championships,
  });
  const b=teamHistoricalStrength({
    teamId:"B",year:1980,teamSeasons,driverHistory:history,historicalChampionships:championships,
  });
  assert.ok(a.heritage_strength>b.heritage_strength,[a,b]);
  assert.ok(a.sporting_strength>b.sporting_strength,[a,b]);
  assert.ok(a.recent_competitiveness>b.recent_competitiveness,[a,b]);
  assert.ok(a.structural_strength>b.structural_strength,[a,b]);
  assert.ok(a.overall>b.overall,[a,b]);
});

test("selected-season results never affect January Historical Team Strength",()=>{
  const withFuture=teamHistoricalStrength({
    teamId:"B",year:1980,teamSeasons,driverHistory:history,historicalChampionships:championships,
  });
  const withoutFuture=teamHistoricalStrength({
    teamId:"B",year:1980,
    teamSeasons:teamSeasons.filter((row)=>row.year<1980),
    driverHistory:history.filter((row)=>row.year<1980),
    historicalChampionships:{
      constructors:championships.constructors.filter((row)=>row.year<1980),
      drivers:championships.drivers.filter((row)=>row.year<1980),
    },
  });
  assert.deepEqual(withFuture,withoutFuture);
  assert.equal(withFuture.evidence_through_year,1979);
});

test("recent competitiveness is era-relative to championship field size",()=>{
  const strength=teamHistoricalStrength({
    teamId:"A",
    year:1980,
    teamSeasons,
    driverHistory:history,
    historicalChampionships:{
      ...championships,
      constructors:[
        {year:1979,constructor_id:"A",position:2},
        ...Array.from({length:8},(_,i)=>({year:1979,constructor_id:"X"+i,position:i+1+(i>=1?1:0)})),
      ],
    },
  });
  assert.ok(strength.recent_competitiveness>=80,strength.recent_competitiveness);
});

test("lineage inheritance is ignored unless explicitly verified",()=>{
  const base={
    teamId:"NEW",year:1980,
    teamSeasons:[{year:1978,team_id:"OLD"},{year:1979,team_id:"OLD"}],
    driverHistory:[{year:1979,team_id:"OLD",series_division:"F1",wins:3,podiums:5,starts:30,points:50}],
    historicalChampionships:{
      constructors:[{year:1979,constructor_id:"OLD",position:1}],
      drivers:[{year:1979,constructor_id:"OLD",position:1}],
    },
  };
  const unsafe=teamHistoricalStrength({
    ...base,
    lineageRows:[{predecessor_team_id:"OLD",successor_team_id:"NEW",confidence:"LOW"}],
  });
  const safe=teamHistoricalStrength({
    ...base,
    lineageRows:[{predecessor_team_id:"OLD",successor_team_id:"NEW",confidence:"HIGH",source:"curated"}],
  });
  assert.deepEqual(unsafe.inherited_team_ids,[]);
  assert.deepEqual(safe.inherited_team_ids,["OLD"]);
  assert.ok(safe.overall>unsafe.overall,[safe,unsafe]);
  assert.equal(safe.lineage_basis,"explicit_verified_lineage");
});

test("materializer returns one strength row per canonical Team",()=>{
  const result=materializeHistoricalTeamStrengths({
    teamIds:["A","B","A"],year:1980,teamSeasons,driverHistory:history,historicalChampionships:championships,
  });
  assert.equal(result.length,2);
  assert.deepEqual(new Set(result.map((row)=>row.team_id)),new Set(["A","B"]));
});
