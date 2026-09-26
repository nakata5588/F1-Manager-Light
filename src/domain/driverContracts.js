// src/domain/driverContracts.js
import {
  driverRoleLabelForSlot,
  driverRoleSlot,
  isDriverContract,
  isRaceDriverContract,
  isReserveDriverContract,
  isRaceDriverSlot,
} from "./contractRoles.js";
import { driverMarketEvaluation } from "./driverMarketEvaluation.js";
import { applyDriverMentalState } from "./driverMentalState.js";
import {
  collectionRows,
  contractActiveForYear,
  contractEndYear,
  pickValue,
  preferLiveRows,
} from "./liveContracts.js";
import { applyTeammateRoleStatusChange } from "./driverTeammateDynamics.js";
import { synchronizeTeamTeammateRelationships } from "./relationshipEvents.js";
import { applyDriverReleaseRelationship, applyDriverRoleTeamRelationship } from "./driverTeamManagerDynamics.js";
import { managerGameplayEffects } from "./managerProfile.js";

const clamp=(n,min,max)=>Math.max(min,Math.min(max,Number(n)||0));

function contractsOf(gs){
  return preferLiveRows(gs,"contracts","dbContracts");
}
function ratingsOf(gs){
  const live=collectionRows(gs?.driverRatings);
  return live.length?live:collectionRows(gs?.dbDriverRatings);
}

export { contractActiveForYear, contractEndYear };
export const driverIdOf=(o)=>String(pickValue(o,["driver_id","person_id","id"],""));
export const teamIdOf=(o)=>String(pickValue(o,["team_id","constructor_id","team","constructor"],""));

export function driverContractsOf(gs){
  return contractsOf(gs);
}

export function activeDriverContracts(gs,{teamId=null,raceOnly=false}={}){
  const year=Number(gs?.activeYear);
  return contractsOf(gs).filter((contract)=>{
    if(!isDriverContract(contract)||!contractActiveForYear(contract,year))return false;
    if(teamId!=null&&teamIdOf(contract)!==String(teamId))return false;
    if(raceOnly&&!isRaceDriverContract(contract))return false;
    return true;
  });
}

export function currentDriverTeamId(gs,driverId){
  const contract=activeDriverContract(gs,driverId);
  return contract?teamIdOf(contract):"";
}

export function freeAgentDrivers(gs){
  const activeIds=new Set(activeDriverContracts(gs).map(driverIdOf));
  return (Array.isArray(gs?.drivers)?gs.drivers:[]).filter((driver)=>{
    const id=driverIdOf(driver);
    if(!id||activeIds.has(id))return false;
    const status=String(driver?.status||"eligible").toLowerCase();
    return !["deceased","retired","hidden"].includes(status);
  });
}

export function expiringDriverContracts(gs,{teamId=null}={}){
  const year=Number(gs?.activeYear);
  return activeDriverContracts(gs,{teamId}).filter(
    (contract)=>contractEndYear(contract,year)===year
  );
}

export function activeDriverContract(gs,driverId){
  return activeDriverContracts(gs).find(
    (contract)=>driverIdOf(contract)===String(driverId)
  )||null;
}

export function ratingForDriver(gs,driverId){
  return ratingsOf(gs).find((r)=>driverIdOf(r)===String(driverId))||{};
}

export function driverRoleSalaryMultiplier(role){
  const key=String(role||"").toLowerCase().replace(/[_-]+/g," ");
  if(/main|first|lead/.test(key))return 1.08;
  if(/second|driver 2/.test(key))return 1.00;
  if(/reserve/.test(key))return 0.72;
  if(/test/.test(key))return 0.60;
  return 1.00;
}

export function driverSalaryMarketAnchor(gs){
  const salaries=activeDriverContracts(gs)
    .map((row)=>Number(pickValue(row,["salary","salary_yearly"],0)))
    .filter((value)=>Number.isFinite(value)&&value>0)
    .sort((a,b)=>a-b);
  if(salaries.length>=3){
    const mid=Math.floor(salaries.length/2);
    return salaries.length%2
      ?salaries[mid]
      :(salaries[mid-1]+salaries[mid])/2;
  }

  // Fallback only when historical contract coverage is sparse. The normal
  // path is data-driven from the salaries already present in the active era.
  const year=Number(gs?.activeYear);
  if(Number.isFinite(year)&&year<=1984)return 450_000;
  if(Number.isFinite(year)&&year<=1994)return 450_000;
  if(Number.isFinite(year)&&year<=2004)return 1_000_000;
  if(Number.isFinite(year)&&year<=2014)return 1_800_000;
  return 3_000_000;
}

export function expectedDriverSalary(gs,driverId,{role=null}={}){
  const rating=ratingForDriver(gs,driverId);
  const evaluation=driverMarketEvaluation(gs,driverId);
  const contract=activeDriverContract(gs,driverId);
  const rawAbility=Number(pickValue(rating,["current_ability","overall","pace"],NaN));
  const ability=Number.isFinite(rawAbility)&&rawAbility>0?rawAbility:Number(evaluation.score||55);
  const rawRep=Number(pickValue(rating,["reputation"],NaN));
  const rep=Number.isFinite(rawRep)&&rawRep>0?rawRep:Number(evaluation.reputation??ability);
  const rawMarket=Number(pickValue(rating,["market_value"],NaN));
  const market=Number.isFinite(rawMarket)&&rawMarket>0?rawMarket:Number(evaluation.market_value||0);
  const existing=Number(pickValue(contract||{},["salary","salary_yearly"],0));

  const eraAnchor=Math.max(50_000,driverSalaryMarketAnchor(gs));
  const abilityFactor=clamp(0.50+((ability-45)/40)*1.25,0.45,1.85);
  const reputationFactor=clamp(0.82+((rep-50)/100),0.72,1.25);
  const model=Math.round(eraAnchor*abilityFactor*reputationFactor);
  const marketSignal=Math.min(Math.max(0,Math.round(market*0.16)),Math.round(eraAnchor*2.5));
  const floor=Math.max(25_000,Math.round(eraAnchor*0.28));
  const baseline=Math.max(floor,existing,marketSignal,model);

  if(!role)return baseline;
  const increment=eraAnchor<1_000_000?5_000:(eraAnchor<3_000_000?10_000:25_000);
  const adjusted=Math.round((baseline*driverRoleSalaryMultiplier(role))/increment)*increment;
  return Math.max(Math.round(floor*0.6),adjusted);
}

export function contractAcceptanceChance(gs,driverId,offer,{renewal=false,teamId=null}={}){
  const expected=expectedDriverSalary(gs,driverId,{role:offer?.role});
  const salary=Math.max(0,Number(offer?.salary||0));
  const years=Math.max(1,Number(offer?.years||1));
  const rating=ratingForDriver(gs,driverId);
  const evaluation=driverMarketEvaluation(gs,driverId);
  const rawAbility=Number(pickValue(rating,["current_ability","overall","pace"],NaN));
  const ability=Number.isFinite(rawAbility)&&rawAbility>0?rawAbility:Number(evaluation.score||55);
  const rawRep=Number(pickValue(rating,["reputation"],NaN));
  const rep=Number.isFinite(rawRep)&&rawRep>0?rawRep:Number(evaluation.reputation??ability);
  const role=String(offer?.role||"Reserve Driver").toLowerCase();

  let chance=0.42;
  const ratio=expected>0?salary/expected:1;
  chance += clamp((ratio-0.75)*0.9,-0.32,0.38);
  chance += Math.min(0.10,(years-1)*0.035);
  if(/main|first|lead/.test(role))chance+=0.08;
  if(/second/.test(role))chance+=0.03;
  if(/reserve|test/.test(role)&&ability>=75)chance-=0.10;
  if(renewal)chance+=0.12;
  if(rep>=80)chance-=0.05;
  if(teamId!=null)chance+=managerGameplayEffects(gs,{teamId}).contractAcceptanceDelta;
  return clamp(chance,0.05,0.95);
}

export function terminationCost(gs,contract){
  if(!contract)return 0;
  const salary=Math.max(0,Number(pickValue(contract,["salary","salary_yearly"],0)));
  const year=Number(gs?.activeYear);
  const until=Number(pickValue(contract,["contract_until_year","contract_until","end_year"],year));
  const years=Math.max(1,Number.isFinite(until)&&Number.isFinite(year)?until-year+1:1);
  return Math.round(salary*years*0.45);
}

export function makeDriverContract({gs,driver,teamId,teamName,offer,source="player_negotiation"}){
  const year=Number(gs?.activeYear);
  return {
    year,
    team_id:String(teamId),
    team_name:teamName||String(teamId),
    driver_id:driverIdOf(driver),
    driver_name:driver?.display_name||driver?.name||driverIdOf(driver),
    role:offer.role||"Reserve Driver",
    salary:Math.round(Number(offer.salary||0)),
    contract_start_year:year,
    contract_until_year:year+Math.max(1,Number(offer.years||1))-1,
    status:"active",
    source,
  };
}

export function raceSeatCount(gs,teamId){
  return activeDriverContracts(gs,{teamId,raceOnly:true}).length;
}

export function reserveSeatCount(gs,teamId){
  return activeDriverContracts(gs,{teamId}).filter(isReserveDriverContract).length;
}

export function releaseDriverContract(gs,driverId,{reason="released_by_team"}={}){
  if(!gs)return gs;
  const contract=activeDriverContract(gs,driverId);
  if(!contract)return gs;

  const userTeamId=String(gs?.team?.team_id??gs?.team?.id??"");
  if(teamIdOf(contract)!==userTeamId)return gs;

  const cost=terminationCost(gs,contract);
  const today=String(gs?.currentDateISO||"").slice(0,10);
  const nextContracts=(Array.isArray(gs?.contracts)?gs.contracts:[]).map((row)=>{
    if(row!==contract)return row;
    return {
      ...row,
      status:"released",
      released_at:today||null,
      termination_reason:reason,
      termination_cost:cost,
    };
  });

  const oldBalance=Number(gs?.finances?.balance??gs?.team?.budget??0);
  const nextBalance=oldBalance-cost;
  const financeLog=Array.isArray(gs?.financeLog)?gs.financeLog:[];
  const sig="driver-release:"+driverId+":"+today;
  const tx=cost>0&&!financeLog.some((row)=>row?.sig===sig)
    ? [{
        id:"tx_"+sig,
        dateISO:today,
        type:"expense",
        category:"Driver",
        desc:"Contract termination — "+(contract.driver_name||driverId),
        amount:-cost,
        sig,
      }]
    : [];

  const next={
    ...gs,
    contracts:nextContracts,
    team:{...(gs?.team||{}),budget:Number(gs?.team?.budget??oldBalance)-cost},
    finances:{
      ...(gs?.finances||{}),
      balance:nextBalance,
      budget:Number(gs?.finances?.budget??oldBalance)-cost,
      season_spend:Number(gs?.finances?.season_spend||0)+cost,
    },
    financeLog:[...tx,...financeLog],
    driverNegotiations:(gs?.driverNegotiations||[]).map((negotiation)=>
      String(negotiation?.driver_id)===String(driverId) &&
      String(negotiation?.kind||"")==="renewal" &&
      ["submitted","countered"].includes(String(negotiation?.status||"").toLowerCase())
        ?{...negotiation,status:"withdrawn",resolved_at:today,resolution_note:"Contract was terminated by the team."}
        :negotiation
    ),
    inbox:[{
      id:"release_"+driverId+"_"+today,
      date:today,
      unread:true,
      type:"STAFF",
      from:"Driver Management",
      tag:"Contracts",
      subject:"Contract terminated — "+(contract.driver_name||driverId),
      body:(contract.driver_name||driverId)+" has been released from the team. Termination cost: $"+cost.toLocaleString("en-US")+".",
      driver_id:String(driverId),
      team_id:userTeamId,
    },...(gs?.inbox||[])],
  };
  return applyDriverReleaseRelationship(next,{
    driverId,
    teamId:userTeamId,
    reason:"Released by team",
  });
}

export function extendDriverContract(gs,driverId,offer){
  const contract=activeDriverContract(gs,driverId);
  if(!contract)return gs;
  const year=Number(gs?.activeYear);
  const currentEnd=contractEndYear(contract,year);
  const extensionYears=Math.max(1,Math.min(5,Math.round(Number(offer?.years||1))));
  const newEnd=Math.max(year,currentEnd)+extensionYears;
  const salary=Math.max(0,Math.round(Number(offer?.salary??contract?.salary??0)));
  const role=offer?.role||contract?.role||"Driver";

  return {
    ...gs,
    contracts:(Array.isArray(gs?.contracts)?gs.contracts:[]).map((row)=>row===contract?{
      ...row,
      role,
      salary,
      contract_until_year:newEnd,
      contract_until:newEnd,
      end_year:newEnd,
      status:"active",
      renewed_at:String(gs?.currentDateISO||"").slice(0,10)||null,
      renewal_extension_years:extensionYears,
    }:row),
  };
}


const ROLE_EFFECTS=Object.freeze({
  "second>main":{morale:2,confidence:2,reputation:0},
  "main>second":{morale:-3,confidence:-2,reputation:0},
  "test>reserve":{morale:1,confidence:1,reputation:0},
  "reserve>test":{morale:-1,confidence:-1,reputation:0},
});

function roleChangeEffects(fromSlot,toSlot){
  if(fromSlot===toSlot)return {morale:0,confidence:0,reputation:0};
  const explicit=ROLE_EFFECTS[fromSlot+">"+toSlot];
  if(explicit)return explicit;

  const fromRace=isRaceDriverSlot(fromSlot);
  const toRace=isRaceDriverSlot(toSlot);
  if(!fromRace&&toRace){
    return toSlot==="main"
      ?{morale:4,confidence:3,reputation:1}
      :{morale:3,confidence:2,reputation:1};
  }
  if(fromRace&&!toRace){
    return toSlot==="reserve"
      ?{morale:-4,confidence:-3,reputation:0}
      :{morale:-5,confidence:-3,reputation:0};
  }

  const rank={test:0,reserve:1,second:2,main:3};
  const diff=(rank[toSlot]??0)-(rank[fromSlot]??0);
  return diff>0
    ?{morale:1,confidence:1,reputation:0}
    :{morale:-1,confidence:-1,reputation:0};
}

function applyRoleEffects(gs,effectsByDriver){
  if(!effectsByDriver.size)return gs;
  const clamp100=(value)=>Math.max(0,Math.min(100,Number(value)||0));
  let next=gs;

  for(const [driverId,effects] of effectsByDriver.entries()){
    next=applyDriverMentalState(next,driverId,{
      deltas:{
        morale:Number(effects.morale||0),
        confidence:Number(effects.confidence||0),
      },
      source:"role_change",
      reason:"Driver role change",
    });
  }

  const driverRatings=Array.isArray(next?.driverRatings)
    ?next.driverRatings.map((row)=>{
      const did=driverIdOf(row);
      const effects=effectsByDriver.get(did);
      if(!effects?.reputation)return row;
      const current=Number(row?.reputation);
      if(!Number.isFinite(current))return row;
      return {...row,reputation:clamp100(current+effects.reputation)};
    })
    :next?.driverRatings;

  return {...next,driverRatings};
}

export function driverLineupSlots(gs,teamId){
  const slots={main:null,second:null,reserve:null,test:null};
  const raceFallback=[];

  for(const contract of activeDriverContracts(gs,{teamId})){
    const slot=driverRoleSlot(contract);
    if(!slot)continue;
    if((slot==="main"||slot==="second")&&slots[slot]){
      raceFallback.push(contract);
      continue;
    }
    if(!slots[slot])slots[slot]=contract;
  }

  for(const contract of raceFallback){
    if(!slots.main)slots.main=contract;
    else if(!slots.second)slots.second=contract;
  }
  return slots;
}

function applyRoleAssignments(gs,assignments){
  const source=driverContractsOf(gs);
  const today=String(gs?.currentDateISO||"").slice(0,10)||null;
  const changes=new Map();
  const contractUpdates=new Map();

  for(const assignment of assignments){
    const contract=assignment?.contract;
    const toSlot=assignment?.toSlot;
    if(!contract||!toSlot)continue;
    const fromSlot=assignment?.fromSlot||driverRoleSlot(contract);
    if(!fromSlot||fromSlot===toSlot)continue;
    const did=driverIdOf(contract);
    contractUpdates.set(contract,{
      ...contract,
      role:driverRoleLabelForSlot(toSlot),
      role_changed_at:today,
      role_changed_from:driverRoleLabelForSlot(fromSlot),
    });
    changes.set(did,roleChangeEffects(fromSlot,toSlot));
  }

  if(!contractUpdates.size)return gs;
  let next={
    ...gs,
    contracts:source.map((row)=>contractUpdates.get(row)||row),
  };
  next=applyRoleEffects(next,changes);

  // D6.3C: the same hierarchy decision also changes how the driver views
  // the Team and, for the player team, the Manager responsible for it.
  for(const assignment of assignments){
    const contract=assignment?.contract;
    const fromSlot=assignment?.fromSlot||driverRoleSlot(contract);
    const toSlot=assignment?.toSlot;
    if(!contract||!fromSlot||!toSlot||fromSlot===toSlot)continue;
    next=applyDriverRoleTeamRelationship(next,{
      driverId:driverIdOf(contract),
      teamId:teamIdOf(contract),
      fromRole:driverRoleLabelForSlot(fromSlot),
      toRole:driverRoleLabelForSlot(toSlot),
    });
  }

  // D6.3B: hierarchy changes also alter teammate dynamics. A reciprocal slot
  // swap is recorded once for the pair; a promotion/demotion into a vacant
  // seat is compared with the resulting race teammate.
  const handled=new Set();
  for(let index=0;index<assignments.length;index++){
    const assignment=assignments[index];
    const contract=assignment?.contract;
    const fromSlot=assignment?.fromSlot||driverRoleSlot(contract);
    const toSlot=assignment?.toSlot;
    const did=driverIdOf(contract);
    const tid=teamIdOf(contract);
    if(!did||!tid||!fromSlot||!toSlot||fromSlot===toSlot)continue;
    if(!isRaceDriverSlot(fromSlot)&&!isRaceDriverSlot(toSlot))continue;

    let teammateId=null;
    for(let otherIndex=index+1;otherIndex<assignments.length;otherIndex++){
      const other=assignments[otherIndex];
      const otherFrom=other?.fromSlot||driverRoleSlot(other?.contract);
      const otherTo=other?.toSlot;
      if(otherFrom===toSlot&&otherTo===fromSlot){
        teammateId=driverIdOf(other?.contract);
        handled.add(otherIndex);
        break;
      }
    }
    if(handled.has(index))continue;

    if(!teammateId){
      teammateId=activeDriverContracts(next,{teamId:tid,raceOnly:true})
        .map(driverIdOf)
        .find((id)=>id&&id!==did)||null;
    }
    if(!teammateId)continue;
    next=applyTeammateRoleStatusChange(next,{
      driverId:did,
      teammateId,
      teamId:tid,
      fromSlot,
      toSlot,
    });
  }

  const affectedTeams=[...new Set(assignments.map((assignment)=>teamIdOf(assignment?.contract)).filter(Boolean))];
  for(const tid of affectedTeams){
    const raceDriverIds=activeDriverContracts(next,{teamId:tid,raceOnly:true}).map(driverIdOf).filter(Boolean);
    next=synchronizeTeamTeammateRelationships(next,{teamId:tid,driverIds:raceDriverIds});
  }
  return next;
}

export function changeDriverContractRole(gs,{
  driverId,
  targetRole,
  teamId=null,
  swapIfOccupied=true,
}={}){
  if(!gs)return gs;
  const did=String(driverId||"");
  const contract=activeDriverContract(gs,did);
  if(!contract)return gs;

  const ownerTeamId=teamIdOf(contract);
  const expectedTeamId=String(teamId??gs?.team?.team_id??gs?.team?.id??ownerTeamId);
  if(ownerTeamId!==expectedTeamId)return gs;

  const fromSlot=driverRoleSlot(contract);
  const toSlot=driverRoleSlot(targetRole);
  if(!fromSlot||!toSlot||fromSlot===toSlot)return gs;

  const teamContracts=activeDriverContracts(gs,{teamId:ownerTeamId});
  const occupant=teamContracts.find((row)=>
    row!==contract&&driverRoleSlot(row)===toSlot
  )||null;

  if(occupant&&!swapIfOccupied)return gs;

  const assignments=[{contract,fromSlot,toSlot}];
  if(occupant){
    assignments.push({
      contract:occupant,
      fromSlot:toSlot,
      toSlot:fromSlot,
    });
  }
  return applyRoleAssignments(gs,assignments);
}

export function swapRaceDriverRoles(gs,{teamId=null}={}){
  if(!gs)return gs;
  const tid=String(teamId??gs?.team?.team_id??gs?.team?.id??"");
  if(!tid)return gs;
  const lineup=driverLineupSlots(gs,tid);
  if(!lineup.main||!lineup.second)return gs;

  return applyRoleAssignments(gs,[
    {
      contract:lineup.main,
      fromSlot:"main",
      toSlot:"second",
    },
    {
      contract:lineup.second,
      fromSlot:"second",
      toSlot:"main",
    },
  ]);
}
