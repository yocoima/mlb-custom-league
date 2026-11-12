import {gameParts} from "./league-core.js";

// MLB sometimes returns HTTP 200 with an error or HTTP 202 while building a log.
// Only a payload containing a line score may stop the fallback to another record.
export async function fetchReadyGameLog(url,{fetchImpl=fetch,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),attempts=3}={}){
  for(let attempt=0;attempt<attempts;attempt++){
    const response=await fetchImpl(url,{headers:{Accept:"application/json"},cache:"no-store"});
    let payload;
    try{payload=await response.json();}catch{throw new Error("Game Log no devolvió JSON válido.");}
    if(response.status===202||payload?.status==="pending"){
      if(attempt+1===attempts)throw new Error("Game Log aún se está preparando; vuelve a actualizar la liga.");
      const seconds=Number(payload?.retry_after||response.headers.get("Retry-After")||3);
      await sleep(Math.max(1,Math.min(5,Number.isFinite(seconds)?seconds:3))*1000);
      continue;
    }
    if(!response.ok)throw new Error(`Game Log HTTP ${response.status}`);
    if(payload?.error)throw new Error(String(payload.error));
    if(!gameParts(payload).lineScore)throw new Error("Game Log sin datos de partido.");
    return payload;
  }
  throw new Error("Game Log no disponible.");
}
