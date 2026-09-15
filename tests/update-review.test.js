import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as core from "../src/league-core.js";
import { sortStatRows } from "../src/update-review.js";

function appContext() {
  const elements = new Map();
  const context = vm.createContext({
    ...core, sortStatRows, URLSearchParams, structuredClone,
    location: { search: "" },
    localStorage: { getItem: () => null, setItem() {} },
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
