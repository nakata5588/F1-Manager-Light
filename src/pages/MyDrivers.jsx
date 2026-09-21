import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../state/GameStore.js";
import { DriverPortrait, TeamLogo, flagFromCountry } from "../components/entity/EntityVisuals.jsx";
import {
  isRaceDriverContract,
  isReserveDriverContract,
  isTestDriverContract,
  normalizedContractRole,
} from "../domain/contractRoles.js";

const unbox=(v)=>v&&typeof v==="object"&&!Array.isArray(v)?(v.result??v.value??v):v;
const pick=(o,keys,fb=undefined)=>{
  for(const k of keys){
    const v=unbox(o?.[k]);
    if(v!==undefined&&v!==null&&v!=="")return v;
  }
  return fb;
};
const idOf=(o)=>String(pick(o,["driver_id","person_id","id"],""));
const teamIdOf=(o)=>String(pick(o,["team_id","constructor_id","team","constructor"],""));

const SLOT_ORDER=[
  {key:"main",label:"Main Driver",description:"Primary race seat"},
  {key:"second",label:"Second Driver",description:"Second race seat"},
  {key:"reserve",label:"Reserve Driver",description:"First replacement when a race driver is unavailable"},
  {key:"test",label:"Test Driver",description:"Development and testing specialist"},
];

function isActiveContract(contract,year){
  const status=String(pick(contract,["status"],"active")).toLowerCase();
  if(["terminated","expired","released","inactive","void"].includes(status))return false;
  const direct=Number(pick(contract,["year","season_year"],NaN));
  const start=Number(pick(contract,["contract_start_year","start_year"],NaN));
  const end=Number(pick(contract,["contract_until_year","contract_until","end_year"],NaN));
  if(Number.isFinite(start)||Number.isFinite(end)){
    const lo=Number.isFinite(start)?start:(Number.isFinite(direct)?direct:-Infinity);
    const hi=Number.isFinite(end)?end:(Number.isFinite(direct)?direct:Infinity);
    return !Number.isFinite(year)||(year>=lo&&year<=hi);
  }
  return !Number.isFinite(year)||!Number.isFinite(direct)||direct===year;
}

function slotForContract(contract){
  if(isReserveDriverContract(contract))return "reserve";
  if(isTestDriverContract(contract))return "test";
  if(isRaceDriverContract(contract)){
    const role=normalizedContractRole(contract);
    if(/second|driver_?2|segundo/.test(role))return "second";
    return "main";
  }
  return null;
}

function money(value){
  return Number(value)
    ? new Intl.NumberFormat("en-GB",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(Number(value))
    : "—";
}

export default function MyDrivers(){
  const navigate=useNavigate();
  const gs=useGame((s)=>s.gameState);
  const setGameState=useGame((s)=>s.setGameState);
  const year=Number(gs?.activeYear);
  const myTeamId=String(gs?.team?.team_id??gs?.team?.id??"");
  const myTeamName=gs?.team?.team_name||gs?.team?.name||"My Team";
  const drivers=gs?.drivers?.length?gs.drivers:gs?.dbDrivers||[];
  const contracts=gs?.contracts?.length?gs.contracts:gs?.dbContracts||[];
  const ratings=gs?.driverRatings?.length?gs.driverRatings:gs?.dbDriverRatings||[];

  const ratingById=useMemo(()=>new Map(ratings.map((r)=>[idOf(r),r])),[ratings]);
  const driverById=useMemo(()=>new Map(drivers.map((d)=>[idOf(d),d])),[drivers]);

  const activeTeamContracts=useMemo(()=>contracts.filter((contract)=>
    teamIdOf(contract)===myTeamId &&
    isActiveContract(contract,year) &&
    slotForContract(contract)
  ),[contracts,myTeamId,year]);

  const slotRows=useMemo(()=>{
    const rows=new Map();
    const raceFallback=[];
    for(const contract of activeTeamContracts){
      const initial=slotForContract(contract);
      if(initial==="main"&&rows.has("main")){
        raceFallback.push(contract);
        continue;
      }
      if(initial==="second"&&rows.has("second")){
        raceFallback.push(contract);
        continue;
      }
      if(initial&&!rows.has(initial))rows.set(initial,contract);
    }
    for(const contract of raceFallback){
      if(!rows.has("main"))rows.set("main",contract);
      else if(!rows.has("second"))rows.set("second",contract);
    }

    return SLOT_ORDER.map((slot)=>{
      const contract=rows.get(slot.key)||null;
      if(!contract)return {...slot,contract:null};
      const id=idOf(contract);
      const driver=driverById.get(id)||{
        driver_id:id,
        display_name:pick(contract,["driver_name","name"],id),
      };
      const rating=ratingById.get(id)||{};
      return {
        ...slot,
        contract,
        id,
        driver,
        name:driver.display_name||driver.name||pick(contract,["driver_name","name"],id),
        overall:pick(rating,["current_ability","overall","pace"],"—"),
        salary:Number(pick(contract,["salary","salary_yearly"],0))||0,
        until:pick(contract,["contract_until_year","contract_until","end_year","end_date"],"—"),
      };
    });
  },[activeTeamContracts,driverById,ratingById]);

  const main=slotRows.find((row)=>row.key==="main");
  const second=slotRows.find((row)=>row.key==="second");
  const canSwap=Boolean(main?.contract&&second?.contract);

  function swapRaceDrivers(){
    if(!canSwap)return;
    const mainId=idOf(main.contract);
    const secondId=idOf(second.contract);
    const next=contracts.map((contract)=>{
      const id=idOf(contract);
      if(id===mainId&&teamIdOf(contract)===myTeamId&&isActiveContract(contract,year)){
        return {...contract,role:"Second Driver"};
      }
      if(id===secondId&&teamIdOf(contract)===myTeamId&&isActiveContract(contract,year)){
        return {...contract,role:"Main Driver"};
      }
      return contract;
    });
    setGameState({contracts:next});
  }

  return (
    <div className="grid gap-4">
      <div className="bg-white rounded-xl shadow p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center gap-3">
          <TeamLogo teamId={myTeamId} name={myTeamName} size="h-12 w-12" />
          <div>
            <h2 className="text-xl font-semibold">My Drivers</h2>
            <p className="text-sm text-gray-500">{myTeamName} · Season {year||"—"}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="border rounded-md px-3 py-2 text-sm disabled:opacity-40"
            disabled={!canSwap}
            onClick={swapRaceDrivers}
          >
            Swap race drivers
          </button>
          <button
            type="button"
            className="rounded-md px-3 py-2 text-sm bg-slate-900 text-white"
            onClick={()=>navigate("/Drivers")}
          >
            Open Driver Market
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {slotRows.map((row)=>row.contract?(
          <button
            key={row.key}
            type="button"
            data-entity="driver"
            data-id={row.id}
            className="bg-white rounded-xl shadow p-4 text-left hover:shadow-md transition border border-transparent"
          >
            <div className="flex items-start gap-4">
              <DriverPortrait driver={row.driver} size="h-20 w-20" />
              <div className="min-w-0 flex-1">
                <div className="text-xs uppercase tracking-wide text-gray-500">{row.label}</div>
                <div className="text-lg font-semibold truncate">{row.name}</div>
                <div className="text-sm text-gray-500">
                  {flagFromCountry(row.driver?.country_name||row.driver?.nationality,row.driver?.country_code)}{" "}
                  {row.driver?.country_name||row.driver?.nationality||"—"}
                </div>
                <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
                  <Info label="Overall" value={row.overall} />
                  <Info label="Contract" value={row.until} />
                  <Info label="Salary" value={money(row.salary)} />
                </div>
                <div className="mt-3 text-xs text-gray-500">{row.description}</div>
              </div>
            </div>
          </button>
        ):(
          <div key={row.key} className="bg-white rounded-xl shadow p-4 border border-dashed border-gray-300">
            <div className="text-xs uppercase tracking-wide text-gray-500">{row.label}</div>
            <div className="mt-1 text-lg font-semibold">Vacant</div>
            <div className="mt-1 text-sm text-gray-500">{row.description}</div>
            <button
              type="button"
              className="mt-4 border rounded-md px-3 py-2 text-sm hover:bg-gray-50"
              onClick={()=>navigate("/Drivers")}
            >
              Find a driver
            </button>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow p-4 text-sm text-gray-600">
        Main and Second Driver are the two race seats. Reserve Driver is the automatic first replacement for an unavailable race driver. Test Driver is reserved for development/testing work and is not used automatically as a race substitute.
      </div>
    </div>
  );
}

function Info({label,value}){
  return <div><div className="text-xs text-gray-500">{label}</div><div className="font-medium">{value??"—"}</div></div>;
}
