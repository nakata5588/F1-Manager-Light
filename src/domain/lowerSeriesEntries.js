// src/domain/lowerSeriesEntries.js
//
// LS9A — factual Lower Series entry catalogue.
//
// Global DB rows describe historical entrant/driver facts. Only opening-season
// facts may seed a New Game. Once the Save World starts, these rows must never
// drive future line-ups or career movement.

import {
  isSeriesActiveInYear,
  seriesIdOf,
  seriesLevelOf,
  seriesNameOf,
  seriesRuleForYear,
} from "./seriesCatalog.js";

const rows=(value)=>Array.isArray(value)?value:[];
const text=(value)=>value==null?"":String(value).trim();
const num=(value,fallback=null)=>{
  if(value===null||value===undefined||value==="")return fallback;
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};

export function lowerSeriesEntryYear(row){
  return num(row?.year??row?.season_year??row?.season??row?.yr,null);
}

export function lowerSeriesEntryDriverId(row){
  return text(row?.driver_id??row?.person_id??row?.driverId)||null;
}

export function lowerSeriesEntrySeriesId(row){
  return text(row?.series_id??row?.seriesId)||null;
}

export function lowerSeriesEntryTeamId(row){
  return text(row?.lower_team_id??row?.team_id??row?.entrant_id)||null;
}

export function normalizeLowerSeriesEntry(row={}){
  const year=lowerSeriesEntryYear(row);
  const from=num(
    row?.round_from??row?.first_round??row?.start_round??row?.round_start,
    null
  );
  const to=num(
    row?.round_to??row?.last_round??row?.end_round??row?.round_end,
    null
  );

  return {
    ...row,
    lower_entry_id:text(row?.lower_entry_id??row?.entry_id??row?.id)||null,
    year:Number.isInteger(year)?year:null,
    series_id:lowerSeriesEntrySeriesId(row),
    lower_team_id:lowerSeriesEntryTeamId(row),
    team_name:text(row?.team_name??row?.entrant_name??row?.entrant)||null,
    driver_id:lowerSeriesEntryDriverId(row),
    driver_name:text(row?.driver_name??row?.display_name??row?.name)||null,
    car_no:text(row?.car_no??row?.car_number??row?.number)||null,
    round_from:Number.isFinite(from)?from:null,
    round_to:Number.isFinite(to)?to:null,
    source:text(row?.source)||null,
    source_url:text(row?.source_url??row?.url)||null,
    notes:text(row?.notes)||null,
  };
}

export function lowerSeriesEntriesForYear(entryRows,year,{
  seriesIds=null,
  driverIds=null,
}={}){
  const y=Number(year);
  if(!Number.isInteger(y))return [];
  const wantedSeries=seriesIds?new Set(rows(seriesIds).map(text).filter(Boolean)):null;
  const wantedDrivers=driverIds?new Set(rows(driverIds).map(text).filter(Boolean)):null;

  return rows(entryRows)
    .map(normalizeLowerSeriesEntry)
    .filter((row)=>row.year===y)
    .filter((row)=>!wantedSeries||wantedSeries.has(text(row.series_id)))
    .filter((row)=>!wantedDrivers||wantedDrivers.has(text(row.driver_id)))
    .sort((a,b)=>
      text(a.series_id).localeCompare(text(b.series_id))||
      (num(a.round_from,1)-num(b.round_from,1))||
      text(a.lower_team_id??a.team_name).localeCompare(text(b.lower_team_id??b.team_name))||
      text(a.driver_id??a.driver_name).localeCompare(text(b.driver_id??b.driver_name))||
      text(a.lower_entry_id).localeCompare(text(b.lower_entry_id))
    );
}

export function openingLowerSeriesEntriesForYear(entryRows,year){
  const selected=lowerSeriesEntriesForYear(entryRows,year);
  if(!selected.length)return [];

  // A New Game begins before Round 1. Never seed a mid-season historical
  // replacement into January. Missing round_from means "season/opening entry"
  // because many archive sources provide season-level affiliations only.
  const opening=selected.filter((row)=>
    row.round_from==null||Number(row.round_from)<=1
  );
  return opening;
}

function openingEntrySort(a,b){
  const aRound=num(a?.round_from,1);
  const bRound=num(b?.round_from,1);
  return aRound-bRound||
    Number(Boolean(b?.lower_team_id))-Number(Boolean(a?.lower_team_id))||
    Number(Boolean(b?.team_name))-Number(Boolean(a?.team_name))||
    text(a?.lower_entry_id).localeCompare(text(b?.lower_entry_id));
}

export function openingLowerSeriesEntryForDriver(entryRows,{
  year,
  driverId,
  seriesId=null,
}={}){
  const id=text(driverId);
  if(!id)return null;
  let candidates=openingLowerSeriesEntriesForYear(entryRows,year)
    .filter((row)=>text(row.driver_id)===id);
  if(!candidates.length)return null;

  const wantedSeries=text(seriesId);
  if(wantedSeries){
    const exact=candidates.filter((row)=>text(row.series_id)===wantedSeries);
    if(exact.length)candidates=exact;
  }
  return candidates.slice().sort(openingEntrySort)[0]||null;
}

function seriesRecordForEntry(seriesRows,entry,year){
  const id=text(entry?.series_id);
  if(!id)return null;
  const found=rows(seriesRows).find((row)=>
    seriesIdOf(row)===id&&isSeriesActiveInYear(row,year)
  );
  return found||null;
}

function placementFromHistoricalEntry(base,entry,seriesRows,seriesRules,year){
  const series=seriesRecordForEntry(seriesRows,entry,year);
  const id=text(entry?.driver_id);
  const seriesId=text(entry?.series_id);
  const level=series?seriesLevelOf(series):num(entry?.series_level,null);
  const seriesName=series
    ?seriesNameOf(series)
    :text(entry?.series_name??entry?.series)||null;
  const rule=seriesId?seriesRuleForYear(seriesRules,seriesId,year):null;

  return {
    ...(base||{}),
    driver_id:id,
    display_name:text(base?.display_name??entry?.driver_name)||id,
    year:Number(year),
    stage:"D7.W2",
    authority:"analysis_only",
    model:"historical_lower_series_entry_v1",
    placement:base?.placement==="YOUTH"?"YOUTH":"LOWER_SERIES",
    active_pre_f1_world:true,
    scoutable:true,
    can_hire_academy:base?.placement==="YOUTH",
    can_hire_f1:Boolean(base?.can_hire_f1),
    market_policy:base?.placement==="YOUTH"
      ?(base?.market_policy||"ACADEMY_ONLY")
      :(base?.market_policy||"APPROACHABLE_LOWER_SERIES"),
    scouting_profile:base?.scouting_profile||"STANDARD_OR_DEEP",
    uncertainty:"LOW",
    series_id:seriesId||null,
    series_name:seriesName,
    series_level:Number.isFinite(level)?level:null,
    series_rule_id:text(rule?.series_rule_id??rule?.rule_id??rule?.id)||null,
    series_resolution:"historical_lower_series_entry",
    series_candidates:[],
    opening_series_seed:true,
    forced_future_series:false,
    factual_lower_series_entry_id:text(entry?.lower_entry_id)||null,
  };
}

export function applyLowerSeriesEntriesToPlacements(placements,entryRows,{
  year,
  series=[],
  seriesRules=[],
}={}){
  const y=Number(year);
  if(!Number.isInteger(y))return rows(placements).map((row)=>({...row}));

  const openingEntries=openingLowerSeriesEntriesForYear(entryRows,y)
    .filter((row)=>row.driver_id&&row.series_id);
  const entryByDriver=new Map();
  for(const entry of openingEntries){
    const id=text(entry.driver_id);
    const previous=entryByDriver.get(id);
    if(!previous||openingEntrySort(entry,previous)<0)entryByDriver.set(id,entry);
  }

  const output=new Map();
  for(const placement of rows(placements)){
    const id=text(placement?.driver_id);
    if(!id)continue;
    const factual=entryByDriver.get(id);
    output.set(
      id,
      factual
        ?placementFromHistoricalEntry(placement,factual,series,seriesRules,y)
        :{...placement}
    );
  }

  // A factual entry proves that the driver existed in that junior world even
  // when older heuristic World Entry data is sparse.
  for(const [id,entry] of entryByDriver){
    if(output.has(id))continue;
    output.set(id,placementFromHistoricalEntry(null,entry,series,seriesRules,y));
  }

  return [...output.values()].sort((a,b)=>text(a?.driver_id).localeCompare(text(b?.driver_id)));
}

export function lowerSeriesEntryCoverage(entryRows,year){
  const selected=lowerSeriesEntriesForYear(entryRows,year);
  const series=new Set();
  const teams=new Set();
  let unresolvedDrivers=0;
  let unresolvedSeries=0;
  let unresolvedTeams=0;

  for(const row of selected){
    if(row.series_id)series.add(row.series_id); else unresolvedSeries++;
    if(row.lower_team_id)teams.add(row.lower_team_id);
    else if(!row.team_name)unresolvedTeams++;
    if(!row.driver_id)unresolvedDrivers++;
  }

  return {
    year:Number(year),
    entries:selected.length,
    series:series.size,
    teams:teams.size,
    unresolved_drivers:unresolvedDrivers,
    unresolved_series:unresolvedSeries,
    unresolved_teams:unresolvedTeams,
  };
}
