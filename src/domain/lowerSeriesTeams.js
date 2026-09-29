// src/domain/lowerSeriesTeams.js
//
// LS3.5A — factual Lower Series team catalogue adapter.
//
// The database owns only structural facts: identity, series membership and the
// validity window. Save World owns mutable performance values and line-ups.

const rows=(value)=>Array.isArray(value)?value:[];
const text=(value)=>value==null?"":String(value).trim();
const num=(value,fallback=null)=>{
  if(value===null||value===undefined||value==="")return fallback;
  const n=Number(value);
  return Number.isFinite(n)?n:fallback;
};

function norm(value){
  return text(value).toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9]+/g,"");
}

export function lowerSeriesTeamIdOf(row){
  return text(row?.lower_team_id??row?.team_id??row?.id);
}

export function lowerSeriesTeamSeriesId(row){
  return text(row?.series_id);
}

export function lowerSeriesTeamNameOf(row){
  return text(row?.team_name??row?.name??row?.entrant_name);
}

export function isLowerSeriesTeamActiveInYear(row,year){
  const y=Number(year);
  if(!Number.isInteger(y))return false;
  if(!lowerSeriesTeamIdOf(row)||!lowerSeriesTeamSeriesId(row))return false;

  const from=num(
    row?.valid_from??row?.year_from??row?.start_year??row?.from_year,
    -Infinity
  );
  const to=num(
    row?.valid_to??row?.year_to??row?.end_year??row?.to_year,
    Infinity
  );
  return y>=from&&y<=to;
}

export function activeLowerSeriesTeamsForYear(teamRows,year,{seriesIds=null}={}){
  const allowed=seriesIds
    ?new Set(rows(seriesIds).map(text).filter(Boolean))
    :null;

  return rows(teamRows)
    .filter((row)=>isLowerSeriesTeamActiveInYear(row,year))
    .filter((row)=>!allowed||allowed.has(lowerSeriesTeamSeriesId(row)))
    .map((row)=>({
      lower_team_id:lowerSeriesTeamIdOf(row),
      team_name:lowerSeriesTeamNameOf(row)||lowerSeriesTeamIdOf(row),
      series_id:lowerSeriesTeamSeriesId(row),
      valid_from:num(row?.valid_from??row?.year_from??row?.start_year??row?.from_year,null),
      valid_to:num(row?.valid_to??row?.year_to??row?.end_year??row?.to_year,null),
      source_team_id:text(row?.source_team_id??row?.entrant_id)||null,
    }))
    .sort((a,b)=>
      String(a.series_id).localeCompare(String(b.series_id))||
      String(a.lower_team_id).localeCompare(String(b.lower_team_id))
    );
}

export function lowerSeriesWorldTeamFromFact(fact,year,{previous=null}={}){
  const lowerTeamId=lowerSeriesTeamIdOf(fact);
  const seriesId=lowerSeriesTeamSeriesId(fact);
  if(!lowerTeamId||!seriesId)return null;

  return {
    lower_team_id:lowerTeamId,
    series_id:seriesId,
    team_name:lowerSeriesTeamNameOf(fact)||lowerTeamId,
    source_team_id:text(fact?.source_team_id??fact?.entrant_id)||null,
    valid_from:num(fact?.valid_from??fact?.year_from??fact?.start_year??fact?.from_year,null),
    valid_to:num(fact?.valid_to??fact?.year_to??fact?.end_year??fact?.to_year,null),
    season_year:Number(year),
    team_strength:num(previous?.team_strength,50),
    reliability:num(previous?.reliability,90),
    development_environment:num(previous?.development_environment,50),
    performance_profile_year:num(previous?.performance_profile_year,null),
    performance_profile_model:text(previous?.performance_profile_model)||null,
    calibration_status:previous?.calibration_status||"neutral_catalog_seed",
    source:previous?"save_world_continuity":"lower_series_team_catalog",
  };
}

export function matchLowerSeriesTeamFact(teamRows,{
  seriesId,
  lowerTeamId=null,
  sourceTeamId=null,
  teamName=null,
}={}){
  const sid=text(seriesId);
  if(!sid)return null;
  const id=text(lowerTeamId);
  const sourceId=text(sourceTeamId);
  const nameKey=norm(teamName);

  return rows(teamRows).find((row)=>{
    if(lowerSeriesTeamSeriesId(row)!==sid)return false;
    if(id&&lowerSeriesTeamIdOf(row)===id)return true;
    const rowSource=text(row?.source_team_id??row?.entrant_id);
    if(sourceId&&rowSource&&rowSource===sourceId)return true;
    return Boolean(nameKey)&&norm(lowerSeriesTeamNameOf(row))===nameKey;
  })||null;
}
