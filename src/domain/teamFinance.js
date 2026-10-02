// src/domain/teamFinance.js
// Canonical finance gateway plus shared budget resolution for player and AI teams.

import { collectionRows } from "./liveContracts.js";

const text=(value)=>String(value??"");
const num=(value,fallback=NaN)=>{
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const teamIdOf=(row)=>text(row?.team_id??row?.id??row?.constructor_id);

export function teamBudgetAvailable(gs,teamId){
  const id=text(teamId);
  const playerTeamId=text(gs?.team?.team_id??gs?.team?.id);
  if(id&&id===playerTeamId){
    const player=num(gs?.finances?.balance??gs?.team?.budget,NaN);
    if(Number.isFinite(player))return player;
  }
  const ai=num(gs?.aiTechnicalWorld?.teams?.[id]?.budget,NaN);
  if(Number.isFinite(ai))return ai;
  const rows=collectionRows(gs?.teams).length?collectionRows(gs?.teams):collectionRows(gs?.dbTeams);
  const team=rows.find((row)=>teamIdOf(row)===id);
  const direct=num(team?.budget??team?.cash??team?.balance,NaN);
  return Number.isFinite(direct)?direct:NaN;
}

export function applyFinanceTransaction(gs,{
  teamId,
  amount,
  category="Team Finance",
  subtype=null,
  desc="Budget adjustment",
  description=null,
  sig=null,
  source=null,
  sourceId=null,
  dateISO=null,
  id=null,
}={}){
  if(!gs)return gs;
  const tid=text(teamId);
  const delta=Number(amount)||0;
  if(!tid||delta===0)return gs;

  const playerTeamId=text(gs?.team?.team_id??gs?.team?.id);
  if(tid!==playerTeamId)return gs;

  const log=Array.isArray(gs?.financeLog)?gs.financeLog:[];
  const txSig=sig?text(sig):null;
  if(txSig&&log.some((row)=>row?.sig===txSig))return gs;

  const oldBalance=teamBudgetAvailable(gs,tid);
  const balance=Number.isFinite(oldBalance)?oldBalance:0;
  const nextBalance=balance+delta;
  const date=text(dateISO??gs?.currentDateISO).slice(0,10);
  const seasonIncome=num(gs?.finances?.season_income,0)+(delta>0?delta:0);
  const seasonSpend=num(gs?.finances?.season_spend,0)+(delta<0?Math.abs(delta):0);
  const txId=text(id)||(txSig?`tx_${txSig}`:`tx_${tid}_${date}_${log.length+1}`);
  const tx={
    id:txId,
    sig:txSig,
    teamId:tid,
    season:num(gs?.activeYear,NaN),
    dateISO:date,
    type:delta>=0?"income":"expense",
    category,
    subtype,
    desc:description??desc,
    amount:delta,
    source,
    sourceId,
  };

  return {
    ...gs,
    team:{...(gs?.team||{}),budget:nextBalance},
    finances:{
      ...(gs?.finances||{}),
      balance:nextBalance,
      budget:nextBalance,
      season_spend:seasonSpend,
      season_income:seasonIncome,
      season_net:seasonIncome-seasonSpend,
    },
    financeLog:[tx,...log],
  };
}

export function applyTeamBudgetDelta(gs,teamId,amount,{
  category="Team Finance",
  desc="Budget adjustment",
  sig=null,
}={}){
  if(!gs)return gs;
  const tid=text(teamId);
  const delta=Number(amount)||0;
  if(!tid||delta===0)return gs;
  const playerTeamId=text(gs?.team?.team_id??gs?.team?.id);
  if(tid===playerTeamId){
    return applyFinanceTransaction(gs,{
      teamId:tid,
      amount:delta,
      category,
      desc,
      sig,
    });
  }

  let next=gs;
  const aiTeams=gs?.aiTechnicalWorld?.teams;
  if(aiTeams&&typeof aiTeams==="object"&&aiTeams[tid]){
    const current=Number(aiTeams[tid]?.budget);
    if(Number.isFinite(current)){
      next={
        ...next,
        aiTechnicalWorld:{
          ...(next?.aiTechnicalWorld||{}),
          teams:{
            ...aiTeams,
            [tid]:{...aiTeams[tid],budget:current+delta},
          },
        },
      };
    }
  }
  if(Array.isArray(next?.teams)){
    next={
      ...next,
      teams:next.teams.map((team)=>{
        const id=teamIdOf(team);
        if(id!==tid)return team;
        const current=Number(team?.budget??team?.cash??team?.balance);
        if(!Number.isFinite(current))return team;
        if("budget" in team)return {...team,budget:current+delta};
        if("cash" in team)return {...team,cash:current+delta};
        return {...team,balance:current+delta};
      }),
    };
  }
  return next;
}
