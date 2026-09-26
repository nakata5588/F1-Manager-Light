import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Check, Monitor, Maximize2, RotateCcw, Save, Settings as SettingsIcon } from "lucide-react";
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
    audio:{...global.audio,...(gameState?.settings?.audio||{})},
    gameplay:{...global.gameplay,...(gameState?.settings?.gameplay||{})},
    data:{...global.data,...(gameState?.settings?.data||{})},
    developer:{...global.developer,...(gameState?.settings?.developer||{})},
  });
}

function stable(value){
  try{return JSON.stringify(value);}catch{return String(value);}
}

function countChangedLeaves(a,b){
  const walk=(left,right)=>{
    if(left===right)return 0;
    if(left&&right&&typeof left==="object"&&typeof right==="object"&&!Array.isArray(left)&&!Array.isArray(right)){
      const keys=new Set([...Object.keys(left),...Object.keys(right)]);
      let total=0;
      for(const key of keys)total+=walk(left[key],right[key]);
      return total;
    }
    return 1;
  };
  return walk(a,b);
}

function titleCase(value){
  return String(value||"")
    .replace(/_/g," ")
    .replace(/\b\w/g,(m)=>m.toUpperCase());
}

function Section({title,description,action,children}){
  return <section className="rounded-2xl border border-white/10 bg-[#12141c] shadow-xl shadow-black/10">
    <div className="flex flex-wrap items-start gap-3 border-b border-white/10 px-5 py-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-100">{title}</h2>
        {description?<p className="mt-1 max-w-4xl text-xs leading-5 text-slate-400">{description}</p>:null}
      </div>
      <div className="flex-1"/>
      {action}
    </div>
    <div className="space-y-5 p-5">{children}</div>
  </section>;
}

function Metric({label,value,detail}){
  return <div className="rounded-xl border border-white/10 bg-[#171a23] p-3">
    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
    <div className="mt-1 text-xl font-semibold text-slate-100">{value}</div>
    {detail?<div className="mt-1 text-xs text-slate-500">{detail}</div>:null}
  </div>;
}

function Segmented({label,value,onChange,options,description}){
  return <div className="space-y-2">
    <div className="text-sm font-medium text-slate-300">{label}</div>
    <div className="grid gap-2" style={{gridTemplateColumns:`repeat(${Math.min(options.length,4)}, minmax(0,1fr))`}}>
      {options.map((option)=>{
        const selected=value===option.value;
        return <button
          key={option.value}
          type="button"
          onClick={()=>onChange(option.value)}
          aria-pressed={selected}
          className={
            "relative rounded-lg border px-3 py-2.5 text-left transition "+
            (selected
              ?"border-emerald-400 bg-emerald-400/15 text-white ring-1 ring-emerald-400/30"
              :"border-white/10 bg-[#0d0f15] text-slate-400 hover:border-white/25 hover:bg-white/[0.04]")
          }
        >
          <div className="flex items-center gap-2">
            <span className="font-semibold">{option.label}</span>
            {selected?<Check size={14} className="ml-auto shrink-0 text-emerald-300"/>:null}
          </div>
          {option.hint?<div className={"mt-1 text-[10px] "+(selected?"text-emerald-200/70":"text-slate-600")}>{option.hint}</div>:null}
        </button>;
      })}
    </div>
    {description?<p className="text-[11px] leading-4 text-slate-500">{description}</p>:null}
  </div>;
}

function DarkSelect({label,value,onChange,children,description}){
  return <label className="block space-y-2">
    <span className="text-sm font-medium text-slate-300">{label}</span>
    <select
      value={value}
      onChange={(event)=>onChange(event.target.value)}
      className="h-10 w-full rounded-lg border border-white/10 bg-[#0d0f15] px-3 text-sm text-slate-100 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400/30"
    >
      {children}
    </select>
    {description?<span className="block text-[11px] text-slate-500">{description}</span>:null}
  </label>;
}

function Toggle({checked,onChange,label,description}){
  return <button
    type="button"
    role="switch"
    aria-checked={checked}
    onClick={()=>onChange(!checked)}
    className="flex w-full items-center gap-3 rounded-lg border border-white/10 bg-[#0d0f15] px-3 py-3 text-left hover:border-white/20"
  >
    <span className={"relative h-5 w-9 shrink-0 rounded-full transition "+(checked?"bg-emerald-500":"bg-slate-700")}>
      <span className={"absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition "+(checked?"left-[18px]":"left-0.5")}/>
    </span>
    <span className="min-w-0">
      <span className="block text-sm font-medium text-slate-200">{label}</span>
      {description?<span className="mt-0.5 block text-[11px] text-slate-500">{description}</span>:null}
    </span>
  </button>;
}

export default function Settings({embedded=false}){
  const navigate=useNavigate();
  const location=useLocation();
  const gameState=useGame((s)=>s.gameState);
  const [draft,setDraft]=useState(()=>initialSettings(gameState));
  const [applied,setApplied]=useState(()=>initialSettings(gameState));
  const [applyState,setApplyState]=useState("idle");
  const [notice,setNotice]=useState("");
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

  const dirty=stable(draft)!==stable(applied);
  const changedCount=useMemo(()=>countChangedLeaves(applied,draft),[applied,draft]);
  const detectedLayout=viewportLayout(viewport.width,viewport.height);
  const effectiveScale=effectiveUiScale(draft.display.uiScale,viewport.width,viewport.height);
  const contentMax=contentMaxForLayout(detectedLayout);
  const hasCareer=Boolean(gameState?.team);

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
    setApplyState("idle");
  };

  const flash=(message)=>{
    setNotice(message);
    window.setTimeout(()=>setNotice(""),2600);
  };

  const handleApply=()=>{
    if(!dirty)return;
    setApplyState("applying");
    try{
      const normalized=mergeUserSettings(draft);
      useGame.getState().updateSettings(normalized);
      setDraft(normalized);
      setApplied(normalized);
      setApplyState("applied");
      flash("Settings saved successfully.");
      window.setTimeout(()=>setApplyState("idle"),2200);
    }catch(error){
      console.error(error);
      setApplyState("error");
      flash("Unable to save settings.");
    }
  };

  const handleResetDisplay=()=>{
    setDraft((prev)=>mergeUserSettings({
      ...prev,
      uiTheme:DEFAULT_USER_SETTINGS.uiTheme,
      display:{...DEFAULT_DISPLAY_SETTINGS},
    }));
    setApplyState("idle");
  };

  const handleResetAll=()=>{
    setDraft(mergeUserSettings(DEFAULT_USER_SETTINGS));
    setApplyState("idle");
  };

  const toggleFullscreen=async()=>{
    try{
      if(document.fullscreenElement)await document.exitFullscreen?.();
      else await document.documentElement.requestFullscreen?.();
    }catch{
      flash("Fullscreen is not available in this browser or window.");
    }
  };

  const backTarget=embedded
    ?"/Home"
    :(location.state?.from==="game"&&hasCareer?"/Home":"/");

  const content=<>
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={()=>navigate(backTarget)}
        className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-300 hover:border-white/25 hover:bg-white/[0.07]"
      >
        <ArrowLeft size={16}/> {embedded?"Back to Game":"Back"}
      </button>
      <div>
        <div className="flex items-center gap-2">
          <SettingsIcon size={20} className="text-slate-400"/>
          <h1 className="text-2xl font-semibold text-white">Settings</h1>
        </div>
        <p className="mt-1 text-sm text-slate-400">Global preferences shared across every career.</p>
      </div>
      <div className="flex-1"/>
      {dirty
        ?<div className="rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-300">{changedCount} unsaved change{changedCount===1?"":"s"}</div>
        :<div className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-xs font-semibold text-emerald-300">All changes saved</div>}
    </div>

    {notice?<div className={"rounded-lg border px-4 py-3 text-sm "+(applyState==="error"?"border-rose-400/25 bg-rose-400/10 text-rose-200":"border-emerald-400/25 bg-emerald-400/10 text-emerald-200")}>{notice}</div>:null}

    <Section
      title="Display & Interface"
      description="The game always adapts its layout to the available browser window. UI Scale controls readability and density without forcing a fixed resolution."
      action={<button type="button" onClick={handleResetDisplay} className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-slate-300 hover:border-white/25"><RotateCcw size={14}/> Reset display</button>}
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Current viewport" value={viewport.width+" × "+viewport.height} detail="Available browser content area"/>
        <Metric label="Detected layout" value={titleCase(detectedLayout)} detail={"Content width up to "+contentMax}/>
        <Metric label="Effective UI scale" value={titleCase(effectiveScale)} detail={draft.display.uiScale==="auto"?"Chosen automatically":"Manual override"}/>
        <div className="rounded-xl border border-white/10 bg-[#171a23] p-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Display mode</div>
          <div className="mt-1 text-xl font-semibold text-slate-100">{fullscreen?"Fullscreen":"Windowed"}</div>
          <button type="button" onClick={toggleFullscreen} className="mt-1 inline-flex items-center gap-1 text-xs text-sky-300 hover:text-sky-200"><Maximize2 size={12}/>{fullscreen?"Exit fullscreen":"Enter fullscreen"}</button>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Segmented
          label="UI Scale"
          value={draft.display.uiScale}
          onChange={(value)=>set("display.uiScale",value)}
          options={[
            {value:"auto",label:"Auto",hint:"Recommended"},
            {value:"compact",label:"Compact",hint:"More on screen"},
            {value:"standard",label:"Standard",hint:"Balanced"},
            {value:"large",label:"Large",hint:"More readable"},
          ]}
          description="Auto considers both the width and height of the active game window."
        />

        <Segmented
          label="Information Density"
          value={draft.display.informationDensity}
          onChange={(value)=>set("display.informationDensity",value)}
          options={[
            {value:"low",label:"Low",hint:"More breathing room"},
            {value:"normal",label:"Normal",hint:"Recommended"},
            {value:"high",label:"High",hint:"More information"},
          ]}
          description="Controls spacing and information density as screens adopt the responsive shell."
        />

        <Segmented
          label="Theme"
          value={draft.uiTheme}
          onChange={(value)=>set("uiTheme",value)}
          options={[
            {value:"auto",label:"Auto",hint:"System preference"},
            {value:"dark",label:"Dark",hint:"Dark interface"},
            {value:"light",label:"Light",hint:"Light interface"},
          ]}
        />

        <Segmented
          label="Animations"
          value={draft.display.animations}
          onChange={(value)=>set("display.animations",value)}
          options={[
            {value:"auto",label:"Auto",hint:"System preference"},
            {value:"full",label:"Full",hint:"All effects"},
            {value:"reduced",label:"Reduced",hint:"Short transitions"},
            {value:"off",label:"Off",hint:"No motion"},
          ]}
          description="Auto respects your operating system's reduced-motion preference."
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <DarkSelect label="Language" value={draft.language} onChange={(value)=>set("language",value)}>
          <option value="en">English</option>
          <option value="pt">Português</option>
          <option value="es">Español</option>
          <option value="fr">Français</option>
        </DarkSelect>

        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-300">Date format</span>
          <input
            value={draft.dateFormat}
            onChange={(event)=>set("dateFormat",event.target.value)}
            className="h-10 w-full rounded-lg border border-white/10 bg-[#0d0f15] px-3 text-sm text-slate-100 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400/30"
          />
        </label>

        <Toggle
          checked={draft.display.tooltips!==false}
          onChange={(value)=>set("display.tooltips",value)}
          label="Contextual tooltips"
          description="Show explanatory hints over unfamiliar controls and metrics."
        />
      </div>

      <div className="flex items-center gap-3 rounded-lg border border-sky-400/15 bg-sky-400/[0.05] px-4 py-3 text-xs text-slate-400">
        <Monitor size={16} className="shrink-0 text-sky-300"/>
        <span><b className="text-slate-200">Responsive layout is always automatic.</b> Compact &lt;1280 · Standard 1280–1599 · Wide 1600–1919 · Ultra-wide ≥1920. It reacts to the game window, not the monitor's advertised resolution.</span>
      </div>
    </Section>

    <Section title="Gameplay" description="Existing gameplay preferences remain available while the dedicated Gameplay settings pass is still pending.">
      <div className="grid gap-4 md:grid-cols-3">
        <DarkSelect label="Difficulty" value={draft.gameplay.difficulty} onChange={(value)=>set("gameplay.difficulty",value)}>
          <option value="easy">Easy</option>
          <option value="normal">Normal</option>
          <option value="hard">Hard</option>
          <option value="custom">Custom</option>
        </DarkSelect>

        <label className="block space-y-2">
          <span className="text-sm font-medium text-slate-300">Simulation speed</span>
          <input type="number" min="0.25" max="8" step="0.25" value={draft.gameplay.simSpeed} onChange={(event)=>set("gameplay.simSpeed",Number(event.target.value)||1)} className="h-10 w-full rounded-lg border border-white/10 bg-[#0d0f15] px-3 text-sm text-slate-100 outline-none focus:border-emerald-400"/>
        </label>

        <DarkSelect label="Rules era / Year" value={draft.gameplay.rulesEra} onChange={(value)=>set("gameplay.rulesEra",value)}>
          <option value={String(gameState?.activeYear||1980)}>{String(gameState?.activeYear||1980)}</option>
        </DarkSelect>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Toggle checked={draft.gameplay.enableInjuryRandomEvents!==false} onChange={(value)=>set("gameplay.enableInjuryRandomEvents",value)} label="Random driver injury events"/>
        <Toggle checked={draft.gameplay.enableFatalities!==false} onChange={(value)=>set("gameplay.enableFatalities",value)} label="Fatal race accidents"/>
        <Toggle checked={draft.gameplay.enableWeatherRandomness!==false} onChange={(value)=>set("gameplay.enableWeatherRandomness",value)} label="Weather randomness"/>
      </div>
    </Section>

    <Section title="Audio & Notifications" description="Basic controls retained until the dedicated Notifications and Audio settings stages.">
      <div className="grid gap-4 md:grid-cols-3">
        {[
          ["audio.masterVolume","Master volume",draft.audio.masterVolume],
          ["audio.sfxVolume","SFX volume",draft.audio.sfxVolume],
          ["audio.musicVolume","Music volume",draft.audio.musicVolume],
        ].map(([path,label,value])=><label key={path} className="space-y-2">
          <span className="flex items-center justify-between text-sm text-slate-300"><span>{label}</span><span className="font-semibold text-slate-100">{value}%</span></span>
          <input type="range" min="0" max="100" value={value} onChange={(event)=>set(path,Number(event.target.value))} className="w-full accent-emerald-500"/>
        </label>)}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Toggle checked={draft.notifications!==false} onChange={(value)=>set("notifications",value)} label="Enable notifications"/>
        <Toggle checked={draft.autosave!==false} onChange={(value)=>set("autosave",value)} label="Autosave"/>
      </div>
    </Section>

    <div className="sticky bottom-3 z-20 flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-[#0b0d12]/95 p-3 shadow-2xl shadow-black/40 backdrop-blur">
      <div className="min-w-0 flex-1">
        {dirty
          ?<div><div className="text-sm font-semibold text-amber-300">You have unsaved changes</div><div className="text-xs text-slate-500">{changedCount} setting{changedCount===1?"":"s"} changed since the last Apply.</div></div>
          :applyState==="applied"
            ?<div><div className="text-sm font-semibold text-emerald-300">Settings applied ✓</div><div className="text-xs text-slate-500">Your preferences are saved globally.</div></div>
            :<div><div className="text-sm font-semibold text-slate-300">Settings are up to date</div><div className="text-xs text-slate-600">Change an option to enable Apply.</div></div>}
      </div>
      <button type="button" onClick={handleResetAll} className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm font-semibold text-slate-300 hover:border-white/25">Reset all defaults</button>
      <button
        type="button"
        onClick={handleApply}
        disabled={!dirty||applyState==="applying"}
        className={"inline-flex min-w-[150px] items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition "+
          (dirty
            ?"bg-emerald-500 text-slate-950 hover:bg-emerald-400"
            :"cursor-not-allowed bg-white/10 text-slate-600")}
      >
        {applyState==="applying"?<><Save size={15}/> Applying…</>:dirty?<><Save size={15}/> Apply Changes</>:applyState==="applied"?<><Check size={15}/> Applied</>:"No Changes"}
      </button>
    </div>
  </>;

  if(embedded)return <div className="space-y-5">{content}</div>;

  return <div className="min-h-screen bg-[#090b10] text-slate-100">
    <div className="f1ml-responsive-shell space-y-5 py-6">{content}</div>
  </div>;
}
