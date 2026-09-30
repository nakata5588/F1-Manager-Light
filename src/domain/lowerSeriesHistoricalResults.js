// src/domain/lowerSeriesHistoricalResults.js
//
// LS9B — factual historical Lower Series race-result catalogue.
//
// These rows are immutable Global DB evidence. They may describe the past of a
// New Game start, but must never be copied into lowerSeriesWorld.results or used
// to force future Save-World line-ups/results.

const rows=(value)=>Array.isArray(value)?value:[];
const text=(value)=>value==null?"":String(value).trim();
const num=(value,fallback=null)=>{
  if(value===null||value===undefined||value==="")return fallback;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};

export function lowerSeriesHistoricalResultYear(row){
  return num(row?.year??row?.season_year??row?.season??row?.yr,null);
}

export function lowerSeriesHistoricalResultDriverId(row){
  return text(row?.driver_id??row?.person_id??row?.driverId)||null;
}

export function lowerSeriesHistoricalResultSeriesId(row){
  return text(row?.series_id??row?.seriesId)||null;
}

export function lowerSeriesHistoricalResultTeamId(row){
  return text(row?.lower_team_id??row?.team_id??row?.entrant_id)||null;
}

export function normalizeLowerSeriesHistoricalResult(row={}){
  const year=lowerSeriesHistoricalResultYear(row);
  return {
    ...row,
    lower_result_id:text(row?.lower_result_id??row?.result_id??row?.id)||null,
    year:Number.isInteger(year)?year:null,
    series_id:lowerSeriesHistoricalResultSeriesId(row),
    round:num(row?.round??row?.round_no??row?.race_round,null),
    event_id:text(row?.event_id??row?.race_id)||null,
    event_name:text(row?.event_name??row?.race_name??row?.name)||null,
    race_date:text(row?.race_date??row?.date)||null,
    track_id:text(row?.track_id??row?.circuit_id)||null,
    driver_id:lowerSeriesHistoricalResultDriverId(row),
    driver_name:text(row?.driver_name??row?.display_name??row?.driver)||null,
    lower_team_id:lowerSeriesHistoricalResultTeamId(row),
    team_name:text(row?.team_name??row?.entrant_name??row?.entrant)||null,
    car_no:text(row?.car_no??row?.car_number??row?.number)||null,
    grid:num(row?.grid??row?.grid_position??row?.start_position,null),
    position:num(row?.position??row?.finish_position??row?.pos,null),
    status:text(row?.status??row?.result_status)||null,
    laps:num(row?.laps,null),
    points:num(row?.points,null),
    pole:Boolean(row?.pole===true||row?.pole===1||String(row?.pole||"").toLowerCase()==="true"),
    fastest_lap:Boolean(row?.fastest_lap===true||row?.fastest_lap===1||String(row?.fastest_lap||"").toLowerCase()==="true"),
    source:text(row?.source??row?.source_name)||null,
    source_url:text(row?.source_url??row?.url)||null,
    notes:text(row?.notes)||null,
  };
}

export function lowerSeriesHistoricalResultsForYear(resultRows,year,{seriesIds=null,driverIds=null}={}){
  const y=Number(year);
  if(!Number.isInteger(y))return [];
  const wantedSeries=seriesIds?new Set(rows(seriesIds).map(text).filter(Boolean)):null;
  const wantedDrivers=driverIds?new Set(rows(driverIds).map(text).filter(Boolean)):null;
  return rows(resultRows)
    .map(normalizeLowerSeriesHistoricalResult)
    .filter((row)=>row.year===y)
    .filter((row)=>!wantedSeries||wantedSeries.has(text(row.series_id)))
    .filter((row)=>!wantedDrivers||wantedDrivers.has(text(row.driver_id)))
    .sort((a,b)=>
      text(a.series_id).localeCompare(text(b.series_id))||
      (num(a.round,999)-num(b.round,999))||
      (num(a.position,999)-num(b.position,999))||
      text(a.driver_id??a.driver_name).localeCompare(text(b.driver_id??b.driver_name))||
      text(a.lower_result_id).localeCompare(text(b.lower_result_id))
    );
}

// Temporal firewall: only seasons strictly before the selected New Game year
// are historical career evidence. Same-year/future archive rows stay in Global
// DB and cannot seed the active Save World.
export function lowerSeriesHistoricalResultsBeforeYear(resultRows,startYear,{driverIds=null,seriesIds=null}={}){
  const y=Number(startYear);
  if(!Number.isInteger(y))return [];
  const wantedSeries=seriesIds?new Set(rows(seriesIds).map(text).filter(Boolean)):null;
  const wantedDrivers=driverIds?new Set(rows(driverIds).map(text).filter(Boolean)):null;
  return rows(resultRows)
    .map(normalizeLowerSeriesHistoricalResult)
    .filter((row)=>Number.isInteger(row.year)&&row.year<y)
    .filter((row)=>!wantedSeries||wantedSeries.has(text(row.series_id)))
    .filter((row)=>!wantedDrivers||wantedDrivers.has(text(row.driver_id)))
    .sort((a,b)=>
      a.year-b.year||text(a.series_id).localeCompare(text(b.series_id))||
      (num(a.round,999)-num(b.round,999))||
      (num(a.position,999)-num(b.position,999))||
      text(a.driver_id??a.driver_name).localeCompare(text(b.driver_id??b.driver_name))
    );
}

export function lowerSeriesHistoricalResultCoverage(resultRows){
  const selected=rows(resultRows).map(normalizeLowerSeriesHistoricalResult);
  const years=new Set();
  const series=new Set();
  const drivers=new Set();
  const teams=new Set();
  let unresolvedDrivers=0;
  let unresolvedSeries=0;
  let unresolvedSources=0;
  for(const row of selected){
    if(Number.isInteger(row.year))years.add(row.year);
    if(row.series_id)series.add(row.series_id); else unresolvedSeries++;
    if(row.driver_id)drivers.add(row.driver_id); else unresolvedDrivers++;
    if(row.lower_team_id)teams.add(row.lower_team_id);
    if(!row.source_url&&!row.source)unresolvedSources++;
  }
  return {
    results:selected.length,
    years:years.size,
    series:series.size,
    drivers:drivers.size,
    teams:teams.size,
    unresolved_drivers:unresolvedDrivers,
    unresolved_series:unresolvedSeries,
    unresolved_sources:unresolvedSources,
  };
}
