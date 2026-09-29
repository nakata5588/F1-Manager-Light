// src/engine/StakeholderMarketEngine.js
// Monthly/quarterly Save-World decisions for Owners and Sponsor Backers.
// Ownership/backing is intentionally separate from Staff employment contracts.

import { rngFor } from "../core/random.js";
import { collectionRows, staffIdOf } from "../domain/liveContracts.js";
import { staffRatingForYear, staffReputation, staffRoleRating } from "../domain/staffPerformance.js";
import { staffCoreFor } from "../domain/staffMarket.js";
import { applyTeamBudgetDelta, teamBudgetAvailable } from "../domain/teamFinance.js";
import { teamReputation } from "../domain/teamReputation.js";
import {
  addTeamStakeholder,
  currentStakeholderTeamForStaff,
  currentTeamBacker,
  currentTeamOwner,
  stakeholderRoleExperience,
} from "../domain/teamStakeholders.js";

const text=(value)=>String(value??"");
const num=(value,fallback=0)=>{
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:fallback;
};
const dateOnly=(value)=>text(value).slice(0,10);
const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
const teamIdOf=(row)=>text(row?.team_id??row?.id??row?.constructor_id);
const teamName=(row)=>text(row?.team_name??row?.name??row?.short_name??teamIdOf(row));

function teamRows(gs){
  const live=collectionRows(gs?.teams);
  return live.length?live:collectionRows(gs?.dbTeams);
}
function staffRows(gs){
  const map=new Map();
  for(const row of [
    ...collectionRows(gs?.dbStaffCore),
    ...collectionRows(gs?.staffCore),
  ]){
    const id=staffIdOf(row);
    if(id)map.set(id,row);
  }
  return [...map.values()];
}
function alive(row,dateISO){
  const death=dateOnly(row?.death_date);
  return !death||!dateISO||death>dateISO;
}
function reputation(gs,teamId){
  try{
    const value=Number(teamReputation(gs,teamId));
    return Number.isFinite(value)?value:50;
  }catch{return 50;}
}
function stakeholderCandidateScore(gs,staffId,role){
  const rating=staffRatingForYear(gs,staffId);
  const roleScore=staffRoleRating(rating,role).score??50;
  const rep=staffReputation(rating);
  return roleScore*0.72+rep*0.28;
}
export function stakeholderCapitalEstimate(gs,staffId,role){
  const rating=staffRatingForYear(gs,staffId);
  const score=staffRoleRating(rating,role).score??50;
  const rep=staffReputation(rating);
  return Math.round((400_000+score*55_000+rep*75_000)/50_000)*50_000;
}
export function teamAcquisitionValue(gs,teamId){
  const budget=teamBudgetAvailable(gs,teamId);
  const safeBudget=Number.isFinite(budget)?Math.max(0,budget):2_000_000;
  const rep=reputation(gs,teamId);
  const raw=Math.max(500_000,safeBudget*0.40+rep*35_000);
  return Math.round(clamp(raw,500_000,18_000_000)/50_000)*50_000;
}
function candidates(gs,role){
  const today=dateOnly(gs?.currentDateISO);
  return staffRows(gs)
    .filter((row)=>{
      const id=staffIdOf(row);
      return id
        &&alive(row,today)
        &&stakeholderRoleExperience(gs,id).includes(role)
        &&!currentStakeholderTeamForStaff(gs,id,role);
    })
    .map((row)=>{
      const id=staffIdOf(row);
      return {
        staff:row,
        staff_id:id,
        score:stakeholderCandidateScore(gs,id,role),
        capital:stakeholderCapitalEstimate(gs,id,role),
      };
    })
    .sort((a,b)=>b.score-a.score||b.capital-a.capital||a.staff_id.localeCompare(b.staff_id));
}
function ownerOpportunity(gs){
  const owners=candidates(gs,"owner");
  if(!owners.length)return null;
  const openTeams=teamRows(gs)
    .filter((team)=>teamIdOf(team)&&!currentTeamOwner(gs,teamIdOf(team)));
  let best=null;
  for(const owner of owners){
    for(const team of openTeams){
      const tid=teamIdOf(team);
      const value=teamAcquisitionValue(gs,tid);
      if(owner.capital<value)continue;
      const teamRep=reputation(gs,tid);
      const fit=owner.score*0.68+teamRep*0.32-Math.min(12,(value/Math.max(1,owner.capital))*8);
      const row={owner,team,team_id:tid,value,fit};
      if(!best||row.fit>best.fit||(row.fit===best.fit&&tid<best.team_id))best=row;
    }
  }
  return best;
}
function backerOpportunity(gs){
  const backers=candidates(gs,"sponsor_backer");
  if(!backers.length)return null;
  const openTeams=teamRows(gs)
    .filter((team)=>teamIdOf(team)&&!currentTeamBacker(gs,teamIdOf(team)));
  let best=null;
  for(const backer of backers){
    for(const team of openTeams){
      const tid=teamIdOf(team);
      const budget=teamBudgetAvailable(gs,tid);
      const safeBudget=Number.isFinite(budget)?Math.max(250_000,budget):2_000_000;
      const rep=reputation(gs,tid);
      const need=clamp(70-Math.log10(Math.max(10,safeBudget))*7,5,35);
      const fit=backer.score*0.55+rep*0.30+need*0.15;
      const investment=Math.round(clamp(
        Math.min(backer.capital*0.18,Math.max(150_000,safeBudget*0.16)),
        150_000,
        3_500_000
      )/25_000)*25_000;
      const row={backer,team,team_id:tid,investment,fit};
      if(!best||row.fit>best.fit||(row.fit===best.fit&&tid<best.team_id))best=row;
    }
  }
  return best;
}
function stakeholderNews(gs,{role,staff,team,value=0}){
  const date=dateOnly(gs?.currentDateISO);
  const name=text(staff?.staff_name??staff?.display_name??staff?.name??"Investor");
  const tName=teamName(team);
  const owner=role==="owner";
  return {
    id:["stakeholder",role,date,staffIdOf(staff),teamIdOf(team)].join("_"),
    date,
    unread:true,
    type:"FINANCE",
    from:"Paddock Business",
    tag:owner?"Ownership":"Investment",
    subject:owner?(name+" acquires "+tName):(name+" backs "+tName),
    body:owner
      ?(name+" has acquired "+tName+" and becomes the team's Owner.")
      :(name+" has become "+tName+"'s Sponsor Backer with an initial investment of $"+Number(value||0).toLocaleString("en-US")+"."),
    staff_id:staffIdOf(staff),
    team_id:teamIdOf(team),
  };
}

export function applyStakeholderMarketTick(gs){
  if(!gs)return gs;
  const date=dateOnly(gs?.currentDateISO);
  if(!date)return gs;
  const month=date.slice(0,7);
  if(gs?._lastStakeholderMarketMonth===month)return gs;

  let next={...gs};
  const monthNo=Number(date.slice(5,7));
  if([1,4,7,10].includes(monthNo)){
    const rng=rngFor(next,"stakeholder-market:"+month);

    const owner=ownerOpportunity(next);
    if(owner&&owner.fit>=50&&rng.chance(clamp(0.25+(owner.fit-50)*0.008,0.25,0.72))){
      const staff=staffCoreFor(next,owner.owner.staff_id)||owner.owner.staff;
      next=addTeamStakeholder(next,{
        staffId:owner.owner.staff_id,
        staffName:staff?.staff_name??staff?.name,
        teamId:owner.team_id,
        teamName:teamName(owner.team),
        role:"owner",
        acquisitionValue:owner.value,
        source:"simulation_owner_acquisition",
        dateISO:date,
      });
      next={...next,inbox:[stakeholderNews(next,{role:"owner",staff,team:owner.team,value:owner.value}),...(next?.inbox||[])]};
    }

    const backer=backerOpportunity(next);
    if(backer&&backer.fit>=48&&rng.chance(clamp(0.30+(backer.fit-48)*0.009,0.30,0.75))){
      const staff=staffCoreFor(next,backer.backer.staff_id)||backer.backer.staff;
      next=addTeamStakeholder(next,{
        staffId:backer.backer.staff_id,
        staffName:staff?.staff_name??staff?.name,
        teamId:backer.team_id,
        teamName:teamName(backer.team),
        role:"sponsor_backer",
        investment:backer.investment,
        source:"simulation_sponsor_backer",
        dateISO:date,
      });
      next=applyTeamBudgetDelta(next,backer.team_id,backer.investment,{
        category:"Sponsor Backer",
        desc:(staff?.staff_name??staff?.name??"Sponsor Backer")+" investment",
        sig:["sponsor-backer",date,backer.backer.staff_id,backer.team_id].join(":"),
      });
      next={...next,inbox:[stakeholderNews(next,{role:"sponsor_backer",staff,team:backer.team,value:backer.investment}),...(next?.inbox||[])]};
    }
  }

  return {...next,_lastStakeholderMarketMonth:month};
}
