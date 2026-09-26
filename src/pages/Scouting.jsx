import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useGame } from "@/state/GameStore";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DriverPortrait, TeamLogo, flagFromCountry } from "@/components/entity/EntityVisuals.jsx";
import { driverKnowledgeState, presentDriverKnowledgeValue } from "@/domain/driverKnowledge.js";
import { specificScoutingPlan } from "@/domain/scoutingPolicy.js";

const DAY = 86_400_000;
const unbox = (v) => v && typeof v === "object" && !Array.isArray(v)
  ? (v.result ?? v.value ?? null)
  : v;
const pick = (o, keys, fb = undefined) => {
  for (const k of keys) {
    const v = unbox(o?.[k]);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return fb;
};
const idOf = (o) => String(pick(o, ["driver_id","person_id","id"], ""));
const fmtMoney = (n) => new Intl.NumberFormat("en-GB", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
}).format(Number(n || 0));
const nice = (s) => String(s || "").replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());

function parseISO(value) {
  const [y,m,d] = String(value || "").slice(0,10).split("-").map(Number);
  return new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1));
}
function addDaysISO(value, days) {
  const d = parseISO(value);
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0,10);
}
function daysBetween(a,b) {
  return Math.max(0, Math.ceil((+parseISO(b) - +parseISO(a)) / DAY));
}
function progress(a,b,n) {
  if (!a || !b || !n) return 0;
  const x = +parseISO(a), y = +parseISO(b), z = +parseISO(n);
  return y <= x ? 1 : Math.max(0, Math.min(1, (z - x) / (y - x)));
}
function countryKey(value) {
  const raw = String(value || "").trim().toLowerCase();
  const aliases = {
    "uk":"united kingdom", "great britain":"united kingdom", "england":"united kingdom",
    "usa":"united states", "united states of america":"united states",
    "brasil":"brazil", "deutschland":"germany",
  };
  return aliases[raw] || raw;
}
function zoneCountries(zone) {
  const arr = Array.isArray(zone?.countries)
    ? zone.countries
    : String(zone?.countries_csv || "").split(",").map((x) => x.trim()).filter(Boolean);
  return new Set(arr.map(countryKey));
}
function driverCountry(driver) {
  return pick(driver, ["country_name","nationality","country"], "");
}
function simpleHash(text) {
  let h = 2166136261;
  for (const ch of String(text || "")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h >>> 0);
}

export default function Scouting() {
  const [searchParams] = useSearchParams();
  const requestedDriverId=String(searchParams.get("driver")||"");
  const gameState = useGame((s) => s.gameState);
  const setGameState = useGame((s) => s.setGameState);

  const date = String(gameState?.currentDateISO || "").slice(0,10);
  const year=Number(gameState?.activeYear)||Number(date.slice(0,4))||1980;
  const teamId=String(gameState?.team?.team_id??gameState?.team?.id??"");
  const teamName=gameState?.team?.team_name||gameState?.team?.name||"My Team";
  const scouting = gameState?.scouting || {};
  const assignments = Array.isArray(scouting.assignments) ? scouting.assignments : [];
  const shortlist = Array.isArray(scouting.shortlist) ? scouting.shortlist.map(String) : [];
  const zones = Array.isArray(gameState?.dbScoutingZones) ? gameState.dbScoutingZones : [];
  const drivers = useMemo(()=>{
    const map=new Map();
    for(const row of gameState?.dbDrivers||[]) if(idOf(row)) map.set(idOf(row),row);
    for(const row of gameState?.drivers||[]) if(idOf(row)) map.set(idOf(row),{...(map.get(idOf(row))||{}),...row});
    return [...map.values()];
  },[gameState?.drivers,gameState?.dbDrivers]);
  const ratings = useMemo(()=>{
    const map=new Map();
    for(const row of gameState?.dbDriverRatings||[]) if(idOf(row)) map.set(idOf(row),row);
    for(const row of gameState?.driverRatings||[]) if(idOf(row)) map.set(idOf(row),{...(map.get(idOf(row))||{}),...row});
    return [...map.values()];
  },[gameState?.driverRatings,gameState?.dbDriverRatings]);
  const staffContracts = Array.isArray(gameState?.staffContracts)&&gameState.staffContracts.length ? gameState.staffContracts : (gameState?.dbStaffContracts||[]);
  const staffCore = Array.isArray(gameState?.staffCore)&&gameState.staffCore.length ? gameState.staffCore : (gameState?.dbStaffCore||[]);
  const staffRatings = Array.isArray(gameState?.staffRatings)&&gameState.staffRatings.length ? gameState.staffRatings : (gameState?.dbStaffRatings||[]);

  const [tab,setTab] = useState("assignments");
  const [showStart,setShowStart] = useState(false);
  const [mode,setMode] = useState("driver");
  const [target,setTarget] = useState("");
  const [zoneId,setZoneId] = useState("");
  const [depth,setDepth] = useState("light");
  const [q,setQ] = useState("");

  const ratingById = useMemo(() => new Map(ratings.map((r) => [idOf(r), r])), [ratings]);
  const driverById = useMemo(() => new Map(drivers.map((d) => [idOf(d), d])), [drivers]);

  const allProspects = useMemo(() => drivers
    .filter((d) => Boolean(d?.active_lower_series))
    .filter((d) => ["junior_only","lower_series"].includes(String(d?.status || "")))
    .filter((d) => {
      const age=Number(d?.age);
      return Number.isFinite(age) && age >= 16 && age <= 24;
    })
    .sort((a,b) => String(a?.display_name||a?.name||"").localeCompare(String(b?.display_name||b?.name||""))), [drivers]);

  const prospects = useMemo(() => allProspects.filter((d) => {
    if (!q) return true;
    return [d.display_name,d.name,driverCountry(d)]
      .some((v) => String(v || "").toLowerCase().includes(q.toLowerCase()));
  }), [allProspects, q]);

  const specificScoutCandidates = useMemo(() => drivers
    .filter((d) => !["hidden","deceased","retired"].includes(String(d?.status || "").toLowerCase()))
    .filter((d) => !["own","academy"].includes(driverKnowledgeState(gameState,d).level))
    .sort((a,b) => String(a?.display_name||a?.name||"").localeCompare(String(b?.display_name||b?.name||""))),
  [drivers,gameState]);

  const zoneForDriver = (driver) => {
    const key = countryKey(driverCountry(driver));
    return zones.find((z) => zoneCountries(z).has(key)) || {
      zone_id:"zone_other",
      name:"Other Markets",
      cost_per_week:18000,
      talent_boost:0.85,
      travel_time_days:8,
      countries:[],
    };
  };

  const selectedDriver = target ? driverById.get(String(target)) : null;
  const effectiveZone = mode === "driver"
    ? (selectedDriver ? zoneForDriver(selectedDriver) : null)
    : zones.find((z) => String(z.zone_id) === String(zoneId)) || null;

  useEffect(() => {
    if(!requestedDriverId)return;
    const requested=driverById.get(requestedDriverId);
    if(!requested)return;
    setMode("driver");
    setTarget(requestedDriverId);
    setShowStart(true);
    setTab("assignments");
  }, [requestedDriverId,driverById]);

  const scoutingNetworkQuality=useMemo(()=>{
    const coreById=new Map(staffCore.map((s)=>[String(s?.staff_id??s?.id??""),s]));
    const rows=staffContracts
      .filter((row)=>String(unbox(row?.team_id)??"")===teamId)
      .filter((row)=>/scout|manager|principal|technical/i.test(String(row?.role||"")))
      .map((row)=>{
        const sid=String(unbox(row?.staff_id)??"");
        const candidates=staffRatings.filter((r)=>String(unbox(r?.staff_id)??"")===sid);
        const rating=candidates.find((r)=>Number(unbox(r?.year??r?.season_year))===year)
          ||candidates.filter((r)=>Number(unbox(r?.year??r?.season_year))<=year)
            .sort((a,b)=>Number(unbox(b?.year??b?.season_year)||0)-Number(unbox(a?.year??a?.season_year)||0))[0]
          ||candidates[0]||{};
        const nums=["data_analysis","communication","negotiation","technical"]
          .map((key)=>Number(rating?.[key])).filter(Number.isFinite);
        return {
          id:sid,
          name:coreById.get(sid)?.staff_name||row?.staff_name||sid,
          role:nice(row?.role||"Staff"),
          rating:nums.length?nums.reduce((a,b)=>a+b,0)/nums.length:null,
        };
      });
    const known=rows.map((row)=>row.rating).filter(Number.isFinite);
    return {
      members:rows,
      quality:known.length?Math.round(known.reduce((a,b)=>a+b,0)/known.length):55,
    };
  },[staffContracts,staffCore,staffRatings,teamId,year]);

  const weeklyCost = Number(effectiveZone?.cost_per_week || 0);
  const regionalBaseDuration = effectiveZone
    ? Number(effectiveZone.travel_time_days || 0) + 21
    : 0;
  const networkDurationFactor=Math.max(0.72,Math.min(1.18,1.15-(scoutingNetworkQuality.quality-50)*0.006));
  const specificPlan=mode==="driver"&&selectedDriver&&effectiveZone
    ?specificScoutingPlan(gameState,selectedDriver,{
      depth,
      travelDays:Number(effectiveZone.travel_time_days||0),
      networkQuality:scoutingNetworkQuality.quality,
      weeklyCost,
    })
    :null;
  const duration=mode==="driver"
    ?Number(specificPlan?.duration||0)
    :(regionalBaseDuration?Math.max(3,Math.round(regionalBaseDuration*networkDurationFactor)):0);
  const cost=mode==="driver"
    ?Number(specificPlan?.cost||0)
    :(effectiveZone?Math.round(Math.ceil(duration/7)*weeklyCost*1.25):0);
  const budget = Number(gameState?.team?.budget ?? gameState?.finances?.balance ?? 0);

  const discoverForRegion = (zone, assignmentId) => {
    if (!zone) return [];
    const countries = zoneCountries(zone);
    const eligible = allProspects.filter((d) => countries.has(countryKey(driverCountry(d))));
    const qualityFactor=0.75+scoutingNetworkQuality.quality/100*0.55;
    const amount = Math.max(2, Math.min(7, Math.round(3 * Number(zone?.talent_boost || 1) * qualityFactor)));
    return eligible
      .map((d) => {
        const r = ratingById.get(idOf(d)) || {};
        const potential = Number(pick(r,["potential_ability","potential","current_ability"],50));
        const jitter = (simpleHash(`${assignmentId}:${idOf(d)}`) % 1600) / 100;
        return { id:idOf(d), score:potential + jitter };
      })
      .sort((a,b) => b.score - a.score)
      .slice(0, amount)
      .map((x) => x.id);
  };

  useEffect(() => {
    if (!date || !assignments.some((a) => a.status === "active" && a.finishes_at && a.finishes_at <= date)) return;
    const next = assignments.map((a) => {
      if (a.status !== "active" || !a.finishes_at || a.finishes_at > date) return a;
      if (a.mode === "region") {
        const zone = zones.find((z) => String(z.zone_id) === String(a.zone_id));
        return {
          ...a,
          status:"completed",
          completed_at:date,
          discovered_ids:discoverForRegion(zone, a.id),
        };
      }
      return { ...a, status:"completed", completed_at:date };
    });
    setGameState({scouting:{...scouting, assignments:next, shortlist}});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const scouts = useMemo(() => {
    const myTeam = String(gameState?.team?.team_id ?? gameState?.team?.id ?? "");
    const coreById = new Map(staffCore.map((s) => [String(s?.staff_id ?? s?.id ?? ""), s]));
    const ratingForStaff=(id)=>{
      const rows=staffRatings.filter((r)=>String(unbox(r?.staff_id)??"")===String(id));
      return rows.find((r)=>Number(unbox(r?.year??r?.season_year))===year)
        || rows.filter((r)=>Number(unbox(r?.year??r?.season_year))<=year)
          .sort((a,b)=>Number(unbox(b?.year??b?.season_year)||0)-Number(unbox(a?.year??a?.season_year)||0))[0]
        || rows[0]
        || {};
    };
    return staffContracts
      .filter((c) => String(unbox(c?.team_id) ?? "") === myTeam)
      .filter((c) => /scout|manager|principal|technical/i.test(String(c?.role || "")))
      .map((c) => {
        const id = String(unbox(c?.staff_id) ?? "");
        const core = coreById.get(id) || {};
        const rt = ratingForStaff(id);
        const nums = ["data_analysis","communication","negotiation","technical"]
          .map((k) => Number(rt?.[k])).filter(Number.isFinite);
        return {
          id,
          name:core.staff_name || c.staff_name || id,
          rating:nums.length ? Math.round(nums.reduce((a,b)=>a+b,0)/nums.length) : "—",
          role:nice(c.role || "Staff"),
        };
      });
  }, [staffContracts,staffCore,staffRatings,gameState?.team,year]);

  const startAssignment = () => {
    if (!date || !effectiveZone || !duration || budget < cost) return;
    if (mode === "driver" && !selectedDriver) return;

    const title = mode === "driver"
      ? `${depth==="deep"?"Deep":"Light"} report: ${selectedDriver.display_name || selectedDriver.name}`
      : `Regional search: ${effectiveZone.name}`;

    const a = {
      id:`scout_${Date.now()}`,
      mode,
      depth:mode==="driver"?depth:null,
      title,
      prospect_id:mode === "driver" ? idOf(selectedDriver) : null,
      zone_id:String(effectiveZone.zone_id),
      region:effectiveZone.name,
      status:"active",
      started_at:date,
      finishes_at:addDaysISO(date,duration),
      duration_days:duration,
      cost,
      network_quality:scoutingNetworkQuality.quality,
    };

    applyExpense(cost, `Scouting — ${title}`);
    setGameState({scouting:{...scouting, assignments:[...assignments,a], shortlist}});
    setShowStart(false);
    setTarget("");
  };

  const patchAssignment = (id, patch) => {
    setGameState({
      scouting:{
        ...scouting,
        assignments:assignments.map((a) => a.id === id ? {...a,...patch} : a),
        shortlist,
      },
    });
  };

  const pauseResume = (a) => {
    if (a.status === "paused") {
      patchAssignment(a.id, {
        status:"active",
        started_at:date,
        finishes_at:addDaysISO(date, Number(a.remaining_days || 7)),
        remaining_days:null,
      });
    } else {
      patchAssignment(a.id, {
        status:"paused",
        remaining_days:daysBetween(date,a.finishes_at),
        paused_at:date,
      });
    }
  };
  const cancel = (a) => patchAssignment(a.id,{status:"cancelled",cancelled_at:date});

  const toggleShortlist = (id) => {
    const sid = String(id);
    const next = shortlist.includes(sid)
      ? shortlist.filter((x) => x !== sid)
      : [...shortlist,sid];
    setGameState({scouting:{...scouting, assignments, shortlist:next}});
  };

  function applyExpense(amount, desc) {
    const value = Math.abs(Number(amount || 0));
    const oldBudget = Number(gameState?.team?.budget ?? gameState?.finances?.balance ?? 0);
    const oldBalance = Number(gameState?.finances?.balance ?? oldBudget);
    setGameState({
      team:{...(gameState?.team || {}),budget:oldBudget - value},
      finances:{
        ...(gameState?.finances || {}),
        budget:oldBudget - value,
        balance:oldBalance - value,
        season_spend:Number(gameState?.finances?.season_spend || 0) + value,
      },
      financeLog:[
        ...(gameState?.financeLog || []),
        {id:`tx_scout_${Date.now()}`,dateISO:date,type:"expense",category:"Scouting",desc,amount:-value},
      ],
    });
  }

  return (
    <div className="-mx-3 -my-4 md:-mx-5 md:-my-5 min-h-[calc(100vh-4rem)] bg-[#090b10] text-slate-100 p-4 md:p-6 space-y-4">
      <div className="rounded-xl border border-white/10 bg-[#12141c] p-2.5 flex flex-wrap items-center gap-2.5">
        <TeamLogo teamId={teamId} name={teamName} size="h-10 w-10" className="p-0.5"/>
        <div className="flex-1" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
          <Mini label="Active" value={assignments.filter((a)=>a.status==="active").length}/>
          <Mini label="Shortlist" value={shortlist.length}/>
          <Mini label="Prospects" value={allProspects.length}/>
          <Mini label="Budget" value={fmtMoney(budget)}/>
        </div>
        <Button onClick={() => setShowStart((v) => !v)}>{showStart ? "Close" : "Start Assignment"}</Button>
      </div>

      {showStart && (
        <Card className="!bg-[#12141c] !border-white/10 !text-slate-100"><CardContent className="p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="mr-2 font-semibold">New scouting assignment</div>
            <Button size="sm" variant={mode==="driver"?"default":"outline"} onClick={()=>{setMode("driver");setZoneId("");}}>Specific Driver</Button>
            <Button size="sm" variant={mode==="region"?"default":"outline"} onClick={()=>{setMode("region");setTarget("");if(!zoneId&&zones[0])setZoneId(String(zones[0].zone_id));}}>Explore Region</Button>
          </div>

          {mode === "driver" ? (
            <label className="text-sm block">
              Driver
              <select className="mt-1 border border-white/10 bg-[#191c26] text-slate-100 rounded px-2.5 py-1.5 w-full" value={target} onChange={(e)=>setTarget(e.target.value)}>
                <option value="">Select driver…</option>
                {specificScoutCandidates.map((d)=><option key={idOf(d)} value={idOf(d)}>{d.display_name || d.name} · {driverCountry(d) || "Unknown"}</option>)}
              </select>
            </label>
          ) : (
            <label className="text-sm block">
              Region
              <select className="mt-1 border border-white/10 bg-[#191c26] text-slate-100 rounded px-2.5 py-1.5 w-full" value={zoneId} onChange={(e)=>setZoneId(e.target.value)}>
                {zones.map((z)=><option key={z.zone_id} value={z.zone_id}>{z.name}</option>)}
              </select>
            </label>
          )}

          {mode==="driver"&&selectedDriver&&(
            <div className="rounded-lg border border-white/10 bg-[#171a23] p-2.5">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Report depth</div>
              <div className="grid gap-1.5 md:grid-cols-2">
                <button type="button" onClick={()=>setDepth("light")} className={`rounded-md border px-2.5 py-2 text-left ${depth==="light"?"border-sky-400/60 bg-sky-400/10":"border-white/10 bg-black/10"}`}>
                  <div className="text-sm font-semibold">Light scouting</div>
                  <div className="mt-0.5 text-[11px] leading-tight text-slate-400">Faster/cheaper · narrows Overall and attribute ranges.</div>
                </button>
                <button type="button" onClick={()=>setDepth("deep")} className={`rounded-md border px-2.5 py-2 text-left ${depth==="deep"?"border-emerald-400/60 bg-emerald-400/10":"border-white/10 bg-black/10"}`}>
                  <div className="text-sm font-semibold">Deep scouting</div>
                  <div className="mt-0.5 text-[11px] leading-tight text-slate-400">Longer/full · exact current ratings and full potential assessment.</div>
                </button>
              </div>
              {specificPlan?<div className="mt-1.5 text-[11px] text-slate-500">
                Familiarity {Math.round(specificPlan.familiarity.score)}/100 · Reputation {Math.round(specificPlan.familiarity.reputation)} · F1 starts {specificPlan.familiarity.starts}. Known drivers are quicker to scout.
              </div>:null}
            </div>
          )}

          {effectiveZone && (
            <div className="rounded-lg border border-white/10 bg-[#171a23] p-2 text-sm grid grid-cols-2 md:grid-cols-4 gap-1.5">
              <Mini label="Area" value={effectiveZone.name}/>
              <Mini label="Duration" value={`${duration} days`}/>
              <Mini label="Cost" value={fmtMoney(cost)}/>
              <Mini label="ETA" value={date ? addDaysISO(date,duration) : "—"}/>
            </div>
          )}

          {mode === "region" && effectiveZone && (
            <div className="text-xs text-slate-400">
              Countries covered: {Array.from(zoneCountries(effectiveZone)).join(", ") || "—"}.
              A regional search can discover several active lower-series drivers. Completion unlocks estimate ranges; a specific driver report is required for exact ratings.
            </div>
          )}

          <Button
            size="sm"
            disabled={!effectiveZone || (mode==="driver"&&!selectedDriver) || budget < cost}
            onClick={startAssignment}
          >
            Start Scouting
          </Button>
        </CardContent></Card>
      )}

      <div className="flex flex-wrap gap-2">
        {[
          ["assignments","Assignments"],["prospects","Prospects"],["shortlist","Shortlist"],["scouts","Network"]
        ].map(([k,label])=>
          <Button key={k} variant={tab===k?"default":"outline"} onClick={()=>setTab(k)}>{label}</Button>
        )}
      </div>

      {tab === "assignments" && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {[...assignments].reverse().map((a) => {
            const pct = a.status === "completed"
              ? 1
              : a.status === "paused"
                ? Number(a.progress || progress(a.started_at,a.finishes_at,a.paused_at || date))
                : progress(a.started_at,a.finishes_at,date);
            const d = a.prospect_id ? driverById.get(String(a.prospect_id)) : null;
            const discovered = Array.isArray(a.discovered_ids)
              ? a.discovered_ids.map((id)=>driverById.get(String(id))).filter(Boolean)
              : [];
            return (
              <Card className="!bg-[#12141c] !border-white/10 !text-slate-100" key={a.id}><CardContent className="p-4 space-y-3">
                <div className="flex justify-between gap-2">
                  <div>
                    <div className="text-xs text-slate-400">{a.region} · {a.mode === "region" ? "Regional search" : "Driver report"}</div>
                    <div className="font-semibold">{a.title}</div>
                  </div>
                  <span className="text-xs bg-white/10 px-2 py-1 rounded h-fit">{nice(a.status)}</span>
                </div>

                <div>
                  <div className="flex justify-between text-sm"><span>Progress</span><strong>{Math.round(pct*100)}%</strong></div>
                  <div className="h-2 bg-white/10 rounded overflow-hidden mt-1"><div className="h-full bg-slate-800" style={{width:`${pct*100}%`}}/></div>
                </div>

                <div className="text-xs text-slate-400">{a.started_at} → {a.finishes_at} · {fmtMoney(a.cost)}</div>

                {a.status === "completed" && d && (
                  <div className="text-sm">
                    Report completed for <button data-entity="driver" data-id={idOf(d)} className="font-medium hover:underline">{d.display_name || d.name}</button>.
                  </div>
                )}

                {a.status === "completed" && a.mode === "region" && (
                  <div>
                    <div className="text-xs text-slate-400 mb-2">Drivers discovered</div>
                    {discovered.length ? (
                      <div className="flex flex-wrap gap-2">
                        {discovered.map((x)=><button key={idOf(x)} data-entity="driver" data-id={idOf(x)} className="text-xs border rounded px-2 py-1 hover:bg-[#171a23] text-slate-300">{x.display_name || x.name}</button>)}
                      </div>
                    ) : <div className="text-sm text-slate-400">No suitable drivers were found in this search.</div>}
                  </div>
                )}

                {["active","paused"].includes(a.status) && (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={()=>pauseResume(a)}>{a.status==="paused"?"Resume":"Pause"}</Button>
                    <Button size="sm" variant="darkOutline" onClick={()=>cancel(a)}>Cancel</Button>
                  </div>
                )}
              </CardContent></Card>
            );
          })}
          {!assignments.length && <Card className="!bg-[#12141c] !border-white/10 !text-slate-100"><CardContent className="p-5 text-sm text-slate-400">No scouting assignments yet.</CardContent></Card>}
        </div>
      )}

      {(tab === "prospects" || tab === "shortlist") && (
        <>
          <Card className="!bg-[#12141c] !border-white/10 !text-slate-100"><CardContent className="p-4">
            <input className="border border-white/10 bg-[#191c26] text-slate-100 rounded px-3 py-2 w-full" value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Search active lower-series driver or nationality…"/>
          </CardContent></Card>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {(tab==="shortlist" ? prospects.filter((d)=>shortlist.includes(idOf(d))) : prospects).map((d) => {
              const id = idOf(d);
              const rt = ratingById.get(id) || {};
              const knowledge = driverKnowledgeState(gameState,d);
              const ability = presentDriverKnowledgeValue(
                knowledge,
                "current_ability",
                pick(rt,["current_ability","overall","pace"],pick(d,["overall","current_ability"],NaN)),
                {kind:"ability"}
              );
              const potential = presentDriverKnowledgeValue(
                knowledge,
                "potential_ability",
                pick(rt,["potential_ability","potential"],pick(d,["potential","potential_ability"],NaN)),
                {kind:"potential"}
              );
              const active = assignments.some((a)=>String(a.prospect_id||"")===id && ["active","paused"].includes(a.status));
              return (
                <Card className="!bg-[#12141c] !border-white/10 !text-slate-100" key={id}><CardContent className="p-4 space-y-3">
                  <button type="button" data-entity="driver" data-id={id} className="flex items-center gap-3 w-full text-left hover:underline">
                    <DriverPortrait driver={d} size="h-14 w-14"/>
                    <div>
                      <div className="font-semibold">{d.display_name || d.name}</div>
                      <div className="text-xs text-slate-400">
                        {flagFromCountry(driverCountry(d),d.country_code)} {driverCountry(d) || "—"} · Age {Number.isFinite(Number(d.age)) ? d.age : "—"}
                      </div>
                    </div>
                  </button>

                  <div className="grid grid-cols-2 gap-2">
                    <Mini label="Ability" value={ability.label}/>
                    <Mini label="Potential" value={potential.label}/>
                  </div>
                  <div className="text-[10px] uppercase tracking-wide text-sky-300">{knowledge.label}</div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={active}
                      onClick={()=>{setMode("driver");setTarget(id);setShowStart(true);setTab("assignments");}}
                    >
                      {active ? "Scouting…" : knowledge.level==="scouted" ? "Refresh Report" : "Request Full Report"}
                    </Button>
                    <Button size="sm" variant="darkOutline" onClick={()=>toggleShortlist(id)}>
                      {shortlist.includes(id) ? "Remove Shortlist" : "Add Shortlist"}
                    </Button>
                  </div>
                </CardContent></Card>
              );
            })}
            {(tab==="shortlist" ? !prospects.some((d)=>shortlist.includes(idOf(d))) : !prospects.length) && (
              <Card className="!bg-[#12141c] !border-white/10 !text-slate-100"><CardContent className="p-5 text-sm text-slate-400">
                {tab==="shortlist" ? "Shortlist is empty." : "No active lower-series drivers are available in the current dataset for this season."}
              </CardContent></Card>
            )}
          </div>
        </>
      )}

      {tab === "scouts" && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-3">
          <Card className="!bg-[#12141c] !border-white/10 !text-slate-100 xl:col-span-4"><CardContent className="p-4">
            <div className="text-xs uppercase tracking-wide text-slate-500">Scouting Network</div>
            <div className="text-3xl font-bold mt-1">{scoutingNetworkQuality.quality}/100</div>
            <p className="text-sm text-slate-400 mt-2">Network quality now changes assignment duration and how many prospects a regional search can uncover.</p>
            <div className="mt-3 text-xs text-slate-500">Current assignment duration multiplier: ×{networkDurationFactor.toFixed(2)}</div>
          </CardContent></Card>
          <div className="xl:col-span-8 grid grid-cols-1 md:grid-cols-2 gap-3">
            {scoutingNetworkQuality.members.map((s)=><Card className="!bg-[#12141c] !border-white/10 !text-slate-100" key={s.id}><CardContent className="p-4"><div className="font-semibold">{s.name}</div><div className="text-sm text-slate-400">{s.role}</div><div className="mt-2 text-sm">Network contribution: <strong>{Number.isFinite(s.rating)?Math.round(s.rating):"No rating data"}</strong></div></CardContent></Card>)}
            {!scoutingNetworkQuality.members.length && <Card className="!bg-[#12141c] !border-white/10 !text-slate-100"><CardContent className="p-5"><div className="font-semibold">General Team Network</div><p className="text-sm text-slate-400 mt-1">No dedicated scout role exists in the historical staff data. The team therefore operates with a neutral network rating of 55/100.</p></CardContent></Card>}
          </div>
        </div>
      )}
    </div>
  );
}

function Mini({label,value}) {
  const safe = value && typeof value === "object" ? "—" : (value ?? "—");
  return <div className="border border-white/10 rounded p-2"><div className="text-[10px] text-slate-400">{label}</div><div className="font-medium">{safe}</div></div>;
}
