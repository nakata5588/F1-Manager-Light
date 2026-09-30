import test from "node:test";
import assert from "node:assert/strict";

import { sanitizeLowerSeriesCompetitionWorld } from "../src/domain/lowerSeriesCompetitionGuard.js";
import { materializeLowerSeriesWorld, rollLowerSeriesWorld } from "../src/domain/lowerSeriesWorld.js";

test("LS9E strips stale fake teams from CENTRAL_OPERATION worlds",()=>{
  const world={
    season_year:2010,
    series:[
      {series_id:"fia_f2",competition_model:"CENTRAL_OPERATION"},
      {series_id:"gp2",competition_model:"TEAM_BASED"},
    ],
    teams:{
      FAKE:{lower_team_id:"FAKE",series_id:"fia_f2",team_name:"Fake Team"},
      ART:{lower_team_id:"ART",series_id:"gp2",team_name:"ART Grand Prix"},
    },
    entries:{
      D1:{driver_id:"D1",series_id:"fia_f2",lower_team_id:"FAKE",team_name:"Fake Team",placement_status:"placed_with_team",lineup_source:"stale"},
      D2:{driver_id:"D2",series_id:"gp2",lower_team_id:"ART",team_name:"ART Grand Prix",placement_status:"placed_with_team"},
    },
  };

  const guarded=sanitizeLowerSeriesCompetitionWorld(world);
  assert.equal(guarded.teams.FAKE,undefined);
  assert.equal(guarded.entries.D1.lower_team_id,null);
  assert.equal(guarded.entries.D1.team_name,null);
  assert.equal(guarded.entries.D1.placement_status,"series_only");
  assert.equal(guarded.entries.D1.lineup_source,null);
  assert.deepEqual(guarded.teams.ART,world.teams.ART);
  assert.equal(guarded.entries.D2.lower_team_id,"ART");
});

test("LS9E competition guard is immutable and idempotent",()=>{
  const world={
    series:[{series_id:"fia_f2",competition_model:"CENTRAL_OPERATION"}],
    teams:{FAKE:{lower_team_id:"FAKE",series_id:"fia_f2"}},
    entries:{D1:{driver_id:"D1",series_id:"fia_f2",lower_team_id:"FAKE",team_name:"Fake"}},
  };
  const snapshot=structuredClone(world);
  const once=sanitizeLowerSeriesCompetitionWorld(world);
  const twice=sanitizeLowerSeriesCompetitionWorld(once);
  assert.deepEqual(world,snapshot);
  assert.deepEqual(twice,once);
});


const centralSeries=[{
  series_id:"fia_f2",
  series_name:"FIA Formula Two Championship",
  short_name:"F2",
  series_level:2,
  start_year:2009,
  end_year:2012,
  competition_model:"CENTRAL_OPERATION",
}];

test("LS9E New Game materialization cannot seed fake teams into CENTRAL_OPERATION series",()=>{
  const world=materializeLowerSeriesWorld({
    year:2010,
    series:centralSeries,
    seriesRules:[],
    lowerSeriesTeams:[{
      lower_team_id:"FAKE",
      team_name:"Fake Team",
      series_id:"fia_f2",
      valid_from:2009,
      valid_to:2012,
    }],
    lowerSeriesEntries:[{
      lower_entry_id:"2010:d1",
      year:2010,
      driver_id:"D1",
      driver_name:"Driver One",
      series_id:"fia_f2",
      lower_team_id:"FAKE",
      team_name:"Fake Team",
    }],
    drivers:[{driver_id:"D1",display_name:"Driver One",dob:"1988-01-01"}],
    placements:[{
      driver_id:"D1",
      active_pre_f1_world:true,
      series_id:"fia_f2",
      series_name:"FIA Formula Two Championship",
      series_level:2,
      series_resolution:"historical_lower_series_entry",
      series_candidates:[],
    }],
  });

  assert.deepEqual(world.teams,{});
  assert.equal(world.entries.D1.lower_team_id,null);
  assert.equal(world.entries.D1.team_name,null);
  assert.equal(world.entries.D1.placement_status,"series_only");
});

test("LS9E rollover cannot carry or rematerialize fake teams for CENTRAL_OPERATION series",()=>{
  const stale={
    version:5,
    authority:"save_world",
    season_year:2010,
    source_season:2010,
    series:centralSeries.map((row)=>({...row,status:"active"})),
    teams:{FAKE:{lower_team_id:"FAKE",series_id:"fia_f2",team_name:"Fake Team",season_year:2010}},
    entries:{
      D1:{
        driver_id:"D1",
        series_id:"fia_f2",
        series_name:"FIA Formula Two Championship",
        series_level:2,
        lower_team_id:"FAKE",
        team_name:"Fake Team",
        placement_status:"placed_with_team",
        joined_world_year:2010,
      },
    },
    standings:{},
    prospects:{},
    events:[],
    results:[],
    history:[],
  };

  const next=rollLowerSeriesWorld(stale,{
    targetYear:2011,
    series:centralSeries,
    seriesRules:[],
    lowerSeriesTeams:[{
      lower_team_id:"FAKE",
      team_name:"Fake Team",
      series_id:"fia_f2",
      valid_from:2009,
      valid_to:2012,
    }],
    drivers:[{
      driver_id:"D1",
      age:23,
      active_lower_series:true,
      status:"lower_series",
      lower_series_level:2,
    }],
  });

  assert.deepEqual(next.teams,{});
  assert.equal(next.entries.D1.lower_team_id,null);
  assert.equal(next.entries.D1.team_name,null);
  assert.equal(next.entries.D1.placement_status,"series_only");
});
