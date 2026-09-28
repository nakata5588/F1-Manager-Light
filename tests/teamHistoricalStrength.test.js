import test from "node:test";
import assert from "node:assert/strict";
import {
  materializeHistoricalTeamStrengths,
  teamHistoricalStrength,
  teamHistoricalStrengthLabel,
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
    lineageRows:[{predecessor_team_id:"OLD",successor_team_id:"NEW",effective_from_year:1980,confidence:"LOW"}],
  });
  const safe=teamHistoricalStrength({
    ...base,
    lineageRows:[{predecessor_team_id:"OLD",successor_team_id:"NEW",effective_from_year:1980,confidence:"HIGH",source:"curated"}],
  });
  assert.deepEqual(unsafe.inherited_team_ids,[]);
  assert.deepEqual(safe.inherited_team_ids,["OLD"]);
  assert.ok(safe.overall>unsafe.overall,[safe,unsafe]);
  assert.equal(safe.lineage_basis,"explicit_verified_temporal_lineage");
});

test("materializer returns one strength row per canonical Team",()=>{
  const result=materializeHistoricalTeamStrengths({
    teamIds:["A","B","A"],year:1980,teamSeasons,driverHistory:history,historicalChampionships:championships,
  });
  assert.equal(result.length,2);
  assert.deepEqual(new Set(result.map((row)=>row.team_id)),new Set(["A","B"]));
});


test("technical Constructor championship rows resolve through the Team season bridge",()=>{
  const strength=teamHistoricalStrength({
    teamId:"TEAM",
    year:1980,
    teamSeasons:[
      {year:1978,team_id:"TEAM",constructor_ids:["TECH"],exact_constructor_ids:["TECH"]},
      {year:1979,team_id:"TEAM",constructor_ids:["TECH"],exact_constructor_ids:["TECH"]},
    ],
    driverHistory:[
      {year:1978,team_id:"TEAM",series_division:"F1",wins:2,podiums:5,starts:30,points:50},
      {year:1979,team_id:"TEAM",series_division:"F1",wins:3,podiums:6,starts:30,points:70},
    ],
    historicalChampionships:{
      constructors:[
        {year:1978,constructor_id:"TECH",position:2},
        {year:1979,constructor_id:"TECH",position:1},
        {year:1979,constructor_id:"OTHER",position:2},
      ],
      drivers:[
        {year:1979,constructor_id:"TECH",position:1},
      ],
    },
  });
  assert.equal(strength.constructors_titles,1);
  assert.equal(strength.drivers_titles,1);
  assert.equal(strength.last_constructor_title_year,1979);
  assert.ok(strength.recent_competitiveness>=80,strength.recent_competitiveness);
});


test("same Team ID does not bridge a disconnected historical revival",()=>{
  const strength=teamHistoricalStrength({
    teamId:"REVIVED",
    year:2012,
    teamSeasons:[
      {year:1970,team_id:"REVIVED"},
      {year:1971,team_id:"REVIVED"},
      {year:2010,team_id:"REVIVED"},
      {year:2011,team_id:"REVIVED"},
    ],
    driverHistory:[
      {year:1970,team_id:"REVIVED",series_division:"F1",wins:8,podiums:12,starts:20,points:100},
      {year:1971,team_id:"REVIVED",series_division:"F1",wins:7,podiums:11,starts:20,points:90},
      {year:2010,team_id:"REVIVED",series_division:"F1",wins:0,podiums:0,starts:38,points:0},
      {year:2011,team_id:"REVIVED",series_division:"F1",wins:0,podiums:0,starts:38,points:0},
    ],
    historicalChampionships:{
      constructors:[{year:1970,constructor_id:"REVIVED",position:1}],
      drivers:[{year:1970,constructor_id:"REVIVED",position:1}],
    },
  });
  assert.equal(strength.first_historical_season,2010);
  assert.equal(strength.seasons_before_start,2);
  assert.equal(strength.historical_wins,0);
  assert.equal(strength.constructors_titles,0);
  assert.equal(strength.drivers_titles,0);
});

test("recursive temporal lineage carries only the connected organisational chain",()=>{
  const strength=teamHistoricalStrength({
    teamId:"NEW",
    year:2003,
    teamSeasons:[
      {year:1980,team_id:"ANCIENT"},
      {year:2000,team_id:"OLD"},
      {year:2001,team_id:"OLD"},
      {year:2002,team_id:"MID"},
    ],
    driverHistory:[
      {year:1980,team_id:"ANCIENT",series_division:"F1",wins:10,podiums:15,starts:30,points:100},
      {year:2000,team_id:"OLD",series_division:"F1",wins:1,podiums:2,starts:34,points:20},
      {year:2001,team_id:"OLD",series_division:"F1",wins:2,podiums:4,starts:34,points:40},
      {year:2002,team_id:"MID",series_division:"F1",wins:3,podiums:5,starts:34,points:60},
    ],
    historicalChampionships:{constructors:[],drivers:[]},
    lineageRows:[
      {predecessor_team_id:"OLD",successor_team_id:"MID",effective_from_year:2002,verified:true},
      {predecessor_team_id:"MID",successor_team_id:"NEW",effective_from_year:2003,verified:true},
    ],
  });
  assert.deepEqual(strength.inherited_team_ids,["MID","OLD"]);
  assert.equal(strength.first_historical_season,2000);
  assert.equal(strength.latest_historical_season,2002);
  assert.equal(strength.seasons_before_start,3);
  assert.equal(strength.historical_wins,6);
  assert.equal(strength.lineage_segments.some((segment)=>segment.team_id==="ANCIENT"),false);
});


test("historical strength labels use one shared UI scale",()=>{
  assert.equal(teamHistoricalStrengthLabel(95),"Elite");
  assert.equal(teamHistoricalStrengthLabel(80),"Strong");
  assert.equal(teamHistoricalStrengthLabel(65),"Established");
  assert.equal(teamHistoricalStrengthLabel(50),"Developing");
  assert.equal(teamHistoricalStrengthLabel(25),"Emerging");
  assert.equal(teamHistoricalStrengthLabel(null),"Unknown");
});
