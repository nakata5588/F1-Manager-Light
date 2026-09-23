import test from "node:test";
import assert from "node:assert/strict";
import {
  annotateCareerTransfers,
  applyResultChampionshipPositions,
  deriveCareerChampionshipPositions,
  historicalCareerDriverMatches,
  historicalCareerRowKey,
  markChampionshipPositionTeam,
  mergeHistoricalCareerSources,
  resolveHistoricalTeamId,
} from "../src/domain/driverCareerIdentity.js";

test("historical career identity falls back to driver name when legacy IDs differ",()=>{
  const live={driver_id:"d_0004",display_name:"Jody Scheckter"};
  const history={
    driver_id:{result:"d_0222"},
    driver_name:"Jody Scheckter",
    year:1979,
    series_division:"F1",
    team_id:{result:"t_0010"},
    team_name:"Ferrari",
    champ_pos:1,
  };
  assert.equal(historicalCareerDriverMatches(history,{driverId:live.driver_id,driverName:live.display_name}),true);
});

test("historical team identity resolves founder-prefixed names to canonical team IDs",()=>{
  const teams=[
    {team_id:"t_0059",team_name:"Wolf",short_name:"Wolf"},
    {team_id:"t_0010",team_name:"Ferrari"},
  ];
  const manual={year:1977,series_division:"F1",team_name:"Walter Wolf"};
  const derived={year:1977,series_division:"F1",team_id:"t_0059",team_name:"Wolf"};

  assert.equal(resolveHistoricalTeamId(manual,teams),"t_0059");
  assert.equal(historicalCareerRowKey(manual,teams),historicalCareerRowKey(derived,teams));
});


test("canonical career row overrides incomplete runtime row for the same season and team",()=>{
  const teams=[{team_id:"t_0010",team_name:"Ferrari"}];
  const live=[{
    driver_id:"d_0004",driver_name:"Jody Scheckter",year:1979,series_division:"F1",
    team_id:"t_0010",team_name:"Ferrari",starts:15,wins:3,podiums:6,poles:1,
    fastest_laps:0,points:60,champ_pos:null,
  }];
  const canonical=[{
    driver_id:{result:"d_0222"},driver_name:"Jody Scheckter",year:1979,series_division:"F1",
    team_id:{result:"t_0010"},team_name:"Ferrari",starts:15,wins:3,podiums:6,poles:1,
    fastest_laps:0,points:60,champ_pos:1,
  }];

  const rows=mergeHistoricalCareerSources(live,canonical,teams);
  assert.equal(rows.length,1);
  assert.equal(rows[0].champ_pos,1);
});


test("career row keys keep different drivers on the same team and season separate",()=>{
  const teams=[{team_id:"t_0010",team_name:"Ferrari"}];
  const jody={driver_name:"Jody Scheckter",year:1979,series_division:"F1",team_id:"t_0010"};
  const gilles={driver_name:"Gilles Villeneuve",year:1979,series_division:"F1",team_id:"t_0010"};
  assert.notEqual(historicalCareerRowKey(jody,teams),historicalCareerRowKey(gilles,teams));
});

test("missing championship position can be derived from season points",()=>{
  const rows=deriveCareerChampionshipPositions([
    {driver_name:"Driver A",year:1978,series_division:"F1",team_name:"Team A",points:40,wins:2},
    {driver_name:"Driver B",year:1978,series_division:"F1",team_name:"Team B",points:55,wins:1},
    {driver_name:"Driver C",year:1978,series_division:"F1",team_name:"Team C",points:20,wins:0},
  ]);
  assert.equal(rows.find((row)=>row.driver_name==="Driver B").champ_pos,1);
  assert.equal(rows.find((row)=>row.driver_name==="Driver A").champ_pos,2);
  assert.equal(rows.find((row)=>row.driver_name==="Driver C").champ_pos,3);
});

test("transfer season shows championship position only on the last team",()=>{
  const rows=markChampionshipPositionTeam([
    {driver_name:"Driver A",year:1980,series_division:"F1",team_name:"Team One",last_round:5,champ_pos:4},
    {driver_name:"Driver A",year:1980,series_division:"F1",team_name:"Team Two",last_round:14,champ_pos:4},
  ]);
  assert.equal(rows[0].__showChampionshipPosition,false);
  assert.equal(rows[1].__showChampionshipPosition,true);
});


test("archive team IDs reconcile to canonical live team names instead of duplicating aliases",()=>{
  const teams=[{team_id:"t_0059",team_name:"Wolf",short_name:"Wolf"}];
  const generated={
    driver_name:"Jody Scheckter",year:1977,series_division:"F1",
    team_id:"archive_constructor_27",team_name:"Wolf",points:55,
  };
  const manual={
    driver_name:"Jody Scheckter",year:1977,series_division:"F1",
    team_name:"Walter Wolf",points:55,
  };
  const rows=mergeHistoricalCareerSources([manual],[generated],teams);
  assert.equal(rows.length,1);
  assert.equal(rows[0].team_id,"t_0059");
  assert.equal(rows[0].team_name,"Wolf");
});

test("historical result standings override conflicting career champ_pos",()=>{
  const career=[
    {driver_name:"Driver A",year:1978,series_division:"F1",team_name:"Team A",points:40,wins:2,champ_pos:1},
    {driver_name:"Driver B",year:1978,series_division:"F1",team_name:"Team B",points:55,wins:1,champ_pos:2},
  ];
  const resultRows=[
    {driver_name:"Driver A",year:1978,series_division:"F1",team_name:"Team A",points:40,wins:2},
    {driver_name:"Driver B",year:1978,series_division:"F1",team_name:"Team B",points:55,wins:1},
  ];
  const rows=applyResultChampionshipPositions(career,resultRows);
  assert.equal(rows.find((row)=>row.driver_name==="Driver B").champ_pos,1);
  assert.equal(rows.find((row)=>row.driver_name==="Driver A").champ_pos,2);
  assert.equal(rows[0].__champ_pos_source,"historical_results");
});

test("career transfer annotation identifies the joined team and round",()=>{
  const rows=annotateCareerTransfers([
    {driver_name:"Driver A",year:1980,series_division:"F1",team_id:"T1",team_name:"Team One",first_round:1,last_round:5},
    {driver_name:"Driver A",year:1980,series_division:"F1",team_id:"T2",team_name:"Team Two",first_round:6,last_round:14},
  ]);
  assert.equal(rows[0].__transfer,undefined);
  assert.deepEqual(rows[1].__transfer,{from:"Team One",to:"Team Two",round:6});
});
