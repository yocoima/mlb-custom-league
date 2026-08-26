import {
  PLATFORM_VALUES,
  cleanDisplayName,
  sameText,
  isCpuName,
  historyRows,
  isLeagueRow,
  normalizeHistoryGame,
  opponentFromGame,
  participantTeamFromGame,
  calculateStandings,
  gameParts,
  createStatAccumulator,
  addGameStats,
  battingLeaders,
  pitchingLeaders
} from "./src/league-core.js";

const $ = s => document.querySelector(s);
const STORAGE_KEY = "mlb26_custom_league_config_v2";
const STATE_KEY = "mlb26_custom_league_state_v2";
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
  return { username:"", platform:"psn", seedGameId:"", myTeam:"", maxPages:20, maxParticipants:20, proxyBase:"", overrides:{} };
}
function loadConfig(){
  try { return {...defaultConfig(), ...JSON.parse(localStorage.getItem(STORAGE_KEY)||"{}")}; }
  catch { return defaultConfig(); }
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
    for(const p of saved.participants||[]) state.participants.set(p.username.toLowerCase(),p);
    for(const g of saved.games||[]) state.games.set(String(g.id),{...g,dateValue:g.dateValue?new Date(g.dateValue):null});
    state.lastSync=saved.lastSync||null;
  }catch{}
}

function esc(v){ return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function fmt3(v){ return Number(v||0).toFixed(3).replace(/^0/,""); }
function setStatus(text,kind="normal"){ const el=$("#status"); el.textContent=text; el.className=`notice ${kind}`; }
function warn(text){ if(!state.warnings.includes(text)) state.warnings.push(text); renderWarnings(); }
function renderWarnings(){ const el=$("#warnings"); if(!state.warnings.length){el.classList.add("hidden");el.innerHTML="";return;} el.classList.remove("hidden"); el.innerHTML=state.warnings.map(x=>`<div>• ${esc(x)}</div>`).join(""); }

function formToConfig(){
  let overrides={};
  const raw=$("#overrides").value.trim();
  if(raw){ try{overrides=JSON.parse(raw)}catch{throw new Error("El mapeo manual no es JSON válido.")} }
  const platform=$("#platform").value;
  if(!PLATFORM_VALUES.includes(platform)) throw new Error("Plataforma inválida.");
  return {
    username:cleanDisplayName($("#username").value), platform,
    seedGameId:$("#seedGameId").value.trim(), myTeam:cleanDisplayName($("#myTeam").value),
    maxPages:Math.min(100,Math.max(1,Number($("#maxPages").value)||20)),
    maxParticipants:Math.min(40,Math.max(2,Number($("#maxParticipants").value)||20)),
    proxyBase:$("#proxyBase").value.trim().replace(/\/$/,""), overrides
  };
}
function fillForm(){
  $("#username").value=state.config.username; $("#platform").value=state.config.platform;
  $("#seedGameId").value=state.config.seedGameId; $("#myTeam").value=state.config.myTeam;
  $("#maxPages").value=state.config.maxPages; $("#maxParticipants").value=state.config.maxParticipants;
  $("#proxyBase").value=state.config.proxyBase; $("#overrides").value=Object.keys(state.config.overrides||{}).length?JSON.stringify(state.config.overrides,null,2):"";
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

function overrideFor(name){
  const entries=Object.entries(state.config.overrides||{});
  const hit=entries.find(([k])=>sameText(k,name));
  if(!hit)return null;
  const v=hit[1];
  if(typeof v==="string")return {username:name,platform:v};
  return {username:cleanDisplayName(v?.username||name),platform:v?.platform};
}

async function resolveOpponentIdentity(displayName, gameId, preferredPlatform) {
  const manual = overrideFor(displayName);

  if (manual?.username) {
    return {
      username: manual.username,
      platform: "psn",
      method: "manual"
    };
  }

  const username = cleanDisplayName(displayName);

  if (!username || isCpuName(username)) {
    return null;
  }

  // Todos los participantes de esta liga son PSN.
  return {
    username,
    platform: "psn",
    method: "league-default"
  };
}

function participantKey(username){return cleanDisplayName(username).toLowerCase();}
function addParticipant(p){
  const key=participantKey(p.username); if(!key)return null;
  const old=state.participants.get(key);
  if(old){
    if(old.team && p.team && !sameText(old.team,p.team)) return {conflict:true,participant:old};
    state.participants.set(key,{...old,...p,team:old.team||p.team,platform:old.platform||p.platform,status:(old.platform||p.platform)?"ok":"platform-pending"});
  }else state.participants.set(key,{...p,status:p.platform?"ok":"platform-pending"});
  return {conflict:false,participant:state.participants.get(key)};
}

function normalizeForParticipant(row,p){ return normalizeHistoryGame(row,{queryUser:p.username,queryTeam:p.team}); }
function gameBelongsToParticipantLeague(game,p){
  const team=participantTeamFromGame(game,p.username,p.team);
  return team && sameText(team,p.team);
}

async function discoverLeague(){
  state.warnings=[]; state.participants.clear(); state.games.clear(); state.stats=createStatAccumulator();
  const cfg=state.config;
  if(!cfg.username) throw new Error("Ingresa tu usuario de The Show.");

  setStatus("Buscando un partido LEAGUE para usarlo como semilla…");
  const firstPayload=await fetchHistoryPage(cfg.username,cfg.platform,1);
  const leagueRows=historyRows(firstPayload).filter(isLeagueRow);
  if(!leagueRows.length) throw new Error("La primera página no contiene partidos LEAGUE. Puedes indicar un Game ID semilla o aumentar la búsqueda mediante importación.");

  let seedRow=cfg.seedGameId?leagueRows.find(r=>String(r.id)===String(cfg.seedGameId)):leagueRows[0];
  if(cfg.seedGameId && !seedRow){
    setStatus("Buscando el Game ID semilla en el historial…");
    const all=await fetchAllHistory(cfg.username,cfg.platform,cfg.maxPages,(p,t)=>setStatus(`Buscando semilla: página ${p}/${t}…`));
    seedRow=all.find(r=>isLeagueRow(r)&&String(r.id)===String(cfg.seedGameId));
  }
  if(!seedRow) throw new Error("No pude localizar el Game ID semilla dentro del límite de páginas configurado.");

  let seedGame=normalizeHistoryGame(seedRow,{queryUser:cfg.username,queryTeam:cfg.myTeam});
  let seedTeam=participantTeamFromGame(seedGame,cfg.username,cfg.myTeam) || cfg.myTeam;
  if(!seedTeam){
    try{
      const detail=await fetchGameLog(seedGame.id,cfg.username,cfg.platform);
      const {lineScore}=gameParts(detail);
      const normalized=normalizeHistoryGame({
        ...seedRow,
        home_name:lineScore?.home_name,
        away_name:lineScore?.away_name,
        home_full_name:lineScore?.home_full_name||seedRow.home_full_name,
        away_full_name:lineScore?.away_full_name||seedRow.away_full_name
      },{queryUser:cfg.username,queryTeam:cfg.myTeam});
      seedGame=normalized; seedTeam=participantTeamFromGame(normalized,cfg.username,cfg.myTeam);
    }catch{}
  }
  if(!seedTeam) throw new Error("No pude identificar qué equipo es tuyo en el partido semilla. Completa 'Mi equipo en esta liga'.");

  addParticipant({username:cfg.username,platform:cfg.platform,team:seedTeam,discoveredBy:"Semilla",viaGame:seedGame.id});
  const queue=[participantKey(cfg.username)]; const processed=new Set();

  while(queue.length && state.participants.size<=cfg.maxParticipants){
    const key=queue.shift(); if(processed.has(key))continue;
    const p=state.participants.get(key); if(!p?.platform){processed.add(key);continue;}
    setStatus(`Leyendo historial de ${p.username} (${p.team})…`);
    let rows;
    try {
  rows = await fetchAllHistory(
    p.username,
    p.platform,
    cfg.maxPages,
    (page, total, downloaded, leagueFound) => {
      setStatus(
        `${p.username}: página ${page}/${total} · ${downloaded} juegos revisados · ${leagueFound} LEAGUE encontrados`
      );
    }
  );
}
    catch(e){ warn(`No pude leer el historial de ${p.username} (${p.platform}): ${e.message}`); processed.add(key); continue; }

    for(const row of rows.filter(isLeagueRow)){
      const game=normalizeForParticipant(row,p);
      if(!gameBelongsToParticipantLeague(game,p)) continue;
      const opp=opponentFromGame(game,p.username,p.team);
      if(!opp?.user || isCpuName(opp.user)) continue;

      const knownOpp=state.participants.get(participantKey(opp.user));
      if(knownOpp?.team && !sameText(knownOpp.team,opp.team)) continue;

      if(!state.games.has(game.id)) state.games.set(game.id,{...game,sourceUser:p.username,sourcePlatform:p.platform});

      if(!knownOpp && state.participants.size<cfg.maxParticipants){
        setStatus(`Resolviendo plataforma de ${opp.user}…`);
        const identity=await resolveOpponentIdentity(opp.user,game.id,p.platform);
        const result=addParticipant({username:identity?.username||opp.user,platform:identity?.platform||null,team:opp.team,discoveredBy:p.username,viaGame:game.id});
        if(result?.conflict){ warn(`Conflicto de equipo para ${opp.user}; se omitieron partidos que parecen pertenecer a otra liga.`); }
        if(identity?.platform) queue.push(participantKey(identity.username));
        else warn(`No pude resolver automáticamente la plataforma de ${opp.user}. Añádelo en el mapeo manual para completar el descubrimiento.`);
      }
    }
    processed.add(key); render();
  }

  if(queue.length) warn(`Se alcanzó el límite de ${cfg.maxParticipants} participantes. Puedes aumentarlo en Configuración.`);
  if(!state.games.size) throw new Error("No se identificaron partidos pertenecientes a la liga semilla.");
  state.lastSync=new Date().toISOString(); saveState(); render();
  setStatus(`Liga detectada: ${state.participants.size} participantes y ${state.games.size} partidos LEAGUE.`,"success");
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
    const candidates=[[game.sourceUser,game.sourcePlatform],[game.homeUser,state.participants.get(participantKey(game.homeUser))?.platform],[game.awayUser,state.participants.get(participantKey(game.awayUser))?.platform]];
    let payload=null;
    for(const [user,platform] of candidates){
      if(!user||!platform)continue;
      try{payload=await fetchGameLog(game.id,user,platform);break}catch{}
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

  $("#gamesList").innerHTML=games.length?games.map(g=>`<article class="game-card"><div><div><span class="manager">${esc(g.awayUser)}</span> · <strong>${esc(g.awayTeam)}</strong> <span class="muted">@</span> <span class="manager">${esc(g.homeUser)}</span> · <strong>${esc(g.homeTeam)}</strong></div><div class="meta">${esc(g.date||"Fecha no disponible")} · ID ${esc(g.id)}${g.pitcherInfo?` · ${esc(g.pitcherInfo)}`:""}</div></div><div class="score">${g.awayScore??"—"} — ${g.homeScore??"—"}</div></article>`).join(""):`<div class="empty">Sin datos.</div>`;

  const bat=battingLeaders(state.stats);
  $("#battingBody").innerHTML=bat.length?bat.map(p=>`<tr><td><strong>${esc(p.name)}</strong></td><td>${esc(p.manager)}</td><td>${p.g}</td><td>${p.ab}</td><td>${p.r}</td><td>${p.h}</td><td>${p.doubles}</td><td>${p.triples}</td><td>${p.hr}</td><td>${p.rbi}</td><td>${p.bb}</td><td>${p.so}</td><td>${fmt3(p.avg)}</td><td>${fmt3(p.obp)}</td><td>${fmt3(p.slg)}</td><td><strong>${fmt3(p.ops)}</strong></td></tr>`).join(""):`<tr><td colspan="16" class="empty">Carga los Game Logs para ver estadísticas.</td></tr>`;

  const pit=pitchingLeaders(state.stats);
  $("#pitchingBody").innerHTML=pit.length?pit.map(p=>`<tr><td><strong>${esc(p.name)}</strong></td><td>${esc(p.manager)}</td><td>${p.g}</td><td>${p.ip}</td><td>${p.w}</td><td>${p.l}</td><td>${p.sv}</td><td>${p.h}</td><td>${p.er}</td><td>${p.bb}</td><td>${p.so}</td><td>${p.era.toFixed(2)}</td><td>${p.whip.toFixed(2)}</td><td>${p.k9.toFixed(2)}</td></tr>`).join(""):`<tr><td colspan="14" class="empty">Carga los Game Logs para ver estadísticas.</td></tr>`;

  const participants=[...state.participants.values()].sort((a,b)=>a.username.localeCompare(b.username));
  $("#participantsBody").innerHTML=participants.length?participants.map(p=>`<tr><td><strong>${esc(p.username)}</strong></td><td>${p.platform?`<span class="platform-pill">${esc(p.platform)}</span>`:"—"}</td><td><span class="team-pill">${esc(p.team)}</span></td><td><span class="status-pill ${p.platform?"ok":"warn"}">${p.platform?"resuelto":"requiere mapeo"}</span></td><td>${esc(p.discoveredBy||"—")}</td></tr>`).join(""):`<tr><td colspan="5" class="empty">Sin datos.</td></tr>`;
}

async function importHistoryFile(file){
  const text=await file.text();
  const raw=text.replace(/^```(?:json)?\s*/i,"").replace(/\s*```\s*$/i,"");
  const payload=JSON.parse(raw); const rows=historyRows(payload).filter(isLeagueRow);
  if(!rows.length) throw new Error("El archivo no contiene game_history con partidos LEAGUE.");
  if(!state.config.username) throw new Error("Configura primero tu usuario para resolver el lado CPU.");
  const normalized=rows.map(r=>normalizeHistoryGame(r,{queryUser:state.config.username,queryTeam:state.config.myTeam}));
  for(const g of normalized) state.games.set(g.id,{...g,sourceUser:state.config.username,sourcePlatform:state.config.platform});
  render(); setStatus(`Importados ${normalized.length} partidos LEAGUE del archivo.`,"success");
}

$("#settingsForm").addEventListener("submit",e=>{e.preventDefault();try{state.config=formToConfig();saveConfig();setStatus("Configuración guardada.","success")}catch(err){setStatus(err.message,"error")}});
$("#syncBtn").addEventListener("click",async()=>{try{state.config=formToConfig();saveConfig();$("#syncBtn").disabled=true;await discoverLeague()}catch(e){setStatus(e.message,"error")}finally{$("#syncBtn").disabled=false}});
$("#statsBtn").addEventListener("click",async()=>{try{$("#statsBtn").disabled=true;await loadStats()}catch(e){setStatus(e.message,"error")}finally{$("#statsBtn").disabled=false}});
$("#clearBtn").addEventListener("click",()=>{localStorage.removeItem(STATE_KEY);state.participants.clear();state.games.clear();state.stats=createStatAccumulator();state.lastSync=null;state.warnings=[];render();setStatus("Datos locales eliminados.")});
$("#historyFile").addEventListener("change",async e=>{const f=e.target.files?.[0];if(!f)return;try{await importHistoryFile(f)}catch(err){setStatus(err.message,"error")}finally{e.target.value=""}});
document.querySelectorAll(".tab").forEach(btn=>btn.addEventListener("click",()=>{document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active"));document.querySelectorAll(".panel").forEach(x=>x.classList.remove("active"));btn.classList.add("active");$("#"+btn.dataset.tab).classList.add("active")}));

loadState();fillForm();render();
