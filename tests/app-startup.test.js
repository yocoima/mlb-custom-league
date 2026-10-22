import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {cleanDisplayName} from "../src/league-core.js";
import {regularEliminatedPlayers} from "../src/qualification.js";

const source=fs.readFileSync(new URL("../app.js",import.meta.url),"utf8");
const configured=source.slice(source.indexOf("function configuredRoster("),source.indexOf("function loadConfiguredParticipants("));
const elimination=source.slice(source.indexOf("function eliminatedForPhase("),source.indexOf("function render(){"));
function evaluate(config){
  const context=vm.createContext({state:{config},cleanDisplayName,participantKey:name=>cleanDisplayName(name).toLowerCase(),regularEliminatedPlayers});
  vm.runInContext(configured+elimination,context);
  return vm.runInContext('eliminatedForPhase("regular",[])',context);
}

test("fresh startup can render before loading any league from the server",()=>{
  assert.equal(evaluate({roster:{},username:"",startDate:"",regulationInnings:5}).size,0);
});
test("new season and incomplete local configurations can render before validation",()=>{
  assert.equal(evaluate({roster:{A:"Tigers",B:"Braves"},username:"A",startDate:"",regulationInnings:5,tournamentFormat:{gamesPerOpponent:1,qualifierCount:2}}).size,0);
});
test("complete league still marks official eliminations without a configured format",()=>{
  const eliminated=evaluate({roster:{A:"Tigers",B:"Braves"},username:"A",startDate:"2026-08-01",regulationInnings:5,regularSeason:{qualifiers:["A"]}});
  assert.deepEqual([...eliminated],["b"]);
});
