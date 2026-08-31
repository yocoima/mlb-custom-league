import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanDisplayName,isLeagueRow,normalizeHistoryGame,opponentFromGame,participantTeamFromGame,
  showDateKey,isOnOrAfterStartDate,gameFingerprint,
  scoreThroughInning,isCompatibleWithRegulationInnings,
  isFormallyCompletedGame,
  calculateStandings,baseballIpToOuts,outsToBaseballIp,createStatAccumulator,addGameStats,battingLeaders,pitchingLeaders,tournamentAwards,
  battingQualifies,pitchingQualifies,filterStatLeaders
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
  assert.equal(s[0].homeGp,1); assert.equal(s[0].awayGp,1);
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
    user:"hector-gali07",team:"Blue Jays",gp:0,homeGp:0,awayGp:0,w:0,l:0,rf:0,ra:0,form:[],pct:0,diff:0
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

test("acepta extra innings cuando line_score desplaza los slots de entradas",()=>{
  const tenInningGame={
    innings:"10",home_runs:"8",away_runs:"5",
    inning_1:"2",home_runs_1:"0",away_runs_1:"0",
    inning_2:"3",home_runs_2:"0",away_runs_2:"0",
    inning_3:"4",home_runs_3:"3",away_runs_3:"0",
    inning_4:"5",home_runs_4:"0",away_runs_4:"1",
    inning_5:"6",home_runs_5:"0",away_runs_5:"0",
    inning_6:"7",home_runs_6:"0",away_runs_6:"3",
    inning_7:"8",home_runs_7:"0",away_runs_7:"0",
    inning_8:"9",home_runs_8:"1",away_runs_8:"0",
    inning_9:"10",home_runs_9:"4",away_runs_9:"1"
  };
  assert.equal(scoreThroughInning(tenInningGame,"home",9),4);
  assert.equal(scoreThroughInning(tenInningGame,"away",9),4);
  assert.equal(isCompatibleWithRegulationInnings(tenInningGame,9),true);
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

test("filtra estadísticas por búsqueda, manager y equipo",()=>{
  const rows=[
    {name:"José Ramírez",manager:"Manager Uno",team:"Guardians"},
    {name:"Aaron Judge",manager:"Manager Dos",team:"Yankees"},
    {name:"Juan Soto",manager:"Manager Uno",team:"Yankees"}
  ];
  assert.deepEqual(filterStatLeaders(rows,{query:"jose"}).map(row=>row.name),["José Ramírez"]);
  assert.deepEqual(filterStatLeaders(rows,{manager:"manager uno",team:"Yankees"}).map(row=>row.name),["Juan Soto"]);
  assert.deepEqual(filterStatLeaders(rows,{query:"yankees"}).map(row=>row.name),["Aaron Judge","Juan Soto"]);
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

test("califica AVG y ERA con el mínimo proporcional a innings y juegos del equipo",()=>{
  const base={manager:"Manager",team:"Tigers",r:0,so:0,doubles:0,triples:0,hbp:0,sf:0,cs:0};
  const smallSample={...base,name:"Racha corta",g:1,ab:1,h:1,rbi:0,bb:0,hr:0,sb:0};
  const fullSeason={...base,name:"Titular",g:2,ab:6,h:3,rbi:1,bb:1,hr:0,sb:0};
  assert.equal(battingQualifies({...smallSample,pa:1}),false);
  assert.equal(battingQualifies({...fullSeason,pa:7}),true);

  const acc=createStatAccumulator();
  acc.batting.set("short",smallSample);
  acc.batting.set("full",fullSeason);
  acc.pitching.set("short",{manager:"Manager",team:"Tigers",name:"Relevo corto",g:1,outs:2,h:0,r:0,er:0,bb:0,so:1,w:0,l:0,sv:0,bs:0,hold:0});
  acc.pitching.set("full",{manager:"Manager",team:"Tigers",name:"Abridor",g:2,outs:6,h:2,r:1,er:1,bb:0,so:2,w:1,l:0,sv:0,bs:0,hold:0});
  const awards=tournamentAwards(acc);
  assert.equal(awards.find(award=>award.key==="avg").winners[0].player,"Titular");
  assert.equal(awards.find(award=>award.key==="era").winners[0].player,"Abridor");
});

test("en 5 innings Clark califica sobre Keith usando los juegos del manager",()=>{
  const games=Array.from({length:7},(_,index)=>({homeUser:"yocoima_herrera",awayUser:`Rival${index}`}));
  const qualification={games,regulationInnings:5};
  assert.equal(battingQualifies({manager:"yocoima_herrera",g:7,pa:19},qualification),true);
  assert.equal(battingQualifies({manager:"yocoima_herrera",g:2,pa:6},qualification),false);
  assert.equal(pitchingQualifies({manager:"yocoima_herrera",g:2,outs:11},qualification),false);
  assert.equal(pitchingQualifies({manager:"yocoima_herrera",g:4,outs:12},qualification),true);
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
