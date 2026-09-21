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
import {
  collectionRows,
  contractActiveForYear,
  contractEndYear,
  pickValue,
  preferLiveRows,
} from "./liveContracts.js";

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

export function expectedDriverSalary(gs,driverId){
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
  const model=Math.round((Math.max(45,ability)**2)*120 + Math.max(0,rep-50)*18_000);
  return Math.max(150_000,existing,Math.round(market*0.16),model);
}

export function contractAcceptanceChance(gs,driverId,offer,{renewal=false}={}){
  const expected=expectedDriverSalary(gs,driverId);
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

  return {
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
  const driverAttributes={...(gs?.driverAttributes||{})};

  for(const [driverId,effects] of effectsByDriver.entries()){
    const current={...(driverAttributes[driverId]||{})};
    driverAttributes[driverId]={
      ...current,
      morale:clamp100(Number(current.morale??50)+Number(effects.morale||0)),
      confidence:clamp100(Number(current.confidence??50)+Number(effects.confidence||0)),
    };
  }

  const driverRatings=Array.isArray(gs?.driverRatings)
    ?gs.driverRatings.map((row)=>{
      const did=driverIdOf(row);
      const effects=effectsByDriver.get(did);
      if(!effects?.reputation)return row;
      const current=Number(row?.reputation);
      if(!Number.isFinite(current))return row;
      return {...row,reputation:clamp100(current+effects.reputation)};
    })
    :gs?.driverRatings;

  return {...gs,driverAttributes,driverRatings};
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
  const next={
    ...gs,
    contracts:source.map((row)=>contractUpdates.get(row)||row),
  };
  return applyRoleEffects(next,changes);
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
