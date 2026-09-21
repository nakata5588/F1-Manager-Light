import React, { useEffect, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useGame } from "@/state/GameStore";
import { carPerformanceRanking, teamCarPerformance } from "@/domain/carPerformance";
import {
  CAR_COMPONENT_SLOTS,
  componentConditionForCar,
  componentConditionStatus,
  installedPartsForCar,
  syncGarageState,
} from "@/domain/garage";

const idOf=(o)=>String(o?.driver_id??o?.person_id??o?.id??"");
const nice=(s)=>String(s||"").replaceAll("_"," ").replace(/\b\w/g,(m)=>m.toUpperCase());

export default function Car(){
  const gs=useGame((s)=>s.gameState);
  const setGameState=useGame((s)=>s.setGameState);
  const teamId=String(gs?.team?.team_id??gs?.team?.id??"");
  const teamName=gs?.team?.team_name||gs?.team?.name||teamId||"My Team";
  const drivers=gs?.drivers||[];
  const parts=gs?.development?.parts||[];

  const syncedGarage=useMemo(()=>syncGarageState(gs,gs?.garage||{}),[
    gs?.garage,
    gs?.contracts,
    gs?.activeYear,
    teamId,
  ]);

  useEffect(()=>{
    const current=JSON.stringify(gs?.garage?.cars||[]);
    const wanted=JSON.stringify(syncedGarage?.cars||[]);
    if(current!==wanted)setGameState({garage:syncedGarage});
  },[currentKey(gs?.garage?.cars),currentKey(syncedGarage?.cars)]); // eslint-disable-line react-hooks/exhaustive-deps

  const driverById=useMemo(()=>new Map(drivers.map((d)=>[idOf(d),d])),[drivers]);
  const partById=useMemo(()=>new Map(parts.map((p)=>[String(p.id),p])),[parts]);
  const ranking=useMemo(()=>carPerformanceRanking({...gs,garage:syncedGarage}),[gs,syncedGarage]);
  const myRank=ranking.find((r)=>String(r.team_id)===teamId);

  const updateGarageAndParts=(cars,nextParts)=>{
    setGameState({
      garage:{...syncedGarage,cars},
      development:{...(gs.development||{}),parts:nextParts},
    });
  };

  const fitPart=(car,part)=>{
    const slot=String(part?.slot||"");
    if(!slot||Number(part?.inv||0)<=0)return;
    const oldId=car?.installedParts?.[slot];
    if(String(oldId||"")===String(part.id))return;

    const nextParts=parts.map((p)=>{
      if(String(p.id)===String(part.id))return {...p,inv:Math.max(0,Number(p.inv||0)-1)};
      if(oldId&&String(p.id)===String(oldId))return {...p,inv:Number(p.inv||0)+1};
      return p;
    });
    const cars=syncedGarage.cars.map((c)=>c.id===car.id
      ? {...c,installedParts:{...(c.installedParts||{}),[slot]:part.id}}
      : c
    );
    updateGarageAndParts(cars,nextParts);
  };

  const removePart=(car,slot)=>{
    const oldId=car?.installedParts?.[slot];
    if(!oldId)return;
    const nextParts=parts.map((p)=>String(p.id)===String(oldId)?{...p,inv:Number(p.inv||0)+1}:p);
    const installed={...(car.installedParts||{})};
    delete installed[slot];
    const cars=syncedGarage.cars.map((c)=>c.id===car.id?{...c,installedParts:installed}:c);
    updateGarageAndParts(cars,nextParts);
  };

  const replaceBaseComponent=(car,slot)=>{
    if(car?.installedParts?.[slot])return;
    const before=componentConditionForCar({...gs,garage:syncedGarage},car,slot);
    if(before>=99.5)return;
    const cars=syncedGarage.cars.map((c)=>{
      if(c.id!==car.id)return c;
      return {
        ...c,
        componentCondition:{
          ...(c.componentCondition||{}),
          [slot]:100,
        },
      };
    });
    setGameState({
      garage:{...syncedGarage,cars},
      componentServiceLog:[
        {
          date:String(gs?.currentDateISO||"").slice(0,10),
          car_id:car.id,
          slot,
          condition_before:Number(before.toFixed(1)),
          condition_after:100,
          action:"replace_base_component",
        },
        ...(Array.isArray(gs?.componentServiceLog)?gs.componentServiceLog:[]),
      ].slice(0,200),
    });
  };

  return <div className="p-4 md:p-6 space-y-5">
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold">Car & Garage</h1>
        <p className="text-sm text-muted-foreground">{teamName} · Season {gs?.activeYear||"—"} · fitted parts affect race performance.</p>
      </div>
      <div className="flex-1"/>
      {myRank&&<div className="text-sm border rounded-lg px-3 py-2 bg-white">
        Grid car rank <strong>#{myRank.rank}</strong> · Overall <strong>{myRank.overall.toFixed(1)}</strong>
      </div>}
    </div>

    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      {(syncedGarage?.cars||[]).map((car)=>{
        const driver=driverById.get(String(car.driver_id||""));
        const perf=teamCarPerformance({...gs,garage:syncedGarage},teamId,car.driver_id);
        const carState={...gs,garage:syncedGarage};
        const fitted=installedPartsForCar(carState,car);
        const componentRows=CAR_COMPONENT_SLOTS.map((slot)=>{
          const condition=componentConditionForCar(carState,car,slot);
          const installed=fitted.find((row)=>row.slot===slot)||null;
          return {slot,condition,status:componentConditionStatus(condition),installed};
        });
        const averageCondition=componentRows.reduce((sum,row)=>sum+row.condition,0)/Math.max(1,componentRows.length);
        return <Card key={car.id}><CardContent className="p-4 space-y-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-muted-foreground">{car.kind==="reserve"?"Spare chassis":"Race chassis"}</div>
            <div className="text-xl font-semibold">{car.label}</div>
            <div className="text-sm">{driver?.display_name||driver?.name||"No driver assigned"}</div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Metric label="Overall" value={perf.overall}/>
            <Metric label="Qualifying" value={perf.qualifying}/>
            <Metric label="Race" value={perf.race}/>
            <Metric label="Reliability" value={perf.reliability}/>
            <Metric label="Chassis" value={perf.chassis}/>
            <Metric label="Component health" value={averageCondition}/>
          </div>

          <div>
            <div className="flex items-start justify-between gap-3 mb-2">
              <div>
                <div className="text-sm font-semibold">Component condition</div>
                <div className="text-xs text-muted-foreground">Practice, qualifying incidents and races now degrade the live car. Worn components reduce pace and reliability.</div>
              </div>
              {(perf?.wear_penalty?.reliability||0)<-0.1&&(
                <div className="text-xs text-amber-700 text-right">Reliability impact {Number(perf.wear_penalty.reliability).toFixed(1)}</div>
              )}
            </div>
            <div className="space-y-2">
              {componentRows.map((row)=>(
                <div key={row.slot} className="border rounded-lg p-2 flex flex-wrap items-center gap-2">
                  <div className="min-w-[120px] flex-1">
                    <div className="text-xs text-muted-foreground">{nice(row.slot)}</div>
                    <div className="text-sm font-medium">{row.installed?.part?.name||"Standard component"}</div>
                  </div>
                  <div className="w-24">
                    <div className="text-xs text-muted-foreground">Condition</div>
                    <div className="font-semibold">{row.condition.toFixed(1)}%</div>
                  </div>
                  <div className="w-20 text-xs">{row.status.label}</div>
                  {!row.installed&&(
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={row.condition>=99.5}
                      onClick={()=>replaceBaseComponent(car,row.slot)}
                    >
                      Replace
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="text-sm font-semibold mb-2">Installed developed parts</div>
            <div className="space-y-2">
              {fitted.map(({slot,part})=><div key={slot} className="border rounded-lg p-2 flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-muted-foreground">{nice(slot)}</div>
                  <div className="text-sm font-medium truncate">{part.name} · +{Number(part.perf||0).toFixed(2)}</div>
                </div>
                <Button size="sm" variant="outline" onClick={()=>removePart(car,slot)}>Remove</Button>
              </div>)}
              {!fitted.length&&<div className="text-sm text-muted-foreground">No developed parts fitted. Standard components still wear and are tracked above.</div>}
            </div>
          </div>

          <div>
            <div className="text-sm font-semibold mb-2">Available inventory</div>
            <div className="space-y-2 max-h-52 overflow-y-auto">
              {parts.filter((p)=>Number(p.inv||0)>0).map((part)=><div key={part.id} className="flex items-center gap-2 border rounded-lg p-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{part.name}</div>
                  <div className="text-xs text-muted-foreground">{nice(part.slot)} · +{Number(part.perf||0).toFixed(2)} · stock {Number(part.inv||0)}</div>
                </div>
                <Button size="sm" onClick={()=>fitPart(car,part)}>Fit</Button>
              </div>)}
              {!parts.some((p)=>Number(p.inv||0)>0)&&<div className="text-sm text-muted-foreground">Manufacture a developed part to create inventory.</div>}
            </div>
          </div>
        </CardContent></Card>;
      })}
    </div>

    <Card><CardContent className="p-0 overflow-x-auto">
      <div className="p-4 border-b">
        <div className="font-semibold">Grid car performance</div>
        <div className="text-xs text-muted-foreground">Same performance model used by qualifying and race simulation.</div>
      </div>
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50"><tr>
          <th className="px-3 py-2 text-left">#</th>
          <th className="px-3 py-2 text-left">Team</th>
          <th className="px-3 py-2 text-right">Overall</th>
          <th className="px-3 py-2 text-right">Qualifying</th>
          <th className="px-3 py-2 text-right">Race</th>
          <th className="px-3 py-2 text-right">Reliability</th>
          <th className="px-3 py-2 text-right">Chassis</th>
          <th className="px-3 py-2 text-right">Power</th>
        </tr></thead>
        <tbody>{ranking.map((row)=><tr key={row.team_id} className={String(row.team_id)===teamId?"border-t bg-blue-50":"border-t"}>
          <td className="px-3 py-2">{row.rank}</td>
          <td className="px-3 py-2 font-medium">{row.team_name}</td>
          <td className="px-3 py-2 text-right">{row.overall.toFixed(1)}</td>
          <td className="px-3 py-2 text-right">{row.qualifying.toFixed(1)}</td>
          <td className="px-3 py-2 text-right">{row.race.toFixed(1)}</td>
          <td className="px-3 py-2 text-right">{row.reliability.toFixed(1)}</td>
          <td className="px-3 py-2 text-right">{row.chassis.toFixed(1)}</td>
          <td className="px-3 py-2 text-right">{row.power.toFixed(1)}</td>
        </tr>)}</tbody>
      </table>
    </CardContent></Card>
  </div>;
}

function Metric({label,value}){return <div className="border rounded p-2"><div className="text-[10px] uppercase text-muted-foreground">{label}</div><div className="text-lg font-semibold">{Number(value||0).toFixed(1)}</div></div>;}
function currentKey(value){try{return JSON.stringify(value||[]);}catch{return "";}}
