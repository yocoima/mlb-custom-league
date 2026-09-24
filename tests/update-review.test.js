import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as core from "../src/league-core.js";
import { sortStatRows } from "../src/update-review.js";

function appContext() {
  const elements = new Map();
  const storage = new Map();
  const context = vm.createContext({
    ...core, sortStatRows, URLSearchParams, structuredClone,
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
