// src/pages/Home.jsx
import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { useGame } from "../state/GameStore.js";
import { useEventStore } from "../state/EventStore.js";
import { DriverPortrait, TeamLogo } from "../components/entity/EntityVisuals.jsx";
import { driverContractsOf, driverLineupSlots, driverIdOf } from "../domain/driverContracts.js";
import { driverRoleLabelForSlot } from "../domain/contractRoles.js";
import { driverCondition, fatigueStatus } from "../domain/driverRating.js";
import { driverOverallPresentation } from "../domain/driverMarketEvaluation.js";
import { upcomingManagementEvents, daysBetweenISO } from "../domain/managementEvents.js";

const firstArray=(...candidates)=>candidates.find(Array.isArray)||[];
const num=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;

function fmtMoney(value){
  const amount=Number(value);
  if(!Number.isFinite(amount))return "—";
  return amount.toLocaleString("en-GB",{style:"currency",currency:"USD",maximumFractionDigits:0});
}
function ordinal(value){
  const n=Number(value);
  if(!Number.isFinite(n))return "—";
  const mod100=n%100;
  const suffix=mod100>=11&&mod100<=13?"th":({1:"st",2:"nd",3:"rd"}[n%10]||"th");
  return `${n}${suffix}`;
}
function isUnread(message){
  return message?.unread===true||message?.read===false||message?.is_unread===true;
}
function Panel({title,action,children,className=""}){
  return <section className={`rounded-xl border border-white/10 bg-[#12141c] text-slate-100 shadow-lg overflow-hidden ${className}`}>
    <div className="px-4 py-3 border-b border-white/10 flex items-center gap-3">
      <h2 className="font-semibold uppercase tracking-wide text-sm">{title}</h2>
      <div className="flex-1"/>
      {action}
    </div>
    {children}
  </section>;
}
function SmallLink({to,children}){
  return <Link to={to} className="text-xs text-slate-300 hover:text-white">{children}</Link>;
}

export default function Home(){
  const gameState=useGame((s)=>s.gameState);
  const eventNews=useEventStore((s)=>s.news);

  const data=useMemo(()=>{
    if(!gameState)return null;
    const contracts=driverContractsOf(gameState);
    const drivers=firstArray(gameState.drivers,gameState.dbDrivers);
    const teams=firstArray(gameState.teams,gameState.dbTeams);
    const team=gameState.team||{};
    const teamName=team.team_name??team.name??team.short_name??"My Team";
    const explicitTeamId=team.team_id??team.id??null;
    const inferredContract=!explicitTeamId
      ?contracts.find((contract)=>String(contract?.team_name??contract?.team??"")===String(teamName))
      :null;
    const teamId=String(explicitTeamId??inferredContract?.team_id??inferredContract?.constructor_id??"");
    const driverIndex=new Map(drivers.map((driver)=>[
      String(driver.driver_id??driver.id??driver.driverId??""),driver,
    ]));
    const teamIndex=new Map(teams.map((row)=>[
      String(row?.team_id??row?.id??""),row,
    ]));

    const lineup=teamId?driverLineupSlots(gameState,teamId):{};
    const raceDrivers=["main","second"].map((slot)=>{
      const contract=lineup?.[slot];
      if(!contract)return null;
      const id=String(driverIdOf(contract));
      const driver=driverIndex.get(id);
      if(!driver)return null;
      const standing=(gameState.standings?.drivers||[]).find((row)=>
        String(row.driver_id??row.id??row.driverId??"")===id
      );
      const condition=driverCondition(gameState,id);
      const overall=driverOverallPresentation(gameState,driver);
      return {
        ...driver,id,role:driverRoleLabelForSlot(slot),standing,condition,
        fatigue:fatigueStatus(gameState,id),
        overall:overall?.value??driver.current_ability??driver.rating??driver.overall??"—",
        overallEstimated:Boolean(overall?.estimated),
      };
    }).filter(Boolean);

    const teamStandings=firstArray(gameState.standings?.constructors,gameState.standings?.teams)
      .map((row)=>({
        ...row,
        team:teamIndex.get(String(row?.team_id??row?.constructor_id??row?.id??""))||null,
      }));
    const constructorRow=teamStandings.find((row)=>
      (teamId&&String(row.team_id??row.constructor_id??row.id??"")===teamId)||
      String(row.team_name??row.name??"")===String(teamName)
    );

    const upcoming=upcomingManagementEvents(gameState,{limit:10});
    const nextRace=upcoming.find((event)=>event.type==="GP")||null;
    const inbox=[
      ...(Array.isArray(gameState.inbox)?gameState.inbox:[]),
      ...(Array.isArray(eventNews)?eventNews:[]),
    ];
    const alerts=inbox.filter((message)=>
      isUnread(message)||
      message?.action_required===true||
      message?.requires_response===true||
      /high|urgent|critical/i.test(String(message?.priority??""))
    ).slice(0,5);

    const finance=gameState.finances||gameState.finance||{};
    const financeLog=Array.isArray(gameState.financeLog)?gameState.financeLog:[];
    const yearKey=String(gameState.activeYear??"");
    const monthKey=String(gameState.currentDateISO??"").slice(0,7);
    const financeAmount=(row)=>{
      const amount=num(row?.amount,0);
      const type=String(row?.type??"").toLowerCase();
      if(type==="expense")return -Math.abs(amount);
      if(type==="income")return Math.abs(amount);
      return amount;
    };
    const monthlyNet=financeLog
      .filter((row)=>String(row?.dateISO??row?.date??"").slice(0,7)===monthKey)
      .reduce((sum,row)=>sum+financeAmount(row),0);
    const seasonNet=financeLog
      .filter((row)=>String(row?.dateISO??row?.date??"").slice(0,4)===yearKey)
      .reduce((sum,row)=>sum+financeAmount(row),0);
    const board=gameState.board||{};
    const objectives=Array.isArray(board.objectives)?board.objectives:[];
    const lowComponents=[];
    for(const car of gameState.garage?.cars||[]){
      for(const [slot,condition] of Object.entries(car?.componentCondition||{})){
        if(num(condition,100)<40)lowComponents.push({car:car.label??car.id,slot,condition:num(condition)});
      }
    }

    return {team,teamId,teamName,raceDrivers,teamStandings,constructorRow,upcoming,nextRace,alerts,finance,monthlyNet,seasonNet,board,objectives,lowComponents,inbox};
  },[gameState,eventNews]);

  if(!gameState||!data){
    return <div className="rounded-xl border bg-white p-6">
      <h1 className="text-2xl font-semibold">Home</h1>
      <p className="mt-2 text-sm text-gray-600">Load or start a career to open the management hub.</p>
    </div>;
  }

  const unread=data.inbox.filter(isUnread).length;
  const boardStatus=data.board?.confidence??data.board?.rating??data.board?.status??"—";
  const seasonObjective=data.objectives[0]?.title??data.objectives[0]?.name??data.board?.seasonObjective??"No objective set";
  const currentDate=gameState.currentDateISO||"";
  const nextRaceDays=data.nextRace?daysBetweenISO(currentDate,data.nextRace.date):null;

  return <div className="-mx-3 -my-4 md:-mx-5 md:-my-5 min-h-[calc(100vh-4rem)] bg-[#090b10] p-4 md:p-6 text-slate-100 space-y-4">
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold">Home</h1>
        <p className="text-sm text-slate-400">
          {data.teamName} · Season {gameState.activeYear??gameState.season??"—"} · {currentDate||"Date unavailable"}
        </p>
      </div>
      <div className="flex-1"/>
      {unread>0?<Link to="/Inbox" className="rounded-full bg-white/10 text-white px-3 py-1 text-xs font-semibold">
        {unread} unread message{unread===1?"":"s"}
      </Link>:null}
    </div>

    <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
      <Panel title="Team overview" className="xl:col-span-4" action={<SmallLink to="/Board">Board ›</SmallLink>}>
        <div className="p-5">
          <div className="flex items-center gap-4">
            <TeamLogo teamId={data.teamId} name={data.teamName} size="h-16 w-16" className="p-1"/>
            <div>
              <div className="text-2xl font-bold">{data.teamName}</div>
              <div className="text-xs text-slate-500 mt-1">Team management overview</div>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            <OverviewRow label="Constructors" value={data.constructorRow?.position?ordinal(data.constructorRow.position):"—"}/>
            <OverviewRow label="Points" value={data.constructorRow?.points??0}/>
            <OverviewRow label="Season objective" value={seasonObjective}/>
            <OverviewRow label="Board confidence" value={boardStatus}/>
          </div>
        </div>
      </Panel>

      <section className="xl:col-span-5 grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.raceDrivers.map((driver,index)=><DriverCard key={driver.id} driver={driver} index={index+1}/>)}
        {!data.raceDrivers.length?<Panel title="Drivers" className="md:col-span-2"><div className="p-5 text-sm text-slate-400">No race drivers assigned to the current Team.</div></Panel>:null}
      </section>

      <Panel title="Decision centre" className="xl:col-span-3" action={<SmallLink to="/Inbox">Inbox ›</SmallLink>}>
        <div className="divide-y divide-white/10">
          <DecisionRow label="Unread inbox" value={unread} warning={unread>0} to="/Inbox"/>
          <DecisionRow label="Fatigued drivers" value={data.raceDrivers.filter((d)=>d.condition.fatigue>=70).length} warning={data.raceDrivers.some((d)=>d.condition.fatigue>=70)} to="/MyDrivers"/>
          <DecisionRow label="Worn components" value={data.lowComponents.length} warning={data.lowComponents.length>0} to="/Car"/>
          <DecisionRow label="Objectives at risk" value={data.objectives.filter((o)=>/risk|warning|fail|overdue|blocked/i.test(String(o?.status??o?.state??""))).length} warning={data.objectives.some((o)=>/risk|warning|fail|overdue|blocked/i.test(String(o?.status??o?.state??"")))} to="/Board"/>
        </div>
      </Panel>

      <Panel title="Standings" className="xl:col-span-4" action={<SmallLink to="/Standings">Full standings ›</SmallLink>}>
        <div className="divide-y divide-white/10">
          {data.teamStandings.slice(0,7).map((row,index)=>{
            const id=String(row.team_id??row.constructor_id??row.id??"");
            const name=row.team_name??row.name??row.constructor_name??row.team?.team_name??row.team?.name??id;
            const isMine=data.teamId&&id===data.teamId;
            return <div key={id||index} className={`px-4 py-2.5 flex items-center gap-3 ${isMine?"bg-white/8":""}`}>
              <div className="w-6 text-right text-sm font-semibold">{row.position??index+1}</div>
              <TeamLogo teamId={id} name={name} size="h-7 w-7" className="p-0.5"/>
              <div className="flex-1 truncate text-sm">{name}</div>
              <div className="font-semibold">{row.points??0}</div>
            </div>;
          })}
          {!data.teamStandings.length?<div className="p-4 text-sm text-slate-400">No standings yet.</div>:null}
        </div>
      </Panel>

      <Panel title="Up next" className="xl:col-span-5" action={<SmallLink to="/CalendarPage">Calendar ›</SmallLink>}>
        {data.nextRace?<div className="p-5 bg-gradient-to-br from-[#171a23] to-[#101219]">
          <div className="text-xs uppercase tracking-[0.18em] text-slate-400">Next Grand Prix</div>
          <div className="mt-2 text-3xl font-bold">{data.nextRace.title}</div>
          <div className="mt-1 text-sm text-slate-400">{data.nextRace.subtitle||"Race weekend"}</div>
          <div className="mt-6 flex flex-wrap gap-2">
            <span className="rounded bg-white/10 px-3 py-1.5 text-sm">{data.nextRace.date}</span>
            {Number.isFinite(nextRaceDays)?<span className="rounded bg-white/10 px-3 py-1.5 text-sm text-slate-200">{nextRaceDays===0?"Today":`In ${nextRaceDays} day${nextRaceDays===1?"":"s"}`}</span>:null}
          </div>
          <div className="mt-5"><Link to="/RaceWeekend" className="inline-flex rounded-md bg-slate-100 text-slate-950 px-4 py-2 text-sm font-semibold hover:bg-white">Open race weekend</Link></div>
        </div>:<div className="p-5 text-sm text-slate-400">No upcoming Grand Prix.</div>}
      </Panel>

      <Panel title="Finances" className="xl:col-span-3" action={<SmallLink to="/Finances">Details ›</SmallLink>}>
        <div className="p-5 space-y-3">
          <OverviewRow label="Current balance" value={fmtMoney(data.finance.balance??data.finance.cash??data.finance.bank)}/>
          <OverviewRow label="This month" value={fmtMoney(data.finance.monthlyBalance??data.finance.monthly_balance??data.finance.monthly??data.monthlyNet)}/>
          <OverviewRow label="Season net" value={fmtMoney(data.finance.season_net??data.seasonNet)}/>
        </div>
      </Panel>

      <Panel title="Upcoming events" className="xl:col-span-7" action={<SmallLink to="/CalendarPage">View calendar ›</SmallLink>}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-white/10">
          {data.upcoming.slice(0,6).map((event)=><Link key={event.id} to={event.route||"/CalendarPage"} className="bg-[#12141c] p-3 hover:bg-[#1a1d27] transition-colors">
            <div className="flex items-start gap-3">
              <div className={`mt-1.5 h-2.5 w-2.5 rounded-full shrink-0 ${event.priority==="high"?"bg-rose-400":"bg-slate-400"}`}/>
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{event.title}</div>
                <div className="text-xs text-slate-500 mt-0.5">{event.date} · {String(event.type).replaceAll("_"," ")}</div>
              </div>
            </div>
          </Link>)}
          {!data.upcoming.length?<div className="p-4 text-sm text-slate-400">Nothing scheduled.</div>:null}
        </div>
      </Panel>

      <Panel title="Latest alerts" className="xl:col-span-5" action={<SmallLink to="/Inbox">All messages ›</SmallLink>}>
        <div className="divide-y divide-white/10">
          {data.alerts.map((message,index)=><Link key={message.id??index} to="/Inbox" className="block px-4 py-3 hover:bg-white/5">
            <div className="text-sm font-medium truncate">{message.subject??message.title??message.headline??"Team message"}</div>
            <div className="text-xs text-slate-500 mt-1">{message.category??message.type??"Inbox"}</div>
          </Link>)}
          {!data.alerts.length?<div className="p-4 text-sm text-slate-400">No urgent alerts.</div>:null}
        </div>
      </Panel>
    </div>
  </div>;
}

function DriverCard({driver,index}){
  const name=driver.display_name||driver.name||[driver.first_name,driver.last_name].filter(Boolean).join(" ")||driver.id;
  const standing=driver.standing||{};
  const fatigue=driver.condition.fatigue;
  return <Link to="/MyDrivers" className="rounded-xl border border-white/10 bg-[#12141c] text-slate-100 shadow-lg overflow-hidden hover:border-white/25 transition">
    <div className="p-4 flex items-start gap-3">
      <DriverPortrait driver={driver} size="h-20 w-20" className="ring-white/15"/>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="text-xs text-slate-400">{String(driver.role||"").replaceAll("_"," ")}</div>
          <div className="flex-1"/>
          <div className="text-xs uppercase tracking-wide text-slate-500">Car {index}</div>
        </div>
        <div className="text-xl font-bold mt-1 truncate">{name}</div>
        <div className="text-xs text-slate-500 mt-1">{standing.position?ordinal(standing.position):"No championship position yet"}</div>
      </div>
    </div>
    <div className="grid grid-cols-2 gap-px bg-white/10 border-t border-white/10">
      <MiniMetric label="Rating" value={driver.overallEstimated?`~${driver.overall}`:driver.overall}/>
      <MiniMetric label="Points" value={standing.points??0}/>
      <MiniMetric label="Fatigue" value={`${Math.round(fatigue)}%`} alert={fatigue>=70}/>
      <MiniMetric label="Preparation" value={`${Math.round(driver.condition.preparation)}%`}/>
    </div>
    <div className={`px-4 py-3 text-xs font-semibold ${fatigue>=70?"text-rose-300":fatigue>=40?"text-amber-300":"text-emerald-300"}`}>{driver.fatigue.label}</div>
  </Link>;
}
function MiniMetric({label,value,alert=false}){
  return <div className="bg-[#171a23] px-3 py-2">
    <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
    <div className={`mt-0.5 text-lg font-semibold ${alert?"text-rose-300":""}`}>{value}</div>
  </div>;
}
function OverviewRow({label,value}){
  return <div className="flex items-start gap-3 text-sm">
    <span className="text-slate-400 flex-1">{label}</span>
    <span className="font-semibold text-right max-w-[65%]">{value??"—"}</span>
  </div>;
}
function DecisionRow({label,value,warning,to}){
  return <Link to={to} className="px-4 py-3 flex items-center gap-3 hover:bg-white/5">
    <div className={`h-2.5 w-2.5 rounded-full ${warning?"bg-rose-400":"bg-emerald-400"}`}/>
    <div className="flex-1 text-sm">{label}</div>
    <div className={`font-bold ${warning?"text-rose-300":"text-slate-200"}`}>{value}</div>
  </Link>;
}
