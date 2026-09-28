import { calculateStandings, cleanDisplayName, sameText } from "./league-core.js";
import { regularSchedule } from "./tournament-format.js";

const key = name => cleanDisplayName(name).toLowerCase();
const MAX_COMBINATIONS = 5000;

function canAssignRemainingWins(pairs, constrained, capacities) {
  const internal=pairs.filter(pair=>pair.remaining>0&&constrained.has(pair.a)&&constrained.has(pair.b));
  const required=internal.reduce((sum,pair)=>sum+pair.remaining,0);
  if(!required)return true;
  const teams=[...constrained];
  if(teams.reduce((sum,index)=>sum+capacities[index],0)<required)return false;
  const source=0,firstPair=1,firstTeam=firstPair+internal.length,sink=firstTeam+teams.length;
  const graph=Array.from({length:sink+1},()=>[]);
  const add=(from,to,capacity)=>{
    const forward={to,capacity,reverse:graph[to].length};
    const backward={to:from,capacity:0,reverse:graph[from].length};
    graph[from].push(forward);graph[to].push(backward);
  };
  const teamNode=new Map(teams.map((index,position)=>[index,firstTeam+position]));
  internal.forEach((pair,position)=>{
    const node=firstPair+position;
    add(source,node,pair.remaining);
    add(node,teamNode.get(pair.a),pair.remaining);
    add(node,teamNode.get(pair.b),pair.remaining);
  });
  for(const index of teams)add(teamNode.get(index),sink,capacities[index]);
  let assigned=0;
  while(assigned<required){
    const previous=Array(sink+1).fill(null),queue=[source];
    previous[source]=[-1,-1];
    for(let head=0;head<queue.length&&!previous[sink];head++){
      const node=queue[head];
      graph[node].forEach((edge,edgeIndex)=>{
        if(edge.capacity>0&&!previous[edge.to]){previous[edge.to]=[node,edgeIndex];queue.push(edge.to);}
      });
    }
    if(!previous[sink])return false;
    let amount=required-assigned;
    for(let node=sink;node!==source;){const [from,edgeIndex]=previous[node];amount=Math.min(amount,graph[from][edgeIndex].capacity);node=from;}
    for(let node=sink;node!==source;){
      const [from,edgeIndex]=previous[node],edge=graph[from][edgeIndex];
      edge.capacity-=amount;graph[node][edge.reverse].capacity+=amount;node=from;
    }
    assigned+=amount;
  }
  return true;
}

function canStillQualify(candidate, records, remaining, pairs, qualifierCount) {
  const finalGames=records[candidate].gp+remaining[candidate];
  if(!finalGames)return true;
  const maximumWins=records[candidate].w+remaining[candidate];
  const capacities=records.map((record,index)=>
    Math.floor(maximumWins*(record.gp+remaining[index])/finalGames)-record.w
  );
  const forced=[],atRisk=[];
  for(let index=0;index<records.length;index++){
    if(index===candidate)continue;
    if(capacities[index]<0){forced.push(index);continue;}
    const againstCandidate=pairs.find(pair=>(pair.a===candidate&&pair.b===index)||(pair.b===candidate&&pair.a===index))?.remaining||0;
    if(remaining[index]-againstCandidate>capacities[index])atRisk.push(index);
  }
  const allowed=qualifierCount-1-forced.length;
  if(allowed<0)return false;
  if(atRisk.length<=allowed)return true;

  // Give the selected team every remaining win. The other games are a flow problem:
  // can their wins be assigned while at most qualifierCount-1 teams finish above it?
  let combinations=0;
  const search=(start,selected)=>{
    if(selected.length===allowed){
      if(++combinations>MAX_COMBINATIONS)return true; // Keep uncertain teams unmarked.
      const unconstrained=new Set([...forced,...selected]);
      const constrained=new Set(records.map((_,index)=>index).filter(index=>index!==candidate&&!unconstrained.has(index)));
      return canAssignRemainingWins(pairs,constrained,capacities);
    }
    for(let index=start;index<=atRisk.length-(allowed-selected.length);index++){
      selected.push(atRisk[index]);
      if(search(index+1,selected))return true;
      selected.pop();
    }
    return false;
  };
  return search(0,[]);
}

export function regularEliminatedPlayers(participants, games, format, officialQualifiers = null) {
  if(Array.isArray(officialQualifiers))return new Set(participants.filter(person=>
    !officialQualifiers.some(name=>sameText(name,person.username))
  ).map(person=>person.username));
  if(!format||participants.length<=format.qualifierCount)return new Set();
  const standings=calculateStandings(games,participants);
  const rows=new Map(standings.map(row=>[key(row.user),row]));
  const records=participants.map(person=>rows.get(key(person.username))||{gp:0,w:0});
  const schedule=regularSchedule(participants,games,format.gamesPerOpponent);
  if(!schedule.remaining)return new Set(standings.slice(format.qualifierCount).map(row=>row.user));
  const indexes=new Map(participants.map((person,index)=>[key(person.username),index]));
  const pairs=schedule.pairs.map(pair=>({a:indexes.get(key(pair.a.username)),b:indexes.get(key(pair.b.username)),remaining:pair.remaining}));
  const remaining=participants.map((_,index)=>pairs.reduce((sum,pair)=>sum+(pair.a===index||pair.b===index?pair.remaining:0),0));
  return new Set(participants.filter((_,index)=>!canStillQualify(index,records,remaining,pairs,format.qualifierCount)).map(person=>person.username));
}
