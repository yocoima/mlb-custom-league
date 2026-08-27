import {
  PLATFORM_VALUES,
  cleanDisplayName,
  sameText,
  isCpuName,
  historyRows,
  isLeagueRow,
  isOnOrAfterStartDate,
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
  tournamentAwards
} from "./src/league-core.js?v=3.7.0";

const $ = s => document.querySelector(s);
const STORAGE_KEY = "mlb26_custom_league_config_v3";
const STATE_KEY = "mlb26_custom_league_state_v3";
const LEGACY_STORAGE_KEY = "mlb26_custom_league_config_v2";
const API_ORIGIN = "https://mlb26.theshow.com";
const DEFAULT_PROXY_BASE = "https://mlb26-custom-league-proxy.yocoimadejesus.workers.dev";

const state = {
  config: loadConfig(),
  participants: new Map(),
  games: new Map(),
  stats: createStatAccumulator(),
  lastSync: null,
  publishedAt: null,
  dataSeasonKey: null,
  warnings: []
};

function defaultConfig(){
  return { leagueName:"", username:"", platform:"psn", seedGameId:"", myTeam:"", startDate:"", regulationInnings:5, maxPages:20, proxyBase:DEFAULT_PROXY_BASE, roster:{}, champions:[], finalizedAt:null };
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
    participants:[...state.participants.values()], games:[...state.games.values()].map(g=>({...g,dateValue:g.dateValue?.toISOString?.()||null})), lastSync:state.lastSync,publishedAt:state.publishedAt,dataSeasonKey:state.dataSeasonKey
  };
  localStorage.setItem(STATE_KEY, JSON.stringify(safe));
}
function loadState(){
  try{
    const saved=JSON.parse(localStorage.getItem(STATE_KEY)||"{}");
    for(const p of saved.participants||[]) state.participants.set(participantKey(p.username),p);
    for(const g of saved.games||[]) state.games.set(String(g.dedupKey||g.uuid||g.id),{...g,dateValue:g.dateValue?new Date(g.dateValue):null});
    state.lastSync=saved.lastSync||null;
    state.publishedAt=saved.publishedAt||null;
    state.dataSeasonKey=saved.dataSeasonKey||null;
  }catch{}
}

function publicSnapshot(){
  return {
    version:1,lastSync:state.lastSync,config:{...state.config,platform:"psn",proxyBase:state.config.proxyBase||DEFAULT_PROXY_BASE},
    participants:[...state.participants.values()],
    games:[...state.games.values()].map(({raw,...game})=>({...game,dateValue:game.dateValue?.toISOString?.()||null})),
    stats:{
      batting:[...state.stats.batting.entries()],pitching:[...state.stats.pitching.entries()],
      loadedGameIds:[...state.stats.loadedGameIds],failedGameIds:[...state.stats.failedGameIds]
    }
  };
}

function applyPublishedSnapshot(snapshot){
  state.config={...defaultConfig(),...(snapshot.config||{}),leagueName:snapshot.config?.leagueName||"Liga actual",platform:"psn",proxyBase:snapshot.config?.proxyBase||DEFAULT_PROXY_BASE};
  state.participants.clear();
  state.games.clear();
  for(const participant of snapshot.participants||[])state.participants.set(participantKey(participant.username),participant);
  for(const game of snapshot.games||[])state.games.set(String(game.dedupKey||game.uuid||game.id),{...game,dateValue:game.dateValue?new Date(game.dateValue):null});
  state.stats={
    batting:new Map(snapshot.stats?.batting||[]),pitching:new Map(snapshot.stats?.pitching||[]),
    loadedGameIds:new Set(snapshot.stats?.loadedGameIds||[]),failedGameIds:new Set(snapshot.stats?.failedGameIds||[])
  };
  state.lastSync=snapshot.lastSync||null;
  state.publishedAt=snapshot.publishedAt||null;
  state.dataSeasonKey=seasonConfigKey(state.config);
  state.warnings=[];
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
  let champions=[];
  const championsRaw=$("#championsHistoryInput").value.trim();
  if(championsRaw){try{champions=JSON.parse(championsRaw)}catch{throw new Error("El historial de campeones no es JSON válido.")}}
  if(!Array.isArray(champions))throw new Error("El historial de campeones debe ser una lista JSON.");
  if(champions.length>50)throw new Error("El historial admite hasta 50 campeones.");
  champions=champions.map((entry,index)=>{
    if(!entry||typeof entry!=="object"||Array.isArray(entry))throw new Error(`El campeón #${index+1} no es válido.`);
    const champion={
      season:cleanDisplayName(entry.season),champion:cleanDisplayName(entry.champion),team:cleanDisplayName(entry.team),
      runnerUp:cleanDisplayName(entry.runnerUp),result:cleanDisplayName(entry.result),note:cleanDisplayName(entry.note),
      finalizedAt:cleanDisplayName(entry.finalizedAt),awards:cleanArchivedAwards(entry.awards)
    };
    if(!champion.season||!champion.champion)throw new Error(`El campeón #${index+1} necesita season y champion.`);
    return champion;
  });
  const platform=$("#platform").value;
  if(!PLATFORM_VALUES.includes(platform)) throw new Error("Plataforma inválida.");
  const config={
    leagueName:cleanDisplayName($("#leagueName").value),
    username:cleanDisplayName($("#username").value), platform,
    seedGameId:$("#seedGameId").value.trim(), myTeam:cleanDisplayName($("#myTeam").value),
    startDate:$("#startDate").value,
    regulationInnings:Math.min(9,Math.max(1,Number($("#regulationInnings").value)||5)),
    maxPages:Math.min(100,Math.max(1,Number($("#maxPages").value)||20)),
    proxyBase:$("#proxyBase").value.trim().replace(/\/$/,""), roster, champions,finalizedAt:state.config.finalizedAt||null
  };
  if(!config.leagueName)throw new Error("Indica el nombre del torneo.");
  configuredRoster(config);
  return config;
}
function fillForm(){
  $("#leagueName").value=state.config.leagueName||"";
  $("#username").value=state.config.username; $("#platform").value=state.config.platform;
  $("#seedGameId").value=state.config.seedGameId; $("#myTeam").value=state.config.myTeam;
  $("#startDate").value=state.config.startDate||""; $("#regulationInnings").value=state.config.regulationInnings||5; $("#maxPages").value=state.config.maxPages;
  $("#proxyBase").value=state.config.proxyBase; $("#roster").value=Object.keys(state.config.roster||{}).length?JSON.stringify(state.config.roster,null,2):"";
  $("#championsHistoryInput").value=state.config.champions?.length?JSON.stringify(state.config.champions,null,2):"";
}

function apiUrl(kind, params){
  const q=new URLSearchParams(params);
  if(state.config.proxyBase){ return `${state.config.proxyBase}/api/${kind}?${q}`; }
  if(kind==="history") return `${API_ORIGIN}/apis/game_history.json?${q}`;
  if(kind==="game-log") return `${API_ORIGIN}/apis/game_log.json?${q}`;
  throw new Error("Endpoint desconocido");
}
function leagueApiUrl(){return `${state.config.proxyBase||DEFAULT_PROXY_BASE}/api/league`;}
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
  const remoteConfig={...defaultConfig(),...(snapshot.config||{}),leagueName:snapshot.config?.leagueName||"Liga actual"};
  const sameSeason=state.dataSeasonKey&&state.dataSeasonKey===seasonConfigKey(remoteConfig);
  if(sameSeason&&localSync>remoteSync){setStatus("Hay una actualización local más reciente pendiente de publicar.");return;}
  applyPublishedSnapshot(snapshot);
  setStatus(`Liga pública cargada: ${state.participants.size} participantes y ${state.games.size} partidos.`,"success");
}

async function publishLeague(providedToken=""){
  configuredRoster(state.config);
  if(state.games.size&&state.stats.loadedGameIds.size+state.stats.failedGameIds.size!==state.games.size)throw new Error("Carga las estadísticas antes de publicar.");
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
  if(rejected)warn(`${rejected} partidos candidatos no superaron la validación oficial del servidor.`);
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
  if(config.username&&config.myTeam){
    const current=roster.get(primaryKey);
    if(current&&!sameText(current.team,config.myTeam)) throw new Error("Mi equipo no coincide con el equipo indicado en el roster.");
    if(!current) roster.set(primaryKey,{username:config.username,team:config.myTeam,aliases:[],platform:"psn",status:"configured",discoveredBy:"Configuración principal"});
  }
  if(!config.startDate) throw new Error("Indica la fecha de inicio de esta temporada de liga.");
  if(!Number.isInteger(config.regulationInnings)||config.regulationInnings<1||config.regulationInnings>9) throw new Error("Las entradas reglamentarias deben estar entre 1 y 9.");
  if(roster.size<2) throw new Error("Configura al menos dos participantes con sus equipos.");
  if(!roster.has(primaryKey)) throw new Error("Incluye al usuario principal en el roster o completa 'Mi equipo'.");
  return roster;
}

function loadConfiguredParticipants(){
  state.participants.clear();
  for(const participant of configuredRoster(state.config).values())addParticipant(participant);
}

function startNewSeason(){
  if(!window.confirm("Se preparará una temporada nueva. La liga pública actual no cambiará hasta que guardes y publiques."))return;
  state.config={...state.config,leagueName:"",seedGameId:"",startDate:"",finalizedAt:null};
  state.games.clear();state.stats=createStatAccumulator();state.lastSync=null;state.publishedAt=null;state.dataSeasonKey=null;state.warnings=[];
  state.participants.clear();saveConfig();saveState();fillForm();render();
  document.querySelector('[data-tab="settings"]').click();
  $("#leagueName").focus();
  setStatus("Nueva temporada preparada. Puedes cambiar nombre, comisionado, participantes, equipos e innings antes de guardarla y publicarla.","success");
}

function rosterMemberForName(name,roster){
  const clean=cleanDisplayName(name);
  if(!clean)return null;
  const direct=roster.get(participantKey(clean));
  if(direct)return direct;
  return [...roster.values()].find(p=>p.aliases.some(alias=>sameText(alias,clean)))||null;
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
  const game=normalizeForParticipant(row,p);
  if(!gameBelongsToParticipantLeague(game,p))return null;
  const opponent=opponentFromGame(game,p.username,p.team);
  if(!opponent?.user||isCpuName(opponent.user))return null;
  const opponentMember=rosterMemberForName(opponent.user,roster);
  if(!opponentMember||!sameText(opponentMember.team,opponent.team))return null;
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
  for(const participant of roster.values()){
    const previous=previousParticipants.get(participantKey(participant.username));
    addParticipant(previous&&sameText(previous.team,participant.team)
      ?{...participant,playerId:previous.playerId,teamId:previous.teamId,status:previous.status}
      :participant);
  }
  const existingByFingerprint=new Map([...state.games.values()].map(game=>[gameFingerprint(game),game]));
  const existingByRecord=new Map();
  for(const game of state.games.values())for(const record of game.apiRecords||[])existingByRecord.set(`${record.id}|${participantKey(record.username)}`,game);
  const candidateGroups=new Map();
  let seedFound=!cfg.seedGameId;
  let seedSeenInHistory=!cfg.seedGameId;

  for(const participant of roster.values()){
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
      if(String(row?.id??row?.game_id??row?.gameId??"")===String(cfg.seedGameId))seedSeenInHistory=true;
      const candidate=canonicalCandidate(row,participant,roster);
      if(!candidate)continue;
      if(String(candidate.game.id)===String(cfg.seedGameId))seedFound=true;
      const fingerprint=gameFingerprint(candidate.game);
      if(!candidateGroups.has(fingerprint))candidateGroups.set(fingerprint,[]);
      candidateGroups.get(fingerprint).push(candidate);
    }
    render();
  }

  if(!candidateGroups.size)throw new Error("No se encontraron partidos que coincidan con el roster y la fecha inicial.");
  if(!seedFound){
    warn(seedSeenInHistory
      ? "El Game ID semilla apareció en el historial, pero no coincidió con el roster, la fecha o los equipos configurados. Se continuará porque esta validación es opcional."
      : "El Game ID semilla no apareció en los historiales consultados. Se continuará porque esta validación es opcional.");
  }

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
  const allGames=[...state.games.values()]; if(!allGames.length) throw new Error("Primero actualiza la liga.");
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

function closeFinishSeason(){if($("#finishSeasonDialog").open)$("#finishSeasonDialog").close();}

function openFinishSeason(){
  if(state.config.finalizedAt)throw new Error("Este torneo ya fue finalizado.");
  if(!state.games.size)throw new Error("No se puede finalizar un torneo sin partidos.");
  if(state.stats.failedGameIds.size||state.stats.loadedGameIds.size!==state.games.size)throw new Error("Todos los Game Logs deben estar cargados correctamente antes de finalizar.");
  const participants=[...state.participants.values()].sort((a,b)=>a.username.localeCompare(b.username));
  const standings=calculateStandings([...state.games.values()],[...state.participants.values()]);
  const options=participants.map(participant=>`<option value="${esc(participant.username)}">${esc(participant.username)} · ${esc(participant.team)}</option>`).join("");
  $("#seasonChampion").innerHTML=options;
  $("#seasonRunnerUp").innerHTML=`<option value="">No indicar</option>${options}`;
  if(standings[0])$("#seasonChampion").value=standings[0].user;
  $("#seasonResult").value="";$("#seasonNote").value="";
  const awards=tournamentAwards(state.stats);
  $("#finishAwardsPreview").innerHTML=awards.map(award=>`<article class="finish-award"><span>${esc(award.label)} · ${esc(award.title)}</span><strong>${esc(awardWinnerNames(award))} · ${esc(award.winners[0].value)}</strong></article>`).join("");
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
    finalizedAt,awards:tournamentAwards(state.stats)
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

function renderLeaders(){
  const battingBy=category=>battingLeaders(state.stats,category);
  const average=battingBy("avg").filter(player=>player.ab>0);
  const pitching=pitchingLeaders(state.stats,"so");
  $("#leaderGrid").innerHTML=[
    leaderCard("Promedio","AVG",average,player=>fmt3(player.avg)),
    leaderCard("Jonrones","HR",battingBy("hr"),player=>player.hr),
    leaderCard("Hits","H",battingBy("h"),player=>player.h),
    leaderCard("Impulsadas","RBI",battingBy("rbi"),player=>player.rbi),
    leaderCard("Bases robadas","SB",battingBy("sb"),player=>player.sb),
    leaderCard("Ponches","SO · Pitcheo",pitching,player=>player.so),
    leaderCard("Efectividad","ERA",pitchingLeaders(state.stats,"era").filter(player=>player.outs>0),player=>player.era.toFixed(2)),
    leaderCard("Salvados","SV",pitchingLeaders(state.stats,"sv"),player=>player.sv)
  ].join("");
}

function renderChampions(){
  const champions=Array.isArray(state.config.champions)?state.config.champions:[];
  if(!champions.length){
    $("#championSpotlight").innerHTML=`<div class="empty champion-empty">Aún no se ha publicado el historial de campeones.</div>`;
    $("#championsHistory").innerHTML="";
    return;
  }
  const latest=champions[0];
  $("#championSpotlight").innerHTML=`<article class="champion-spotlight"><div class="trophy" aria-hidden="true">★</div><div><span>Último campeón · ${esc(latest.season)}</span><h3>${esc(latest.champion)}</h3><p>${latest.team?`${esc(latest.team)}`:""}${latest.runnerUp?` · Final vs. ${esc(latest.runnerUp)}`:""}${latest.result?` · ${esc(latest.result)}`:""}</p>${latest.note?`<small>${esc(latest.note)}</small>`:""}</div></article>`;
  $("#championsHistory").innerHTML=`<h3>Historial</h3><div class="champion-grid">${champions.map((entry,index)=>{
    const awards=cleanArchivedAwards(entry.awards);
    const awardHtml=awards.length?`<div class="archive-awards">${awards.map(award=>`<article class="archive-award"><span>${esc(award.label)} · ${esc(award.title)}</span><small>${esc(awardWinnerNames(award))} · <strong>${esc(award.winners[0].value)}</strong></small></article>`).join("")}</div>`:"";
    return `<article class="season-archive"><div class="champion-entry"><span class="champion-number">${String(index+1).padStart(2,"0")}</span><div><small>${esc(entry.season)}</small><strong>${esc(entry.champion)}</strong><span>${entry.team?esc(entry.team):"Equipo no indicado"}${entry.runnerUp?` · vs. ${esc(entry.runnerUp)}`:""}${entry.result?` · ${esc(entry.result)}`:""}</span></div></div>${awardHtml}</article>`;
  }).join("")}</div>`;
}

function render(){
  const games=[...state.games.values()].sort((a,b)=>(b.dateValue?.getTime?.()||0)-(a.dateValue?.getTime?.()||0));
  const standings=calculateStandings(games,[...state.participants.values()]);
  const leagueName=cleanDisplayName(state.config.leagueName);
  const finalized=Boolean(state.config.finalizedAt);
  $("#currentLeagueName").textContent=leagueName?`${leagueName} · ${finalized?"Torneo finalizado":"Solo Custom League"}`:"Solo Custom League · Game History + Game Log";
  document.title=leagueName?`${leagueName} — MLB The Show 26`:`MLB The Show 26 — Custom League Manager`;
  $("#syncBtn").disabled=finalized;$("#statsBtn").disabled=finalized;$("#finishSeasonBtn").disabled=finalized;
  $("#finishSeasonBtn").textContent=finalized?"Torneo finalizado":"Finalizar torneo";
  $("#participantCount").textContent=state.participants.size;
  $("#gameCount").textContent=games.length;
  $("#logCount").textContent=state.stats.loadedGameIds.size;
  $("#lastSync").textContent=state.lastSync?new Date(state.lastSync).toLocaleString():"—";
  renderWarnings();

  $("#standingsBody").innerHTML=standings.length?standings.map((r,i)=>`<tr><td class="rank">${i+1}</td><td class="standings-player"><strong>${esc(r.user)}</strong><small class="mobile-only">${esc(r.team)}</small></td><td class="desktop-only"><span class="team-pill">${esc(r.team)}</span></td><td class="desktop-only">${r.gp}</td><td class="desktop-only">${r.w}</td><td class="desktop-only">${r.l}</td><td class="mobile-only record">${r.w}-${r.l}</td><td>${fmt3(r.pct)}</td><td class="desktop-only">${r.rf}</td><td class="desktop-only">${r.ra}</td><td class="${r.diff>=0?"positive":"negative"}">${r.diff>0?"+":""}${r.diff}</td><td class="desktop-only">${r.form.join(" ")||"—"}</td></tr>`).join(""):`<tr><td colspan="12" class="empty">Sin datos.</td></tr>`;

  renderLeaders();
  renderChampions();

  $("#gamesList").innerHTML=games.length?games.map(g=>{
    const decidedEarly=String(g.ruling||"0")!=="0";
    const winner=g.homeResult==="W"?g.homeUser:g.awayResult==="W"?g.awayUser:"";
    const decision=decidedEarly&&winner?` · Decisión oficial: ${esc(winner)} gana (ruling ${esc(g.ruling)})`:"";
    return `<article class="game-card"><div><div><span class="manager">${esc(g.awayUser)}</span> · <strong>${esc(g.awayTeam)}</strong> <span class="muted">@</span> <span class="manager">${esc(g.homeUser)}</span> · <strong>${esc(g.homeTeam)}</strong></div><div class="meta">${esc(g.date||"Fecha no disponible")} · ${g.uuid?`UUID ${esc(g.uuid)}`:`ID ${esc(g.id)} (sin UUID)`}${g.pitcherInfo?` · ${esc(g.pitcherInfo)}`:""}${decision}</div></div><div class="score">${g.awayScore??"—"} — ${g.homeScore??"—"}${decidedEarly?"*":""}</div></article>`;
  }).join(""):`<div class="empty">Sin datos.</div>`;

  const bat=battingLeaders(state.stats,$("#battingSort")?.value||"avg");
  $("#battingBody").innerHTML=bat.length?bat.map((p,i)=>`<tr><td class="rank">${i+1}</td><td><strong>${esc(p.name)}</strong></td><td>${esc(p.manager)}</td><td>${p.g}</td><td>${p.ab}</td><td>${p.r}</td><td>${p.h}</td><td>${p.doubles}</td><td>${p.triples}</td><td>${p.hr}</td><td>${p.rbi}</td><td>${p.bb}</td><td>${p.so}</td><td>${p.sb}</td><td>${fmt3(p.avg)}</td><td>${fmt3(p.obp)}</td><td>${fmt3(p.slg)}</td><td><strong>${fmt3(p.ops)}</strong></td></tr>`).join(""):`<tr><td colspan="18" class="empty">Carga los Game Logs para ver estadísticas.</td></tr>`;

  const pit=pitchingLeaders(state.stats,$("#pitchingSort")?.value||"so");
  $("#pitchingBody").innerHTML=pit.length?pit.map((p,i)=>`<tr><td class="rank">${i+1}</td><td><strong>${esc(p.name)}</strong></td><td>${esc(p.manager)}</td><td>${p.g}</td><td>${p.ip}</td><td>${p.w}</td><td>${p.l}</td><td>${p.sv}</td><td>${p.h}</td><td>${p.er}</td><td>${p.bb}</td><td>${p.so}</td><td>${p.era.toFixed(2)}</td><td>${p.whip.toFixed(2)}</td><td>${p.k9.toFixed(2)}</td></tr>`).join(""):`<tr><td colspan="15" class="empty">Carga los Game Logs para ver estadísticas.</td></tr>`;

  const participants=[...state.participants.values()].sort((a,b)=>a.username.localeCompare(b.username));
  $("#participantsBody").innerHTML=participants.length?participants.map(p=>`<tr><td><strong>${esc(p.username)}</strong></td><td><span class="platform-pill">psn</span></td><td><span class="team-pill">${esc(p.team)}</span></td><td><span class="status-pill ${p.playerId?"ok":"warn"}">${p.playerId?`verificado · ID ${esc(p.playerId)}`:"configurado · sin juegos"}</span></td><td>${esc(p.discoveredBy||"Roster configurado")}</td></tr>`).join(""):`<tr><td colspan="5" class="empty">Sin datos.</td></tr>`;
}

async function importHistoryFile(file){
  const text=await file.text();
  const raw=text.replace(/^```(?:json)?\s*/i,"").replace(/\s*```\s*$/i,"");
  const payload=JSON.parse(raw); const rows=historyRows(payload).filter(isLeagueRow);
  if(!rows.length) throw new Error("El archivo no contiene game_history con partidos LEAGUE.");
  if(!state.config.username) throw new Error("Configura primero tu usuario para resolver el lado CPU.");
  const roster=configuredRoster();
  const participant=roster.get(participantKey(state.config.username));
  let imported=0;
  for(const row of rows){
    const candidate=canonicalCandidate(row,participant,roster);
    if(!candidate)continue;
    const fingerprint=gameFingerprint(candidate.game);
    const dedupKey=`fingerprint:${fingerprint}`;
    if(state.games.has(dedupKey))continue;
    state.games.set(dedupKey,{...candidate.game,dedupKey,uuid:null,apiRecords:[candidate.record],sourceUser:participant.username,sourcePlatform:"psn"});
    imported++;
  }
  saveState(); render(); setStatus(`Importados ${imported} partidos que coinciden con roster y fecha.`,"success");
}

$("#settingsForm").addEventListener("submit",e=>{e.preventDefault();try{state.config=formToConfig();if(!state.games.size)loadConfiguredParticipants();saveConfig();saveState();render();setStatus("Configuración guardada.","success")}catch(err){setStatus(err.message,"error")}});
$("#syncBtn").addEventListener("click",async()=>{try{state.config=formToConfig();saveConfig();$("#syncBtn").disabled=true;$("#statsBtn").disabled=true;await discoverLeague();await loadStats();await refreshSharedLeague()}catch(e){setStatus(e.message,"error")}finally{render()}});
$("#statsBtn").addEventListener("click",async()=>{try{$("#statsBtn").disabled=true;await loadStats()}catch(e){setStatus(e.message,"error")}finally{render()}});
$("#publishBtn").addEventListener("click",async()=>{try{$("#publishBtn").disabled=true;await publishLeague()}catch(e){setStatus(e.message,"error")}finally{$("#publishBtn").disabled=false}});
$("#finishSeasonBtn").addEventListener("click",()=>{try{openFinishSeason()}catch(error){setStatus(error.message,"error")}});
$("#finishSeasonForm").addEventListener("submit",async event=>{event.preventDefault();const button=event.submitter;try{button.disabled=true;await finishSeason()}catch(error){setStatus(error.message,"error")}finally{button.disabled=false}});
$("#cancelFinishBtn").addEventListener("click",closeFinishSeason);$("#cancelFinishFooterBtn").addEventListener("click",closeFinishSeason);
$("#newSeasonBtn").addEventListener("click",startNewSeason);
$("#clearBtn").addEventListener("click",()=>{localStorage.removeItem(STATE_KEY);state.participants.clear();state.games.clear();state.stats=createStatAccumulator();state.lastSync=null;state.warnings=[];render();setStatus("Datos locales eliminados.")});
$("#historyFile").addEventListener("change",async e=>{const f=e.target.files?.[0];if(!f)return;try{await importHistoryFile(f)}catch(err){setStatus(err.message,"error")}finally{e.target.value=""}});
$("#battingSort").addEventListener("change",render);
$("#pitchingSort").addEventListener("change",render);
document.querySelectorAll(".tab").forEach(btn=>btn.addEventListener("click",()=>{document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));document.querySelectorAll(".panel").forEach(x=>x.classList.remove("active"));btn.classList.add("active");$("#"+btn.dataset.tab).classList.add("active")}));

loadState();fillForm();render();loadPublishedLeague();
