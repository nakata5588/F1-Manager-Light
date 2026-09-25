import test from "node:test";
import assert from "node:assert/strict";

import { driverMarketEvaluation, compareDriverMarketValue, driverOverallPresentation } from "../src/domain/driverMarketEvaluation.js";
import { driverLineupSlots, expectedDriverSalary, reserveSeatCount } from "../src/domain/driverContracts.js";
import { applyMarketTick } from "../src/engine/MarketEngine.js";
import { contractRoleLabel, isReserveDriverContract } from "../src/domain/contractRoles.js";
import { aiDriverLineupScore, aiDriverRecruitmentFit, aiLineupUpgradeOpportunity, aiTeamDriverFinancialProfile } from "../src/domain/aiDriverLineup.js";
import { isNegotiationActive, processDriverNegotiations, startDriverNegotiation } from "../src/engine/NegotiationEngine.js";

function marketState(){
  return {
    activeYear:1980,
    currentDateISO:"1980-02-01",
    team:{team_id:"T1",team_name:"Player Team"},
    teams:[
      {team_id:"T1",team_name:"Player Team"},
      {team_id:"T2",team_name:"AI Team Two"},
      {team_id:"T3",team_name:"AI Team Three"},
    ],
    teamBrands:[
      {year:1980,team_id:"T1",team_name:"Player Team",starting_budget:8_000_000},
      {year:1980,team_id:"T2",team_name:"AI Team Two",starting_budget:10_000_000},
      {year:1980,team_id:"T3",team_name:"AI Team Three",starting_budget:6_000_000},
    ],
    drivers:[
      {driver_id:"P1",display_name:"Player One",status:"eligible",canHireF1:true},
      {driver_id:"P2",display_name:"Player Two",status:"eligible",canHireF1:true},
      {driver_id:"A1",display_name:"AI One",status:"eligible",canHireF1:true},
      {driver_id:"A2",display_name:"AI Two",status:"eligible",canHireF1:true},
      {driver_id:"B1",display_name:"AI Three",status:"eligible",canHireF1:true},
      {driver_id:"B2",display_name:"AI Four",status:"eligible",canHireF1:true},
      {driver_id:"R1",display_name:"Experienced Free",status:"eligible",canHireF1:true},
      {driver_id:"R2",display_name:"Rated Free",status:"eligible",canHireF1:true},
    ],
    driverRatings:[
      {driver_id:"P1",current_ability:70},
      {driver_id:"P2",current_ability:68},
      {driver_id:"A1",current_ability:66},
      {driver_id:"A2",current_ability:64},
      {driver_id:"B1",current_ability:65},
      {driver_id:"B2",current_ability:63},
      {driver_id:"R2",current_ability:62,pace:63,reputation:58,market_value:300_000},
    ],
    driverCareer:[
      {driver_id:"R1",year:1977,series_division:"F1",starts:12,wins:0,podiums:1},
      {driver_id:"R1",year:1978,series_division:"F1",starts:15,wins:1,podiums:2},
      {driver_id:"R1",year:1979,series_division:"F1",starts:14,wins:0,podiums:1},
    ],
    contracts:[
      {year:1980,team_id:"T1",driver_id:"P1",role:"Main Driver",status:"active"},
      {year:1980,team_id:"T1",driver_id:"P2",role:"Second Driver",status:"active"},
      {year:1980,team_id:"T2",driver_id:"A1",role:"Main Driver",status:"active"},
      {year:1980,team_id:"T2",driver_id:"A2",role:"Second Driver",status:"active"},
      {year:1980,team_id:"T3",driver_id:"B1",role:"Main Driver",status:"active"},
      {year:1980,team_id:"T3",driver_id:"B2",role:"Second Driver",status:"active"},
    ],
    inbox:[],
  };
}

test("completely missing ratings use a neutral market score, not zero",()=>{
  const gs={
    activeYear:1980,
    drivers:[{driver_id:"X",display_name:"Unknown",status:"eligible"}],
    driverRatings:[{driver_id:"X",current_ability:null,pace:"",racecraft:null,reputation:null}],
    driverCareer:[],
  };
  const evaluation=driverMarketEvaluation(gs,"X");
  assert.equal(evaluation.score,55);
  assert.equal(evaluation.known_attribute_count,0);
  assert.equal(evaluation.attribute_score,null);
  assert.equal(evaluation.data_quality,"unknown");
});

test("partial ratings only use known fields rather than filling missing fields with zero",()=>{
  const gs={
    activeYear:1980,
    drivers:[{driver_id:"X",display_name:"Partial",status:"eligible"}],
    driverRatings:[{driver_id:"X",pace:78,current_ability:null,racecraft:null,consistency:null}],
    driverCareer:[],
  };
  const evaluation=driverMarketEvaluation(gs,"X");
  assert.equal(evaluation.known_attribute_count,1);
  assert.equal(evaluation.attribute_score,78);
  assert.equal(evaluation.score,78);
  assert.equal(evaluation.data_quality,"partial");
});

test("career experience can evaluate a driver even when ratings are missing",()=>{
  const gs=marketState();
  const experienced=driverMarketEvaluation(gs,"R1");
  const rated=driverMarketEvaluation(gs,"R2");

  assert.equal(experienced.known_attribute_count,0);
  assert.equal(experienced.career.hasF1Experience,true);
  assert.ok(experienced.career.starts>=40);
  assert.ok(experienced.score>55);
  assert.ok(Number.isFinite(rated.score));

  const sorted=[gs.drivers.find(d=>d.driver_id==="R2"),gs.drivers.find(d=>d.driver_id==="R1")]
    .sort((a,b)=>compareDriverMarketValue(gs,a,b));
  assert.equal(sorted[0].driver_id,"R1");
});

test("AI teams with complete race seats open reserve negotiations instead of signing instantly",()=>{
  const gs=marketState();
  const pending=applyMarketTick(gs);

  assert.equal(reserveSeatCount(pending,"T2"),0);
  assert.equal(reserveSeatCount(pending,"T3"),0);

  const reserveNegotiations=(pending.driverNegotiations||[]).filter((n)=>
    n.origin==="ai" &&
    n.offer?.role==="Reserve Driver" &&
    isNegotiationActive(n)
  );
  assert.equal(reserveNegotiations.length,2);
  assert.equal(new Set(reserveNegotiations.map((n)=>n.team_id)).size,2);
  assert.ok(reserveNegotiations.every((n)=>n.market_evaluation&&Number.isFinite(n.market_evaluation.score)));
  assert.ok(pending.inbox.some((msg)=>msg.subject==="Reserve Driver position vacant"));

  const responseDate=reserveNegotiations.map((n)=>n.response_date).sort().at(-1);
  const forced=Object.fromEntries(reserveNegotiations.map((n)=>[n.id,"accepted"]));
  const resolved=processDriverNegotiations({...pending,currentDateISO:responseDate},{forceOutcomeById:forced});

  assert.equal(reserveSeatCount(resolved,"T2"),1);
  assert.equal(reserveSeatCount(resolved,"T3"),1);
  const reserves=(resolved.contracts||[]).filter((c)=>isReserveDriverContract(c));
  assert.equal(reserves.length,2);
  assert.ok(reserves.every((c)=>
    c.source==="ai_negotiation" ||
    ["Main Driver","Second Driver"].includes(String(c.role_changed_from||""))
  ),"the final Reserve may be the signing or a race driver demoted by the hierarchy review");
  assert.ok(resolved.inbox.some((msg)=>/signs with/.test(String(msg.subject||""))));
});

test("a test driver does not satisfy the AI reserve requirement",()=>{
  const gs=marketState();
  gs.drivers.push({driver_id:"TEST",display_name:"Test Specialist",status:"eligible",canHireF1:true});
  gs.contracts.push({year:1980,team_id:"T2",driver_id:"TEST",role:"test_driver",status:"active"});
  const pending=applyMarketTick(gs);

  assert.equal(reserveSeatCount(pending,"T2"),0);
  const negotiation=(pending.driverNegotiations||[]).find((n)=>
    n.origin==="ai" &&
    String(n.team_id)==="T2" &&
    n.offer?.role==="Reserve Driver"
  );
  assert.ok(negotiation);
  assert.notEqual(negotiation.driver_id,"TEST");
});

test("AI does not negotiate a second reserve when one is already active",()=>{
  const gs=marketState();
  gs.contracts.push({year:1980,team_id:"T2",driver_id:"R1",role:"Reserve Driver",status:"active"});
  const before=reserveSeatCount(gs,"T2");
  const next=applyMarketTick(gs);
  const after=reserveSeatCount(next,"T2");
  const extra=(next.driverNegotiations||[]).filter((n)=>
    n.origin==="ai" &&
    String(n.team_id)==="T2" &&
    n.offer?.role==="Reserve Driver" &&
    isNegotiationActive(n)
  );

  assert.equal(before,1);
  assert.equal(after,1);
  assert.equal(extra.length,0);
});


test("zero-filled missing ratings are treated as unknown and never as zero overall",()=>{
  const gs={
    activeYear:1980,
    drivers:[{driver_id:"ZERO",display_name:"Zero Placeholder",status:"eligible"}],
    driverRatings:[{
      driver_id:"ZERO",
      current_ability:0,
      overall:0,
      pace:0,
      racecraft:0,
      consistency:0,
      experience:0,
      reputation:0,
      market_value:0,
    }],
    driverCareer:[],
  };
  const evaluation=driverMarketEvaluation(gs,"ZERO");
  const overall=driverOverallPresentation(gs,"ZERO");
  assert.equal(evaluation.known_attribute_count,0);
  assert.equal(evaluation.score,55);
  assert.equal(overall.value,55);
  assert.equal(overall.estimated,true);
  assert.ok(expectedDriverSalary(gs,"ZERO")>300_000,"salary model should use the neutral fallback, not zero ability");
});

test("canonical contract roles expose the labels used by team and market UI",()=>{
  assert.equal(contractRoleLabel({role:"main_driver"}),"Main Driver");
  assert.equal(contractRoleLabel({role:"Second Driver"}),"Second Driver");
  assert.equal(contractRoleLabel({role:"reserve_driver"}),"Reserve Driver");
  assert.equal(contractRoleLabel({role:"test_driver"}),"Test Driver");
});

test("AI retries a vacant reserve role after a rejected offer instead of waiting a month",()=>{
  const initial=applyMarketTick(marketState());
  const first=(initial.driverNegotiations||[]).find((n)=>
    n.origin==="ai" &&
    String(n.team_id)==="T2" &&
    n.offer?.role==="Reserve Driver" &&
    isNegotiationActive(n)
  );
  assert.ok(first);

  const rejected={
    ...initial,
    driverNegotiations:(initial.driverNegotiations||[]).map((n)=>
      n.id===first.id?{...n,status:"rejected",resolved_at:"1980-02-03"}:n
    ),
    currentDateISO:"1980-02-08",
  };
  const retried=applyMarketTick(rejected);
  const t2ReserveOffers=(retried.driverNegotiations||[]).filter((n)=>
    n.origin==="ai" &&
    String(n.team_id)==="T2" &&
    n.offer?.role==="Reserve Driver"
  );
  assert.equal(t2ReserveOffers.length,2);
  assert.ok(t2ReserveOffers.some((n)=>n.status==="rejected"));
  assert.ok(t2ReserveOffers.some((n)=>isNegotiationActive(n)));
  assert.equal(retried._lastAIDriverMarketCheckISO,"1980-02-08");
});


test("AI makes a keep-or-release decision on expiring driver contracts from July",()=>{
  const gs=marketState();
  gs.currentDateISO="1980-07-01";
  const next=applyMarketTick(gs);

  const aiExpiring=(next.contracts||[]).filter((contract)=>
    ["T2","T3"].includes(String(contract.team_id)) &&
    ["A1","A2","B1","B2"].includes(String(contract.driver_id))
  );
  assert.equal(aiExpiring.length,4);
  assert.ok(aiExpiring.every((contract)=>Number(contract.ai_renewal_decision_year)===1980));
  assert.ok(aiExpiring.every((contract)=>["renew","release_end"].includes(contract.ai_renewal_plan)));

  const renewPlans=aiExpiring.filter((contract)=>contract.ai_renewal_plan==="renew");
  for(const contract of renewPlans){
    assert.ok((next.driverNegotiations||[]).some((n)=>
      n.kind==="renewal" &&
      n.origin==="ai" &&
      String(n.driver_id)===String(contract.driver_id) &&
      isNegotiationActive(n)
    ));
  }
});

test("player receives a contract-expiry reminder instead of an automatic renewal",()=>{
  const gs=marketState();
  gs.currentDateISO="1980-07-01";
  const next=applyMarketTick(gs);
  const reminder=(next.inbox||[]).find((msg)=>msg.subject==="Driver contracts expiring this season");
  assert.ok(reminder);
  assert.match(String(reminder.body||""),/Player One/);
  assert.match(String(reminder.body||""),/Player Two/);
  assert.ok((reminder.actions||[]).some((action)=>action.route==="/MyDrivers"));
});


test("D7.1A AI does not prefer an obvious star for a vacant Reserve role when proper reserve candidates exist",()=>{
  const gs=marketState();
  gs.drivers.push({driver_id:"STAR",display_name:"Elite Free Agent",status:"eligible",canHireF1:true});
  gs.driverRatings.push({
    driver_id:"STAR",
    current_ability:92,
    pace:93,
    racecraft:92,
    consistency:90,
    reputation:94,
    mentality:90,
    team_player:72,
  });

  const fit=aiDriverRecruitmentFit(gs,"STAR","T2","Reserve Driver");
  assert.equal(fit.overqualified_for_role,true);
  assert.ok(["Main Driver","Second Driver"].includes(fit.recommended_role));

  const pending=applyMarketTick(gs);
  const t2Reserve=(pending.driverNegotiations||[]).find((n)=>
    n.origin==="ai" &&
    String(n.team_id)==="T2" &&
    n.offer?.role==="Reserve Driver" &&
    isNegotiationActive(n)
  );
  assert.ok(t2Reserve);
  assert.notEqual(t2Reserve.driver_id,"STAR","an elite free agent should not be the normal Reserve choice");
});

test("D7.1A accepted elite AI reserve signing automatically rebalances the race hierarchy",()=>{
  const gs=marketState();
  gs.drivers.push({driver_id:"STAR",display_name:"Elite Signing",status:"eligible",canHireF1:true});
  gs.driverRatings.push({
    driver_id:"STAR",
    current_ability:92,
    pace:93,
    racecraft:92,
    consistency:90,
    reputation:94,
    mentality:90,
    team_player:72,
  });

  const submitted=startDriverNegotiation(gs,{
    driverId:"STAR",
    teamId:"T2",
    teamName:"AI Team Two",
    offer:{salary:1_800_000,years:2,role:"Reserve Driver"},
    origin:"ai",
  });
  const negotiation=(submitted.driverNegotiations||[]).find((n)=>n.driver_id==="STAR");
  assert.ok(negotiation);

  const resolved=processDriverNegotiations(
    {...submitted,currentDateISO:negotiation.response_date},
    {forceOutcomeById:{[negotiation.id]:"accepted"}}
  );
  const lineup=driverLineupSlots(resolved,"T2");

  assert.equal(lineup.main?.driver_id,"STAR","clear best driver should become Main Driver");
  assert.equal(lineup.second?.driver_id,"A1","previous stronger race driver should remain in a race seat");
  assert.equal(lineup.reserve?.driver_id,"A2","weaker former Second Driver should move to Reserve");
  assert.ok((resolved.aiDriverLineupLog||[]).some((row)=>
    row.team_id==="T2"&&row.driver_id==="STAR"
  ));
  assert.ok(aiDriverLineupScore(resolved,"STAR").score>aiDriverLineupScore(resolved,"A1").score);
});

test("D7.1A close ratings do not cause automatic hierarchy churn",()=>{
  const gs=marketState();
  gs.drivers.push({driver_id:"CLOSE",display_name:"Close Reserve",status:"eligible",canHireF1:true});
  gs.driverRatings.push({
    driver_id:"CLOSE",
    current_ability:67,
    pace:67,
    racecraft:67,
    consistency:67,
    reputation:62,
  });

  const submitted=startDriverNegotiation(gs,{
    driverId:"CLOSE",
    teamId:"T2",
    teamName:"AI Team Two",
    offer:{salary:500_000,years:1,role:"Reserve Driver"},
    origin:"ai",
  });
  const negotiation=(submitted.driverNegotiations||[]).find((n)=>n.driver_id==="CLOSE");
  assert.ok(negotiation);

  const resolved=processDriverNegotiations(
    {...submitted,currentDateISO:negotiation.response_date},
    {forceOutcomeById:{[negotiation.id]:"accepted"}}
  );
  const lineup=driverLineupSlots(resolved,"T2");

  assert.equal(lineup.main?.driver_id,"A1");
  assert.equal(lineup.second?.driver_id,"A2");
  assert.equal(lineup.reserve?.driver_id,"CLOSE");
});


test("D7.1B full AI line-up still identifies a materially better free-agent upgrade",()=>{
  const gs=marketState();
  gs.contracts.push({
    year:1980,team_id:"T2",driver_id:"RLOW",driver_name:"Reserve Low",
    role:"Reserve Driver",salary:120_000,status:"active",
  });
  gs.drivers.push(
    {driver_id:"RLOW",display_name:"Reserve Low",status:"eligible",canHireF1:true},
    {driver_id:"STAR2",display_name:"Elite Free Agent",status:"eligible",canHireF1:true}
  );
  gs.driverRatings.push(
    {driver_id:"RLOW",current_ability:52,reputation:45},
    {
      driver_id:"STAR2",current_ability:90,pace:91,racecraft:90,
      consistency:88,reputation:91,mentality:90,team_player:78,
    }
  );

  const finance=aiTeamDriverFinancialProfile(gs,"T2");
  assert.equal(finance.starting_budget,10_000_000);
  assert.equal(finance.driver_payroll_limit,4_000_000);

  const opportunity=aiLineupUpgradeOpportunity(gs,gs.drivers,"T2");
  assert.ok(opportunity);
  assert.equal(opportunity.driver_id,"STAR2");
  assert.equal(opportunity.target_driver_id,"A2");
  assert.ok(opportunity.upgrade_gap>=8);
  assert.equal(opportunity.offered_role,"Main Driver");
  assert.ok(opportunity.salary<=finance.driver_payroll_limit);
});

test("D7.1B market opens an upgrade negotiation even when Main Second and Reserve are occupied",()=>{
  const gs=marketState();
  gs.contracts.push({
    year:1980,team_id:"T2",driver_id:"RLOW",driver_name:"Reserve Low",
    role:"Reserve Driver",salary:120_000,status:"active",
  });
  gs.drivers.push(
    {driver_id:"RLOW",display_name:"Reserve Low",status:"eligible",canHireF1:true},
    {driver_id:"STAR2",display_name:"Elite Free Agent",status:"eligible",canHireF1:true}
  );
  gs.driverRatings.push(
    {driver_id:"RLOW",current_ability:52,reputation:45},
    {
      driver_id:"STAR2",current_ability:90,pace:91,racecraft:90,
      consistency:88,reputation:91,mentality:90,team_player:78,
    }
  );

  const next=applyMarketTick(gs);
  const upgrade=(next.driverNegotiations||[]).find((n)=>
    n.origin==="ai" &&
    String(n.team_id)==="T2" &&
    Boolean(n?.lineup_upgrade?.target_driver_id)
  );
  assert.ok(upgrade,"AI should actively pursue a clear free-agent race-seat upgrade");
  assert.equal(upgrade.driver_id,"STAR2");
  assert.equal(upgrade.lineup_upgrade.target_driver_id,"A2");
  assert.ok(["Main Driver","Second Driver"].includes(upgrade.offer.role));
});

test("D7.1B accepted elite upgrade restructures a full AI line-up atomically",()=>{
  let gs=marketState();
  gs.contracts=gs.contracts.map((row)=>
    row.team_id==="T2"?{...row,salary:row.driver_id==="A1"?650_000:500_000}:row
  );
  gs.contracts.push({
    year:1980,team_id:"T2",driver_id:"RLOW",driver_name:"Reserve Low",
    role:"Reserve Driver",salary:120_000,status:"active",
  });
  gs.drivers.push(
    {driver_id:"RLOW",display_name:"Reserve Low",status:"eligible",canHireF1:true},
    {driver_id:"STAR2",display_name:"Elite Free Agent",status:"eligible",canHireF1:true}
  );
  gs.driverRatings.push(
    {driver_id:"RLOW",current_ability:52,reputation:45},
    {
      driver_id:"STAR2",current_ability:90,pace:91,racecraft:90,
      consistency:88,reputation:91,mentality:90,team_player:78,
    }
  );

  gs=applyMarketTick(gs);
  const upgrade=(gs.driverNegotiations||[]).find((n)=>
    n.origin==="ai" &&
    String(n.team_id)==="T2" &&
    n.driver_id==="STAR2" &&
    Boolean(n?.lineup_upgrade?.target_driver_id)
  );
  assert.ok(upgrade);

  const resolved=processDriverNegotiations(
    {...gs,currentDateISO:upgrade.response_date},
    {forceOutcomeById:{[upgrade.id]:"accepted"}}
  );
  const lineup=driverLineupSlots(resolved,"T2");

  assert.equal(lineup.main?.driver_id,"STAR2");
  assert.equal(lineup.second?.driver_id,"A1");
  assert.equal(lineup.reserve?.driver_id,"A2");
  const oldReserve=(resolved.contracts||[]).find((row)=>
    row.team_id==="T2"&&row.driver_id==="RLOW"
  );
  assert.equal(oldReserve.status,"released");
  assert.equal(oldReserve.termination_reason,"ai_lineup_upgrade_reserve_replacement");
});

test("D7.1B low-budget AI team does not chase an unaffordable elite free agent",()=>{
  const gs=marketState();
  gs.teamBrands=gs.teamBrands.map((row)=>
    row.team_id==="T2"?{...row,starting_budget:1_500_000}:row
  );
  gs.contracts=gs.contracts.map((row)=>
    row.team_id==="T2"?{...row,salary:350_000}:row
  );
  gs.drivers.push({driver_id:"STAR3",display_name:"Very Expensive Star",status:"eligible",canHireF1:true});
  gs.driverRatings.push({
    driver_id:"STAR3",current_ability:96,pace:97,racecraft:96,
    consistency:95,reputation:98,mentality:95,team_player:80,
  });

  const opportunity=aiLineupUpgradeOpportunity(gs,gs.drivers,"T2");
  assert.equal(opportunity?.driver_id==="STAR3",false);
});


test("D7.1B 1980 Alfa-like lineup actively considers a Lauda-level free agent",()=>{
  const gs=marketState();
  gs.teamBrands=gs.teamBrands.map((row)=>
    row.team_id==="T2"?{...row,starting_budget:10_000_000}:row
  );
  gs.driverRatings=gs.driverRatings.map((row)=>{
    if(row.driver_id==="A1")return {...row,current_ability:69.4,pace:69.4,reputation:66};
    if(row.driver_id==="A2")return {...row,current_ability:74.2,pace:74.2,reputation:75};
    return row;
  });
  gs.contracts=gs.contracts.map((row)=>{
    if(row.team_id!=="T2")return row;
    if(row.driver_id==="A1")return {...row,salary:350_000};
    if(row.driver_id==="A2")return {...row,salary:400_000};
    return row;
  });
  gs.drivers.push({
    driver_id:"LAUDA_LEVEL",
    display_name:"Lauda-level Free Agent",
    status:"eligible",
    canHireF1:true,
  });
  gs.driverRatings.push({
    driver_id:"LAUDA_LEVEL",
    current_ability:83.9,
    pace:76.2,
    racecraft:87.4,
    consistency:89.4,
    reputation:90,
    mentality:92,
    pressure_handling:92,
    team_player:85.2,
  });

  const opportunity=aiLineupUpgradeOpportunity(gs,gs.drivers,"T2");
  assert.ok(opportunity,"a wealthy team should see the clear free-agent upgrade");
  assert.equal(opportunity.driver_id,"LAUDA_LEVEL");
  assert.equal(opportunity.target_driver_id,"A2");
  assert.ok(opportunity.upgrade_gap>=8);
  assert.ok(opportunity.financial_profile.driver_payroll+opportunity.salary<=opportunity.financial_profile.driver_payroll_limit);
});
