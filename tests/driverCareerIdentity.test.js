import test from "node:test";
import assert from "node:assert/strict";
import {
  historicalCareerDriverMatches,
  historicalCareerRowKey,
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
