// src/domain/lowerSeriesHistoryView.js
// LS9E — presentation boundary for Lower Series history.
//
// Factual Global-DB history and simulated Save-World history are deliberately
// separate. Historical rows are visible only when they pre-date the career's
// opening season; Save-World rows are the only source for seasons played in the
// active career.

import { historicalLowerSeriesResultsBefore } from "./lowerSeriesHistoricalResults.js";

const rows=(value)=>Array.isArray(value)?value:[];
const text=(value)=>value==null?"":String(value).trim();
const num=(value,fallback=null)=>{
  if(value===null||value===undefined||value==="")return fallback;
  const n=Number(value);
  return Number.isFinite(n)?n:fallback;
};

function historicalViewRow(row){
  return {
    ...row,
    history_origin:"factual_pre_save",
    immutable:true,
  };
}

function saveResultRows(world){
  const live=rows(world?.results).map((row)=>({
    ...row,
    season_year:num(row?.season_year??world?.season_year,null),
    history_origin:"save_world",
    immutable:false,
  }));
  const archived=rows(world?.history).flatMap((season)=>
    rows(season?.results).map((row)=>({
      ...row,
      season_year:num(row?.season_year??season?.season_year,null),
      history_origin:"save_world",
      immutable:false,
    }))
  );
  return [...archived,...live];
}

export function lowerSeriesHistoryForCareer({
  historicalResults=[],
  lowerSeriesWorld=null,
  careerStartYear,
  driverId=null,
  seriesId=null,
}={}){
  const startYear=Number(careerStartYear);
  if(!Number.isInteger(startYear))return [];
  const did=text(driverId);
  const sid=text(seriesId);

  const factual=historicalLowerSeriesResultsBefore(historicalResults,startYear)
    .filter((row)=>!did||text(row?.driver_id)===did)
    .filter((row)=>!sid||text(row?.series_id)===sid)
    .map(historicalViewRow);

  const simulated=saveResultRows(lowerSeriesWorld)
    .filter((row)=>num(row?.season_year??row?.year,null)>=startYear)
    .filter((row)=>!sid||text(row?.series_id)===sid)
    .filter((row)=>{
      if(!did)return true;
      if(text(row?.driver_id)===did)return true;
      return rows(row?.classification).some((item)=>text(item?.driver_id)===did);
    });

  return [...factual,...simulated].sort((a,b)=>{
    const ay=num(a?.season_year??a?.year,0);
    const by=num(b?.season_year??b?.year,0);
    if(ay!==by)return ay-by;
    return num(a?.round,0)-num(b?.round,0);
  });
}

export function lowerSeriesHistorySummary(options={}){
  const history=lowerSeriesHistoryForCareer(options);
  return {
    rows:history.length,
    factual_pre_save:history.filter((row)=>row.history_origin==="factual_pre_save").length,
    save_world:history.filter((row)=>row.history_origin==="save_world").length,
  };
}
