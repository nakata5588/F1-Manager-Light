import test from "node:test";
import assert from "node:assert/strict";

import { sanitizeLowerSeriesCompetitionWorld } from "../src/domain/lowerSeriesCompetitionGuard.js";

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
