// src/engine/ReplacementEngine.js
import { buildRaceEntryState, driverAvailabilityForRace } from "../domain/raceEntry.js";
import { activeDriverContract, driverIdOf, expectedDriverSalary } from "../domain/driverContracts.js";

const pick=(o,keys,fb=undefined)=>{
  for(const k of keys){
    const v=o?.[k];
    if(v!==undefined&&v!==null&&v!=="")return v;
  }
  return fb;
};
const teamIdOf=(o)=>String(pick(o,["team_id","constructor_id","team","constructor","id"],""));
const gpIdOf=(gp,roundIndex)=>{
  const fallback=Number.isFinite(Number(roundIndex))?"round_"+(Number(roundIndex)+1):"gp";
  return String(pick(gp,["gp_id","id","track_id"],fallback));
};
const driverName=(d)=>d?.display_name||d?.name||d?.driver_name||driverIdOf(d);

function ratingFor(gs,driverId){
  return (gs?.driverRatings||[]).find((r)=>String(r?.driver_id??r?.id??"")===String(driverId))||{};
}
function replacementScore(gs,driver){
  const r=ratingFor(gs,driverIdOf(driver));
  const ability=Number(r?.current_ability??r?.overall??r?.pace??55);
  const reputation=Number(r?.reputation??ability);
  const consistency=Number(r?.consistency??ability);
  const experience=Number(r?.experience??r?.racecraft??ability);
  return ability*0.60+experience*0.20+consistency*0.12+reputation*0.08;
}
function activeAssignmentFor(assignments,gpId,teamId,slot){
  return assignments.find((a)=>
    String(a?.gp_id||"")===String(gpId) &&
    String(a?.team_id||"")===String(teamId) &&
    Number(a?.car_slot)===Number(slot) &&
    String(a?.status||"active").toLowerCase()==="active"
  )||null;
}
function emergencyFee(gs,driverId){
  return Math.max(25_000,Math.round(expectedDriverSalary(gs,driverId)/20));
}
function deductPlayerFee(gs,assignment){
  const userTeamId=String(gs?.team?.team_id??gs?.team?.id??"");
  if(String(assignment.team_id)!==userTeamId)return gs;

  const fee=Number(assignment.fee||0);
  const oldBudget=Number(gs?.team?.budget??gs?.finances?.balance??0);
  const nextBudget=oldBudget-fee;
  const sig="temp-driver:"+assignment.id;
  const log=Array.isArray(gs?.financeLog)?gs.financeLog:[];
  if(log.some((tx)=>tx?.sig===sig))return gs;

  return {
    ...gs,
    team:{...(gs?.team||{}),budget:nextBudget},
    finances:{
      ...(gs?.finances||{}),
      budget:nextBudget,
      balance:Number(gs?.finances?.balance??oldBudget)-fee,
      season_spend:Number(gs?.finances?.season_spend||0)+fee,
    },
    financeLog:[
      {
        id:"tx_"+assignment.id,
        dateISO:gs?.currentDateISO,
        type:"expense",
        category:"Driver",
        desc:"Emergency replacement — "+assignment.driver_name,
        amount:-fee,
        sig,
      },
      ...log,
    ],
  };
}

export function eligibleEmergencyDrivers(gs,gp,{excludeIds=[]}={}){
  const excluded=new Set((excludeIds||[]).map(String));
  return (gs?.drivers||[])
    .filter((driver)=>{
      const id=driverIdOf(driver);
      if(!id||excluded.has(id))return false;
      const status=String(driver?.status||"eligible").toLowerCase();
      if(["hidden","junior_only","deceased","retired"].includes(status))return false;
      if(driver?.canHireF1===false)return false;
      if(activeDriverContract(gs,id))return false;
      if(!driverAvailabilityForRace(gs,id,gp).available)return false;
      return true;
    })
    .sort((a,b)=>{
      const scoreDiff=replacementScore(gs,b)-replacementScore(gs,a);
      if(Math.abs(scoreDiff)>0.0001)return scoreDiff;
      return driverIdOf(a).localeCompare(driverIdOf(b));
    });
}

export function ensureTemporaryReplacements(gs,{gp,roundIndex}={}){
  if(!gs)return gs;
  const gpId=gpIdOf(gp,roundIndex);
  const year=Number(gs?.activeYear)||Number(gp?.year)||null;
  const existing=Array.isArray(gs?.temporaryDriverAssignments)?gs.temporaryDriverAssignments.slice():[];
  const initialEntry=buildRaceEntryState(gs,{gp,roundIndex});
  const vacancies=initialEntry.entries.filter((entry)=>entry?.status==="vacant");
  if(!vacancies.length)return gs;

  const alreadyEntered=new Set(
    initialEntry.entries.map((entry)=>String(entry?.driver_id||"")).filter(Boolean)
  );
  const alreadyAssigned=new Set(
    existing
      .filter((a)=>String(a?.gp_id||"")===gpId)
      .map((a)=>String(a?.driver_id||""))
      .filter(Boolean)
  );
  const candidates=eligibleEmergencyDrivers(gs,gp,{
    excludeIds:[...alreadyEntered,...alreadyAssigned],
  });
  const newAssignments=[];
  const messages=[];
  const userTeamId=String(gs?.team?.team_id??gs?.team?.id??"");

  for(const vacancy of vacancies){
    if(activeAssignmentFor(existing,gpId,vacancy.team_id,vacancy.car_slot))continue;
    const driver=candidates.shift();
    if(!driver){
      if(String(vacancy.team_id)===userTeamId){
        messages.push({
          id:"no_temp_"+gpId+"_"+vacancy.team_id+"_"+vacancy.car_slot,
          date:gs?.currentDateISO,
          unread:true,
          type:"STAFF",
          from:"Team Management",
          tag:"Driver Availability",
          subject:"No emergency replacement available",
          body:"No eligible free driver could be found for Car "+vacancy.car_slot+". The car will remain vacant for this Grand Prix.",
        });
      }
      continue;
    }

    const did=driverIdOf(driver);
    const fee=emergencyFee(gs,did);
    const assignment={
      id:"temp_"+String(year||"season")+"_"+gpId+"_"+vacancy.team_id+"_"+vacancy.car_slot+"_"+did,
      year,
      gp_id:gpId,
      round:Number.isFinite(Number(roundIndex))?Number(roundIndex)+1:null,
      team_id:String(vacancy.team_id),
      car_slot:Number(vacancy.car_slot),
      driver_id:did,
      driver_name:driverName(driver),
      replaces_driver_id:vacancy.contracted_driver_id||null,
      role:"Emergency Substitute",
      status:"active",
      fee,
      source:"emergency_market",
      created_at:gs?.currentDateISO||null,
    };
    newAssignments.push(assignment);
    alreadyAssigned.add(did);

    if(String(vacancy.team_id)===userTeamId){
      messages.push({
        id:"temp_notice_"+assignment.id,
        date:gs?.currentDateISO,
        unread:true,
        type:"STAFF",
        from:"Team Management",
        tag:"Driver Availability",
        subject:assignment.driver_name+" drafted as emergency substitute",
        body:assignment.driver_name+" has been registered for this Grand Prix as an emergency substitute. One-race fee: $"+fee.toLocaleString("en-US")+".",
        driver_id:did,
        temporary_assignment_id:assignment.id,
      });
    }
  }

  if(!newAssignments.length&&!messages.length)return gs;

  let next={
    ...gs,
    temporaryDriverAssignments:[...existing,...newAssignments],
    inbox:[...messages,...(gs?.inbox||[])],
  };
  for(const assignment of newAssignments)next=deductPlayerFee(next,assignment);
  return next;
}
