import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "../components/ui/select";
import { useGame } from "../state/GameStore";
import {
  DEFAULT_DISPLAY_SETTINGS,
  DEFAULT_USER_SETTINGS,
  contentMaxForLayout,
  effectiveUiScale,
  mergeUserSettings,
  readUserSettings,
  viewportLayout,
} from "../domain/userPreferences.js";

function initialSettings(gameState){
  const global=readUserSettings();
  return mergeUserSettings({
    ...global,
    ...(gameState?.settings||{}),
    display:{...global.display,...(gameState?.settings?.display||{})},
  });
}

function titleCase(value){
  return String(value||"").replace(/_/g," ").replace(/w/g,(m)=>m.toUpperCase());
}

export default function Settings(){
  const fileRef=useRef(null);
  const {gameState,saveGame}=useGame();
  const [draft,setDraft]=useState(()=>initialSettings(gameState));
  const [status,setStatus]=useState("");
  const [viewport,setViewport]=useState(()=>({
    width:typeof window!=="undefined"?window.innerWidth:1440,
    height:typeof window!=="undefined"?window.innerHeight:900,
  }));
  const [fullscreen,setFullscreen]=useState(()=>typeof document!=="undefined"&&Boolean(document.fullscreenElement));

  useEffect(()=>{
    const onResize=()=>setViewport({width:window.innerWidth,height:window.innerHeight});
    const onFullscreen=()=>setFullscreen(Boolean(document.fullscreenElement));
    window.addEventListener("resize",onResize);
    document.addEventListener("fullscreenchange",onFullscreen);
    return ()=>{
      window.removeEventListener("resize",onResize);
      document.removeEventListener("fullscreenchange",onFullscreen);
    };
  },[]);

  const detectedLayout=viewportLayout(viewport.width,viewport.height);
  const effectiveScale=effectiveUiScale(draft.display.uiScale,viewport.width,viewport.height);
  const contentMax=contentMaxForLayout(detectedLayout);

  const set=(path,value)=>{
    setDraft((prev)=>{
      const next=structuredClone(prev);
      const parts=path.split(".");
      let node=next;
      for(let i=0;i<parts.length-1;i++){
        if(!node[parts[i]]||typeof node[parts[i]]!=="object")node[parts[i]]={};
        node=node[parts[i]];
      }
      node[parts.at(-1)]=value;
      return next;
    });
  };

  const commit=(next)=>{
    try{
      const normalized=mergeUserSettings(next);
      useGame.getState().updateSettings(normalized);
      if(typeof saveGame==="function")saveGame();
      setDraft(normalized);
      setStatus("Settings applied.");
      setTimeout(()=>setStatus(""),2200);
    }catch(error){
      console.error(error);
      setStatus("Unable to apply settings.");
    }
  };

  const handleApply=()=>commit(draft);
  const handleResetDisplay=()=>setDraft((prev)=>mergeUserSettings({...prev,display:{...DEFAULT_DISPLAY_SETTINGS},uiTheme:DEFAULT_USER_SETTINGS.uiTheme}));
  const handleResetDefaults=()=>setDraft(mergeUserSettings(DEFAULT_USER_SETTINGS));

  const handleExport=()=>{
    const blob=new Blob([JSON.stringify(draft,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;
    a.download="f1ml_settings.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport=(event)=>{
    const file=event.target.files?.[0];
    if(!file)return;
    const reader=new FileReader();
    reader.onload=()=>{
      try{
        setDraft(mergeUserSettings(JSON.parse(reader.result)));
        setStatus("Imported. Review and Apply to confirm.");
      }catch{
        setStatus("Invalid settings JSON.");
      }
    };
    reader.readAsText(file);
  };

  const toggleFullscreen=async()=>{
    try{
      if(document.fullscreenElement)await document.exitFullscreen?.();
      else await document.documentElement.requestFullscreen?.();
    }catch(error){
      setStatus("Fullscreen is not available in this browser/window.");
    }
  };

  const years=useMemo(()=>{
    const cal=gameState?.calendar||[];
    const values=Array.from(new Set(cal.map((row)=>String(row?.year??row?.season_year??String(row?.date||row?.race_date||"").slice(0,4))).filter(Boolean)));
    return values.length?values:["1980"];
  },[gameState?.calendar]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Settings</h1>
          <p className="mt-1 text-sm text-slate-400">User preferences are global and stay the same across careers.</p>
        </div>
        <div className="flex-1"/>
        {status?<div className="text-sm text-emerald-400">{status}</div>:null}
      </div>

      <Card className="rounded-2xl border-white/10 bg-[#12141c] text-slate-100">
        <CardContent className="space-y-5 p-4 md:p-6">
          <div className="flex flex-wrap items-start gap-3">
            <div>
              <h2 className="text-lg font-semibold">Display & Interface</h2>
              <p className="mt-1 text-xs text-slate-500">The layout always reacts to the available browser window. UI Scale changes density without forcing a fixed resolution.</p>
            </div>
            <div className="flex-1"/>
            <Button variant="outline" onClick={handleResetDisplay}>Reset display</Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Current viewport</div>
              <div className="mt-1 text-xl font-semibold">{viewport.width} × {viewport.height}</div>
              <div className="mt-1 text-xs text-slate-500">Browser content area</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Detected layout</div>
              <div className="mt-1 text-xl font-semibold">{titleCase(detectedLayout)}</div>
              <div className="mt-1 text-xs text-slate-500">Content width up to {contentMax}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Effective UI scale</div>
              <div className="mt-1 text-xl font-semibold">{titleCase(effectiveScale)}</div>
              <div className="mt-1 text-xs text-slate-500">{draft.display.uiScale==="auto"?"Chosen automatically":"Manual override"}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Display mode</div>
              <div className="mt-1 text-xl font-semibold">{fullscreen?"Fullscreen":"Windowed"}</div>
              <button type="button" onClick={toggleFullscreen} className="mt-1 text-xs text-sky-300 hover:underline">{fullscreen?"Exit fullscreen":"Enter fullscreen"}</button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="space-y-2">
              <label className="text-sm text-slate-400">UI Scale</label>
              <Select value={draft.display.uiScale} onValueChange={(v)=>set("display.uiScale",v)}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto (Recommended)</SelectItem>
                  <SelectItem value="compact">Compact</SelectItem>
                  <SelectItem value="standard">Standard</SelectItem>
                  <SelectItem value="large">Large</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-slate-600">Auto considers both viewport width and height.</p>
            </div>

            <div className="space-y-2">
              <label className="text-sm text-slate-400">Information Density</label>
              <Select value={draft.display.informationDensity} onValueChange={(v)=>set("display.informationDensity",v)}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-slate-600">Controls shell spacing; individual screens can progressively adopt it.</p>
            </div>

            <div className="space-y-2">
              <label className="text-sm text-slate-400">Theme</label>
              <Select value={draft.uiTheme} onValueChange={(v)=>set("uiTheme",v)}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                  <SelectItem value="light">Light</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-slate-600">Auto follows the operating-system preference.</p>
            </div>

            <div className="space-y-2">
              <label className="text-sm text-slate-400">Animations</label>
              <Select value={draft.display.animations} onValueChange={(v)=>set("display.animations",v)}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto</SelectItem>
                  <SelectItem value="full">Full</SelectItem>
                  <SelectItem value="reduced">Reduced</SelectItem>
                  <SelectItem value="off">Off</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[11px] text-slate-600">Auto respects the system reduced-motion preference.</p>
            </div>

            <div className="space-y-2">
              <label className="text-sm text-slate-400">Language</label>
              <Select value={draft.language} onValueChange={(v)=>set("language",v)}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="pt">Português</SelectItem>
                  <SelectItem value="es">Español</SelectItem>
                  <SelectItem value="fr">Français</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm text-slate-400">Date format</label>
              <Input value={draft.dateFormat} onChange={(e)=>set("dateFormat",e.target.value)}/>
            </div>
          </div>

          <div className="flex flex-wrap gap-5">
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={draft.display.tooltips!==false} onChange={(e)=>set("display.tooltips",e.target.checked)}/>
              <span>Enable contextual tooltips</span>
            </label>
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={draft.display.responsiveLayout!==false} onChange={(e)=>set("display.responsiveLayout",e.target.checked)}/>
              <span>Responsive screen layout</span>
            </label>
          </div>

          <div className="rounded-lg border border-sky-400/15 bg-sky-400/[0.05] p-3 text-xs text-slate-400">
            Layout classification: <b className="text-slate-200">Compact &lt;1280</b> · <b className="text-slate-200">Standard 1280–1599</b> · <b className="text-slate-200">Wide 1600–1919</b> · <b className="text-slate-200">Ultra-wide ≥1920</b>. The game reacts to the available window, not the monitor's advertised resolution.
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-white/10 bg-[#12141c] text-slate-100">
        <CardContent className="space-y-4 p-4 md:p-6">
          <h2 className="text-lg font-semibold">Gameplay</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <label className="text-sm text-slate-400">Difficulty</label>
              <Select value={draft.gameplay.difficulty} onValueChange={(v)=>set("gameplay.difficulty",v)}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="easy">Easy</SelectItem>
                  <SelectItem value="normal">Normal</SelectItem>
                  <SelectItem value="hard">Hard</SelectItem>
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-slate-400">Simulation speed (×)</label>
              <Input type="number" min={0.25} max={8} step={0.25} value={draft.gameplay.simSpeed} onChange={(e)=>set("gameplay.simSpeed",Number(e.target.value)||1)}/>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-slate-400">Rules era / Year</label>
              <Select value={draft.gameplay.rulesEra} onValueChange={(v)=>set("gameplay.rulesEra",v)}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>{years.map((year)=><SelectItem key={year} value={String(year)}>{year}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <label className="flex items-center gap-3"><input type="checkbox" className="h-4 w-4" checked={draft.gameplay.enableInjuryRandomEvents} onChange={(e)=>set("gameplay.enableInjuryRandomEvents",e.target.checked)}/><span>Random driver injury events</span></label>
            <label className="flex items-center gap-3"><input type="checkbox" className="h-4 w-4" checked={draft.gameplay.enableFatalities!==false} onChange={(e)=>set("gameplay.enableFatalities",e.target.checked)}/><span>Fatal race accidents</span></label>
            <label className="flex items-center gap-3"><input type="checkbox" className="h-4 w-4" checked={draft.gameplay.enableWeatherRandomness} onChange={(e)=>set("gameplay.enableWeatherRandomness",e.target.checked)}/><span>Weather randomness</span></label>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-white/10 bg-[#12141c] text-slate-100">
        <CardContent className="space-y-4 p-4 md:p-6">
          <h2 className="text-lg font-semibold">Audio & Notifications</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {[
              ["audio.masterVolume","Master volume",draft.audio.masterVolume],
              ["audio.sfxVolume","SFX volume",draft.audio.sfxVolume],
              ["audio.musicVolume","Music volume",draft.audio.musicVolume],
            ].map(([path,label,value])=><div key={path} className="space-y-1">
              <label className="text-sm text-slate-400">{label} · {value}%</label>
              <input type="range" min={0} max={100} value={value} onChange={(e)=>set(path,Number(e.target.value))} className="w-full"/>
            </div>)}
          </div>
          <div className="flex flex-wrap gap-5">
            <label className="flex items-center gap-3"><input type="checkbox" className="h-4 w-4" checked={draft.notifications} onChange={(e)=>set("notifications",e.target.checked)}/><span>Enable notifications</span></label>
            <label className="flex items-center gap-3"><input type="checkbox" className="h-4 w-4" checked={draft.autosave} onChange={(e)=>set("autosave",e.target.checked)}/><span>Autosave</span></label>
            <label className="flex items-center gap-2 text-sm text-slate-400">Interval<Input className="w-20" type="number" min={1} max={120} value={draft.autosaveIntervalMin} onChange={(e)=>set("autosaveIntervalMin",Math.max(1,Number(e.target.value)||10))}/>min</label>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl border-white/10 bg-[#12141c] text-slate-100">
        <CardContent className="space-y-4 p-4 md:p-6">
          <h2 className="text-lg font-semibold">Data & Advanced</h2>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <label className="text-sm text-slate-400">Datasource</label>
              <Select value={draft.data.datasource} onValueChange={(v)=>set("data.datasource",v)}>
                <SelectTrigger><SelectValue/></SelectTrigger>
                <SelectContent>
                  <SelectItem value="json">Local JSON</SelectItem>
                  <SelectItem value="excel">Excel (converter)</SelectItem>
                  <SelectItem value="remote">Remote URL</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {draft.data.datasource==="remote"?<div className="space-y-2 md:col-span-2"><label className="text-sm text-slate-400">Remote base URL</label><Input value={draft.data.remoteUrl} onChange={(e)=>set("data.remoteUrl",e.target.value)}/></div>:null}
          </div>
          <div className="flex flex-wrap gap-5">
            <label className="flex items-center gap-3"><input type="checkbox" className="h-4 w-4" checked={draft.developer.showDevTools} onChange={(e)=>set("developer.showDevTools",e.target.checked)}/><span>Show developer tools</span></label>
            <label className="flex items-center gap-3"><input type="checkbox" className="h-4 w-4" checked={draft.developer.verboseLogs} onChange={(e)=>set("developer.verboseLogs",e.target.checked)}/><span>Verbose logs</span></label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="secondary" onClick={handleExport}>Export settings</Button>
            <input ref={fileRef} type="file" accept="application/json" onChange={handleImport} className="hidden"/>
            <Button variant="secondary" onClick={()=>fileRef.current?.click()}>Import settings…</Button>
          </div>
        </CardContent>
      </Card>

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-end gap-3 rounded-xl border border-white/10 bg-[#0d0f15]/95 p-3 shadow-2xl backdrop-blur">
        <Button variant="outline" onClick={handleResetDefaults}>Reset all defaults</Button>
        <Button onClick={handleApply}>Apply Settings</Button>
      </div>
    </div>
  );
}
