import {calculateStandings, cleanDisplayName, sameText} from "./league-core.js";
import {regularSchedule} from "./tournament-format.js";

export const DETAIL_GAME_LIMIT=8;
const key=value=>cleanDisplayName(value).toLowerCase();

function uniqueGames(games){
  const seen=new Set();
  return games.filter(game=>{
    const id=game.uuid||game.dedupKey||game.id;
    if(id&&seen.has(String(id)))return false;
    if(id)seen.add(String(id));
    return true;
  });
}

// Scores have no upper bound. For each future game use loserRuns >= 0 and
// marginExtra >= 0: winnerRuns = loserRuns + 1 + marginExtra.
// This preserves the relationship between both teams' runs without choosing scores.
function scoreModels(rows,matches){
  const models=rows.map(row=>({rf:row.rf,ra:row.ra,rfTerms:Array(matches.length*2).fill(0),raTerms:Array(matches.length*2).fill(0)}));
  matches.forEach(({winner,loser},index)=>{
    models[winner].rf++;models[loser].ra++;
    for(const team of [winner,loser]){models[team].rfTerms[index*2]=1;models[team].raTerms[index*2]=1;}
    models[winner].rfTerms[index*2+1]=1;models[loser].raTerms[index*2+1]=1;
  });
  return models;
}

function alwaysAhead(a,b,models,rows){
  const left=models[a],right=models[b],rf=left.rf-right.rf;
  const rfTerms=left.rfTerms.map((value,i)=>value-right.rfTerms[i]);
  if(rf<0||rfTerms.some(value=>value<0))return false;
  if(rf>0)return true;
  // RF can tie only when every variable with a positive RF coefficient is zero.
  const ra=left.ra-right.ra;
  const raCanIncrease=left.raTerms.some((value,i)=>rfTerms[i]===0&&value-right.raTerms[i]>0);
  return !raCanIncrease&&(ra<0||ra===0&&rows[a].user.localeCompare(rows[b].user)<0);
}

function rankOutcome(candidate,wins,finalGames,matches,rows,qualifierCount){
  const models=scoreModels(rows,matches),uncertain=[];
  let ahead=0;
  for(let other=0;other<rows.length;other++){
    if(other===candidate)continue;
    const difference=wins[other]*(finalGames[candidate]||1)-wins[candidate]*(finalGames[other]||1);
    if(difference>0){ahead++;continue;}
    if(difference<0)continue;
    if(alwaysAhead(other,candidate,models,rows))ahead++;
    else if(!alwaysAhead(candidate,other,models,rows))uncertain.push(other);
  }
  const status=ahead>=qualifierCount?"eliminated":ahead+uncertain.length<qualifierCount?"guaranteed":"tiebreak";
  return {status,ahead,uncertain,passNeeded:Math.max(0,ahead+uncertain.length-qualifierCount+1)};
}

// A condition leaves some pairings unrestricted. It is offered only if EVERY
// completion has the stated result. Display limits never change the conclusion.
function sufficientConditions(outcomes,pairs,status,limit=4){
  if(!outcomes.some(outcome=>outcome.status===status))return {items:[],truncated:false};
  const valid=new Map();
  for(let mask=0;mask<2**pairs.length;mask++){
    const groups=new Map();
    outcomes.forEach((outcome,index)=>{
      const pattern=outcome.counts.map((count,i)=>mask&(1<<i)?count:null);
      const id=JSON.stringify(pattern);
      if(!groups.has(id))groups.set(id,{pattern,members:[],valid:true});
      const group=groups.get(id);group.members.push(index);group.valid&&=outcome.status===status;
    });
    for(const [id,group] of groups)if(group.valid)valid.set(id,group);
  }
  const primes=[...valid.values()].filter(group=>!group.pattern.some((count,i)=>{
    if(count===null)return false;
    const parent=[...group.pattern];parent[i]=null;
    return valid.has(JSON.stringify(parent));
  }));
  const uncovered=new Set(outcomes.flatMap((outcome,index)=>outcome.status===status?[index]:[]));
  const items=[];
  while(uncovered.size&&items.length<limit){
    primes.sort((a,b)=>b.members.filter(i=>uncovered.has(i)).length-a.members.filter(i=>uncovered.has(i)).length||a.pattern.filter(x=>x!==null).length-b.pattern.filter(x=>x!==null).length);
    const best=primes.shift();
    if(!best)break;
    items.push(best.pattern.flatMap((count,index)=>count===null?[]:[{...pairs[index],aWins:count}]));
    best.members.forEach(index=>uncovered.delete(index));
  }
  return {items,truncated:uncovered.size>0};
}

// Exact, necessary-and-sufficient pairwise conditions for the final pending game.
// x is the selected team's runs and y its opponent's runs; for a spectator,
// x/y refer to the tied rival and that rival's opponent instead.
function finalRunRule(candidate,rival,match,rows){
  const own=rows[candidate],other=rows[rival];
  const candidatePlays=candidate===match.winner||candidate===match.loser;
  const rivalPlays=rival===match.winner||rival===match.loser;
  const alphabetical=own.user.localeCompare(other.user)<0;
  if(candidatePlays&&rivalPlays){
    const equalRfMargin=other.rf-own.rf;
    const raAtTie=own.ra-other.ra-equalRfMargin;
    return {type:"margin",rival:other.user,minimum:equalRfMargin+(raAtTie<0||raAtTie===0&&alphabetical?0:1)};
  }
  if(candidatePlays){
    return {type:"score",rival:other.user,strictRuns:other.rf-own.rf+1,equalRuns:other.rf-own.rf,maxAllowed:other.ra-own.ra-(alphabetical?0:1)};
  }
  return {type:"rival-score",rival:other.user,strictMaximum:own.rf-other.rf-1,equalRuns:own.rf-other.rf,minAllowed:own.ra-other.ra+(alphabetical?0:1)};
}

export function qualificationCalculator(participants,inputGames,format,username,{officialQualifiers=null}={}){
  const candidate=participants.findIndex(person=>sameText(person.username,username));
  if(candidate<0)return {mode:"unconfigured"};
  const games=uniqueGames(inputGames);
  const standings=calculateStandings(games,participants),byName=new Map(standings.map(row=>[key(row.user),row]));
  const rows=participants.map(person=>byName.get(key(person.username)));
  const record=rows[candidate];
  const base={username:record.user,record:{w:record.w,l:record.l,rf:record.rf,ra:record.ra},position:standings.findIndex(row=>sameText(row.user,username))+1};
  if(Array.isArray(officialQualifiers))return {...base,mode:"closed",status:officialQualifiers.some(name=>sameText(name,username))?"qualified":"eliminated"};
  if(!format||!Number.isInteger(format.gamesPerOpponent)||format.gamesPerOpponent<1||!Number.isInteger(format.qualifierCount)||format.qualifierCount<1||format.qualifierCount>participants.length)return {...base,mode:"unconfigured"};
  const schedule=regularSchedule(participants,games,format.gamesPerOpponent);
  const indexes=new Map(participants.map((person,index)=>[key(person.username),index]));
  const pairs=schedule.pairs.filter(pair=>pair.remaining>0).map(pair=>({a:indexes.get(key(pair.a.username)),b:indexes.get(key(pair.b.username)),remaining:pair.remaining}));
  const remaining=participants.map((_,i)=>pairs.reduce((total,pair)=>total+(pair.a===i||pair.b===i?pair.remaining:0),0));
  const finalGames=rows.map((row,i)=>row.gp+remaining[i]);
  const common={...base,remaining:remaining[candidate],totalRemaining:schedule.remaining,qualifierCount:format.qualifierCount,detailLimit:DETAIL_GAME_LIMIT};
  if(!schedule.remaining)return {...common,mode:"complete",status:base.position<=format.qualifierCount?"qualified":"eliminated"};
  const pctCompare=(other,ownWins,otherWins)=>otherWins*(finalGames[candidate]||1)-ownWins*(finalGames[other]||1);
  const ownMaximum=record.w+remaining[candidate];
  const loseAllThreats=rows.filter((row,i)=>i!==candidate&&pctCompare(i,record.w,row.w+remaining[i])>=0).length;
  const winAllThreats=rows.filter((row,i)=>{
    if(i===candidate)return false;
    const headToHead=pairs.find(pair=>pair.a===candidate&&pair.b===i||pair.b===candidate&&pair.a===i)?.remaining||0;
    return pctCompare(i,ownMaximum,row.w+remaining[i]-headToHead)>=0;
  }).length;
  const unbeatable=rows.filter((row,i)=>i!==candidate&&pctCompare(i,ownMaximum,row.w)>0).length;
  if(schedule.remaining>DETAIL_GAME_LIMIT)return {...common,mode:"early",status:loseAllThreats<format.qualifierCount?"qualified":unbeatable>=format.qualifierCount?"eliminated":"contending",winAllGuarantees:winAllThreats<format.qualifierCount};

  const outcomes=[];
  const visit=(index,counts)=>{
    if(index<pairs.length){
      for(let count=0;count<=pairs[index].remaining;count++)visit(index+1,[...counts,count]);
      return;
    }
    const wins=rows.map(row=>row.w),matches=[];
    pairs.forEach((pair,i)=>{
      wins[pair.a]+=counts[i];wins[pair.b]+=pair.remaining-counts[i];
      for(let n=0;n<pair.remaining;n++)matches.push({winner:n<counts[i]?pair.a:pair.b,loser:n<counts[i]?pair.b:pair.a});
    });
    const rank=rankOutcome(candidate,wins,finalGames,matches,rows,format.qualifierCount);
    outcomes.push({...rank,counts,ownWins:wins[candidate]-record.w,matches});
  };
  visit(0,[]);
  const buckets=Array.from({length:remaining[candidate]+1},(_,wins)=>{
    const selected=outcomes.filter(outcome=>outcome.ownWins===wins);
    return {wins,guaranteed:selected.every(outcome=>outcome.status==="guaranteed"),eliminated:selected.every(outcome=>outcome.status==="eliminated"),canGuarantee:selected.some(outcome=>outcome.status==="guaranteed"),tiebreak:selected.some(outcome=>outcome.status==="tiebreak")};
  });
  const minimumWins=buckets.find(bucket=>!bucket.eliminated)?.wins??null;
  const guaranteeWins=buckets.find(bucket=>buckets.filter(other=>other.wins>=bucket.wins).every(other=>other.guaranteed))?.wins??null;
  const namedPairs=pairs.map(pair=>({...pair,a:rows[pair.a].user,b:rows[pair.b].user}));
  const result={...common,mode:"detailed",status:outcomes.every(outcome=>outcome.status==="guaranteed")?"qualified":outcomes.every(outcome=>outcome.status==="eliminated")?"eliminated":"contending",minimumWins,guaranteeWins,buckets,
    qualificationConditions:sufficientConditions(outcomes,namedPairs,"guaranteed"),eliminationConditions:sufficientConditions(outcomes,namedPairs,"eliminated"),
    // Multiple unresolved run tiebreaks can share scores. Do not assert their
    // joint feasibility or manufacture an exact run threshold from PCT alone.
    runAnalysis:schedule.remaining===1?"exact":"pending",
    finalGame:schedule.remaining===1?outcomes.map(outcome=>{
      const match=outcome.matches[0];
      return {winner:rows[match.winner].user,loser:rows[match.loser].user,status:outcome.status,passNeeded:outcome.passNeeded,rules:outcome.uncertain.map(rival=>finalRunRule(candidate,rival,match,rows))};
    }):[]};
  return result;
}
