const API_ORIGIN = "https://mlb26.theshow.com";
const PLATFORMS = new Set(["psn","xbl","mlbts","nsw"]);

function cors(extra={}){
  return {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,OPTIONS","Access-Control-Allow-Headers":"Content-Type,Accept","Vary":"Origin",...extra};
}
function json(body,status=200,headers={}){return new Response(JSON.stringify(body),{status,headers:cors({"Content-Type":"application/json; charset=utf-8",...headers})});}
function validUsername(v){return typeof v==="string" && v.length>0 && v.length<=80;}

export default {
  async fetch(request){
    if(request.method==="OPTIONS") return new Response(null,{status:204,headers:cors()});
    if(request.method!=="GET") return json({error:"Method not allowed"},405);
    const url=new URL(request.url);
    try{
      if(url.pathname==="/api/history"){
        const username=url.searchParams.get("username")||"";
        const platform=url.searchParams.get("platform")||"";
        const page=Math.max(1,Math.min(200,Number(url.searchParams.get("page")||1)));
        if(!validUsername(username)||!PLATFORMS.has(platform)) return json({error:"Invalid username/platform"},400);
        const upstream=new URL(`${API_ORIGIN}/apis/game_history.json`);
        upstream.searchParams.set("username",username);upstream.searchParams.set("platform",platform);upstream.searchParams.set("page",String(page));upstream.searchParams.set("mode","all");
        return proxy(upstream,60);
      }
      if(url.pathname==="/api/game-log"){
        const id=url.searchParams.get("id")||"";
        const username=url.searchParams.get("username")||"";
        const platform=url.searchParams.get("platform")||"";
        if(!/^\d+$/.test(id)||!validUsername(username)||!PLATFORMS.has(platform)) return json({error:"Invalid id/username/platform"},400);
        const upstream=new URL(`${API_ORIGIN}/apis/game_log.json`);
        upstream.searchParams.set("id",id);upstream.searchParams.set("username",username);upstream.searchParams.set("platform",platform);
        return proxy(upstream,86400);
      }
      return json({ok:true,service:"MLB The Show 26 Custom League proxy",routes:["/api/history","/api/game-log"]});
    }catch(error){return json({error:error?.message||"Proxy error"},502);}
  }
};

async function proxy(upstream,ttl){
  const response=await fetch(upstream.toString(),{headers:{Accept:"application/json"},cf:{cacheEverything:true,cacheTtl:ttl}});
  const body=await response.arrayBuffer();
  return new Response(body,{status:response.status,headers:cors({"Content-Type":response.headers.get("Content-Type")||"application/json","Cache-Control":`public, max-age=${ttl}`} )});
}
