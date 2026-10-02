import test from "node:test";
import assert from "node:assert/strict";

import {
  applyFinanceTransaction,
  applyTeamBudgetDelta,
} from "../src/domain/teamFinance.js";
import { applyEconomyTick } from "../src/engine/EconomyEngine.js";

function financeState(balance=1_000_000){
  return {
    activeYear:1980,
    currentDateISO:"1980-02-01",
    team:{team_id:"T1",team_name:"Player Team",budget:balance},
    finances:{
      balance,
      budget:balance,
      season_income:0,
      season_spend:0,
    },
    financeLog:[],
  };
}

test("canonical finance gateway reconciles balance, ledger and season totals",()=>{
  const opening=1_000_000;
  let gs=financeState(opening);

  gs=applyFinanceTransaction(gs,{
    teamId:"T1",
    amount:500_000,
    category:"Sponsor",
    subtype:"monthly_payment",
    sig:"sponsor:T1:1980-01",
    source:"sponsor_contract",
    sourceId:"SP1",
  });
  gs=applyFinanceTransaction(gs,{
    teamId:"T1",
    amount:-125_000,
    category:"Driver Salary",
    subtype:"salary",
    sig:"salary:T1:D1:1980-01",
    source:"driver_contract",
    sourceId:"D1",
  });

  assert.equal(gs.finances.balance,1_375_000);
  assert.equal(gs.finances.budget,1_375_000);
  assert.equal(gs.team.budget,1_375_000);
  assert.equal(gs.finances.season_income,500_000);
  assert.equal(gs.finances.season_spend,125_000);
  assert.equal(gs.finances.season_net,375_000);
  assert.equal(gs.financeLog.length,2);

  const ledgerDelta=gs.financeLog.reduce((sum,tx)=>sum+tx.amount,0);
  assert.equal(opening+ledgerDelta,gs.finances.balance);

  const sponsor=gs.financeLog.find((tx)=>tx.sig==="sponsor:T1:1980-01");
  assert.equal(sponsor.teamId,"T1");
  assert.equal(sponsor.season,1980);
  assert.equal(sponsor.type,"income");
  assert.equal(sponsor.subtype,"monthly_payment");
  assert.equal(sponsor.source,"sponsor_contract");
  assert.equal(sponsor.sourceId,"SP1");
});

test("canonical finance gateway rejects a duplicate sig before changing money",()=>{
  let gs=financeState();

  gs=applyFinanceTransaction(gs,{
    teamId:"T1",
    amount:250_000,
    category:"Sponsor - Upfront",
    sig:"sp_upfront:1980:T1:SP1",
  });
  const afterFirst=gs;
  gs=applyFinanceTransaction(gs,{
    teamId:"T1",
    amount:250_000,
    category:"Sponsor - Upfront",
    sig:"sp_upfront:1980:T1:SP1",
  });

  assert.strictEqual(gs,afterFirst);
  assert.equal(gs.finances.balance,1_250_000);
  assert.equal(gs.finances.season_income,250_000);
  assert.equal(gs.financeLog.length,1);
});

test("legacy player budget gateway inherits canonical idempotency",()=>{
  let gs=financeState();

  gs=applyTeamBudgetDelta(gs,"T1",-100_000,{
    category:"Staff Transfer",
    sig:"staff-transfer:T1:S1",
  });
  gs=applyTeamBudgetDelta(gs,"T1",-100_000,{
    category:"Staff Transfer",
    sig:"staff-transfer:T1:S1",
  });

  assert.equal(gs.finances.balance,900_000);
  assert.equal(gs.team.budget,900_000);
  assert.equal(gs.finances.season_spend,100_000);
  assert.equal(gs.financeLog.length,1);
});

test("zero balance remains a valid canonical balance",()=>{
  let gs=financeState(0);
  gs.team.budget=900_000;

  gs=applyFinanceTransaction(gs,{
    teamId:"T1",
    amount:100_000,
    category:"Board Funding",
    sig:"board:T1:1980-02",
  });

  assert.equal(gs.finances.balance,100_000);
  assert.equal(gs.team.budget,100_000);
});

test("EconomyEngine routes monthly cashflow through the canonical gateway",()=>{
  let gs={
    ...financeState(),
    sponsorsContracts:[
      {
        year:1980,
        team_id:"T1",
        sponsor_id:"SP1",
        sponsor_name:"Acme",
        monthly_fee:120_000,
        status:"active",
      },
    ],
    staffContracts:[],
    contracts:[],
    teamBrands:[],
    teamEngines:[],
    rdProjectsActive:[],
    inbox:[],
  };

  gs=applyEconomyTick(gs);

  assert.equal(gs.finances.balance,1_120_000);
  assert.equal(gs.finances.season_income,120_000);
  assert.equal(gs.financeLog.length,1);
  assert.equal(gs.financeLog[0].sig,"spM:1980-01:T1:SP1");
  assert.equal(gs.financeLog[0].teamId,"T1");

  const repeated=applyEconomyTick(gs);
  assert.equal(repeated.finances.balance,1_120_000);
  assert.equal(repeated.financeLog.length,1);
});
