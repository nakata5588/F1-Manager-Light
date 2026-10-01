// src/pages/Home.jsx
import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { useGame } from "../state/GameStore.js";
import { useEventStore } from "../state/EventStore.js";
import { DriverPortrait, TeamLogo } from "../components/entity/EntityVisuals.jsx";
import { GrandPrixFlag } from "../components/entity/GrandPrixFlag.jsx";
import { activeDriverContracts, driverContractsOf, driverLineupSlots, driverIdOf } from "../domain/driverContracts.js";
import { activeStaffContracts } from "../domain/liveContracts.js";
import { driverRoleLabelForSlot } from "../domain/contractRoles.js";
import { driverCondition, fatigueStatus } from "../domain/driverRating.js";
import { driverOverallPresentation } from "../domain/driverMarketEvaluation.js";
import { driverFormSnapshot } from "../domain/driverForm.js";
import { upcomingManagementEvents, daysBetweenISO } from "../domain/managementEvents.js";
import { deriveBoardState } from "../domain/boardState.js";
import { carPerformanceRanking } from "../domain/carPerformance.js";
import { normalizeNextSeasonCarProgramme } from "../domain/nextSeasonCar.js";

const firstArray=(...candidates)=>candidates.find(Array.isArray)||[];
const num=(value,fallback=0)=>Number.isFinite(Number(value))?Number(value):fallback;
const unwrap=(value)=>value&&typeof value==="object"&&!Array.isArray(value)?(value.result??value.value??value):value;

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
function relativeDaysLabel(fromISO,toISO){
  const days=daysBetweenISO(fromISO,toISO);
  if(!Number.isFinite(days))return null;
  if(days===0)return "Today";
  if(days===1)return "Tomorrow";
  return `In ${days} days`;
}
function raceRound(event,fallback=null){
  const gp=event?.meta?.gp||{};
  const value=gp?.round??gp?.round_number??gp?.Round??event?.round;
  const parsed=Number(value);
  return Number.isFinite(parsed)&&parsed>0?parsed:fallback;
}
function projectLabel(project){
  return project?.name??project?.part_name??project?.type??project?.slot??project?.area??"Development project";
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
      const form=driverFormSnapshot(gameState,id);
      return {
        ...driver,id,role:driverRoleLabelForSlot(slot),standing,condition,form,
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

    const upcoming=upcomingManagementEvents(gameState,{limit:24});
    const upcomingRaces=upcoming.filter((event)=>event.type==="GP").slice(0,4);
    const nextRace=upcomingRaces[0]||null;

    const carRanking=carPerformanceRanking(gameState);
    const carPerformance=carRanking.find((row)=>String(row?.team_id??"")===teamId)||null;
    const development=gameState.development||{};
    const developmentProjects=(Array.isArray(development.projects)?development.projects:[])
      .filter((project)=>["active","paused"].includes(String(project?.status??"").toLowerCase()));
    const nextProject=developmentProjects
      .filter((project)=>project?.finishes_at)
      .slice()
      .sort((a,b)=>String(a.finishes_at).localeCompare(String(b.finishes_at)))[0]||null;
    const nextSeasonCar=normalizeNextSeasonCarProgramme(
      development.nextSeasonCar,
      {activeYear:Number(gameState.activeYear)||1980}
    );

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
    const pendingDecisions=inbox.filter((message)=>
      message?.action_required===true||
      message?.requires_response===true||
      ["pending","awaiting_response","action_required"].includes(String(message?.status??"").toLowerCase())
    ).length;

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

    const driverWages=activeDriverContracts(gameState,{teamId})
      .reduce((sum,row)=>sum+num(unwrap(row?.salary??row?.salary_yearly),0),0);
    const staffWages=activeStaffContracts(gameState,{teamId})
      .reduce((sum,row)=>sum+num(unwrap(row?.salary??row?.salary_yearly),0),0);
    const wageBill=driverWages+staffWages;

    const sponsorRows=(Array.isArray(gameState.sponsorsContracts)&&gameState.sponsorsContracts.length
      ?gameState.sponsorsContracts
      :(gameState.dbSponsorsContracts||[]))
      .filter((row)=>String(unwrap(row?.team_id??row?.team??row?.constructor_id??""))===teamId)
      .filter((row)=>{
        const start=num(unwrap(row?.start_year??row?.year),Number(yearKey));
        const end=num(unwrap(row?.end_year??row?.until_year),start);
        const status=String(unwrap(row?.status??"active")).toLowerCase();
        return Number(yearKey)>=start&&Number(yearKey)<=end&&!["expired","terminated"].includes(status);
      });
    const sponsorIncome=sponsorRows.reduce((sum,row)=>
      sum+num(unwrap(row?.anual_income??row?.annual_income??row?.value_year),0),0
    );
    const board=deriveBoardState(gameState);
    const objectives=board.objectives||[];
    const lowComponents=[];
    for(const car of gameState.garage?.cars||[]){
      for(const [slot,condition] of Object.entries(car?.componentCondition||{})){
        if(num(condition,100)<40)lowComponents.push({car:car.label??car.id,slot,condition:num(condition)});
      }
    }

    return {team,teamId,teamName,raceDrivers,teamStandings,constructorRow,upcomingRaces,nextRace,carPerformance,developmentProjects,nextProject,nextSeasonCar,alerts,pendingDecisions,finance,monthlyNet,seasonNet,driverWages,staffWages,wageBill,sponsorRows,sponsorIncome,board,objectives,lowComponents,inbox};
  },[gameState,eventNews]);

  if(!gameState||!data){
    return <div className="rounded-xl border bg-white p-6">
      <h1 className="text-2xl font-semibold">Home</h1>
      <p className="mt-2 text-sm text-gray-600">Load or start a career to open the management hub.</p>
    </div>;
  }

  const boardStatus=Number.isFinite(Number(data.board?.confidence))?`${Math.round(Number(data.board.confidence)*100)}%`:(data.board?.rating??data.board?.status??"—");
  const seasonObjective=data.board?.expectationLabel??data.objectives[0]?.title??"No objective set";
  const currentDate=gameState.currentDateISO||"";
  const completedObjectives=data.objectives.filter((objective)=>objective?.status==="completed").length;
  const boardObjectiveValue=data.objectives.length
    ?`${completedObjectives}/${data.objectives.length}`
    :"—";
  const boardUnderPressure=Number(data.board?.confidence)<0.45;
  const playerOutsideTopSeven=Boolean(
    data.constructorRow&&
    Number(data.constructorRow?.position)>7
  );
  const standingsRows=playerOutsideTopSeven
    ?data.teamStandings.slice(0,6)
    :data.teamStandings.slice(0,7);

  return <div className="-mx-3 -my-4 md:-mx-5 md:-my-5 min-h-[calc(100vh-4rem)] bg-[#090b10] px-4 pb-4 pt-2 md:px-6 md:pb-6 md:pt-3 text-slate-100">
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
            <OverviewRow label="Board confidence" value={boardStatus} alert={boardUnderPressure}/>
          </div>
        </div>
      </Panel>

      <section className="xl:col-span-5 grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.raceDrivers.map((driver,index)=><DriverCard key={driver.id} driver={driver} index={index+1}/>)}
        {!data.raceDrivers.length?<Panel title="Drivers" className="md:col-span-2"><div className="p-5 text-sm text-slate-400">No race drivers assigned to the current Team.</div></Panel>:null}
      </section>

      <Panel title="Decision centre" className="xl:col-span-3" action={<SmallLink to="/Inbox">Inbox ›</SmallLink>}>
        <div className="divide-y divide-white/10">
          <DecisionRow label="Pending decisions" value={data.pendingDecisions} warning={data.pendingDecisions>0} to="/Inbox"/>
          <DecisionRow label="Fatigued drivers" value={data.raceDrivers.filter((d)=>d.condition.fatigue>=70).length} warning={data.raceDrivers.some((d)=>d.condition.fatigue>=70)} to="/MyDrivers"/>
          <DecisionRow label="Worn components" value={data.lowComponents.length} warning={data.lowComponents.length>0} to="/Car"/>
          <DecisionRow label="Board objectives" value={boardObjectiveValue} neutral to="/Board"/>
        </div>
      </Panel>

      <Panel title="Standings" className="xl:col-span-4" action={<SmallLink to="/Standings">Full standings ›</SmallLink>}>
        <div className="divide-y divide-white/10">
          {standingsRows.map((row,index)=><StandingRow key={String(row.team_id??row.constructor_id??row.id??index)} row={row} fallbackPosition={index+1} teamId={data.teamId}/>)}
          {playerOutsideTopSeven?<>
            <div className="px-4 py-1 text-center text-xs text-slate-600">•••</div>
            <StandingRow row={data.constructorRow} fallbackPosition={data.constructorRow?.position} teamId={data.teamId}/>
          </>:null}
          {!data.teamStandings.length?<div className="p-4 text-sm text-slate-400">No standings yet.</div>:null}
        </div>
      </Panel>

      <Panel title="Up next" className="xl:col-span-5" action={<SmallLink to="/CalendarPage">Calendar ›</SmallLink>}>
        {data.nextRace?<div>
          <div className="p-5 bg-gradient-to-br from-[#171a23] to-[#101219]">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-slate-400">
              <span>Next Grand Prix</span>
              {raceRound(data.nextRace)?<span className="rounded bg-white/8 px-2 py-0.5 tracking-normal">Round {raceRound(data.nextRace)}</span>:null}
            </div>
            <div className="mt-2 flex items-center gap-2 text-3xl font-bold">
              <GrandPrixFlag gameState={gameState} gp={data.nextRace?.meta?.gp} record={data.nextRace} size="lg"/>
              <span>{data.nextRace.title}</span>
            </div>
            <div className="mt-1 text-sm text-slate-400">{data.nextRace.subtitle||"Race weekend"}</div>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <span className="rounded bg-white/10 px-3 py-1.5 text-sm">{data.nextRace.date}</span>
              {relativeDaysLabel(currentDate,data.nextRace.date)?<span className="rounded bg-white/10 px-3 py-1.5 text-sm text-slate-200">{relativeDaysLabel(currentDate,data.nextRace.date)}</span>:null}
              <Link to="/RaceWeekend" className="ml-auto inline-flex rounded-md bg-slate-100 text-slate-950 px-3 py-1.5 text-sm font-semibold hover:bg-white">Open weekend</Link>
            </div>
          </div>
          {data.upcomingRaces.slice(1).length?<div className="divide-y divide-white/10 border-t border-white/10">
            {data.upcomingRaces.slice(1).map((race,index)=><NextRaceRow key={race.id} race={race} currentDate={currentDate} gameState={gameState} fallbackRound={raceRound(data.nextRace,0)+index+1}/>)}
          </div>:null}
        </div>:<div className="p-5 text-sm text-slate-400">No upcoming Grand Prix.</div>}
      </Panel>

      <Panel title="Finances" className="xl:col-span-3" action={<SmallLink to="/Finances">Details ›</SmallLink>}>
        <div className="p-5 space-y-3">
          <OverviewRow label="Current balance" value={fmtMoney(data.finance.balance??data.finance.cash??data.finance.bank)}/>
          <OverviewRow label="This month" value={fmtMoney(data.finance.monthlyBalance??data.finance.monthly_balance??data.finance.monthly??data.monthlyNet)}/>
          <OverviewRow label="Season net" value={fmtMoney(data.finance.season_net??data.seasonNet)}/>
          <OverviewRow label="Sponsor income / year" value={fmtMoney(data.sponsorIncome)}/>
          <OverviewRow label="Annual wage bill" value={fmtMoney(data.wageBill)}/>
          <OverviewRow label="Active sponsors" value={data.sponsorRows.length}/>
        </div>
      </Panel>

      <Panel title="Car & development" className="xl:col-span-7" action={<div className="flex items-center gap-4"><SmallLink to="/Car">Cars ›</SmallLink><SmallLink to="/Development">Development ›</SmallLink></div>}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/10">
          <DashboardMetric label="Car rank" value={data.carPerformance?`#${data.carPerformance.rank} / ${Math.max(1,firstArray(gameState.teams,gameState.dbTeams).length)}`:"—"}/>
          <DashboardMetric label="Performance" value={data.carPerformance?Number(data.carPerformance.overall).toFixed(1):"—"}/>
          <DashboardMetric label="Reliability" value={data.carPerformance?`${Math.round(Number(data.carPerformance.reliability))}%`:"—"} alert={Number(data.carPerformance?.reliability)<60}/>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/10 border-t border-white/10">
          <DashboardMetric label="Active projects" value={data.developmentProjects.length}/>
          <DashboardMetric
            label="Next completion"
            value={data.nextProject?projectLabel(data.nextProject):"No active project"}
            hint={data.nextProject?.finishes_at?(relativeDaysLabel(currentDate,data.nextProject.finishes_at)||data.nextProject.finishes_at):null}
            compact
          />
          <DashboardMetric
            label={`Next season car · ${data.nextSeasonCar.targetSeason}`}
            value={data.nextSeasonCar.status==="not_started"?"Not started":`${Math.round(Number(data.nextSeasonCar.overall_progress||0))}%`}
            hint={data.nextSeasonCar.status==="not_started"?"Open Development to begin":String(data.nextSeasonCar.phase||"").replaceAll("_"," ")}
            compact
          />
        </div>
      </Panel>

      <Panel title="Latest alerts" className="xl:col-span-5" action={<SmallLink to="/Inbox">All messages ›</SmallLink>}>
        <div className="divide-y divide-white/10">
          {data.alerts.map((message,index)=><Link key={message.id??index} to="/Inbox" className="block px-4 py-3 hover:bg-white/5">
            <div className="text-sm font-medium truncate">{message.subject??message.title??message.headline??"Team message"}</div>
            <div className="text-xs text-slate-500 mt-1">
              {[message.date,message.from??message.sender??message.category??message.type??"Inbox"].filter(Boolean).join(" · ")}
            </div>
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
  const formScore=Number(driver.form?.score);
  const hasForm=Number.isFinite(formScore)&&Number(driver.form?.sample)>0;
  return <Link to={`/drivers/${encodeURIComponent(driver.id)}`} className="rounded-xl border border-white/10 bg-[#12141c] text-slate-100 shadow-lg overflow-hidden hover:border-white/25 transition">
    <div className="p-4 flex items-start gap-3">
      <DriverPortrait driver={driver} size="h-20 w-20" className="ring-white/15"/>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="text-xs text-slate-400">{String(driver.role||"").replaceAll("_"," ")}</div>
          <div className="flex-1"/>
          <div className="text-xs uppercase tracking-wide text-slate-500">Car {index}</div>
        </div>
        <div className="text-xl font-bold mt-1 truncate">{name}</div>
        <div className="text-xs text-slate-500 mt-1">{hasForm?`${driver.form.label} form · ${driver.form.sample} race${driver.form.sample===1?"":"s"}`:"Season not started"}</div>
      </div>
    </div>
    <div className="grid grid-cols-3 gap-px bg-white/10 border-t border-white/10">
      <MiniMetric label="Rating" value={driver.overallEstimated?`~${driver.overall}`:driver.overall}/>
      <MiniMetric label="WDC" value={standing.position?`P${standing.position}`:"—"}/>
      <MiniMetric label="Points" value={standing.points??0}/>
      <MiniMetric label="Form" value={hasForm?Math.round(formScore):"—"} hint={hasForm?driver.form.label:null}/>
      <MiniMetric label="Fatigue" value={`${Math.round(fatigue)}%`} hint={driver.fatigue?.label} alert={fatigue>=70}/>
      <MiniMetric label="Preparation" value={`${Math.round(driver.condition.preparation)}%`}/>
    </div>
  </Link>;
}
function NextRaceRow({race,currentDate,gameState,fallbackRound}){
  const round=raceRound(race,fallbackRound);
  return <Link to="/CalendarPage" className="px-4 py-2.5 flex items-center gap-3 hover:bg-white/[0.04]">
    <div className="w-10 text-xs font-semibold text-slate-500">{round?`R${round}`:"—"}</div>
    <GrandPrixFlag gameState={gameState} gp={race?.meta?.gp} record={race} size="sm"/>
    <div className="min-w-0 flex-1">
      <div className="text-sm font-medium truncate">{race.title}</div>
      <div className="text-xs text-slate-500">{race.subtitle||"Grand Prix"}</div>
    </div>
    <div className="text-right">
      <div className="text-xs font-medium text-slate-300">{race.date}</div>
      <div className="text-[10px] text-slate-500">{relativeDaysLabel(currentDate,race.date)||""}</div>
    </div>
  </Link>;
}
function StandingRow({row,fallbackPosition,teamId}){
  const id=String(row?.team_id??row?.constructor_id??row?.id??"");
  const name=row?.team_name??row?.name??row?.constructor_name??row?.team?.team_name??row?.team?.name??id;
  const isMine=Boolean(teamId&&id===teamId);
  return <div className={`px-4 py-2.5 flex items-center gap-3 ${isMine?"bg-white/8 ring-1 ring-inset ring-white/10":""}`}>
    <div className="w-6 text-right text-sm font-semibold">{row?.position??fallbackPosition??"—"}</div>
    <TeamLogo teamId={id} name={name} size="h-7 w-7" className="p-0.5"/>
    <div className={`flex-1 truncate text-sm ${isMine?"font-semibold text-white":"text-slate-200"}`}>{name}</div>
    <div className="font-semibold">{row?.points??0}</div>
  </div>;
}
function MiniMetric({label,value,hint=null,alert=false}){
  return <div className="bg-[#171a23] px-3 py-2 min-w-0">
    <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
    <div className={`mt-0.5 text-lg font-semibold truncate ${alert?"text-rose-300":""}`}>{value}</div>
    {hint?<div className="text-[9px] text-slate-500 truncate">{hint}</div>:null}
  </div>;
}
function DashboardMetric({label,value,hint=null,alert=false,compact=false}){
  return <div className="bg-[#12141c] p-4 min-w-0">
    <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
    <div className={`mt-1 font-semibold ${compact?"text-sm":"text-2xl"} ${alert?"text-rose-300":"text-slate-100"} truncate`}>{value}</div>
    {hint?<div className="mt-1 text-xs text-slate-500 truncate">{hint}</div>:null}
  </div>;
}
function OverviewRow({label,value,alert=false}){
  return <div className="flex items-start gap-3 text-sm">
    <span className="text-slate-400 flex-1">{label}</span>
    <span className={`font-semibold text-right max-w-[65%] ${alert?"text-rose-300":""}`}>{value??"—"}</span>
  </div>;
}
function DecisionRow({label,value,warning=false,neutral=false,to}){
  const dot=neutral?"bg-slate-500":warning?"bg-rose-400":"bg-emerald-400";
  return <Link to={to} className="px-4 py-3 flex items-center gap-3 hover:bg-white/5">
    <div className={`h-2.5 w-2.5 rounded-full ${dot}`}/>
    <div className="flex-1 text-sm">{label}</div>
    <div className={`font-bold ${warning&&!neutral?"text-rose-300":"text-slate-200"}`}>{value}</div>
  </Link>;
}
