import test from "node:test";
import assert from "node:assert/strict";
import { tournamentFormat, regularSchedule, postseasonSchedule, pendingMatchupGroups } from "../src/tournament-format.js";

const format={gamesPerOpponent:2,qualifierCount:4,postseasonBestOf:3,finalBestOf:5};
const participants=["A","B","C","D"].map(username=>({username,team:"Dodgers"}));
test("pending groups show the busiest team first without repeating a pairing",()=>{
  const people=["Gaboandres20","tributo-cano","BoweMio","Angelotti0611","daddy_champagnee"].map(username=>({username,team:"Dodgers"}));
  const schedule=regularSchedule(people,[],1);
  for(const pair of schedule.pairs)pair.remaining=0;
  for(const [a,b] of [[0,1],[0,2],[3,4]])schedule.pairs.find(pair=>pair.a===people[a]&&pair.b===people[b]).remaining=1;
  const groups=pendingMatchupGroups(schedule);
  assert.deepEqual(groups.map(group=>[group.team.username,group.team.remaining]),[["Gaboandres20",2],["Angelotti0611",1]]);
  assert.deepEqual(groups[0].opponents.map(item=>item.participant.username),["BoweMio","tributo-cano"]);
  assert.equal(groups.reduce((sum,group)=>sum+group.opponents.length,0),3);
  for(const pair of schedule.pairs)pair.remaining=0;
  assert.deepEqual(pendingMatchupGroups(schedule),[]);
});
function game(id,homeUser,awayUser,homeScore=2,awayScore=1){
  return {id,uuid:String(id),homeUser,awayUser,homeScore,awayScore,date:`2026-09-${String(id).padStart(2,"0")}T12:00:00Z`};
}
test("format validates series and leaves old tournaments unconfigured",()=>{
  assert.equal(tournamentFormat(undefined),null);
  assert.deepEqual(tournamentFormat(format),format);
  for(const patch of [{gamesPerOpponent:0},{gamesPerOpponent:1.5},{qualifierCount:3},{postseasonBestOf:4},{finalBestOf:0}])assert.throws(()=>tournamentFormat({...format,...patch}));
});
test("regular schedule counts every user, deduplicates games, and never offsets another pairing with excess games",()=>{
  const games=[game(1,"A","B"),game(1,"A","B"),game(2,"B","A"),game(3,"A","B")];
  const schedule=regularSchedule(participants,games,2);
  assert.equal(schedule.pairs.length,6);
  assert.equal(schedule.scheduled,12);
  assert.equal(schedule.remaining,10);
  assert.equal(schedule.teams[0].scheduled,6);
  assert.equal(schedule.teams[0].remaining,4);
  assert.equal(schedule.pairs[0].extra,1);
  assert.equal(regularSchedule(participants,[],2).remaining,12);
});
test("postseason advances series winners and uses separate final length",()=>{
  const games=[game(1,"A","D"),game(2,"D","A",1,3),game(3,"B","C"),game(4,"C","B",1,4),game(5,"A","B"),game(6,"B","A")];
  const rounds=postseasonSchedule(["A","B","C","D"],games,format);
  assert.deepEqual(rounds[0].series.map(s=>[s.a.username,s.b.username]),[["A","D"],["B","C"]]);
  assert.deepEqual(rounds[0].series.map(s=>s.winner),["A","B"]);
  const final=rounds[1].series[0];
  assert.equal(final.bestOf,5);
  assert.deepEqual(final.wins,[1,1]);
  assert.equal(final.remaining,2);
  assert.equal(final.possible,3);
  const closed=postseasonSchedule(["A","B","C","D"],[...games,game(7,"A","B"),game(8,"A","B"),game(9,"B","A")],format).at(-1).series[0];
  assert.equal(closed.winner,"A");
  assert.equal(closed.remaining,0);
  assert.equal(closed.played,4);
});
test("unknown finalists stay pending and premature final games do not count",()=>{
  const rounds=postseasonSchedule(["A","B","C","D"],[game(1,"A","B"),game(2,"A","D"),game(3,"A","D"),game(4,"B","C"),game(5,"B","C")],format);
  assert.equal(rounds[1].series[0].played,0);
  assert.equal(postseasonSchedule(["A","B","C","D"],[],format)[1].series[0].a.username,null);
  assert.deepEqual(postseasonSchedule([],[],format),[]);
});
test("two qualifiers go directly to final and official rulings determine series winners",()=>{
  const games=[{...game(1,"A","B",0,0),homeResult:"W",awayResult:"L"}];
  const rounds=postseasonSchedule(["A","B"],games,{...format,qualifierCount:2,finalBestOf:1});
  assert.equal(rounds.length,1);
  assert.equal(rounds[0].name,"Final");
  assert.equal(rounds[0].series[0].winner,"A");
});
test("eight qualifiers get a stable seeded bracket",()=>{
  const rounds=postseasonSchedule(["A","B","C","D","E","F","G","H"],[],{...format,qualifierCount:8});
  assert.deepEqual(rounds[0].series.map(s=>[s.a.username,s.b.username]),[["A","H"],["D","E"],["B","G"],["C","F"]]);
  assert.equal(rounds.length,3);
});
