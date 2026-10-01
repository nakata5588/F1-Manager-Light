import test from "node:test";
import assert from "node:assert/strict";

import {
  activeSeriesForYear,
  seriesCompetitionModel,
  seriesHasTeamCompetition,
  seriesLevelOf,
  seriesRuleForYear,
  seriesAgeEligibility,
} from "../src/domain/seriesCatalog.js";
import { buildFreshCareerState } from "../src/state/newGameRuntime.js";

test("series catalogue resolves the historically active ladder by year",()=>{
  const series=[
    {series_id:"s_f3000",series_name:"FIA Formula 3000 International Championship",series_level:2,start_year:1985,end_year:2004},
    {series_id:"s_gp2",series_name:"GP2 Series",series_level:2,start_year:2005,end_year:2016},
    {series_id:"s_f2",series_name:"FIA Formula 2 Championship",series_level:2,start_year:2017,end_year:null},
    {series_id:"s_gp3",series_name:"GP3 Series",series_level:3,start_year:2010,end_year:2018},
  ];

  assert.deepEqual(
    activeSeriesForYear(series,2010,{levels:[2]}).map((row)=>row.series_id),
    ["s_gp2"],
  );
  assert.deepEqual(
    activeSeriesForYear(series,2017,{levels:[2,3]}).map((row)=>row.series_id),
    ["s_f2","s_gp3"],
  );
});

test("series rules use the rule period that applies to the requested season",()=>{
  const rules=[
    {series_rule_id:"old",series_id:"s_test",valid_from:2020,valid_to:2025,min_age:15,max_age:22},
    {series_rule_id:"new",series_id:"s_test",valid_from:2026,valid_to:null,min_age:15,max_age:23},
  ];

  assert.equal(seriesRuleForYear(rules,"s_test",2025)?.series_rule_id,"old");
  assert.equal(seriesRuleForYear(rules,"s_test",2026)?.series_rule_id,"new");
});

test("series age eligibility enforces only documented age bounds",()=>{
  const rule={min_age:15,max_age:23};

  assert.equal(seriesAgeEligibility({birthdate:"2008-06-10"},rule,2026).eligible,true);
  assert.deepEqual(
    seriesAgeEligibility({birthdate:"2000-06-10"},rule,2026).reasons,
    ["above_max_age"],
  );

  const noMaxAge={min_age:16,max_age:null};
  assert.equal(seriesAgeEligibility({birthdate:"1990-01-01"},noMaxAge,2026).eligible,true);
});

test("New Game keeps series catalogue and rules as immutable database context",()=>{
  const dbSeries=[{series_id:"s_f2",series_level:2,start_year:2017}];
  const dbSeriesRules=[{series_rule_id:"sr_f2",series_id:"s_f2",valid_from:2017}];
  const fresh=buildFreshCareerState({
    activeYear:2026,
    dbSeries,
    dbSeriesRules,
  });

  assert.deepEqual(fresh.dbSeries,dbSeries);
  assert.deepEqual(fresh.dbSeriesRules,dbSeriesRules);
});


test("canonical pyramid maps entry-level Formula 4 to level 4 and normalizes legacy level 5 saves",()=>{
  assert.equal(seriesLevelOf({
    series_id:"S_0009",
    series_division:4,
    series_short_name:"F4",
    series_name:"FIA Formula 4",
  }),4);
  assert.equal(seriesLevelOf({
    series_id:"legacy_f4",
    series_level:5,
    series_name:"Legacy Formula Four",
  }),4);
  assert.equal(seriesLevelOf({
    series_id:"regional",
    series_level:4,
    series_name:"Formula Regional European Championship",
  }),4);
});


test("series competition model defaults to teams and supports central operation",()=>{
  assert.equal(seriesCompetitionModel({series_id:"gp2"}),"TEAM_BASED");
  assert.equal(seriesHasTeamCompetition({series_id:"gp2"}),true);

  const central={
    series_id:"fia_f2_2009",
    competition_model:"CENTRAL_OPERATION",
  };
  assert.equal(seriesCompetitionModel(central),"CENTRAL_OPERATION");
  assert.equal(seriesHasTeamCompetition(central),false);

  assert.equal(
    seriesCompetitionModel({series_id:"alias",competition_model:"driver_only"}),
    "CENTRAL_OPERATION"
  );
});
