import test from "node:test";
import assert from "node:assert/strict";
import { regularEliminatedPlayers, qualificationScenarios } from "../src/qualification.js";

const people=["A","B","C","D"].map(username=>({username,team:"Tigers"}));
const format={gamesPerOpponent:1,qualifierCount:2};
const game=(id,winner,loser)=>({id:String(id),homeUser:winner,awayUser:loser,homeScore:2,awayScore:1,homeResult:"W",awayResult:"L"});

test("a team stays alive while a favorable set of remaining results exists",()=>{
  assert.deepEqual([...regularEliminatedPlayers(people,[],format)],[]);
  assert.equal(regularEliminatedPlayers(people,[game(1,"A","C")],format).has("C"),false);
});

test("shared remaining game eliminates a team even when independent bounds do not",()=>{
  const games=[game(1,"A","C"),game(2,"B","C"),game(3,"C","D"),game(4,"D","A"),game(5,"D","B")];
  const eliminated=regularEliminatedPlayers(people,games,format);
  assert.equal(eliminated.has("C"),true);
  assert.equal(eliminated.has("A"),false);
  assert.equal(eliminated.has("B"),false);
});

test("completed round uses final standings and archived round uses official qualifiers",()=>{
  const games=[game(1,"A","C"),game(2,"B","C"),game(3,"C","D"),game(4,"D","A"),game(5,"D","B"),game(6,"A","B")];
  assert.deepEqual([...regularEliminatedPlayers(people,games,format)].sort(),["B","C"]);
  assert.deepEqual([...regularEliminatedPlayers(people,games,format,["B","C"])].sort(),["A","D"]);
});

test("scenario examples assign every remaining game and give the selected team a viable record",()=>{
  const result=qualificationScenarios(people,[game(1,"A","C")],format,"C");
  assert.equal(result.status,"possible");
  assert.ok(result.examples.length>=1);
  for(const scenario of result.examples){
    assert.equal(scenario.outcomes.reduce((total,pair)=>total+pair.games,0),5);
    assert.ok(scenario.outcomes.every(pair=>pair.aWins+pair.bWins===pair.games));
    assert.equal(scenario.finalWins,scenario.ownWins);
    assert.equal(scenario.finalGames,3);
  }
  assert.ok(result.examples.some(example=>example.ownWins<result.examples[0].ownWins));
});

test("scenario module reports elimination when no winning assignment can qualify",()=>{
  const games=[game(1,"A","C"),game(2,"B","C"),game(3,"C","D"),game(4,"D","A"),game(5,"D","B")];
  assert.equal(qualificationScenarios(people,games,format,"C").status,"eliminated");
});
