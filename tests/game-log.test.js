import test from "node:test";
import assert from "node:assert/strict";
import {fetchReadyGameLog} from "../src/game-log.js";

const ready={game:[["line_score",{game_mode:"LEAGUE",game_uuid:"one"}]]};
test("HTTP 200 API errors and empty logs trigger fallback rather than count as success",async()=>{
  for(const payload of [{error:"Username and platform do not match the game record."},{game:[]},{}]){
    await assert.rejects(fetchReadyGameLog("https://example/log",{fetchImpl:async()=>new Response(JSON.stringify(payload))}));
  }
});
test("pending logs retry after the requested delay and bypass stale caches",async()=>{
  let calls=0;const waits=[];
  const payload=await fetchReadyGameLog("https://example/log",{
    fetchImpl:async(url,options)=>{assert.equal(options.cache,"no-store");return ++calls<3?new Response(JSON.stringify({status:"pending",retry_after:3}),{status:202}):new Response(JSON.stringify(ready));},
    sleep:async ms=>waits.push(ms)
  });
  assert.deepEqual(payload,ready);assert.equal(calls,3);assert.deepEqual(waits,[3000,3000]);
});
test("pending retries are bounded so another participant's record can be tried",async()=>{
  let calls=0;
  await assert.rejects(fetchReadyGameLog("https://example/log",{fetchImpl:async()=>{calls++;return new Response(JSON.stringify({status:"pending",retry_after:999}),{status:202});},sleep:async ms=>assert.equal(ms,5000)}),/preparando/);
  assert.equal(calls,3);
});
