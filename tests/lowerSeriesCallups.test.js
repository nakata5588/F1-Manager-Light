import test from "node:test";
import assert from "node:assert/strict";

import {
  lowerSeriesF1Opportunity,
  lowerSeriesOpportunityCandidates,
} from "../src/domain/lowerSeriesOpportunities.js";
import {
  aiDriverRecruitmentFit,
  rankAiRecruitmentCandidates,
} from "../src/domain/aiDriverLineup.js";
import { applyMarketTick } from "../src/engine/MarketEngine.js";
import {
  isNegotiationActive,
  processDriverNegotiations,
} from "../src/engine/NegotiationEngine.js";

function baseState({
  opportunityStatus="interested",
  interestScore=62,
  prospectReputation=55,
  performanceScore=60,
  secondSeatFilled=true,
  reserveFilled=true,
}={}){
  const contracts=[
    {
      year:2007,team_id:"T1",driver_id:"P1",role:"Main Driver",status:"active",
      contract_start_year:2007,contract_until_year:2007,salary:600_000,
    },
    {
      year:2007,team_id:"T1",driver_id:"P2",role:"Second Driver",status:"active",
      contract_start_year:2007,contract_until_year:2007,salary:500_000,
    },
    {
      year:2007,team_id:"T2",driver_id:"A1",role:"Main Driver",status:"active",
      contract_start_year:2007,contract_until_year:2007,salary:700_000,
    },
  ];
  if(secondSeatFilled){
    contracts.push({
      year:2007,team_id:"T2",driver_id:"A2",role:"Second Driver",status:"active",
      contract_start_year:2007,contract_until_year:2007,salary:550_000,
    });
  }
  if(reserveFilled){
    contracts.push({
      year:2007,team_id:"T2",driver_id:"AR",role:"Reserve Driver",status:"active",
      contract_start_year:2007,contract_until_year:2007,salary:150_000,
    });
  }

  return {
    activeYear:2007,
    currentDateISO:"2007-06-01",
    saveMeta:{seed:"ls6-callup-tests"},
    team:{team_id:"T1",team_name:"Player Team"},
    teams:[
      {team_id:"T1",team_name:"Player Team"},
      {team_id:"T2",team_name:"AI Team"},
    ],
    teamBrands:[
      {year:2007,team_id:"T1",starting_budget:8_000_000},
      {year:2007,team_id:"T2",starting_budget:10_000_000},
    ],
    teamReputationState:{
      T1:{reputation:55},
      T2:{reputation:55},
    },
    drivers:[
      {driver_id:"P1",display_name:"Player One",status:"eligible",canHireF1:true,age:28},
      {driver_id:"P2",display_name:"Player Two",status:"eligible",canHireF1:true,age:27},
      {driver_id:"A1",display_name:"AI One",status:"eligible",canHireF1:true,age:29},
      {driver_id:"A2",display_name:"AI Two",status:"eligible",canHireF1:true,age:27},
      {driver_id:"AR",display_name:"AI Reserve",status:"eligible",canHireF1:true,age:25},
      {
        driver_id:"J1",display_name:"Junior Prospect",status:"lower_series",
        active_lower_series:true,canHireF1:true,age:20,dob:"1987-01-01",
      },
      {
        driver_id:"FREE",display_name:"Equivalent Free Agent",status:"eligible",
        canHireF1:true,age:20,dob:"1987-01-01",
      },
    ],
    driverRatings:[
      {driver_id:"P1",current_ability:70,reputation:65},
      {driver_id:"P2",current_ability:68,reputation:60},
      {driver_id:"A1",current_ability:68,reputation:62},
      {driver_id:"A2",current_ability:64,reputation:58},
      {driver_id:"AR",current_ability:54,reputation:45},
      {driver_id:"J1",current_ability:56,pace:57,reputation:42,potential_ability:99},
      {driver_id:"FREE",current_ability:56,pace:57,reputation:42,potential_ability:40},
    ],
    contracts,
    driverNegotiations:[],
    inbox:[],
    lowerSeriesWorld:{
      version:4,
      authority:"save_world",
      season_year:2007,
      source_season:2007,
      series:[{series_id:"GP2",series_name:"GP2 Series",series_level:2}],
      teams:{},
      entries:{
        J1:{
          driver_id:"J1",series_id:"GP2",series_name:"GP2 Series",
          series_level:2,lower_team_id:"LT1",team_name:"Junior Team",
        },
      },
      standings:{
        GP2:{
          series_id:"GP2",series_name:"GP2 Series",series_level:2,
          complete:false,champion_driver_id:null,
          drivers:[
            {position:2,driver_id:"J1",starts:6,wins:1,podiums:4,points:42},
          ],
          teams:[],
        },
      },
      prospects:{
        J1:{
          driver_id:"J1",season_year:2007,series_id:"GP2",series_level:2,
          lower_team_id:"LT1",
          prospect_reputation:prospectReputation,
          season_start_reputation:30,
          performance:{
            starts:6,position:2,field_size:12,points:42,wins:1,podiums:4,
            score:performanceScore,exposure:1,
          },
          f1_interest:[{
            f1_team_id:"T2",
            score:interestScore,
            status:opportunityStatus,
            relationship_type:opportunityStatus==="academy_priority"?"academy":null,
            connection_sources:opportunityStatus==="academy_priority"?["player_academy"]:[],
          }],
          best_f1_interest:null,
          academy_team_id:opportunityStatus==="academy_priority"?"T2":null,
          model:"lower_series_prospect_interest_v1",
        },
      },
      events:[],
      results:[],
      history:[],
    },
  };
}

test("LS6 uses public Lower Series evidence only and does not read hidden PA",()=>{
  const gs=baseState();
  const before=lowerSeriesF1Opportunity(gs,"J1","T2","Reserve Driver");
  assert.ok(before);
  assert.equal(before.source,"lower_series_public_results_and_f1_interest");
  assert.equal(before.recommended,true);

  const changed={
    ...gs,
    driverRatings:gs.driverRatings.map((row)=>
      row.driver_id==="J1"?{...row,potential_ability:5}:row
    ),
  };
  const after=lowerSeriesF1Opportunity(changed,"J1","T2","Reserve Driver");

  assert.deepEqual(after,before);
});

test("LS6 applies a stricter threshold to race seats than reserve/test call-ups",()=>{
  const gs=baseState();
  const reserve=lowerSeriesF1Opportunity(gs,"J1","T2","Reserve Driver");
  const testRole=lowerSeriesF1Opportunity(gs,"J1","T2","Test Driver");
  const race=lowerSeriesF1Opportunity(gs,"J1","T2","Second Driver");

  assert.equal(reserve.recommended,true);
  assert.equal(testRole.recommended,true);
  assert.equal(race.recommended,false);
  assert.equal(reserve.stage,"reserve_candidate");
  assert.equal(testRole.stage,"test_candidate");
  assert.equal(race.stage,"watchlist");
});

test("LS6 increases canonical AI recruitment fit without replacing ability/role fit",()=>{
  const gs=baseState();
  const juniorFit=aiDriverRecruitmentFit(gs,"J1","T2","Reserve Driver");
  const freeFit=aiDriverRecruitmentFit(gs,"FREE","T2","Reserve Driver");

  assert.ok(juniorFit.lower_series_opportunity);
  assert.ok(juniorFit.fit_score>juniorFit.base_fit_score);
  assert.equal(freeFit.lower_series_opportunity,null);
  assert.equal(freeFit.fit_score,freeFit.base_fit_score);

  const ranked=rankAiRecruitmentCandidates(
    gs,
    [gs.drivers.find((row)=>row.driver_id==="FREE"),gs.drivers.find((row)=>row.driver_id==="J1")],
    "T2",
    "Reserve Driver"
  );
  assert.equal(ranked[0].driver.driver_id,"J1");
});

test("LS6 opens an AI Test Driver negotiation only for a recommended junior opportunity",()=>{
  const gs=baseState({
    opportunityStatus:"academy_priority",
    interestScore:82,
    prospectReputation:68,
    performanceScore:72,
  });
  const next=applyMarketTick(gs);

  const testOffer=(next.driverNegotiations||[]).find((row)=>
    row.origin==="ai" &&
    row.team_id==="T2" &&
    row.driver_id==="J1" &&
    row.offer?.role==="Test Driver" &&
    isNegotiationActive(row)
  );
  assert.ok(testOffer);
  assert.equal(testOffer.lower_series_opportunity.stage,"test_candidate");
  assert.equal(testOffer.lower_series_opportunity.academy_priority,true);
});

test("LS6 does not invent a Test Driver call-up from a weak watchlist signal",()=>{
  const gs=baseState({
    opportunityStatus:"monitoring",
    interestScore:47,
    prospectReputation:35,
    performanceScore:30,
  });
  const opportunity=lowerSeriesF1Opportunity(gs,"J1","T2","Test Driver");
  assert.equal(opportunity.recommended,false);

  const candidates=lowerSeriesOpportunityCandidates(gs,"T2","Test Driver");
  assert.deepEqual(candidates,[]);

  const next=applyMarketTick(gs);
  const juniorTestOffer=(next.driverNegotiations||[]).find((row)=>
    row.origin==="ai" &&
    row.team_id==="T2" &&
    row.driver_id==="J1" &&
    row.offer?.role==="Test Driver"
  );
  assert.equal(juniorTestOffer,undefined);
});

test("LS6 accepted AI call-up keeps the opportunity evidence on the canonical F1 contract",()=>{
  const gs=baseState({
    opportunityStatus:"academy_priority",
    interestScore:82,
    prospectReputation:68,
    performanceScore:72,
  });
  const pending=applyMarketTick(gs);
  const negotiation=(pending.driverNegotiations||[]).find((row)=>
    row.origin==="ai" &&
    row.team_id==="T2" &&
    row.driver_id==="J1" &&
    row.offer?.role==="Test Driver"
  );
  assert.ok(negotiation);

  const resolved=processDriverNegotiations(
    {...pending,currentDateISO:negotiation.response_date},
    {forceOutcomeById:{[negotiation.id]:"accepted"}}
  );
  const contract=(resolved.contracts||[]).find((row)=>
    row.team_id==="T2" &&
    row.driver_id==="J1" &&
    row.status==="active"
  );

  assert.ok(contract);
  assert.equal(contract.role,"Test Driver");
  assert.equal(contract.source,"ai_negotiation");
  assert.equal(contract.lower_series_call_up.stage,"test_candidate");
  assert.equal(contract.lower_series_call_up.series_id,"GP2");
  assert.equal(contract.lower_series_call_up.accepted_role,"Test Driver");
});

test("LS6 can convert strong Lower Series evidence into a real vacant race-seat negotiation",()=>{
  const gs=baseState({
    opportunityStatus:"priority",
    interestScore:92,
    prospectReputation:88,
    performanceScore:92,
    secondSeatFilled:false,
    reserveFilled:true,
  });
  gs.driverRatings=gs.driverRatings.filter((row)=>row.driver_id!=="FREE");
  gs.drivers=gs.drivers.filter((row)=>row.driver_id!=="FREE");

  const opportunity=lowerSeriesF1Opportunity(gs,"J1","T2","Second Driver");
  assert.equal(opportunity.recommended,true);
  assert.equal(opportunity.stage,"race_seat_candidate");

  const pending=applyMarketTick(gs);
  const negotiation=(pending.driverNegotiations||[]).find((row)=>
    row.origin==="ai" &&
    row.team_id==="T2" &&
    row.driver_id==="J1" &&
    row.offer?.role==="Second Driver"
  );
  assert.ok(negotiation);
  assert.equal(negotiation.lower_series_opportunity.stage,"race_seat_candidate");

  const resolved=processDriverNegotiations(
    {...pending,currentDateISO:negotiation.response_date},
    {forceOutcomeById:{[negotiation.id]:"accepted"}}
  );
  const contract=(resolved.contracts||[]).find((row)=>
    row.team_id==="T2"&&row.driver_id==="J1"&&row.status==="active"
  );
  assert.ok(contract);
  assert.equal(contract.role,"Second Driver");
  assert.equal(contract.lower_series_call_up.stage,"race_seat_candidate");
});
