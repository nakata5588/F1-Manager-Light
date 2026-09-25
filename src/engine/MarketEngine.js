import {
  contractActiveForYear,
  expiringDriverContracts,
  expectedDriverSalary,
  teamIdOf,
} from "../domain/driverContracts.js";
import { rngFor } from "../core/random.js";
import { contractRoleLabel, isDriverContract, isRaceDriverContract, isReserveDriverContract, isTestDriverContract } from "../domain/contractRoles.js";
import { driverMarketEvaluation } from "../domain/driverMarketEvaluation.js";
import { f1HireEligibility } from "../domain/driverEligibility.js";
import {
  availableContractRoles,
  driverNegotiations,
  isNegotiationActive,
  startDriverNegotiation,
  startDriverRenewal,
} from "./NegotiationEngine.js";
import { relationshipRenewalRetentionDelta } from "../domain/driverRelationshipConsequences.js";
import { aiLineupUpgradeOpportunity, rankAiRecruitmentCandidates } from "../domain/aiDriverLineup.js";

// src/engine/MarketEngine.js
function pickRandom(arr,rng){return rng.pick(arr);}

function driverIdOf(row){
  return String(row?.driver_id??row?.person_id??row?.id??"");
}

function driverNameFor(gs,driverId){
  const id=String(driverId||"");
  const driver=(gs?.drivers||[]).find((row)=>driverIdOf(row)===id)
    ||(gs?.dbDrivers||[]).find((row)=>driverIdOf(row)===id);
  return driver?.display_name||driver?.name||id;
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

function candidateForTeam(gs,drivers,teamId,role){
  const activeDriverIds=new Set(
    (gs?.contracts||[])
      .filter((c)=>isDriverContract(c)&&contractActiveForYear(c,Number(gs?.activeYear)))
      .map(driverIdOf)
      .filter(Boolean)
  );
  const candidates=drivers
    .filter((d)=>!activeDriverIds.has(driverIdOf(d)))
    .filter((d)=>!driverNegotiations(gs).some((n)=>
      isNegotiationActive(n)&&
      String(n.team_id)===String(teamId)&&
      String(n.driver_id)===driverIdOf(d)
    ));

  const ranked=rankAiRecruitmentCandidates(gs,candidates,teamId,role,{
    activeOfferCount:(driverId)=>activeOfferCount(gs,driverId),
  });
  return ranked[0]?.driver||null;
}

function renewalRetentionChance(gs,contract){
  const driverId=driverIdOf(contract);
  const evaluation=driverMarketEvaluation(gs,driverId);
  const score=Number(evaluation?.score||55);
  let chance=0.52+(score-55)*0.012;
  if(isRaceDriverContract(contract))chance+=0.10;
  if(isReserveDriverContract(contract))chance-=0.05;
  if(isTestDriverContract(contract))chance-=0.08;
  chance+=relationshipRenewalRetentionDelta(gs,driverId,{teamId:teamIdOf(contract)});
  return Math.max(0.15,Math.min(0.90,chance));
}

function markRenewalDecision(gs,contract,year,decision){
  return {
    ...gs,
    contracts:(gs?.contracts||[]).map((row)=>row===contract?{
      ...row,
      ai_renewal_decision_year:year,
      ai_renewal_plan:decision,
    }:row),
  };
}

export function applyMarketTick(gs){
  let next={...gs};
  const drivers=(gs.drivers||[]).filter((d)=>
    !["hidden","deceased","retired"].includes(String(d?.status||"").toLowerCase())
  );
  const f1EligibleDrivers=drivers.filter((d)=>f1HireEligibility(gs,d,gs?.activeYear).eligible);
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

      // From July onward AI teams make a genuine keep/release decision on
      // contracts ending this season. Rejected renewal talks are not silently
      // converted into continuity extensions at the season boundary.
      const monthNumber=Number(currentDate.slice(5,7));
      if(monthNumber>=7){
        const expiring=expiringDriverContracts(next,{teamId:tid});
        for(const contract of expiring){
          if(Number(contract?.ai_renewal_decision_year)===Number(next?.activeYear))continue;
          const retain=marketRng.chance(renewalRetentionChance(next,contract));
          next=markRenewalDecision(next,contract,Number(next?.activeYear),retain?"renew":"release_end");
          if(!retain)continue;

          const did=driverIdOf(contract);
          const role=contractRoleLabel(contract);
          const expected=expectedDriverSalary(next,did,{role});
          const currentSalary=Number(contract?.salary??contract?.salary_yearly??0);
          const salary=Math.round(Math.max(expected,currentSalary*1.04)/5_000)*5_000;
          next=startDriverRenewal(next,{
            driverId:did,
            teamId:tid,
            teamName:team?.team_name||team?.name||tid,
            offer:{
              salary:Math.max(75_000,salary),
              years:marketRng.chance(0.35)?2:1,
              role,
            },
            origin:"ai",
          });
        }
      }

      const targetRoles=availableContractRoles(next,tid)
        .filter((role)=>["Main Driver","Second Driver","Reserve Driver"].includes(role));

      for(const role of targetRoles){
        const driver=candidateForTeam(next,f1EligibleDrivers,tid,role);
        if(!driver)break;
        const did=driverIdOf(driver);
        const expected=expectedDriverSalary(next,did,{role});
        const salary=Math.round(expected/5_000)*5_000;
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

      // D7.1B: a full race line-up is not automatically a good line-up.
      // Once vacancies are handled, AI teams may pursue one materially better
      // free agent to upgrade the Second/Main hierarchy. Contracted-driver
      // poaching remains deliberately reserved for D7.4 Transfer Intelligence.
      const hasActiveUpgrade=driverNegotiations(next).some((n)=>
        isNegotiationActive(n)&&
        String(n.team_id)===tid&&
        Boolean(n?.lineup_upgrade?.target_driver_id)
      );
      if(!hasActiveUpgrade){
        const upgradePool=f1EligibleDrivers.filter((driver)=>{
          const did=driverIdOf(driver);
          return !driverNegotiations(next).some((n)=>
            isNegotiationActive(n)&&
            String(n.team_id)===tid&&
            String(n.driver_id)===did
          );
        });
        const opportunity=aiLineupUpgradeOpportunity(next,upgradePool,tid,{
          activeOfferCount:(driverId)=>activeOfferCount(next,driverId),
        });
        if(opportunity){
          next=startDriverNegotiation(next,{
            driverId:opportunity.driver_id,
            teamId:tid,
            teamName:team?.team_name||team?.name||tid,
            offer:{
              salary:opportunity.salary,
              years:opportunity.years,
              role:opportunity.offered_role,
            },
            origin:"ai",
            lineupUpgrade:{
              targetDriverId:opportunity.target_driver_id,
              upgradeGap:opportunity.upgrade_gap,
              candidateScore:opportunity.candidate_score,
              targetScore:opportunity.second_score,
            },
          });
        }
      }
    }

    const playerExpiring=userTeamId
      ?expiringDriverContracts(next,{teamId:userTeamId})
      :[];
    const expiryReminderDue=
      Number(currentDate.slice(5,7))>=7 &&
      playerExpiring.length>0 &&
      Number(gs?._lastContractExpiryReminderYear)!==Number(next?.activeYear);
    if(expiryReminderDue){
      const names=playerExpiring.map((contract)=>
        contract?.driver_name||driverNameFor(next,driverIdOf(contract))
      ).join(", ");
      messages.push({
        id:`contract_expiry_${next?.activeYear}_${userTeamId}`,
        date:currentDate,
        unread:true,
        type:"STAFF",
        from:"Driver Management",
        tag:"Contracts",
        subject:"Driver contracts expiring this season",
        body:"The following contracts expire at the end of "+next.activeYear+": "+names+". Renew them from My Drivers if you want to keep them.",
        actions:[{label:"Manage driver contracts",route:"/MyDrivers"}],
      });
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
      _lastContractExpiryReminderYear:expiryReminderDue?Number(next?.activeYear):gs?._lastContractExpiryReminderYear,
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
