import test from "node:test";
import assert from "node:assert/strict";
import { regularEliminatedPlayers } from "../src/qualification.js";

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
