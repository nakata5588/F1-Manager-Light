// src/domain/teamMorale.js
// Lightweight operational morale shared by race outcomes and technical work.
//
// 50 = neutral. High morale improves workshop/development throughput; low morale
// slows new work. The effect is intentionally bounded so facilities and staff
// remain the main determinants of project duration.

import { currentDriverTeamId } from "./driverContracts.js";
import { retirementResponsibility } from "./driverForm.js";
import { managerGameplayEffects } from "./managerProfile.js";

const clamp=(v,min=0,max=100)=>Math.max(min,Math.min(max,Number(v)||0));
const round1=(v)=>Math.round(Number(v||0)*10)/10;
const text=(v)=>String(v??"");

function teamIdForRaceRow(gs,row){
  const direct=text(row?.team_id??row?.team?.team_id??row?.driver?.team_id);
  if(direct)return direct;
  const driverId=text(row?.driver_id??row?.driver?.driver_id??row?.driver?.id);
  return driverId?text(currentDriverTeamId(gs,driverId)):"";
}

export function teamOperationalMorale(gs,teamId=null){
  const id=text(teamId??gs?.team?.team_id??gs?.team?.id);
  const row=gs?.teamOperationalState?.[id];
  const morale=Number(row?.morale);
  return Number.isFinite(morale)?clamp(morale):50;
}

export function teamWorkRateMultiplier(gs,teamId=null){
  const morale=teamOperationalMorale(gs,teamId);
  // Morale 100 => ~12% faster. Morale 0 => ~15% slower.
  const delta=morale-50;
  const factor=delta>=0
    ?1-Math.min(0.12,delta*0.0024)
    :1+Math.min(0.15,Math.abs(delta)*0.0030);
  return Number(factor.toFixed(3));
}

export function teamWorkRateLabel(gs,teamId=null){
  const morale=teamOperationalMorale(gs,teamId);
  const factor=teamWorkRateMultiplier(gs,teamId);
  const pct=Math.round((1-factor)*100);
  return {
    morale:round1(morale),
    factor,
    label:pct===0?"Neutral":pct>0?`${pct}% faster`:`${Math.abs(pct)}% slower`,
  };
}

export function applyRaceTeamMorale(gs,{race=[],gp=null}={}){
  if(!gs)return gs;
  const current={...(gs?.teamOperationalState||{})};
  const log={...(gs?.teamMoraleLog||{})};
  const grouped=new Map();

  for(const row of Array.isArray(race)?race:[]){
    const teamId=teamIdForRaceRow(gs,row);
    if(!teamId)continue;
    if(!grouped.has(teamId))grouped.set(teamId,[]);
    grouped.get(teamId).push(row);
  }

  const dateISO=text(gs?.currentDateISO).slice(0,10)||null;
  const gpName=gp?.gp_name||gp?.name||"Grand Prix";

  for(const [teamId,rows] of grouped){
    let delta=0;
    const reasons=[];
    let dnfs=0;

    for(const row of rows){
      const finish=Number(row?.pos??row?.position);
      const points=Number(row?.points);
      const expected=Number(row?.driver_performance?.expected_finish??row?.expected_finish);
      if(row?.retired){
        dnfs++;
        const responsibility=retirementResponsibility(row?.retirement_reason);
        // A DNF hurts the TEAM operationally. Driver-error/racing incidents
        // still hurt the TEAM, but the larger personal morale penalty belongs
        // to the driver mental-state system rather than being duplicated here.
        const hit=responsibility.key==="driver_error"||responsibility.key==="racing_incident"?-2:-3;
        delta+=hit;
        reasons.push({
          key:"dnf",
          delta:hit,
          label:`DNF · ${responsibility.label||row?.retirement_reason||"Retirement"}`,
        });
      }else{
        if(finish===1){
          delta+=4;
          reasons.push({key:"win",delta:4,label:"Race win"});
        }else if(Number.isFinite(finish)&&finish<=3){
          delta+=2;
          reasons.push({key:"podium",delta:2,label:`Podium P${finish}`});
        }else if(Number.isFinite(points)&&points>0){
          delta+=1;
          reasons.push({key:"points",delta:1,label:`Points finish P${finish}`});
        }

        if(Number.isFinite(expected)&&Number.isFinite(finish)){
          const beatBy=expected-finish;
          if(beatBy>=4){
            delta+=1.5;
            reasons.push({key:"above_expectation",delta:1.5,label:`Result well above expectation (~P${expected.toFixed(1)})`});
          }else if(beatBy>=2){
            delta+=0.75;
            reasons.push({key:"above_expectation",delta:0.75,label:`Result above expectation (~P${expected.toFixed(1)})`});
          }
        }
      }
    }

    if(dnfs>=2){
      delta-=2;
      reasons.push({key:"double_dnf",delta:-2,label:"Double retirement"});
    }

    delta=Math.max(-10,Math.min(7,delta));
    const managerEffects=managerGameplayEffects(gs,{teamId});
    if(delta>0)delta*=managerEffects.positiveMoraleMultiplier;
    else if(delta<0)delta*=managerEffects.negativeMoraleMultiplier;
    delta=Math.max(-10,Math.min(7,delta));
    const before=teamOperationalMorale(gs,teamId);
    const after=round1(clamp(before+delta));
    current[teamId]={
      ...(current[teamId]||{}),
      team_id:teamId,
      morale:after,
      lastChange:round1(delta),
      lastEvent:gpName,
      lastUpdated:dateISO,
      reasons,
    };
    log[teamId]=[
      ...(log[teamId]||[]),
      {dateISO,gp_name:gpName,before,after,delta:round1(delta),reasons},
    ].slice(-120);
  }

  return {...gs,teamOperationalState:current,teamMoraleLog:log};
}
