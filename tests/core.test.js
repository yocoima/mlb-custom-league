import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanDisplayName,isLeagueRow,normalizeHistoryGame,opponentFromGame,participantTeamFromGame,
  showDateKey,isOnOrAfterStartDate,gameFingerprint,
  scoreThroughInning,isCompatibleWithRegulationInnings,
  isFormallyCompletedGame,
  calculateStandings,baseballIpToOuts,outsToBaseballIp,createStatAccumulator,addGameStats,battingLeaders,pitchingLeaders,tournamentAwards
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

test("standings conserva participantes configurados sin juegos",()=>{
  const standings=calculateStandings([], [{username:"hector-gali07",team:"Blue Jays"}]);
  assert.deepEqual(standings[0],{
    user:"hector-gali07",team:"Blue Jays",gp:0,w:0,l:0,rf:0,ra:0,form:[],pct:0,diff:0
  });
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

test("valida una liga de 5 innings sin excluir extra innings legítimos",()=>{
  const nineInningGame={innings:"9",away_runs_1:"1",away_runs_2:"0",away_runs_3:"1",away_runs_4:"1",away_runs_5:"0",home_runs_1:"0",home_runs_2:"0",home_runs_3:"1",home_runs_4:"1",home_runs_5:"0"};
  const extraInningGame={innings:"6",away_runs_1:"1",away_runs_2:"0",away_runs_3:"1",away_runs_4:"1",away_runs_5:"0",home_runs_1:"0",home_runs_2:"1",home_runs_3:"0",home_runs_4:"1",home_runs_5:"1"};
  assert.equal(scoreThroughInning(nineInningGame,"away",5),3);
  assert.equal(scoreThroughInning(nineInningGame,"home",5),2);
  assert.equal(isCompatibleWithRegulationInnings(nineInningGame,5),false);
  assert.equal(isCompatibleWithRegulationInnings(extraInningGame,5),true);
  assert.equal(isCompatibleWithRegulationInnings({innings:"4"},5),true);
});

test("excluye juegos interrumpidos o decididos por ruling",()=>{
  const completed={ruling:"0",innings:"5",away_runs:"3",home_runs:"6",away_display_result:"L",home_display_result:"W"};
  const interrupted={ruling:"6",innings:"3",away_runs:"3",home_runs:"2",away_display_result:"L",home_display_result:"W"};
  const tied={ruling:"0",innings:"5",away_runs:"1",home_runs:"1",away_display_result:"L",home_display_result:"W"};
  assert.equal(isFormallyCompletedGame(completed),true);
  assert.equal(isFormallyCompletedGame(interrupted),false);
  assert.equal(isFormallyCompletedGame(tied),false);
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

test("ordena líderes de bateo por cada categoría",()=>{
  const acc=createStatAccumulator();
  const base={manager:"Manager",team:"Tigers",g:1,r:0,bb:0,so:0,doubles:0,triples:0,hbp:0,sf:0,cs:0};
  acc.batting.set("avg",{...base,name:"AVG",ab:4,h:3,hr:0,rbi:1,sb:0});
  acc.batting.set("power",{...base,name:"POWER",ab:5,h:2,hr:2,rbi:4,sb:0});
  acc.batting.set("speed",{...base,name:"SPEED",ab:6,h:4,hr:0,rbi:0,sb:3});
  assert.equal(battingLeaders(acc,"avg")[0].name,"AVG");
  assert.equal(battingLeaders(acc,"hr")[0].name,"POWER");
  assert.equal(battingLeaders(acc,"h")[0].name,"SPEED");
  assert.equal(battingLeaders(acc,"rbi")[0].name,"POWER");
  assert.equal(battingLeaders(acc,"sb")[0].name,"SPEED");
});

test("ordena líderes de pitcheo por ponches",()=>{
  const acc=createStatAccumulator();
  const base={manager:"Manager",team:"Tigers",g:1,outs:15,h:2,r:1,er:1,bb:1,w:0,l:0,sv:0,bs:0,hold:0};
  acc.pitching.set("one",{...base,name:"Pitcher A",so:4});
  acc.pitching.set("two",{...base,name:"Pitcher B",so:8});
  assert.equal(pitchingLeaders(acc,"so")[0].name,"Pitcher B");
});

test("ordena líderes de pitcheo por efectividad y salvados",()=>{
  const acc=createStatAccumulator();
  const base={manager:"Manager",team:"Tigers",g:2,outs:15,h:2,r:1,bb:1,w:0,l:0,bs:0,hold:0,so:4};
  acc.pitching.set("era",{...base,name:"Mejor ERA",er:0,sv:0});
  acc.pitching.set("saves",{...base,name:"Cerrador",er:2,sv:3});
  assert.equal(pitchingLeaders(acc,"era")[0].name,"Mejor ERA");
  assert.equal(pitchingLeaders(acc,"sv")[0].name,"Cerrador");
});

test("archiva ganadores de lideratos e incluye empates",()=>{
  const acc=createStatAccumulator();
  const batter={manager:"Manager",team:"Tigers",g:2,ab:4,r:0,h:2,rbi:3,bb:0,so:0,doubles:0,triples:0,hr:2,hbp:0,sf:0,sb:1,cs:0};
  acc.batting.set("one",{...batter,name:"Bateador A"});
  acc.batting.set("two",{...batter,name:"Bateador B"});
  acc.pitching.set("closer",{manager:"Manager",team:"Tigers",name:"Cerrador",g:2,outs:6,h:0,r:0,er:0,bb:0,so:5,w:0,l:0,sv:2,bs:0,hold:0});
  const awards=tournamentAwards(acc);
  assert.deepEqual(awards.find(award=>award.key==="hr").winners.map(winner=>winner.player),["Bateador A","Bateador B"]);
  assert.equal(awards.find(award=>award.key==="sv").winners[0].value,"2");
});

test("consolida el mismo jugador aunque cambie p_inx, posición o decisión",()=>{
  const acc=createStatAccumulator();
  const gameBase={homeTeam:"Tigers",awayTeam:"Diamondbacks",homeUser:"Manager",awayUser:"Rival"};
  const payload=(batterName,pInx,pitcherName,pIdx,hits)=>({game:[["box_score",[
    {team_id:"7",team_name:"Tigers","7":{
      batting_stats:[{player_name:batterName,p_inx:pInx,ab:"2",r:"0",h:String(hits),rbi:"0",bb:"0",so:"0",doubles:"0",triples:"0",hr:"0",hbp:"0",sf:"0",sb:"0",cs:"0"}],
      pitching_stats:[{player_name:pitcherName,p_idx:pIdx,ip:"1.0",h:"0",r:"0",er:"0",bb:"0",so:"1",win:"0",loss:"0",save:"0",b_save:"0",hold:"0"}]
    }}
  ]]]});
  addGameStats(acc,{...gameBase,id:"1"},payload("Clark, CF","173","Pitcher (W, 1-0)","11",1));
  addGameStats(acc,{...gameBase,id:"2"},payload("1-Clark, PR-CF","205","Pitcher","19",2));
  const bat=battingLeaders(acc);
  const pit=pitchingLeaders(acc);
  assert.equal(bat.length,1); assert.equal(bat[0].g,2); assert.equal(bat[0].h,3);
  assert.equal(pit.length,1); assert.equal(pit[0].g,2); assert.equal(pit[0].so,2);
});
