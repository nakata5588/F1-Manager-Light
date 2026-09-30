// src/domain/lowerSeriesHistoricalReputation.js
//
// LS9C — opening Prospect Reputation from factual pre-start junior results.
// This module consumes Global DB history only through the LS9B temporal firewall.
// It never reads hidden Potential Ability and never imports historical results
// into the mutable Save World.

import { lowerSeriesHistoricalResultsBeforeYear } from "./lowerSeriesHistoricalResults.js";

const rows=(value)=>Array.isArray(value)?value:[];
const text=(value)=>value==null?"":String(value).trim();
const num=(value,fallback=null)=>{
  if(value===null||value===undefined||value==="")return fallback;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
const round1=(value)=>Math.round(Number(value||0)*10)/10;

function sourceRows(gameState){
  if(rows(gameState?.lowerSeriesHistoricalResults).length)return rows(gameState.lowerSeriesHistoricalResults);
  if(rows(gameState?.dbLowerSeriesHistoricalResults).length)return rows(gameState.dbLowerSeriesHistoricalResults);
  if(rows(gameState?.lowerSeriesResultsHistory).length)return rows(gameState.lowerSeriesResultsHistory);
  return rows(gameState?.dbLowerSeriesResultsHistory);
}

function resultFinished(row){
  const status=text(row?.status).toLowerCase();
  if(["dnf","dns","dsq","dq","ret","retired","withdrawn","wd"].includes(status))return false;
  return Number.isFinite(num(row?.position,null));
}

function seasonSummary(resultRows){
  const starts=resultRows.length;
  const finishes=resultRows.filter(resultFinished);
  const positions=finishes.map((row)=>num(row?.position,null)).filter(Number.isFinite);
  const wins=finishes.filter((row)=>num(row?.position,null)===1).length;
  const podiums=finishes.filter((row)=>num(row?.position,null)<=3).length;
  const points=resultRows.reduce((sum,row)=>sum+Math.max(0,num(row?.points,0)),0);
  const poles=resultRows.filter((row)=>row?.pole===true).length;
  const bestFinish=positions.length?Math.min(...positions):null;
  return {starts,finishes:finishes.length,wins,podiums,points:round1(points),poles,best_finish:bestFinish};
}

function scoreSeason(summary){
  if(!summary?.starts)return 0;
  const starts=Math.max(1,summary.starts);
  const finishRate=summary.finishes/starts;
  const winRate=summary.wins/starts;
  const podiumRate=summary.podiums/starts;
  const poleRate=summary.poles/starts;
  const best=Number.isFinite(summary.best_finish)?clamp((12-summary.best_finish)/11,0,1):0;
  return clamp(
    18+finishRate*12+winRate*30+podiumRate*22+poleRate*8+best*10,
    0,100
  );
}

export function historicalProspectReputationEvidence(gameState,driverId,startYear){
  const id=text(driverId);
  const year=Number(startYear);
  if(!id||!Number.isInteger(year))return null;
  const history=lowerSeriesHistoricalResultsBeforeYear(sourceRows(gameState),year,{driverIds:[id]});
  if(!history.length)return null;

  const bySeason=new Map();
  for(const row of history){
    const key=`${row.year}:${text(row.series_id)||"unknown"}`;
    if(!bySeason.has(key))bySeason.set(key,[]);
    bySeason.get(key).push(row);
  }
  const seasons=[...bySeason.entries()].map(([key,resultRows])=>{
    const [seasonYear,seriesId]=key.split(":");
    const summary=seasonSummary(resultRows);
    return {
      year:Number(seasonYear),
      series_id:seriesId==="unknown"?null:seriesId,
      ...summary,
      score:round1(scoreSeason(summary)),
    };
  }).sort((a,b)=>a.year-b.year||text(a.series_id).localeCompare(text(b.series_id)));

  // Recent factual seasons matter more, but older evidence still contributes.
  let weighted=0;
  let weights=0;
  for(const season of seasons){
    const age=Math.max(1,year-season.year);
    const recency=1/Math.sqrt(age);
    const sample=clamp(season.starts/8,0.25,1);
    const weight=recency*sample;
    weighted+=season.score*weight;
    weights+=weight;
  }
  const score=weights>0?weighted/weights:0;
  // Keep historical reputation in a public-scouting range rather than turning
  // race results into a disguised ability rating.
  const reputation=clamp(18+score*0.62,18,82);
  return {
    prospect_reputation:round1(reputation),
    evidence_seasons:seasons,
    evidence_results:history.length,
    latest_evidence_year:Math.max(...seasons.map((row)=>row.year)),
    source:"factual_pre_start_lower_series_results",
    temporal_cutoff_year:year,
  };
}

export function openingProspectReputation(gameState,entry,startYear,fallback){
  const evidence=historicalProspectReputationEvidence(gameState,entry?.driver_id,startYear);
  if(evidence)return {...evidence,used_fallback:false};
  return {
    prospect_reputation:round1(clamp(num(fallback,0),0,100)),
    evidence_seasons:[],
    evidence_results:0,
    latest_evidence_year:null,
    source:"series_level_baseline",
    temporal_cutoff_year:Number(startYear),
    used_fallback:true,
  };
}
