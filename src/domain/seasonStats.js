// src/domain/seasonStats.js
// Career results are historical. Standings and current-season form must always
// derive their counting stats from the requested season only.

const str=(value)=>value==null?"":String(value);

export function resultEventYear(event){
  const direct=Number(event?.year??event?.season_year??event?.season);
  if(Number.isFinite(direct))return direct;

  for(const value of [event?.dateISO,event?.date,event?.race_date,event?.key,event?.gp_id]){
    const match=String(value||"").match(/^(\d{4})/);
    if(match)return Number(match[1]);
  }
  return NaN;
}

export function resultsForSeason(results,year){
  const target=Number(year);
  if(!Number.isFinite(target))return [];
  return (Array.isArray(results)?results:[]).filter((event)=>resultEventYear(event)===target);
}

export function buildSeasonResultStats(results,year,resolveTeam=()=>""){
  const drivers=new Map();
  const teams=new Map();

  for(const event of resultsForSeason(results,year)){
    const eventKey=event?.key||event?.gp_id||`${year}:${event?.round??"?"}`;
    for(const row of event?.classification||[]){
      const did=str(row?.driver_id);
      const tid=str(row?.team_id||row?.constructor_id||resolveTeam(did,event));
      const pos=Number(row?.position);

      if(did){
        const stats=drivers.get(did)||{races:0,wins:0,podiums:0,fastestLaps:0};
        stats.races+=1;
        if(!row?.retired&&pos===1)stats.wins+=1;
        if(!row?.retired&&pos>=1&&pos<=3)stats.podiums+=1;
        if(row?.fastest_lap||row?.fastestLap)stats.fastestLaps+=1;
        drivers.set(did,stats);
      }

      if(tid){
        const stats=teams.get(tid)||{races:new Set(),wins:0,podiums:0};
        stats.races.add(eventKey);
        if(!row?.retired&&pos===1)stats.wins+=1;
        if(!row?.retired&&pos>=1&&pos<=3)stats.podiums+=1;
        teams.set(tid,stats);
      }
    }
  }

  return {drivers,teams};
}
