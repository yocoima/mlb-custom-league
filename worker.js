const API_ORIGIN = "https://mlb26.theshow.com";
const PLATFORMS = new Set(["psn","xbl","mlbts","nsw"]);
const LEAGUE_KEY = "public-league-v1";
const MAX_SNAPSHOT_BYTES = 10 * 1024 * 1024;

function cors(extra={}){
  return {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type,Accept,Authorization","Vary":"Origin",...extra};
}
function json(body,status=200,headers={}){return new Response(JSON.stringify(body),{status,headers:cors({"Content-Type":"application/json; charset=utf-8",...headers})});}
function validUsername(v){return typeof v==="string" && v.length>0 && v.length<=80;}
function publicChampions(value){
  if(!Array.isArray(value)) return [];
  return value.slice(0,50).map(entry=>({
    season:String(entry?.season||"").slice(0,100),
    champion:String(entry?.champion||"").slice(0,100),
    team:String(entry?.team||"").slice(0,100),
    runnerUp:String(entry?.runnerUp||"").slice(0,100),
    result:String(entry?.result||"").slice(0,50),
    note:String(entry?.note||"").slice(0,300)
  })).filter(entry=>entry.season&&entry.champion);
}
function publicConfig(config={}){
  return {
    username:String(config.username||""),platform:"psn",seedGameId:String(config.seedGameId||""),
    myTeam:String(config.myTeam||""),startDate:String(config.startDate||""),
    regulationInnings:Number(config.regulationInnings||5),maxPages:Number(config.maxPages||20),
    proxyBase:String(config.proxyBase||""),roster:config.roster&&typeof config.roster==="object"&&!Array.isArray(config.roster)?config.roster:{},
    champions:publicChampions(config.champions)
  };
}
function validSnapshot(value){
  return value&&typeof value==="object"&&!Array.isArray(value)&&value.version===1&&
    Array.isArray(value.participants)&&Array.isArray(value.games)&&value.stats&&typeof value.stats==="object"&&
    Array.isArray(value.stats.batting)&&Array.isArray(value.stats.pitching)&&
    Array.isArray(value.stats.loadedGameIds)&&Array.isArray(value.stats.failedGameIds)&&
    value.participants.length<=100&&value.games.length<=5000&&value.stats.batting.length<=10000&&value.stats.pitching.length<=10000;
}
function bearerToken(request){
  const match=(request.headers.get("Authorization")||"").match(/^Bearer\s+(.+)$/i);
  return match?.[1]||"";
}

export default {
  async fetch(request,env={}){
    if(request.method==="OPTIONS") return new Response(null,{status:204,headers:cors()});
    const url=new URL(request.url);
    try{
      if(url.pathname==="/api/league"){
        if(!env.LEAGUE_STORE) return json({error:"League storage is not configured"},503);
        if(request.method==="GET"){
          const snapshot=await env.LEAGUE_STORE.get(LEAGUE_KEY,"json");
          return snapshot?json(snapshot,200,{"Cache-Control":"no-store"}):json({error:"League has not been published"},404,{"Cache-Control":"no-store"});
        }
        if(request.method==="POST"){
          if(!env.LEAGUE_PUBLISH_TOKEN) return json({error:"Publishing secret is not configured"},503);
          if(bearerToken(request)!==env.LEAGUE_PUBLISH_TOKEN) return json({error:"Unauthorized"},401,{"WWW-Authenticate":"Bearer"});
          const raw=await request.text();
          if(new TextEncoder().encode(raw).byteLength>MAX_SNAPSHOT_BYTES) return json({error:"Snapshot is too large"},413);
          let incoming;
          try{incoming=JSON.parse(raw)}catch{return json({error:"Invalid JSON"},400)}
          if(!validSnapshot(incoming)) return json({error:"Invalid league snapshot"},400);
          const snapshot={
            version:1,publishedAt:new Date().toISOString(),lastSync:incoming.lastSync||null,
            config:publicConfig(incoming.config),participants:incoming.participants,games:incoming.games,
            stats:incoming.stats
          };
          await env.LEAGUE_STORE.put(LEAGUE_KEY,JSON.stringify(snapshot));
          return json({ok:true,publishedAt:snapshot.publishedAt,participants:snapshot.participants.length,games:snapshot.games.length});
        }
        return json({error:"Method not allowed"},405,{Allow:"GET, POST, OPTIONS"});
      }
      if(request.method!=="GET") return json({error:"Method not allowed"},405);
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
      return json({ok:true,service:"MLB The Show 26 Custom League proxy",routes:["/api/history","/api/game-log","/api/league"]});
    }catch(error){return json({error:error?.message||"Proxy error"},502);}
  }
};

async function proxy(upstream,ttl){
  const response=await fetch(upstream.toString(),{headers:{Accept:"application/json"},cf:{cacheEverything:true,cacheTtl:ttl}});
  const body=await response.arrayBuffer();
  return new Response(body,{status:response.status,headers:cors({"Content-Type":response.headers.get("Content-Type")||"application/json","Cache-Control":`public, max-age=${ttl}`} )});
}
