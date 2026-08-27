import {cleanDisplayName,sameText,gameParts,isOnOrAfterStartDate,isCompatibleWithRegulationInnings,isFormallyCompletedGame,createStatAccumulator,addGameStats} from "./src/league-core.js";

const API_ORIGIN = "https://mlb26.theshow.com";
const PLATFORMS = new Set(["psn","xbl","mlbts","nsw"]);
const LEAGUE_KEY = "public-league-v1";
const MAX_SNAPSHOT_BYTES = 10 * 1024 * 1024;

function cors(extra={}){
  return {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"GET,POST,OPTIONS","Access-Control-Allow-Headers":"Content-Type,Accept,Authorization","Vary":"Origin",...extra};
}
function json(body,status=200,headers={}){return new Response(JSON.stringify(body),{status,headers:cors({"Content-Type":"application/json; charset=utf-8",...headers})});}
function validUsername(v){return typeof v==="string" && v.length>0 && v.length<=80;}
function publicAwards(value){
  if(!Array.isArray(value))return [];
  return value.slice(0,12).map(award=>({
    key:String(award?.key||"").slice(0,20),label:String(award?.label||"").slice(0,30),title:String(award?.title||"").slice(0,60),
    winners:Array.isArray(award?.winners)?award.winners.slice(0,20).map(winner=>({
      player:String(winner?.player||"").slice(0,100),manager:String(winner?.manager||"").slice(0,100),team:String(winner?.team||"").slice(0,100),value:String(winner?.value||"").slice(0,30)
    })).filter(winner=>winner.player&&winner.value):[]
  })).filter(award=>award.key&&award.title&&award.winners.length);
}
function publicChampions(value){
  if(!Array.isArray(value)) return [];
  return value.slice(0,50).map(entry=>({
    season:String(entry?.season||"").slice(0,100),
    champion:String(entry?.champion||"").slice(0,100),
    team:String(entry?.team||"").slice(0,100),
    runnerUp:String(entry?.runnerUp||"").slice(0,100),
    result:String(entry?.result||"").slice(0,50),
    note:String(entry?.note||"").slice(0,300),finalizedAt:String(entry?.finalizedAt||"").slice(0,40),awards:publicAwards(entry?.awards)
  })).filter(entry=>entry.season&&entry.champion);
}
function publicConfig(config={}){
  return {
    leagueName:String(config.leagueName||""),username:String(config.username||""),platform:"psn",seedGameId:String(config.seedGameId||""),
    myTeam:String(config.myTeam||""),startDate:String(config.startDate||""),
    regulationInnings:Number(config.regulationInnings||5),maxPages:Number(config.maxPages||20),
    proxyBase:String(config.proxyBase||""),roster:config.roster&&typeof config.roster==="object"&&!Array.isArray(config.roster)?config.roster:{},
    champions:publicChampions(config.champions),finalizedAt:String(config.finalizedAt||"").slice(0,40)||null
  };
}
function rosterHas(config,username){
  const target=cleanDisplayName(username);
  return Object.entries(config?.roster||{}).some(([key,value])=>{
    const data=typeof value==="string"?{}:value||{};
    return sameText(data.username||key,target)||(Array.isArray(data.aliases)&&data.aliases.some(alias=>sameText(alias,target)));
  })||sameText(config?.username,target);
}
function statAccumulator(stats={}){
  return {batting:new Map(stats.batting||[]),pitching:new Map(stats.pitching||[]),loadedGameIds:new Set(stats.loadedGameIds||[]),failedGameIds:new Set(stats.failedGameIds||[])};
}
function serializedStats(acc){return {batting:[...acc.batting.entries()],pitching:[...acc.pitching.entries()],loadedGameIds:[...acc.loadedGameIds],failedGameIds:[...acc.failedGameIds]};}
async function officialGameLog(records,config){
  for(const record of records.slice(0,4)){
    if(!/^\d+$/.test(String(record?.id||""))||!rosterHas(config,record?.username))continue;
    const url=new URL(`${API_ORIGIN}/apis/game_log.json`);
    url.searchParams.set("id",String(record.id));url.searchParams.set("username",cleanDisplayName(record.username));url.searchParams.set("platform","psn");
    try{const response=await fetch(url.toString(),{headers:{Accept:"application/json"},cf:{cacheEverything:true,cacheTtl:31536000}});if(response.ok){const payload=await response.json();if(gameParts(payload).lineScore)return {payload,record};}}catch{}
  }
  return null;
}
async function refreshLeague(incoming,current,env){
  if(!validSnapshot(incoming)||!validSnapshot(current))return json({error:"Invalid league snapshot"},400);
  if(current.config?.finalizedAt)return json({error:"League is finalized"},409);
  if(incoming.publishedAt&&current.publishedAt&&incoming.publishedAt!==current.publishedAt)return json({error:"League changed during refresh; reload and try again"},409);
  const existingKeys=new Set(current.games.map(game=>String(game.dedupKey||game.uuid||game.id)));
  const existingUuids=new Set(current.games.map(game=>cleanDisplayName(game.uuid)).filter(Boolean));
  const candidates=incoming.games.filter(game=>!existingKeys.has(String(game.dedupKey||game.uuid||game.id))&&!existingUuids.has(cleanDisplayName(game.uuid)));
  if(candidates.length>25)return json({error:"Too many new games; refresh again in smaller batches"},413);
  if(!candidates.length)return json({...current,refresh:{added:0}},200,{"Cache-Control":"no-store"});
  const participants=current.participants.map(item=>({...item}));
  const participantByName=name=>participants.find(item=>sameText(item.username,name));
  const acc=statAccumulator(current.stats);
  const accepted=[];
  for(const candidate of candidates){
    const records=Array.isArray(candidate.apiRecords)&&candidate.apiRecords.length?candidate.apiRecords:[{id:candidate.id,username:candidate.sourceUser}];
    const official=await officialGameLog(records,current.config);
    if(!official)continue;
    const {lineScore}=gameParts(official.payload);
    if(String(lineScore.game_mode||"").toUpperCase()!=="LEAGUE"||!isFormallyCompletedGame(lineScore)||!isCompatibleWithRegulationInnings(lineScore,current.config.regulationInnings))continue;
    const uuid=cleanDisplayName(lineScore.game_uuid);
    if(!uuid||uuid!==cleanDisplayName(candidate.uuid)||existingUuids.has(uuid)||accepted.some(game=>game.uuid===uuid))continue;
    const home=participantByName(candidate.homeUser),away=participantByName(candidate.awayUser);
    if(!home||!away||!sameText(home.team,candidate.homeTeam)||!sameText(away.team,candidate.awayTeam))continue;
    if((lineScore.home_full_name&&!sameText(lineScore.home_full_name,home.team))||(lineScore.away_full_name&&!sameText(lineScore.away_full_name,away.team)))continue;
    const homePlayerId=String(lineScore.home_player_id||""),awayPlayerId=String(lineScore.away_player_id||"");
    const homeTeamId=String(lineScore.home_mlb_team_id||""),awayTeamId=String(lineScore.away_mlb_team_id||"");
    if(!homePlayerId||!awayPlayerId||(home.playerId&&String(home.playerId)!==homePlayerId)||(away.playerId&&String(away.playerId)!==awayPlayerId))continue;
    if((home.teamId&&String(home.teamId)!==homeTeamId)||(away.teamId&&String(away.teamId)!==awayTeamId))continue;
    if(participants.some(item=>!sameText(item.username,home.username)&&String(item.playerId||"")===homePlayerId))continue;
    if(participants.some(item=>!sameText(item.username,away.username)&&String(item.playerId||"")===awayPlayerId))continue;
    const playedAt=lineScore.created_at||candidate.date;
    if(!isOnOrAfterStartDate(playedAt,current.config.startDate))continue;
    Object.assign(home,{playerId:homePlayerId,teamId:homeTeamId,status:"verified"});
    Object.assign(away,{playerId:awayPlayerId,teamId:awayTeamId,status:"verified"});
    const game={...candidate,id:String(official.record.id),uuid,dedupKey:`uuid:${uuid}`,date:playedAt||candidate.date,
      homeScore:Number(lineScore.home_runs),awayScore:Number(lineScore.away_runs),homeResult:cleanDisplayName(lineScore.home_display_result).toUpperCase(),awayResult:cleanDisplayName(lineScore.away_display_result).toUpperCase(),ruling:"0",
      homePlayerId,awayPlayerId,apiRecords:records.slice(0,4),sourceUser:official.record.username,sourcePlatform:"psn"};
    accepted.push(game);addGameStats(acc,game,official.payload);
  }
  if(!accepted.length)return json({...current,refresh:{added:0,rejected:candidates.length}},200,{"Cache-Control":"no-store"});
  const now=new Date().toISOString();
  const snapshot={...current,publishedAt:now,lastSync:now,participants,games:[...current.games,...accepted],stats:serializedStats(acc)};
  await env.LEAGUE_STORE.put(LEAGUE_KEY,JSON.stringify(snapshot));
  return json({...snapshot,refresh:{added:accepted.length,rejected:candidates.length-accepted.length}},200,{"Cache-Control":"no-store"});
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
      if(url.pathname==="/api/league/refresh"){
        if(request.method!=="POST")return json({error:"Method not allowed"},405,{Allow:"POST, OPTIONS"});
        if(!env.LEAGUE_STORE)return json({error:"League storage is not configured"},503);
        const current=await env.LEAGUE_STORE.get(LEAGUE_KEY,"json");
        if(!current)return json({error:"League has not been published"},404);
        let incoming;try{incoming=await request.json()}catch{return json({error:"Invalid JSON"},400)}
        return refreshLeague(incoming,current,env);
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
      return json({ok:true,service:"MLB The Show 26 Custom League proxy",routes:["/api/history","/api/game-log","/api/league","/api/league/refresh"]});
    }catch(error){return json({error:error?.message||"Proxy error"},502);}
  }
};

async function proxy(upstream,ttl){
  const response=await fetch(upstream.toString(),{headers:{Accept:"application/json"},cf:{cacheEverything:true,cacheTtl:ttl}});
  const body=await response.arrayBuffer();
  return new Response(body,{status:response.status,headers:cors({"Content-Type":response.headers.get("Content-Type")||"application/json","Cache-Control":`public, max-age=${ttl}`} )});
}
