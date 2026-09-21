// src/domain/developmentTesting.js
import { isTestDriverContract } from "./contractRoles.js";
import { activeDriverContracts } from "./driverContracts.js";

const unwrap=(v)=>v&&typeof v==="object"&&!Array.isArray(v)?(v.result??v.value??null):v;
const pick=(o,keys,fb=undefined)=>{
  for(const k of keys){
    const v=unwrap(o?.[k]);
    if(v!==undefined&&v!==null&&v!=="")return v;
  }
  return fb;
};
const driverIdOf=(row)=>String(pick(row,["driver_id","person_id","id"],""));
const teamIdOf=(row)=>String(pick(row,["team_id","constructor_id","team","constructor"],""));

export function activeTestDriverContracts(gs,teamId){
  return activeDriverContracts(gs,{teamId}).filter(isTestDriverContract);
}

export function testDriverDevelopmentProfile(gs,teamId){
  const contracts=activeTestDriverContracts(gs,teamId);
  if(!contracts.length)return null;

  const ratings=Array.isArray(gs?.driverRatings)&&gs.driverRatings.length
    ? gs.driverRatings
    : (Array.isArray(gs?.dbDriverRatings)?gs.dbDriverRatings:[]);
  const drivers=Array.isArray(gs?.drivers)&&gs.drivers.length
    ? gs.drivers
    : (Array.isArray(gs?.dbDrivers)?gs.dbDrivers:[]);

  const candidates=contracts.map((contract)=>{
    const driverId=driverIdOf(contract);
    const rating=ratings.find((row)=>driverIdOf(row)===driverId)||{};
    const driver=drivers.find((row)=>driverIdOf(row)===driverId)||{};
    const impact=Math.max(0,Math.min(100,Number(pick(rating,["car_development_impact"],50))||50));
    const ability=Math.max(0,Math.min(100,Number(pick(rating,["current_ability","overall","pace"],50))||50));
    return {
      driver_id:driverId,
      name:driver?.display_name||driver?.name||contract?.driver_name||driverId,
      impact,
      ability,
      contract,
    };
  }).sort((a,b)=>b.impact-a.impact||b.ability-a.ability||a.driver_id.localeCompare(b.driver_id));

  const best=candidates[0];
  const performanceMultiplier=Number((1.02+Math.max(-0.02,Math.min(0.10,(best.impact-50)/500))).toFixed(3));
  const riskReduction=Number((0.015+best.impact*0.00035).toFixed(3));
  return {...best,performanceMultiplier,riskReduction};
}
