import test from "node:test";
import assert from "node:assert/strict";

import {
  lowerSeriesF1Interest,
  rebuildLowerSeriesProspects,
} from "../src/domain/lowerSeriesProspects.js";

function world(){
  return {
    version:4,
    authority:"save_world",
    season_year:2007,
    source_season:2007,
    series:[
      {series_id:"GP2",series_name:"GP2 Series",series_level:2},
    ],
    teams:{
      LT1:{lower_team_id:"LT1",series_id:"GP2",team_name:"Junior Team One"},
      LT2:{lower_team_id:"LT2",series_id:"GP2",team_name:"Junior Team Two"},
    },
    entries:{
      D1:{
        driver_id:"D1",series_id:"GP2",series_name:"GP2 Series",series_level:2,
        lower_team_id:"LT1",team_name:"Junior Team One",
      },
      D2:{
        driver_id:"D2",series_id:"GP2",series_name:"GP2 Series",series_level:2,
        lower_team_id:"LT2",team_name:"Junior Team Two",
      },
    },
    standings:{
      GP2:{
        series_id:"GP2",
        series_name:"GP2 Series",
        series_level:2,
        drivers:[
          {position:1,driver_id:"D1",starts:8,wins:5,podiums:7,points:72},
          {position:2,driver_id:"D2",starts:8,wins:0,podiums:2,points:34},
        ],
        teams:[],
        complete:false,
      },
    },
    prospects:{},
    events:[],
    results:[],
    history:[],
  };
}

function gameState(){
  return {
    activeYear:2007,
    currentDateISO:"2007-07-01",
    saveMeta:{seed:"ls5-prospect-test"},
    team:{team_id:"F1A",team_name:"Formula Team A"},
    drivers:[
      {driver_id:"D1",display_name:"Prospect One",age:20,active_lower_series:true},
      {driver_id:"D2",display_name:"Prospect Two",age:20,active_lower_series:true},
    ],
    driverRatings:[
      {driver_id:"D1",current_ability:65,potential_ability:99},
      {driver_id:"D2",current_ability:65,potential_ability:70},
    ],
    contracts:[
      {
        driver_id:"F1D1",team_id:"F1A",role:"Main Driver",status:"active",
        contract_start_year:2007,contract_until_year:2007,
      },
      {
        driver_id:"F1D2",team_id:"F1B",role:"Main Driver",status:"active",
        contract_start_year:2007,contract_until_year:2007,
      },
    ],
    teamReputationState:{
      F1A:{reputation:55},
      F1B:{reputation:55},
    },
    academy:{drivers:[]},
  };
}

test("LS5 prospect reputation is driven by Lower Series performance rather than hidden PA",()=>{
  const gs=gameState();
  const w=world();
  const first=rebuildLowerSeriesProspects(gs,w);

  assert.ok(first.D1.prospect_reputation>first.D2.prospect_reputation);
  assert.equal(first.D1.talent_signal_source,"lower_series_results_and_explicit_links_only");

  const changed={
    ...gs,
    driverRatings:gs.driverRatings.map((row)=>
      row.driver_id==="D1"
        ?{...row,potential_ability:40}
        :{...row,potential_ability:100}
    ),
  };
  const second=rebuildLowerSeriesProspects(changed,w);

  assert.equal(first.D1.prospect_reputation,second.D1.prospect_reputation);
  assert.equal(first.D2.prospect_reputation,second.D2.prospect_reputation);
  assert.deepEqual(first.D1.f1_interest,second.D1.f1_interest);
  assert.deepEqual(first.D2.f1_interest,second.D2.f1_interest);
});

test("LS5 Academy support creates a direct priority connection to the supporting F1 team",()=>{
  const gs=gameState();
  gs.academy={
    drivers:[{
      driver_id:"D2",
      joined_at:"2007-01-01",
      status:"active",
      mode:"academy",
      program:"General Development",
    }],
  };

  const prospects=rebuildLowerSeriesProspects(gs,world());
  const academyInterest=lowerSeriesF1Interest({prospects},"D2","F1A");

  assert.ok(academyInterest);
  assert.equal(academyInterest.status,"academy_priority");
  assert.equal(academyInterest.relationship_type,"academy");
  assert.deepEqual(academyInterest.connection_sources,["player_academy"]);
  assert.equal(prospects.D2.academy_team_id,"F1A");
});

test("LS5 factual Lower Team to F1 links boost visibility without forcing an F1 contract",()=>{
  const gs=gameState();
  gs.lowerSeriesTeamLinks=[{
    lower_team_id:"LT1",
    f1_team_id:"F1B",
    relationship_type:"affiliate",
    valid_from:2005,
    valid_to:2010,
  }];

  const prospects=rebuildLowerSeriesProspects(gs,world());
  const linked=lowerSeriesF1Interest({prospects},"D1","F1B");

  assert.ok(linked);
  assert.ok(linked.connection_sources.includes("lower_series_team_link"));
  assert.equal(linked.relationship_type,"affiliate");
  assert.notEqual(linked.status,"none");
  assert.equal(
    Object.prototype.hasOwnProperty.call(gs.contracts[0],"prospect_driver_id"),
    false,
    "interest must not silently create or mutate an F1 contract"
  );
});

test("LS5 prospect rebuild is deterministic and idempotent for the same Save World evidence",()=>{
  const gs=gameState();
  const w=world();
  const a=rebuildLowerSeriesProspects(gs,w);
  const b=rebuildLowerSeriesProspects(gs,{...w,prospects:a});
  const c=rebuildLowerSeriesProspects(gs,{...w,prospects:b});

  assert.deepEqual(b,c);
  assert.equal(b.D1.season_start_reputation,a.D1.season_start_reputation);
});
