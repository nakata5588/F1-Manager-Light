// src/domain/aiDriverLineup.js
// D7.1A — AI Driver Line-up Intelligence.
//
// AI teams should not treat Main/Second/Reserve as empty buckets.
// Recruitment is role-aware and accepted AI contracts can trigger a bounded
// hierarchy review when a clearly stronger driver joins the squad.

import {
  activeDriverContracts,
  changeDriverContractRole,
  driverIdOf,
  driverLineupSlots,
  expectedDriverSalary,
  swapRaceDriverRoles,
  teamIdOf,
  terminationCost,
} from "./driverContracts.js";
import { driverRoleSlot } from "./contractRoles.js";
import { driverContractDecision, driverDecisionTraits } from "./driverDecisionModel.js";
import { driverFormSnapshot } from "./driverForm.js";
import { driverMarketEvaluation } from "./driverMarketEvaluation.js";
import { teamReputation } from "./teamReputation.js";

const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
const round2=(value)=>Math.round(Number(value||0)*100)/100;
const text=(value)=>String(value??"").trim();

function driverOf(gs,driverOrId){
  if(driverOrId&&typeof driverOrId==="object")return driverOrId;
  const id=text(driverOrId);
  return (gs?.drivers||[]).find((row)=>driverIdOf(row)===id)
    ||(gs?.dbDrivers||[]).find((row)=>driverIdOf(row)===id)
    ||{driver_id:id};
}

function roleLabel(slot){
  if(slot==="main")return "Main Driver";
  if(slot==="second")return "Second Driver";
  if(slot==="reserve")return "Reserve Driver";
  if(slot==="test")return "Test Driver";
  return "Driver";
}

function roleRank(slot){
  if(slot==="main")return 4;
  if(slot==="second")return 3;
  if(slot==="reserve")return 2;
  if(slot==="test")return 1;
  return 0;
}

function finite(value,fallback=null){
  const n=Number(value);
  return Number.isFinite(n)?n:fallback;
}


function unbox(value){
  if(value&&typeof value==="object"&&!Array.isArray(value)){
    if(value.result!==undefined&&value.result!==null&&value.result!=="")return unbox(value.result);
    if(value.value!==undefined&&value.value!==null&&value.value!=="")return unbox(value.value);
  }
  return value;
}

function teamIdOfBrand(row){
  return text(unbox(row?.team_id??row?.constructor_id??row?.team));
}

function teamBrandForYear(gs,teamId){
  const rows=(Array.isArray(gs?.teamBrands)&&gs.teamBrands.length)
    ?gs.teamBrands
    :(Array.isArray(gs?.dbTeamBrands)?gs.dbTeamBrands:[]);
  const year=Number(gs?.activeYear);
  const exact=rows.find((row)=>teamIdOfBrand(row)===text(teamId)&&Number(unbox(row?.year??row?.season_year))===year);
  if(exact)return exact;
  return rows.find((row)=>teamIdOfBrand(row)===text(teamId))||null;
}

export function aiTeamDriverFinancialProfile(gs,teamId){
  const tid=text(teamId);
  const brand=teamBrandForYear(gs,tid);
  const rawBudget=finite(unbox(
    brand?.starting_budget??brand?.start_budget??brand?.budget_start
  ),null);
  const fallbackBudget=finite(
    (gs?.teams||[]).find((row)=>text(row?.team_id??row?.id)===tid)?.budget,
    5_000_000
  );
  const startingBudget=Math.max(1_500_000,rawBudget??fallbackBudget??5_000_000);
  const contracts=activeDriverContracts(gs,{teamId:tid});
  const payroll=contracts.reduce((sum,row)=>sum+Math.max(0,finite(unbox(row?.salary??row?.salary_yearly),0)),0);

  // Driver payroll is intentionally a strategic envelope rather than a full
  // AI accounting system. It lets wealthy teams pursue upgrades without giving
  // them unlimited salary commitments before the dedicated AI finance model.
  const payrollLimit=Math.max(900_000,startingBudget*0.40);
  return {
    team_id:tid,
    starting_budget:Math.round(startingBudget),
    driver_payroll:Math.round(payroll),
    driver_payroll_limit:Math.round(payrollLimit),
    available_driver_budget:Math.round(Math.max(0,payrollLimit-payroll)),
  };
}

export function aiLineupUpgradeOpportunity(gs,drivers,teamId,{activeOfferCount=()=>0}={}){
  const tid=text(teamId);
  const lineup=driverLineupSlots(gs,tid);
  if(!lineup.main||!lineup.second)return null;

  const activeIds=new Set(activeDriverContracts(gs).map(driverIdOf));
  const mainScore=aiDriverLineupScore(gs,driverIdOf(lineup.main)).score;
  const secondScore=aiDriverLineupScore(gs,driverIdOf(lineup.second)).score;
  const finance=aiTeamDriverFinancialProfile(gs,tid);
  const reputation=teamReputation(gs,tid);

  const options=[];
  for(const driver of drivers||[]){
    const did=driverIdOf(driver);
    if(!did||activeIds.has(did))continue;

    const score=aiDriverLineupScore(gs,did).score;
    const gap=score-secondScore;
    if(gap<8)continue;

    const role=score>=mainScore+4?"Main Driver":"Second Driver";
    const salary=Math.max(75_000,Math.round(expectedDriverSalary(gs,did,{role})/5_000)*5_000);
    if(finance.driver_payroll+salary>finance.driver_payroll_limit)continue;

    const decision=driverContractDecision(gs,{
      driverId:did,
      teamId:tid,
      kind:"new_contract",
      offer:{salary,years:2,role},
    });
    if(Number(decision?.acceptance_probability||0)<0.38)continue;

    const offerCount=Math.max(0,Number(activeOfferCount(did)||0));
    const value=
      gap*4+
      Number(decision?.interest_score||0)*0.42+
      Math.max(0,Number(reputation||50)-45)*0.20-
      offerCount*12;

    options.push({
      driver,
      driver_id:did,
      target_driver_id:driverIdOf(lineup.second),
      target_role:"Second Driver",
      offered_role:role,
      candidate_score:round2(score),
      main_score:round2(mainScore),
      second_score:round2(secondScore),
      upgrade_gap:round2(gap),
      salary,
      years:2,
      interest_score:Number(decision?.interest_score||0),
      acceptance_probability:Number(decision?.acceptance_probability||0),
      team_reputation:round2(reputation),
      financial_profile:finance,
      active_offer_count:offerCount,
      value:round2(value),
    });
  }

  return options.sort((a,b)=>
    b.value-a.value||
    b.upgrade_gap-a.upgrade_gap||
    a.active_offer_count-b.active_offer_count||
    a.driver_id.localeCompare(b.driver_id)
  )[0]||null;
}

function strictRoleSlot(contract){
  const role=String(contract?.role??contract?.position??contract?.contract_role??"")
    .trim().toLowerCase().replace(/[\s-]+/g,"_");
  if(/(^|_)(reserve|reserva)(_|$)/.test(role))return "reserve";
  if(/(^|_)(test|tester)(_|$)/.test(role))return "test";
  if(/second|driver_?2|segundo/.test(role))return "second";
  if(/main|first|lead|driver_?1|titular/.test(role))return "main";
  return null;
}

function roleOccupant(gs,teamId,role,{excludeDriverId=null}={}){
  const slot=driverRoleSlot(role);
  if(!slot)return null;
  return activeDriverContracts(gs,{teamId:text(teamId)}).find((contract)=>
    driverRoleSlot(contract)===slot &&
    driverIdOf(contract)!==text(excludeDriverId)
  )||null;
}

function markAiContractReleased(gs,contract,reason){
  if(!contract)return gs;
  const today=String(gs?.currentDateISO||"").slice(0,10)||null;
  const cost=terminationCost(gs,contract);
  const tid=teamIdOf(contract);
  const did=driverIdOf(contract);
  const financeEntry={
    id:"ai_driver_termination:"+tid+":"+did+":"+today,
    date:today,
    team_id:tid,
    driver_id:did,
    type:"driver_termination",
    amount:-cost,
    reason,
  };
  return {
    ...gs,
    contracts:(Array.isArray(gs?.contracts)?gs.contracts:[]).map((row)=>
      row===contract?{
        ...row,
        status:"released",
        released_at:today,
        termination_reason:reason,
        termination_cost:cost,
      }:row
    ),
    aiTeamFinanceLog:[
      financeEntry,
      ...(Array.isArray(gs?.aiTeamFinanceLog)?gs.aiTeamFinanceLog:[])
        .filter((row)=>row?.id!==financeEntry.id),
    ].slice(0,500),
  };
}

export function aiRoleConflictDecision(gs,{
  teamId,
  candidateId,
  role,
  salary=0,
}={}){
  const tid=text(teamId);
  const cid=text(candidateId);
  const slot=driverRoleSlot(role);
  const incumbent=roleOccupant(gs,tid,role,{excludeDriverId:cid});
  if(!slot||!incumbent){
    return {
      conflict:false,
      replace:true,
      team_id:tid,
      slot,
      incumbent:null,
      termination_cost:0,
      reason:"role_vacant",
    };
  }

  const candidateScore=aiDriverLineupScore(gs,cid).score;
  const incumbentId=driverIdOf(incumbent);
  const incumbentScore=aiDriverLineupScore(gs,incumbentId).score;
  const gap=round2(candidateScore-incumbentScore);
  const finance=aiTeamDriverFinancialProfile(gs,tid);
  const incumbentSalary=Math.max(0,finite(unbox(incumbent?.salary??incumbent?.salary_yearly),0));
  const newSalary=Math.max(0,Number(salary)||0);
  const exitCost=terminationCost(gs,incumbent);
  const projectedPayroll=finance.driver_payroll-incumbentSalary+newSalary;
  const minGap=(slot==="main"||slot==="second")?4:3;
  const baseExitShare=(slot==="main"||slot==="second")?0.12:0.07;
  const exitBudget=
    finance.starting_budget*baseExitShare+
    Math.max(0,gap-minGap)*finance.starting_budget*0.012;
  const payrollFits=projectedPayroll<=finance.driver_payroll_limit;
  const exitFits=exitCost<=Math.max(125_000,exitBudget);
  const replace=gap>=minGap&&payrollFits&&exitFits;

  return {
    conflict:true,
    replace,
    team_id:tid,
    slot,
    incumbent,
    incumbent_driver_id:incumbentId,
    candidate_driver_id:cid,
    candidate_score:round2(candidateScore),
    incumbent_score:round2(incumbentScore),
    score_gap:gap,
    termination_cost:exitCost,
    projected_payroll:Math.round(projectedPayroll),
    payroll_limit:finance.driver_payroll_limit,
    payroll_fits:payrollFits,
    exit_cost_fits:exitFits,
    reason:replace
      ?"candidate_materially_better_and_affordable"
      :(gap<minGap
        ?"incumbent_quality_close"
        :(!payrollFits?"replacement_payroll_too_high":"termination_cost_too_high")),
  };
}

export function prepareAiRoleSigning(gs,{
  teamId,
  candidateId,
  role,
  salary=0,
}={}){
  const decision=aiRoleConflictDecision(gs,{teamId,candidateId,role,salary});
  if(!decision.conflict){
    return {state:gs,prepared:true,decision};
  }
  if(!decision.replace){
    return {state:gs,prepared:false,decision};
  }

  let next=markAiContractReleased(
    gs,
    decision.incumbent,
    "ai_competing_offer_replacement"
  );
  next=appendLineupLog(next,{
    team_id:text(teamId),
    driver_id:text(candidateId),
    displaced_driver_id:decision.incumbent_driver_id,
    from_role:null,
    to_role:roleLabel(decision.slot),
    reason:"ai_competing_offer_replacement",
    candidate_score:decision.candidate_score,
    displaced_score:decision.incumbent_score,
    termination_cost:decision.termination_cost,
  });
  return {state:next,prepared:true,decision};
}

export function reconcileAiDriverRoleUniqueness(gs,teamId){
  const tid=text(teamId);
  if(!tid)return gs;
  const playerTeamId=text(gs?.team?.team_id??gs?.team?.id);
  if(tid===playerTeamId)return gs;

  let next=gs;
  for(const slot of ["main","second","reserve","test"]){
    const contracts=activeDriverContracts(next,{teamId:tid})
      .filter((contract)=>strictRoleSlot(contract)===slot);
    if(contracts.length<=1)continue;

    const ranked=contracts.slice().sort((a,b)=>{
      const scoreDiff=
        aiDriverLineupScore(next,driverIdOf(b)).score-
        aiDriverLineupScore(next,driverIdOf(a)).score;
      if(Math.abs(scoreDiff)>0.001)return scoreDiff;
      const aStart=Number(unbox(a?.contract_start_year??a?.year))||0;
      const bStart=Number(unbox(b?.contract_start_year??b?.year))||0;
      if(aStart!==bStart)return aStart-bStart;
      return driverIdOf(a).localeCompare(driverIdOf(b));
    });
    const keep=ranked[0];
    for(const duplicate of ranked.slice(1)){
      const cost=terminationCost(next,duplicate);
      next=markAiContractReleased(next,duplicate,"ai_role_invariant_repair");
      next=appendLineupLog(next,{
        team_id:tid,
        driver_id:driverIdOf(keep),
        displaced_driver_id:driverIdOf(duplicate),
        from_role:roleLabel(slot),
        to_role:roleLabel(slot),
        reason:"ai_role_invariant_repair",
        candidate_score:aiDriverLineupScore(next,driverIdOf(keep)).score,
        displaced_score:aiDriverLineupScore(next,driverIdOf(duplicate)).score,
        termination_cost:cost,
      });
    }
  }
  return next;
}

export function prepareAiLineupUpgradeSigning(gs,{
  teamId,
  targetDriverId,
  offeredRole,
}={}){
  const tid=text(teamId);
  const targetId=text(targetDriverId);
  const lineup=driverLineupSlots(gs,tid);
  if(!tid||!targetId||!lineup.main||!lineup.second){
    return {state:gs,prepared:false,reason:"lineup_incomplete"};
  }
  if(driverIdOf(lineup.second)!==targetId){
    return {state:gs,prepared:false,reason:"upgrade_target_changed"};
  }

  let next=gs;
  const displacedSecond=lineup.second;
  const reserve=lineup.reserve;
  const secondScore=aiDriverLineupScore(next,targetId).score;
  const reserveScore=reserve?aiDriverLineupScore(next,driverIdOf(reserve)).score:null;

  if(reserve){
    if(Number(reserveScore)>=Number(secondScore)+2){
      next=markAiContractReleased(next,displacedSecond,"ai_lineup_upgrade");
    }else{
      next=markAiContractReleased(next,reserve,"ai_lineup_upgrade_reserve_replacement");
      next=changeDriverContractRole(next,{
        driverId:targetId,
        targetRole:"Reserve Driver",
        teamId:tid,
        swapIfOccupied:false,
      });
    }
  }else{
    next=changeDriverContractRole(next,{
      driverId:targetId,
      targetRole:"Reserve Driver",
      teamId:tid,
      swapIfOccupied:false,
    });
  }

  if(String(offeredRole)==="Main Driver"){
    const after=driverLineupSlots(next,tid);
    if(!after.main||after.second){
      return {state:gs,prepared:false,reason:"unable_to_free_second_role"};
    }
    next=changeDriverContractRole(next,{
      driverId:driverIdOf(after.main),
      targetRole:"Second Driver",
      teamId:tid,
      swapIfOccupied:false,
    });
  }

  const freed=driverLineupSlots(next,tid);
  const expectedSlot=String(offeredRole)==="Main Driver"?"main":"second";
  if(freed[expectedSlot]){
    return {state:gs,prepared:false,reason:"upgrade_role_not_freed"};
  }

  next=appendLineupLog(next,{
    team_id:tid,
    driver_id:null,
    displaced_driver_id:targetId,
    from_role:"Second Driver",
    to_role:driverLineupSlots(next,tid).reserve&&driverIdOf(driverLineupSlots(next,tid).reserve)===targetId
      ?"Reserve Driver"
      :"Released",
    reason:"ai_lineup_upgrade_prepared",
    candidate_score:null,
    displaced_score:round2(secondScore),
  });

  return {state:next,prepared:true,reason:"ready"};
}

export function aiDriverLineupScore(gs,driverOrId){
  const driver=driverOf(gs,driverOrId);
  const id=driverIdOf(driver);
  const evaluation=driverMarketEvaluation(gs,id);
  const form=driverFormSnapshot(gs,id);
  const market=Number(evaluation?.score||55);
  const formScore=finite(form?.score,null);
  // Market evaluation remains authoritative; live Form can move hierarchy
  // modestly without turning one race into an instant demotion.
  const score=formScore===null
    ?market
    :market*0.84+clamp(formScore,20,95)*0.16;
  return {
    driver_id:id,
    score:round2(score),
    market_score:round2(market),
    form_score:formScore===null?null:round2(formScore),
    market_quality:evaluation?.data_quality||"unknown",
  };
}

function teamRaceBenchmarks(gs,teamId){
  const lineup=driverLineupSlots(gs,teamId);
  const main=lineup.main?aiDriverLineupScore(gs,driverIdOf(lineup.main)):null;
  const second=lineup.second?aiDriverLineupScore(gs,driverIdOf(lineup.second)):null;
  const available=[main,second].filter(Boolean);
  const strongest=available.slice().sort((a,b)=>b.score-a.score)[0]||null;
  const weakest=available.slice().sort((a,b)=>a.score-b.score)[0]||null;
  return {lineup,main,second,strongest,weakest};
}

export function aiDriverRecruitmentFit(gs,driverOrId,teamId,role){
  const driver=driverOf(gs,driverOrId);
  const driverId=driverIdOf(driver);
  const targetSlot=driverRoleSlot(role);
  const lineupScore=aiDriverLineupScore(gs,driverId);
  const traits=driverDecisionTraits(gs,driverId);
  const bench=teamRaceBenchmarks(gs,teamId);
  const desiredRank=Number(traits?.desired_role_rank||2);
  const targetRank=roleRank(targetSlot);

  let fit=50;
  let overqualified=false;
  let recommendedRole=roleLabel(targetSlot);

  if(targetSlot==="reserve"||targetSlot==="test"){
    const weak=Number(bench.weakest?.score??65);
    const reserveTarget=Math.max(45,weak-(targetSlot==="reserve"?8:14));
    fit=78-Math.abs(lineupScore.score-reserveTarget)*2.3;

    const stage=String(traits?.career_stage||"");
    const veteranException=["decline","retirement_window"].includes(stage);
    overqualified=
      !veteranException &&
      lineupScore.score>=70 &&
      lineupScore.score>=weak+5 &&
      desiredRank>=3;

    if(overqualified){
      fit-=55;
      if(bench.strongest&&lineupScore.score>=bench.strongest.score+4){
        recommendedRole="Main Driver";
      }else{
        recommendedRole="Second Driver";
      }
    }

    if(desiredRank>targetRank)fit-=(desiredRank-targetRank)*9;
    if(veteranException)fit+=8;
  }else{
    const weak=Number(bench.weakest?.score??55);
    const strong=Number(bench.strongest?.score??weak);
    const reference=targetSlot==="main"?strong:weak;
    fit=58+(lineupScore.score-reference)*2.0;
    if(desiredRank===targetRank)fit+=10;
    if(desiredRank<targetRank)fit+=5;
    if(desiredRank>targetRank)fit-=(desiredRank-targetRank)*8;
  }

  return {
    driver_id:driverId,
    team_id:text(teamId),
    requested_role:roleLabel(targetSlot),
    requested_slot:targetSlot,
    recommended_role:recommendedRole,
    lineup_score:lineupScore.score,
    market_score:lineupScore.market_score,
    desired_role:traits?.desired_role||null,
    desired_role_rank:desiredRank,
    career_stage:traits?.career_stage||"unknown",
    overqualified_for_role:overqualified,
    fit_score:round2(clamp(fit,0,100)),
    race_benchmark:{
      strongest:bench.strongest?.score??null,
      weakest:bench.weakest?.score??null,
    },
  };
}

export function rankAiRecruitmentCandidates(gs,drivers,teamId,role,{activeOfferCount=()=>0}={}){
  const entries=(drivers||[]).map((driver)=>({
    driver,
    fit:aiDriverRecruitmentFit(gs,driver,teamId,role),
    offer_count:Number(activeOfferCount(driverIdOf(driver))||0),
  }));

  // For Reserve/Test, avoid clearly overqualified stars whenever there is a
  // plausible role-fit candidate available. This prevents "Lauda as reserve"
  // while still allowing veteran/decline exceptions.
  const targetSlot=driverRoleSlot(role);
  const hasRoleFitAlternative=
    (targetSlot==="reserve"||targetSlot==="test") &&
    entries.some((entry)=>!entry.fit.overqualified_for_role&&entry.fit.fit_score>=35);

  const filtered=hasRoleFitAlternative
    ?entries.filter((entry)=>!entry.fit.overqualified_for_role)
    :entries;

  return filtered.sort((a,b)=>{
    if(a.offer_count!==b.offer_count)return a.offer_count-b.offer_count;
    if(Math.abs(b.fit.fit_score-a.fit.fit_score)>0.001)return b.fit.fit_score-a.fit.fit_score;
    if(Math.abs(b.fit.lineup_score-a.fit.lineup_score)>0.001)return b.fit.lineup_score-a.fit.lineup_score;
    return driverIdOf(a.driver).localeCompare(driverIdOf(b.driver));
  });
}

function appendLineupLog(gs,entry){
  return {
    ...gs,
    aiDriverLineupLog:[
      ...(Array.isArray(gs?.aiDriverLineupLog)?gs.aiDriverLineupLog:[]),
      {
        date:String(gs?.currentDateISO||"").slice(0,10)||null,
        year:Number(gs?.activeYear)||null,
        ...entry,
      },
    ].slice(-250),
  };
}

export function rebalanceAiDriverLineup(gs,teamId,{newDriverId=null,reason="post_signing_review"}={}){
  if(!gs)return gs;
  const tid=text(teamId);
  if(!tid)return gs;

  const playerTeamId=text(gs?.team?.team_id??gs?.team?.id);
  if(tid===playerTeamId)return gs;

  let next=gs;
  let lineup=driverLineupSlots(next,tid);
  const reserveCandidates=[lineup.reserve,lineup.test].filter(Boolean);
  if(newDriverId){
    reserveCandidates.sort((a,b)=>{
      const aid=driverIdOf(a),bid=driverIdOf(b);
      if(aid===text(newDriverId)&&bid!==text(newDriverId))return -1;
      if(bid===text(newDriverId)&&aid!==text(newDriverId))return 1;
      return aiDriverLineupScore(next,bid).score-aiDriverLineupScore(next,aid).score;
    });
  }else{
    reserveCandidates.sort((a,b)=>
      aiDriverLineupScore(next,driverIdOf(b)).score-aiDriverLineupScore(next,driverIdOf(a)).score
    );
  }

  const candidate=reserveCandidates[0]||null;
  if(candidate&&lineup.main&&lineup.second){
    const candidateId=driverIdOf(candidate);
    const candidateScore=aiDriverLineupScore(next,candidateId).score;
    const mainScore=aiDriverLineupScore(next,driverIdOf(lineup.main)).score;
    const secondScore=aiDriverLineupScore(next,driverIdOf(lineup.second)).score;
    const weakSlot=mainScore<=secondScore?"main":"second";
    const weakContract=lineup[weakSlot];
    const weakScore=Math.min(mainScore,secondScore);

    // A five-point gap is deliberately meaningful: close ratings do not cause
    // weekly hierarchy churn, but an obvious star cannot remain a reserve.
    if(candidateScore>=weakScore+5){
      next=changeDriverContractRole(next,{
        driverId:candidateId,
        targetRole:roleLabel(weakSlot),
        teamId:tid,
        swapIfOccupied:true,
      });
      next=appendLineupLog(next,{
        team_id:tid,
        driver_id:candidateId,
        displaced_driver_id:driverIdOf(weakContract),
        from_role:roleLabel(driverRoleSlot(candidate)),
        to_role:roleLabel(weakSlot),
        reason,
        candidate_score:round2(candidateScore),
        displaced_score:round2(weakScore),
      });
    }
  }

  // Once the best two drivers occupy race seats, only change Main/Second when
  // the difference is clear. Main/Second remains a hierarchy, not a +1 sort.
  lineup=driverLineupSlots(next,tid);
  if(lineup.main&&lineup.second){
    const mainId=driverIdOf(lineup.main);
    const secondId=driverIdOf(lineup.second);
    const mainScore=aiDriverLineupScore(next,mainId).score;
    const secondScore=aiDriverLineupScore(next,secondId).score;
    if(secondScore>=mainScore+4){
      next=swapRaceDriverRoles(next,{teamId:tid});
      next=appendLineupLog(next,{
        team_id:tid,
        driver_id:secondId,
        displaced_driver_id:mainId,
        from_role:"Second Driver",
        to_role:"Main Driver",
        reason:"clear_main_driver_advantage",
        candidate_score:round2(secondScore),
        displaced_score:round2(mainScore),
      });
    }
  }

  return next;
}

export function aiTeamLineupReview(gs,teamId){
  const tid=text(teamId);
  const contracts=activeDriverContracts(gs,{teamId:tid});
  return {
    team_id:tid,
    contracts:contracts.map((contract)=>({
      driver_id:driverIdOf(contract),
      role:roleLabel(driverRoleSlot(contract)),
      ...aiDriverLineupScore(gs,driverIdOf(contract)),
    })),
    ...teamRaceBenchmarks(gs,tid),
  };
}
