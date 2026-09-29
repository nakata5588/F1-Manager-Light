// src/domain/managerJobMarket.js
// Pure Manager job-market evaluation.
// The market compares the player's career standing with team reputation and
// the incumbent AI Team Principal. It does not change Save World state.

import { activeStaffContracts, contractEndYear } from "./liveContracts.js";
import { activeChampionshipTeamIds, resolveStaffId, staffContractRole } from "./staffRoles.js";
import { staffRatingForYear, staffReputation, staffRoleRating } from "./staffPerformance.js";
import { teamReputation } from "./teamReputation.js";

const text=(value)=>String(value??"");
const clamp=(value,min=0,max=100)=>Math.max(min,Math.min(max,Number(value)||0));
const num=(value,fallback=0)=>{
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const teamIdOf=(row)=>text(row?.team_id??row?.id??row?.constructor_id);
const teamNameOf=(row)=>text(row?.team_name??row?.name??row?.short_name??teamIdOf(row));

function teamRows(gs){
  const live=Array.isArray(gs?.teams)?gs.teams:[];
  return live.length?live:(Array.isArray(gs?.dbTeams)?gs.dbTeams:[]);
}
function activeTeamRows(gs){
  const ids=activeChampionshipTeamIds(gs);
  const rows=teamRows(gs);
  if(!ids.size)return rows.filter((row)=>teamIdOf(row));
  const byId=new Map(rows.map((row)=>[teamIdOf(row),row]).filter(([id])=>id));
  return [...ids].sort().map((id)=>byId.get(id)||{team_id:id,team_name:id});
}
function managerAttributeAverage(manager){
  const attrs=manager?.attributes||{};
  const weights={
    leadership:25,
    personnel:15,
    negotiation:15,
    technical:12,
    commercial:10,
    race_management:23,
  };
  const total=Object.values(weights).reduce((sum,value)=>sum+value,0);
  return Object.entries(weights).reduce((sum,[key,weight])=>
    sum+clamp(attrs?.[key]??50)*weight,0
  )/total;
}
export function managerMarketScore(gs){
  const manager=gs?.manager;
  if(!manager)return 0;
  const ability=managerAttributeAverage(manager);
  const reputation=clamp(manager?.reputation??35);
  return Number((ability*0.72+reputation*0.28).toFixed(1));
}
export function teamPrincipalIncumbent(gs,teamId){
  const contract=activeStaffContracts(gs,{teamId:text(teamId)})
    .find((row)=>staffContractRole(row)==="team_principal")||null;
  if(!contract)return null;
  const staffId=resolveStaffId(gs,contract);
  const rating=staffRatingForYear(gs,staffId);
  const roleScore=staffRoleRating(rating,"team_principal").score??50;
  const reputation=staffReputation(rating);
  return {
    contract,
    staff_id:staffId,
    staff_name:contract?.staff_name??contract?.name??staffId,
    role_score:Number(roleScore),
    reputation:Number(reputation),
    market_score:Number((Number(roleScore)*0.88+Number(reputation)*0.12).toFixed(1)),
    contract_end_year:contractEndYear(contract,Number(gs?.activeYear)),
  };
}
function recentlyLeftTeam(gs,teamId){
  const former=text(gs?.managerEmploymentState?.former_team_id);
  if(!former||former!==text(teamId))return false;
  const left=text(gs?.managerEmploymentState?.unemployed_since||gs?.managerEmploymentState?.dismissed_at);
  const today=text(gs?.currentDateISO).slice(0,10);
  if(!left||!today)return true;
  const a=Date.parse(left+"T00:00:00Z");
  const b=Date.parse(today+"T00:00:00Z");
  if(!Number.isFinite(a)||!Number.isFinite(b))return true;
  return (b-a)/86_400_000<90;
}

export function managerJobOpportunity(gs,teamId){
  const id=text(teamId);
  const team=activeTeamRows(gs).find((row)=>teamIdOf(row)===id)||teamRows(gs).find((row)=>teamIdOf(row)===id);
  if(!id||!team)return null;
  const manager=gs?.manager;
  if(!manager)return null;

  const managerScore=managerMarketScore(gs);
  const managerRep=clamp(manager?.reputation??35);
  const teamRep=clamp(teamReputation(gs,id));
  const incumbent=teamPrincipalIncumbent(gs,id);
  const vacancy=!incumbent;
  const incumbentScore=incumbent?.market_score??45;
  const qualityDelta=managerScore-incumbentScore;
  const prestigeGap=teamRep-managerRep;
  const coolingOff=recentlyLeftTeam(gs,id);
  const incumbentExpiring=Boolean(
    incumbent&&Number(incumbent.contract_end_year)<=Number(gs?.activeYear)
  );

  let interest=48;
  interest+=(managerScore-50)*0.55;
  interest+=(managerRep-teamRep)*0.28;
  interest+=vacancy?18:Math.max(-14,Math.min(14,qualityDelta*0.75));
  if(incumbentExpiring)interest+=10;
  if(prestigeGap>25)interest-=8;
  if(coolingOff)interest-=35;
  interest=clamp(interest);

  const materialUpgrade=!vacancy&&qualityDelta>=4&&interest>=52;
  const expiringOpportunity=!vacancy&&incumbentExpiring&&qualityDelta>=-4&&interest>=52;
  const compatibleBoardReview=!vacancy
    &&qualityDelta>=-3
    &&interest>=62
    &&teamRep<=managerRep+12;
  const replaceIncumbent=materialUpgrade||expiringOpportunity||compatibleBoardReview;
  const available=!coolingOff
    &&interest>=45
    &&(vacancy||replaceIncumbent)
    &&prestigeGap<=32;

  let reason=vacancy?"Team Principal vacancy":"Board reviewing incumbent";
  if(coolingOff)reason="Cooling-off period after leaving team";
  else if(prestigeGap>32)reason="Team prestige currently beyond Manager standing";
  else if(!vacancy&&!replaceIncumbent)reason="Incumbent Team Principal remains preferred";
  else if(interest<45)reason="Board interest too low";

  return {
    team_id:id,
    team_name:teamNameOf(team),
    team_reputation:Number(teamRep.toFixed(1)),
    manager_score:managerScore,
    manager_reputation:Number(managerRep.toFixed(1)),
    incumbent,
    vacancy,
    replace_incumbent:replaceIncumbent,
    incumbent_expiring:incumbentExpiring,
    interest:Math.round(interest),
    available,
    reason,
  };
}
export function managerJobOpportunities(gs){
  return activeTeamRows(gs)
    .map((team)=>managerJobOpportunity(gs,teamIdOf(team)))
    .filter(Boolean)
    .sort((a,b)=>
      Number(b.available)-Number(a.available)
      ||b.interest-a.interest
      ||a.team_name.localeCompare(b.team_name)
    );
}
export function managerJobApplications(gs){
  return Array.isArray(gs?.managerJobApplications)?gs.managerJobApplications:[];
}
export function activeManagerJobApplications(gs){
  return managerJobApplications(gs).filter((row)=>
    ["submitted","offer"].includes(text(row?.status).toLowerCase())
  );
}
