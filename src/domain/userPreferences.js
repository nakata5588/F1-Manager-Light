// src/domain/userPreferences.js
// Global user preferences, independent from any individual career save.

export const USER_PREFERENCES_KEY="f1ml_settings";

export const DEFAULT_DISPLAY_SETTINGS=Object.freeze({
  uiScale:"auto",          // auto | compact | standard | large
  informationDensity:"normal", // low | normal | high
  animations:"auto",       // auto | full | reduced | off
  tooltips:true,
});

export const DEFAULT_USER_SETTINGS=Object.freeze({
  uiTheme:"auto",
  language:"en",
  dateFormat:"yyyy-MM-dd",
  display:DEFAULT_DISPLAY_SETTINGS,
  autosave:true,
  autosaveIntervalMin:10,
  notifications:true,
  audio:{masterVolume:70,sfxVolume:70,musicVolume:30},
  gameplay:{
    difficulty:"normal",
    simSpeed:1,
    rulesEra:"1980",
    enableInjuryRandomEvents:true,
    enableFatalities:true,
    enableWeatherRandomness:true,
    autoRollover:false,
  },
  data:{datasource:"json",remoteUrl:""},
  developer:{showDevTools:false,verboseLogs:false},
});

function storageOrNull(storage){
  if(storage)return storage;
  try{return globalThis?.localStorage||null;}catch{return null;}
}

export function mergeUserSettings(input){
  const source=input&&typeof input==="object"?input:{};
  return {
    ...DEFAULT_USER_SETTINGS,
    ...source,
    display:{...DEFAULT_DISPLAY_SETTINGS,...(source.display||{})},
    audio:{...DEFAULT_USER_SETTINGS.audio,...(source.audio||{})},
    gameplay:{...DEFAULT_USER_SETTINGS.gameplay,...(source.gameplay||{})},
    data:{...DEFAULT_USER_SETTINGS.data,...(source.data||{})},
    developer:{...DEFAULT_USER_SETTINGS.developer,...(source.developer||{})},
  };
}

export function readUserSettings(storage=null){
  const target=storageOrNull(storage);
  if(!target)return mergeUserSettings();
  try{
    const raw=target.getItem(USER_PREFERENCES_KEY);
    return raw?mergeUserSettings(JSON.parse(raw)):mergeUserSettings();
  }catch{
    return mergeUserSettings();
  }
}

export function writeUserSettings(settings,storage=null){
  const target=storageOrNull(storage);
  const normalized=mergeUserSettings(settings);
  if(!target)return {ok:false,settings:normalized,error:"Browser storage unavailable."};
  try{
    target.setItem(USER_PREFERENCES_KEY,JSON.stringify(normalized));
    return {ok:true,settings:normalized,error:null};
  }catch(error){
    return {ok:false,settings:normalized,error:String(error?.message||error)};
  }
}

export function viewportLayout(width,height){
  const w=Number(width)||0;
  const h=Number(height)||0;
  if(w<1280||h<720)return "compact";
  if(w<1600)return "standard";
  if(w<1920)return "wide";
  return "ultrawide";
}

export function effectiveUiScale(requested,width,height){
  const choice=String(requested||"auto");
  if(["compact","standard","large"].includes(choice))return choice;
  const w=Number(width)||0;
  const h=Number(height)||0;
  if(w<1360||h<760)return "compact";
  if(w>=2200&&h>=1100)return "large";
  return "standard";
}

export function effectiveAnimations(requested,reducedMotion=false){
  const choice=String(requested||"auto");
  if(["full","reduced","off"].includes(choice))return choice;
  return reducedMotion?"reduced":"full";
}

export function contentMaxForLayout(layout){
  const values={
    compact:"1180px",
    standard:"1440px",
    wide:"1600px",
    ultrawide:"1920px",
  };
  return values[layout]||values.standard;
}
