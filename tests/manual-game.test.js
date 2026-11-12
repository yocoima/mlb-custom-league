import test from "node:test";
import assert from "node:assert/strict";
import {confirmHistoryGame,shareGameRecord,gameClaimKeys} from "../src/manual-game.js";
const source={id:"2",homeUser:"yermain10",awayUser:"YOCOIMA_HERRERA",homeTeam:"Cubs",awayTeam:"Pirates",homeScore:4,awayScore:7,date:"11/12/2026 15:59:47"};
const row={game_mode:"LEAGUE",home_name:"yermain10",away_name:"yocoima_herrera",home_full_name:"Cubs",away_full_name:"Pirates",home_runs:"4",away_runs:"7",home_display_result:"L",away_display_result:"W",display_date:source.date};
test("manual result needs matching official histories and never invents a UUID",()=>{
  const game=confirmHistoryGame(source,[{username:"yermain10",rows:[{...row,id:"2"}]},{username:"YOCOIMA_HERRERA",rows:[{...row,id:"1"}]}]);
  assert.equal(game.pendingGameLog,true);assert.equal(game.uuid,null);assert.equal(game.homeScore,4);assert.equal(game.awayScore,7);
  assert.equal(game.apiRecords.length,2);assert.match(game.dedupKey,/history:/);
  assert.equal(shareGameRecord(game,{id:"1",sourceUser:"yocoima_herrera"}),true);
  assert.ok(gameClaimKeys(game).includes('record:yocoima_herrera:1'));
});
test("manual history fallback rejects a missing opponent record, altered scores, dates or modes",()=>{
  const home={username:"yermain10",rows:[{...row,id:"2"}]};
  assert.throws(()=>confirmHistoryGame(source,[home]));
  for(const patch of [{away_runs:"8"},{game_mode:"ARENA"},{display_date:"11/11/2026 15:59:47"},{away_full_name:"Rays"},{home_display_result:""}]){
    assert.throws(()=>confirmHistoryGame(source,[home,{username:"YOCOIMA_HERRERA",rows:[{...row,...patch,id:"1"}]}]));
  }
});

test("a corrected API timestamp is accepted only through stable record IDs and agreement between histories",()=>{
  const changed={...row,display_date:"11/12/2026 16:53:17"},known={...source,sourceUser:"yermain10"};
  const game=confirmHistoryGame(known,[{username:"yermain10",rows:[{...changed,id:"2"}]},{username:"YOCOIMA_HERRERA",rows:[{...changed,id:"1"}]}]);
  assert.equal(game.date,changed.display_date);
  assert.throws(()=>confirmHistoryGame(known,[{username:"yermain10",rows:[{...changed,id:"3"}]},{username:"YOCOIMA_HERRERA",rows:[{...changed,id:"1"}]}]));
});
