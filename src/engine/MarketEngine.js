import { expectedDriverSalary, makeDriverContract, teamIdOf } from "../domain/driverContracts.js";

// src/engine/MarketEngine.js
function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
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
  if(currentMonth && gs?._lastAIDriverMarketMonth!==currentMonth){
    const userTeamId=String(gs?.team?.team_id??gs?.team?.id??"");
    const contracts=[...(gs?.contracts||[])];
    const ratingById=new Map((gs?.driverRatings||[]).map((r)=>[String(r?.driver_id??r?.id??""),r]));

    const activeDriverIds=new Set(
      contracts.map((c)=>String(c?.driver_id??c?.person_id??c?.id??"")).filter(Boolean)
    );
    const free=f1EligibleDrivers
      .filter((d)=>!activeDriverIds.has(String(d?.driver_id??d?.id??"")))
      .sort((a,b)=>{
        const ar=ratingById.get(String(a?.driver_id??a?.id??""))||{};
        const br=ratingById.get(String(b?.driver_id??b?.id??""))||{};
        return Number(br?.current_ability??br?.pace??0)-Number(ar?.current_ability??ar?.pace??0);
      });

    const aiMessages=[];
    for(const team of teams){
      const tid=String(team?.team_id??team?.id??"");
      if(!tid||tid===userTeamId)continue;
      const raceContracts=contracts.filter((c)=>{
        if(teamIdOf(c)!==tid)return false;
        const role=String(c?.role??c?.position??"driver").toLowerCase();
        return /main|second|race|driver/.test(role) && !/reserve|test/.test(role);
      });
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
        contracts.push(contract);
        raceContracts.push(contract);
        activeDriverIds.add(did);
        aiMessages.push({
          id:`ai_contract_${Date.now()}_${tid}_${did}`,
          date:gs?.currentDateISO,
          unread:true,
          type:"PR",
          from:"Paddock Reporter",
          tag:"Contracts",
          subject:`${driver?.display_name||driver?.name||did} joins ${team?.team_name||team?.name||tid}`,
          body:`The team filled a vacant ${role.toLowerCase()} seat for the current season.`,
        });
      }
    }
    next.contracts=contracts;
    next._lastAIDriverMarketMonth=currentMonth;
    if(aiMessages.length) next.inbox=[...aiMessages,...(gs?.inbox||[])];
  }

  // Keep news meaningful instead of flooding the inbox with the same rumour.
  if (Math.random() >= 0.045) return next;

  const driver = pickRandom(drivers);
  const team = pickRandom(teams);
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
      id:`news_${Date.now()}_${Math.random().toString(36).slice(2,6)}`,
      date:gs.currentDateISO,
      unread:true,
      ...pickRandom(templates),
    },
    ...(next.inbox || gs.inbox || []),
  ];
  return next;
}
