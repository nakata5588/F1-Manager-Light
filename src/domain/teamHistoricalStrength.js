// src/domain/teamHistoricalStrength.js
// T3.2 — Historical Team Strength.
//
// Historical Starting Conditions -> Dynamic Alternative Future:
// - January strength uses evidence only from seasons BEFORE New Game.
// - Strength is separate from current Car Performance and mutable Reputation.
// - Organisational continuity is temporal, not a global Team alias.
// - Verified predecessor links may carry infrastructure/history through a
//   rename or acquisition; disconnected revivals of the same name/ID do not.

import {
  historicalTeamLineageSegments,
  organizationChampionshipRowBelongsToSegments,
  organizationRowInSegments,
  organizationSegmentForTeamYear,
} from "./teamOrganizationHistory.js";

export { historicalTeamLineageSegments } from "./teamOrganizationHistory.js";

const rows=(value)=>Array.isArray(value)?value:[];
const clamp=(value,min=0,max=100)=>Math.max(min,Math.min(max,Number(value)||0));
const round1=(value)=>Math.round(Number(value||0)*10)/10;

const unwrap=(value)=>{
  if(value&&typeof value==="object"&&!Array.isArray(value)){
    if(value.result!==undefined&&value.result!==null&&value.result!=="")return unwrap(value.result);
    if(value.value!==undefined&&value.value!==null&&value.value!=="")return unwrap(value.value);
    if(value.text!==undefined&&value.text!==null&&value.text!=="")return unwrap(value.text);
  }
  return value;
};
const text=(value)=>String(unwrap(value)??"").trim();
const num=(value,fallback=null)=>{
  const parsed=Number(unwrap(value));
  return Number.isFinite(parsed)?parsed:fallback;
};
const yearOf=(row)=>num(row?.year??row?.season_year,null);
const teamIdOf=(row)=>text(
  row?.team_id??
  row?.entrant_id??
  row?.managerial_team_id??
  row?.id??
  row?.constructor_id
);

function f1HistoryRow(row){
  const series=String(unwrap(row?.series_division??row?.series)??"F1").toUpperCase();
  return !series||series==="F1";
}

function participationYears(segments,teamSeasons=[],driverHistory=[]){
  const years=new Set();
  for(const row of rows(teamSeasons)){
    if(organizationRowInSegments(row,segments))years.add(yearOf(row));
  }
  for(const row of rows(driverHistory)){
    if(f1HistoryRow(row)&&organizationRowInSegments(row,segments))years.add(yearOf(row));
  }
  return [...years].sort((a,b)=>a-b);
}

function aggregateRaceAchievements(segments,driverHistory=[]){
  let wins=0;
  let podiums=0;
  let starts=0;
  for(const row of rows(driverHistory)){
    if(!f1HistoryRow(row)||!organizationRowInSegments(row,segments))continue;
    wins+=Math.max(0,num(row?.wins,0));
    podiums+=Math.max(0,num(row?.podiums,0));
    starts+=Math.max(0,num(row?.starts??row?.races,0));
  }
  return {wins,podiums,starts};
}

function titleEvidence(segments,historicalChampionships,teamSeasons){
  const constructors=rows(historicalChampionships?.constructors).filter((row)=>
    organizationChampionshipRowBelongsToSegments(row,segments,teamSeasons)&&
    Number(num(row?.position,999))===1
  );
  const drivers=rows(historicalChampionships?.drivers).filter((row)=>
    organizationChampionshipRowBelongsToSegments(row,segments,teamSeasons)&&
    Number(num(row?.position,999))===1
  );
  return {
    constructors:constructors.length,
    drivers:drivers.length,
    last_constructor_title_year:constructors.length?Math.max(...constructors.map(yearOf)):null,
    last_driver_title_year:drivers.length?Math.max(...drivers.map(yearOf)):null,
  };
}

function constructorRankScore(position,fieldSize){
  const pos=Number(position);
  const field=Number(fieldSize);
  if(!Number.isFinite(pos)||pos<1)return null;
  if(!Number.isFinite(field)||field<=1)return pos===1?100:50;
  return clamp(100*(field-pos)/(field-1));
}

function recentConstructorEvidence(
  segments,
  historicalChampionships,
  driverHistory,
  teamSeasons,
  year,
  {window=5}={}
){
  const target=Number(year);
  const start=Math.max(1950,target-Math.max(1,Number(window)||5));
  const constructorRows=rows(historicalChampionships?.constructors);
  const driverRows=rows(driverHistory);
  const samples=[];

  for(let y=target-1;y>=start;y-=1){
    const activeSegments=rows(segments).filter((segment)=>y>=segment.year_from&&y<=segment.year_to);
    if(!activeSegments.length)continue;

    const seasonConstructors=constructorRows.filter((row)=>Number(yearOf(row))===y);
    const own=seasonConstructors
      .filter((row)=>organizationChampionshipRowBelongsToSegments(row,activeSegments,teamSeasons))
      .sort((a,b)=>num(a?.position,999)-num(b?.position,999))[0]||null;

    let score=null;
    let position=null;
    let fieldSize=null;
    let source="";

    if(own){
      position=num(own?.position,null);
      fieldSize=seasonConstructors.length;
      score=constructorRankScore(position,fieldSize);
      source="constructors_championship";
    }else{
      // 1950-1957 and sparse constructor seasons: rank managerial Teams by
      // historical points. Still only the lineage segment active that year
      // may provide the current Team's score.
      const pointsByTeam=new Map();
      for(const row of driverRows){
        if(Number(yearOf(row))!==y||!f1HistoryRow(row))continue;
        const id=teamIdOf(row);
        if(!id)continue;
        pointsByTeam.set(id,(pointsByTeam.get(id)||0)+Math.max(0,num(row?.points,0)));
      }
      const ranked=[...pointsByTeam.entries()]
        .map(([id,points])=>({id,points}))
        .sort((a,b)=>b.points-a.points||a.id.localeCompare(b.id));
      const index=ranked.findIndex((row)=>Boolean(organizationSegmentForTeamYear(activeSegments,row.id,y)));
      if(index>=0){
        position=index+1;
        fieldSize=ranked.length;
        score=constructorRankScore(position,fieldSize);
        source="team_points_fallback";
      }
    }

    if(Number.isFinite(score)){
      const yearsAgo=(target-1)-y;
      const weight=Math.pow(0.72,yearsAgo);
      samples.push({
        year:y,
        position,
        field_size:fieldSize,
        score:round1(score),
        weight:round1(weight),
        source,
      });
    }
  }

  if(!samples.length)return {score:null,samples:[]};
  const weightTotal=samples.reduce((sum,row)=>sum+row.weight,0);
  const weighted=samples.reduce((sum,row)=>sum+row.score*row.weight,0)/Math.max(0.0001,weightTotal);
  return {score:round1(20+0.8*weighted),samples};
}

function heritageScore(seasons){
  const count=Math.max(0,Number(seasons)||0);
  if(!count)return 25;
  return round1(clamp(25+75*(1-Math.exp(-count/10))));
}

function sportingScore({wins=0,podiums=0,constructorTitles=0,driverTitles=0}={}){
  const titleSignal=Math.min(45,Math.max(0,constructorTitles)*15+Math.max(0,driverTitles)*10);
  const winSignal=Math.min(20,Math.log2(1+Math.max(0,wins))*4.5);
  const podiumSignal=Math.min(10,Math.log2(1+Math.max(0,podiums))*2);
  return round1(clamp(25+titleSignal+winSignal+podiumSignal));
}

export function teamHistoricalStrength({
  teamId,
  year,
  teamSeasons=[],
  driverHistory=[],
  historicalChampionships={drivers:[],constructors:[]},
  lineageRows=[],
}={}){
  const id=String(teamId||"");
  const target=Number(year);
  if(!id||!Number.isInteger(target))return null;

  const lineage=historicalTeamLineageSegments({
    teamId:id,
    year:target,
    teamSeasons,
    driverHistory,
    lineageRows,
  });
  const seasons=participationYears(lineage.segments,teamSeasons,driverHistory);
  const achievements=aggregateRaceAchievements(lineage.segments,driverHistory);
  const titles=titleEvidence(lineage.segments,historicalChampionships,teamSeasons);
  const recent=recentConstructorEvidence(
    lineage.segments,
    historicalChampionships,
    driverHistory,
    teamSeasons,
    target
  );

  const heritage=heritageScore(seasons.length);
  const sporting=sportingScore({
    wins:achievements.wins,
    podiums:achievements.podiums,
    constructorTitles:titles.constructors,
    driverTitles:titles.drivers,
  });
  const recentCompetitiveness=Number.isFinite(recent.score)
    ?recent.score
    :(seasons.length?35:25);

  // Structural strength deliberately excludes current/recent car pace.
  const structural=round1(clamp(heritage*0.55+sporting*0.45));
  const competitive=round1(clamp(sporting*0.45+recentCompetitiveness*0.55));
  const overall=round1(clamp(
    heritage*0.35+
    sporting*0.35+
    recentCompetitiveness*0.30
  ));

  const inheritedIds=[...new Set(
    lineage.segments.map((segment)=>segment.team_id).filter((value)=>value!==id)
  )].sort();

  return {
    year:target,
    team_id:id,
    evidence_through_year:target-1,
    source:"historical_preseason_strength_v2",
    lineage_basis:lineage.transitions.length?"explicit_verified_temporal_lineage":"direct_contiguous_identity",
    inherited_team_ids:inheritedIds,
    lineage_segments:lineage.segments,
    lineage_evidence:lineage.transitions,
    first_historical_season:seasons[0]??null,
    latest_historical_season:seasons.at(-1)??null,
    seasons_before_start:seasons.length,
    historical_starts:achievements.starts,
    historical_wins:achievements.wins,
    historical_podiums:achievements.podiums,
    constructors_titles:titles.constructors,
    drivers_titles:titles.drivers,
    last_constructor_title_year:titles.last_constructor_title_year,
    last_driver_title_year:titles.last_driver_title_year,
    recent_seasons:recent.samples,
    heritage_strength:heritage,
    sporting_strength:sporting,
    recent_competitiveness:recentCompetitiveness,
    structural_strength:structural,
    competitive_strength:competitive,
    overall,
  };
}

export function materializeHistoricalTeamStrengths({
  teamIds=[],
  year,
  teamSeasons=[],
  driverHistory=[],
  historicalChampionships={drivers:[],constructors:[]},
  lineageRows=[],
}={}){
  return [...new Set(rows(teamIds).map((value)=>String(value||"")).filter(Boolean))]
    .map((teamId)=>teamHistoricalStrength({
      teamId,
      year,
      teamSeasons,
      driverHistory,
      historicalChampionships,
      lineageRows,
    }))
    .filter(Boolean)
    .sort((a,b)=>b.overall-a.overall||a.team_id.localeCompare(b.team_id));
}


export function teamHistoricalStrengthLabel(value){
  if(value===null||value===undefined||value==="")return "Unknown";
  const score=Number(value);
  if(!Number.isFinite(score))return "Unknown";
  if(score>=90)return "Elite";
  if(score>=75)return "Strong";
  if(score>=60)return "Established";
  if(score>=45)return "Developing";
  return "Emerging";
}
