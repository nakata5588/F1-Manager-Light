import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { useGame } from "@/state/GameStore";
import { DriverPortrait, TeamLogo, flagFromCountry } from "@/components/entity/EntityVisuals.jsx";
import { driverIdOf, driverLineupSlots } from "@/domain/driverContracts.js";
import { driverRoleLabelForSlot } from "@/domain/contractRoles.js";
import { activeStaffContracts } from "@/domain/liveContracts.js";
import { driverCondition, fatigueStatus } from "@/domain/driverRating.js";
import { driverOverallPresentation } from "@/domain/driverMarketEvaluation.js";
import { carPerformanceRanking, teamCarPerformance } from "@/domain/carPerformance.js";
import { teamEngineeringSupport } from "@/engine/PracticeSetupEngine.js";
import { deriveBoardState } from "@/domain/boardState.js";
import { teamReputation, teamReputationLabel } from "@/domain/teamReputation.js";

const firstArray=(...rows)=>rows.find(Array.isArray)||[];
const unwrap=(v)=>v&&typeof v==="object"&&!Array.isArray(v)?(v.result??v.value??v):v;
const num=(v,fb=0)=>Number.isFinite(Number(unwrap(v)))?Number(unwrap(v)):fb;
const idOf=(o)=>String(unwrap(o?.driver_id??o?.person_id??o?.id??""));
const money=(v)=>Number(v).toLocaleString("en-GB",{style:"currency",currency:"USD",maximumFractionDigits:0});

function Panel({title,action,children,className=""}){
  return <section className={`rounded-xl border border-white/10 bg-[#12141c] shadow-lg overflow-hidden ${className}`}>
    <div className="px-4 py-3 border-b border-white/10 flex items-center gap-3">
      <div className="text-sm font-semibold uppercase tracking-wide">{title}</div>
      <div className="flex-1"/>
      {action}
    </div>
    {children}
  </section>;
}
function Metric({label,value,compact=false}){
  return <div className={"rounded-lg border border-white/10 bg-[#171a23] "+(compact?"px-2 py-1.5":"px-3 py-2")}>
    <div className={(compact?"text-[9px]":"text-[10px]")+" uppercase tracking-wide text-slate-500"}>{label}</div>
    <div className={(compact?"text-xs":"")+" mt-0.5 font-semibold truncate"}>{value??"—"}</div>
  </div>;
}
function QuickLink({to,label,sub}){
  return <Link to={to} className="rounded-lg border border-white/10 bg-white/5 p-3 hover:bg-white/10 transition">
    <div className="font-medium">{label}</div><div className="text-xs text-slate-500 mt-1">{sub}</div>
  </Link>;
}

export default function Team(){
  const gs=useGame((s)=>s.gameState);
  const year=Number(gs?.activeYear)||0;
  const team=gs?.team||{};
  const teamId=String(team?.team_id??team?.id??"");
  const teamName=team?.team_name||team?.name||"My Team";
  const drivers=firstArray(gs?.drivers,gs?.dbDrivers);
  const driverById=useMemo(()=>new Map(drivers.map((d)=>[idOf(d),d])),[drivers]);

  const lineup=useMemo(()=>driverLineupSlots(gs,teamId),[gs,teamId]);
  const slots=useMemo(()=>["main","second","reserve","test"].map((slot)=>{
    const contract=lineup?.[slot];
    if(!contract)return {slot,label:driverRoleLabelForSlot(slot),contract:null};
    const id=String(driverIdOf(contract));
    const driver=driverById.get(id)||{driver_id:id,display_name:contract?.driver_name||id};
    const condition=driverCondition(gs,id);
    const overall=driverOverallPresentation(gs,driver);
    return {
      slot,label:driverRoleLabelForSlot(slot),contract,id,driver,condition,
      fatigue:fatigueStatus(gs,id),
      overall:overall?.estimated?`~${overall.value}`:overall?.value??"—",
      salary:num(contract?.salary??contract?.salary_yearly,0),
      until:unwrap(contract?.contract_until_year??contract?.contract_until??contract?.end_year??"—"),
    };
  }),[lineup,driverById,gs]);

  const staff=useMemo(()=>activeStaffContracts(gs,{teamId}),[gs,teamId]);
  const engineeringSupport=useMemo(()=>teamEngineeringSupport(gs,teamId),[gs,teamId]);
  const ranking=useMemo(()=>carPerformanceRanking(gs),[gs]);
  const myRank=ranking.find((row)=>String(row?.team_id)===teamId)||null;
  const raceDriver=slots.find((row)=>row.slot==="main"&&row.id);
  const carPerf=raceDriver?teamCarPerformance(gs,teamId,raceDriver.id):teamCarPerformance(gs,teamId,null);

  const standings=firstArray(gs?.standings?.teams,gs?.standings?.constructors);
  const standing=standings.find((row)=>String(row?.team_id??row?.constructor_id??row?.id??"")===teamId)||null;
  const dev=gs?.development||{};
  const activeProjects=(dev.projects||[]).filter((p)=>p?.status==="active");
  const manufacturing=(dev.manufacturing||[]).filter((p)=>p?.status==="active");
  const facilities=firstArray(gs?.facilities,gs?.dbFacilities);
  const facility=facilities.find((row)=>String(unwrap(row?.team_id??row?.team??""))===teamId&&Number(unwrap(row?.year??year))===year)||null;
  const hq=gs?.hq?.facilityLevels||{};
  const facilityKeys=["wind_tunnel_level","aero_dept_level","_chassis_shop_level","manufacturing_leve","pitcrew_training_level","simulator_level","youth_program_level"];
  const facilityValues=facilityKeys.map((key)=>num(hq[key]??facility?.[key],NaN)).filter(Number.isFinite);
  const facilityAvg=facilityValues.length?facilityValues.reduce((a,b)=>a+b,0)/facilityValues.length:null;

  const sponsors=(Array.isArray(gs?.sponsorsContracts)&&gs.sponsorsContracts.length?gs.sponsorsContracts:(gs?.dbSponsorsContracts||[]))
    .filter((row)=>String(unwrap(row?.team_id??row?.team??row?.constructor_id??""))===teamId)
    .filter((row)=>{
      const start=num(row?.start_year??row?.year,year);
      const end=num(row?.end_year??row?.until_year,start);
      const status=String(unwrap(row?.status??"active")).toLowerCase();
      return year>=start&&year<=end&&!["expired","terminated"].includes(status);
    });
  const sponsorValue=sponsors.reduce((sum,row)=>sum+num(row?.annual_income??row?.anual_income,0),0);
  const balance=num(gs?.finances?.balance??team?.budget,0);
  const boardState=deriveBoardState(gs);
  const boardConfidence=boardState?.confidence??null;
  const reputation=teamReputation(gs,teamId);
  const reputationState=gs?.teamReputationState?.[teamId]||null;

  return <div className="-mx-3 -my-4 md:-mx-5 md:-my-5 min-h-[calc(100vh-4rem)] bg-[#090b10] text-slate-100 p-4 md:p-6 space-y-4">
    <div className="rounded-xl border border-white/10 bg-[#12141c] shadow-lg p-3 flex flex-wrap xl:flex-nowrap items-center gap-3">
      <TeamLogo teamId={teamId} name={teamName} size="h-12 w-12" className="p-0.5"/>
      <div className="min-w-[190px]">
        <div className="text-[9px] uppercase tracking-[0.16em] text-slate-500">Team Headquarters</div>
        <h1 className="text-xl md:text-2xl font-bold truncate">{teamName}</h1>
        <div className="text-xs text-slate-400 truncate">{team?.team_base||team?.base||"Base unavailable"} · {year||"—"}</div>
      </div>
      <div className="flex-1"/>
      <div className="grid grid-cols-4 xl:grid-cols-8 gap-1.5 min-w-0 xl:min-w-[690px]">
        <Metric compact label="Constructors" value={standing?.position?`P${standing.position}`:"—"}/>
        <Metric compact label="Points" value={standing?.points??0}/>
        <Metric compact label="Car rank" value={myRank?`#${myRank.rank}`:"—"}/>
        <Metric compact label="Reputation" value={Math.round(reputation)+" · "+teamReputationLabel(reputation)}/>
        <Metric compact label="Balance" value={money(balance)}/>
        <Metric compact label="Engineering" value={Math.round(engineeringSupport)+"/100"}/>
        <Metric compact label="Board" value={boardConfidence==null?"—":Math.round(Number(boardConfidence)*100)+"%"}/>
        <Metric compact
          label="Rep trend"
          value={reputationState?.lastChange!=null
            ?`${Number(reputationState.lastChange)>=0?"+":""}${Number(reputationState.lastChange).toFixed(1)}`
            :"Stable"}
        />
      </div>
    </div>

    <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
      <Panel title="Driver line-up" className="xl:col-span-7" action={<Link to="/MyDrivers" className="text-xs text-slate-300 hover:text-white">Manage drivers ›</Link>}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-white/10">
          {slots.map((row)=>row.contract?<Link key={row.slot} to="/MyDrivers" className="bg-[#12141c] p-4 hover:bg-[#171a23]">
            <div className="flex items-start gap-3">
              <DriverPortrait driver={row.driver} size="h-16 w-16"/>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] uppercase tracking-wide text-slate-500">{row.label}</div>
                <div className="font-semibold truncate">{row.driver?.display_name||row.driver?.name||row.id}</div>
                <div className="text-xs text-slate-500 mt-1">{flagFromCountry(row.driver?.country_name||row.driver?.nationality,row.driver?.country_code)} {row.driver?.country_name||row.driver?.nationality||"—"}</div>
                <div className="mt-2 grid grid-cols-4 gap-1">
                  <Metric label="OVR" value={row.overall}/><Metric label="Fatigue" value={Math.round(row.condition.fatigue)+"%"}/><Metric label="Morale" value={Math.round(row.condition.morale)+"%"}/><Metric label="Prep" value={Math.round(row.condition.preparation)+"%"}/>
                </div>
              </div>
            </div>
          </Link>:<Link key={row.slot} to="/Drivers" className="bg-[#12141c] p-4 hover:bg-[#171a23]"><div className="text-[10px] uppercase tracking-wide text-slate-500">{row.label}</div><div className="font-semibold mt-1">Vacant seat</div><div className="text-xs text-slate-500 mt-1">Open Driver Market →</div></Link>)}
        </div>
      </Panel>

      <Panel title="Car performance" className="xl:col-span-5" action={<Link to="/Car" className="text-xs text-slate-300 hover:text-white">Car & Garage ›</Link>}>
        <div className="p-4 grid grid-cols-2 gap-2">
          <Metric label="Overall" value={Number(carPerf?.overall||0).toFixed(1)}/>
          <Metric label="Qualifying" value={Number(carPerf?.qualifying||0).toFixed(1)}/>
          <Metric label="Race" value={Number(carPerf?.race||0).toFixed(1)}/>
          <Metric label="Reliability" value={Number(carPerf?.reliability||0).toFixed(1)}/>
          <Metric label="Chassis" value={Number(carPerf?.chassis||0).toFixed(1)}/>
          <Metric label="Grid rank" value={myRank?`#${myRank.rank}`:"—"}/>
        </div>
      </Panel>

      <Panel title="Staff & operations" className="xl:col-span-4" action={<Link to="/MyStaff" className="text-xs text-slate-300 hover:text-white">My Staff ›</Link>}>
        <div className="p-4 space-y-3">
          <Metric label="Active staff contracts" value={staff.length}/>
          <Metric label="Practice engineering support" value={Math.round(engineeringSupport)+"/100"}/>
          <Metric label="Pit crew" value={gs?.raceStrategyWorld?.pitCrews?.[teamId]?.avg_time_s?`${gs.raceStrategyWorld.pitCrews[teamId].avg_time_s.toFixed(1)}s avg`:"Seeded from team/era data"}/>
        </div>
      </Panel>

      <Panel title="Development" className="xl:col-span-4" action={<Link to="/Development" className="text-xs text-slate-300 hover:text-white">Development ›</Link>}>
        <div className="p-4 space-y-3">
          <Metric label="Active projects" value={activeProjects.length}/>
          <Metric label="Manufacturing jobs" value={manufacturing.length}/>
          <Metric label="Designed parts" value={(dev.parts||[]).length}/>
        </div>
      </Panel>

      <Panel title="Facilities" className="xl:col-span-4" action={<Link to="/HQ" className="text-xs text-slate-300 hover:text-white">Facilities ›</Link>}>
        <div className="p-4 space-y-3">
          <Metric label="Available facilities" value={facilityValues.length}/>
          <Metric label="Average level" value={facilityAvg==null?"—":facilityAvg.toFixed(1)}/>
          <Metric label="Upgrades active" value={(gs?.hq?.upgrades||[]).filter((u)=>u?.status==="active").length}/>
        </div>
      </Panel>

      <Panel title="Commercial" className="xl:col-span-5" action={<Link to="/Finances" className="text-xs text-slate-300 hover:text-white">Finances ›</Link>}>
        <div className="p-4 grid grid-cols-2 gap-2">
          <Metric label="Active sponsors" value={sponsors.length}/>
          <Metric label="Annual sponsor value" value={money(sponsorValue)}/>
          <Metric label="Current balance" value={money(balance)}/>
          <Metric label="Season net" value={money(gs?.finances?.season_income-gs?.finances?.season_spend)}/>
        </div>
      </Panel>

      <Panel title="Board objectives" className="xl:col-span-7" action={<Link to="/Board" className="text-xs text-slate-300 hover:text-white">Board ›</Link>}>
        <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-2">
          <Metric label="Season expectation" value={boardState.expectationLabel}/>
          <Metric label="Primary objective" value={boardState.objectives?.[0]?.title||"—"}/>
          <Metric label="Objective progress" value={boardState.objectives?.[0]?Math.round(Number(boardState.objectives[0].progress||0)*100)+"%":"—"}/>
        </div>
      </Panel>

      <Panel title="Management shortcuts" className="xl:col-span-5">
        <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-2">
          <QuickLink to="/Board" label="Board" sub="Objectives & confidence"/>
          <QuickLink to="/Academy" label="Academy" sub="Junior support"/>
          <QuickLink to="/Scouting" label="Scouting" sub="Assignments & shortlist"/>
          <QuickLink to="/Standings" label="Standings" sub="Season performance"/>
        </div>
      </Panel>
    </div>
  </div>;
}
