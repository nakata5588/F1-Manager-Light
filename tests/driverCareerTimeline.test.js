import test from "node:test";
import assert from "node:assert/strict";

import {driverFullCareerTimeline} from "../src/domain/driverCareerTimeline.js";

function state(){
  return {
    activeYear:2009,
    drivers:[{driver_id:"D1",display_name:"Test Driver"}],
    dbDrivers:[],
    teams:[
      {team_id:"F1A",team_name:"Formula Team A",short_name:"FTA"},
      {team_id:"F1B",team_name:"Formula Team B",short_name:"FTB"},
    ],
    dbTeams:[],
    contracts:[
      {
        year:2008,
        contract_start_year:2008,
        team_id:"F1A",
        driver_id:"D1",
        role:"Reserve Driver",
        status:"ended",
        lower_series_call_up:{
          accepted_at:"2008-02-15",
          accepted_role:"Reserve Driver",
          series_id:"F2",
          stage:"reserve_candidate",
          opportunity_score:73,
        },
      },
    ],
    lowerSeriesWorld:{
      version:5,
      season_year:2008,
      history:[{
        season_year:2007,
        series:[{series_id:"F2",series_name:"Formula Two",series_level:2}],
        entries:[{
          driver_id:"D1",
          series_id:"F2",
          series_name:"Formula Two",
          series_level:2,
          lower_team_id:"L1",
          team_name:"Junior One",
        }],
        standings:{
          F2:{
            complete:true,
            champion_driver_id:"D1",
            drivers:[
              {position:1,driver_id:"D1",starts:10,wins:5,podiums:8,points:78},
            ],
          },
        },
        prospects:{
          D1:{
            driver_id:"D1",
            prospect_reputation:84,
            performance:{score:90},
            f1_interest:[{
              f1_team_id:"F1A",score:88,status:"priority",connection_sources:[],
            }],
            best_f1_interest:{
              f1_team_id:"F1A",score:88,status:"priority",connection_sources:[],
            },
          },
        },
        events:[],
        results:[],
      }],
      series:[{series_id:"F2",series_name:"Formula Two",series_level:2}],
      entries:{
        D1:{
          driver_id:"D1",
          series_id:"F2",
          series_name:"Formula Two",
          series_level:2,
          lower_team_id:"L1",
          team_name:"Junior One",
          career_movement:{
            decision:"f1_ready",
            from_level:2,
            target_level:2,
            effective_level:2,
            effective_outcome:"f1_ready",
            target_year:2008,
            f1_ready:true,
          },
        },
      },
      standings:{
        F2:{
          complete:false,
          champion_driver_id:null,
          drivers:[
            {position:2,driver_id:"D1",starts:4,wins:1,podiums:2,points:25},
          ],
        },
      },
      prospects:{
        D1:{
          driver_id:"D1",
          prospect_reputation:86,
          performance:{score:82},
          f1_interest:[{
            f1_team_id:"F1A",score:91,status:"priority",connection_sources:[],
          }],
          best_f1_interest:{
            f1_team_id:"F1A",score:91,status:"priority",connection_sources:[],
          },
        },
      },
      events:[],
      results:[],
    },
  };
}

test("full driver timeline combines feeder seasons, F1 seasons, transfers and call-ups",()=>{
  const gs=state();
  const careerRows=[
    {
      year:2008,
      series_division:"F1",
      team_id:"F1A",
      team_name:"Formula Team A",
      starts:8,
      wins:0,
      podiums:1,
      points:18,
      champ_pos:10,
      __showChampionshipPosition:true,
    },
    {
      year:2009,
      series_division:"F1",
      team_id:"F1B",
      team_name:"Formula Team B",
      starts:16,
      wins:2,
      podiums:5,
      points:72,
      champ_pos:3,
      __showChampionshipPosition:true,
      __transfer:{from:"Formula Team A",to:"Formula Team B",round:1},
    },
  ];

  const timeline=driverFullCareerTimeline(gs,"D1",{careerRows});
  const types=new Set(timeline.map((row)=>row.type));

  assert.ok(types.has("lower_series_season"));
  assert.ok(types.has("f1_call_up"));
  assert.ok(types.has("season"));
  assert.ok(types.has("team_change"));
  assert.ok(types.has("champion"));
  assert.ok(types.has("f1_interest"));
  assert.ok(types.has("f1_ready"));

  assert.equal(timeline[0].year,2007);
  assert.equal(timeline.at(-1).year,2009);
  assert.ok(timeline.some((row)=>
    row.type==="season"&&
    row.year===2009&&
    row.title==="F1 — Formula Team B"
  ));
});

test("save-world Lower Series season is not duplicated by a matching legacy career row",()=>{
  const gs=state();
  const careerRows=[{
    year:2007,
    series_division:"Formula Two",
    team_name:"Junior One",
    starts:10,
    wins:5,
    podiums:8,
    points:78,
    champ_pos:1,
    __showChampionshipPosition:true,
  }];

  const timeline=driverFullCareerTimeline(gs,"D1",{careerRows});
  const seasons=timeline.filter((row)=>
    row.type==="lower_series_season"&&
    row.year===2007&&
    row.series_name==="Formula Two"&&
    row.team_name==="Junior One"
  );

  assert.equal(seasons.length,1);
  assert.equal(seasons[0].source,"lower_series_save_world");
  assert.equal(seasons[0].prospect_reputation,84);
});

test("F1 title is represented as a whole-career milestone",()=>{
  const gs=state();
  const careerRows=[{
    year:2009,
    series_division:"F1",
    team_name:"Formula Team B",
    starts:17,
    wins:7,
    podiums:12,
    points:100,
    champ_pos:1,
    __showChampionshipPosition:true,
  }];

  const timeline=driverFullCareerTimeline(gs,"D1",{careerRows});
  const title=timeline.find((row)=>
    row.type==="champion"&&
    row.title==="Formula 1 World Champion"
  );

  assert.ok(title);
  assert.equal(title.year,2009);
  assert.equal(title.detail,"Formula Team B");
});

test("timeline never reads hidden PA",()=>{
  const gs=state();
  const rows=[{
    year:2009,
    series_division:"F1",
    team_name:"Formula Team B",
    starts:16,
    wins:2,
    podiums:5,
    points:72,
    champ_pos:3,
    __showChampionshipPosition:true,
  }];

  const before=driverFullCareerTimeline(gs,"D1",{careerRows:rows});
  const changed={
    ...gs,
    drivers:[{...gs.drivers[0],potential_ability:1}],
  };
  const after=driverFullCareerTimeline(changed,"D1",{careerRows:rows});

  assert.deepEqual(after,before);
});


test("live F1 championship leader is not shown as World Champion before the season is final",()=>{
  const gs=state();
  const careerRows=[{
    year:2009,
    series_division:"F1",
    team_name:"Formula Team B",
    starts:8,
    wins:4,
    podiums:6,
    points:80,
    champ_pos:1,
    __showChampionshipPosition:true,
    __live:true,
  }];

  const timeline=driverFullCareerTimeline(gs,"D1",{careerRows});
  assert.equal(
    timeline.some((row)=>row.type==="champion"&&row.title==="Formula 1 World Champion"),
    false
  );
});
