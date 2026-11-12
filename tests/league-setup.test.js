import test from "node:test";
import assert from "node:assert/strict";
import {rowsToRoster,rosterToRows} from "../src/roster-editor.js";
import {buildLeagueConfig} from "../src/league-setup.js";
import {parseRosterWords} from "../src/roster-import.js";

const rows=[{username:"yocoima_herrera",team:"Pirates"},{username:"Petare11",team:"Padres"}];
const inputs={name:"Enchufados",startDate:"2026-11-12",regulationInnings:9,rows,commissioner:"YOCOIMA_HERRERA",format:{gamesPerOpponent:1,qualifierCount:2,postseasonBestOf:3,finalBestOf:3}};
test("new league config derives the commissioner's team from reviewed rows",()=>{
  const config=buildLeagueConfig(inputs);
  assert.equal(config.username,"yocoima_herrera");assert.equal(config.myTeam,"Pirates");
  assert.equal(config.roster.Petare11,"Padres");assert.equal(config.platform,"psn");
});
test("creation rejects missing rows, duplicate names, invalid dates and commissioner outside roster",()=>{
  for(const patch of [{rows:[]},{commissioner:"unknown"},{startDate:"2026-02-30"},{regulationInnings:10},{format:{...inputs.format,qualifierCount:4}},{rows:[...rows,{username:"PETARE11",team:"Tigers"}]},{rows:[rows[0],{username:"bad username",team:"Tigers"}]},{rows:[rows[0],{username:"friend",team:""}]}])assert.throws(()=>buildLeagueConfig({...inputs,...patch}));
});
test("editing a roster preserves aliases and allows participants with the same MLB team",()=>{
  const original={home:{username:"home",team:"Dodgers",aliases:["old_home"]},away:"Dodgers"};
  const edited=rosterToRows(original);edited[0].team="Pirates";
  assert.deepEqual(rowsToRoster(edited).home.aliases,["old_home"]);
  assert.equal(original.home.team,"Dodgers");assert.equal(rowsToRoster(rosterToRows({home:"Dodgers",away:"Dodgers"})).away,"Dodgers");
});

function word(text,x,y,width=text.length*10,height=20){return {text,confidence:95,bbox:{x0:x,y0:y,x1:x+width,y1:y+height}};}
test("photo parser associates each card username with its own team and includes the account's header team",()=>{
  const cards=[['Yankees','Angelotti0611'],['Tigers','HamudiMajzoub'],['Nationals','Johan_kabra'],['Cubs','yermain10'],['Brewers','Gaboandres20'],['Diamondbacks','tributo-cano'],['Rockies','LeyP9'],['Padres','Petare11']];
  const words=[word('YOCOIMA_HERRERA',120,45),word('Pirates',80,320),word('Flexible',170,320),word('Schedule',260,320)];
  cards.forEach(([team,user],i)=>{const x=25+(i%6)*255,y=i<6?375:475;words.push(word(team,x,y),word(user,x,y+25),word('Games',x,y+52),word('Left:',x+64,y+52),word('OFFLINE',x+140,y+52));});
  const result=parseRosterWords(words,1536,598);
  assert.equal(result.rows.length,9);assert.equal(result.suggestedCommissioner,'YOCOIMA_HERRERA');
  assert.equal(result.rows.find(row=>row.username==='YOCOIMA_HERRERA').team,'Pirates');
  for(const [team,user] of cards)assert.equal(result.rows.find(row=>row.username===user)?.team,team);
  assert.deepEqual(result.unread,[]);
});
test("photo parser never treats online status or game counts as a missing username",()=>{
  const words=[word('Cubs',30,380),word('Games',30,405),word('Left:',100,405),word('OFFLINE',30,430)];
  const result=parseRosterWords(words,1000,600);
  assert.deepEqual(result.rows,[]);assert.deepEqual(result.unread,['Cubs']);assert.equal(result.suggestedCommissioner,'');
});
