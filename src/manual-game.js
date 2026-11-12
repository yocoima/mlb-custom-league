import {normalizeHistoryGame,sameText,parseShowDate,isLeagueRow,cleanDisplayName} from "./league-core.js";

export function gameRecords(game){
  const records=[...(game.apiRecords||[]),{id:game.id,username:game.sourceUser,platform:"psn"}];
  return records.filter((record,index)=>/^\d+$/.test(String(record.id||""))&&record.username&&!records.slice(0,index).some(other=>String(other.id)===String(record.id)&&sameText(other.username,record.username))).map(record=>({...record,id:String(record.id),platform:"psn"}));
}
export function shareGameRecord(a,b){
  return gameRecords(a).some(record=>gameRecords(b).some(other=>record.id===other.id&&sameText(record.username,other.username)));
}
export function gameClaimKeys(game){
  return [...(game.uuid?[cleanDisplayName(game.uuid)]:[]),...gameRecords(game).map(record=>`record:${cleanDisplayName(record.username).toLowerCase()}:${record.id}`)];
}
export function confirmHistoryGame(source,histories){
  if(!parseShowDate(source.date)||sameText(source.homeUser,source.awayUser))throw new Error("Revisa la fecha y los participantes antes de incluir el partido.");
  const records=[],knownRecords=gameRecords(source);let canonical,confirmedDate=null;
  const sides=["home","away"].sort((a,b)=>Number(knownRecords.some(record=>sameText(record.username,source[`${b}User`])))-Number(knownRecords.some(record=>sameText(record.username,source[`${a}User`]))));
  for(const side of sides){
    const username=source[`${side}User`],history=histories.find(item=>sameText(item.username,username));
    const known=knownRecords.filter(record=>sameText(record.username,username));
    const row=history?.rows.find(row=>{
      if(!isLeagueRow(row)||!/^\d+$/.test(String(row.id||"")))return false;
      const game=normalizeHistoryGame(row,{queryUser:username,queryTeam:source[`${side}Team`]});
      const at=parseShowDate(game.date)?.getTime();
      return Number.isFinite(at)&&(known.length?known.some(record=>record.id===String(row.id)):at===(confirmedDate||parseShowDate(source.date).getTime()))&&
        sameText(game.homeUser,source.homeUser)&&sameText(game.awayUser,source.awayUser)&&
        sameText(game.homeTeam,source.homeTeam)&&sameText(game.awayTeam,source.awayTeam)&&
        game.homeScore===Number(source.homeScore)&&game.awayScore===Number(source.awayScore)&&
        ((game.homeResult==="W"&&game.awayResult==="L")||(game.homeResult==="L"&&game.awayResult==="W"));
    });
    if(!row)throw new Error(`No se pudo confirmar este marcador en el historial oficial de ${username}. No se incluyó el partido.`);
    canonical=normalizeHistoryGame(row,{queryUser:username,queryTeam:source[`${side}Team`]});
    const at=parseShowDate(canonical.date).getTime();
    if(confirmedDate!==null&&at!==confirmedDate)throw new Error("Los historiales aún no coinciden en la fecha del partido. Actualiza y vuelve a intentarlo.");
    confirmedDate=at;
    records.push({id:String(row.id),username,platform:"psn"});
  }
  if(!Number.isFinite(canonical.homeScore)||!Number.isFinite(canonical.awayScore)||canonical.homeScore<0||canonical.awayScore<0||canonical.homeScore===canonical.awayScore)throw new Error("El historial debe confirmar un marcador final sin empate.");
  const dedupKey="history:"+records.map(record=>`${record.username.toLowerCase()}:${record.id}`).sort().join(",");
  return {...source,date:canonical.date,dateValue:parseShowDate(canonical.date),homeScore:canonical.homeScore,awayScore:canonical.awayScore,homeResult:canonical.homeResult,awayResult:canonical.awayResult,uuid:null,dedupKey,pendingGameLog:true,apiRecords:records,id:records[0].id,sourceUser:records[0].username,sourcePlatform:"psn"};
}
