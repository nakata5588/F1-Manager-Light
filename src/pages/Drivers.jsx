import React, { useMemo, useState } from "react";
import { useGame } from "../state/GameStore.js";
import { ageOn } from "../utils/date.js";
import { DriverPortrait, flagFromCountry } from "../components/entity/EntityVisuals.jsx";
import ContractNegotiationModal from "../components/drivers/ContractNegotiationModal.jsx";
import { expectedDriverSalary } from "../domain/driverContracts.js";
import { openingMarketLabel } from "../domain/driverOpeningState.js";
import { contractRoleLabel, isDriverContract } from "../domain/contractRoles.js";
import { driverOverallPresentation } from "../domain/driverMarketEvaluation.js";
import { driverKnowledgeState, presentDriverKnowledgeValue } from "../domain/driverKnowledge.js";
import {
  acceptCounterOffer,
  acceptTransferCounter,
  driverNegotiationEligibility,
  driverNegotiations,
  driverTransferApproaches,
  isTransferApproachActive,
  negotiationStatusBuckets,
  startDriverNegotiation,
  withdrawNegotiation,
  withdrawTransferApproach,
} from "../engine/NegotiationEngine.js";

const idOf=(o)=>String(o?.driver_id??o?.person_id??o?.id??"");
const unbox=(v)=>v&&typeof v==="object"&&!Array.isArray(v)?(v.result??v.value??v):v;
const pick=(o,keys,fb=undefined)=>{for(const k of keys){const v=unbox(o?.[k]);if(v!==undefined&&v!==null&&v!=="")return v;}return fb;};
const teamIdOf=(o)=>String(pick(o,["team_id","constructor_id","team","constructor"],""));
const nameOf=(d)=>d?.display_name||d?.name||d?.driver_name||`${d?.first_name??""} ${d?.last_name??""}`.trim()||idOf(d)||"—";
const money=(value)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(Number(value)||0);
const statusClass=(status)=>{
  if(status==="accepted")return "bg-green-100 text-green-800";
  if(status==="countered")return "bg-amber-100 text-amber-800";
  if(status==="rejected"||status==="signed_elsewhere")return "bg-red-100 text-red-800";
  if(status==="withdrawn")return "bg-gray-100 text-gray-600";
  return "bg-blue-100 text-blue-800";
};

function marketStatus(driver, contract, pending, activeYear){
  if(pending) return "Negotiating";
  if(contract) return "Contracted";
  const openingLabel=openingMarketLabel(driver,activeYear);
  if(openingLabel) return openingLabel;
  const age=Number(driver?.age);
  const lowerSeries=
    driver?.status==="lower_series" ||
    driver?.status==="junior_only" ||
    driver?.active_lower_series===true;
  if(lowerSeries){
    if(Number.isFinite(age)&&age<=19) return "Youth";
    return "Lower Series";
  }
  if(driver?.canHireF1 || driver?.status==="eligible") return "Free";
  return "Available";
}

export default function Drivers(){
  const gs=useGame(s=>s.gameState);
  const setGameState=useGame(s=>s.setGameState);
  const drivers=Array.isArray(gs?.drivers)?gs.drivers:[];
  const contracts=Array.isArray(gs?.contracts)?gs.contracts:[];
  const teams=Array.isArray(gs?.teams)?gs.teams:[];
  const activeYear=Number(gs?.activeYear);
  const userTeamId=String(gs?.team?.team_id??gs?.team?.id??"");
  const userTeamName=gs?.team?.team_name||gs?.team?.name||gs?.team?.short_name||userTeamId;

  const [q,setQ]=useState("");
  const [team,setTeam]=useState("ALL");
  const [status,setStatus]=useState("ALL");
  const [sortKey,setSortKey]=useState("name");
  const [sortDir,setSortDir]=useState("asc");
  const [page,setPage]=useState(1);
  const [negotiatingDriver,setNegotiatingDriver]=useState(null);
  const PAGE_SIZE=16;

  const teamNames=useMemo(()=>new Map(teams.map(t=>[String(t?.team_id??t?.id??""),t?.team_name||t?.name||t?.short_name||"—"])),[teams]);
  const negotiations=driverNegotiations(gs);
  const transferApproaches=driverTransferApproaches(gs);
  const playerTransferApproaches=useMemo(
    ()=>transferApproaches
      .filter((a)=>a.origin==="player"&&String(a.buyer_team_id)===userTeamId)
      .slice()
      .sort((a,b)=>
        String(b.resolved_at||b.responded_at||b.submitted_at||"")
          .localeCompare(String(a.resolved_at||a.responded_at||a.submitted_at||""))
      ),
    [transferApproaches,userTeamId]
  );
  const activePlayerTransferApproaches=useMemo(
    ()=>playerTransferApproaches.filter(isTransferApproachActive),
    [playerTransferApproaches]
  );
  const activeTransferByDriver=useMemo(()=>{
    const map=new Map();
    for(const approach of activePlayerTransferApproaches){
      if(!map.has(String(approach.driver_id)))map.set(String(approach.driver_id),approach);
    }
    return map;
  },[activePlayerTransferApproaches]);
  const playerNegotiations=useMemo(
    ()=>negotiations
      .filter((n)=>n.origin==="player"&&String(n.team_id)===userTeamId)
      .slice()
      .sort((a,b)=>
        String(b.resolved_at||b.responded_at||b.submitted_at||"")
          .localeCompare(String(a.resolved_at||a.responded_at||a.submitted_at||""))
      ),
    [negotiations,userTeamId]
  );
  const negotiationBuckets=useMemo(
    ()=>negotiationStatusBuckets(playerNegotiations),
    [playerNegotiations]
  );
  const activePlayerNegotiations=negotiationBuckets.active;
  const negotiationHistory=negotiationBuckets.history;
  const activePlayerByDriver=useMemo(()=>{
    const map=new Map();
    for(const n of activePlayerNegotiations){
      if(!map.has(String(n.driver_id)))map.set(String(n.driver_id),n);
    }
    return map;
  },[activePlayerNegotiations]);
  const contractById=useMemo(()=>{
    const m=new Map();
    for(const c of contracts){
      const id=idOf(c); if(!id) continue;
      if(!isDriverContract(c)) continue;
      const contractStatus=String(pick(c,["status"],"active")).toLowerCase();
      if(["terminated","expired","released","bought_out","inactive","void"].includes(contractStatus)) continue;
      const y=Number(pick(c,["year","season_year"],activeYear));
      if(Number.isFinite(activeYear)&&Number.isFinite(y)&&y!==activeYear) continue;
      if(!m.has(id)) m.set(id,c);
    }
    return m;
  },[contracts,activeYear]);

  const rows=useMemo(()=>drivers.map(d=>{
    const id=idOf(d), contract=contractById.get(id)||null;
    const pending=activePlayerByDriver.get(id)||activeTransferByDriver.get(id)||null;
    const eligibility=userTeamId
      ?driverNegotiationEligibility(gs,{driverId:id,teamId:userTeamId})
      :{canNegotiate:false,reason:"no_team",roles:[]};
    const tid=teamIdOf(contract)||teamIdOf(d);
    const ms=marketStatus(d,contract,pending,activeYear);
    const overallBase=driverOverallPresentation(gs,d);
    const knowledge=driverKnowledgeState(gs,d);
    const overallView=presentDriverKnowledgeValue(
      knowledge,
      "current_ability",
      overallBase.value,
      {kind:"ability",estimated:overallBase.estimated}
    );
    const role=contract?contractRoleLabel(contract):(pending?.offer?.role||pending?.personal_offer?.role||null);
    const contractSalary=contract?Number(pick(contract,["salary","salary_yearly"],0))||0:0;
    const pendingSalary=pending?Number(pending?.offer?.salary||pending?.personal_offer?.salary||0)||0:0;
    return {
      ...d,id,name:nameOf(d),
      team_id:tid||null,
      team_name:contract?(teamNames.get(tid)||pick(contract,["team_name"],"—")):"—",
      nationality:pick(d,["country_name","nationality","country"],"—"),
      country_code:pick(d,["country_code","nationality_code"],""),
      age:d?.age??ageOn(gs?.currentDateISO,d?.birthdate??d?.dob),
      overall:overallView.label,
      overall_sort:overallView.sortValue,
      overall_visibility:overallView.visibility,
      knowledge,
      role,
      wage:contractSalary||pendingSalary||0,
      wage_source:contractSalary?"contract":(pendingSalary?"offer":null),
      contract_until:contract?pick(contract,["contract_until_year","contract_until","end_year","end_date"],"—"):"—",
      market_status:ms,
      pending,
      can_negotiate:eligibility.canNegotiate,
      negotiation_reason:eligibility.reason,
      negotiation_kind:eligibility.kind||null,
      negotiation_roles:eligibility.roles,
      negotiation_buyout:eligibility.buyout||null,
    };
  }),[drivers,contractById,activePlayerByDriver,activeTransferByDriver,teamNames,gs]);

  const teamOptions=useMemo(()=>["ALL",...Array.from(new Set(rows.map(r=>r.team_name).filter(v=>v&&v!=="—"))).sort()],[rows]);
  const statusOptions=["ALL","Contracted","Negotiating","Free","Academy","Other Series","Prospect","Youth","Lower Series","Team Commitment","Status Review","Retired","Unavailable","Available"];

  const filtered=useMemo(()=>{
    const n=q.trim().toLowerCase();
    return rows.filter(r=>{
      if(n&&![r.name,r.team_name,r.nationality,r.market_status].some(v=>String(v??"").toLowerCase().includes(n))) return false;
      if(team!=="ALL"&&r.team_name!==team) return false;
      if(status!=="ALL"&&r.market_status!==status) return false;
      return true;
    });
  },[rows,q,team,status]);

  const sorted=useMemo(()=>[...filtered].sort((a,b)=>{
    const av=sortKey==="overall"?a.overall_sort:a[sortKey];
    const bv=sortKey==="overall"?b.overall_sort:b[sortKey];
    if(av==null&&bv!=null)return sortDir==="asc"?1:-1;
    if(av!=null&&bv==null)return sortDir==="asc"?-1:1;
    const an=Number(av),bn=Number(bv);
    const cmp=(av!=="—"&&bv!=="—"&&Number.isFinite(an)&&Number.isFinite(bn))?an-bn:String(av??"").localeCompare(String(bv??""),undefined,{numeric:true,sensitivity:"base"});
    return sortDir==="asc"?cmp:-cmp;
  }),[filtered,sortKey,sortDir]);

  const pages=Math.max(1,Math.ceil(sorted.length/PAGE_SIZE));
  const p=Math.min(page,pages);
  const paged=sorted.slice((p-1)*PAGE_SIZE,p*PAGE_SIZE);

  const headers=[
    ["name","Driver"],["team_name","Team"],["nationality","Nationality"],["market_status","Status"],
    ["age","Age"],["overall","Overall"],["wage","Wage"],["contract_until","Contract"]
  ];

  const submitNegotiation=(offer)=>{
    if(!negotiatingDriver||!userTeamId)return;
    const next=startDriverNegotiation(gs,{
      driverId:negotiatingDriver.id,
      teamId:userTeamId,
      teamName:userTeamName,
      offer,
      origin:"player",
    });
    setGameState(next);
    setNegotiatingDriver(null);
  };
  const acceptCounter=(id)=>setGameState(acceptCounterOffer(gs,id));
  const withdraw=(id)=>setGameState(withdrawNegotiation(gs,id));
  const acceptTeamCounter=(id)=>setGameState(acceptTransferCounter(gs,id));
  const withdrawTeamApproach=(id)=>setGameState(withdrawTransferApproach(gs,id));

  return <div className="grid gap-4">
    <div className="bg-white rounded-xl shadow p-4">
      <h2 className="text-lg font-semibold">Driver Market</h2>
      <p className="text-sm text-gray-500">Browse the market, approach available drivers and negotiate role, salary and contract length. Offers do not resolve instantly.</p>
      <div className="mt-3 flex flex-col lg:flex-row gap-2">
        <input className="border rounded-md px-3 py-2 text-sm flex-1" placeholder="Search driver/team/nationality/status…" value={q} onChange={e=>{setQ(e.target.value);setPage(1);}}/>
        <button
          className={"border rounded-md px-3 py-2 text-sm " + (status==="Free" ? "bg-slate-900 text-white" : "")}
          onClick={()=>{setStatus(status==="Free"?"ALL":"Free");setPage(1);}}
        >Free Drivers</button>
        <select className="border rounded-md px-3 py-2 text-sm" value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}>{statusOptions.map(v=><option key={v}>{v}</option>)}</select>
        <select className="border rounded-md px-3 py-2 text-sm" value={team} onChange={e=>{setTeam(e.target.value);setPage(1);}}>{teamOptions.map(v=><option key={v}>{v}</option>)}</select>
        <select className="border rounded-md px-3 py-2 text-sm" value={sortKey} onChange={e=>setSortKey(e.target.value)}>{headers.map(([k,l])=><option key={k} value={k}>Sort: {l}</option>)}</select>
        <button className="border rounded-md px-3 py-2 text-sm" onClick={()=>setSortDir(d=>d==="asc"?"desc":"asc")}>{sortDir==="asc"?"Asc ↑":"Desc ↓"}</button>
      </div>
    </div>

    {!!activePlayerTransferApproaches.length&&(
      <div className="bg-white rounded-xl shadow p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h3 className="font-semibold">Team Transfer Talks</h3>
            <p className="text-xs text-gray-500">For contracted drivers without a release clause, the current team must agree a fee before personal terms can be completed.</p>
          </div>
          <span className="text-xs text-gray-500">{activePlayerTransferApproaches.length} active</span>
        </div>
        <div className="grid gap-2">
          {activePlayerTransferApproaches.map((a)=>(
            <div key={a.id} className="border rounded-lg p-3 flex flex-col lg:flex-row lg:items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-medium">{a.driver_name}</div>
                <div className="text-xs text-gray-500">
                  {a.seller_team_name} · offered {money(a.offer_fee)}
                  {a.status==="submitted"&&a.response_date?(" · response by "+a.response_date):""}
                </div>
                {a.status==="countered"&&(
                  <div className="text-sm mt-1">
                    {a.seller_team_name} asks for <strong>{money(a.counter_fee)}</strong>.
                  </div>
                )}
              </div>
              <span className={"px-2 py-1 rounded text-xs font-medium "+statusClass(a.status)}>{String(a.status||"").replaceAll("_"," ")}</span>
              {a.status==="countered"&&(
                <div className="flex gap-2">
                  <button className="rounded px-3 py-1.5 text-xs bg-slate-900 text-white" onClick={()=>acceptTeamCounter(a.id)}>Accept fee</button>
                  <button className="border rounded px-3 py-1.5 text-xs" onClick={()=>withdrawTeamApproach(a.id)}>Withdraw</button>
                </div>
              )}
              {a.status==="submitted"&&(
                <button className="border rounded px-3 py-1.5 text-xs" onClick={()=>withdrawTeamApproach(a.id)}>Withdraw</button>
              )}
            </div>
          ))}
        </div>
      </div>
    )}

    {!!activePlayerNegotiations.length&&(
      <div className="bg-white rounded-xl shadow p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h3 className="font-semibold">Active Negotiations</h3>
            <p className="text-xs text-gray-500">Only submitted offers and counter-offers remain in this view.</p>
          </div>
          <span className="text-xs text-gray-500">{activePlayerNegotiations.length} active</span>
        </div>
        <div className="grid gap-2">
          {activePlayerNegotiations.map((n)=>(
            <div key={n.id} className="border rounded-lg p-3 flex flex-col lg:flex-row lg:items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-medium">{n.driver_name}</div>
                <div className="text-xs text-gray-500">
                  {n.offer?.role} · {money(n.offer?.salary)} · {n.offer?.years} year{Number(n.offer?.years)===1?"":"s"}
                  {n.status==="submitted"&&n.response_date?(" · response by "+n.response_date):""}
                </div>
                {n.status==="countered"&&n.counter_offer&&(
                  <div className="text-sm mt-1">
                    Agent asks for <strong>{money(n.counter_offer.salary)}</strong> · {n.counter_offer.years} year{Number(n.counter_offer.years)===1?"":"s"}
                  </div>
                )}
              </div>
              <span className={"px-2 py-1 rounded text-xs font-medium "+statusClass(n.status)}>{String(n.status||"").replaceAll("_"," ")}</span>
              {n.status==="countered"&&(
                <div className="flex gap-2">
                  <button className="rounded px-3 py-1.5 text-xs bg-slate-900 text-white" onClick={()=>acceptCounter(n.id)}>Accept counter</button>
                  <button className="border rounded px-3 py-1.5 text-xs" onClick={()=>withdraw(n.id)}>Withdraw</button>
                </div>
              )}
              {n.status==="submitted"&&(
                <button className="border rounded px-3 py-1.5 text-xs" onClick={()=>withdraw(n.id)}>Withdraw</button>
              )}
            </div>
          ))}
        </div>
      </div>
    )}

    {!!negotiationHistory.length&&(
      <details className="bg-white rounded-xl shadow p-4">
        <summary className="cursor-pointer select-none flex items-center justify-between gap-3">
          <span className="font-semibold">Negotiation History</span>
          <span className="text-xs text-gray-500">{negotiationHistory.length} completed</span>
        </summary>
        <div className="mt-3 grid gap-2">
          {negotiationHistory.slice(0,20).map((n)=>(
            <div key={n.id} className="border rounded-lg p-3 flex flex-col lg:flex-row lg:items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-medium">{n.driver_name}</div>
                <div className="text-xs text-gray-500">
                  {n.offer?.role} · {money(n.offer?.salary)} · {n.offer?.years} year{Number(n.offer?.years)===1?"":"s"}
                  {(n.resolved_at||n.responded_at)?(" · "+(n.resolved_at||n.responded_at)):""}
                </div>
                {n.resolution_note&&(
                  <div className="text-xs text-gray-500 mt-1">{n.resolution_note}</div>
                )}
              </div>
              <span className={"px-2 py-1 rounded text-xs font-medium "+statusClass(n.status)}>
                {String(n.status||"").replaceAll("_"," ")}
              </span>
            </div>
          ))}
          {negotiationHistory.length>20&&(
            <div className="text-xs text-gray-500">
              Showing the 20 most recent completed negotiations.
            </div>
          )}
        </div>
      </details>
    )}

    <div className="bg-white rounded-xl shadow overflow-x-auto"><table className="min-w-full text-sm">
      <thead className="bg-gray-50"><tr>{headers.map(([k,l])=><th key={k} className="px-4 py-3 text-left cursor-pointer" onClick={()=>{if(sortKey===k)setSortDir(d=>d==="asc"?"desc":"asc");else{setSortKey(k);setSortDir("asc");}}}>{l}{sortKey===k?(sortDir==="asc"?" ↑":" ↓"):""}</th>)}<th className="px-4 py-3 text-right">Action</th></tr></thead>
      <tbody>{paged.map(d=><tr key={d.id} className="border-t hover:bg-gray-50">
        <td className="px-4 py-2"><button type="button" data-entity="driver" data-id={d.id} className="flex items-center gap-3 font-medium hover:underline text-left"><DriverPortrait driver={d} size="h-10 w-10"/><span>{d.name}</span></button></td>
        <td className="px-4 py-2">{d.team_name}</td>
        <td className="px-4 py-2">{flagFromCountry(d.nationality,d.country_code)} {d.nationality}</td>
        <td className="px-4 py-2">
          <div className="flex flex-col items-start gap-1">
            <span className="px-2 py-1 rounded bg-gray-100 text-xs">{d.market_status}</span>
            {d.role&&<span className="text-xs text-gray-500">{d.role}</span>}
          </div>
        </td>
        <td className="px-4 py-2">{d.age??"—"}</td>
        <td className="px-4 py-2">
          <div className="font-semibold" title={d.knowledge?.label||"Driver knowledge"}>{d.overall}</div>
          <div className="text-[10px] text-gray-500">{d.knowledge?.label||"Unscouted"}</div>
        </td>
        <td className="px-4 py-2">
          {d.wage?(
            <span title={d.wage_source==="offer"?"Current negotiation offer":"Current contract wage"}>
              {d.wage_source==="offer"?"Offer ":""}{money(d.wage)}
            </span>
          ):"—"}
        </td>
        <td className="px-4 py-2">{d.contract_until}</td>
        <td className="px-4 py-2 text-right">
          {d.pending?(
            <span className="text-xs text-blue-700">Negotiating</span>
          ):d.can_negotiate?(
            <button
              className="border rounded px-2 py-1 text-xs"
              onClick={()=>setNegotiatingDriver(d)}
              title={d.negotiation_kind==="transfer"&&d.negotiation_buyout
                ?("Transfer buyout: "+money(d.negotiation_buyout.fee))
                :undefined}
            >
              {d.negotiation_kind==="transfer"?"Approach transfer":"Approach"}
            </button>
          ):d.negotiation_reason==="insufficient_buyout_funds"?(
            <span className="text-xs text-gray-500">
              Buyout {money(d.negotiation_buyout?.fee||0)}
            </span>
          ):d.negotiation_reason==="under_contract"?(
            <span className="text-xs text-gray-500">Under contract</span>
          ):d.negotiation_reason==="already_contracted"?(
            <span className="text-xs text-gray-500">Your driver</span>
          ):d.negotiation_reason==="lineup_full"?(
            <span className="text-xs text-gray-500">Line-up full</span>
          ):d.negotiation_reason==="not_f1_eligible"?(
            <span className="text-xs text-gray-500">Not eligible</span>
          ):"—"}
        </td>
      </tr>)}
      {!paged.length&&<tr><td colSpan={headers.length+1} className="px-4 py-6 text-center text-gray-500">No drivers found.</td></tr>}</tbody>
    </table></div>

    <div className="flex items-center justify-between text-sm"><span className="text-gray-600">{sorted.length} results · Page {p}/{pages}</span><div className="flex gap-2"><button className="border rounded px-3 py-1 disabled:opacity-40" disabled={p<=1} onClick={()=>setPage(x=>Math.max(1,x-1))}>Prev</button><button className="border rounded px-3 py-1 disabled:opacity-40" disabled={p>=pages} onClick={()=>setPage(x=>Math.min(pages,x+1))}>Next</button></div></div>

    {negotiatingDriver&&(
      <ContractNegotiationModal
        driver={negotiatingDriver}
        roles={negotiatingDriver.negotiation_roles||[]}
        expectedSalary={expectedDriverSalary(gs,negotiatingDriver.id)}
        contextNote={
          negotiatingDriver.negotiation_kind==="transfer"
            ?("This is a transfer from "+(negotiatingDriver.team_name||"the current team")+
              ". If the driver accepts, "+money(negotiatingDriver.negotiation_buyout?.fee||0)+
              " will be paid as "+(negotiatingDriver.negotiation_buyout?.type==="fixed_clause"?"a release clause.":"buyout compensation."))
            :""
        }
        onClose={()=>setNegotiatingDriver(null)}
        onSubmit={submitNegotiation}
      />
    )}
  </div>;
}
