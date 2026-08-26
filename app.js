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
  createStatAccumulator,
  addGameStats,
  battingLeaders,
  pitchingLeaders
} from "./src/league-core.js";

const $ = s => document.querySelector(s);
const STORAGE_KEY = "mlb26_custom_league_config_v3";
const STATE_KEY = "mlb26_custom_league_state_v3";
const LEGACY_STORAGE_KEY = "mlb26_custom_league_config_v2";
const API_ORIGIN = "https://mlb26.theshow.com";

const state = {
  config: loadConfig(),
  participants: new Map(),
  games: new Map(),
  stats: createStatAccumulator(),
  lastSync: null,
  warnings: []
};

function defaultConfig(){
  return { username:"", platform:"psn", seedGameId:"", myTeam:"", startDate:"", maxPages:20, proxyBase:"", roster:{} };
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
    participants:[...state.participants.values()], games:[...state.games.values()].map(g=>({...g,dateValue:g.dateValue?.toISOString?.()||null})), lastSync:state.lastSync
  };
  localStorage.setItem(STATE_KEY, JSON.stringify(safe));
}
function loadState(){
  try{
    const saved=JSON.parse(localStorage.getItem(STATE_KEY)||"{}");
    for(const p of saved.participants||[]) state.participants.set(participantKey(p.username),p);
    for(const g of saved.games||[]) state.games.set(String(g.dedupKey||g.uuid||g.id),{...g,dateValue:g.dateValue?new Date(g.dateValue):null});
    state.lastSync=saved.lastSync||null;
  }catch{}
}

function esc(v){ return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function fmt3(v){ return Number(v||0).toFixed(3).replace(/^0/,""); }
function setStatus(text,kind="normal"){ const el=$("#status"); el.textContent=text; el.className=`notice ${kind}`; }
function warn(text){ if(!state.warnings.includes(text)) state.warnings.push(text); renderWarnings(); }
function renderWarnings(){ const el=$("#warnings"); if(!state.warnings.length){el.classList.add("hidden");el.innerHTML="";return;} el.classList.remove("hidden"); el.innerHTML=state.warnings.map(x=>`<div>• ${esc(x)}</div>`).join(""); }

function formToConfig(){
  let roster={};
  const raw=$("#roster").value.trim();
  if(raw){ try{roster=JSON.parse(raw)}catch{throw new Error("El roster de la liga no es JSON válido.")} }
  if(!roster || Array.isArray(roster) || typeof roster!=="object") throw new Error("El roster debe ser un objeto JSON usuario → equipo.");
  const platform=$("#platform").value;
  if(!PLATFORM_VALUES.includes(platform)) throw new Error("Plataforma inválida.");
  const config={
    username:cleanDisplayName($("#username").value), platform,
    seedGameId:$("#seedGameId").value.trim(), myTeam:cleanDisplayName($("#myTeam").value),
    startDate:$("#startDate").value,
    maxPages:Math.min(100,Math.max(1,Number($("#maxPages").value)||20)),
    proxyBase:$("#proxyBase").value.trim().replace(/\/$/,""), roster
  };
  configuredRoster(config);
  return config;
}
function fillForm(){
  $("#username").value=state.config.username; $("#platform").value=state.config.platform;
  $("#seedGameId").value=state.config.seedGameId; $("#myTeam").value=state.config.myTeam;
  $("#startDate").value=state.config.startDate||""; $("#maxPages").value=state.config.maxPages;
  $("#proxyBase").value=state.config.proxyBase; $("#roster").value=Object.keys(state.config.roster||{}).length?JSON.stringify(state.config.roster,null,2):"";
}

function apiUrl(kind, params){
  const q=new URLSearchParams(params);
  if(state.config.proxyBase){ return `${state.config.proxyBase}/api/${kind}?${q}`; }
  if(kind==="history") return `${API_ORIGIN}/apis/game_history.json?${q}`;
  if(kind==="game-log") return `${API_ORIGIN}/apis/game_log.json?${q}`;
  throw new Error("Endpoint desconocido");
}
async function fetchJson(url){
  const r=await fetch(url,{headers:{Accept:"application/json"}});
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  const text=await r.text();
  try{return JSON.parse(text)}catch{throw new Error("La API no devolvió JSON válido.")}
}
async function fetchHistoryPage(username,platform,page){
  // LEAGUE no es un mode documentado por SDS. Consultamos all y filtramos localmente.
  return fetchJson(apiUrl("history",{username,platform,page:String(page),mode:"all"}));
}
async function fetchGameLog(id,username,platform){ return fetchJson(apiUrl("game-log",{id:String(id),username,platform})); }

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
  if(roster.size<2) throw new Error("Configura al menos dos participantes con sus equipos.");
  if(!roster.has(primaryKey)) throw new Error("Incluye al usuario principal en el roster o completa 'Mi equipo'.");
  return roster;
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

async function discoverLeague(){
  state.warnings=[]; state.participants.clear(); state.games.clear(); state.stats=createStatAccumulator();
  const cfg=state.config;
  if(!cfg.username) throw new Error("Ingresa tu usuario de The Show.");
  const roster=configuredRoster(cfg);
  for(const participant of roster.values())addParticipant(participant);
  const candidateGroups=new Map();
  let seedFound=!cfg.seedGameId;

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
      const candidate=canonicalCandidate(row,participant,roster);
      if(!candidate)continue;
      if(String(candidate.game.id)===String(cfg.seedGameId))seedFound=true;
      const fingerprint=gameFingerprint(candidate.game);
      if(!candidateGroups.has(fingerprint))candidateGroups.set(fingerprint,[]);
      candidateGroups.get(fingerprint).push(candidate);
    }
    render();
  }

  if(!seedFound)throw new Error("El Game ID semilla no pertenece al roster, fecha o equipos configurados.");
  if(!candidateGroups.size)throw new Error("No se encontraron partidos que coincidan con el roster y la fecha inicial.");

  let checked=0;
  let failedLogs=0;
  for(const [fingerprint,candidates] of candidateGroups){
    checked++;
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
    if(lineScore&&String(lineScore.game_mode||"").toUpperCase()!=="LEAGUE")continue;
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
      awayPlayerId:lineScore?.away_player_id?String(lineScore.away_player_id):null
    };
    if(lineScore&&!bindParticipantIds(game,lineScore))continue;
    if(!lineScore)failedLogs++;
    const existing=state.games.get(dedupKey);
    if(existing)existing.apiRecords=mergeApiRecords(existing.apiRecords,records);
    else state.games.set(dedupKey,game);
  }

  if(failedLogs)warn(`${failedLogs} partidos no expusieron game_uuid; se deduplicaron con fecha, participantes, equipos y resultado.`);
  if(!state.games.size) throw new Error("No se pudieron validar partidos pertenecientes a la liga configurada.");
  state.lastSync=new Date().toISOString(); saveState(); render();
  setStatus(`Liga configurada: ${state.participants.size} participantes y ${state.games.size} partidos LEAGUE únicos.`,"success");
}

async function mapLimit(items,limit,fn){
  const results=new Array(items.length); let next=0;
  async function worker(){ while(true){const i=next++; if(i>=items.length)return; results[i]=await fn(items[i],i);} }
  await Promise.all(Array.from({length:Math.min(limit,items.length)},worker)); return results;
}

async function loadStats(){
  const games=[...state.games.values()]; if(!games.length) throw new Error("Primero actualiza la liga.");
  state.stats=createStatAccumulator(); let done=0;
  await mapLimit(games,4,async game=>{
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
  render(); setStatus(`Estadísticas cargadas para ${state.stats.loadedGameIds.size}/${games.length} partidos.`,"success");
}

function render(){
  const games=[...state.games.values()].sort((a,b)=>(b.dateValue?.getTime?.()||0)-(a.dateValue?.getTime?.()||0));
  const standings=calculateStandings(games);
  $("#participantCount").textContent=state.participants.size;
  $("#gameCount").textContent=games.length;
  $("#logCount").textContent=state.stats.loadedGameIds.size;
  $("#lastSync").textContent=state.lastSync?new Date(state.lastSync).toLocaleString():"—";
  renderWarnings();

  $("#standingsBody").innerHTML=standings.length?standings.map((r,i)=>`<tr><td class="rank">${i+1}</td><td><strong>${esc(r.user)}</strong></td><td><span class="team-pill">${esc(r.team)}</span></td><td>${r.gp}</td><td>${r.w}</td><td>${r.l}</td><td>${fmt3(r.pct)}</td><td>${r.rf}</td><td>${r.ra}</td><td class="${r.diff>=0?"positive":"negative"}">${r.diff>0?"+":""}${r.diff}</td><td>${r.form.join(" ")||"—"}</td></tr>`).join(""):`<tr><td colspan="11" class="empty">Sin datos.</td></tr>`;

  $("#gamesList").innerHTML=games.length?games.map(g=>`<article class="game-card"><div><div><span class="manager">${esc(g.awayUser)}</span> · <strong>${esc(g.awayTeam)}</strong> <span class="muted">@</span> <span class="manager">${esc(g.homeUser)}</span> · <strong>${esc(g.homeTeam)}</strong></div><div class="meta">${esc(g.date||"Fecha no disponible")} · ${g.uuid?`UUID ${esc(g.uuid)}`:`ID ${esc(g.id)} (sin UUID)`}${g.pitcherInfo?` · ${esc(g.pitcherInfo)}`:""}</div></div><div class="score">${g.awayScore??"—"} — ${g.homeScore??"—"}</div></article>`).join(""):`<div class="empty">Sin datos.</div>`;

  const bat=battingLeaders(state.stats);
  $("#battingBody").innerHTML=bat.length?bat.map(p=>`<tr><td><strong>${esc(p.name)}</strong></td><td>${esc(p.manager)}</td><td>${p.g}</td><td>${p.ab}</td><td>${p.r}</td><td>${p.h}</td><td>${p.doubles}</td><td>${p.triples}</td><td>${p.hr}</td><td>${p.rbi}</td><td>${p.bb}</td><td>${p.so}</td><td>${fmt3(p.avg)}</td><td>${fmt3(p.obp)}</td><td>${fmt3(p.slg)}</td><td><strong>${fmt3(p.ops)}</strong></td></tr>`).join(""):`<tr><td colspan="16" class="empty">Carga los Game Logs para ver estadísticas.</td></tr>`;

  const pit=pitchingLeaders(state.stats);
  $("#pitchingBody").innerHTML=pit.length?pit.map(p=>`<tr><td><strong>${esc(p.name)}</strong></td><td>${esc(p.manager)}</td><td>${p.g}</td><td>${p.ip}</td><td>${p.w}</td><td>${p.l}</td><td>${p.sv}</td><td>${p.h}</td><td>${p.er}</td><td>${p.bb}</td><td>${p.so}</td><td>${p.era.toFixed(2)}</td><td>${p.whip.toFixed(2)}</td><td>${p.k9.toFixed(2)}</td></tr>`).join(""):`<tr><td colspan="14" class="empty">Carga los Game Logs para ver estadísticas.</td></tr>`;

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

$("#settingsForm").addEventListener("submit",e=>{e.preventDefault();try{state.config=formToConfig();saveConfig();setStatus("Configuración guardada.","success")}catch(err){setStatus(err.message,"error")}});
$("#syncBtn").addEventListener("click",async()=>{try{state.config=formToConfig();saveConfig();$("#syncBtn").disabled=true;await discoverLeague()}catch(e){setStatus(e.message,"error")}finally{$("#syncBtn").disabled=false}});
$("#statsBtn").addEventListener("click",async()=>{try{$("#statsBtn").disabled=true;await loadStats()}catch(e){setStatus(e.message,"error")}finally{$("#statsBtn").disabled=false}});
$("#clearBtn").addEventListener("click",()=>{localStorage.removeItem(STATE_KEY);state.participants.clear();state.games.clear();state.stats=createStatAccumulator();state.lastSync=null;state.warnings=[];render();setStatus("Datos locales eliminados.")});
$("#historyFile").addEventListener("change",async e=>{const f=e.target.files?.[0];if(!f)return;try{await importHistoryFile(f)}catch(err){setStatus(err.message,"error")}finally{e.target.value=""}});
document.querySelectorAll(".tab").forEach(btn=>btn.addEventListener("click",()=>{document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));document.querySelectorAll(".panel").forEach(x=>x.classList.remove("active"));btn.classList.add("active");$("#"+btn.dataset.tab).classList.add("active")}));

loadState();fillForm();render();
