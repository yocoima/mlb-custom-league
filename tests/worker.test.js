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
    config:{username:"commissioner",platform:"psn",myTeam:"Tigers",startDate:"2026-08-15",regulationInnings:5,maxPages:40,proxyBase:"https://worker.example",roster:{commissioner:"Tigers",friend:"Blue Jays"},champions:[{season:"Torneo 2025",champion:"friend",team:"Blue Jays",runnerUp:"commissioner",result:"4-2"}]},
    participants:[{username:"commissioner",team:"Tigers"},{username:"friend",team:"Blue Jays"}],
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
  assert.deepEqual(saved.config.champions,[{season:"Torneo 2025",champion:"friend",team:"Blue Jays",runnerUp:"commissioner",result:"4-2",note:""}]);
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
