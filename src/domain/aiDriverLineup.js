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
  swapRaceDriverRoles,
} from "./driverContracts.js";
import { driverRoleSlot } from "./contractRoles.js";
import { driverDecisionTraits } from "./driverDecisionModel.js";
import { driverFormSnapshot } from "./driverForm.js";
import { driverMarketEvaluation } from "./driverMarketEvaluation.js";

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
