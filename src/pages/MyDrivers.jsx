import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../state/GameStore.js";
import { DriverPortrait, TeamLogo, flagFromCountry } from "../components/entity/EntityVisuals.jsx";
import {
  isRaceDriverContract,
  isReserveDriverContract,
  isTestDriverContract,
  normalizedContractRole,
} from "../domain/contractRoles.js";
import { driverOverallPresentation } from "../domain/driverMarketEvaluation.js";
import ContractNegotiationModal from "../components/drivers/ContractNegotiationModal.jsx";
import {
  activeDriverContracts,
  expectedDriverSalary,
  releaseDriverContract,
  terminationCost,
} from "../domain/driverContracts.js";
import {
  driverNegotiations,
  isNegotiationActive,
  startDriverRenewal,
} from "../engine/NegotiationEngine.js";

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
  const driverById=useMemo(()=>new Map(drivers.map((d)=>[idOf(d),d])),[drivers]);
  const [renewingRow,setRenewingRow]=useState(null);
  const negotiations=driverNegotiations(gs);
  const activeRenewalByDriver=useMemo(()=>{
    const map=new Map();
    for(const negotiation of negotiations){
      if(
        negotiation?.kind==="renewal" &&
        negotiation?.origin==="player" &&
        isNegotiationActive(negotiation)
      ){
        map.set(String(negotiation.driver_id),negotiation);
      }
    }
    return map;
  },[negotiations]);

  const activeTeamContracts=useMemo(()=>
    activeDriverContracts(gs,{teamId:myTeamId}).filter(slotForContract),
    [gs?.contracts,gs?.dbContracts,myTeamId,year]
  );

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
      const overallView=driverOverallPresentation(gs,driver);
      return {
        ...slot,
        contract,
        id,
        driver,
        name:driver.display_name||driver.name||pick(contract,["driver_name","name"],id),
        overall:overallView.estimated?`~${overallView.value}`:overallView.value,
        salary:Number(pick(contract,["salary","salary_yearly"],0))||0,
        until:pick(contract,["contract_until_year","contract_until","end_year","end_date"],"—"),
      };
    });
  },[activeTeamContracts,driverById,gs]);

  const main=slotRows.find((row)=>row.key==="main");
  const second=slotRows.find((row)=>row.key==="second");
  const canSwap=Boolean(main?.contract&&second?.contract);

  function submitRenewal(offer){
    if(!renewingRow)return;
    const next=startDriverRenewal(gs,{
      driverId:renewingRow.id,
      teamId:myTeamId,
      teamName:myTeamName,
      offer:{...offer,role:renewingRow.label},
      origin:"player",
    });
    setGameState(next);
    setRenewingRow(null);
  }

  function releaseDriver(row){
    if(!row?.contract)return;
    const cost=terminationCost(gs,row.contract);
    const ok=window.confirm(
      "Release "+row.name+"?\n\nContract termination cost: "+money(cost)+
      "\n\nThis immediately opens the "+row.label+" seat."
    );
    if(!ok)return;
    setGameState(releaseDriverContract(gs,row.id));
  }

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
          <div
            key={row.key}
            className="bg-white rounded-xl shadow p-4 border border-transparent"
          >
            <button
              type="button"
              data-entity="driver"
              data-id={row.id}
              className="w-full text-left hover:opacity-90"
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
            <div className="mt-4 pt-3 border-t flex flex-wrap items-center gap-2">
              {activeRenewalByDriver.has(String(row.id))?(
                <span className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-700">
                  Renewal negotiation pending
                </span>
              ):(
                <button
                  type="button"
                  className="border rounded-md px-3 py-1.5 text-xs hover:bg-gray-50"
                  onClick={()=>setRenewingRow(row)}
                >
                  Renew contract
                </button>
              )}
              <button
                type="button"
                className="border border-red-200 text-red-700 rounded-md px-3 py-1.5 text-xs hover:bg-red-50"
                onClick={()=>releaseDriver(row)}
              >
                Release · {money(terminationCost(gs,row.contract))}
              </button>
            </div>
          </div>
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

      {renewingRow&&(
        <ContractNegotiationModal
          driver={renewingRow.driver}
          roles={[renewingRow.label]}
          expectedSalary={expectedDriverSalary(gs,renewingRow.id)}
          onClose={()=>setRenewingRow(null)}
          onSubmit={submitRenewal}
        />
      )}
    </div>
  );
}

function Info({label,value}){
  return <div><div className="text-xs text-gray-500">{label}</div><div className="font-medium">{value??"—"}</div></div>;
}
