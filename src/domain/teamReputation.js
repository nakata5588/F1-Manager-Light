// src/domain/teamReputation.js
// D6.2.1 — persistent public/paddock reputation for teams.
//
// Team Reputation is separate from Operational Morale:
// - Reputation = long-term external standing / attractiveness.
// - Operational Morale = internal technical-work state.
//
// Reputation never changes car pace directly.

import { teamChampionshipSummary } from "./championshipHistory.js";

const clamp=(value,min=0,max=100)=>Math.max(min,Math.min(max,Number(value)||0));
const round1=(value)=>Math.round(Number(value||0)*10)/10;
const rows=(value)=>Array.isArray(value)?value:[];

const unbox=(value)=>{
  if(value&&typeof value==="object"&&!Array.isArray(value)){
    if(value.result!==undefined&&value.result!==null&&value.result!=="")return unbox(value.result);
    if(value.value!==undefined&&value.value!==null&&value.value!=="")return unbox(value.value);
  }
  return value;
};
const text=(value)=>String(unbox(value)??"");
const num=(value,fb=null)=>{const n=Number(unbox(value));return Number.isFinite(n)?n:fb;};
const teamIdOf=(row)=>text(row?.team_id??row?.constructor_id??row?.team?.team_id??row?.team??row?.id);
const driverIdOf=(row)=>text(row?.driver_id??row?.driver?.driver_id??row?.driver?.id);

function sameId(a,b){return text(a)!==""&&text(a)===text(b);}

function currentTeamForDriver(gs,driverId){
  const contracts=[...rows(gs?.contracts),...rows(gs?.dbContracts)];
  const year=Number(gs?.activeYear);
  const active=contracts.find((row)=>{
    if(!sameId(driverIdOf(row),driverId))return false;
    const rowYear=num(row?.year??row?.season_year,year);
    const status=String(row?.status??"active").toLowerCase();
    return rowYear===year&&!["inactive","ended","cancelled","released","expired"].includes(status);
  });
  return active?teamIdOf(active):"";
}

function historicalBaseline(gs,teamId){
  const activeYear=Number(gs?.activeYear);
  const historySource=rows(gs?.driverHistory).length?rows(gs?.driverHistory):rows(gs?.dbDriverHistory);
  const history=historySource.filter((row)=>{
      const year=num(row?.year,NaN);
      const series=String(unbox(row?.series_division??row?.series)??"F1").toUpperCase();
      return teamIdOf(row)===String(teamId)&&series==="F1"&&Number.isFinite(year)&&(!Number.isFinite(activeYear)||year<activeYear);
    });
  const wins=history.reduce((sum,row)=>sum+num(row?.wins,0),0);
  const podiums=history.reduce((sum,row)=>sum+num(row?.podiums,0),0);
  const titles=teamChampionshipSummary(gs,teamId);

  // Neutral teams start around 45–50. Sustained historical success raises the
  // seed, and Constructors titles now come from the same standings-derived
  // championship history used by the Team/Standings UI.
  return round1(clamp(
    45+
    Math.min(20,wins*0.40)+
    Math.min(8,podiums*0.06)+
    Math.min(12,titles.driversTitles*2.5)+
    Math.min(15,titles.constructors*3),
    30,
    92
  ));
}

export function teamReputation(gs,teamId=null){
  const id=String(teamId??gs?.team?.team_id??gs?.team?.id??"");
  if(!id)return 50;
  const stored=num(gs?.teamReputationState?.[id]?.reputation,null);
  return stored==null?historicalBaseline(gs,id):clamp(stored);
}

export function teamReputationLabel(value){
  const rep=Number(value);
  if(!Number.isFinite(rep))return "Unknown";
  if(rep>=85)return "Iconic";
  if(rep>=72)return "Elite";
  if(rep>=60)return "Established";
  if(rep>=48)return "Recognised";
  if(rep>=36)return "Emerging";
  return "Low profile";
}

function expectedTeamRanks(raceRows){
  const grouped=new Map();
  for(const row of rows(raceRows)){
    const teamId=teamIdOf(row);
    const expected=num(row?.driver_performance?.expected_finish??row?.expected_finish,null);
    if(!teamId||expected==null)continue;
    if(!grouped.has(teamId))grouped.set(teamId,[]);
    grouped.get(teamId).push(expected);
  }
  return new Map(
    [...grouped.entries()]
      .map(([teamId,values])=>({
        teamId,
        expected:values.reduce((sum,value)=>sum+value,0)/values.length,
      }))
      .sort((a,b)=>a.expected-b.expected||a.teamId.localeCompare(b.teamId))
      .map((row,index)=>[row.teamId,index+1])
  );
}

function standingsPosition(gs,teamId){
  const row=rows(gs?.standings?.teams).find((item)=>sameId(teamIdOf(item),teamId));
  return row?num(row?.position,null):null;
}

function updateTeamState(gs,teamId,{
  delta=0,
  source="race",
  reason="Team reputation update",
  reasons=[],
  dateISO=null,
  meta=null,
  maxDelta=3,
}={}){
  const before=teamReputation(gs,teamId);
  const cap=Math.max(0.1,Number(maxDelta)||3);
  const bounded=round1(Math.max(-cap,Math.min(cap,Number(delta)||0)));
  const after=round1(clamp(before+bounded));
  const current={...(gs?.teamReputationState||{})};
  const log={...(gs?.teamReputationLog||{})};

  current[teamId]={
    ...(current[teamId]||{}),
    team_id:teamId,
    reputation:after,
    lastChange:bounded,
    lastEvent:reason,
    lastUpdated:String(dateISO??gs?.currentDateISO??"").slice(0,10)||null,
    reasons,
  };

  if(bounded!==0){
    log[teamId]=[
      ...(log[teamId]||[]),
      {
        dateISO:String(dateISO??gs?.currentDateISO??"").slice(0,10)||null,
        source,
        reason,
        before,
        after,
        delta:bounded,
        reasons,
        meta:meta&&typeof meta==="object"?{...meta}:null,
      },
    ].slice(-120);
  }

  return {...gs,teamReputationState:current,teamReputationLog:log};
}

export function applyRaceTeamReputation(gs,{gp=null,race=[]}={}){
  if(!gs)return gs;
  const grouped=new Map();
  for(const row of rows(race)){
    const teamId=teamIdOf(row);
    if(!teamId)continue;
    if(!grouped.has(teamId))grouped.set(teamId,[]);
    grouped.get(teamId).push(row);
  }
  const expectedRanks=expectedTeamRanks(race);
  const gpName=gp?.gp_name??gp?.name??"Grand Prix";
  let next=gs;

  for(const [teamId,teamRows] of grouped){
    let delta=0;
    const reasons=[];
    const finished=teamRows.filter((row)=>!row?.retired);
    const bestFinish=finished
      .map((row)=>num(row?.position??row?.pos,null))
      .filter(Number.isFinite)
      .sort((a,b)=>a-b)[0]??null;

    if(bestFinish===1){
      delta+=1.2;
      reasons.push({key:"win",delta:1.2,label:"Grand Prix win"});
    }else if(bestFinish!=null&&bestFinish<=3){
      delta+=0.5;
      reasons.push({key:"podium",delta:0.5,label:`Podium P${bestFinish}`});
    }

    const expectationDeltas=finished
      .map((row)=>num(row?.driver_performance?.expectation_delta,null))
      .filter(Number.isFinite);
    if(expectationDeltas.length){
      const avg=expectationDeltas.reduce((sum,value)=>sum+value,0)/expectationDeltas.length;
      if(avg>=2){
        const bump=Math.min(0.7,avg*0.16);
        delta+=bump;
        reasons.push({key:"gp_expectation",delta:round1(bump),label:`GP performance above expectation (+${avg.toFixed(1)} positions avg)`});
      }else if(avg<=-2){
        const hit=Math.max(-0.8,avg*0.18);
        delta+=hit;
        reasons.push({key:"gp_expectation",delta:round1(hit),label:`GP performance below expectation (${avg.toFixed(1)} positions avg)`});
      }
    }

    const expectedRank=expectedRanks.get(teamId);
    const actualRank=standingsPosition(next,teamId);
    if(Number.isFinite(expectedRank)&&Number.isFinite(actualRank)){
      const gap=expectedRank-actualRank;
      if(gap>=2){
        const bump=Math.min(0.5,gap*0.16);
        delta+=bump;
        reasons.push({key:"standings_expectation",delta:round1(bump),label:`Constructors P${actualRank}, above expected P${expectedRank}`});
      }else if(gap<=-2){
        const hit=Math.max(-0.6,gap*0.18);
        delta+=hit;
        reasons.push({key:"standings_expectation",delta:round1(hit),label:`Constructors P${actualRank}, below expected P${expectedRank}`});
      }
    }

    next=updateTeamState(next,teamId,{
      delta:Math.max(-2,Math.min(2,delta)),
      source:"race",
      reason:gpName,
      reasons,
      meta:{gp_name:gpName,expected_constructor_position:expectedRank??null,constructor_position:actualRank??null},
    });
  }

  return next;
}

function seasonExpectedRanks(gs,year){
  const teamValues=new Map();
  for(const event of rows(gs?.results).filter((row)=>Number(row?.year)===Number(year))){
    for(const row of rows(event?.classification)){
      const teamId=teamIdOf(row);
      const expected=num(row?.driver_performance?.expected_finish,null);
      if(!teamId||expected==null)continue;
      if(!teamValues.has(teamId))teamValues.set(teamId,[]);
      teamValues.get(teamId).push(expected);
    }
  }
  return new Map(
    [...teamValues.entries()]
      .map(([teamId,values])=>({
        teamId,
        expected:values.reduce((sum,value)=>sum+value,0)/values.length,
      }))
      .sort((a,b)=>a.expected-b.expected||a.teamId.localeCompare(b.teamId))
      .map((row,index)=>[row.teamId,index+1])
  );
}

export function applySeasonTeamReputation(gs,year=Number(gs?.activeYear)){
  if(!gs)return gs;
  const teamStandings=rows(gs?.standings?.teams);
  if(!teamStandings.length)return gs;

  const expectedRanks=seasonExpectedRanks(gs,year);
  let next=gs;
  const constructorChampion=teamStandings
    .slice()
    .sort((a,b)=>num(a?.position,999)-num(b?.position,999))[0];
  const constructorChampionId=teamIdOf(constructorChampion);

  const driverChampion=rows(gs?.standings?.drivers)
    .slice()
    .sort((a,b)=>num(a?.position,999)-num(b?.position,999))[0]||null;
  const driverChampionTeam=teamIdOf(driverChampion)||currentTeamForDriver(gs,driverIdOf(driverChampion));

  const teamIds=new Set([
    ...teamStandings.map(teamIdOf).filter(Boolean),
    ...expectedRanks.keys(),
  ]);

  for(const teamId of teamIds){
    let delta=0;
    const reasons=[];
    const finalPos=standingsPosition(gs,teamId);
    const expected=expectedRanks.get(teamId);

    if(teamId===constructorChampionId){
      delta+=5;
      reasons.push({key:"constructors_title",delta:5,label:`${year} Constructors Championship`});
    }
    if(teamId&&teamId===driverChampionTeam){
      delta+=3;
      reasons.push({key:"drivers_title",delta:3,label:`${year} Drivers Championship`});
    }

    if(Number.isFinite(finalPos)&&Number.isFinite(expected)){
      const gap=expected-finalPos;
      if(gap>=2){
        const bump=Math.min(2,gap*0.6);
        delta+=bump;
        reasons.push({key:"season_expectation",delta:round1(bump),label:`Finished Constructors P${finalPos}, above expected P${expected}`});
      }else if(gap<=-2){
        const hit=Math.max(-2.5,gap*0.7);
        delta+=hit;
        reasons.push({key:"season_expectation",delta:round1(hit),label:`Finished Constructors P${finalPos}, below expected P${expected}`});
      }
    }

    next=updateTeamState(next,teamId,{
      delta,
      source:"season_end",
      reason:`${year} season review`,
      reasons,
      dateISO:`${year}-12-31`,
      meta:{year,constructor_position:finalPos??null,expected_constructor_position:expected??null},
      maxDelta:8,
    });
  }
  return next;
}

export function teamReputationHistory(gs,teamId,{limit=12}={}){
  return rows(gs?.teamReputationLog?.[String(teamId)])
    .slice()
    .sort((a,b)=>String(b?.dateISO||"").localeCompare(String(a?.dateISO||"")))
    .slice(0,Math.max(1,Number(limit)||12));
}
