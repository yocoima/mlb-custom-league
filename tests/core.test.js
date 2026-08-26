import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanDisplayName,isLeagueRow,normalizeHistoryGame,opponentFromGame,participantTeamFromGame,
  showDateKey,isOnOrAfterStartDate,gameFingerprint,
  calculateStandings,baseballIpToOuts,outsToBaseballIp,createStatAccumulator,addGameStats,battingLeaders,pitchingLeaders
} from "../src/league-core.js";

test("filtra LEAGUE y limpia códigos de formato",()=>{
  assert.equal(isLeagueRow({game_mode:"LEAGUE"}),true);
  assert.equal(isLeagueRow({game_mode:"ARENA"}),false);
  assert.equal(cleanDisplayName("Gaboandres20 ^b53^"),"Gaboandres20");
});

test("resuelve CPU como el usuario consultado",()=>{
  const row={id:"1",game_mode:"LEAGUE",home_full_name:"Diamondbacks",away_full_name:"Tigers",home_name:"Rival ^b53^",away_name:"CPU",home_runs:"1",away_runs:"2",display_date:"08/24/2026 23:23:25"};
  const g=normalizeHistoryGame(row,{queryUser:"mi_usuario"});
  assert.equal(g.awayUser,"mi_usuario");
  assert.equal(participantTeamFromGame(g,"mi_usuario"),"Tigers");
  assert.deepEqual(opponentFromGame(g,"mi_usuario","Tigers"),{user:"Rival",team:"Diamondbacks",side:"home"});
});

test("filtra por fecha de inicio usando la fecha oficial del juego",()=>{
  assert.equal(showDateKey("08/24/2026 23:23:25"),"2026-08-24");
  assert.equal(isOnOrAfterStartDate("08/24/2026 23:23:25","2026-08-15"),true);
  assert.equal(isOnOrAfterStartDate("06/05/2026 02:24:58","2026-08-15"),false);
});

test("fingerprint une los IDs por participante del mismo juego",()=>{
  const base={date:"08/22/2026 02:02:52",homeUser:"Hanscristians",awayUser:"yocoima_herrera",homeTeam:"Dodgers",awayTeam:"Tigers",homeScore:1,awayScore:4};
  assert.equal(gameFingerprint({...base,id:"1676353383"}),gameFingerprint({...base,id:"1676353384"}));
});

test("standings calcula W/L, carreras y diferencial",()=>{
  const games=[
    {homeUser:"A",awayUser:"B",homeTeam:"Tigers",awayTeam:"Red Sox",homeScore:5,awayScore:3,dateValue:new Date("2026-01-01")},
    {homeUser:"B",awayUser:"A",homeTeam:"Red Sox",awayTeam:"Tigers",homeScore:1,awayScore:2,dateValue:new Date("2026-01-02")}
  ];
  const s=calculateStandings(games);
  assert.equal(s[0].user,"A"); assert.equal(s[0].w,2); assert.equal(s[0].rf,7); assert.equal(s[0].ra,4); assert.equal(s[0].diff,3);
});

test("standings no separa un usuario solo por mayúsculas",()=>{
  const games=[
    {homeUser:"Yermain10",awayUser:"B",homeTeam:"Brewers",awayTeam:"Red Sox",homeScore:5,awayScore:3,dateValue:new Date("2026-01-01")},
    {homeUser:"C",awayUser:"yermain10",homeTeam:"Tigers",awayTeam:"Brewers",homeScore:1,awayScore:2,dateValue:new Date("2026-01-02")}
  ];
  const row=calculateStandings(games).find(item=>item.user.toLowerCase()==="yermain10");
  assert.equal(row.gp,2);
  assert.equal(row.w,2);
});

test("standings respeta la decisión oficial cuando el marcador quedó igualado por ruling",()=>{
  const games=[{
    homeUser:"Angelotti0611",awayUser:"gabrielVzla170",homeTeam:"Phillies",awayTeam:"Yankees",
    homeScore:1,awayScore:1,homeResult:"W",awayResult:"L",ruling:"5",dateValue:new Date("2026-08-22")
  }];
  const standings=calculateStandings(games);
  const winner=standings.find(row=>row.user==="Angelotti0611");
  const loser=standings.find(row=>row.user==="gabrielVzla170");
  assert.equal(winner.gp,1); assert.equal(winner.w,1); assert.equal(winner.l,0);
  assert.equal(loser.gp,1); assert.equal(loser.w,0); assert.equal(loser.l,1);
});

test("IP de béisbol se suma por outs",()=>{
  assert.equal(baseballIpToOuts("2.2"),8); assert.equal(baseballIpToOuts("0.1"),1); assert.equal(outsToBaseballIp(9),"3.0");
});

test("acumula box score y recalcula OPS/ERA",()=>{
  const acc=createStatAccumulator();
  const game={id:"1",homeTeam:"Tigers",awayTeam:"Diamondbacks",homeUser:"A",awayUser:"B"};
  const payload={game:[["box_score",[
    {team_id:"7",team_name:"Tigers","7":{batting_stats:[{player_name:"Batter, 1B",p_inx:"1",ab:"2",r:"1",h:"1",rbi:"2",bb:"0",so:"1",doubles:"0",triples:"0",hr:"1",hbp:"0",sf:"0",sb:"0",cs:"0"}],pitching_stats:[{player_name:"Pitcher (W, 1-0)",p_idx:"2",ip:"2.2",h:"1",r:"0",er:"0",bb:"1",so:"4",win:"1",loss:"0",save:"0",b_save:"0",hold:"0"}]}}
  ]]]};
  addGameStats(acc,game,payload);
  assert.equal(battingLeaders(acc)[0].hr,1);
  assert.equal(pitchingLeaders(acc)[0].ip,"2.2");
  assert.equal(pitchingLeaders(acc)[0].era,0);
});
