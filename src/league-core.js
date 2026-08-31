export const PLATFORM_VALUES = ["psn", "xbl", "mlbts", "nsw"];

export function cleanDisplayName(value) {
  return String(value ?? "")
    .replace(/\^[a-z]\d+\^/gi, "")
    .replace(/\^[a-z]\^/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isCpuName(value) {
  const v = cleanDisplayName(value).toLowerCase();
  return !v || v === "cpu";
}

export function sameText(a, b) {
  return cleanDisplayName(a).localeCompare(cleanDisplayName(b), undefined, { sensitivity: "accent" }) === 0;
}

export function toNumber(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function parseShowDate(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (match) {
    const [, mm, dd, yyyy, hh, mi, ss] = match;
    return new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(mi), Number(ss));
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function showDateKey(value) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (match) {
    const [, mm, dd, yyyy] = match;
    return `${yyyy}-${mm}-${dd}`;
  }
  const date = parseShowDate(raw);
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function isOnOrAfterStartDate(value, startDate) {
  if (!startDate) return true;
  const key = showDateKey(value);
  return Boolean(key && key >= String(startDate));
}

export function isLeagueRow(row) {
  return String(row?.game_mode ?? "").toUpperCase() === "LEAGUE";
}

export function historyRows(payload) {
  if (Array.isArray(payload?.game_history)) return payload.game_history;
  if (Array.isArray(payload?.games)) return payload.games;
  if (Array.isArray(payload)) return payload;
  return [];
}

function inferQuerySide({ homeRaw, awayRaw, homeTeam, awayTeam, queryUser, queryTeam }) {
  const home = cleanDisplayName(homeRaw);
  const away = cleanDisplayName(awayRaw);
  if (queryUser && sameText(home, queryUser)) return "home";
  if (queryUser && sameText(away, queryUser)) return "away";
  if (isCpuName(home) && !isCpuName(away)) return "home";
  if (isCpuName(away) && !isCpuName(home)) return "away";
  if (queryTeam && sameText(homeTeam, queryTeam) && !sameText(awayTeam, queryTeam)) return "home";
  if (queryTeam && sameText(awayTeam, queryTeam) && !sameText(homeTeam, queryTeam)) return "away";
  return null;
}

export function normalizeHistoryGame(row, context = {}) {
  const queryUser = cleanDisplayName(context.queryUser);
  const queryTeam = cleanDisplayName(context.queryTeam);
  const homeRaw = cleanDisplayName(row?.home_name);
  const awayRaw = cleanDisplayName(row?.away_name);
  const homeTeam = cleanDisplayName(row?.home_full_name ?? row?.home_team ?? row?.homeTeam ?? "Home");
  const awayTeam = cleanDisplayName(row?.away_full_name ?? row?.away_team ?? row?.awayTeam ?? "Away");
  const querySide = inferQuerySide({ homeRaw, awayRaw, homeTeam, awayTeam, queryUser, queryTeam });

  let homeUser = homeRaw;
  let awayUser = awayRaw;
  if (querySide === "home") homeUser = queryUser || homeRaw || "CPU";
  if (querySide === "away") awayUser = queryUser || awayRaw || "CPU";

  const id = String(row?.id ?? row?.game_id ?? row?.gameId ?? "");
  const date = row?.display_date ?? row?.created_at ?? row?.date ?? null;
  return {
    id,
    gameMode: String(row?.game_mode ?? "").toUpperCase(),
    date,
    dateValue: parseShowDate(date),
    homeTeam,
    awayTeam,
    homeUser,
    awayUser,
    homeUserRaw: homeRaw,
    awayUserRaw: awayRaw,
    querySide,
    homeScore: toNumber(row?.home_runs ?? row?.home_score ?? row?.homeScore),
    awayScore: toNumber(row?.away_runs ?? row?.away_score ?? row?.awayScore),
    homeResult: cleanDisplayName(row?.home_display_result ?? row?.homeResult).toUpperCase(),
    awayResult: cleanDisplayName(row?.away_display_result ?? row?.awayResult).toUpperCase(),
    ruling: cleanDisplayName(row?.ruling),
    homeHits: toNumber(row?.home_hits),
    awayHits: toNumber(row?.away_hits),
    homeErrors: toNumber(row?.home_errors),
    awayErrors: toNumber(row?.away_errors),
    pitcherInfo: cleanDisplayName(row?.display_pitcher_info),
    raw: row
  };
}

export function gameFingerprint(game) {
  const value = part => cleanDisplayName(part).toLowerCase();
  return [
    showDateKey(game?.date),
    String(game?.date ?? ""),
    value(game?.awayUser),
    value(game?.awayTeam),
    String(game?.awayScore ?? ""),
    value(game?.homeUser),
    value(game?.homeTeam),
    String(game?.homeScore ?? "")
  ].join("|");
}

export function queryParticipantSide(game, queryUser, queryTeam) {
  if (game.querySide) return game.querySide;
  if (queryUser && sameText(game.homeUser, queryUser)) return "home";
  if (queryUser && sameText(game.awayUser, queryUser)) return "away";
  if (queryTeam && sameText(game.homeTeam, queryTeam)) return "home";
  if (queryTeam && sameText(game.awayTeam, queryTeam)) return "away";
  return null;
}

export function opponentFromGame(game, queryUser, queryTeam) {
  const side = queryParticipantSide(game, queryUser, queryTeam);
  if (side === "home") {
    return { user: cleanDisplayName(game.awayUser), team: cleanDisplayName(game.awayTeam), side: "away" };
  }
  if (side === "away") {
    return { user: cleanDisplayName(game.homeUser), team: cleanDisplayName(game.homeTeam), side: "home" };
  }
  return null;
}

export function participantTeamFromGame(game, queryUser, queryTeam) {
  const side = queryParticipantSide(game, queryUser, queryTeam);
  if (side === "home") return game.homeTeam;
  if (side === "away") return game.awayTeam;
  return "";
}

export function calculateStandings(games, participants = []) {
  const table = new Map();
  const ensure = (user, team) => {
    const displayUser = cleanDisplayName(user) || cleanDisplayName(team) || "Unknown";
    const key = displayUser.toLowerCase();
    if (!table.has(key)) {
      table.set(key, { user: displayUser, team: cleanDisplayName(team), gp: 0, homeGp: 0, awayGp: 0, w: 0, l: 0, rf: 0, ra: 0, form: [] });
    } else if (!table.get(key).team && team) {
      table.get(key).team = cleanDisplayName(team);
    }
    return table.get(key);
  };

  for (const participant of participants) {
    ensure(participant?.username ?? participant?.user, participant?.team);
  }

  const sorted = [...games].sort((a, b) => (a.dateValue?.getTime?.() ?? 0) - (b.dateValue?.getTime?.() ?? 0));
  for (const game of sorted) {
    if (game.homeScore == null || game.awayScore == null) continue;
    const home = ensure(game.homeUser, game.homeTeam);
    const away = ensure(game.awayUser, game.awayTeam);
    home.gp++; away.gp++;
    home.homeGp++; away.awayGp++;
    home.rf += game.homeScore; home.ra += game.awayScore;
    away.rf += game.awayScore; away.ra += game.homeScore;
    const homeWon = game.homeResult === "W" || game.awayResult === "L";
    const awayWon = game.awayResult === "W" || game.homeResult === "L";
    if (homeWon || (!awayWon && game.homeScore > game.awayScore)) {
      home.w++; away.l++; home.form.push("W"); away.form.push("L");
    } else if (awayWon || game.awayScore > game.homeScore) {
      away.w++; home.l++; away.form.push("W"); home.form.push("L");
    }
  }

  return [...table.values()].map(row => ({
    ...row,
    pct: row.gp ? row.w / row.gp : 0,
    diff: row.rf - row.ra,
    form: row.form.slice(-5)
  })).sort((a, b) => b.pct - a.pct || b.diff - a.diff || b.rf - a.rf || a.user.localeCompare(b.user));
}

export function gameParts(payload) {
  const parts = Array.isArray(payload?.game) ? payload.game : [];
  const map = new Map(parts.filter(x => Array.isArray(x) && x.length >= 2));
  return {
    lineScore: map.get("line_score") ?? null,
    gameLog: map.get("game_log") ?? "",
    boxScore: map.get("box_score") ?? []
  };
}

export function scoreThroughInning(lineScore, side, inning) {
  let runs = 0;
  for (let current = 1; current <= inning; current++) {
    runs += toNumber(lineScore?.[`${side}_runs_${current}`], 0) ?? 0;
  }
  return runs;
}

export function isCompatibleWithRegulationInnings(lineScore, regulationInnings) {
  const regulation = Math.max(1, Math.trunc(toNumber(regulationInnings, 0) ?? 0));
  const played = Math.max(0, Math.trunc(toNumber(lineScore?.innings, 0) ?? 0));
  if (!regulation || !played) return false;
  if (played <= regulation) return true;
  const homeAtRegulation = scoreThroughInning(lineScore, "home", regulation);
  const awayAtRegulation = scoreThroughInning(lineScore, "away", regulation);
  return homeAtRegulation === awayAtRegulation;
}

export function isFormallyCompletedGame(lineScore) {
  if (!lineScore) return false;
  const ruling = Math.trunc(toNumber(lineScore.ruling, 0) ?? 0);
  if (ruling !== 0) return false;

  const homeResult = cleanDisplayName(lineScore.home_display_result).toUpperCase();
  const awayResult = cleanDisplayName(lineScore.away_display_result).toUpperCase();
  const hasWinnerAndLoser =
    (homeResult === "W" && awayResult === "L") ||
    (homeResult === "L" && awayResult === "W");
  const homeRuns = toNumber(lineScore.home_runs);
  const awayRuns = toNumber(lineScore.away_runs);
  return hasWinnerAndLoser && homeRuns !== null && awayRuns !== null && homeRuns !== awayRuns;
}

export function baseballIpToOuts(value) {
  if (value === null || value === undefined || value === "") return 0;
  const text = String(value).trim();
  const m = text.match(/^(\d+)(?:\.(\d))?$/);
  if (!m) return 0;
  const innings = Number(m[1]);
  const partial = Number(m[2] ?? 0);
  return innings * 3 + (partial === 1 || partial === 2 ? partial : 0);
}

export function outsToBaseballIp(outs) {
  const total = Math.max(0, Math.trunc(outs || 0));
  return `${Math.floor(total / 3)}.${total % 3}`;
}

function stripPitcherDecision(name) {
  return cleanDisplayName(name).replace(/\s*\([^)]*\)\s*$/, "").trim();
}

function canonicalStatPlayerName(name, type) {
  const cleaned = type === "pit" ? stripPitcherDecision(name) : cleanDisplayName(name);
  return cleaned
    .replace(/^\d+-\s*/, "")
    .replace(/,\s*(?:P|C|1B|2B|3B|SS|LF|CF|RF|DH|PH|PR)(?:-(?:P|C|1B|2B|3B|SS|LF|CF|RF|DH|PH|PR))*\s*$/i, "")
    .trim()
    .toLowerCase();
}

function stablePlayerKey(manager, row, type) {
  const idx = cleanDisplayName(type === "bat" ? row?.p_inx : row?.p_idx);
  const name = canonicalStatPlayerName(row?.player_name, type);
  return `${cleanDisplayName(manager).toLowerCase()}|${type}|${name || idx}`;
}

export function createStatAccumulator() {
  return { batting: new Map(), pitching: new Map(), loadedGameIds: new Set(), failedGameIds: new Set() };
}

export function addGameStats(acc, game, payload) {
  const { boxScore } = gameParts(payload);
  if (!Array.isArray(boxScore) || !boxScore.length) {
    acc.failedGameIds.add(game.id);
    return;
  }

  const managerForTeam = teamName => {
    if (sameText(teamName, game.homeTeam)) return game.homeUser;
    if (sameText(teamName, game.awayTeam)) return game.awayUser;
    return teamName;
  };

  for (const teamBox of boxScore) {
    const teamId = String(teamBox?.team_id ?? "");
    const teamName = cleanDisplayName(teamBox?.team_name ?? "");
    const data = teamBox?.[teamId];
    if (!data) continue;
    const manager = managerForTeam(teamName);

    for (const row of data?.batting_stats ?? []) {
      const key = stablePlayerKey(manager, row, "bat");
      if (!acc.batting.has(key)) {
        acc.batting.set(key, {
          manager, team: teamName, name: cleanDisplayName(row.player_name), g: 0,
          ab: 0, r: 0, h: 0, rbi: 0, bb: 0, so: 0, doubles: 0, triples: 0, hr: 0,
          hbp: 0, sf: 0, sb: 0, cs: 0
        });
      }
      const p = acc.batting.get(key);
      p.g++;
      for (const field of ["ab","r","h","rbi","bb","so","doubles","triples","hr","hbp","sf","sb","cs"]) {
        p[field] += toNumber(row?.[field], 0) ?? 0;
      }
    }

    for (const row of data?.pitching_stats ?? []) {
      const key = stablePlayerKey(manager, row, "pit");
      if (!acc.pitching.has(key)) {
        acc.pitching.set(key, {
          manager, team: teamName, name: stripPitcherDecision(row.player_name), g: 0, outs: 0,
          h: 0, r: 0, er: 0, bb: 0, so: 0, w: 0, l: 0, sv: 0, bs: 0, hold: 0
        });
      }
      const p = acc.pitching.get(key);
      p.g++;
      p.outs += baseballIpToOuts(row?.ip);
      p.h += toNumber(row?.h, 0) ?? 0;
      p.r += toNumber(row?.r, 0) ?? 0;
      p.er += toNumber(row?.er, 0) ?? 0;
      p.bb += toNumber(row?.bb, 0) ?? 0;
      p.so += toNumber(row?.so, 0) ?? 0;
      p.w += toNumber(row?.win, 0) ?? 0;
      p.l += toNumber(row?.loss, 0) ?? 0;
      p.sv += toNumber(row?.save, 0) ?? 0;
      p.bs += toNumber(row?.b_save, 0) ?? 0;
      p.hold += toNumber(row?.hold, 0) ?? 0;
    }
  }

  acc.loadedGameIds.add(game.id);
}

const RATE_PA_PER_GAME = 3.1;
const RATE_IP_PER_GAME = 1.0;

function managerGames(games, manager) {
  if (!Array.isArray(games) || !games.length) return 0;
  return games.filter(game => sameText(game.homeUser, manager) || sameText(game.awayUser, manager)).length;
}

export function battingQualifies(player, { games = [], regulationInnings = 9 } = {}) {
  const teamGames = managerGames(games, player.manager) || player.g;
  const requiredPa = Math.ceil(teamGames * RATE_PA_PER_GAME * (regulationInnings / 9) - 1e-9);
  return teamGames > 0 && player.pa >= requiredPa;
}

export function pitchingQualifies(player, { games = [], regulationInnings = 9 } = {}) {
  const teamGames = managerGames(games, player.manager) || player.g;
  const requiredOuts = Math.ceil(teamGames * RATE_IP_PER_GAME * (regulationInnings / 9) * 3 - 1e-9);
  return teamGames > 0 && player.outs >= requiredOuts;
}

export function battingLeaders(acc, sortBy = "avg") {
  const players = [...acc.batting.values()].map(p => {
    const pa = p.ab + p.bb + p.hbp + p.sf;
    const avg = p.ab ? p.h / p.ab : 0;
    const obp = pa ? (p.h + p.bb + p.hbp) / pa : 0;
    const tb = (p.h - p.doubles - p.triples - p.hr) + 2*p.doubles + 3*p.triples + 4*p.hr;
    const slg = p.ab ? tb / p.ab : 0;
    return { ...p, pa, avg, obp, slg, ops: obp + slg };
  });
  const comparisons = {
    avg: (a, b) => b.avg - a.avg || b.h - a.h || b.ab - a.ab,
    hr: (a, b) => b.hr - a.hr || b.rbi - a.rbi || b.h - a.h,
    h: (a, b) => b.h - a.h || b.avg - a.avg || b.hr - a.hr,
    rbi: (a, b) => b.rbi - a.rbi || b.hr - a.hr || b.h - a.h,
    sb: (a, b) => b.sb - a.sb || a.cs - b.cs || b.h - a.h,
    ops: (a, b) => b.ops - a.ops || b.h - a.h || b.hr - a.hr
  };
  const compare = comparisons[sortBy] ?? comparisons.avg;
  return players.sort((a, b) => compare(a, b) || a.name.localeCompare(b.name));
}

export function pitchingLeaders(acc, sortBy = "so") {
  const pitchers = [...acc.pitching.values()].map(p => {
    const innings = p.outs / 3;
    return {
      ...p,
      ip: outsToBaseballIp(p.outs),
      era: innings ? (p.er * 9) / innings : 0,
      whip: innings ? (p.bb + p.h) / innings : 0,
      k9: innings ? (p.so * 9) / innings : 0
    };
  });
  const comparisons = {
    so: (a, b) => b.so - a.so || b.k9 - a.k9 || b.outs - a.outs,
    era: (a, b) => a.era - b.era || b.outs - a.outs || b.so - a.so,
    k9: (a, b) => b.k9 - a.k9 || b.so - a.so || b.outs - a.outs,
    w: (a, b) => b.w - a.w || a.era - b.era || b.so - a.so,
    sv: (a, b) => b.sv - a.sv || a.era - b.era || b.so - a.so
  };
  const compare = comparisons[sortBy] ?? comparisons.so;
  return pitchers.sort((a, b) => compare(a, b) || a.name.localeCompare(b.name));
}

function searchableText(value) {
  return cleanDisplayName(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function filterStatLeaders(players, { query = "", manager = "", team = "" } = {}) {
  const needle = searchableText(query);
  return players.filter(player =>
    (!needle || [player.name, player.manager, player.team].some(value => searchableText(value).includes(needle))) &&
    (!manager || sameText(player.manager, manager)) &&
    (!team || sameText(player.team, team))
  );
}

export function tournamentAwards(acc, qualification = {}) {
  const batting = category => battingLeaders(acc, category);
  const pitching = category => pitchingLeaders(acc, category);
  const definitions = [
    { key:"avg", label:"AVG", title:"Promedio", rows:batting("avg").filter(player=>battingQualifies(player,qualification)), metric:player=>player.avg, value:player=>player.avg.toFixed(3).replace(/^0/,"") },
    { key:"hr", label:"HR", title:"Jonrones", rows:batting("hr"), metric:player=>player.hr, value:player=>String(player.hr), positive:true },
    { key:"h", label:"H", title:"Hits", rows:batting("h"), metric:player=>player.h, value:player=>String(player.h), positive:true },
    { key:"rbi", label:"RBI", title:"Impulsadas", rows:batting("rbi"), metric:player=>player.rbi, value:player=>String(player.rbi), positive:true },
    { key:"sb", label:"SB", title:"Bases robadas", rows:batting("sb"), metric:player=>player.sb, value:player=>String(player.sb), positive:true },
    { key:"so", label:"SO", title:"Ponches", rows:pitching("so"), metric:player=>player.so, value:player=>String(player.so), positive:true },
    { key:"era", label:"ERA", title:"Efectividad", rows:pitching("era").filter(player=>pitchingQualifies(player,qualification)), metric:player=>player.era, value:player=>player.era.toFixed(2) },
    { key:"sv", label:"SV", title:"Salvados", rows:pitching("sv"), metric:player=>player.sv, value:player=>String(player.sv), positive:true }
  ];
  return definitions.flatMap(definition=>{
    const leader=definition.rows[0];
    if(!leader||(definition.positive&&definition.metric(leader)<=0))return [];
    const winningValue=definition.metric(leader);
    const winners=definition.rows.filter(player=>Math.abs(definition.metric(player)-winningValue)<1e-9).slice(0,20).map(player=>({
      player:player.name,manager:player.manager,team:player.team,value:definition.value(player)
    }));
    return [{key:definition.key,label:definition.label,title:definition.title,winners}];
  });
}
