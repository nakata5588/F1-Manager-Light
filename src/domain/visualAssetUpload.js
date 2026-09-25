// src/domain/visualAssetUpload.js
// Browser-side image normalization for in-game visual uploads.

const MAX_INPUT_BYTES=12*1024*1024;
const MAX_DIMENSION=512;
const WEBP_QUALITY=0.86;

function imageFromObjectUrl(file){
  return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(file);
    const img=new Image();
    img.onload=()=>resolve({img,url});
    img.onerror=()=>{
      URL.revokeObjectURL(url);
      reject(new Error("Could not read this image."));
    };
    img.src=url;
  });
}

function canvasBlob(canvas,type,quality){
  return new Promise((resolve)=>canvas.toBlob(resolve,type,quality));
}

function blobDataUrl(blob){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result||""));
    reader.onerror=()=>reject(new Error("Could not encode this image."));
    reader.readAsDataURL(blob);
  });
}

export async function optimizeVisualAssetFile(file,{maxDimension=MAX_DIMENSION}={}){
  if(!file)throw new Error("No image selected.");
  if(!String(file.type||"").startsWith("image/"))throw new Error("Please choose an image file.");
  if(Number(file.size)>MAX_INPUT_BYTES)throw new Error("Image is too large. Maximum input size is 12 MB.");

  const {img,url}=await imageFromObjectUrl(file);
  try{
    const width=Math.max(1,Number(img.naturalWidth||img.width)||1);
    const height=Math.max(1,Number(img.naturalHeight||img.height)||1);
    const scale=Math.min(1,Number(maxDimension)/Math.max(width,height));
    const outWidth=Math.max(1,Math.round(width*scale));
    const outHeight=Math.max(1,Math.round(height*scale));

    const canvas=document.createElement("canvas");
    canvas.width=outWidth;
    canvas.height=outHeight;
    const ctx=canvas.getContext("2d",{alpha:true});
    if(!ctx)throw new Error("Image processing is not available in this browser.");
    ctx.imageSmoothingEnabled=true;
    ctx.imageSmoothingQuality="high";
    ctx.clearRect(0,0,outWidth,outHeight);
    ctx.drawImage(img,0,0,outWidth,outHeight);

    let blob=await canvasBlob(canvas,"image/webp",WEBP_QUALITY);
    if(!blob){
      blob=await canvasBlob(canvas,"image/png");
    }
    if(!blob)throw new Error("Could not compress this image.");

    return {
      dataUrl:await blobDataUrl(blob),
      width:outWidth,
      height:outHeight,
      bytes:Number(blob.size)||0,
      mime:blob.type||"image/webp",
    };
  }finally{
    URL.revokeObjectURL(url);
  }
}

export function visualUploadSizeLabel(bytes){
  const n=Number(bytes)||0;
  if(n<1024)return `${n} B`;
  if(n<1024*1024)return `${Math.round(n/1024)} KB`;
  return `${(n/(1024*1024)).toFixed(1)} MB`;
}
