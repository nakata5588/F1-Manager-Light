// src/engine/MarketEngine.js
import { ensureAIDriverLineups } from "../domain/contractEngine.js";

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function applyMarketTick(gs) {
  let next = { ...gs };
  const drivers = (gs.drivers || []).filter(
    (d) => !["hidden","junior_only"].includes(String(d?.status || ""))
  );
  const teams = gs.teams || [];
  if (!drivers.length || !teams.length) return next;

  // AI teams must always repair genuine vacancies. This is stateful gameplay,
  // not a news template: a driver bought out by the player leaves a real seat.
  const aiMarket = ensureAIDriverLineups(next);
  if (aiMarket.signings.length) {
    next = {
      ...next,
      contracts: aiMarket.contracts,
      inbox: [
        ...aiMarket.signings.slice(0,4).map((c,idx)=>({
          id:"ai_signing_"+String(c.driver_id)+"_"+String(c.team_id)+"_"+Date.now()+"_"+idx,
          date:next.currentDateISO,
          unread:true,
          type:"CONTRACT",
          from:"Paddock Reporter",
          tag:"Drivers",
          subject:"Driver signing — "+String(c.team_name||c.team_id),
          body:String(c.team_name||c.team_id)+" has signed "+String(c.driver_name||c.driver_id)+" as "+String(c.role||"Driver")+".",
        })),
        ...(next.inbox||[]),
      ],
    };
  }

  // Keep general news meaningful instead of flooding the inbox.
  if (Math.random() >= 0.045) return next;

  const driver = pickRandom(drivers);
  const team = pickRandom(teams);
  const driverName = driver?.display_name || driver?.name || "A driver";
  const teamName = team?.short_name || team?.team_name || team?.name || "an F1 team";
  const currentTeam = next?.team?.short_name || next?.team?.team_name || next?.team?.name || "the team";
  const standing = (next?.standings?.drivers || []).find(
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
      date:next.currentDateISO,
      unread:true,
      ...pickRandom(templates),
    },
    ...(next.inbox || []),
  ];
  return next;
}
