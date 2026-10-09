// Build-time reconciliation of race results to managerial Team/Entrant IDs.
// Shared by Season Pack generation and the real-data audit. Never used by races.
import { createTeamConstructorBridgeResolver } from "../../src/domain/teamConstructorBridge.js";
import { historicalText as text, historicalResultYear as yearOf, createHistoricalDriverResolver } from "./historical-results-normalizer.mjs";
export function prepareVerifiedCarResults({
  results=[],teams=[],drivers=[],constructorReference=[],entryRows=[],years=null,
}={}){
  const resolver=createTeamConstructorBridgeResolver({teams,constructorReference,entryRows});
  const resolveDriver=createHistoricalDriverResolver(drivers);
  const prepared=[],coverage=new Map();
  const allowed=years?new Set(years.map(Number)):null;
  for(const row of results){
    const year=yearOf(row);
    if(!Number.isInteger(year)||allowed&&!allowed.has(year))continue;
    const counts=coverage.get(year)||{year,total:0,exact:0,constructorResolved:0,estimated:0,unmappedDriver:0,unmappedTeam:0};
    counts.total++;coverage.set(year,counts);
    const did=resolveDriver(row);
    if(!did){counts.unmappedDriver++;continue;}
    const match=resolver.resolve(row,{driverId:did,year});
    if(!text(match.team_id)){counts.unmappedTeam++;continue;}
    // An unambiguous historical constructor/team match is acceptable for the
    // modern F1 era, but MUST remain labelled inferred rather than exact entrant.
    // Earlier constructor/customer-chassis periods require explicit entrant proof.
    const constructorResolved=year>=1986 &&
      match.relation_basis==="historical_result_resolver" &&
      match.confidence==="MEDIUM";
    if(!match.exact_entrant&&!constructorResolved){counts.estimated++;continue;}
    if(match.exact_entrant)counts.exact++;
    else counts.constructorResolved++;
    prepared.push({
      ...row,year,team_id:text(match.team_id),driver_id:did,
      team_resolution:match.exact_entrant?"exact_entrant":"inferred_historical_constructor",
    });
  }
  return {rows:prepared,coverage:[...coverage.values()].sort((a,b)=>a.year-b.year)};
}
