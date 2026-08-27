import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.js";

function mockKv(){
  const values=new Map();
  return {
    async get(key,type){
      const value=values.get(key)??null;
      return value!==null&&type==="json"?JSON.parse(value):value;
    },
    async put(key,value){values.set(key,value)}
  };
}

function snapshot(){
  return {
    version:1,lastSync:"2026-08-26T12:00:00.000Z",
    config:{leagueName:"Liga prueba",username:"commissioner",platform:"psn",myTeam:"Tigers",startDate:"2026-08-15",regulationInnings:5,maxPages:40,proxyBase:"https://worker.example",roster:{commissioner:"Tigers",friend:"Blue Jays"},champions:[{season:"Torneo 2025",champion:"friend",team:"Blue Jays",runnerUp:"commissioner",result:"4-2"}]},
    participants:[{username:"commissioner",team:"Tigers",playerId:"10",teamId:"7"},{username:"friend",team:"Blue Jays",playerId:"20",teamId:"14"}],
    games:[{id:"1",dedupKey:"uuid:one",homeUser:"commissioner",awayUser:"friend"}],
    stats:{batting:[["player",{name:"Batter",h:1}]],pitching:[],loadedGameIds:["1"],failedGameIds:[]}
  };
}

test("POST /api/league exige la clave privada",async()=>{
  const env={LEAGUE_STORE:mockKv(),LEAGUE_PUBLISH_TOKEN:"private-token"};
  const response=await worker.fetch(new Request("https://worker.example/api/league",{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(snapshot())
  }),env);
  assert.equal(response.status,401);
});

test("publica con autorización y permite lectura pública",async()=>{
  const env={LEAGUE_STORE:mockKv(),LEAGUE_PUBLISH_TOKEN:"private-token"};
  const published=await worker.fetch(new Request("https://worker.example/api/league",{
    method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer private-token"},body:JSON.stringify(snapshot())
  }),env);
  assert.equal(published.status,200);
  const result=await published.json();
  assert.equal(result.games,1);

  const response=await worker.fetch(new Request("https://worker.example/api/league"),env);
  assert.equal(response.status,200);
  const saved=await response.json();
  assert.equal(saved.version,1);
  assert.equal(saved.games[0].dedupKey,"uuid:one");
  assert.equal(saved.stats.batting[0][1].name,"Batter");
  assert.deepEqual(saved.config.champions,[{season:"Torneo 2025",champion:"friend",team:"Blue Jays",runnerUp:"commissioner",result:"4-2",note:"",finalizedAt:"",awards:[]}]);
  assert.ok(saved.publishedAt);
});

test("limpia y limita el historial publico de campeones",async()=>{
  const env={LEAGUE_STORE:mockKv(),LEAGUE_PUBLISH_TOKEN:"private-token"};
  const data=snapshot();
  data.config.champions=[{season:"",champion:"sin temporada"},{season:"Torneo 2026",champion:"A".repeat(120),note:"N".repeat(400)}];
  await worker.fetch(new Request("https://worker.example/api/league",{
    method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer private-token"},body:JSON.stringify(data)
  }),env);
  const saved=await (await worker.fetch(new Request("https://worker.example/api/league"),env)).json();
  assert.equal(saved.config.champions.length,1);
  assert.equal(saved.config.champions[0].champion.length,100);
  assert.equal(saved.config.champions[0].note.length,300);
});

test("GET /api/league responde 404 antes de la primera publicación",async()=>{
  const env={LEAGUE_STORE:mockKv(),LEAGUE_PUBLISH_TOKEN:"private-token"};
  const response=await worker.fetch(new Request("https://worker.example/api/league"),env);
  assert.equal(response.status,404);
});

test("POST /api/league rechaza snapshots incompletos",async()=>{
  const env={LEAGUE_STORE:mockKv(),LEAGUE_PUBLISH_TOKEN:"private-token"};
  const response=await worker.fetch(new Request("https://worker.example/api/league",{
    method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer private-token"},body:JSON.stringify({version:1})
  }),env);
  assert.equal(response.status,400);
});

test("POST /api/league/refresh agrega solo juegos verificados y sus estadísticas",async t=>{
  const kv=mockKv();
  const env={LEAGUE_STORE:kv,LEAGUE_PUBLISH_TOKEN:"private-token"};
  const current=snapshot();
  current.publishedAt="2026-08-26T12:00:00.000Z";
  await kv.put("public-league-v1",JSON.stringify(current));
  const incoming=structuredClone(current);
  incoming.games.push({
    id:"2",uuid:"verified-uuid",dedupKey:"uuid:verified-uuid",date:"08/27/2026 02:00:00",
    homeUser:"commissioner",awayUser:"friend",homeTeam:"Tigers",awayTeam:"Blue Jays",
    homePlayerId:"10",awayPlayerId:"20",apiRecords:[{id:"2",username:"commissioner",platform:"psn"}]
  });
  const payload={game:[
    ["line_score",{game_mode:"LEAGUE",game_uuid:"verified-uuid",created_at:"08/27/2026 02:00:00",innings:"5",ruling:"0",home_runs:"3",away_runs:"1",home_display_result:"W",away_display_result:"L",home_player_id:"10",away_player_id:"20",home_mlb_team_id:"7",away_mlb_team_id:"14",home_full_name:"Tigers",away_full_name:"Blue Jays"}],
    ["box_score",[{team_id:"7",team_name:"Tigers","7":{batting_stats:[],pitching_stats:[{player_name:"Closer (S)",p_idx:"1",ip:"1.0",h:"0",r:"0",er:"0",bb:"0",so:"2",win:"0",loss:"0",save:"1",b_save:"0",hold:"0"}]}}]]
  ]};
  t.mock.method(globalThis,"fetch",async()=>new Response(JSON.stringify(payload),{status:200,headers:{"Content-Type":"application/json"}}));
  const response=await worker.fetch(new Request("https://worker.example/api/league/refresh",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(incoming)}),env);
  assert.equal(response.status,200);
  const saved=await response.json();
  assert.equal(saved.refresh.added,1);
  assert.equal(saved.games.length,2);
  assert.equal(saved.stats.pitching[0][1].sv,1);
});

test("POST /api/league/refresh rechaza una base desactualizada",async()=>{
  const kv=mockKv();
  const env={LEAGUE_STORE:kv};
  const current=snapshot();current.publishedAt="new";
  await kv.put("public-league-v1",JSON.stringify(current));
  const incoming=snapshot();incoming.publishedAt="old";
  const response=await worker.fetch(new Request("https://worker.example/api/league/refresh",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(incoming)}),env);
  assert.equal(response.status,409);
});

test("POST /api/league/refresh no duplica un UUID existente con otra clave",async()=>{
  const kv=mockKv();const env={LEAGUE_STORE:kv};
  const current=snapshot();current.games[0].uuid="one";current.publishedAt="same";
  await kv.put("public-league-v1",JSON.stringify(current));
  const incoming=structuredClone(current);
  incoming.games.push({...current.games[0],id:"99",dedupKey:"fingerprint:alterado",apiRecords:[{id:"99",username:"commissioner"}]});
  const response=await worker.fetch(new Request("https://worker.example/api/league/refresh",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(incoming)}),env);
  const body=await response.json();
  assert.equal(response.status,200);assert.equal(body.refresh.added,0);assert.equal(body.games.length,1);
});

test("una liga finalizada rechaza actualizaciones públicas",async()=>{
  const kv=mockKv();const env={LEAGUE_STORE:kv};
  const current=snapshot();current.config.finalizedAt="2026-08-30T12:00:00.000Z";
  await kv.put("public-league-v1",JSON.stringify(current));
  const response=await worker.fetch(new Request("https://worker.example/api/league/refresh",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(current)}),env);
  assert.equal(response.status,409);assert.equal((await response.json()).error,"League is finalized");
});

test("publica los lideratos archivados con límites seguros",async()=>{
  const kv=mockKv();const env={LEAGUE_STORE:kv,LEAGUE_PUBLISH_TOKEN:"private-token"};
  const data=snapshot();data.config.finalizedAt="2026-08-30T12:00:00.000Z";
  data.config.champions[0].awards=[{key:"hr",label:"HR",title:"Jonrones",winners:[{player:"Slugger",manager:"friend",team:"Blue Jays",value:"5"}]}];
  await worker.fetch(new Request("https://worker.example/api/league",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer private-token"},body:JSON.stringify(data)}),env);
  const saved=await (await worker.fetch(new Request("https://worker.example/api/league"),env)).json();
  assert.equal(saved.config.finalizedAt,data.config.finalizedAt);assert.equal(saved.config.champions[0].awards[0].winners[0].player,"Slugger");
});
