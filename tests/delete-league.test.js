import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source=fs.readFileSync(new URL("../app.js",import.meta.url),"utf8");
const deletion=source.slice(source.indexOf("async function deleteActiveLeague(){"),source.indexOf("async function publishLeague("));
function setup({confirm=true,token="secret",status=200,published=true,leagues=[{id:"wrong"},{id:"keep"}]}={}){
  const storage={config:"old",state:"old",legacy:"old",mlb26_active_league:"wrong",'mlb26_scan_v2:["wrong","season"]':"old",'mlb26_scan_v2:["keep","season"]':"keep"};
  Object.defineProperties(storage,{removeItem:{value:key=>delete storage[key]},setItem:{value:(key,value)=>storage[key]=value}});
  const calls=[],redirects=[];
  const context=vm.createContext({
    state:{syncing:false,activeLeagueId:"wrong",config:{leagueName:"Wrong league"},publishedAt:published?"date":null,leagues},
    window:{confirm:()=>confirm,prompt:()=>token},localStorage:storage,STORAGE_KEY:"config",STATE_KEY:"state",LEGACY_STORAGE_KEY:"legacy",URL,
    location:{href:"https://example.com/?league=wrong",replace:url=>redirects.push(url)},
    leagueApiUrl:()=>"https://worker.example/api/leagues/wrong",
    fetch:async(url,options)=>{calls.push({url,...options});return {ok:status===200,status,json:async()=>({})}}
  });
  vm.runInContext(deletion,context);
  return {context,storage,calls,redirects,run:()=>vm.runInContext("deleteActiveLeague()",context)};
}
test("canceling deletion or the secret prompt preserves the selected league",async()=>{
  for(const options of [{confirm:false},{token:null}]){
    const app=setup(options);await app.run();
    assert.equal(app.calls.length,0);assert.equal(app.redirects.length,0);assert.equal(app.storage.config,"old");
  }
});
test("unauthorized deletion preserves local data and selection",async()=>{
  const app=setup({status:401});await assert.rejects(app.run(),/incorrecta/);
  assert.equal(app.storage.config,"old");assert.equal(app.redirects.length,0);
});
test("successful deletion clears cached league and navigates to the remaining tournament",async()=>{
  const app=setup();await app.run();
  assert.equal(app.calls[0].method,"DELETE");assert.equal(app.calls[0].headers.Authorization,"Bearer secret");
  assert.equal(app.storage.config,undefined);assert.equal(app.storage.state,undefined);assert.equal(app.storage.legacy,undefined);
  assert.equal(app.storage['mlb26_scan_v2:["wrong","season"]'],undefined);
  assert.equal(app.storage['mlb26_scan_v2:["keep","season"]'],"keep");
  assert.equal(app.storage.mlb26_active_league,"keep");assert.equal(app.redirects[0],"https://example.com/?league=keep");
});
test("deleting the last unpublished draft clears its URL and does not call the server",async()=>{
  const app=setup({published:false,leagues:[{id:"wrong"}]});await app.run();
  assert.equal(app.calls.length,0);assert.equal(app.storage.mlb26_active_league,undefined);
  assert.equal(app.redirects[0],"https://example.com/");
});
test("deletion cannot run during a league refresh",async()=>{
  const app=setup();app.context.state.syncing=true;await assert.rejects(app.run(),/termine/);
  assert.equal(app.calls.length,0);
});
