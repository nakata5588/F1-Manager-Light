import { expectedDriverSalary, teamIdOf } from "../domain/driverContracts.js";
import { rngFor } from "../core/random.js";
import { isDriverContract } from "../domain/contractRoles.js";
import { compareDriverMarketValue } from "../domain/driverMarketEvaluation.js";
import {
  availableContractRoles,
  driverNegotiations,
  isNegotiationActive,
  startDriverNegotiation,
} from "./NegotiationEngine.js";

// src/engine/MarketEngine.js
function pickRandom(arr,rng){return rng.pick(arr);}

function activeContractForYear(contract,year){
  const status=String(contract?.status||"active").toLowerCase();
  if(["terminated","expired","released","inactive","void"].includes(status))return false;
  const direct=Number(contract?.year??contract?.season_year??NaN);
  const start=Number(contract?.contract_start_year??contract?.start_year??NaN);
  const end=Number(contract?.contract_until_year??contract?.end_year??NaN);
  if(Number.isFinite(start)||Number.isFinite(end)){
    const lo=Number.isFinite(start)?start:(Number.isFinite(direct)?direct:-Infinity);
    const hi=Number.isFinite(end)?end:(Number.isFinite(direct)?direct:Infinity);
    return !Number.isFinite(year)||(year>=lo&&year<=hi);
  }
  return !Number.isFinite(year)||!Number.isFinite(direct)||direct===year;
}

function driverIdOf(row){
  return String(row?.driver_id??row?.person_id??row?.id??"");
}

function daysBetweenISO(fromISO,toISO){
  const a=Date.parse(String(fromISO||"").slice(0,10)+"T00:00:00Z");
  const b=Date.parse(String(toISO||"").slice(0,10)+"T00:00:00Z");
  if(!Number.isFinite(a)||!Number.isFinite(b))return Infinity;
  return Math.floor((b-a)/86400000);
}

function activeOfferCount(gs,driverId){
  return driverNegotiations(gs).filter((n)=>
    isNegotiationActive(n)&&String(n.driver_id)===String(driverId)
  ).length;
}

function candidateForTeam(gs,drivers,teamId){
  const activeDriverIds=new Set(
    (gs?.contracts||[])
      .filter((c)=>isDriverContract(c)&&activeContractForYear(c,Number(gs?.activeYear)))
      .map(driverIdOf)
      .filter(Boolean)
  );
  const candidates=drivers
    .filter((d)=>!activeDriverIds.has(driverIdOf(d)))
    .filter((d)=>!driverNegotiations(gs).some((n)=>
      isNegotiationActive(n)&&
      String(n.team_id)===String(teamId)&&
      String(n.driver_id)===driverIdOf(d)
    ))
    .sort((a,b)=>{
      const offerDiff=activeOfferCount(gs,driverIdOf(a))-activeOfferCount(gs,driverIdOf(b));
      if(offerDiff!==0)return offerDiff;
      return compareDriverMarketValue(gs,a,b);
    });
  return candidates[0]||null;
}

function salaryMultiplierForRole(role){
  const key=String(role||"").toLowerCase();
  if(key.includes("main"))return 1.05;
  if(key.includes("second"))return 1.00;
  if(key.includes("reserve"))return 0.84;
  return 0.78;
}

export function applyMarketTick(gs){
  let next={...gs};
  const drivers=(gs.drivers||[]).filter(
    (d)=>!["hidden","junior_only"].includes(String(d?.status||""))
  );
  const f1EligibleDrivers=drivers.filter((d)=>{
    const status=String(d?.status||"").toLowerCase();
    return d?.canHireF1!==false && !["lower_series","junior_only","hidden","deceased","retired"].includes(status);
  });
  const teams=gs.teams||[];
  if(!drivers.length||!teams.length)return next;

  const currentDate=String(gs?.currentDateISO||"").slice(0,10);
  const currentMonth=currentDate.slice(0,7);
  const marketRng=rngFor(gs,`market:${String(gs?.currentDateISO||currentMonth||"date")}`);
  const lastAICheck=String(gs?._lastAIDriverMarketCheckISO||"");
  const aiMarketCheckDue=Boolean(currentDate)&&(
    !lastAICheck ||
    gs?._lastAIDriverMarketMonth!==currentMonth ||
    daysBetweenISO(lastAICheck,currentDate)>=7
  );

  if(aiMarketCheckDue){
    const userTeamId=String(gs?.team?.team_id??gs?.team?.id??"");
    const messages=[];

    for(const team of teams){
      const tid=String(team?.team_id??team?.id??"");
      if(!tid||tid===userTeamId)continue;

      const targetRoles=availableContractRoles(next,tid)
        .filter((role)=>["Main Driver","Second Driver","Reserve Driver"].includes(role));

      for(const role of targetRoles){
        const driver=candidateForTeam(next,f1EligibleDrivers,tid);
        if(!driver)break;
        const did=driverIdOf(driver);
        const expected=expectedDriverSalary(next,did);
        const salary=Math.round(expected*salaryMultiplierForRole(role)/5_000)*5_000;
        next=startDriverNegotiation(next,{
          driverId:did,
          teamId:tid,
          teamName:team?.team_name||team?.name||tid,
          offer:{
            salary:Math.max(75_000,salary),
            years:marketRng.chance(0.25)?2:1,
            role,
          },
          origin:"ai",
        });
      }
    }

    const remindPlayerReserve=
      userTeamId &&
      availableContractRoles(next,userTeamId).includes("Reserve Driver") &&
      gs?._lastReserveVacancyReminderMonth!==currentMonth;
    if(remindPlayerReserve){
      messages.push({
        id:`reserve_vacancy_${currentMonth}_${userTeamId}`,
        date:gs?.currentDateISO,
        unread:true,
        type:"STAFF",
        from:"Team Management",
        tag:"Contracts",
        subject:"Reserve Driver position vacant",
        body:"The team has no contracted Reserve Driver. Opening negotiations now reduces the risk of needing a one-race emergency substitute if a race driver becomes unavailable.",
        actions:[{label:"Open Driver Market",route:"/Drivers"}],
      });
    }

    next={
      ...next,
      _lastAIDriverMarketMonth:currentMonth,
      _lastAIDriverMarketCheckISO:currentDate,
      _lastReserveVacancyReminderMonth:remindPlayerReserve?currentMonth:gs?._lastReserveVacancyReminderMonth,
      inbox:[...messages,...(next?.inbox||[])],
    };
  }

  // Keep news meaningful instead of flooding the inbox with the same rumour.
  if(marketRng.next()>=0.045)return next;

  const driver=pickRandom(drivers,marketRng);
  const team=pickRandom(teams,marketRng);
  const driverName=driver?.display_name||driver?.name||"A driver";
  const teamName=team?.short_name||team?.team_name||team?.name||"an F1 team";
  const currentTeam=gs?.team?.short_name||gs?.team?.team_name||gs?.team?.name||"the team";
  const standing=(gs?.standings?.drivers||[]).find(
    (r)=>String(r?.driver_id)===String(driver?.driver_id)
  );

  const templates=[
    {
      type:"PR",from:"Motorsport Press",tag:"Media",
      subject:`Contract Watch — ${driverName}`,
      body:`Sources around the paddock say ${teamName} has started monitoring ${driverName}. No formal approach has been confirmed.`,
    },
    {
      type:"PR",from:"Paddock Reporter",tag:"Media",
      subject:`Driver Form — ${driverName}`,
      body:standing
        ?`${driverName} is currently P${standing.position||"—"} in the championship with ${standing.points||0} points. Rival teams are taking notice.`
        :`${driverName}'s recent form has become a talking point inside the paddock.`,
    },
    {
      type:"DEV",from:"Technical Press",tag:"Development",
      subject:`Technical focus shifts at ${teamName}`,
      body:`${teamName} is believed to be prioritising reliability and race execution in its latest development cycle.`,
    },
    {
      type:"FINANCE",from:"Commercial Desk",tag:"Sponsors",
      subject:"Sponsor market heats up",
      body:`Commercial departments across the grid are reviewing partner portfolios. ${currentTeam} may face stronger competition for premium sponsor slots.`,
    },
    {
      type:"STAFF",from:"Paddock Reporter",tag:"Staff",
      subject:"Staff market movement expected",
      body:"Several technical and management contracts are under review, with teams assessing possible end-of-season moves.",
    },
    {
      type:"OTHER",from:"F1 Newswire",tag:"Championship",
      subject:"Championship pressure builds",
      body:"With the season developing, teams are reassessing targets, budgets and driver priorities before the next run of Grands Prix.",
    },
  ];

  next={
    ...next,
    inbox:[
      {
        id:`news_${String(gs.currentDateISO||"date")}_${marketRng.int(0,0xffffff).toString(36)}`,
        date:gs.currentDateISO,
        unread:true,
        ...pickRandom(templates,marketRng),
      },
      ...(next.inbox||gs.inbox||[]),
    ],
  };
  return next;
}
