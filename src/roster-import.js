import {MLB_TEAMS} from "./roster-editor.js";
const letters=text=>String(text||"").toLowerCase().replace(/[^a-z]/g,"");
const ignore=new Set(["games","left","online","offline","play","news","roster","regular","season","flexible","schedule","members","remaining","world","series","total","psn"]);
function username(text){
  const value=String(text||"").replace(/\^[a-z]\d+\^/gi,"").replace(/^[^a-z0-9]+|[^a-z0-9_-]+$/gi,"");
  return /^[a-z0-9][a-z0-9_-]{2,31}$/i.test(value)&&!ignore.has(value.toLowerCase())&&!MLB_TEAMS.some(team=>letters(team)===letters(value))?value:"";
}
export function ocrWords(data){
  return (data.blocks||[]).flatMap(block=>(block.paragraphs||[]).flatMap(paragraph=>(paragraph.lines||[]).flatMap(line=>line.words||[]))).filter(word=>word.bbox&&word.text?.trim());
}
export function parseRosterWords(words,width,height){
  const sorted=[...words].sort((a,b)=>a.bbox.y0-b.bbox.y0||a.bbox.x0-b.bbox.x0);
  const anchors=[];
  for(const word of sorted){
    let team=MLB_TEAMS.find(team=>letters(team)===letters(word.text));
    let box={...word.bbox};
    if(!team){
      const next=sorted.find(other=>other!==word&&Math.abs(other.bbox.y0-word.bbox.y0)<Math.max(8,word.bbox.y1-word.bbox.y0)*.6&&other.bbox.x0>=word.bbox.x1&&other.bbox.x0-word.bbox.x1<Math.max(25,(word.bbox.y1-word.bbox.y0)*2));
      if(next){team=MLB_TEAMS.find(team=>letters(team)===letters(word.text+next.text));if(team)box.x1=next.bbox.x1;}
    }
    if(team)anchors.push({team,bbox:box});
  }
  const ownerWords=sorted.filter(word=>word.bbox.y0<height*.3&&(/[_-]/.test(word.text)||/\d/.test(word.text)&&/[a-z]/i.test(word.text))&&username(word.text));
  const owner=ownerWords.sort((a,b)=>a.bbox.y0-b.bbox.y0)[0];
  const rows=[],unread=[];
  for(const anchor of anchors){
    const h=Math.max(10,anchor.bbox.y1-anchor.bbox.y0);
    const flexible=sorted.some(word=>letters(word.text)==="flexible"&&Math.abs(word.bbox.y0-anchor.bbox.y0)<h);
    if(flexible){if(owner)rows.push({username:username(owner.text),team:anchor.team,imported:true});continue;}
    if(anchor.bbox.y0<height*.25)continue;
    const neighbor=anchors.filter(other=>other!==anchor&&Math.abs(other.bbox.y0-anchor.bbox.y0)<h*1.5&&other.bbox.x0>anchor.bbox.x0).sort((a,b)=>a.bbox.x0-b.bbox.x0)[0];
    const right=neighbor?neighbor.bbox.x0-4:width;
    const candidates=sorted.filter(word=>word.bbox.x0>=anchor.bbox.x0-h*.6&&word.bbox.x0<right&&word.bbox.y0>=anchor.bbox.y1-h*.15&&word.bbox.y0<=anchor.bbox.y1+h*1.8&&username(word.text));
    candidates.sort((a,b)=>a.bbox.y0-b.bbox.y0||a.bbox.x0-b.bbox.x0);
    const first=candidates[0];
    if(first){
      const next=candidates.find(word=>word!==first&&Math.abs(word.bbox.y0-first.bbox.y0)<h*.5&&word.bbox.x0>=first.bbox.x1&&word.bbox.x0-first.bbox.x1<h&&/^[_-]/.test(word.text));
      rows.push({username:username(first.text+(next?.text||"")),team:anchor.team,imported:true});
    }else unread.push(anchor.team);
  }
  const unique=[];
  for(const row of rows){if(!row.username)continue;const previous=unique.find(item=>item.username.toLowerCase()===row.username.toLowerCase());if(!previous)unique.push(row);else if(previous.team!==row.team)unread.push(row.team);}
  return {rows:unique,suggestedCommissioner:owner&&unique.some(row=>row.username.toLowerCase()===username(owner.text).toLowerCase())?username(owner.text):"",unread};
}

let libraryPromise;
function loadOcrLibrary(){
  if(globalThis.Tesseract)return Promise.resolve(globalThis.Tesseract);
  if(!libraryPromise)libraryPromise=new Promise((resolve,reject)=>{
    const script=document.createElement("script");script.src="https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js";script.crossOrigin="anonymous";
    const timeout=setTimeout(()=>script.onerror(),30000);
    script.onload=()=>{clearTimeout(timeout);resolve(globalThis.Tesseract);};script.onerror=()=>{clearTimeout(timeout);script.remove();libraryPromise=null;reject(new Error("No se pudo descargar el lector de fotos. Puedes agregar los participantes manualmente."));};
    document.head.append(script);
  });
  return libraryPromise;
}
function cancellable(promise,signal){
  if(!signal)return promise;
  return new Promise((resolve,reject)=>{
    const abort=()=>reject(new DOMException("Lectura cancelada","AbortError"));
    if(signal.aborted){abort();return;}
    signal.addEventListener("abort",abort,{once:true});
    promise.then(value=>{signal.removeEventListener("abort",abort);resolve(value);},error=>{signal.removeEventListener("abort",abort);reject(error);});
  });
}
export async function recognizeRosterImage(file,{onProgress=()=>{},signal}={}){
  if(!file||!file.type.startsWith("image/"))throw new Error("Selecciona una imagen JPG, PNG o WebP.");
  if(file.size>15*1024*1024)throw new Error("La foto debe pesar menos de 15 MB.");
  let worker,bitmap;
  const aborted=()=>{if(signal?.aborted)throw new DOMException("Lectura cancelada","AbortError");};
  const cancel=()=>{worker?.terminate().catch(()=>{});};
  signal?.addEventListener("abort",cancel,{once:true});
  try{
    aborted();onProgress("Preparando lector de fotos…");
    const library=await cancellable(loadOcrLibrary(),signal);aborted();
    bitmap=await createImageBitmap(file);aborted();
    if(bitmap.width*bitmap.height>40000000)throw new Error("La imagen es demasiado grande. Usa una captura o una foto de menor resolución.");
    const scale=Math.min(2,2400/bitmap.width,1800/bitmap.height),canvas=document.createElement("canvas");
    canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext("2d").drawImage(bitmap,0,0,canvas.width,canvas.height);
    // Game screenshots use light text over colored cards. Flatten those backgrounds
    // so Tesseract does not discard entire cards as illustrations.
    const context=canvas.getContext("2d"),pixels=context.getImageData(0,0,canvas.width,canvas.height);
    for(let i=0;i<pixels.data.length;i+=4){const value=.2126*pixels.data[i]+.7152*pixels.data[i+1]+.0722*pixels.data[i+2]>155?0:255;pixels.data[i]=value;pixels.data[i+1]=value;pixels.data[i+2]=value;pixels.data[i+3]=255;}
    context.putImageData(pixels,0,0);
    const pendingWorker=library.createWorker("eng",1,{workerPath:"https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js",logger:m=>{if(!signal?.aborted)onProgress(m.status==="recognizing text"?`Leyendo foto: ${Math.round(m.progress*100)}%…`:"Preparando lector de fotos…");}});
    pendingWorker.then(created=>{if(signal?.aborted)created.terminate().catch(()=>{});},()=>{});
    worker=await cancellable(pendingWorker,signal);
    aborted();await worker.setParameters({tessedit_pageseg_mode:11});
    const {data}=await cancellable(worker.recognize(canvas,{}, {blocks:true}),signal);aborted();
    let words=ocrWords(data),result=parseRosterWords(words,canvas.width,canvas.height),text=data.text;
    if(!result.suggestedCommissioner){
      // Thin underscores in the account header can disappear during thresholding.
      // Re-read the original header while preserving the successful card readings.
      const original=document.createElement("canvas");original.width=bitmap.width;original.height=Math.ceil(bitmap.height*.62);original.getContext("2d").drawImage(bitmap,0,0);
      const header=await cancellable(worker.recognize(original,{}, {blocks:true}),signal);aborted();
      const headerWords=ocrWords(header.data).map(word=>({...word,bbox:Object.fromEntries(Object.entries(word.bbox).map(([key,value])=>[key,value*scale]))}));
      words=[...words,...headerWords];text+="\n"+header.data.text;result=parseRosterWords(words,canvas.width,canvas.height);
    }
    return {...result,text};
  }catch(error){if(signal?.aborted)throw new DOMException("Lectura cancelada","AbortError");throw error;}
  finally{signal?.removeEventListener("abort",cancel);bitmap?.close();if(worker)await worker.terminate().catch(()=>{});}
}
