// src/domain/championshipHistory.js
// Shared championship history derived from the same historical standings data
// used by the Standings screen.
//
// Historical database rows are valid only before the career source season.
// Once a save starts, archived Save World standings are authoritative.

const rows=(value)=>Array.isArray(value)?value:[];
const unbox=(value)=>{
  if(value&&typeof value==="object"&&!Array.isArray(value)){
    if(value.result!==undefined&&value.result!==null&&value.result!=="")return unbox(value.result);
    if(value.value!==undefined&&value.value!==null&&value.value!=="")return unbox(value.value);
  }
  return value;
};
const str=(value)=>String(unbox(value)??"");
const num=(value,fb=0)=>Number.isFinite(Number(unbox(value)))?Number(unbox(value)):fb;
const teamIdOf=(row)=>str(row?.team_id??row?.constructor_id??row?.id);
const driverIdOf=(row)=>str(row?.driver_id??row?.id);

function teamNameFor(teamsById,teamId,fallback="—"){
  const map=teamsById instanceof Map
    ?teamsById
    :new Map(rows(teamsById).map((team)=>[teamIdOf(team),team]));
  const team=map.get(String(teamId));
  return str(team?.team_name??team?.name??team?.short_name??fallback)||fallback;
}

export function aggregateHistoricalConstructors(history,year,teamsById=[]){
  const teamMap=new Map();
  for(const row of rows(history)){
    if(Number(unbox(row?.year))!==Number(year))continue;
    const series=String(unbox(row?.series_division??row?.series)??"F1").toUpperCase();
    if(series&&series!=="F1")continue;
    const teamId=teamIdOf(row);
    if(!teamId)continue;
    const rec=teamMap.get(teamId)||{
      id:teamId,
      name:str(row?.team_name)||teamNameFor(teamsById,teamId,teamId),
      points:0,
      wins:0,
      podiums:0,
      fastestLaps:0,
      poles:0,
      dnfs:0,
      races:0,
    };
    rec.points+=num(row?.points,0);
    rec.wins+=num(row?.wins,0);
    rec.podiums+=num(row?.podiums,0);
    rec.fastestLaps+=num(row?.fastest_laps,0);
    rec.poles+=num(row?.poles,0);
    rec.dnfs+=num(row?.dnf??row?.dnfs,0);
    rec.races=Math.max(rec.races,num(row?.races??row?.starts,0));
    teamMap.set(teamId,rec);
  }

  return [...teamMap.values()]
    .map((row)=>({
      ...row,
      pointsPerRace:row.races?Number((row.points/row.races).toFixed(2)):0,
    }))
    .sort((a,b)=>
      b.points-a.points||
      b.wins-a.wins||
      b.podiums-a.podiums||
      a.name.localeCompare(b.name)
    )
    .map((row,index)=>({...row,position:index+1}));
}

function careerSourceSeason(gs){
  const source=Number(gs?.careerMeta?.sourceSeason);
  if(Number.isFinite(source))return source;
  const active=Number(gs?.activeYear);
  return Number.isFinite(active)?active:Infinity;
}

function teamsById(gs){
  const map=new Map();
  for(const team of [...rows(gs?.dbTeams),...rows(gs?.teams)]){
    const id=teamIdOf(team);
    if(id)map.set(id,{...(map.get(id)||{}),...team});
  }
  return map;
}

function archivedConstructorChampion(gs,year){
  const archive=rows(gs?.historySeasons).find((row)=>Number(row?.year)===Number(year));
  if(!archive)return null;
  const sorted=rows(archive?.standings?.teams??archive?.standings?.constructors)
    .slice()
    .sort((a,b)=>
      num(a?.position,999)-num(b?.position,999)||
      num(b?.points,0)-num(a?.points,0)
    );
  const row=sorted[0];
  if(!row)return null;
  const id=teamIdOf(row);
  return id?{
    year:Number(year),
    team_id:id,
    team_name:str(row?.team_name??row?.name)||teamNameFor(teamsById(gs),id,id),
    source:"save_world",
  }:null;
}

export function constructorChampionForYear(gs,year){
  const y=Number(year);
  if(!Number.isFinite(y))return null;

  const archived=archivedConstructorChampion(gs,y);
  if(archived)return archived;

  // Never import the real historical future into an alternate-history save.
  if(y>=careerSourceSeason(gs))return null;

  const history=rows(gs?.dbDriverHistory).length?rows(gs?.dbDriverHistory):rows(gs?.driverHistory);
  const standings=aggregateHistoricalConstructors(history,y,teamsById(gs));
  const champion=standings[0];
  return champion?{
    year:y,
    team_id:champion.id,
    team_name:champion.name,
    points:champion.points,
    source:"historical_standings",
  }:null;
}

export function constructorChampionshipHistory(gs){
  const sourceSeason=careerSourceSeason(gs);
  const years=new Set();

  const history=rows(gs?.dbDriverHistory).length?rows(gs?.dbDriverHistory):rows(gs?.driverHistory);
  for(const row of history){
    const year=Number(unbox(row?.year));
    const series=String(unbox(row?.series_division??row?.series)??"F1").toUpperCase();
    if(Number.isFinite(year)&&year<sourceSeason&&(!series||series==="F1"))years.add(year);
  }
  for(const archive of rows(gs?.historySeasons)){
    const year=Number(archive?.year);
    if(Number.isFinite(year))years.add(year);
  }

  return [...years]
    .sort((a,b)=>a-b)
    .map((year)=>constructorChampionForYear(gs,year))
    .filter(Boolean);
}

function historicalDriverTitles(gs){
  const sourceSeason=careerSourceSeason(gs);
  return rows(gs?.dbAchievements)
    .filter((row)=>{
      const year=Number(unbox(row?.year));
      return Number.isFinite(year)&&year<sourceSeason&&Number(unbox(row?.driver_championship))===1;
    })
    .map((row)=>({
      year:Number(unbox(row?.year)),
      driver_id:driverIdOf(row),
      driver_name:str(row?.driver_name??row?.name),
      team_id:teamIdOf(row),
      team_name:str(row?.team_name??row?.team),
      source:"historical_achievements",
    }));
}

function archivedDriverTitles(gs){
  const teams=teamsById(gs);
  const output=[];
  for(const archive of rows(gs?.historySeasons)){
    const year=Number(archive?.year);
    if(!Number.isFinite(year))continue;
    const row=rows(archive?.standings?.drivers)
      .slice()
      .sort((a,b)=>
        num(a?.position,999)-num(b?.position,999)||
        num(b?.points,0)-num(a?.points,0)
      )[0];
    if(!row)continue;
    const teamId=teamIdOf(row);
    output.push({
      year,
      driver_id:driverIdOf(row),
      driver_name:str(row?.driver_name??row?.name),
      team_id:teamId,
      team_name:str(row?.team_name)||teamNameFor(teams,teamId,teamId||"—"),
      source:"save_world",
    });
  }
  return output;
}

export function driverChampionshipHistory(gs){
  const map=new Map();
  for(const row of [...historicalDriverTitles(gs),...archivedDriverTitles(gs)]){
    const key=String(row.year);
    // Save World archive comes second and therefore overrides any accidental
    // historical row for a played season.
    map.set(key,row);
  }
  return [...map.values()].sort((a,b)=>a.year-b.year);
}

export function teamChampionshipSummary(gs,teamId){
  const id=String(teamId??"");
  const constructorTitles=constructorChampionshipHistory(gs).filter((row)=>String(row.team_id)===id);
  const driverTitles=driverChampionshipHistory(gs).filter((row)=>String(row.team_id)===id);
  return {
    constructors:constructorTitles.length,
    driversTitles:driverTitles.length,
    constructorTitles,
    driverTitles,
  };
}
