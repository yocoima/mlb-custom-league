import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as format from "../src/tournament-format.js";
import * as qualification from "../src/qualification.js";
import * as calculator from "../src/calculator.js";
import * as core from "../src/league-core.js";
import { sortStatRows } from "../src/update-review.js";

function appContext() {
  const elements = new Map();
  const storage = new Map();
  const context = vm.createContext({
    ...core, ...format, ...qualification, ...calculator, sortStatRows, URLSearchParams, structuredClone,
    location: { search: "" },
    localStorage: { getItem: key => storage.get(key)||null, setItem(key,value) {storage.set(key,value);} },
    document: { querySelector(selector) {
      if (!elements.has(selector)) elements.set(selector, { innerHTML: "", textContent: "", open: false, showModal() { this.open = true; } });
      return elements.get(selector);
    } },
    window: { prompt: () => "test-token" }
  });
  const source = readFileSync(new URL("../app.js", import.meta.url), "utf8")
    .replace(/^import[\s\S]*?from\s+"[^"]+";\s*/gm, "")
    .split('$("#settingsForm").addEventListener')[0];
  vm.runInContext(source, context);
  vm.runInContext(`
    render=()=>{}; saveState=()=>{}; saveConfig=()=>{}; fillForm=()=>{};
    state.config={...defaultConfig(),username:"home",startDate:"2026-08-15",roster:{home:"Tigers",away:"Dodgers"}};
    state.publishedAt="version-one";
    updateReview={before:new Set(),discarded:new Map(),added:[],complete:true};
  `, context);
  return { context, elements, run: code => vm.runInContext(code, context) };
}

test("calculator renders read-only guarantees and recalculates when selecting a team",()=>{
  const {run,elements}=appContext();
  elements.set("#calculator",{classList:{contains:()=>true}});
  elements.set("#calculatorTeam",{value:"A",innerHTML:""});
  run(`
    state.config={...defaultConfig(),username:"A",startDate:"2026-08-01",roster:{A:"Tigers",B:"Tigers",C:"Tigers",D:"Tigers"},tournamentFormat:{gamesPerOpponent:1,qualifierCount:2}};
    loadConfiguredParticipants();
    const fixtures=[["D","A"],["C","B"],["D","B"],["D","C"]];
    fixtures.forEach(([winner,loser],i)=>state.games.set(String(i),{id:String(i),homeUser:winner,awayUser:loser,homeScore:3,awayScore:1}));
  `);
  const before=run("JSON.stringify(publicSnapshot())");
  run("renderCalculator()");
  assert.match(elements.get("#calculatorContent").innerHTML,/2 de sus 2 partidos pendientes/);
  assert.match(elements.get("#calculatorContent").innerHTML,/Análisis parcial de carreras/);
  elements.get("#calculatorTeam").value="D";
  run("renderCalculator()");
  assert.match(elements.get("#calculatorContent").innerHTML,/clasificación está asegurada/);
  assert.equal(run("JSON.stringify(publicSnapshot())"),before);
});

test("calculator tolerates empty startup and official archived qualifications",()=>{
  const {run,elements}=appContext();
  elements.set("#calculator",{classList:{contains:()=>true}});
  elements.set("#calculatorTeam",{value:"",innerHTML:""});
  run("renderCalculator()");
  assert.match(elements.get("#calculatorContent").innerHTML,/Configura el roster/);
  run('loadConfiguredParticipants();state.config.regularSeason={qualifiers:["away"]};state.config.postseasonQualifiers=["away"];renderCalculator()');
  assert.match(elements.get("#calculatorContent").innerHTML,/Ronda regular cerrada/);
  assert.match(elements.get("#calculatorContent").innerHTML,/Eliminado/);
});

test("publication warns when an older Worker drops the tournament format",async()=>{
  const {run,context,elements}=appContext();
  run(`
    state.config.tournamentFormat={gamesPerOpponent:1,qualifierCount:2,postseasonBestOf:3,finalBestOf:3};
    updateLeagueSelector=()=>{};loadChampionHall=async()=>{};renderWarnings=()=>{};
  `);
  context.fetch=async()=>({ok:true,json:async()=>({publishedAt:"new",participants:2,games:0})});
  const result=await run('publishLeague("token")');
  assert.equal(result.formatSaved,false);
  assert.match(elements.get("#status").textContent,/no confirmó el formato/);
  assert.equal(run("state.config.tournamentFormat.qualifierCount"),2);
  context.fetch=async()=>({ok:true,json:async()=>({publishedAt:"newer",participants:2,games:0,tournamentFormat:{gamesPerOpponent:1,qualifierCount:2,postseasonBestOf:3,finalBestOf:3}})});
  await run('publishLeague("token")');
  assert.match(elements.get("#status").textContent,/Liga publicada/);
});

test("stat columns sort numerically both ways without mutating rows", () => {
  const rows = [{name:"A", ab:9, hr:12, outs:29}, {name:"B", ab:100, hr:2, outs:31}];
  assert.deepEqual(sortStatRows(rows,"ab").map(p=>p.name), ["B","A"]);
  assert.deepEqual(sortStatRows(rows,"ab","asc").map(p=>p.name), ["A","B"]);
  assert.deepEqual(sortStatRows(rows,"hr").map(p=>p.name), ["A","B"]);
  assert.deepEqual(sortStatRows(rows,"outs").map(p=>p.name), ["B","A"]);
  assert.deepEqual(rows.map(p=>p.name), ["A","B"]);
});

test("review deduplicates rejected games across histories and hides accepted games", () => {
  const {run,elements}=appContext();
  run(`
    const game={id:"1",homeUser:"home",awayUser:"away",homeTeam:"Tigers",awayTeam:"Dodgers",homeScore:2,awayScore:1,date:"08/24/2026 23:23:25"};
    recordDiscard(game,"Entradas");recordDiscard({...game,id:"2"},"Entradas");showUpdateReview();
  `);
  assert.equal(run("updateReview.discarded.size"),1);
  assert.match(elements.get("#updateDiscarded").innerHTML,/Incluir juego/);
  run('state.games.set("1",game);showUpdateReview();');
  assert.match(elements.get("#updateDiscarded").innerHTML,/descartados \(0\)/);
});

test("manual inclusion publishes once, updates standings and persists its reason", async () => {
  const {run}=appContext();
  run(`
    const game={id:"1",homeUser:"home",awayUser:"away",homeTeam:"Tigers",awayTeam:"Dodgers",homeScore:2,awayScore:1,sourceUser:"home"};
    recordDiscard(game,"Entradas");
    fetchJson=async()=>({publishedAt:"version-one"});
    fetchGameLog=async()=>({game:[["line_score",{game_mode:"LEAGUE",game_uuid:"unique",home_runs:2,away_runs:1}]]});
    publishLeague=async()=>({ok:true});
  `);
  await run("includeDiscardedGame([...updateReview.discarded.keys()][0])");
  assert.equal(run("state.games.size"),1);
  assert.equal(run('state.games.get("uuid:unique").manualInclusion.reason'),"Entradas");
  assert.equal(run('calculateStandings([...state.games.values()]).find(row=>row.user==="home").w'),1);
  run('recordDiscard(game,"Entradas");');
  await assert.rejects(run("includeDiscardedGame([...updateReview.discarded.keys()][0])"),/ya está incluido/);
});

test("clicking a stat header toggles direction and synchronizes its select", () => {
  const {run,context,elements}=appContext();
  context.Option = function(text,value){this.text=text;this.value=value;};
  const headersByType={};
  for(const type of ["batting","pitching"]){
    const fields=Array.from(run(`statColumns.${type}`));
    const headers=[{},...fields.map(field=>({textContent:field,span:{},button:{addEventListener(event,handler){this[event]=handler;}},setAttribute(name,value){this[name]=value;},querySelector(selector){return selector==="span"?this.span:this.button;}}))];
    headersByType[type]=headers;
    const value=type==="batting"?"avg":"so";
    elements.set(`#${type}Sort`,{value,options:[{value}],add(option){this.options.push(option);},addEventListener(event,handler){this[event]=handler;}});
    elements.set(`#${type}Body`,{closest(){return {querySelectorAll:()=>headers};}});
  }
  run("initializeStatSorting()");
  const ab=headersByType.batting[5];
  ab.button.click();
  assert.equal(elements.get("#battingSort").value,"ab");
  assert.equal(ab["aria-sort"],"descending");
  ab.button.click();
  assert.equal(ab["aria-sort"],"ascending");
  const select=elements.get("#pitchingSort");select.value="era";select.change();
  assert.equal(headersByType.pitching[13]["aria-sort"],"ascending");
});

test("manual inclusion rejects non-LEAGUE logs and rolls back a failed publication", async () => {
  const {run}=appContext();
  run(`
    recordDiscard({id:"1",homeUser:"home",awayUser:"away",sourceUser:"home"},"Entradas");
    fetchJson=async()=>({publishedAt:"version-one"});
    fetchGameLog=async()=>({game:[["line_score",{game_mode:"ARENA"}]]});
  `);
  await assert.rejects(run("includeDiscardedGame([...updateReview.discarded.keys()][0])"),/LEAGUE/);
  assert.equal(run("state.games.size"),0);
  run(`fetchGameLog=async()=>({game:[["line_score",{game_mode:"LEAGUE",game_uuid:"unique",home_runs:2,away_runs:1}]]});publishLeague=async()=>{throw new Error("Unauthorized")};`);
  await assert.rejects(run("includeDiscardedGame([...updateReview.discarded.keys()][0])"),/Unauthorized/);
  assert.equal(run("state.games.size"),0);
  assert.equal(run("state.publishedAt"),"version-one");
  assert.equal(run("updateReview.added.length"),0);
});


test("incremental history stops at overlap boundary, but not on invalid dates or page caps", async()=>{
  const {run}=appContext();
  run(`
    let pages=[];
    fetchHistoryPage=async(user,platform,page)=>{pages.push(page);return {total_pages:10,games:[{display_date:page===1?"09/24/2026 10:00:00":"09/20/2026 10:00:00"}]};};
  `);
  const rows=await run('fetchAllHistory("home","psn",10,()=>{},parseShowDate("09/22/2026 10:00:00").getTime())');
  assert.equal(rows.complete,true);
  assert.deepEqual(Array.from(run("pages")),[1,2]);
  run('fetchHistoryPage=async()=>({total_pages:10,games:[{display_date:"invalid"}]});');
  assert.equal((await run('fetchAllHistory("home","psn",2,()=>{},1)')).complete,false);
});

function setupScan(run){
  run(`
    setStatus=()=>{};renderWarnings=()=>{};
    const raw={id:"1",game_mode:"LEAGUE",home_name:"home",away_name:"away",home_full_name:"Tigers",away_full_name:"Dodgers",home_runs:2,away_runs:1,display_date:"08/24/2026 10:00:00"};
    let logCalls=0;
    fetchHistoryPage=async()=>({total_pages:1,games:[raw]});
    beginScan();
    scanSession.startedAt=parseShowDate("09/24/2026 10:00:00").getTime();
  `);
}

test("stable discards are remembered, avoid repeated logs, and full scan revisits them",async()=>{
  const {run}=appContext();setupScan(run);
  run('fetchGameLog=async()=>{logCalls++;return {game:[["line_score",{game_mode:"ARENA"}]]};};');
  await run("discoverLeague()");
  assert.equal(run("logCalls"),1);
  assert.equal(run("updateReview.discarded.size"),1);
  run(`
    localStorage.setItem(scanSession.key,JSON.stringify(scanSession));
    beginScan();
    updateReview.discarded.clear();
    // Revisit the overlap to prove the saved rejection skips the Game Log.
    for(const participant of Object.values(scanSession.participants))participant.completedAt=0;
  `);
  await run("discoverLeague()");
  assert.equal(run("logCalls"),1);
  assert.equal(run("updateReview.discarded.size"),0);
  run("beginScan(true)");
  await run("discoverLeague()");
  assert.equal(run("logCalls"),2);
  assert.equal(run("updateReview.discarded.size"),1);
});

test("failed logs remain pending outside overlap and retry without repeating the discard",async()=>{
  const {run}=appContext();setupScan(run);
  run('fetchGameLog=async()=>{logCalls++;throw Error("offline");};');
  await run("discoverLeague()");
  assert.equal(run("Object.keys(scanSession.participants.home.pending).length"),1);
  run(`
    localStorage.setItem(scanSession.key,JSON.stringify(scanSession));
    beginScan();updateReview.discarded.clear();
    fetchHistoryPage=async()=>({total_pages:1,games:[]});
  `);
  await run("discoverLeague()");
  assert.equal(run("logCalls"),4);
  assert.equal(run("updateReview.discarded.size"),0);
  run('fetchGameLog=async()=>({game:[["line_score",{game_mode:"LEAGUE",game_uuid:"resolved",home_runs:2,away_runs:1,home_display_result:"W",away_display_result:"L",innings:5}]]});');
  await run("discoverLeague()");
  assert.equal(run('state.games.has("uuid:resolved")'),true);
});

test("failed participant histories keep their checkpoint and config changes invalidate it",async()=>{
  const {run}=appContext();setupScan(run);
  run(`
    scanSession.participants.home={completedAt:123,pending:{}};
    fetchHistoryPage=async(username)=>{if(username==="home")throw Error("offline");return {total_pages:1,games:[]};};
  `);
  await run("discoverLeague()");
  assert.equal(run("scanSession.participants.home.completedAt"),123);
  assert.ok(run("scanSession.participants.away.completedAt")>123);
  run(`
    localStorage.setItem(scanSession.key,JSON.stringify(scanSession));
    state.config.regulationInnings=9;beginScan();
  `);
  assert.equal(run("Object.keys(scanSession.participants).length"),0);
});

test("scan checkpoint is committed only after successful publication",async()=>{
  const {run}=appContext();setupScan(run);
  run(`
    formToConfig=()=>state.config;
    fetchHistoryPage=async()=>({total_pages:1,games:[]});
    refreshSharedLeague=async()=>{throw Error("publication failed");};
  `);
  await run("syncLeague()");
  assert.equal(run("localStorage.getItem(scanStorageKey())"),null);
  assert.equal(run("scanSession"),null);
  run("refreshSharedLeague=async()=>{};");
  await run("syncLeague()");
  assert.ok(run("JSON.parse(localStorage.getItem(scanStorageKey())).participants.home.completedAt")>0);
});


test("unfinished games retry with official final scores after leaving the overlap",async()=>{
  const {run}=appContext();setupScan(run);
  run('fetchGameLog=async()=>({game:[["line_score",{game_mode:"LEAGUE",innings:2,home_runs:0,away_runs:0}]]});');
  await run("discoverLeague()");
  assert.equal(run("state.games.size"),0);
  assert.equal(run("Object.keys(scanSession.participants.home.pending).length"),1);
  run(`
    localStorage.setItem(scanSession.key,JSON.stringify(scanSession));beginScan();
    fetchHistoryPage=async()=>({total_pages:1,games:[]});
    fetchGameLog=async()=>({game:[["line_score",{game_mode:"LEAGUE",game_uuid:"finished",innings:5,home_runs:7,away_runs:3,home_display_result:"W",away_display_result:"L"}]]});
  `);
  await run("discoverLeague()");
  assert.equal(run('state.games.get("uuid:finished").homeScore'),7);
  assert.equal(run('state.games.get("uuid:finished").awayScore'),3);
});

test("incremental scan discovers new games and capped histories do not advance",async()=>{
  const {run}=appContext();setupScan(run);
  run(`
    scanSession.participants.home={completedAt:parseShowDate("09/23/2026 10:00:00").getTime(),pending:{}};
    state.config.maxPages=1;
    fetchHistoryPage=async()=>({total_pages:10,games:[{...raw,display_date:"09/24/2026 09:00:00"}]});
    fetchGameLog=async()=>({game:[["line_score",{game_mode:"LEAGUE",game_uuid:"new",innings:5,home_runs:2,away_runs:1,home_display_result:"W",away_display_result:"L"}]]});
  `);
  const checkpoint=run("scanSession.participants.home.completedAt");
  await run("discoverLeague()");
  assert.equal(run('state.games.has("uuid:new")'),true);
  assert.equal(run("state.games.size"),1);
  assert.equal(run("scanSession.participants.home.completedAt"),checkpoint);
});


test("correction dialog lists excluded games and restores one with an audit entry",async()=>{
  const {run,context,elements}=appContext();
  context.crypto={randomUUID:()=>"include-1"};
  run(`
    state.config.phase="postseason";
    state.games.set("uuid:excluded",{id:"1",dedupKey:"uuid:excluded",phase:"postseason",awayUser:"home",homeUser:"away",awayTeam:"Tigers",homeTeam:"Dodgers",awayScore:7,homeScore:0,date:"09/27/2026 03:52:32"});
    state.games.set("uuid:counted",{id:"2",dedupKey:"uuid:counted",phase:"postseason",awayUser:"home",homeUser:"away",awayTeam:"Tigers",homeTeam:"Dodgers",awayScore:2,homeScore:1,date:"09/27/2026 04:38:54"});
    state.config.corrections=[{id:"exclude-1",phase:"postseason",type:"exclude",gameKey:"uuid:excluded",reason:"Conexión"}];
    loadStats=async()=>{};publishLeague=async()=>{};
  `);
  elements.set("#correctionPhase",{value:"postseason"});
  elements.set("#correctionType",{value:"include",querySelector:()=>({disabled:false})});
  elements.set("#correctionTargetLabel",{firstChild:{textContent:""}});
  for(const id of ["#resultCorrectionFields","#statCorrectionFields"])elements.set(id,{classList:{toggle(){}}});
  elements.set("#correctionReason",{value:"Partido oficial válido"});
  run("updateCorrectionTargets()");
  assert.match(elements.get("#correctionTarget").innerHTML,/uuid:excluded/);
  assert.doesNotMatch(elements.get("#correctionTarget").innerHTML,/uuid:counted/);
  elements.get("#correctionTarget").value="uuid:excluded";
  await run("saveCorrection()");
  assert.equal(run('excludedGameKeys("postseason").has("uuid:excluded")'),false);
  assert.equal(run('rawGamesForPhase("postseason").length'),2);
  assert.equal(run('state.config.corrections.at(-1).type'),"include");
});

test("pending view works before scanning and respects excluded games",()=>{
  const {run,elements}=appContext();
  run('state.config.tournamentFormat={gamesPerOpponent:2,qualifierCount:2,postseasonBestOf:3,finalBestOf:5};renderSchedule();');
  assert.match(elements.get("#formatSummary").textContent,/2 juegos pendientes/);
  assert.doesNotMatch(elements.get("#scheduleContent").innerHTML,/Postemporada/);
  run('state.games.set("one",{id:"one",homeUser:"home",awayUser:"away",homeScore:2,awayScore:1,phase:"regular"});renderSchedule();');
  assert.match(elements.get("#formatSummary").textContent,/1 juego pendiente/);
  run('state.config.corrections=[{phase:"regular",type:"exclude",gameKey:"one"}];renderSchedule();');
  assert.match(elements.get("#formatSummary").textContent,/2 juegos pendientes/);
});

test("postseason pending view hides completed and undefined pairings",()=>{
  const {run,elements}=appContext();
  run(`
    state.viewPhase="postseason";state.config.phase="postseason";
    state.config.tournamentFormat={gamesPerOpponent:1,qualifierCount:4,postseasonBestOf:3,finalBestOf:3};
    state.config.postseasonQualifiers=["A","B","C","D"];
    state.games.set("one",{id:"one",phase:"postseason",homeUser:"A",awayUser:"D",homeScore:3,awayScore:1,date:"09/27/2026 01:00:00"});
    state.games.set("two",{id:"two",phase:"postseason",homeUser:"A",awayUser:"D",homeScore:4,awayScore:2,date:"09/27/2026 02:00:00"});
    state.games.set("three",{id:"three",phase:"postseason",homeUser:"B",awayUser:"C",homeScore:2,awayScore:1,date:"09/27/2026 03:00:00"});
    renderSchedule();
  `);
  const html=elements.get("#scheduleContent").innerHTML;
  assert.match(html,/B<br>C/);
  assert.doesNotMatch(html,/A<br>D|Cruce por definir|Ronda regular|<h3>Final<\/h3>/);
  assert.match(elements.get("#formatSummary").textContent,/1 serie definida pendiente/);
});

test("regular standings mark participants outside the archived qualifier list",()=>{
  const {run}=appContext();
  run(`
    state.participants=new Map(["home","away","third","fourth"].map(username=>[username,{username,team:"Tigers"}]));
    state.config.roster={home:"Tigers",away:"Tigers",third:"Tigers",fourth:"Tigers"};
    state.config.tournamentFormat={gamesPerOpponent:1,qualifierCount:2,postseasonBestOf:3,finalBestOf:3};
    state.config.regularSeason={qualifiers:["home","third"]};
    state.config.postseasonQualifiers=["home","third"];
  `);
  assert.equal(run('eliminatedForPhase("regular",[]).has("away")'),true);
  assert.equal(run('eliminatedForPhase("regular",[]).has("fourth")'),true);
  assert.equal(run('eliminatedForPhase("regular",[]).has("home")'),false);
});

test("closing regular season suggests configured number and rejects another selection",async()=>{
  const {run,context,elements}=appContext();
  run('state.config.tournamentFormat={gamesPerOpponent:1,qualifierCount:2,postseasonBestOf:3,finalBestOf:5};state.participants=new Map(["home","away","third","fourth"].map(username=>[username,{username,team:"Tigers"}]));state.games.set("one",{id:"one",homeUser:"home",awayUser:"away",homeScore:2,awayScore:1,phase:"regular"});state.stats.loadedGameIds.add("one");openCloseRegular();');
  assert.equal((elements.get("#qualifierList").innerHTML.match(/checked/g)||[]).length,2);
  context.document.querySelectorAll=()=>[{value:"home"},{value:"away"},{value:"third"}];
  await assert.rejects(run("closeRegularSeason()"),/exactamente 2/);
});
