// src/domain/lowerSeriesHistoricalValidation.js
// LS9D — validation/audit boundary for factual Lower Series history.
// Validation reports gaps; it never fabricates identities, teams or results.

import {normalizeLowerSeriesHistoricalResult} from "./lowerSeriesHistoricalResults.js";

const rows=(value)=>Array.isArray(value)?value:[];
const text=(value)=>value==null?"":String(value).trim();

function key(row,index){
  return text(row.lower_result_id)||`${row.year??"?"}:${row.series_id??"?"}:${row.event_id??row.round??"?"}:${row.driver_id??row.driver_name??index}`;
}

export function validateLowerSeriesHistoricalResults(resultRows,{seriesIds=null,driverIds=null,teamIds=null,seriesById=null}={}){
  const knownSeries=seriesIds?new Set(rows(seriesIds).map(text).filter(Boolean)):null;
  const knownDrivers=driverIds?new Set(rows(driverIds).map(text).filter(Boolean)):null;
  const knownTeams=teamIds?new Set(rows(teamIds).map(text).filter(Boolean)):null;
  const seriesMap=seriesById&&typeof seriesById==="object"?seriesById:{};
  const issues=[];
  const seenIds=new Set();
  const normalized=rows(resultRows).map(normalizeLowerSeriesHistoricalResult);

  normalized.forEach((row,index)=>{
    const resultKey=key(row,index);
    const issue=(code,severity="error",detail=null)=>issues.push({code,severity,result_key:resultKey,detail});
    if(!Number.isInteger(row.year))issue("missing_year");
    if(!row.series_id)issue("missing_series_id");
    else if(knownSeries&&!knownSeries.has(row.series_id))issue("unknown_series_id");
    if(!row.driver_id){
      issue("unresolved_driver_identity","warning",row.driver_name||null);
    }else if(knownDrivers&&!knownDrivers.has(row.driver_id))issue("unknown_driver_id");
    if(!row.source_url&&!row.source)issue("missing_source","warning");
    if(row.lower_result_id){
      if(seenIds.has(row.lower_result_id))issue("duplicate_result_id");
      seenIds.add(row.lower_result_id);
    }
    if(row.lower_team_id&&knownTeams&&!knownTeams.has(row.lower_team_id))issue("unknown_lower_team_id");

    const series=row.series_id?seriesMap[row.series_id]:null;
    const model=text(series?.competition_model).toUpperCase();
    if(model==="CENTRAL_OPERATION"&&row.lower_team_id){
      issue("central_operation_has_team","error",row.lower_team_id);
    }
  });

  const byCode={};
  for(const issue of issues)byCode[issue.code]=(byCode[issue.code]||0)+1;
  return {
    valid:!issues.some((issue)=>issue.severity==="error"),
    results:normalized.length,
    errors:issues.filter((issue)=>issue.severity==="error").length,
    warnings:issues.filter((issue)=>issue.severity==="warning").length,
    by_code:byCode,
    issues,
  };
}

export function lowerSeriesHistoricalVerticalSlice(resultRows,{year,seriesId}={}){
  const y=Number(year);
  const sid=text(seriesId);
  const selected=rows(resultRows).map(normalizeLowerSeriesHistoricalResult)
    .filter((row)=>row.year===y&&row.series_id===sid);
  const events=new Set(selected.map((row)=>row.event_id||row.round).filter((value)=>value!==null&&value!==undefined&&value!==""));
  const drivers=new Set(selected.map((row)=>row.driver_id).filter(Boolean));
  const unresolved=selected.filter((row)=>!row.driver_id).length;
  const sourced=selected.filter((row)=>row.source_url||row.source).length;
  return {
    year:y,
    series_id:sid||null,
    results:selected.length,
    events:events.size,
    resolved_drivers:drivers.size,
    unresolved_driver_rows:unresolved,
    sourced_rows:sourced,
    source_coverage:selected.length?sourced/selected.length:0,
  };
}
