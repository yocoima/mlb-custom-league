import {
  cleanDisplayName,
  sameText,
  matchRosterParticipant,
  isCpuName,
  historyRows,
  isLeagueRow,
  isOnOrAfterStartDate,
  parseShowDate,
  normalizeHistoryGame,
  opponentFromGame,
  participantTeamFromGame,
  gameFingerprint,
  calculateStandings,
  gameParts,
  isCompatibleWithRegulationInnings,
  isFormallyCompletedGame,
  createStatAccumulator,
  addGameStats,
  battingLeaders,
  pitchingLeaders,
  filterStatLeaders,
  battingQualifies,
  pitchingQualifies,
  tournamentAwards
} from "./src/league-core.js?v=4.2.0";

const $ = s => document.querySelector(s);
const STORAGE_KEY = "mlb26_custom_league_config_v3";
const STATE_KEY = "mlb26_custom_league_state_v3";
const LEGACY_STORAGE_KEY = "mlb26_custom_league_config_v2";
const API_ORIGIN = "https://mlb26.theshow.com";
const DEFAULT_PROXY_BASE = "https://mlb26-custom-league-proxy.yocoimadejesus.workers.dev";
const CURRENT_LEAGUE_NAME = "Torneo Reclutas V2";

const state = {
  config: loadConfig(),
  participants: new Map(),
  games: new Map(),
  stats: createStatAccumulator(),
  lastSync: null,
  publishedAt: null,
  dataSeasonKey: null,
  activeLeagueId: new URLSearchParams(location.search).get("league")||localStorage.getItem("mlb26_active_league")||"principal",
  leagues: [],
  viewPhase: "regular",
  warnings: []
};

function defaultConfig(){
  return { leagueId:"",leagueName:"", username:"", platform:"psn", seedGameId:"", myTeam:"", startDate:"", regulationInnings:5, maxPages:20, proxyBase:DEFAULT_PROXY_BASE, roster:{}, champions:[], finalizedAt:null,phase:"regular",postseasonQualifiers:[],regularSeason:null,corrections:[] };
}
function loadConfigV3Only(){
  try { return {...defaultConfig(), ...JSON.parse(localStorage.getItem(STORAGE_KEY)||"{}")}; }
  catch { return defaultConfig(); }
}
function loadConfig(){
  const current=loadConfigV3Only();
  if(localStorage.getItem(STORAGE_KEY))return {...current,platform:"psn"};
  try{
    const legacy=JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY)||"{}");
    return {...defaultConfig(),...legacy,platform:"psn",roster:{},startDate:""};
  }catch{
    return defaultConfig();
  }
}
function saveConfig(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state.config)); }
function saveState(){
  const safe = {
    leagueId:state.activeLeagueId,participants:[...state.participants.values()], games:[...state.games.values()].map(g=>({...g,dateValue:g.dateValue?.toISOString?.()||null})), lastSync:state.lastSync,publishedAt:state.publishedAt,dataSeasonKey:state.dataSeasonKey
  };
  localStorage.setItem(STATE_KEY, JSON.stringify(safe));
}
function loadState(){
  try{
    const saved=JSON.parse(localStorage.getItem(STATE_KEY)||"{}");
    if(saved.leagueId&&saved.leagueId!==state.activeLeagueId)return;
    for(const p of saved.participants||[]) state.participants.set(participantKey(p.username),p);
    for(const g of saved.games||[]) state.games.set(String(g.dedupKey||g.uuid||g.id),{...g,dateValue:g.dateValue?new Date(g.dateValue):null});
    state.lastSync=saved.lastSync||null;
    state.publishedAt=saved.publishedAt||null;
    state.dataSeasonKey=saved.dataSeasonKey||null;
  }catch{}
}

function serializeStats(acc){return {batting:[...acc.batting.entries()],pitching:[...acc.pitching.entries()],loadedGameIds:[...acc.loadedGameIds],failedGameIds:[...acc.failedGameIds]};}
function deserializeStats(value={}){return {batting:new Map(value.batting||[]),pitching:new Map(value.pitching||[]),loadedGameIds:new Set(value.loadedGameIds||[]),failedGameIds:new Set(value.failedGameIds||[])};}
function gameKey(game){return String(game?.dedupKey||game?.uuid||game?.id||"");}
function gamePhase(game){return game?.phase==="postseason"?"postseason":"regular";}
function activePhase(){return state.config.phase==="postseason"?"postseason":"regular";}
function visibleLeagueName(value,id=state.activeLeagueId){return cleanDisplayName(value)||(id==="principal"?CURRENT_LEAGUE_NAME:"");}
function reservedLeagueName(value){return ["principal","torneo principal"].includes(cleanDisplayName(value).toLowerCase());}

function publicSnapshot(){
  return {
    version:1,lastSync:state.lastSync,config:{...state.config,leagueId:state.activeLeagueId,platform:"psn",proxyBase:state.config.proxyBase||DEFAULT_PROXY_BASE},
    participants:[...state.participants.values()],
    games:[...state.games.values()].map(({raw,...game})=>({...game,phase:gamePhase(game),dateValue:game.dateValue?.toISOString?.()||null})),
    stats:serializeStats(state.stats)
  };
}

function applyPublishedSnapshot(snapshot){
  state.config={...defaultConfig(),...(snapshot.config||{}),leagueId:state.activeLeagueId,leagueName:visibleLeagueName(snapshot.config?.leagueName),phase:snapshot.config?.phase==="postseason"?"postseason":"regular",platform:"psn",proxyBase:snapshot.config?.proxyBase||DEFAULT_PROXY_BASE};
  state.participants.clear();
  state.games.clear();
  for(const participant of snapshot.participants||[])state.participants.set(participantKey(participant.username),participant);
  for(const game of snapshot.games||[])state.games.set(gameKey(game),{...game,phase:gamePhase(game),dateValue:game.dateValue?new Date(game.dateValue):null});
  state.stats=deserializeStats(snapshot.stats);
  state.lastSync=snapshot.lastSync||null;
  state.publishedAt=snapshot.publishedAt||null;
  state.dataSeasonKey=seasonConfigKey(state.config);
  state.viewPhase=activePhase();
  state.warnings=[];
  if(state.config.regularSeason)refreshRegularArchiveDerived();
  saveConfig();saveState();fillForm();render();
}

function validPublishedSnapshot(snapshot){
  return snapshot?.version===1&&Array.isArray(snapshot.participants)&&Array.isArray(snapshot.games)&&
    Array.isArray(snapshot.stats?.batting)&&Array.isArray(snapshot.stats?.pitching)&&
    Array.isArray(snapshot.stats?.loadedGameIds)&&Array.isArray(snapshot.stats?.failedGameIds);
}

function seasonConfigKey(config){
  const roster=[...configuredRoster(config).values()].map(participant=>({
    username:participantKey(participant.username),team:cleanDisplayName(participant.team).toLowerCase(),
    aliases:[...(participant.aliases||[])].map(participantKey).sort()
  })).sort((a,b)=>a.username.localeCompare(b.username));
  return JSON.stringify({
    leagueName:cleanDisplayName(config.leagueName).toLowerCase(),commissioner:participantKey(config.username),
    startDate:String(config.startDate||""),regulationInnings:Number(config.regulationInnings),roster
  });
}

function esc(v){ return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function fmt3(v){ return Number(v||0).toFixed(3).replace(/^0/,""); }
function setStatus(text,kind="normal"){ const el=$("#status"); el.textContent=text; el.className=`notice ${kind}`; }
function warn(text){ if(!state.warnings.includes(text)) state.warnings.push(text); renderWarnings(); }
function renderWarnings(){ const el=$("#warnings"); if(!state.warnings.length){el.classList.add("hidden");el.innerHTML="";return;} el.classList.remove("hidden"); el.innerHTML=state.warnings.map(x=>`<div>• ${esc(x)}</div>`).join(""); }

function cleanArchivedAwards(value){
  if(!Array.isArray(value))return [];
  return value.slice(0,12).map(award=>({
    key:cleanDisplayName(award?.key).toLowerCase(),label:cleanDisplayName(award?.label),title:cleanDisplayName(award?.title),
    winners:Array.isArray(award?.winners)?award.winners.slice(0,20).map(winner=>({
      player:cleanDisplayName(winner?.player),manager:cleanDisplayName(winner?.manager),team:cleanDisplayName(winner?.team),value:cleanDisplayName(winner?.value)
    })).filter(winner=>winner.player&&winner.value):[]
  })).filter(award=>award.key&&award.title&&award.winners.length);
}

function formToConfig(){
  let roster={};
  const raw=$("#roster").value.trim();
  if(raw){ try{roster=JSON.parse(raw)}catch{throw new Error("El roster de la liga no es JSON válido.")} }
  if(!roster || Array.isArray(roster) || typeof roster!=="object") throw new Error("El roster debe ser un objeto JSON usuario → equipo.");
  const config={
    leagueName:cleanDisplayName($("#leagueName").value),
    username:cleanDisplayName($("#username").value),platform:"psn",seedGameId:"",myTeam:"",
    startDate:$("#startDate").value,
    regulationInnings:Math.min(9,Math.max(1,Number($("#regulationInnings").value)||5)),
    maxPages:Math.min(100,Math.max(1,Number($("#maxPages").value)||20)),
    proxyBase:DEFAULT_PROXY_BASE,roster,champions:state.config.champions||[],leagueId:state.activeLeagueId,
    finalizedAt:state.config.finalizedAt||null,phase:activePhase(),postseasonQualifiers:state.config.postseasonQualifiers||[],regularSeason:state.config.regularSeason||null,corrections:state.config.corrections||[]
  };
  if(!config.leagueName)throw new Error("Indica el nombre del torneo.");
  if(reservedLeagueName(config.leagueName))throw new Error("Asigna un nombre propio al torneo; 'principal' es solamente un identificador interno.");
  const configured=configuredRoster(config);config.myTeam=configured.get(participantKey(config.username))?.team||"";
  return config;
}
function fillForm(){
  $("#leagueName").value=state.config.leagueName||"";
  $("#username").value=state.config.username;
  $("#startDate").value=state.config.startDate||""; $("#regulationInnings").value=state.config.regulationInnings||5; $("#maxPages").value=state.config.maxPages;
  $("#roster").value=Object.keys(state.config.roster||{}).length?JSON.stringify(state.config.roster,null,2):"";
}

function apiUrl(kind, params){
  const q=new URLSearchParams(params);
  if(state.config.proxyBase){ return `${state.config.proxyBase}/api/${kind}?${q}`; }
  if(kind==="history") return `${API_ORIGIN}/apis/game_history.json?${q}`;
  if(kind==="game-log") return `${API_ORIGIN}/apis/game_log.json?${q}`;
  throw new Error("Endpoint desconocido");
}
function leagueApiUrl(){return `${state.config.proxyBase||DEFAULT_PROXY_BASE}/api/leagues/${encodeURIComponent(state.activeLeagueId)}`;}
function leagueIndexApiUrl(){return `${state.config.proxyBase||DEFAULT_PROXY_BASE}/api/leagues`;}
async function fetchJson(url,options={}){
  const r=await fetch(url,{...options,headers:{Accept:"application/json",...(options.headers||{})}});
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  const text=await r.text();
  try{return JSON.parse(text)}catch{throw new Error("La API no devolvió JSON válido.")}
}
async function fetchHistoryPage(username,platform,page){
  // LEAGUE no es un mode documentado por SDS. Consultamos all y filtramos localmente.
  return fetchJson(apiUrl("history",{username,platform,page:String(page),mode:"all"}));
}
async function fetchGameLog(id,username,platform){ return fetchJson(apiUrl("game-log",{id:String(id),username,platform})); }

async function loadPublishedLeague(){
  let response;
  try{response=await fetch(leagueApiUrl(),{headers:{Accept:"application/json"},cache:"no-store"})}catch{
    if(!state.games.size)setStatus("No se pudo conectar con la liga pública.","error");
    return;
  }
  if(response.status===404)return;
  if(!response.ok){if(!state.games.size)setStatus(`No se pudo cargar la liga pública (HTTP ${response.status}).`,"error");return;}
  const snapshot=await response.json();
  if(!validPublishedSnapshot(snapshot)){
    if(!state.games.size)setStatus("La liga pública todavía no está configurada.");
    return;
  }
  const localSync=state.lastSync?new Date(state.lastSync).getTime():0;
  const remoteSync=snapshot.lastSync?new Date(snapshot.lastSync).getTime():0;
  const remoteConfig={...defaultConfig(),...(snapshot.config||{}),leagueName:visibleLeagueName(snapshot.config?.leagueName)};
  const sameSeason=state.dataSeasonKey&&state.dataSeasonKey===seasonConfigKey(remoteConfig);
  if(sameSeason&&localSync>remoteSync){setStatus("Hay una actualización local más reciente pendiente de publicar.");return;}
  applyPublishedSnapshot(snapshot);
  setStatus(`Liga pública cargada: ${state.participants.size} participantes y ${state.games.size} partidos.`,"success");
}

function slugifyLeague(value){return cleanDisplayName(value).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,63);}
function updateLeagueSelector(){
  const entries=state.leagues.map(entry=>({...entry,name:visibleLeagueName(entry.name,entry.id)}));
  if(state.activeLeagueId&&!entries.some(entry=>entry.id===state.activeLeagueId))entries.unshift({id:state.activeLeagueId,name:state.config.leagueName||"Nuevo torneo"});
  $("#leagueSelector").innerHTML=entries.map(entry=>`<option value="${esc(entry.id)}">${esc(entry.name||entry.id)}${entry.finalizedAt?" · finalizado":""}</option>`).join("");
  $("#leagueSelector").value=state.activeLeagueId;
}
async function loadLeagueIndex(){
  try{
    const response=await fetch(leagueIndexApiUrl(),{headers:{Accept:"application/json"},cache:"no-store"});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const payload=await response.json();state.leagues=Array.isArray(payload.leagues)?payload.leagues:[];
    if(!state.leagues.some(entry=>entry.id===state.activeLeagueId)&&state.leagues.length)state.activeLeagueId=state.leagues[0].id;
    localStorage.setItem("mlb26_active_league",state.activeLeagueId);updateLeagueSelector();
    await loadPublishedLeague();
  }catch(error){setStatus(`No se pudo cargar el índice de torneos: ${error.message}`,"error");}
}
async function switchActiveLeague(id){
  if(!id||id===state.activeLeagueId)return;
  state.activeLeagueId=id;localStorage.setItem("mlb26_active_league",id);
  const url=new URL(location.href);url.searchParams.set("league",id);history.replaceState(null,"",url);
  state.config={...defaultConfig(),proxyBase:state.config.proxyBase||DEFAULT_PROXY_BASE,leagueId:id};state.participants.clear();state.games.clear();state.stats=createStatAccumulator();state.lastSync=null;state.publishedAt=null;state.dataSeasonKey=null;state.warnings=[];
  fillForm();render();updateLeagueSelector();await loadPublishedLeague();
}

async function publishLeague(providedToken=""){
  configuredRoster(state.config);
  const phaseGames=rawGamesForPhase(activePhase());
  if(phaseGames.length&&state.stats.loadedGameIds.size+state.stats.failedGameIds.size!==phaseGames.length)throw new Error("Carga las estadísticas de la fase actual antes de publicar.");
  const token=providedToken||window.prompt("Clave privada de publicación de la liga:");
  if(!token)return;
  const response=await fetch(leagueApiUrl(),{
    method:"POST",headers:{Accept:"application/json","Content-Type":"application/json",Authorization:`Bearer ${token}`},
    body:JSON.stringify(publicSnapshot())
  });
  let result={};
  try{result=await response.json()}catch{}
  if(!response.ok){
    if(response.status===401)throw new Error("Clave de publicación incorrecta.");
    throw new Error(result.error||`No se pudo publicar (HTTP ${response.status}).`);
  }
  state.publishedAt=result.publishedAt||new Date().toISOString();
  const summary={id:state.activeLeagueId,name:state.config.leagueName,commissioner:state.config.username,phase:activePhase(),finalizedAt:state.config.finalizedAt,participants:state.participants.size,games:state.games.size,updatedAt:state.publishedAt,champion:state.config.champions?.[0]||null,regularSeasonAwards:state.config.regularSeason?.awards||[]};
  const index=state.leagues.findIndex(entry=>entry.id===state.activeLeagueId);if(index>=0)state.leagues[index]=summary;else state.leagues.unshift(summary);updateLeagueSelector();
  saveState();
  setStatus(`Liga publicada: ${result.participants} participantes y ${result.games} partidos.`,"success");
  return result;
}

async function refreshSharedLeague(){
  const response=await fetch(`${leagueApiUrl()}/refresh`,{method:"POST",headers:{Accept:"application/json","Content-Type":"application/json"},body:JSON.stringify(publicSnapshot())});
  let result={};try{result=await response.json()}catch{}
  if(!response.ok){
    if(response.status===409&&result.error==="League is finalized")throw new Error("Este torneo ya está finalizado y no acepta juegos nuevos.");
    if(response.status===409)throw new Error("Otro usuario actualizó la liga mientras trabajabas. Recarga la página y pulsa Actualizar liga nuevamente.");
    throw new Error(result.error||`No se pudo actualizar la liga pública (HTTP ${response.status}).`);
  }
  const added=Number(result.refresh?.added||0),rejected=Number(result.refresh?.rejected||0);
  applyPublishedSnapshot(result);
  const crossLeagueRejected=Number(result.refresh?.crossLeagueRejected||0);
  if(crossLeagueRejected)warn(`${crossLeagueRejected} partido${crossLeagueRejected===1?"":"s"} ya pertenec${crossLeagueRejected===1?"e":"en"} a otro torneo y no se ${crossLeagueRejected===1?"agregó":"agregaron"}.`);
  if(rejected-crossLeagueRejected>0)warn(`${rejected-crossLeagueRejected} partidos candidatos no superaron la validación oficial del servidor.`);
  setStatus(added?`Liga pública actualizada: ${added} partido${added===1?"":"s"} nuevo${added===1?"":"s"} y estadísticas recalculadas.`:"La liga pública ya estaba al día.","success");
}

async function fetchAllHistory(username, platform, maxPages, onProgress = () => {}) {
  const rows = [];
  let totalPages = maxPages;

  for (let page = 1; page <= Math.min(totalPages, maxPages); page++) {
    const payload = await fetchHistoryPage(username, platform, page);

    const pageRows = historyRows(payload);

    rows.push(...pageRows);

    const reported = Number(payload?.total_pages);

    if (Number.isFinite(reported) && reported > 0) {
      totalPages = Math.min(reported, maxPages);
    }

    const leagueFound = rows.filter(isLeagueRow).length;

    onProgress(page, totalPages, rows.length, leagueFound);

    if (!pageRows.length) {
      break;
    }
    if(pageRows.every(row=>!isOnOrAfterStartDate(row?.display_date,state.config.startDate)))break;
  }

  return rows;
}

function participantKey(username){return cleanDisplayName(username).toLowerCase();}
function configuredRoster(config=state.config){
  const roster=new Map();
  for(const [rawName,value] of Object.entries(config.roster||{})){
    const data=typeof value==="string"?{team:value}:value;
    const username=cleanDisplayName(data?.username||rawName);
    const team=cleanDisplayName(data?.team||data?.teamName||"");
    const aliases=Array.isArray(data?.aliases)?data.aliases.map(cleanDisplayName).filter(Boolean):[];
    if(!username||!team) throw new Error(`El participante "${rawName}" necesita usuario y equipo.`);
    const key=participantKey(username);
    if(roster.has(key)) throw new Error(`El participante "${username}" está repetido en el roster.`);
    roster.set(key,{username,team,aliases,platform:"psn",status:"configured",discoveredBy:"Roster configurado"});
  }
  const primaryKey=participantKey(config.username);
  if(!config.startDate) throw new Error("Indica la fecha de inicio de esta temporada de liga.");
  if(!Number.isInteger(config.regulationInnings)||config.regulationInnings<1||config.regulationInnings>9) throw new Error("Las entradas reglamentarias deben estar entre 1 y 9.");
  if(roster.size<2) throw new Error("Configura al menos dos participantes con sus equipos.");
  if(!roster.has(primaryKey)) throw new Error("Incluye al comisionado / usuario principal dentro del roster.");
  return roster;
}

function loadConfiguredParticipants(){
  state.participants.clear();
  for(const participant of configuredRoster(state.config).values())addParticipant(participant);
}

function participantsForPhase(phase){
  const all=[...state.participants.values()];
  if(phase!=="postseason")return all;
  return all.filter(participant=>(state.config.postseasonQualifiers||[]).some(username=>sameText(username,participant.username)));
}
function allGamesForPhase(phase){return [...state.games.values()].filter(game=>gamePhase(game)===phase);}
function excludedGameKeys(phase){return new Set((state.config.corrections||[]).filter(item=>item.phase===phase&&item.type==="exclude").map(item=>item.gameKey));}
function rawGamesForPhase(phase){const excluded=excludedGameKeys(phase);return allGamesForPhase(phase).filter(game=>!excluded.has(gameKey(game)));}
function correctedGamesForPhase(phase){
  const corrections=(state.config.corrections||[]).filter(item=>item.phase===phase&&item.type==="result");
  return rawGamesForPhase(phase).map(game=>{
    const correction=corrections.filter(item=>item.gameKey===gameKey(game)).at(-1);if(!correction)return game;
    const homeScore=Number(correction.homeScore),awayScore=Number(correction.awayScore),homeWon=homeScore>awayScore;
    return {...game,homeScore,awayScore,homeResult:homeWon?"W":"L",awayResult:homeWon?"L":"W",corrected:true,correctionReason:correction.reason};
  });
}
function baseStatsForPhase(phase){
  if(phase==="regular"&&state.config.regularSeason?.stats)return deserializeStats(state.config.regularSeason.stats);
  if(phase===activePhase())return deserializeStats(serializeStats(state.stats));
  return createStatAccumulator();
}
function effectiveStatsForPhase(phase){
  const acc=baseStatsForPhase(phase);
  for(const correction of state.config.corrections||[]){
    if(correction.phase!==phase||!['batting','pitching'].includes(correction.type))continue;
    const map=correction.type==="batting"?acc.batting:acc.pitching,player=map.get(correction.playerKey);if(!player)continue;
    const field=correction.field;if(!Object.hasOwn(player,field)||typeof player[field]!=="number")continue;
    player[field]=Math.max(0,player[field]+Number(correction.delta||0));
  }
  return acc;
}
function displayedPhase(){return state.viewPhase==="postseason"?"postseason":"regular";}
function displayedStats(){return effectiveStatsForPhase(displayedPhase());}
function qualificationForPhase(phase,games=correctedGamesForPhase(phase)){return {games,regulationInnings:Number(state.config.regulationInnings)||9};}
function awardsForPhase(phase){const games=correctedGamesForPhase(phase);return tournamentAwards(effectiveStatsForPhase(phase),qualificationForPhase(phase,games));}
function refreshRegularArchiveDerived(){
  if(!state.config.regularSeason)return;
  const stats=effectiveStatsForPhase("regular"),games=correctedGamesForPhase("regular"),participants=participantsForPhase("regular");
  state.config.regularSeason={...state.config.regularSeason,standings:calculateStandings(games,participants),awards:tournamentAwards(stats,qualificationForPhase("regular",games))};
}

function startNewSeason(){
  const name=cleanDisplayName(window.prompt("Nombre del nuevo torneo:"));if(!name)return;
  if(reservedLeagueName(name))throw new Error("El nombre debe identificar el torneo; no puede ser 'principal' ni 'Torneo principal'.");
  let id=slugifyLeague(name);if(!id)throw new Error("El nombre no permite crear un identificador válido.");
  let suffix=2;while(state.leagues.some(entry=>entry.id===id))id=`${slugifyLeague(name).slice(0,58)}-${suffix++}`;
  state.activeLeagueId=id;localStorage.setItem("mlb26_active_league",id);const url=new URL(location.href);url.searchParams.set("league",id);history.replaceState(null,"",url);
  state.config={...state.config,leagueId:id,leagueName:name,seedGameId:"",startDate:"",finalizedAt:null,phase:"regular",postseasonQualifiers:[],regularSeason:null,corrections:[],champions:[]};
  state.games.clear();state.stats=createStatAccumulator();state.lastSync=null;state.publishedAt=null;state.dataSeasonKey=null;state.warnings=[];
  state.participants.clear();state.leagues.unshift({id,name,phase:"regular",participants:0,games:0});saveConfig();saveState();fillForm();render();updateLeagueSelector();
  document.querySelector('[data-tab="settings"]').click();
  $("#startDate").focus();
  setStatus("Nuevo torneo preparado sin reemplazar los anteriores. Revisa participantes, fecha e innings antes de guardarlo y publicarlo.","success");
}

function rosterMemberForName(name,roster){
  const clean=cleanDisplayName(name);
  if(!clean)return null;
  const direct=roster.get(participantKey(clean));
  if(direct)return direct;
  return [...roster.values()].find(p=>p.aliases.some(alias=>sameText(alias,clean)))||null;
}

function verifiedRosterMemberForOpponent(name,team,roster){
  return matchRosterParticipant(name,team,[...roster.values()],[...state.participants.values()]);
}

function addParticipant(p){
  const key=participantKey(p.username); if(!key)return null;
  const old=state.participants.get(key);
  if(old){
    if(old.team && p.team && !sameText(old.team,p.team)) return {conflict:true,participant:old};
    state.participants.set(key,{...old,...p,team:old.team||p.team,platform:"psn",status:p.status||old.status||"configured"});
  }else state.participants.set(key,{...p,platform:"psn",status:p.status||"configured"});
  return {conflict:false,participant:state.participants.get(key)};
}

function normalizeForParticipant(row,p){ return normalizeHistoryGame(row,{queryUser:p.username,queryTeam:p.team}); }
function gameBelongsToParticipantLeague(game,p){
  const team=participantTeamFromGame(game,p.username,p.team);
  return team && sameText(team,p.team);
}

function canonicalCandidate(row,p,roster){
  if(!isLeagueRow(row)||!isOnOrAfterStartDate(row.display_date,state.config.startDate))return null;
  if(activePhase()==="postseason"){
    const played=parseShowDate(row.display_date),closed=new Date(state.config.regularSeason?.closedAt||0);
    if(!played||played.getTime()<=closed.getTime()||!(state.config.postseasonQualifiers||[]).some(username=>sameText(username,p.username)))return null;
  }
  const game=normalizeForParticipant(row,p);
  if(!gameBelongsToParticipantLeague(game,p))return null;
  const opponent=opponentFromGame(game,p.username,p.team);
  if(!opponent?.user||isCpuName(opponent.user))return null;
  const opponentMember=verifiedRosterMemberForOpponent(opponent.user,opponent.team,roster);
  if(!opponentMember||!sameText(opponentMember.team,opponent.team))return null;
  if(activePhase()==="postseason"&&!(state.config.postseasonQualifiers||[]).some(username=>sameText(username,opponentMember.username)))return null;
  if(game.querySide==="home"){
    game.homeUser=p.username;
    game.awayUser=opponentMember.username;
  }else if(game.querySide==="away"){
    game.awayUser=p.username;
    game.homeUser=opponentMember.username;
  }else return null;
  return {
    game,
    record:{id:game.id,username:p.username,platform:"psn"}
  };
}

function bindParticipantIds(game,lineScore){
  const bindings=[
    [game.homeUser,lineScore?.home_player_id,lineScore?.home_mlb_team_id],
    [game.awayUser,lineScore?.away_player_id,lineScore?.away_mlb_team_id]
  ];
  for(const [username,playerId,teamId] of bindings){
    if(!playerId)continue;
    const key=participantKey(username);
    const participant=state.participants.get(key);
    if(!participant)continue;
    if(participant.playerId&&String(participant.playerId)!==String(playerId)){
      warn(`Identidad inconsistente para ${username}: aparecieron player_id ${participant.playerId} y ${playerId}.`);
      return false;
    }
    const duplicate=[...state.participants.values()].find(other=>!sameText(other.username,username)&&String(other.playerId||"")===String(playerId));
    if(duplicate){
      warn(`${username} y ${duplicate.username} comparten player_id ${playerId}; revisa aliases en el roster.`);
      return false;
    }
    state.participants.set(key,{...participant,playerId:String(playerId),teamId:teamId?String(teamId):participant.teamId,status:"verified"});
  }
  return true;
}

function mergeApiRecords(existing,records){
  const merged=[...(existing||[])];
  for(const record of records){
    if(!merged.some(item=>item.id===record.id&&sameText(item.username,record.username)))merged.push(record);
  }
  return merged;
}

function excludedGameLabel(game,lineScore){
  const awayScore=lineScore?.away_runs??game.awayScore??"?";
  const homeScore=lineScore?.home_runs??game.homeScore??"?";
  return `${game.awayUser} ${awayScore}–${homeScore} ${game.homeUser} (${game.date||"sin fecha"})`;
}

async function discoverLeague(){
  const cfg=state.config;
  if(!cfg.username) throw new Error("Ingresa tu usuario de The Show.");
  const roster=configuredRoster(cfg);
  const nextSeasonKey=seasonConfigKey(cfg);
  const sameSeason=state.dataSeasonKey===nextSeasonKey;
  const previousParticipants=sameSeason?new Map(state.participants):new Map();
  if(!sameSeason){state.games.clear();state.stats=createStatAccumulator();}
  state.warnings=[];state.participants.clear();
  const historyParticipants=activePhase()==="postseason"?[...roster.values()].filter(participant=>(cfg.postseasonQualifiers||[]).some(username=>sameText(username,participant.username))):[...roster.values()];
  for(const participant of historyParticipants){
    const previous=previousParticipants.get(participantKey(participant.username));
    addParticipant(previous&&sameText(previous.team,participant.team)
      ?{...participant,playerId:previous.playerId,teamId:previous.teamId,status:previous.status}
      :participant);
  }
  const existingByFingerprint=new Map([...state.games.values()].map(game=>[gameFingerprint(game),game]));
  const existingByRecord=new Map();
  for(const game of state.games.values())for(const record of game.apiRecords||[])existingByRecord.set(`${record.id}|${participantKey(record.username)}`,game);
  const candidateGroups=new Map();

  for(const participant of historyParticipants){
    setStatus(`Leyendo historial de ${participant.username} (${participant.team})…`);
    let rows=[];
    try{
      rows=await fetchAllHistory(participant.username,"psn",cfg.maxPages,(page,total,downloaded,leagueFound)=>{
        setStatus(`${participant.username}: página ${page}/${total} · ${downloaded} juegos revisados · ${leagueFound} LEAGUE encontrados`);
      });
    }catch(error){
      warn(`No pude leer el historial de ${participant.username} (psn): ${error.message}`);
      continue;
    }
    for(const row of rows){
      const candidate=canonicalCandidate(row,participant,roster);
      if(!candidate)continue;
      const fingerprint=gameFingerprint(candidate.game);
      if(!candidateGroups.has(fingerprint))candidateGroups.set(fingerprint,[]);
      candidateGroups.get(fingerprint).push(candidate);
    }
    render();
  }

  if(!candidateGroups.size)throw new Error("No se encontraron partidos que coincidan con el roster y la fecha inicial.");

  let checked=0;
  let failedLogs=0;
  let excludedByInnings=0;
  let excludedUnfinished=0;
  const unfinishedDetails=[];
  const inningsDetails=[];
  for(const [fingerprint,candidates] of candidateGroups){
    checked++;
    const knownGame=candidates.map(candidate=>existingByRecord.get(`${candidate.record.id}|${participantKey(candidate.record.username)}`)).find(Boolean)||existingByFingerprint.get(fingerprint);
    if(knownGame){
      knownGame.apiRecords=mergeApiRecords(knownGame.apiRecords,candidates.map(candidate=>candidate.record));
      continue;
    }
    setStatus(`Validando partidos y UUID: ${checked}/${candidateGroups.size}…`);
    let payload=null;
    let usedCandidate=candidates[0];
    for(const candidate of candidates){
      try{
        payload=await fetchGameLog(candidate.record.id,candidate.record.username,"psn");
        usedCandidate=candidate;
        break;
      }catch{}
    }
    const {lineScore}=payload?gameParts(payload):{lineScore:null};
    if(!lineScore){
      failedLogs++;
      continue;
    }
    if(lineScore&&String(lineScore.game_mode||"").toUpperCase()!=="LEAGUE")continue;
    if(!isFormallyCompletedGame(lineScore)){
      excludedUnfinished++;
      unfinishedDetails.push(`${excludedGameLabel(usedCandidate.game,lineScore)}, ruling ${lineScore.ruling??"?"}, ${lineScore.innings??"?"} entradas`);
      continue;
    }
    if(lineScore&&!isCompatibleWithRegulationInnings(lineScore,cfg.regulationInnings)){
      excludedByInnings++;
      inningsDetails.push(`${excludedGameLabel(usedCandidate.game,lineScore)}, ${lineScore.innings??"?"} entradas`);
      continue;
    }
    const uuid=cleanDisplayName(lineScore?.game_uuid);
    const dedupKey=uuid?`uuid:${uuid}`:`fingerprint:${fingerprint}`;
    const records=candidates.map(candidate=>candidate.record);
    const game={
      ...usedCandidate.game,
      id:usedCandidate.record.id,
      uuid:uuid||null,
      dedupKey,
      phase:activePhase(),
      apiRecords:records,
      sourceUser:usedCandidate.record.username,
      sourcePlatform:"psn",
      homePlayerId:lineScore?.home_player_id?String(lineScore.home_player_id):null,
      awayPlayerId:lineScore?.away_player_id?String(lineScore.away_player_id):null,
      homeResult:cleanDisplayName(lineScore?.home_display_result||usedCandidate.game.homeResult).toUpperCase(),
      awayResult:cleanDisplayName(lineScore?.away_display_result||usedCandidate.game.awayResult).toUpperCase(),
      ruling:cleanDisplayName(lineScore?.ruling||usedCandidate.game.ruling||"0")
    };
    if(lineScore&&!bindParticipantIds(game,lineScore))continue;
    const existing=state.games.get(dedupKey);
    if(existing)existing.apiRecords=mergeApiRecords(existing.apiRecords,records);
    else state.games.set(dedupKey,game);
  }

  if(failedLogs)warn(`${failedLogs} partidos se omitieron porque Game Log no permitió validar UUID, identidad y entradas.`);
  if(excludedUnfinished)warn(`${excludedUnfinished} partidos interrumpidos, empatados o decididos por ruling se excluyeron: ${unfinishedDetails.join("; ")}.`);
  if(excludedByInnings)warn(`${excludedByInnings} partidos se excluyeron porque no corresponden a una liga de ${cfg.regulationInnings} entradas: ${inningsDetails.join("; ")}.`);
  if(!state.games.size) throw new Error("No se pudieron validar partidos pertenecientes a la liga configurada.");
  state.lastSync=new Date().toISOString();state.dataSeasonKey=nextSeasonKey;saveState();render();
  setStatus(`Liga configurada: ${state.participants.size} participantes y ${state.games.size} partidos LEAGUE únicos.`,"success");
}

async function mapLimit(items,limit,fn){
  const results=new Array(items.length); let next=0;
  async function worker(){ while(true){const i=next++; if(i>=items.length)return; results[i]=await fn(items[i],i);} }
  await Promise.all(Array.from({length:Math.min(limit,items.length)},worker)); return results;
}

async function loadStats(){
  const allGames=rawGamesForPhase(activePhase()); if(!allGames.length) throw new Error("Primero actualiza la fase actual.");
  const games=allGames.filter(game=>!state.stats.loadedGameIds.has(game.id));
  if(!games.length){render();setStatus(`Las estadísticas ya están al día para ${allGames.length}/${allGames.length} partidos.`,"success");return;}
  let done=0;
  await mapLimit(games,4,async game=>{
    state.stats.failedGameIds.delete(game.id);
    const candidates=(game.apiRecords?.length?game.apiRecords:[{id:game.id,username:game.sourceUser,platform:game.sourcePlatform}]);
    let payload=null;
    for(const record of candidates){
      if(!record?.id||!record?.username)continue;
      try{payload=await fetchGameLog(record.id,record.username,"psn");break}catch{}
    }
    if(payload) addGameStats(state.stats,game,payload); else state.stats.failedGameIds.add(game.id);
    done++; setStatus(`Cargando Game Logs: ${done}/${games.length}…`); render();
  });
  if(state.stats.failedGameIds.size) warn(`${state.stats.failedGameIds.size} Game Logs no pudieron cargarse; las estadísticas se muestran con cobertura parcial.`);
  render(); setStatus(`Estadísticas cargadas para ${state.stats.loadedGameIds.size}/${allGames.length} partidos.`,"success");
}

function awardWinnerNames(award){
  return award.winners.map(winner=>`${winner.player} (${winner.manager})`).join(" · ");
}

function awardsPreview(awards){return awards.map(award=>`<article class="finish-award"><span>${esc(award.label)} · ${esc(award.title)}</span><strong>${esc(awardWinnerNames(award))} · ${esc(award.winners[0].value)}</strong></article>`).join("");}
function closeRegularDialog(){if($("#closeRegularDialog").open)$("#closeRegularDialog").close();}
function openCloseRegular(){
  if(activePhase()!=="regular"||state.config.regularSeason)throw new Error("La ronda regular ya fue cerrada.");
  const games=rawGamesForPhase("regular");if(!games.length)throw new Error("No hay partidos de ronda regular.");
  if(state.stats.failedGameIds.size||state.stats.loadedGameIds.size!==games.length)throw new Error("Todos los Game Logs de ronda regular deben estar cargados correctamente.");
  const standings=calculateStandings(correctedGamesForPhase("regular"),participantsForPhase("regular"));
  $("#qualifierList").innerHTML=standings.map((row,index)=>`<label><input type="checkbox" name="qualifier" value="${esc(row.user)}" ${index<4?"checked":""}/><span><strong>${esc(row.user)}</strong> · ${esc(row.team)} · ${row.w}-${row.l}</span></label>`).join("");
  $("#regularAwardsPreview").innerHTML=awardsPreview(awardsForPhase("regular"));
  $("#closeRegularDialog").showModal();
}
async function closeRegularSeason(){
  const qualifiers=[...document.querySelectorAll('input[name="qualifier"]:checked')].map(input=>input.value);if(qualifiers.length<2)throw new Error("Selecciona al menos dos clasificados.");
  const token=window.prompt("Clave privada para cerrar la ronda regular:");if(!token)return;
  const previousConfig=state.config,previousStats=state.stats,closedAt=new Date().toISOString(),games=correctedGamesForPhase("regular"),stats=effectiveStatsForPhase("regular");
  const regularSeason={closedAt,qualifiers,gameKeys:games.map(gameKey),standings:calculateStandings(games,participantsForPhase("regular")),stats:serializeStats(previousStats),awards:tournamentAwards(stats,qualificationForPhase("regular",games))};
  state.config={...state.config,phase:"postseason",postseasonQualifiers:qualifiers,regularSeason};state.stats=createStatAccumulator();state.viewPhase="postseason";
  try{saveConfig();await publishLeague(token);fillForm();render();closeRegularDialog();setStatus(`Ronda regular cerrada. ${qualifiers.length} clasificados y estadísticas de postemporada reiniciadas.`,"success");}
  catch(error){state.config=previousConfig;state.stats=previousStats;saveConfig();render();throw error;}
}

const BATTING_CORRECTION_FIELDS={ab:"Turnos (AB)",r:"Carreras (R)",h:"Hits (H)",doubles:"Dobles (2B)",triples:"Triples (3B)",hr:"Jonrones (HR)",rbi:"Impulsadas (RBI)",bb:"Boletos (BB)",so:"Ponches (SO)",sb:"Robos (SB)",cs:"Atrapado robando (CS)",hbp:"Golpeado (HBP)",sf:"Elevados de sacrificio (SF)"};
const PITCHING_CORRECTION_FIELDS={outs:"Outs lanzados (3 = 1.0 IP)",h:"Hits permitidos",r:"Carreras",er:"Carreras limpias",bb:"Boletos",so:"Ponches",w:"Victorias",l:"Derrotas",sv:"Salvados",bs:"Salvados desperdiciados",hold:"Holds"};
function closeCorrectionDialog(){if($("#correctionDialog").open)$("#correctionDialog").close();}
function correctionDescription(item){
  if(item.type==="exclude"){const game=state.games.get(item.gameKey);return `Excluido: ${game?.awayUser||"Visitante"} @ ${game?.homeUser||"Local"}`;}
  if(item.type==="result"){const game=state.games.get(item.gameKey);return `${game?.awayUser||"Visitante"} ${item.awayScore}-${item.homeScore} ${game?.homeUser||"Local"}`;}
  return `${item.type==="batting"?"Bateo":"Pitcheo"}: ${item.field} ${Number(item.delta)>0?"+":""}${item.delta}`;
}
function renderCorrectionHistory(){
  const items=state.config.corrections||[];
  $("#correctionHistory").innerHTML=items.length?items.slice().reverse().map(item=>`<article class="correction-item"><div><strong>${esc(correctionDescription(item))}</strong><br/><small>${esc(item.phase)} · ${esc(item.reason)}</small></div><button type="button" data-remove-correction="${esc(item.id)}">Eliminar</button></article>`).join(""):`<div class="empty compact">Sin correcciones registradas.</div>`;
}
function updateCorrectionTargets(){
  const phase=$("#correctionPhase").value,typeSelect=$("#correctionType"),excludeOption=typeSelect.querySelector('option[value="exclude"]');
  excludeOption.disabled=phase!==activePhase();if(typeSelect.value==="exclude"&&excludeOption.disabled)typeSelect.value="result";
  const type=typeSelect.value,isResult=type==="result",isGame=isResult||type==="exclude";
  $("#resultCorrectionFields").classList.toggle("hidden",!isResult);$("#statCorrectionFields").classList.toggle("hidden",isGame);
  $("#correctionTargetLabel").firstChild.textContent=isGame?"Partido":"Jugador ";
  if(isGame){
    const games=type==="exclude"?allGamesForPhase(phase).filter(game=>!excludedGameKeys(phase).has(gameKey(game))):correctedGamesForPhase(phase);$("#correctionTarget").innerHTML=games.map(game=>`<option value="${esc(gameKey(game))}">${esc(game.awayUser)} ${game.awayScore}-${game.homeScore} ${esc(game.homeUser)} · ${esc(game.date)}</option>`).join("");
  }else{
    const stats=effectiveStatsForPhase(phase),map=type==="batting"?stats.batting:stats.pitching;
    $("#correctionTarget").innerHTML=[...map.entries()].sort((a,b)=>a[1].name.localeCompare(b[1].name)).map(([key,player])=>`<option value="${esc(key)}">${esc(player.name)} · ${esc(player.manager)}</option>`).join("");
    const fields=type==="batting"?BATTING_CORRECTION_FIELDS:PITCHING_CORRECTION_FIELDS;$("#correctionField").innerHTML=Object.entries(fields).map(([key,label])=>`<option value="${key}">${esc(label)}</option>`).join("");
  }
  updateCorrectionScores();
}
function updateCorrectionScores(){const game=correctedGamesForPhase($("#correctionPhase").value).find(item=>gameKey(item)===$("#correctionTarget").value);if(game&&$("#correctionType").value==="result"){$("#correctAwayScore").value=game.awayScore;$("#correctHomeScore").value=game.homeScore;}}
function openCorrection(){
  if(!state.games.size)throw new Error("No hay juegos para corregir.");
  $("#correctionPhase").innerHTML=`<option value="regular">Ronda regular</option>${state.config.regularSeason?'<option value="postseason">Postemporada</option>':""}`;$("#correctionPhase").value=displayedPhase();$("#correctionReason").value="";$("#correctionDelta").value="";
  updateCorrectionTargets();renderCorrectionHistory();$("#correctionDialog").showModal();
}
function refreshArchivedAwardsAfterCorrection(){
  refreshRegularArchiveDerived();
  if(!state.config.finalizedAt||!state.config.champions?.length)return;
  const latest=state.config.champions[0];state.config.champions[0]={...latest,regularSeasonAwards:state.config.regularSeason?.awards||[],awards:awardsForPhase("postseason")};
}
async function saveCorrection(){
  const phase=$("#correctionPhase").value,type=$("#correctionType").value,target=$("#correctionTarget").value,reason=cleanDisplayName($("#correctionReason").value);if(!target||!reason)throw new Error("Selecciona el dato e indica el motivo.");
  const correction={id:crypto.randomUUID?.()||`${Date.now()}-${Math.random()}`,phase,type,gameKey:"",playerKey:"",field:"",delta:0,homeScore:0,awayScore:0,reason,createdAt:new Date().toISOString()};
  if(type==="result"){correction.gameKey=target;correction.awayScore=Number($("#correctAwayScore").value);correction.homeScore=Number($("#correctHomeScore").value);if(!Number.isInteger(correction.awayScore)||!Number.isInteger(correction.homeScore)||correction.awayScore<0||correction.homeScore<0||correction.awayScore===correction.homeScore)throw new Error("El marcador debe contener enteros no negativos y no puede terminar empatado.");}
  else if(type==="exclude"){if(phase!==activePhase())throw new Error("Solo puedes excluir partidos de la fase activa.");correction.gameKey=target;}
  else{correction.playerKey=target;correction.field=$("#correctionField").value;correction.delta=Number($("#correctionDelta").value);if(!Number.isInteger(correction.delta)||correction.delta===0)throw new Error("El ajuste debe ser un entero distinto de cero.");}
  const token=window.prompt("Clave privada para publicar la corrección:");if(!token)return;const previousConfig=structuredClone(state.config),previousStats=deserializeStats(serializeStats(state.stats));state.config={...state.config,corrections:[...(state.config.corrections||[]),correction]};
  try{if(type==="exclude"){state.stats=createStatAccumulator();if(rawGamesForPhase(activePhase()).length)await loadStats();}refreshArchivedAwardsAfterCorrection();saveConfig();await publishLeague(token);render();closeCorrectionDialog();setStatus(type==="exclude"?"Partido excluido de este torneo; tabla y estadísticas recalculadas.":"Corrección publicada y aplicada en todas las vistas.","success");}catch(error){state.config=previousConfig;state.stats=previousStats;saveConfig();render();throw error;}
}
async function removeCorrection(id){
  const token=window.prompt("Clave privada para eliminar la corrección:");if(!token)return;const previousConfig=structuredClone(state.config),previousStats=deserializeStats(serializeStats(state.stats)),removed=(state.config.corrections||[]).find(item=>item.id===id);state.config={...state.config,corrections:(state.config.corrections||[]).filter(item=>item.id!==id)};
  try{if(removed?.type==="exclude"){state.stats=createStatAccumulator();if(rawGamesForPhase(activePhase()).length)await loadStats();}refreshArchivedAwardsAfterCorrection();saveConfig();await publishLeague(token);renderCorrectionHistory();render();setStatus("Corrección eliminada.","success");}catch(error){state.config=previousConfig;state.stats=previousStats;saveConfig();render();throw error;}
}

function closeFinishSeason(){if($("#finishSeasonDialog").open)$("#finishSeasonDialog").close();}

function openFinishSeason(){
  if(state.config.finalizedAt)throw new Error("Este torneo ya fue finalizado.");
  const games=rawGamesForPhase(activePhase());if(!games.length)throw new Error("No se puede finalizar una fase sin partidos.");
  if(activePhase()!=="postseason")throw new Error("Primero finaliza la ronda regular y selecciona los clasificados.");
  if(state.stats.failedGameIds.size||state.stats.loadedGameIds.size!==games.length)throw new Error("Todos los Game Logs de postemporada deben estar cargados correctamente antes de finalizar.");
  const participants=participantsForPhase("postseason").sort((a,b)=>a.username.localeCompare(b.username));
  const standings=calculateStandings(correctedGamesForPhase("postseason"),participants);
  const options=participants.map(participant=>`<option value="${esc(participant.username)}">${esc(participant.username)} · ${esc(participant.team)}</option>`).join("");
  $("#seasonChampion").innerHTML=options;
  $("#seasonRunnerUp").innerHTML=`<option value="">No indicar</option>${options}`;
  if(standings[0])$("#seasonChampion").value=standings[0].user;
  $("#seasonResult").value="";$("#seasonNote").value="";
  const awards=awardsForPhase("postseason");
  $("#finishAwardsPreview").innerHTML=awardsPreview(awards);
  $("#finishSeasonDialog").showModal();
}

async function finishSeason(){
  const championName=cleanDisplayName($("#seasonChampion").value),runnerUp=cleanDisplayName($("#seasonRunnerUp").value);
  const champion=state.participants.get(participantKey(championName));
  if(!champion)throw new Error("Selecciona un campeón válido.");
  if(runnerUp&&sameText(runnerUp,championName))throw new Error("El campeón y subcampeón deben ser diferentes.");
  const token=window.prompt("Clave privada para finalizar y publicar el torneo:");
  if(!token)return;
  const previousConfig=state.config;
  const finalizedAt=new Date().toISOString();
  const entry={
    season:state.config.leagueName,champion:champion.username,team:champion.team,runnerUp,
    result:cleanDisplayName($("#seasonResult").value),note:cleanDisplayName($("#seasonNote").value),
    finalizedAt,awards:awardsForPhase("postseason"),regularSeasonAwards:state.config.regularSeason?.awards||[]
  };
  state.config={...state.config,finalizedAt,champions:[entry,...(state.config.champions||[]).filter(item=>!sameText(item.season,state.config.leagueName))]};
  try{
    saveConfig();await publishLeague(token);fillForm();render();closeFinishSeason();
    setStatus(`Torneo finalizado: ${champion.username} campeón y ${entry.awards.length} lideratos archivados.`,"success");
  }catch(error){state.config=previousConfig;saveConfig();render();throw error;}
}

function leaderCard(title,subtitle,players,value){
  const rows=players.slice(0,5);
  return `<article class="leader-card"><div class="leader-card-head"><div><span>${esc(subtitle)}</span><h3>${esc(title)}</h3></div><strong>${rows.length?esc(value(rows[0])):"—"}</strong></div>${rows.length?`<ol class="leader-list">${rows.map((player,index)=>`<li><span class="leader-position">${index+1}</span><span class="leader-player"><strong>${esc(player.name)}</strong><small>${esc(player.manager)}</small></span><strong class="leader-value">${esc(value(player))}</strong></li>`).join("")}</ol>`:`<div class="empty compact">Sin estadísticas.</div>`}</article>`;
}

function renderLeaders(stats=displayedStats()){
  const phase=displayedPhase(),qualification=qualificationForPhase(phase);
  const battingBy=category=>battingLeaders(stats,category);
  const average=battingBy("avg").filter(player=>battingQualifies(player,qualification));
  const pitching=pitchingLeaders(stats,"so");
  const paRate=(3.1*qualification.regulationInnings/9).toFixed(2),ipRate=(qualification.regulationInnings/9).toFixed(2);
  $("#leaderGrid").innerHTML=[
    leaderCard("Promedio",`AVG · mín. ${paRate} PA/juego del equipo`,average,player=>fmt3(player.avg)),
    leaderCard("Jonrones","HR",battingBy("hr"),player=>player.hr),
    leaderCard("Hits","H",battingBy("h"),player=>player.h),
    leaderCard("Impulsadas","RBI",battingBy("rbi"),player=>player.rbi),
    leaderCard("Bases robadas","SB",battingBy("sb"),player=>player.sb),
    leaderCard("Ponches","SO · Pitcheo",pitching,player=>player.so),
    leaderCard("Efectividad",`ERA · mín. ${ipRate} IP/juego del equipo`,pitchingLeaders(stats,"era").filter(player=>pitchingQualifies(player,qualification)),player=>player.era.toFixed(2)),
    leaderCard("Salvados","SV",pitchingLeaders(stats,"sv"),player=>player.sv)
  ].join("");
}

function renderChampions(){
  const indexed=state.leagues.filter(entry=>entry.champion||(entry.regularSeasonAwards||[]).length).map(entry=>entry.champion
    ?{...entry.champion,season:entry.name||entry.champion.season,leagueId:entry.id,pending:false}
    :{season:entry.name||entry.id,champion:"",team:"",runnerUp:"",result:"",note:"",awards:[],regularSeasonAwards:entry.regularSeasonAwards||[],leagueId:entry.id,pending:true});
  const local=Array.isArray(state.config.champions)?state.config.champions.map(entry=>({...entry,leagueId:state.activeLeagueId,pending:false})):[];
  if(state.config.regularSeason&&!local.some(entry=>sameText(entry.season,state.config.leagueName))){
    local.unshift({season:state.config.leagueName,champion:"",team:"",runnerUp:"",result:"",note:"",awards:[],regularSeasonAwards:state.config.regularSeason.awards||[],leagueId:state.activeLeagueId,pending:true});
  }
  const champions=[...local,...indexed.filter(entry=>!local.some(item=>item.leagueId===entry.leagueId))];
  if(!champions.length){
    $("#championSpotlight").innerHTML=`<div class="empty champion-empty">Aún no se ha publicado el historial de campeones.</div>`;
    $("#championsHistory").innerHTML="";
    return;
  }
  const latest=champions.find(entry=>entry.champion&&!entry.pending)||champions[0];
  const latestPending=latest.pending||!latest.champion;
  $("#championSpotlight").innerHTML=`<article class="champion-spotlight"><div class="trophy" aria-hidden="true">${latestPending?"…":"★"}</div><div><span>${latestPending?"Torneo en curso":"Último campeón"} · ${esc(latest.season)}</span><h3>${latestPending?"Campeón por definir":esc(latest.champion)}</h3><p>${latestPending?"Ronda regular finalizada · Postemporada en curso":`${latest.team?esc(latest.team):""}${latest.runnerUp?` · Final vs. ${esc(latest.runnerUp)}`:""}${latest.result?` · ${esc(latest.result)}`:""}`}</p>${latest.note?`<small>${esc(latest.note)}</small>`:""}</div></article>`;
  $("#championsHistory").innerHTML=`<h3>Historial</h3><div class="champion-grid">${champions.map((entry,index)=>{
    const regularAwards=cleanArchivedAwards(entry.regularSeasonAwards),awards=cleanArchivedAwards(entry.awards);
    const combined=[...regularAwards.map(award=>({...award,phaseLabel:"Regular"})),...awards.map(award=>({...award,phaseLabel:"Post"}))];
    const awardHtml=combined.length?`<div class="archive-awards">${combined.map(award=>`<article class="archive-award"><span>${esc(award.phaseLabel)} · ${esc(award.label)} · ${esc(award.title)}</span><small>${esc(awardWinnerNames(award))} · <strong>${esc(award.winners[0].value)}</strong></small></article>`).join("")}</div>`:"";
    const pending=entry.pending||!entry.champion;
    return `<article class="season-archive"><div class="champion-entry"><span class="champion-number">${String(champions.length-index).padStart(2,"0")}</span><div><small>${esc(entry.season)}</small><strong>${pending?"Campeón por definir":esc(entry.champion)}</strong><span>${pending?"Ronda regular finalizada · Postemporada en curso":`${entry.team?esc(entry.team):"Equipo no indicado"}${entry.runnerUp?` · vs. ${esc(entry.runnerUp)}`:""}${entry.result?` · ${esc(entry.result)}`:""}`}</span></div></div>${awardHtml}</article>`;
  }).join("")}</div>`;
}

function updateStatFilterOptions(prefix,players){
  for(const [suffix,field,label] of [["ManagerFilter","manager","Todos los managers"],["TeamFilter","team","Todos los equipos"]]){
    const select=$(`#${prefix}${suffix}`),selected=select.value;
    const values=[...new Set(players.map(player=>cleanDisplayName(player[field])).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
    select.innerHTML=`<option value="">${label}</option>${values.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join("")}`;
    if(values.includes(selected))select.value=selected;
  }
}
function filteredStatRows(players,prefix){
  updateStatFilterOptions(prefix,players);
  return filterStatLeaders(players,{query:$(`#${prefix}Search`).value,manager:$(`#${prefix}ManagerFilter`).value,team:$(`#${prefix}TeamFilter`).value});
}

function render(){
  const phase=displayedPhase(),games=correctedGamesForPhase(phase).sort((a,b)=>(b.dateValue?.getTime?.()||0)-(a.dateValue?.getTime?.()||0)),stats=displayedStats();
  const standings=calculateStandings(games,participantsForPhase(phase));
  const leagueName=cleanDisplayName(state.config.leagueName);
  const finalized=Boolean(state.config.finalizedAt);
  $("#currentLeagueName").textContent=leagueName?`${leagueName} · ${finalized?"Torneo finalizado":"Solo Custom League"}`:"Solo Custom League · Game History + Game Log";
  document.title=leagueName?`${leagueName} — MLB The Show 26`:`MLB The Show 26 — Custom League Manager`;
  $("#syncBtn").disabled=finalized;$("#statsBtn").disabled=finalized;$("#finishSeasonBtn").disabled=finalized||activePhase()!=="postseason";$("#closeRegularBtn").disabled=finalized||activePhase()!=="regular";$("#correctionBtn").disabled=!state.games.size;
  $("#finishSeasonBtn").textContent=finalized?"Torneo finalizado":"Finalizar torneo";
  $("#phaseView").value=phase;$("#phaseView").querySelector('option[value="postseason"]').disabled=!state.config.regularSeason;
  $("#phaseStatus").textContent=finalized?"Torneo finalizado":activePhase()==="postseason"?`${state.config.postseasonQualifiers.length} clasificados · Postemporada activa`:"Ronda regular activa";
  $("#participantCount").textContent=participantsForPhase(phase).length;
  $("#gameCount").textContent=games.length;
  $("#logCount").textContent=stats.loadedGameIds.size;
  $("#lastSync").textContent=state.lastSync?new Date(state.lastSync).toLocaleString():"—";
  renderWarnings();

  $("#standingsBody").innerHTML=standings.length?standings.map((r,i)=>`<tr><td class="rank">${i+1}</td><td class="standings-player"><strong>${esc(r.user)}</strong><small class="mobile-only">${esc(r.team)}</small></td><td class="desktop-only"><span class="team-pill">${esc(r.team)}</span></td><td class="desktop-only">${r.gp}</td><td class="desktop-only">${r.w}</td><td class="desktop-only">${r.l}</td><td class="mobile-only record">${r.w}-${r.l}</td><td class="desktop-only">${r.homeGp}</td><td class="desktop-only">${r.awayGp}</td><td>${fmt3(r.pct)}</td><td class="desktop-only">${r.rf}</td><td class="desktop-only">${r.ra}</td><td class="${r.diff>=0?"positive":"negative"}">${r.diff>0?"+":""}${r.diff}</td><td class="desktop-only">${r.form.join(" ")||"—"}</td></tr>`).join(""):`<tr><td colspan="14" class="empty">Sin datos.</td></tr>`;

  renderLeaders(stats);
  renderChampions();

  $("#gamesList").innerHTML=games.length?games.map(g=>{
    const decidedEarly=String(g.ruling||"0")!=="0";
    const winner=g.homeResult==="W"?g.homeUser:g.awayResult==="W"?g.awayUser:"";
    const decision=decidedEarly&&winner?` · Decisión oficial: ${esc(winner)} gana (ruling ${esc(g.ruling)})`:"";
    return `<article class="game-card"><div><div><span class="manager">${esc(g.awayUser)}</span> · <strong>${esc(g.awayTeam)}</strong> <span class="muted">@</span> <span class="manager">${esc(g.homeUser)}</span> · <strong>${esc(g.homeTeam)}</strong></div><div class="meta">${esc(g.date||"Fecha no disponible")} · ${g.uuid?`UUID ${esc(g.uuid)}`:`ID ${esc(g.id)} (sin UUID)`}${g.pitcherInfo?` · ${esc(g.pitcherInfo)}`:""}${decision}${g.corrected?` · Corrección: ${esc(g.correctionReason)}`:""}</div></div><div class="score">${g.awayScore??"—"} — ${g.homeScore??"—"}${decidedEarly?"*":""}</div></article>`;
  }).join(""):`<div class="empty">Sin datos.</div>`;

  const bat=filteredStatRows(battingLeaders(stats,$("#battingSort")?.value||"avg"),"batting");
  $("#battingBody").innerHTML=bat.length?bat.map((p,i)=>`<tr><td class="rank">${i+1}</td><td><strong>${esc(p.name)}</strong></td><td>${esc(p.manager)}</td><td><span class="team-pill">${esc(p.team)}</span></td><td>${p.g}</td><td>${p.ab}</td><td>${p.r}</td><td>${p.h}</td><td>${p.doubles}</td><td>${p.triples}</td><td>${p.hr}</td><td>${p.rbi}</td><td>${p.bb}</td><td>${p.so}</td><td>${p.sb}</td><td>${fmt3(p.avg)}</td><td>${fmt3(p.obp)}</td><td>${fmt3(p.slg)}</td><td><strong>${fmt3(p.ops)}</strong></td></tr>`).join(""):`<tr><td colspan="19" class="empty">No hay jugadores que coincidan con los filtros.</td></tr>`;

  const pit=filteredStatRows(pitchingLeaders(stats,$("#pitchingSort")?.value||"so"),"pitching");
  $("#pitchingBody").innerHTML=pit.length?pit.map((p,i)=>`<tr><td class="rank">${i+1}</td><td><strong>${esc(p.name)}</strong></td><td>${esc(p.manager)}</td><td><span class="team-pill">${esc(p.team)}</span></td><td>${p.g}</td><td>${p.ip}</td><td>${p.w}</td><td>${p.l}</td><td>${p.sv}</td><td>${p.h}</td><td>${p.er}</td><td>${p.bb}</td><td>${p.so}</td><td>${p.era.toFixed(2)}</td><td>${p.whip.toFixed(2)}</td><td>${p.k9.toFixed(2)}</td></tr>`).join(""):`<tr><td colspan="16" class="empty">No hay pitchers que coincidan con los filtros.</td></tr>`;

  const participants=[...state.participants.values()].sort((a,b)=>a.username.localeCompare(b.username));
  $("#participantsBody").innerHTML=participants.length?participants.map(p=>`<tr><td><strong>${esc(p.username)}</strong></td><td><span class="team-pill">${esc(p.team)}</span></td><td><span class="status-pill ${p.playerId?"ok":"warn"}">${p.playerId?`verificado · ID ${esc(p.playerId)}`:"configurado · sin juegos"}</span></td><td>${esc(p.discoveredBy||"Roster configurado")}</td></tr>`).join(""):`<tr><td colspan="4" class="empty">Sin datos.</td></tr>`;
}

$("#settingsForm").addEventListener("submit",e=>{e.preventDefault();try{state.config=formToConfig();if(!state.games.size)loadConfiguredParticipants();saveConfig();saveState();render();setStatus("Configuración guardada.","success")}catch(err){setStatus(err.message,"error")}});
$("#syncBtn").addEventListener("click",async()=>{try{state.config=formToConfig();saveConfig();$("#syncBtn").disabled=true;$("#statsBtn").disabled=true;await discoverLeague();await loadStats();await refreshSharedLeague()}catch(e){setStatus(e.message,"error")}finally{render()}});
$("#statsBtn").addEventListener("click",async()=>{try{$("#statsBtn").disabled=true;await loadStats()}catch(e){setStatus(e.message,"error")}finally{render()}});
$("#publishBtn").addEventListener("click",async()=>{try{$("#publishBtn").disabled=true;await publishLeague()}catch(e){setStatus(e.message,"error")}finally{$("#publishBtn").disabled=false}});
$("#closeRegularBtn").addEventListener("click",()=>{try{openCloseRegular()}catch(error){setStatus(error.message,"error")}});
$("#closeRegularForm").addEventListener("submit",async event=>{event.preventDefault();const button=event.submitter;try{button.disabled=true;await closeRegularSeason()}catch(error){setStatus(error.message,"error")}finally{button.disabled=false}});
$("#cancelRegularBtn").addEventListener("click",closeRegularDialog);$("#cancelRegularFooterBtn").addEventListener("click",closeRegularDialog);
$("#correctionBtn").addEventListener("click",()=>{try{openCorrection()}catch(error){setStatus(error.message,"error")}});
$("#correctionForm").addEventListener("submit",async event=>{event.preventDefault();const button=event.submitter;try{button.disabled=true;await saveCorrection()}catch(error){setStatus(error.message,"error")}finally{button.disabled=false}});
$("#cancelCorrectionBtn").addEventListener("click",closeCorrectionDialog);$("#cancelCorrectionFooterBtn").addEventListener("click",closeCorrectionDialog);
$("#correctionPhase").addEventListener("change",updateCorrectionTargets);$("#correctionType").addEventListener("change",updateCorrectionTargets);$("#correctionTarget").addEventListener("change",updateCorrectionScores);
$("#correctionHistory").addEventListener("click",async event=>{const id=event.target.dataset.removeCorrection;if(!id)return;try{event.target.disabled=true;await removeCorrection(id)}catch(error){setStatus(error.message,"error")}finally{event.target.disabled=false}});
$("#finishSeasonBtn").addEventListener("click",()=>{try{openFinishSeason()}catch(error){setStatus(error.message,"error")}});
$("#finishSeasonForm").addEventListener("submit",async event=>{event.preventDefault();const button=event.submitter;try{button.disabled=true;await finishSeason()}catch(error){setStatus(error.message,"error")}finally{button.disabled=false}});
$("#cancelFinishBtn").addEventListener("click",closeFinishSeason);$("#cancelFinishFooterBtn").addEventListener("click",closeFinishSeason);
$("#newSeasonBtn").addEventListener("click",()=>{try{startNewSeason()}catch(error){setStatus(error.message,"error")}});
$("#battingSort").addEventListener("change",render);
$("#pitchingSort").addEventListener("change",render);
for(const id of ["battingSearch","pitchingSearch"])$("#"+id).addEventListener("input",render);
for(const id of ["battingManagerFilter","battingTeamFilter","pitchingManagerFilter","pitchingTeamFilter"])$("#"+id).addEventListener("change",render);
$("#phaseView").addEventListener("change",event=>{state.viewPhase=event.target.value;render()});
$("#leagueSelector").addEventListener("change",event=>switchActiveLeague(event.target.value));
document.querySelectorAll(".tab").forEach(btn=>btn.addEventListener("click",()=>{document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));document.querySelectorAll(".panel").forEach(x=>x.classList.remove("active"));btn.classList.add("active");$("#"+btn.dataset.tab).classList.add("active")}));

loadState();fillForm();render();loadLeagueIndex();
