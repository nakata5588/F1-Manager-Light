import { expectedDriverSalary, makeDriverContract, reserveSeatCount, teamIdOf } from "../domain/driverContracts.js";
import { rngFor } from "../core/random.js";
import { isDriverContract, isRaceDriverContract } from "../domain/contractRoles.js";
import { compareDriverMarketValue, driverMarketEvaluation } from "../domain/driverMarketEvaluation.js";

// src/engine/MarketEngine.js
function pickRandom(arr, rng) {
  return rng.pick(arr);
}

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

export function applyMarketTick(gs) {
  const next = { ...gs };
  const drivers = (gs.drivers || []).filter(
    (d) => !["hidden","junior_only"].includes(String(d?.status || ""))
  );
  const f1EligibleDrivers = drivers.filter((d) => {
    const status=String(d?.status||"").toLowerCase();
    return d?.canHireF1 !== false && !["lower_series","junior_only","hidden","deceased","retired"].includes(status);
  });
  const teams = gs.teams || [];
  if (!drivers.length || !teams.length) return next;

  const currentMonth=String(gs?.currentDateISO||"").slice(0,7);
  const marketRng=rngFor(gs, `market:${String(gs?.currentDateISO||currentMonth||"date")}`);
  if(currentMonth && gs?._lastAIDriverMarketMonth!==currentMonth){
    const userTeamId=String(gs?.team?.team_id??gs?.team?.id??"");
    const contracts=[...(gs?.contracts||[])];
    const marketYear=Number(gs?.activeYear);
    const activeDriverIds=new Set(
      contracts
        .filter((c)=>isDriverContract(c)&&activeContractForYear(c,marketYear))
        .map((c)=>String(c?.driver_id??c?.person_id??c?.id??""))
        .filter(Boolean)
    );
    const free=f1EligibleDrivers
      .filter((d)=>!activeDriverIds.has(String(d?.driver_id??d?.id??"")))
      .sort((a,b)=>compareDriverMarketValue({...gs,contracts},a,b));

    const aiMessages=[];
    for(const team of teams){
      const tid=String(team?.team_id??team?.id??"");
      if(!tid||tid===userTeamId)continue;

      const raceContracts=contracts.filter((c)=>
        teamIdOf(c)===tid &&
        isRaceDriverContract(c) &&
        activeContractForYear(c,marketYear)
      );

      while(raceContracts.length<2 && free.length){
        const driver=free.shift();
        const did=String(driver?.driver_id??driver?.id??"");
        const salary=expectedDriverSalary({...gs,contracts},did);
        const role=raceContracts.length===0?"Main Driver":"Second Driver";
        const contract=makeDriverContract({
          gs:{...gs,contracts},
          driver,
          teamId:tid,
          teamName:team?.team_name||team?.name||tid,
          offer:{salary,years:1,role},
          source:"ai_market_fill",
        });
        contract.market_evaluation=driverMarketEvaluation({...gs,contracts},driver);
        contracts.push(contract);
        raceContracts.push(contract);
        activeDriverIds.add(did);
        aiMessages.push({
          id:`ai_contract_${String(gs?.currentDateISO||currentMonth)}_${tid}_${did}`,
          date:gs?.currentDateISO,
          unread:true,
          type:"PR",
          from:"Paddock Reporter",
          tag:"Contracts",
          subject:`${driver?.display_name||driver?.name||did} joins ${team?.team_name||team?.name||tid}`,
          body:`The team filled a vacant ${role.toLowerCase()} seat for the current season.`,
        });
      }

      if(reserveSeatCount({...gs,contracts},tid)<1 && free.length){
        const reserveDriver=free.shift();
        const reserveId=String(reserveDriver?.driver_id??reserveDriver?.id??"");
        const salary=expectedDriverSalary({...gs,contracts},reserveId);
        const contract=makeDriverContract({
          gs:{...gs,contracts},
          driver:reserveDriver,
          teamId:tid,
          teamName:team?.team_name||team?.name||tid,
          offer:{salary,years:1,role:"Reserve Driver"},
          source:"ai_reserve_fill",
        });
        contract.market_evaluation=driverMarketEvaluation({...gs,contracts},reserveDriver);
        contracts.push(contract);
        activeDriverIds.add(reserveId);
      }
    }

    if(userTeamId && reserveSeatCount({...gs,contracts},userTeamId)<1){
      aiMessages.unshift({
        id:`reserve_vacancy_${currentMonth}_${userTeamId}`,
        date:gs?.currentDateISO,
        unread:true,
        type:"STAFF",
        from:"Team Management",
        tag:"Contracts",
        subject:"Reserve Driver position vacant",
        body:"The team has no contracted Reserve Driver. Signing one now reduces the risk of needing a one-race emergency substitute if a race driver becomes unavailable.",
        actions:[{label:"Open Drivers Market",route:"/Drivers"}],
      });
    }
    next.contracts=contracts;
    next._lastAIDriverMarketMonth=currentMonth;
    if(aiMessages.length) next.inbox=[...aiMessages,...(gs?.inbox||[])];
  }

  // Keep news meaningful instead of flooding the inbox with the same rumour.
  if (marketRng.next() >= 0.045) return next;

  const driver = pickRandom(drivers, marketRng);
  const team = pickRandom(teams, marketRng);
  const driverName = driver?.display_name || driver?.name || "A driver";
  const teamName = team?.short_name || team?.team_name || team?.name || "an F1 team";
  const currentTeam = gs?.team?.short_name || gs?.team?.team_name || gs?.team?.name || "the team";
  const standing = (gs?.standings?.drivers || []).find(
    (r) => String(r?.driver_id) === String(driver?.driver_id)
  );

  const templates = [
    {
      type:"PR", from:"Motorsport Press", tag:"Media",
      subject:`Contract Watch — ${driverName}`,
      body:`Sources around the paddock say ${teamName} has started monitoring ${driverName}. No formal approach has been confirmed.`,
    },
    {
      type:"PR", from:"Paddock Reporter", tag:"Media",
      subject:`Driver Form — ${driverName}`,
      body:standing
        ? `${driverName} is currently P${standing.position || "—"} in the championship with ${standing.points || 0} points. Rival teams are taking notice.`
        : `${driverName}'s recent form has become a talking point inside the paddock.`,
    },
    {
      type:"DEV", from:"Technical Press", tag:"Development",
      subject:`Technical focus shifts at ${teamName}`,
      body:`${teamName} is believed to be prioritising reliability and race execution in its latest development cycle.`,
    },
    {
      type:"FINANCE", from:"Commercial Desk", tag:"Sponsors",
      subject:"Sponsor market heats up",
      body:`Commercial departments across the grid are reviewing partner portfolios. ${currentTeam} may face stronger competition for premium sponsor slots.`,
    },
    {
      type:"STAFF", from:"Paddock Reporter", tag:"Staff",
      subject:"Staff market movement expected",
      body:"Several technical and management contracts are under review, with teams assessing possible end-of-season moves.",
    },
    {
      type:"OTHER", from:"F1 Newswire", tag:"Championship",
      subject:"Championship pressure builds",
      body:"With the season developing, teams are reassessing targets, budgets and driver priorities before the next run of Grands Prix.",
    },
  ];

  next.inbox = [
    {
      id:`news_${String(gs.currentDateISO||"date")}_${marketRng.int(0, 0xffffff).toString(36)}`,
      date:gs.currentDateISO,
      unread:true,
      ...pickRandom(templates, marketRng),
    },
    ...(next.inbox || gs.inbox || []),
  ];
  return next;
}
