// src/domain/teamFinance.js
// Shared read-side budget resolution for player and AI teams.

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
