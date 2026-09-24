import { sameText, parseShowDate } from "./league-core.js";

export function tournamentFormat(value) {
  if (!value) return null;
  const format = Object.fromEntries(["gamesPerOpponent", "qualifierCount", "postseasonBestOf", "finalBestOf"].map(key => [key, Number(value[key])]));
  if (!Number.isInteger(format.gamesPerOpponent) || format.gamesPerOpponent < 1 || format.gamesPerOpponent > 100) throw new Error("Indica entre 1 y 100 juegos contra cada rival.");
  if (![2,4,8,16,32,64].includes(format.qualifierCount)) throw new Error("Para eliminación directa deben clasificar 2, 4, 8, 16, 32 o 64 participantes.");
  for (const key of ["postseasonBestOf", "finalBestOf"]) {
    if (!Number.isInteger(format[key]) || format[key] < 1 || format[key] > 15 || format[key] % 2 === 0) throw new Error("Cada serie debe ser al mejor de un número impar entre 1 y 15.");
  }
  return format;
}

function uniqueGames(games) {
  const seen = new Set();
  return games.filter(game => {
    const key = game.uuid || game.dedupKey || game.id;
    if (key && seen.has(String(key))) return false;
    if (key) seen.add(String(key));
    return true;
  });
}
function between(game, a, b) {
  return (sameText(game.homeUser,a) && sameText(game.awayUser,b)) || (sameText(game.homeUser,b) && sameText(game.awayUser,a));
}

export function regularSchedule(participants, games, gamesPerOpponent) {
  const unique = uniqueGames(games);
  const pairs = [];
  for (let i=0;i<participants.length;i++) for(let j=i+1;j<participants.length;j++) {
    const a=participants[i], b=participants[j];
    const played=unique.filter(game=>between(game,a.username,b.username)).length;
    pairs.push({a,b,scheduled:gamesPerOpponent,played,remaining:Math.max(0,gamesPerOpponent-played),extra:Math.max(0,played-gamesPerOpponent)});
  }
  const teams=participants.map(participant=>{
    const matches=pairs.filter(pair=>sameText(pair.a.username,participant.username)||sameText(pair.b.username,participant.username));
    return {...participant,scheduled:(participants.length-1)*gamesPerOpponent,played:matches.reduce((sum,pair)=>sum+pair.played,0),remaining:matches.reduce((sum,pair)=>sum+pair.remaining,0)};
  });
  return {pairs,teams,scheduled:pairs.length*gamesPerOpponent,remaining:pairs.reduce((sum,pair)=>sum+pair.remaining,0)};
}

// Standard seeded bracket: 1–4 / 2–3, or 1–8 / 4–5 / 2–7 / 3–6.
export function postseasonSchedule(qualifiers, games, format) {
  if (qualifiers.length!==format.qualifierCount) return [];
  let seeds=[1,2];
  while(seeds.length<qualifiers.length){const size=seeds.length*2;seeds=seeds.flatMap(seed=>[seed,size+1-seed]);}
  let slots=seeds.map(seed=>({username:qualifiers[seed-1],label:`#${seed} ${qualifiers[seed-1]}`,after:0}));
  const sorted=uniqueGames(games).sort((a,b)=>(parseShowDate(a.date)?.getTime()||0)-(parseShowDate(b.date)?.getTime()||0));
  const rounds=[];
  while(slots.length>1){
    const final=slots.length===2,bestOf=final?format.finalBestOf:format.postseasonBestOf,needed=(bestOf+1)/2;
    const series=[];
    for(let i=0;i<slots.length;i+=2){
      const a=slots[i],b=slots[i+1],wins=[0,0];
      let winner=null,finishedAt=0,played=0;
      if(a.username&&b.username)for(const game of sorted){
        if(!between(game,a.username,b.username))continue;
        const at=parseShowDate(game.date)?.getTime()||0;
        if(at<=Math.max(a.after,b.after) && Math.max(a.after,b.after)>0)continue;
        const won=game.homeResult==="W"||game.awayResult==="L"?game.homeUser:game.awayResult==="W"||game.homeResult==="L"?game.awayUser:game.homeScore>game.awayScore?game.homeUser:game.awayScore>game.homeScore?game.awayUser:null;
        if(!won)continue;
        wins[sameText(won,a.username)?0:1]++;played++;
        if(wins.some(value=>value===needed)){winner=wins[0]===needed?a.username:b.username;finishedAt=at;break;}
      }
      series.push({a,b,bestOf,needed,wins,played,winner,finishedAt,remaining:winner?0:needed-Math.max(...wins),possible:winner?0:bestOf-played});
    }
    const name=final?"Final":slots.length===4?"Semifinales":slots.length===8?"Cuartos de final":`Ronda de ${slots.length}`;
    rounds.push({name,series});
    slots=series.map((match,index)=>({username:match.winner,label:`Ganador ${name} ${index+1}`,after:match.finishedAt}));
  }
  return rounds;
}
