// src/domain/lowerSeriesOpportunities.js
//
// LS6 — bridge between Lower Series prospect visibility and the canonical
// F1 driver market. This module does not sign contracts. It only translates
// public Save-World evidence into a bounded recruitment opportunity signal
// that the existing AI market can use when filling F1 roles.

import { lowerSeriesF1Interest, lowerSeriesProspect } from "./lowerSeriesProspects.js";

export const LOWER_SERIES_OPPORTUNITY_MODEL="lower_series_f1_opportunity_v1";

const rows=(value)=>Array.isArray(value)?value:[];
const text=(value)=>value==null?"":String(value).trim();
const num=(value,fallback=null)=>{
  if(value===null||value===undefined||value==="")return fallback;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
const round1=(value)=>Math.round(Number(value||0)*10)/10;
const driverIdOf=(row)=>text(row?.driver_id??row?.person_id??row?.id);

function roleSlot(role){
  const key=text(role).toLowerCase().replace(/[\s-]+/g,"_");
  if(/reserve/.test(key))return "reserve";
  if(/test|tester/.test(key))return "test";
  if(/second|driver_?2/.test(key))return "second";
  return "main";
}

function roleLabel(slot){
  if(slot==="main")return "Main Driver";
  if(slot==="second")return "Second Driver";
  if(slot==="reserve")return "Reserve Driver";
  return "Test Driver";
}

const ROLE_THRESHOLD=Object.freeze({
  main:76,
  second:68,
  reserve:50,
  test:44,
});

const ROLE_SCORE_DELTA=Object.freeze({
  main:-6,
  second:-2,
  reserve:6,
  test:8,
});

const STATUS_SCORE_DELTA=Object.freeze({
  academy_priority:14,
  priority:8,
  interested:3,
  monitoring:0,
  none:-8,
});

const SERIES_LEVEL_DELTA=Object.freeze({
  2:6,
  3:3,
  4:0,
  5:-3,
});

function championshipBonus(world,prospect){
  const seriesId=text(prospect?.series_id);
  const standing=world?.standings?.[seriesId]||null;
  if(!standing?.complete)return 0;
  return text(standing?.champion_driver_id)===text(prospect?.driver_id)?7:0;
}

function callUpStage(slot,recommended){
  if(!recommended)return "watchlist";
  if(slot==="main"||slot==="second")return "race_seat_candidate";
  if(slot==="reserve")return "reserve_candidate";
  return "test_candidate";
}

export function lowerSeriesF1Opportunity(gameState,driverOrId,teamId,role){
  const world=gameState?.lowerSeriesWorld;
  if(!world||typeof world!=="object")return null;

  const driverId=typeof driverOrId==="object"
    ?driverIdOf(driverOrId)
    :text(driverOrId);
  const tid=text(teamId);
  if(!driverId||!tid)return null;

  const prospect=lowerSeriesProspect(world,driverId);
  if(!prospect)return null;

  const interest=lowerSeriesF1Interest(world,driverId,tid);
  if(!interest)return null;

  const slot=roleSlot(role);
  const reputation=clamp(num(prospect?.prospect_reputation,0),0,100);
  const performanceScore=clamp(num(prospect?.performance?.score,0),0,100);
  const interestScore=clamp(num(interest?.score,0),0,100);
  const level=clamp(num(prospect?.series_level,5),2,5);
  const status=text(interest?.status)||"none";
  const academy=status==="academy_priority";
  const linked=rows(interest?.connection_sources).length>0;

  const score=round1(clamp(
    reputation*0.38+
    interestScore*0.42+
    performanceScore*0.20+
    (SERIES_LEVEL_DELTA[level]??0)+
    (STATUS_SCORE_DELTA[status]??0)+
    (ROLE_SCORE_DELTA[slot]??0)+
    championshipBonus(world,prospect),
    0,
    100
  ));
  const threshold=ROLE_THRESHOLD[slot]??68;
  const margin=round1(score-threshold);
  const recommended=score>=threshold;

  // The signal is intentionally bounded. Lower Series exposure can make a
  // prospect much more likely to be considered, but current ability, role fit,
  // salary and the driver's own decision still remain authoritative elsewhere.
  const recruitmentBonus=recommended
    ?round1(clamp(4+margin*0.28,4,18))
    :round1(clamp((margin+12)*0.12,0,2));

  return {
    model:LOWER_SERIES_OPPORTUNITY_MODEL,
    driver_id:driverId,
    f1_team_id:tid,
    requested_role:roleLabel(slot),
    requested_slot:slot,
    opportunity_score:score,
    threshold,
    margin,
    recommended,
    stage:callUpStage(slot,recommended),
    recruitment_bonus:recruitmentBonus,
    prospect_reputation:round1(reputation),
    performance_score:round1(performanceScore),
    series_id:text(prospect?.series_id)||null,
    series_level:level,
    interest_status:status,
    interest_score:round1(interestScore),
    academy_priority:academy,
    linked_path:linked,
    relationship_type:text(interest?.relationship_type)||null,
    source:"lower_series_public_results_and_f1_interest",
  };
}

export function lowerSeriesOpportunityCandidates(gameState,teamId,role,{
  includeWatchlist=false,
}={}){
  const entries=Object.values(gameState?.lowerSeriesWorld?.prospects||{});
  return entries
    .map((prospect)=>lowerSeriesF1Opportunity(
      gameState,
      prospect?.driver_id,
      teamId,
      role
    ))
    .filter(Boolean)
    .filter((row)=>includeWatchlist||row.recommended)
    .sort((a,b)=>
      Number(b.opportunity_score)-Number(a.opportunity_score)||
      String(a.driver_id).localeCompare(String(b.driver_id))
    );
}
