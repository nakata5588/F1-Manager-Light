// src/domain/teamOrganizationHistory.js
// TEAMS 4.0A — canonical Results-first organisational history.
//
// This module is the single temporal resolver for historical Team/Entrant
// continuity. It deliberately distinguishes managerial organisation identity
// from technical Constructor identity and never reads evidence from the
// selected New Game season or from future seasons.

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

export const organizationYearOf=(row)=>num(row?.year??row?.season_year,null);
export const organizationTeamIdOf=(row)=>text(
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

function verifiedTransitions(lineageRows=[]){
  return rows(lineageRows)
    .map((row)=>({
      predecessor_team_id:text(row?.predecessor_team_id??row?.from_team_id),
      successor_team_id:text(row?.successor_team_id??row?.to_team_id??row?.team_id),
      effective_from_year:num(row?.effective_from_year??row?.year_from??row?.year,null),
      relationship:text(row?.relationship)||"organizational_continuity",
      confidence:String(row?.confidence??"").toUpperCase()||"VERIFIED",
      verified:Boolean(row?.verified??row?.explicit??false),
      source:text(row?.source)||"verified_lineage",
    }))
    .filter((row)=>
      row.predecessor_team_id&&
      row.successor_team_id&&
      Number.isInteger(row.effective_from_year)&&
      (row.verified||["HIGH","VERIFIED"].includes(row.confidence))
    );
}

function participationYearSet(teamId,teamSeasons=[],driverHistory=[]){
  const id=String(teamId||"");
  const years=new Set();
  for(const row of rows(teamSeasons)){
    if(organizationTeamIdOf(row)!==id)continue;
    const y=organizationYearOf(row);
    if(Number.isInteger(y))years.add(y);
  }
  for(const row of rows(driverHistory)){
    if(!f1HistoryRow(row)||organizationTeamIdOf(row)!==id)continue;
    const y=organizationYearOf(row);
    if(Number.isInteger(y))years.add(y);
  }
  return years;
}

function latestInboundTransition(teamId,upperExclusive,lineageRows=[]){
  const id=String(teamId||"");
  return verifiedTransitions(lineageRows)
    .filter((row)=>
      row.successor_team_id===id&&
      row.effective_from_year<=Number(upperExclusive)
    )
    .sort((a,b)=>b.effective_from_year-a.effective_from_year)[0]||null;
}

function contiguousDirectSegment(teamId,upperExclusive,teamSeasons=[],driverHistory=[]){
  const id=String(teamId||"");
  const end=Number(upperExclusive)-1;
  if(!id||!Number.isInteger(end))return null;
  const active=participationYearSet(id,teamSeasons,driverHistory);
  if(!active.has(end))return null;
  let start=end;
  while(active.has(start-1))start-=1;
  return {team_id:id,year_from:start,year_to:end,basis:"direct_contiguous_identity"};
}

export function historicalTeamLineageSegments({
  teamId,
  year,
  teamSeasons=[],
  driverHistory=[],
  lineageRows=[],
}={}){
  const target=String(teamId||"");
  const targetYear=Number(year);
  if(!target||!Number.isInteger(targetYear))return {segments:[],transitions:[]};

  const segments=[];
  const transitions=[];
  const visited=new Set();
  let currentId=target;
  let upperExclusive=targetYear;

  for(let depth=0;depth<24;depth+=1){
    const visitKey=`${currentId}|${upperExclusive}`;
    if(visited.has(visitKey))break;
    visited.add(visitKey);

    const inbound=latestInboundTransition(currentId,upperExclusive,lineageRows);
    if(inbound){
      const start=inbound.effective_from_year;
      const end=upperExclusive-1;
      if(start<=end){
        segments.push({
          team_id:currentId,
          year_from:start,
          year_to:end,
          basis:"verified_successor_segment",
        });
      }
      transitions.push(inbound);
      currentId=inbound.predecessor_team_id;
      upperExclusive=inbound.effective_from_year;
      continue;
    }

    const direct=contiguousDirectSegment(
      currentId,
      upperExclusive,
      teamSeasons,
      driverHistory
    );
    if(direct)segments.push(direct);
    break;
  }

  return {
    segments:segments
      .filter((segment)=>segment.year_from<=segment.year_to)
      .sort((a,b)=>a.year_from-b.year_from||a.team_id.localeCompare(b.team_id)),
    transitions:transitions.sort((a,b)=>a.effective_from_year-b.effective_from_year),
  };
}

export function organizationSegmentForTeamYear(segments,teamId,year){
  const id=String(teamId||"");
  const y=Number(year);
  return rows(segments).find((segment)=>
    segment.team_id===id&&
    y>=Number(segment.year_from)&&
    y<=Number(segment.year_to)
  )||null;
}

export function organizationRowInSegments(row,segments){
  const y=organizationYearOf(row);
  if(!Number.isInteger(y))return false;
  return Boolean(organizationSegmentForTeamYear(segments,organizationTeamIdOf(row),y));
}

export function organizationChampionshipRowBelongsToSegments(row,segments,teamSeasons=[]){
  const y=organizationYearOf(row);
  if(!Number.isInteger(y))return false;

  // Some canonical championship rows already use the managerial Team ID.
  const directId=text(row?.team_id??row?.entrant_id);
  if(directId&&organizationSegmentForTeamYear(segments,directId,y))return true;

  // Constructor identity is technical. Bridge it back only through an
  // organisation season that actually belongs to the temporal lineage.
  const technicalId=text(row?.constructor_id??row?.id);
  if(!technicalId)return false;
  if(organizationSegmentForTeamYear(segments,technicalId,y))return true;

  return rows(teamSeasons).some((season)=>{
    if(Number(organizationYearOf(season))!==y||!organizationRowInSegments(season,segments))return false;
    const managerialId=organizationTeamIdOf(season);
    if(technicalId===managerialId)return true;

    const exactIds=rows(season?.exact_constructor_ids).map(String);
    if(exactIds.length)return exactIds.includes(technicalId);

    // Older generated rows may not expose exact_constructor_ids. Only accept
    // the broader bridge when the season itself has exact entrant evidence.
    const hasExactEntrant=Number(season?.exact_entrant_rows??0)>0||season?.exact_entrant===true;
    if(!hasExactEntrant)return false;
    return rows(season?.constructor_ids).map(String).includes(technicalId);
  });
}

export function organizationDriverChampionshipRowBelongsToSegments(
  row,
  segments,
  teamSeasons=[],
  driverHistory=[]
){
  const y=organizationYearOf(row);
  const driverId=text(row?.driver_id??row?.person_id);
  if(!Number.isInteger(y))return false;

  // Drivers' titles belong to the managerial organisation the champion
  // actually represented in Results. A technical Constructor can be shared
  // across entrants, so it is not sufficient evidence on its own.
  if(driverId){
    const resultRows=rows(driverHistory).filter((historyRow)=>
      f1HistoryRow(historyRow)&&
      organizationYearOf(historyRow)===y&&
      text(historyRow?.driver_id??historyRow?.person_id)===driverId
    );
    if(resultRows.length){
      return resultRows.some((historyRow)=>organizationRowInSegments(historyRow,segments));
    }
  }

  // Sparse/legacy caches may lack driver-season Results. In that case keep the
  // conservative technical bridge as a fallback rather than fabricating data.
  return organizationChampionshipRowBelongsToSegments(row,segments,teamSeasons);
}

function participationYears(segments,teamSeasons=[],driverHistory=[]){
  const years=new Set();
  for(const row of rows(teamSeasons)){
    if(organizationRowInSegments(row,segments))years.add(organizationYearOf(row));
  }
  for(const row of rows(driverHistory)){
    if(f1HistoryRow(row)&&organizationRowInSegments(row,segments))years.add(organizationYearOf(row));
  }
  return [...years].filter(Number.isInteger).sort((a,b)=>a-b);
}

function recentCompetitiveness(segments,historicalChampionships,teamSeasons,year,{window=5}={}){
  const target=Number(year);
  const start=Math.max(1958,target-Math.max(1,Number(window)||5));
  const all=rows(historicalChampionships?.constructors);
  const samples=[];

  for(let y=target-1;y>=start;y-=1){
    const field=all.filter((row)=>Number(organizationYearOf(row))===y);
    if(!field.length)continue;
    const own=field
      .filter((row)=>organizationChampionshipRowBelongsToSegments(row,segments,teamSeasons))
      .sort((a,b)=>num(a?.position,999)-num(b?.position,999))[0]||null;
    if(!own)continue;
    const position=num(own?.position,null);
    if(!Number.isFinite(position)||position<1)continue;
    const fieldSize=field.length;
    const raw=fieldSize<=1?(position===1?100:50):clamp(100*(fieldSize-position)/(fieldSize-1));
    const yearsAgo=(target-1)-y;
    const weight=Math.pow(0.72,yearsAgo);
    samples.push({year:y,position,field_size:fieldSize,score:round1(raw),weight});
  }

  if(!samples.length)return {score:null,samples:[]};
  const total=samples.reduce((sum,row)=>sum+row.weight,0);
  const weighted=samples.reduce((sum,row)=>sum+row.score*row.weight,0)/Math.max(0.0001,total);
  return {score:round1(20+0.8*weighted),samples:samples.map((row)=>({...row,weight:round1(row.weight)}))};
}

export function teamOrganizationHistory({
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
  const historyRows=rows(driverHistory).filter((row)=>
    f1HistoryRow(row)&&organizationRowInSegments(row,lineage.segments)
  );
  const constructorTitleRows=rows(historicalChampionships?.constructors)
    .filter((row)=>
      Number(organizationYearOf(row))>=1958&&
      Number(num(row?.position,999))===1&&
      organizationChampionshipRowBelongsToSegments(row,lineage.segments,teamSeasons)
    )
    .sort((a,b)=>organizationYearOf(a)-organizationYearOf(b));
  const driverTitleRows=rows(historicalChampionships?.drivers)
    .filter((row)=>
      Number(num(row?.position,999))===1&&
      organizationDriverChampionshipRowBelongsToSegments(
        row,
        lineage.segments,
        teamSeasons,
        driverHistory
      )
    )
    .sort((a,b)=>organizationYearOf(a)-organizationYearOf(b));
  const recent=recentCompetitiveness(
    lineage.segments,
    historicalChampionships,
    teamSeasons,
    target
  );

  const inheritedIds=[...new Set(
    lineage.segments.map((segment)=>segment.team_id).filter((value)=>value!==id)
  )].sort();

  return {
    year:target,
    team_id:id,
    evidence_through_year:target-1,
    source:"results_first_organization_history_v1",
    lineage_basis:lineage.transitions.length?"explicit_verified_temporal_lineage":"direct_contiguous_identity",
    inherited_team_ids:inheritedIds,
    lineage_segments:lineage.segments,
    lineage_evidence:lineage.transitions,
    first_historical_season:seasons[0]??null,
    latest_historical_season:seasons.at(-1)??null,
    seasons_before_start:seasons.length,
    historical_starts:historyRows.reduce((sum,row)=>sum+Math.max(0,num(row?.starts??row?.races,0)),0),
    historical_wins:historyRows.reduce((sum,row)=>sum+Math.max(0,num(row?.wins,0)),0),
    historical_podiums:historyRows.reduce((sum,row)=>sum+Math.max(0,num(row?.podiums,0)),0),
    historical_points:round1(historyRows.reduce((sum,row)=>sum+Math.max(0,num(row?.points,0)),0)),
    constructors_titles:constructorTitleRows.length,
    drivers_titles:driverTitleRows.length,
    last_constructor_title_year:constructorTitleRows.length?organizationYearOf(constructorTitleRows.at(-1)):null,
    last_driver_title_year:driverTitleRows.length?organizationYearOf(driverTitleRows.at(-1)):null,
    constructor_title_rows:constructorTitleRows,
    driver_title_rows:driverTitleRows,
    recent_competitiveness:recent.score,
    recent_seasons:recent.samples,
  };
}

function populatedArray(primary,fallback){
  return rows(primary).length?rows(primary):rows(fallback);
}

export function teamOrganizationHistoryFromState(gs,teamId,yearInput=null){
  const explicit=yearInput==null?null:Number(yearInput);
  const sourceSeason=Number(gs?.careerMeta?.sourceSeason);
  const activeYear=Number(gs?.activeYear??gs?.seasonPackMeta?.year);
  const year=Number.isInteger(explicit)
    ?explicit
    :(Number.isInteger(sourceSeason)?sourceSeason:activeYear);
  if(!Number.isInteger(year))return null;

  const historicalChampionships=(
    gs?.dbHistoricalChampionships&&
    (rows(gs.dbHistoricalChampionships?.drivers).length||rows(gs.dbHistoricalChampionships?.constructors).length)
  )
    ?gs.dbHistoricalChampionships
    :(gs?.historicalChampionships||{drivers:[],constructors:[]});

  return teamOrganizationHistory({
    teamId,
    year,
    teamSeasons:populatedArray(gs?.dbTeamSeasons,gs?.teamSeasons),
    driverHistory:populatedArray(gs?.dbDriverHistory,gs?.driverHistory),
    historicalChampionships,
    lineageRows:populatedArray(gs?.dbTeamLineageHistory,gs?.teamLineageHistory),
  });
}
