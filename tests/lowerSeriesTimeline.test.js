import test from "node:test";
import assert from "node:assert/strict";

import {
  lowerSeriesCareerTimeline,
  lowerSeriesDriverSeasonHistory,
  lowerSeriesSeasonSnapshots,
  lowerSeriesWorldSummary,
} from "../src/domain/lowerSeriesTimeline.js";

function state(){
  const history2007={
    season_year:2007,
    series:[{series_id:"F3",series_name:"Formula Three",series_level:3}],
    entries:[{
      driver_id:"D1",series_id:"F3",series_name:"Formula Three",series_level:3,
      lower_team_id:"L1",team_name:"Junior One",
    }],
    standings:{
      F3:{
        complete:true,
        champion_driver_id:"D1",
        drivers:[
          {position:1,driver_id:"D1",starts:8,wins:4,podiums:7,points:68},
          {position:2,driver_id:"D2",starts:8,wins:2,podiums:5,points:51},
        ],
      },
    },
    prospects:{
      D1:{
        driver_id:"D1",
        prospect_reputation:76,
        performance:{score:82},
        f1_interest:[
          {f1_team_id:"T2",score:71,status:"interested",connection_sources:[]},
        ],
        best_f1_interest:{
          f1_team_id:"T2",score:71,status:"interested",connection_sources:[],
        },
      },
    },
    events:[],
    results:[],
  };

  return {
    activeYear:2008,
    drivers:[
      {driver_id:"D1",display_name:"Junior Driver"},
      {driver_id:"D2",display_name:"Other Driver"},
    ],
    dbDrivers:[],
    teams:[
      {team_id:"T2",team_name:"Team Two",short_name:"T2"},
    ],
    dbTeams:[],
    contracts:[
      {
        year:2008,
        contract_start_year:2008,
        team_id:"T2",
        driver_id:"D1",
        role:"Reserve Driver",
        status:"active",
        lower_series_call_up:{
          accepted_at:"2008-03-01",
          accepted_role:"Reserve Driver",
          series_id:"F2",
          stage:"reserve_candidate",
          opportunity_score:72,
        },
      },
    ],
    lowerSeriesWorld:{
      version:5,
      season_year:2008,
      source_season:2007,
      history:[history2007],
      series:[{series_id:"F2",series_name:"Formula Two",series_level:2}],
      entries:{
        D1:{
          driver_id:"D1",
          series_id:"F2",
          series_name:"Formula Two",
          series_level:2,
          lower_team_id:"L2",
          team_name:"Junior Two",
          career_movement:{
            decision:"promote",
            from_level:3,
            target_level:2,
            effective_level:2,
            effective_outcome:"promoted",
            target_year:2008,
            f1_ready:false,
          },
        },
      },
      standings:{
        F2:{
          complete:false,
          champion_driver_id:null,
          drivers:[
            {position:2,driver_id:"D1",starts:4,wins:1,podiums:2,points:24},
          ],
        },
      },
      prospects:{
        D1:{
          driver_id:"D1",
          prospect_reputation:81,
          performance:{score:76},
          f1_interest:[
            {f1_team_id:"T2",score:84,status:"priority",connection_sources:[]},
          ],
          best_f1_interest:{
            f1_team_id:"T2",score:84,status:"priority",connection_sources:[],
          },
        },
      },
      events:[],
      results:[],
    },
  };
}

test("LS8 season snapshots are chronological and deduplicate the live season",()=>{
  const gs=state();
  gs.lowerSeriesWorld.history.push({
    ...gs.lowerSeriesWorld,
    history:[],
    season_year:2008,
  });
  const snapshots=lowerSeriesSeasonSnapshots(gs.lowerSeriesWorld);
  assert.deepEqual(snapshots.map((row)=>row.season_year),[2007,2008]);
  assert.equal(snapshots[1],gs.lowerSeriesWorld);
});

test("LS8 driver season history reads canonical standings, prospect and movement facts",()=>{
  const history=lowerSeriesDriverSeasonHistory(state(),"D1");
  assert.equal(history.length,2);

  assert.equal(history[0].season_year,2007);
  assert.equal(history[0].champion,true);
  assert.equal(history[0].position,1);
  assert.equal(history[0].prospect_reputation,76);
  assert.equal(history[0].best_f1_interest.f1_team_name,"T2");

  assert.equal(history[1].season_year,2008);
  assert.equal(history[1].series_id,"F2");
  assert.equal(history[1].movement_label,"Promoted");
  assert.equal(history[1].career_movement.effective_outcome,"promoted");
});

test("LS8 timeline shows championship, F1 interest, promotion and accepted F1 call-up",()=>{
  const timeline=lowerSeriesCareerTimeline(state(),{driverId:"D1"});
  const types=new Set(timeline.map((row)=>row.type));

  assert.ok(types.has("champion"));
  assert.ok(types.has("f1_interest"));
  assert.ok(types.has("movement"));
  assert.ok(types.has("f1_call_up"));

  const callUp=timeline.find((row)=>row.type==="f1_call_up");
  assert.equal(callUp.year,2008);
  assert.equal(callUp.f1_team_name,"T2");
  assert.equal(callUp.detail,"T2 · Reserve Driver");

  const movement=timeline.find((row)=>row.type==="movement");
  assert.equal(movement.title,"Junior Driver: Promoted");
});

test("LS8 timeline filters by driver without inventing unrelated events",()=>{
  const gs=state();
  const filtered=lowerSeriesCareerTimeline(gs,{driverId:"D2"});
  assert.deepEqual(filtered,[]);

  const limited=lowerSeriesCareerTimeline(gs,{limit:2});
  assert.equal(limited.length,2);
  assert.ok(limited.every((row)=>row.driver_id==="D1"));
});

test("LS8 world summary is a read-only count of current Save-World facts",()=>{
  const summary=lowerSeriesWorldSummary(state());
  assert.deepEqual(summary,{
    season_year:2008,
    series:1,
    drivers:1,
    f1_ready:0,
    promotions:1,
    f1_interest:1,
  });
});

test("LS8 F1 Ready timeline comes from LS7 movement state, not hidden driver potential",()=>{
  const gs=state();
  gs.lowerSeriesWorld.entries.D1.career_movement={
    decision:"f1_ready",
    from_level:2,
    target_level:2,
    effective_level:2,
    effective_outcome:"f1_ready",
    target_year:2008,
    f1_ready:true,
  };
  gs.drivers[0].potential_ability=5;

  const timeline=lowerSeriesCareerTimeline(gs,{driverId:"D1"});
  const ready=timeline.find((row)=>row.type==="f1_ready");

  assert.ok(ready);
  assert.equal(ready.title,"Junior Driver: F1 Ready");
  assert.equal(lowerSeriesWorldSummary(gs).f1_ready,1);
});
