import React, { useEffect, useMemo, useState } from "react";
import { useGame } from "@/state/GameStore";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DriverPortrait, TeamLogo, flagFromCountry } from "@/components/entity/EntityVisuals.jsx";

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
  const drivers = Array.isArray(gameState?.drivers) ? gameState.drivers : [];
  const ratings = Array.isArray(gameState?.driverRatings) ? gameState.driverRatings : [];
  const staffContracts = Array.isArray(gameState?.staffContracts) ? gameState.staffContracts : [];
  const staffCore = Array.isArray(gameState?.staffCore) ? gameState.staffCore : [];
  const staffRatings = Array.isArray(gameState?.staffRatings) ? gameState.staffRatings : [];

  const [tab,setTab] = useState("assignments");
  const [showStart,setShowStart] = useState(false);
  const [mode,setMode] = useState("driver");
  const [target,setTarget] = useState("");
  const [zoneId,setZoneId] = useState("");
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
    .sort((a,b) => {
      const ar = ratingById.get(idOf(a)) || {};
      const br = ratingById.get(idOf(b)) || {};
      return Number(pick(br,["potential_ability","potential"],0)) -
             Number(pick(ar,["potential_ability","potential"],0));
    }), [drivers, ratingById]);

  const prospects = useMemo(() => allProspects.filter((d) => {
    if (!q) return true;
    return [d.display_name,d.name,driverCountry(d)]
      .some((v) => String(v || "").toLowerCase().includes(q.toLowerCase()));
  }), [allProspects, q]);

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

  const duration = effectiveZone
    ? Number(effectiveZone.travel_time_days || 0) + (mode === "region" ? 21 : 10)
    : 0;
  const weeklyCost = Number(effectiveZone?.cost_per_week || 0);
  const cost = effectiveZone
    ? Math.round(Math.ceil(duration / 7) * weeklyCost * (mode === "region" ? 1.25 : 1))
    : 0;
  const budget = Number(gameState?.team?.budget ?? gameState?.finances?.balance ?? 0);

  const discoverForRegion = (zone, assignmentId) => {
    if (!zone) return [];
    const countries = zoneCountries(zone);
    const eligible = allProspects.filter((d) => countries.has(countryKey(driverCountry(d))));
    const amount = Math.max(2, Math.min(5, Math.round(3 * Number(zone?.talent_boost || 1))));
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
      ? `Driver report: ${selectedDriver.display_name || selectedDriver.name}`
      : `Regional search: ${effectiveZone.name}`;

    const a = {
      id:`scout_${Date.now()}`,
      mode,
      title,
      prospect_id:mode === "driver" ? idOf(selectedDriver) : null,
      zone_id:String(effectiveZone.zone_id),
      region:effectiveZone.name,
      status:"active",
      started_at:date,
      finishes_at:addDaysISO(date,duration),
      duration_days:duration,
      cost,
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

  const hasReport = (driverId) => assignments.some((a) =>
    a.status === "completed" &&
    (
      String(a.prospect_id || "") === String(driverId) ||
      (Array.isArray(a.discovered_ids) && a.discovered_ids.map(String).includes(String(driverId)))
    )
  );

  return (
    <div className="-mx-3 -my-4 md:-mx-5 md:-my-5 min-h-[calc(100vh-4rem)] bg-[#090b10] text-slate-100 p-4 md:p-6 space-y-4">
      <div className="rounded-xl border border-white/10 bg-[#12141c] p-5 flex flex-col lg:flex-row lg:items-center gap-4">
        <TeamLogo teamId={teamId} name={teamName} size="h-14 w-14"/>
        <div>
          <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Recruitment Network</div>
          <h1 className="text-2xl md:text-3xl font-semibold">Scouting</h1>
          <p className="text-sm text-slate-400">
            Scout young drivers aged 16–24 who are active outside F1 in the current season, or explore a region for new talent.
          </p>
        </div>
        <div className="flex-1" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Mini label="Active" value={assignments.filter((a)=>a.status==="active").length}/>
          <Mini label="Shortlist" value={shortlist.length}/>
          <Mini label="Prospects" value={allProspects.length}/>
          <Mini label="Budget" value={fmtMoney(budget)}/>
        </div>
        <Button onClick={() => setShowStart((v) => !v)}>{showStart ? "Close" : "Start Assignment"}</Button>
      </div>

      {showStart && (
        <Card className="bg-[#12141c] border-white/10 text-slate-100"><CardContent className="p-4 space-y-4">
          <div className="font-semibold">New scouting assignment</div>

          <div className="flex flex-wrap gap-2">
            <Button variant={mode==="driver"?"default":"outline"} onClick={()=>{setMode("driver");setZoneId("");}}>Specific Driver</Button>
            <Button variant={mode==="region"?"default":"outline"} onClick={()=>{setMode("region");setTarget("");if(!zoneId&&zones[0])setZoneId(String(zones[0].zone_id));}}>Explore Region</Button>
          </div>

          {mode === "driver" ? (
            <label className="text-sm block">
              Driver
              <select className="mt-1 border border-white/10 bg-[#191c26] text-slate-100 rounded px-3 py-2 w-full" value={target} onChange={(e)=>setTarget(e.target.value)}>
                <option value="">Select active lower-series driver…</option>
                {allProspects.map((d)=><option key={idOf(d)} value={idOf(d)}>{d.display_name || d.name} · {driverCountry(d) || "Unknown"}</option>)}
              </select>
            </label>
          ) : (
            <label className="text-sm block">
              Region
              <select className="mt-1 border border-white/10 bg-[#191c26] text-slate-100 rounded px-3 py-2 w-full" value={zoneId} onChange={(e)=>setZoneId(e.target.value)}>
                {zones.map((z)=><option key={z.zone_id} value={z.zone_id}>{z.name}</option>)}
              </select>
            </label>
          )}

          {effectiveZone && (
            <div className="rounded-lg border border-white/10 bg-[#171a23] p-3 text-sm grid grid-cols-1 md:grid-cols-4 gap-3">
              <Mini label="Area" value={effectiveZone.name}/>
              <Mini label="Duration" value={`${duration} days`}/>
              <Mini label="Cost" value={fmtMoney(cost)}/>
              <Mini label="ETA" value={date ? addDaysISO(date,duration) : "—"}/>
            </div>
          )}

          {mode === "region" && effectiveZone && (
            <div className="text-xs text-slate-400">
              Countries covered: {Array.from(zoneCountries(effectiveZone)).join(", ") || "—"}.
              A regional search can discover several active lower-series drivers; their ratings stay hidden until the assignment finishes.
            </div>
          )}

          <Button
            disabled={!effectiveZone || (mode==="driver"&&!selectedDriver) || budget < cost}
            onClick={startAssignment}
          >
            Start Scouting
          </Button>
        </CardContent></Card>
      )}

      <div className="flex flex-wrap gap-2">
        {["assignments","prospects","shortlist","scouts"].map((k)=>
          <Button key={k} variant={tab===k?"default":"outline"} onClick={()=>setTab(k)}>{nice(k)}</Button>
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
              <Card className="bg-[#12141c] border-white/10 text-slate-100" key={a.id}><CardContent className="p-4 space-y-3">
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
                    <Button size="sm" variant="outline" onClick={()=>cancel(a)}>Cancel</Button>
                  </div>
                )}
              </CardContent></Card>
            );
          })}
          {!assignments.length && <Card className="bg-[#12141c] border-white/10 text-slate-100"><CardContent className="p-5 text-sm text-slate-400">No scouting assignments yet.</CardContent></Card>}
        </div>
      )}

      {(tab === "prospects" || tab === "shortlist") && (
        <>
          <Card className="bg-[#12141c] border-white/10 text-slate-100"><CardContent className="p-4">
            <input className="border border-white/10 bg-[#191c26] text-slate-100 rounded px-3 py-2 w-full" value={q} onChange={(e)=>setQ(e.target.value)} placeholder="Search active lower-series driver or nationality…"/>
          </CardContent></Card>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {(tab==="shortlist" ? prospects.filter((d)=>shortlist.includes(idOf(d))) : prospects).map((d) => {
              const id = idOf(d);
              const rt = ratingById.get(id) || {};
              const known = hasReport(id);
              const active = assignments.some((a)=>String(a.prospect_id||"")===id && ["active","paused"].includes(a.status));
              return (
                <Card className="bg-[#12141c] border-white/10 text-slate-100" key={id}><CardContent className="p-4 space-y-3">
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
                    <Mini label="Ability" value={known ? pick(rt,["current_ability","overall","pace"],"—") : "?"}/>
                    <Mini label="Potential" value={known ? pick(rt,["potential_ability","potential"],"—") : "?"}/>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={active}
                      onClick={()=>{setMode("driver");setTarget(id);setShowStart(true);setTab("assignments");}}
                    >
                      {active ? "Scouting…" : known ? "Refresh Report" : "Request Report"}
                    </Button>
                    <Button size="sm" variant="outline" onClick={()=>toggleShortlist(id)}>
                      {shortlist.includes(id) ? "Remove Shortlist" : "Add Shortlist"}
                    </Button>
                  </div>
                </CardContent></Card>
              );
            })}
            {(tab==="shortlist" ? !prospects.some((d)=>shortlist.includes(idOf(d))) : !prospects.length) && (
              <Card className="bg-[#12141c] border-white/10 text-slate-100"><CardContent className="p-5 text-sm text-slate-400">
                {tab==="shortlist" ? "Shortlist is empty." : "No active lower-series drivers are available in the current dataset for this season."}
              </CardContent></Card>
            )}
          </div>
        </>
      )}

      {tab === "scouts" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {scouts.map((s)=><Card className="bg-[#12141c] border-white/10 text-slate-100" key={s.id}><CardContent className="p-4"><div className="font-semibold">{s.name}</div><div className="text-sm text-slate-400">{s.role}</div><div className="mt-2 text-sm">Scouting effectiveness: <strong>{s.rating}</strong></div></CardContent></Card>)}
          {!scouts.length && <Card className="bg-[#12141c] border-white/10 text-slate-100"><CardContent className="p-5"><div className="font-semibold">Team Scouting Network</div><p className="text-sm text-slate-400 mt-1">No dedicated scout role exists for this team in the current historical staff data, so assignments use the general technical/management network.</p></CardContent></Card>}
        </div>
      )}
    </div>
  );
}

function Mini({label,value}) {
  const safe = value && typeof value === "object" ? "—" : (value ?? "—");
  return <div className="border border-white/10 rounded p-2"><div className="text-[10px] text-slate-400">{label}</div><div className="font-medium">{safe}</div></div>;
}
