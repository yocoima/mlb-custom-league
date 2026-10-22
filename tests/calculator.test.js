import test from "node:test";
import assert from "node:assert/strict";
import {qualificationCalculator, DETAIL_GAME_LIMIT} from "../src/calculator.js";
import {calculateStandings} from "../src/league-core.js";

const people=["A","B","C","D"].map(username=>({username,team:"Tigers"}));
const format={gamesPerOpponent:1,qualifierCount:2};
function game(id,winner,loser,homeScore=2,awayScore=1){return {id:String(id),homeUser:winner,awayUser:loser,homeScore,awayScore,homeResult:"W",awayResult:"L"};}
const lateGames=[game(1,"A","C"),game(2,"B","C"),game(3,"C","D"),game(4,"D","A"),game(5,"D","B")];

test("calculator handles fresh startup and missing format without throwing",()=>{
  assert.equal(qualificationCalculator([],[],null,"").mode,"unconfigured");
  assert.equal(qualificationCalculator(people,[],null,"A").mode,"unconfigured");
});
test("early tournament gates detailed combinations by total pending games",()=>{
  const roster=[...people,{username:"E",team:"Tigers"}];
  const result=qualificationCalculator(roster,[],format,"A");
  assert.equal(result.mode,"early");assert.equal(result.totalRemaining,10);
  assert.equal(result.detailLimit,DETAIL_GAME_LIMIT);assert.equal(result.buckets,undefined);
  assert.equal(result.status,"contending");
});
test("closed regular round uses official qualifiers instead of inventing more games",()=>{
  const result=qualificationCalculator(people,[],null,"A",{officialQualifiers:["B","C"]});
  assert.equal(result.mode,"closed");assert.equal(result.status,"eliminated");
});
test("completed round follows RF then RA then alphabetical tiebreaks",()=>{
  const games=[...lateGames,game(6,"A","B")];
  for(const person of people){
    const result=qualificationCalculator(people,games,format,person.username);
    const qualified=calculateStandings(games,people).slice(0,2).some(row=>row.user===person.username);
    assert.equal(result.mode,"complete");assert.equal(result.status,qualified?"qualified":"eliminated");
  }
});
test("shared last game can eliminate a spectator whatever the score",()=>{
  const result=qualificationCalculator(people,lateGames,format,"C");
  assert.equal(result.status,"eliminated");assert.ok(result.finalGame.every(branch=>branch.status==="eliminated"));
});
test("duplicate game records do not inflate standings or change remaining games",()=>{
  assert.deepEqual(qualificationCalculator(people,[...lateGames,lateGames[0]],format,"A"),qualificationCalculator(people,lateGames,format,"A"));
});

function satisfies(rule,selected,final){
  const ownRuns=selected===final.homeUser?final.homeScore:final.awayScore;
  const allowed=selected===final.homeUser?final.awayScore:final.homeScore;
  if(rule.type==="margin")return ownRuns-allowed>=rule.minimum;
  if(rule.type==="score")return ownRuns>=rule.strictRuns||ownRuns===rule.equalRuns&&allowed<=rule.maxAllowed;
  const rivalRuns=rule.rival===final.homeUser?final.homeScore:final.awayScore;
  const rivalAllowed=rule.rival===final.homeUser?final.awayScore:final.homeScore;
  return rivalRuns<=rule.strictMaximum||rivalRuns===rule.equalRuns&&rivalAllowed>=rule.minAllowed;
}

test("final-game score rules exactly match official standings for every tested score and spectator",()=>{
  // Several histories exercise RF ties, RA ties, alphabetical ties, both winners,
  // both match participants, and teams whose schedule is already complete.
  const histories=[lateGames,
    [game(1,"C","A",4,1),game(2,"A","D",2,1),game(3,"B","C",3,2),game(4,"B","D",2,1),game(5,"C","D",3,0)],
    [game(1,"A","C",3,1),game(2,"A","D",2,1),game(3,"B","C",4,3),game(4,"D","B",2,1),game(5,"C","D",1,0)],
    [game(1,"C","A",9,0),game(2,"A","D",7,2),game(3,"C","B",5,3),game(4,"B","D",6,0),game(5,"D","C",3,2)],
    [game(1,"A","C",1,0),game(2,"D","A",1,0),game(3,"B","C",1,0),game(4,"D","B",1,0),game(5,"C","D",1,0)]];
  let conditional=0;
  for(const history of histories)for(const person of people){
    const result=qualificationCalculator(people,history,format,person.username);
    assert.equal(result.runAnalysis,"exact");
    for(let a=0;a<=18;a++)for(let b=0;b<=18;b++){
      if(a===b)continue;
      const final=game(6,"A","B",a,b);final.homeResult=a>b?"W":"L";final.awayResult=a>b?"L":"W";
      const branch=result.finalGame.find(item=>item.winner===(a>b?"A":"B"));
      const qualified=calculateStandings([...history,final],people).slice(0,2).some(row=>row.user===person.username);
      if(branch.status==="guaranteed")assert.equal(qualified,true);
      else if(branch.status==="eliminated")assert.equal(qualified,false);
      else{
        conditional++;
        assert.equal(branch.rules.filter(rule=>satisfies(rule,person.username,final)).length>=branch.passNeeded,qualified,JSON.stringify({person:person.username,a,b,branch}));
      }
    }
  }
  assert.ok(conditional>0);
});

test("winning all remaining games is not presented as necessary when fewer can suffice",()=>{
  const result=qualificationCalculator(people,[game(1,"A","C")],format,"A");
  assert.equal(result.minimumWins,0);
  assert.ok(result.buckets.some(bucket=>bucket.wins<result.remaining&&!bucket.eliminated));
});

test("two wins assure qualification but one only preserves a run tiebreak",()=>{
  const history=[game(1,"D","A",3,1),game(2,"C","B",3,1),game(3,"D","B",3,1),game(4,"D","C",3,1)];
  const result=qualificationCalculator(people,history,format,"A");
  assert.equal(result.guaranteeWins,2);assert.equal(result.minimumWins,1);
  assert.equal(result.buckets[1].tiebreak,true);
  assert.equal(result.buckets[2].guaranteed,true);
});

test("margin and runs scored can be alternative ways to win a three-team tiebreak",()=>{
  const history=[game(1,"C","A",4,1),game(2,"A","D",2,1),game(3,"B","C",3,2),game(4,"B","D",2,1),game(5,"C","D",3,0)];
  const result=qualificationCalculator(people,history,format,"A");
  const branch=result.finalGame.find(branch=>branch.winner==="A");
  assert.equal(branch.passNeeded,1);
  assert.deepEqual(branch.rules.find(rule=>rule.type==="margin"),{type:"margin",rival:"B",minimum:2});
  assert.equal(branch.rules.find(rule=>rule.type==="score").strictRuns,7);
});

test("repeated pending pairings produce win counts rather than fictitious scheduled game numbers",()=>{
  const result=qualificationCalculator(people,lateGames,{...format,gamesPerOpponent:2},"A");
  assert.equal(result.totalRemaining,7);
  assert.ok(result.qualificationConditions.items.flat().some(pair=>pair.remaining===2));
});

test("every sufficient winner condition guarantees its claim across scores",()=>{
  const history=[game(1,"A","C"),game(2,"B","C"),game(3,"D","B")];
  const pending=[["A","B"],["A","D"],["C","D"]];
  let checked=0;
  for(const person of people){
    const result=qualificationCalculator(people,history,format,person.username);
    for(const [field,expected] of [["qualificationConditions",true],["eliminationConditions",false]])for(const condition of result[field].items){
      for(let mask=0;mask<8;mask++){
        const future=pending.map(([a,b],i)=>game(10+i,mask&(1<<i)?a:b,mask&(1<<i)?b:a));
        const matches=condition.every(pair=>future.filter(g=>g.homeUser===pair.a&&(g.awayUser===pair.b)||g.homeUser===pair.b&&g.awayUser===pair.a).filter(g=>g.homeUser===pair.a).length===pair.aWins);
        if(!matches)continue;
        for(const runs of [[1,0],[30,0],[31,30]]){
          const games=future.map(g=>({...g,homeScore:runs[0],awayScore:runs[1]}));
          assert.equal(calculateStandings([...history,...games],people).slice(0,2).some(row=>row.user===person.username),expected);
          checked++;
        }
      }
    }
  }
  assert.ok(checked>0);
});
