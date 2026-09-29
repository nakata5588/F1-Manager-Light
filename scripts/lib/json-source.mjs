import fs from "node:fs/promises";

function parseJson(raw,file){
  try{return JSON.parse(raw);}
  catch(error){
    const message=String(error?.message||error);
    throw new Error(`[data-build] Invalid JSON in ${file}: ${message}`);
  }
}

export async function readJsonRequired(file,{label=null}={}){
  let raw;
  try{
    raw=await fs.readFile(file,"utf8");
  }catch(error){
    const detail=String(error?.code||error?.message||error);
    throw new Error(`[data-build] Required JSON unavailable: ${label||file} (${detail})`);
  }
  return parseJson(raw,label||file);
}

export async function readJsonOptional(file,fallback=[]){
  let raw;
  try{
    raw=await fs.readFile(file,"utf8");
  }catch(error){
    if(error?.code==="ENOENT")return fallback;
    const detail=String(error?.code||error?.message||error);
    throw new Error(`[data-build] Optional JSON could not be read: ${file} (${detail})`);
  }
  return parseJson(raw,file);
}
