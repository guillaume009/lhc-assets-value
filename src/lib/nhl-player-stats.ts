import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  DashboardSourceMode,
  NormalizedDashboardInput,
  Player,
  RealSeasonHistoryEntry,
  RealSeasonStats,
  RealSeasonStatsLine,
} from "@/lib/domain";

const NHL_SEARCH_ENDPOINT = "https://search.d3.nhle.com/api/v1/search/player";
const NHL_PLAYER_LANDING_ENDPOINT = "https://api-web.nhle.com/v1/player";
const DEFAULT_CACHE_PATH = path.join(process.cwd(), "data", "nhl-player-stats.json");
const DEFAULT_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
// Activity-aware refresh intervals. Players who are clearly not part of the
// current NHL season's player pool (zero games played, or last NHL season was
// years ago) don't need to be re-fetched daily — their stats won't change.
const INACTIVE_THIS_SEASON_REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const LONG_INACTIVE_REFRESH_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;
// not-found previously retried every 15 minutes which generated huge volumes
// of pointless search-endpoint traffic for non-NHL players (juniors, AHLers,
// retirees). Back off aggressively, especially after repeated misses.
const NOT_FOUND_REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const NOT_FOUND_LONG_REFRESH_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;
const NOT_FOUND_LONG_THRESHOLD = 3;
// Lower concurrency reduces 429s and ends up being faster in practice than
// blasting 10 parallel requests and burning exponential backoff.
const REQUEST_CONCURRENCY = 4;
// Small jitter applied per request to avoid synchronised bursts when workers
// happen to align after a global rate-limit pause.
const REQUEST_JITTER_MIN_MS = 40;
const REQUEST_JITTER_MAX_MS = 140;
const INCREMENTAL_WRITE_INTERVAL_MS = 2_500;

let pendingAutoRefresh: Promise<RefreshStatsResult> | null = null;

export type NhlPlayerStatsRefreshProgress = {
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  total: number;
  processed: number;
  matched: number;
  notFound: number;
  failed: number;
  inFlight: boolean;
  trigger: "auto-background" | "auto-foreground" | "manual";
  lastError: string | null;
};

let currentRefreshProgress: NhlPlayerStatsRefreshProgress | null = null;

export const getNhlPlayerStatsRefreshProgress = (): NhlPlayerStatsRefreshProgress | null =>
  currentRefreshProgress ? { ...currentRefreshProgress } : null;

type SearchEntry = {
  playerId?: string;
  name?: string;
};

type SearchResponse = SearchEntry[] | { value?: SearchEntry[] };

type CachedStatsEntry = {
  playerId: string;
  playerName: string;
  normalizedName: string;
  refreshedAt: string;
  status: "matched" | "not-found";
  nhlPlayerId?: number;
  stats?: RealSeasonStats;
  // Number of consecutive resolutions that returned not-found. Used to
  // exponentially back off search-endpoint traffic for players that clearly
  // aren't in the NHL (juniors, AHLers, retirees).
  consecutiveNotFound?: number;
  // Games the player has logged in the current NHL season (per the most
  // recent featuredStats payload). 0 means "on a roster but hasn't played";
  // undefined means we don't know yet.
  currentSeasonGamesPlayed?: number;
  // Most recent NHL season the player has recorded stats in. Used to
  // identify players who haven't played in years and only need rare refreshes.
  lastActiveNhlSeasonId?: number;
};

type StatsCacheFile = {
  importedAt: string;
  refreshIntervalMs: number;
  entries: Record<string, CachedStatsEntry>;
};

type RefreshStatsResult = {
  input: NormalizedDashboardInput;
  cachePath: string;
  refreshedPlayerCount: number;
  matchedPlayerCount: number;
  rosterCount: number;
  leagueTargetCount: number;
  force: boolean;
  refreshed: boolean;
};

export type NhlPlayerStatsCacheSummary = {
  cachePath: string;
  importedAt: string;
  refreshIntervalHours: number;
  entryCount: number;
  matchedCount: number;
  notFoundCount: number;
  staleCount: number;
  trackedPlayerCount: number | null;
  missingTrackedEntryCount: number | null;
  staleTrackedEntryCount: number | null;
};

type SkaterSeasonSummary = {
  gamesPlayed?: number;
  pim?: number;
  goals?: number;
  assists?: number;
  points?: number;
  plusMinus?: number;
  powerPlayPoints?: number;
  shots?: number;
  shootingPctg?: number;
};

type GoalieSeasonSummary = {
  gamesPlayed?: number;
  pim?: number;
  wins?: number;
  savePctg?: number;
  goalsAgainstAvg?: number;
  shutouts?: number;
};

type LandingSeasonTotal = {
  season?: number;
  gameTypeId?: number;
  leagueAbbrev?: string;
  teamName?: string | { default?: string };
  gamesPlayed?: number;
  pim?: number;
  goals?: number;
  assists?: number;
  points?: number;
  plusMinus?: number;
  powerPlayPoints?: number;
  shots?: number;
  shootingPctg?: number;
  wins?: number;
  savePctg?: number;
  goalsAgainstAvg?: number;
  shutouts?: number;
};

type PlayerLandingResponse = {
  playerId?: number;
  featuredStats?: {
    season?: number;
    regularSeason?: {
      subSeason?: SkaterSeasonSummary | GoalieSeasonSummary;
    };
  };
  seasonTotals?: LandingSeasonTotal[];
  position?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isGoalieSeasonSummary = (value: unknown): value is GoalieSeasonSummary =>
  isRecord(value) && ("savePctg" in value || "goalsAgainstAvg" in value || "wins" in value || "shutouts" in value);

const isSkaterSeasonSummary = (value: unknown): value is SkaterSeasonSummary =>
  isRecord(value) && ("points" in value || "goals" in value || "assists" in value || "shots" in value);

const isLandingSeasonTotal = (
  value: unknown,
): value is LandingSeasonTotal & { season: number; gameTypeId: number; leagueAbbrev: string } =>
  isRecord(value) &&
  typeof value.season === "number" &&
  typeof value.gameTypeId === "number" &&
  typeof value.leagueAbbrev === "string";

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const normalizeName = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const getCachePath = () => process.env.NHL_SIM_NHL_PLAYER_STATS_PATH?.trim() || DEFAULT_CACHE_PATH;

export const getNhlPlayerStatsCachePath = () => getCachePath();

const parseSourceMode = (value: string | undefined): DashboardSourceMode =>
  value === "live-file" ? "live-file" : "demo";

const getConfiguredSourceMode = (): DashboardSourceMode =>
  parseSourceMode(process.env.NHL_SIM_DATA_SOURCE);

const getRefreshIntervalMs = () => {
  const configuredHours = Number(process.env.NHL_SIM_REAL_STATS_REFRESH_HOURS);

  if (!Number.isFinite(configuredHours) || configuredHours <= 0) {
    return DEFAULT_REFRESH_INTERVAL_MS;
  }

  return Math.round(configuredHours * 60 * 60 * 1000);
};

const getSearchEntries = (payload: SearchResponse): SearchEntry[] =>
  Array.isArray(payload) ? payload : payload.value ?? [];

// Common diminutive / nickname swaps so PHO names like "Pat Maroon" or "Matt
// Beniers" can match the NHL roster forms "Patrick Maroon" / "Matty Beniers".
// Mapped both directions and tried as additional candidate first names when
// the literal name doesn't match.
const FIRST_NAME_ALIASES: Record<string, string[]> = {
  pat: ["patrick", "patty"],
  patrick: ["pat", "patty"],
  matt: ["matthew", "matty"],
  matthew: ["matt", "matty"],
  matty: ["matt", "matthew"],
  alex: ["alexander", "alexis", "aleksei", "aleksey", "oleksandr"],
  alexander: ["alex", "sasha"],
  mike: ["michael"],
  michael: ["mike", "mikey"],
  tom: ["thomas", "tommy"],
  thomas: ["tom", "tommy"],
  joe: ["joseph", "joey"],
  joseph: ["joe", "joey"],
  nick: ["nicholas", "nicolas", "nikolas"],
  nicholas: ["nick", "nico"],
  chris: ["christopher", "christian"],
  dan: ["daniel", "danny"],
  daniel: ["dan", "danny"],
  will: ["william", "willy"],
  william: ["will", "billy", "bill"],
  zach: ["zachary"],
  zachary: ["zach"],
  jake: ["jacob"],
  jacob: ["jake"],
  sam: ["samuel"],
  samuel: ["sam"],
  ben: ["benjamin"],
  benjamin: ["ben"],
  ed: ["edward", "eddie"],
  edward: ["ed", "eddie"],
  rob: ["robert", "bobby"],
  robert: ["rob", "bobby", "bob"],
  tony: ["anthony"],
  anthony: ["tony"],
  andy: ["andrew", "drew"],
  andrew: ["andy", "drew"],
  jamie: ["james", "jim"],
  james: ["jamie", "jim", "jimmy"],
  ty: ["tyler"],
  tyler: ["ty"],
  jon: ["jonathan", "jonny", "johnny"],
  jonathan: ["jon", "jonny"],
};

const getFirstNameVariants = (firstName: string): string[] => {
  const base = firstName.toLowerCase();
  const aliases = FIRST_NAME_ALIASES[base] ?? [];
  return [base, ...aliases];
};

const splitName = (normalized: string) => {
  const parts = normalized.split(" ").filter(Boolean);
  if (parts.length === 0) {
    return null;
  }
  return {
    first: parts[0],
    last: parts[parts.length - 1],
    middle: parts.slice(1, -1),
  };
};

const namesMatch = (queryName: string, candidateName: string) => {
  const qNorm = normalizeName(queryName);
  const cNorm = normalizeName(candidateName);

  if (qNorm === cNorm) {
    return { score: 100 } as const;
  }

  const q = splitName(qNorm);
  const c = splitName(cNorm);
  if (!q || !c) {
    return null;
  }

  // Last names must match exactly. Hockey rosters are small enough that any
  // first-name aliasing only helps when the surname is identical.
  if (q.last !== c.last) {
    return null;
  }

  // First-name handling: accept exact match, alias match, or shared first
  // letter when one side is a single initial (e.g. "T.J." \u2192 "t j" vs "TJ"
  // collapsed by NHL to "tj").
  const firstVariants = new Set(getFirstNameVariants(q.first));
  if (firstVariants.has(c.first)) {
    return { score: 90 } as const;
  }
  if (getFirstNameVariants(c.first).some((alias) => firstVariants.has(alias))) {
    return { score: 85 } as const;
  }
  if (c.first.startsWith(q.first) || q.first.startsWith(c.first)) {
    return { score: 70 } as const;
  }
  if (c.first[0] === q.first[0] && (q.first.length === 1 || c.first.length === 1)) {
    return { score: 60 } as const;
  }

  return null;
};

const chooseBestMatch = (name: string, entries: SearchEntry[]) => {
  let best: { entry: SearchEntry; score: number } | null = null;

  for (const entry of entries) {
    const match = namesMatch(name, entry.name ?? "");
    if (!match) {
      continue;
    }
    if (!best || match.score > best.score) {
      best = { entry, score: match.score };
    }
  }

  return best?.entry ?? null;
};

const normalizeToScore = (value: number, min: number, max: number) =>
  clamp(((value - min) / (max - min)) * 100, 0, 100);

const normalizeInverseToScore = (value: number, min: number, max: number) =>
  clamp(100 - normalizeToScore(value, min, max), 0, 100);

const getTeamLabel = (value: LandingSeasonTotal["teamName"]) => {
  if (typeof value === "string") {
    return value.trim();
  }

  if (isRecord(value) && typeof value.default === "string") {
    return value.default.trim();
  }

  return "Unknown Team";
};

const toRealSeasonStatsLine = (summary: LandingSeasonTotal): RealSeasonStatsLine => ({
  gamesPlayed: Math.max(summary.gamesPlayed ?? 0, 0),
  pim: typeof summary.pim === "number" ? summary.pim : undefined,
  goals: typeof summary.goals === "number" ? summary.goals : undefined,
  assists: typeof summary.assists === "number" ? summary.assists : undefined,
  points: typeof summary.points === "number" ? summary.points : undefined,
  plusMinus: typeof summary.plusMinus === "number" ? summary.plusMinus : undefined,
  powerPlayPoints: typeof summary.powerPlayPoints === "number" ? summary.powerPlayPoints : undefined,
  shots: typeof summary.shots === "number" ? summary.shots : undefined,
  shootingPctg: typeof summary.shootingPctg === "number" ? summary.shootingPctg : undefined,
  wins: typeof summary.wins === "number" ? summary.wins : undefined,
  savePctg: typeof summary.savePctg === "number" ? summary.savePctg : undefined,
  goalsAgainstAvg: typeof summary.goalsAgainstAvg === "number" ? summary.goalsAgainstAvg : undefined,
  shutouts: typeof summary.shutouts === "number" ? summary.shutouts : undefined,
});

const parseSeasonHistory = (payload: PlayerLandingResponse): RealSeasonHistoryEntry[] => {
  if (!Array.isArray(payload.seasonTotals)) {
    return [];
  }

  const historyByKey = new Map<string, RealSeasonHistoryEntry>();

  for (const seasonTotal of payload.seasonTotals) {
    if (!isLandingSeasonTotal(seasonTotal) || seasonTotal.leagueAbbrev !== "NHL") {
      continue;
    }

    const seasonId = seasonTotal.season;
    const leagueAbbrev = seasonTotal.leagueAbbrev;
    const teamName = getTeamLabel(seasonTotal.teamName);
    const key = `${seasonId}:${teamName}:${leagueAbbrev}`;
    const existing: RealSeasonHistoryEntry = historyByKey.get(key) ?? {
      seasonId,
      teamName,
      leagueAbbrev,
    };
    const line = toRealSeasonStatsLine(seasonTotal);

    if (seasonTotal.gameTypeId === 2) {
      existing.regularSeason = line;
    }

    if (seasonTotal.gameTypeId === 3) {
      existing.playoffs = line;
    }

    historyByKey.set(key, existing);
  }

  return [...historyByKey.values()].sort(
    (left, right) => right.seasonId - left.seasonId || left.teamName.localeCompare(right.teamName),
  );
};

const computeSkaterValueSignal = (summary: SkaterSeasonSummary) => {
  const gamesPlayed = Math.max(summary.gamesPlayed ?? 0, 0);

  if (gamesPlayed === 0) {
    return 50;
  }

  const pointsPerGame = (summary.points ?? 0) / gamesPlayed;
  const goalsPerGame = (summary.goals ?? 0) / gamesPlayed;
  const shotsPerGame = (summary.shots ?? 0) / gamesPlayed;
  const powerPlayPointsPerGame = (summary.powerPlayPoints ?? 0) / gamesPlayed;
  const plusMinusPerGame = (summary.plusMinus ?? 0) / gamesPlayed;

  return Math.round(
    clamp(
      normalizeToScore(pointsPerGame, 0.2, 1.4) * 0.42 +
        normalizeToScore(goalsPerGame, 0.05, 0.6) * 0.18 +
        normalizeToScore(shotsPerGame, 0.8, 4.5) * 0.15 +
        normalizeToScore(powerPlayPointsPerGame, 0, 0.45) * 0.1 +
        normalizeToScore(plusMinusPerGame, -0.45, 0.45) * 0.15,
      0,
      100,
    ),
  );
};

const computeGoalieValueSignal = (summary: GoalieSeasonSummary) => {
  const gamesPlayed = Math.max(summary.gamesPlayed ?? 0, 0);

  if (gamesPlayed === 0) {
    return 50;
  }

  const winsPerGame = (summary.wins ?? 0) / gamesPlayed;

  return Math.round(
    clamp(
      normalizeToScore(summary.savePctg ?? 0.9, 0.885, 0.925) * 0.5 +
        normalizeInverseToScore(summary.goalsAgainstAvg ?? 2.8, 1.9, 3.6) * 0.3 +
        normalizeToScore(winsPerGame, 0.3, 0.7) * 0.15 +
        normalizeToScore((summary.shutouts ?? 0) / gamesPlayed, 0, 0.12) * 0.05,
      0,
      100,
    ),
  );
};

const parseLandingSummary = (payload: PlayerLandingResponse, position: Player["position"]): RealSeasonStats | null => {
  const seasonId = payload.featuredStats?.season;
  const subSeason = payload.featuredStats?.regularSeason?.subSeason;
  const nhlPlayerId = payload.playerId;
  const seasonHistory = parseSeasonHistory(payload);

  if (!seasonId || !nhlPlayerId || !isRecord(subSeason)) {
    return null;
  }

  if (position === "G" || payload.position === "G") {
    if (!isGoalieSeasonSummary(subSeason)) {
      return null;
    }

    const gamesPlayed = typeof subSeason.gamesPlayed === "number" ? subSeason.gamesPlayed : 0;
    const wins = typeof subSeason.wins === "number" ? subSeason.wins : undefined;
    const savePctg = typeof subSeason.savePctg === "number" ? subSeason.savePctg : undefined;
    const goalsAgainstAvg = typeof subSeason.goalsAgainstAvg === "number" ? subSeason.goalsAgainstAvg : undefined;
    const shutouts = typeof subSeason.shutouts === "number" ? subSeason.shutouts : undefined;

    return {
      source: "nhl",
      refreshedAt: new Date().toISOString(),
      seasonId,
      gamesPlayed,
      nhlPlayerId,
      pim: typeof subSeason.pim === "number" ? subSeason.pim : undefined,
      wins,
      savePctg,
      goalsAgainstAvg,
      shutouts,
      seasonHistory,
      valueSignal: computeGoalieValueSignal({ gamesPlayed, wins, savePctg, goalsAgainstAvg, shutouts }),
    };
  }

  if (!isSkaterSeasonSummary(subSeason)) {
    return null;
  }

  const gamesPlayed = typeof subSeason.gamesPlayed === "number" ? subSeason.gamesPlayed : 0;
  const goals = typeof subSeason.goals === "number" ? subSeason.goals : undefined;
  const assists = typeof subSeason.assists === "number" ? subSeason.assists : undefined;
  const points = typeof subSeason.points === "number" ? subSeason.points : undefined;
  const plusMinus = typeof subSeason.plusMinus === "number" ? subSeason.plusMinus : undefined;
  const powerPlayPoints = typeof subSeason.powerPlayPoints === "number" ? subSeason.powerPlayPoints : undefined;
  const shots = typeof subSeason.shots === "number" ? subSeason.shots : undefined;
  const shootingPctg = typeof subSeason.shootingPctg === "number" ? subSeason.shootingPctg : undefined;

  return {
    source: "nhl",
    refreshedAt: new Date().toISOString(),
    seasonId,
    gamesPlayed,
    nhlPlayerId,
    pim: typeof subSeason.pim === "number" ? subSeason.pim : undefined,
    goals,
    assists,
    points,
    plusMinus,
    powerPlayPoints,
    shots,
    shootingPctg,
    seasonHistory,
    valueSignal: computeSkaterValueSignal({
      gamesPlayed,
      goals,
      assists,
      points,
      plusMinus,
      powerPlayPoints,
      shots,
      shootingPctg,
    }),
  };
};

const EMPTY_CACHE = (): StatsCacheFile => ({
  importedAt: new Date(0).toISOString(),
  refreshIntervalMs: getRefreshIntervalMs(),
  entries: {},
});

const readCache = async (): Promise<StatsCacheFile> => {
  const filePath = getCachePath();
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return EMPTY_CACHE();
    }
    throw error;
  }

  // If the on-disk file is corrupted (e.g. a previous process was killed
  // mid-write), DO NOT silently return an empty cache — the next write
  // would then overwrite the entire file with whatever this refresh
  // happens to fetch, destroying every other cached entry. Instead,
  // throw so the refresh aborts and the operator can investigate.
  try {
    const parsed: unknown = JSON.parse(raw);

    if (!isRecord(parsed) || !isRecord(parsed.entries)) {
      throw new Error("invalid cache shape");
    }

    return {
      importedAt: typeof parsed.importedAt === "string" ? parsed.importedAt : new Date(0).toISOString(),
      refreshIntervalMs:
        typeof parsed.refreshIntervalMs === "number" && Number.isFinite(parsed.refreshIntervalMs)
          ? parsed.refreshIntervalMs
          : getRefreshIntervalMs(),
      entries: Object.fromEntries(
        Object.entries(parsed.entries).filter(([, entry]) => isRecord(entry) && typeof entry.playerId === "string"),
      ) as Record<string, CachedStatsEntry>,
    };
  } catch (error) {
    // Quarantine the corrupted file so the operator can recover entries
    // manually instead of letting a fresh refresh silently overwrite it.
    try {
      const corruptedAt = new Date().toISOString().replace(/[:.]/g, "-");
      await rename(filePath, `${filePath}.corrupted-${corruptedAt}`);
    } catch {
      // ignore quarantine failure; we still need to surface the parse error
    }
    throw new Error(
      `NHL player stats cache at ${filePath} is unreadable: ${
        error instanceof Error ? error.message : String(error)
      }. The file has been quarantined; restart the server to start a fresh cache.`,
    );
  }
};

const writeCache = async (cache: StatsCacheFile) => {
  const filePath = getCachePath();
  await mkdir(path.dirname(filePath), { recursive: true });
  // Atomic write: serialise to a sibling tempfile, then rename over the
  // target. fs.rename is atomic on the same filesystem on all major
  // platforms, so concurrent readers will only ever see the previous
  // complete file or the new complete file — never a half-written one.
  const tempPath = `${filePath}.tmp-${process.pid}`;
  const payload = `${JSON.stringify(cache, null, 2)}\n`;
  await writeFile(tempPath, payload, "utf8");
  // Sanity-check before swap: the in-memory cache should never be smaller
  // than what's currently on disk by a wide margin. If it is, refuse to
  // commit the swap — this guards against accidental wipes if a future
  // code path passes an unexpectedly small cache object.
  try {
    const existing = await stat(filePath);
    const newSize = Buffer.byteLength(payload, "utf8");
    if (existing.size > 1024 && newSize < existing.size * 0.1) {
      throw new Error(
        `Refusing to shrink NHL stats cache from ${existing.size} bytes to ${newSize} bytes; aborting write to avoid data loss.`,
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      // Either the size-shrink guard fired or stat failed for another
      // reason; surface either way without committing the swap.
      throw error;
    }
  }
  await rename(tempPath, filePath);
};

// Compute the current NHL season identifier in the same `YYYYYYYY` form the
// API uses (e.g. 20252026). The NHL league year flips in early October, but
// we use July as the cutover so the off-season is bucketed with the upcoming
// season rather than the one that just ended.
const getCurrentNhlSeasonId = (now: Date = new Date()) => {
  const year = now.getUTCFullYear();
  const startYear = now.getUTCMonth() >= 6 /* July */ ? year : year - 1;
  return startYear * 10000 + (startYear + 1);
};

const getRefreshIntervalForEntry = (entry: CachedStatsEntry): number => {
  if (entry.status === "not-found") {
    return (entry.consecutiveNotFound ?? 0) >= NOT_FOUND_LONG_THRESHOLD
      ? NOT_FOUND_LONG_REFRESH_INTERVAL_MS
      : NOT_FOUND_REFRESH_INTERVAL_MS;
  }

  const currentSeasonId = getCurrentNhlSeasonId();
  const lastActiveSeasonId = entry.lastActiveNhlSeasonId ?? entry.stats?.seasonId;

  // Hasn't played in the NHL for 2+ full seasons \u2014 basically dormant until
  // something material changes (trade, signing). Check rarely. Season ids
  // are encoded as `startYear * 10000 + (startYear + 1)`, so the start year
  // is recoverable by integer-dividing by 10000.
  if (
    typeof lastActiveSeasonId === "number" &&
    Math.floor(currentSeasonId / 10000) - Math.floor(lastActiveSeasonId / 10000) >= 2
  ) {
    return LONG_INACTIVE_REFRESH_INTERVAL_MS;
  }

  // Listed for the current season but hasn't logged a game yet (healthy
  // scratch, AHL assignment, injured all year). Their numbers aren't going
  // to change every day.
  const gp = entry.currentSeasonGamesPlayed ?? entry.stats?.gamesPlayed;
  if (typeof gp === "number" && gp === 0) {
    return INACTIVE_THIS_SEASON_REFRESH_INTERVAL_MS;
  }

  return getRefreshIntervalMs();
};

const shouldRefreshEntry = (entry: CachedStatsEntry | undefined, force: boolean) => {
  if (force || !entry) {
    return true;
  }

  const refreshedAtMs = Date.parse(entry.refreshedAt);

  if (!Number.isFinite(refreshedAtMs)) {
    return true;
  }

  return Date.now() - refreshedAtMs >= getRefreshIntervalForEntry(entry);
};

const dedupePlayersById = (players: Player[]) => {
  const seenIds = new Set<string>();

  return players.filter((player) => {
    if (seenIds.has(player.id)) {
      return false;
    }

    seenIds.add(player.id);
    return true;
  });
};

const getAllTrackedPlayers = (input: NormalizedDashboardInput) =>
  dedupePlayersById([...input.roster, ...input.leagueTargets]);

const getAutoRefreshPlayers = (input: NormalizedDashboardInput) => dedupePlayersById(input.roster);

const isSameUtcDay = (left: string, right: Date) => {
  const leftDate = new Date(left);

  if (!Number.isFinite(leftDate.getTime())) {
    return false;
  }

  return leftDate.toISOString().slice(0, 10) === right.toISOString().slice(0, 10);
};

const hasEntriesNeedingRefresh = (cache: StatsCacheFile, input: NormalizedDashboardInput) =>
  getAutoRefreshPlayers(input).some((player) => shouldRefreshEntry(cache.entries[player.id], false));

const shouldAutoRefreshCacheToday = (cache: StatsCacheFile, now: Date, input: NormalizedDashboardInput) =>
  !isSameUtcDay(cache.importedAt, now) || hasEntriesNeedingRefresh(cache, input);

const FETCH_RETRY_ATTEMPTS = 5;
const FETCH_RETRY_BASE_DELAY_MS = 400;
const FETCH_RETRY_MAX_DELAY_MS = 30_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const isTransientStatus = (status: number) => status === 408 || status === 429 || status >= 500;

// Module-scoped rate-limit gate. When any worker observes a 429, it sets
// `rateLimitedUntil` so ALL other in-flight workers pause until the API's
// Retry-After window has elapsed. Without this, 10 parallel workers would
// all keep hammering a rate-limited endpoint and each independently burn
// exponential backoff.
let rateLimitedUntil = 0;

const parseRetryAfter = (header: string | null): number | null => {
  if (!header) return null;
  const numeric = Number(header);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return numeric * 1000;
  }
  const dateMs = Date.parse(header);
  if (Number.isFinite(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }
  return null;
};

const awaitRateLimitGate = async () => {
  while (true) {
    const wait = rateLimitedUntil - Date.now();
    if (wait <= 0) return;
    await sleep(Math.min(wait, FETCH_RETRY_MAX_DELAY_MS));
  }
};

const fetchJson = async <T>(url: string, revalidateSeconds = 0): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 0; attempt < FETCH_RETRY_ATTEMPTS; attempt += 1) {
    await awaitRateLimitGate();
    try {
      const response = await fetch(
        url,
        revalidateSeconds > 0 ? { next: { revalidate: revalidateSeconds } } : { cache: "no-store" },
      );

      if (response.status === 429) {
        // Honour Retry-After when present, otherwise fall back to exponential
        // backoff. Pause every other worker via the global gate.
        const retryAfterMs =
          parseRetryAfter(response.headers.get("retry-after")) ??
          Math.min(FETCH_RETRY_BASE_DELAY_MS * 2 ** attempt, FETCH_RETRY_MAX_DELAY_MS);
        rateLimitedUntil = Math.max(rateLimitedUntil, Date.now() + retryAfterMs);
        if (attempt < FETCH_RETRY_ATTEMPTS - 1) {
          continue;
        }
        throw new Error(`NHL API rate-limited (429); exhausted ${FETCH_RETRY_ATTEMPTS} attempts.`);
      }

      if (!response.ok) {
        if (isTransientStatus(response.status) && attempt < FETCH_RETRY_ATTEMPTS - 1) {
          await sleep(
            Math.min(FETCH_RETRY_BASE_DELAY_MS * 2 ** attempt, FETCH_RETRY_MAX_DELAY_MS) +
              Math.floor(Math.random() * 200),
          );
          continue;
        }
        throw new Error(`NHL API request failed with status ${response.status}.`);
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (attempt < FETCH_RETRY_ATTEMPTS - 1) {
        await sleep(
          Math.min(FETCH_RETRY_BASE_DELAY_MS * 2 ** attempt, FETCH_RETRY_MAX_DELAY_MS) +
            Math.floor(Math.random() * 200),
        );
        continue;
      }
      throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("NHL API request failed.");
};

const searchNhlPlayers = async (query: string, activeOnly: boolean): Promise<SearchEntry[]> => {
  const params = new URLSearchParams({
    culture: "en-us",
    limit: "20",
    q: `${query}*`,
  });

  if (activeOnly) {
    params.set("active", "true");
  }

  const payload = await fetchJson<SearchResponse>(`${NHL_SEARCH_ENDPOINT}?${params.toString()}`);
  return getSearchEntries(payload);
};

// Build a deduplicated set of NHL search queries to try for a player name.
// The NHL search endpoint behaves like a prefix index on the full string,
// which means "matt beniers" misses "Matty Beniers" and "ryan oreilly" misses
// "Ryan O'Reilly" entirely. Searching with progressively narrower variants
// (last name only, condensed initials) recovers those misses.
const buildSearchQueries = (name: string): string[] => {
  const queries: string[] = [];
  const seen = new Set<string>();
  const push = (value: string) => {
    const trimmed = value.trim();
    if (trimmed && !seen.has(trimmed)) {
      seen.add(trimmed);
      queries.push(trimmed);
    }
  };

  const normalized = normalizeName(name);
  push(normalized);

  // Variant with the original apostrophes preserved (NHL indexes some names
  // like "O'Reilly" with the apostrophe intact).
  const apostrophePreserved = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  push(apostrophePreserved);

  // Condense initials like "T.J." or "T J" into "tj".
  const condensedInitials = normalized.replace(/\b([a-z]) (?=[a-z]\b)/g, "$1");
  push(condensedInitials);

  // Last-name-only fallback for cases where the first name differs (Pat vs
  // Patrick, Matt vs Matty, etc.). We still filter the result list through
  // chooseBestMatch / namesMatch so this only rescues genuine matches.
  const split = splitName(normalized);
  if (split) {
    push(split.last);
    // Also try last + last in case the surname is hyphenated. NHL stores
    // hyphenated names without the hyphen.
    if (split.last.includes("-")) {
      push(split.last.replace(/-/g, ""));
    }
    if (split.first.length >= 2) {
      // First-letter + last-name (e.g. "p maroon").
      push(`${split.first[0]} ${split.last}`);
    }
  }

  return queries;
};

const resolveNhlPlayerId = async (name: string) => {
  const queries = buildSearchQueries(name);

  if (queries.length === 0) {
    return null;
  }

  // First pass: active players only across all query variants. Prefer the
  // highest-confidence match overall rather than stopping at the first hit,
  // so a precise full-name match beats a last-name-only fallback.
  for (const activeOnly of [true, false] as const) {
    let best: { entry: SearchEntry; score: number } | null = null;
    for (const query of queries) {
      let entries: SearchEntry[];
      try {
        entries = await searchNhlPlayers(query, activeOnly);
      } catch {
        continue;
      }
      const match = chooseBestMatch(name, entries);
      if (!match) {
        continue;
      }
      const score = namesMatch(name, match.name ?? "")?.score ?? 0;
      if (!best || score > best.score) {
        best = { entry: match, score };
        // A perfect normalized match is good enough; don't burn additional
        // requests when we already have a definitive hit.
        if (score >= 100) {
          break;
        }
      }
    }
    if (best) {
      const playerId = Number(best.entry.playerId);
      if (Number.isInteger(playerId)) {
        return playerId;
      }
    }
  }

  return null;
};

const computeLastActiveNhlSeasonId = (stats: RealSeasonStats | null): number | undefined => {
  if (!stats) return undefined;
  let latest = stats.seasonId;
  for (const history of stats.seasonHistory ?? []) {
    if (history.leagueAbbrev === "NHL" && (history.regularSeason?.gamesPlayed ?? 0) > 0) {
      if (!latest || history.seasonId > latest) {
        latest = history.seasonId;
      }
    }
  }
  return latest;
};

const fetchPlayerRealSeasonStats = async (player: Player, cachedEntry?: CachedStatsEntry): Promise<CachedStatsEntry> => {
  // Only reuse a cached NHL id when it previously yielded usable stats. A
  // cached `not-found` entry may have stored the id of a mismatched player
  // from an earlier search, so force re-resolution to give the corrected
  // search logic a chance to find the real player.
  const reusableNhlPlayerId = cachedEntry?.status === "matched" ? cachedEntry.nhlPlayerId : undefined;
  const resolvedNhlPlayerId = reusableNhlPlayerId ?? (await resolveNhlPlayerId(player.name));

  if (!resolvedNhlPlayerId) {
    return {
      playerId: player.id,
      playerName: player.name,
      normalizedName: normalizeName(player.name),
      refreshedAt: new Date().toISOString(),
      status: "not-found",
      consecutiveNotFound: (cachedEntry?.consecutiveNotFound ?? 0) + 1,
    };
  }

  const payload = await fetchJson<PlayerLandingResponse>(`${NHL_PLAYER_LANDING_ENDPOINT}/${resolvedNhlPlayerId}/landing`);
  const stats = parseLandingSummary(payload, player.position);

  if (!stats) {
    return {
      playerId: player.id,
      playerName: player.name,
      normalizedName: normalizeName(player.name),
      refreshedAt: new Date().toISOString(),
      status: "not-found",
      nhlPlayerId: resolvedNhlPlayerId,
      consecutiveNotFound: (cachedEntry?.consecutiveNotFound ?? 0) + 1,
    };
  }

  return {
    playerId: player.id,
    playerName: player.name,
    normalizedName: normalizeName(player.name),
    refreshedAt: new Date().toISOString(),
    status: "matched",
    nhlPlayerId: resolvedNhlPlayerId,
    stats,
    consecutiveNotFound: 0,
    currentSeasonGamesPlayed: stats.gamesPlayed,
    lastActiveNhlSeasonId: computeLastActiveNhlSeasonId(stats),
  };
};

const applyStatsToPlayer = (player: Player, entry: CachedStatsEntry | undefined): Player => {
  if (!entry?.stats) {
    return player;
  }

  if (
    player.realSeasonStats?.nhlPlayerId === entry.stats.nhlPlayerId &&
    player.realSeasonStats?.refreshedAt === entry.stats.refreshedAt
  ) {
    return player;
  }

  return {
    ...player,
    realSeasonStats: entry.stats,
  };
};

const applyCachedStatsToInput = (input: NormalizedDashboardInput, cache: StatsCacheFile) => {
  const roster = input.roster.map((player) => applyStatsToPlayer(player, cache.entries[player.id]));
  const leagueTargets = input.leagueTargets.map((player) => applyStatsToPlayer(player, cache.entries[player.id]));
  const didChange =
    roster.some((player, index) => player !== input.roster[index]) ||
    leagueTargets.some((player, index) => player !== input.leagueTargets[index]);

  return didChange
    ? {
        ...input,
        roster,
        leagueTargets,
      }
    : input;
};

export const getNhlPlayerStatsImportConfig = () => ({
  cachePath: getCachePath(),
  refreshIntervalHours: Math.round(getRefreshIntervalMs() / (60 * 60 * 1000)),
  sourceMode: getConfiguredSourceMode(),
});

export const readNhlPlayerStatsCacheSummary = async (
  input?: NormalizedDashboardInput,
): Promise<NhlPlayerStatsCacheSummary> => {
  const cache = await readCache();
  const entries = Object.values(cache.entries);
  const trackedPlayerIds = input
    ? getAutoRefreshPlayers(input).map((player) => player.id)
    : null;

  const staleCount = entries.filter((entry) => shouldRefreshEntry(entry, false)).length;
  const missingTrackedEntryCount =
    trackedPlayerIds?.filter((playerId) => cache.entries[playerId] === undefined).length ?? null;
  const staleTrackedEntryCount =
    trackedPlayerIds?.filter((playerId) => {
      const entry = cache.entries[playerId];
      return entry ? shouldRefreshEntry(entry, false) : false;
    }).length ?? null;

  return {
    cachePath: getCachePath(),
    importedAt: cache.importedAt,
    refreshIntervalHours: Math.round(cache.refreshIntervalMs / (60 * 60 * 1000)),
    entryCount: entries.length,
    matchedCount: entries.filter((entry) => entry.status === "matched").length,
    notFoundCount: entries.filter((entry) => entry.status === "not-found").length,
    staleCount,
    trackedPlayerCount: trackedPlayerIds?.length ?? null,
    missingTrackedEntryCount,
    staleTrackedEntryCount,
  };
};

const refreshPlayerRealSeasonStats = async (
  input: NormalizedDashboardInput,
  options?: {
    force?: boolean;
    maxBatchSize?: number;
    trigger?: NhlPlayerStatsRefreshProgress["trigger"];
    playerIds?: string[];
  },
): Promise<RefreshStatsResult> => {
  const force = options?.force ?? false;
  const cache = await readCache();
  const requestedPlayerIds = options?.playerIds?.length ? new Set(options.playerIds) : null;
  const uniquePlayers = getAllTrackedPlayers(input);
  const scopedPlayers = requestedPlayerIds
    ? uniquePlayers.filter((player) => requestedPlayerIds.has(player.id))
    : uniquePlayers;
  const eligiblePlayers = scopedPlayers.filter((player) => shouldRefreshEntry(cache.entries[player.id], force));
  // Process players that have NEVER been fetched first, then stale entries.
  // Without this, a long refresh that gets interrupted (server restart, dev
  // HMR reload) re-runs from the top of the same ordered list every time and
  // never reaches players in the tail — leaving some `pho-*` ids with no
  // cache entry at all even after many sessions.
  const sortedEligible = [...eligiblePlayers].sort((left, right) => {
    const leftHasEntry = cache.entries[left.id] !== undefined ? 1 : 0;
    const rightHasEntry = cache.entries[right.id] !== undefined ? 1 : 0;
    return leftHasEntry - rightHasEntry;
  });
  const playersToRefresh =
    typeof options?.maxBatchSize === "number" && options.maxBatchSize > 0
      ? sortedEligible.slice(0, options.maxBatchSize)
      : sortedEligible;

  // Initialise progress so observers (UI badge, /admin/data-status) can see
  // a refresh is underway even before any entry completes.
  const startedAt = new Date().toISOString();
  const progress: NhlPlayerStatsRefreshProgress = {
    startedAt,
    updatedAt: startedAt,
    completedAt: null,
    total: playersToRefresh.length,
    processed: 0,
    matched: 0,
    notFound: 0,
    failed: 0,
    inFlight: playersToRefresh.length > 0,
    trigger: options?.trigger ?? "manual",
    lastError: null,
  };
  currentRefreshProgress = progress;

  // Track only the entries WE fetched during this run as a delta. Each
  // flush re-reads the file from disk and merges the delta on top, so
  // out-of-band edits (manual injections, other processes, parallel
  // refreshes) survive and we never overwrite the file with our stale
  // in-memory snapshot.
  const freshEntries = new Map<string, CachedStatsEntry>();

  let writeChain: Promise<void> = Promise.resolve();
  let lastWriteAt = 0;
  let dirty = false;
  const scheduleWrite = (immediate = false) => {
    const now = Date.now();
    if (!dirty) {
      return writeChain;
    }
    if (!immediate && now - lastWriteAt < INCREMENTAL_WRITE_INTERVAL_MS) {
      return writeChain;
    }
    lastWriteAt = now;
    dirty = false;
    writeChain = writeChain
      .then(async () => {
        const onDisk = await readCache();
        for (const [id, entry] of freshEntries) {
          onDisk.entries[id] = entry;
        }
        onDisk.importedAt = new Date().toISOString();
        onDisk.refreshIntervalMs = getRefreshIntervalMs();
        await writeCache(onDisk);
      })
      .catch((error) => {
        progress.lastError = error instanceof Error ? error.message : String(error);
      });
    return writeChain;
  };

  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < playersToRefresh.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      const player = playersToRefresh[currentIndex];
      // Tiny per-iteration jitter avoids synchronised bursts after a global
      // rate-limit pause releases all workers simultaneously.
      await sleep(
        REQUEST_JITTER_MIN_MS + Math.floor(Math.random() * (REQUEST_JITTER_MAX_MS - REQUEST_JITTER_MIN_MS)),
      );
      try {
        const entry = await fetchPlayerRealSeasonStats(player, cache.entries[player.id]);
        cache.entries[entry.playerId] = entry;
        freshEntries.set(entry.playerId, entry);
        dirty = true;
        if (entry.status === "matched") {
          progress.matched += 1;
        } else {
          progress.notFound += 1;
        }
      } catch (error) {
        // Transient NHL API failure after retries. Preserve any prior entry
        // (don't churn its refreshedAt timestamp) so the next refresh tick
        // can retry immediately.
        progress.failed += 1;
        progress.lastError = error instanceof Error ? error.message : String(error);
      }
      progress.processed += 1;
      progress.updatedAt = new Date().toISOString();
      // Flush periodically so an interrupted refresh (server restart) keeps
      // its progress instead of dropping every resolved entry.
      scheduleWrite(false);
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(REQUEST_CONCURRENCY, playersToRefresh.length) }, () => worker()));
  } finally {
    dirty = dirty || progress.processed > 0;
    scheduleWrite(true);
    await writeChain;
    progress.inFlight = false;
    progress.completedAt = new Date().toISOString();
    progress.updatedAt = progress.completedAt;
  }

  const updatedRoster = input.roster.map((player) => applyStatsToPlayer(player, cache.entries[player.id]));
  const updatedLeagueTargets = input.leagueTargets.map((player) => applyStatsToPlayer(player, cache.entries[player.id]));
  const didChange =
    updatedRoster.some((player, index) => player !== input.roster[index]) ||
    updatedLeagueTargets.some((player, index) => player !== input.leagueTargets[index]);
  const updatedInput =
    !didChange
      ? input
      : {
          ...input,
          roster: updatedRoster,
          leagueTargets: updatedLeagueTargets,
        };

  const matchedCount = Object.values(cache.entries).filter((entry) => entry.status === "matched").length;

  return {
    input: updatedInput,
    cachePath: getCachePath(),
    refreshedPlayerCount: playersToRefresh.length,
    matchedPlayerCount: matchedCount,
    rosterCount: updatedRoster.length,
    leagueTargetCount: updatedLeagueTargets.length,
    force,
    refreshed: playersToRefresh.length > 0,
  };
};

const BACKGROUND_AUTO_REFRESH_FOREGROUND_BUDGET = 50;
const FOREGROUND_AUTO_REFRESH_THRESHOLD = 3;

export const maybeAutoRefreshPlayerRealSeasonStats = async (input: NormalizedDashboardInput) => {
  const cache = await readCache();
  const now = new Date();
  const cachedInput = applyCachedStatsToInput(input, cache);
  const autoRefreshPlayerIds = getAutoRefreshPlayers(cachedInput).map((player) => player.id);

  if (!shouldAutoRefreshCacheToday(cache, now, cachedInput)) {
    return {
      input: cachedInput,
      autoRefreshed: cachedInput !== input,
    };
  }

  // Count how many tracked players still need refresh so we can decide whether
  // to await a small foreground batch or kick the whole job off in the
  // background. A large backlog (e.g. right after a code change clears bad
  // cache rows) would otherwise stall every page render behind thousands of
  // NHL API calls.
  const pendingPlayers = getAutoRefreshPlayers(cachedInput).filter((player) =>
    shouldRefreshEntry(cache.entries[player.id], false),
  );

  if (pendingPlayers.length > FOREGROUND_AUTO_REFRESH_THRESHOLD) {
    if (!pendingAutoRefresh) {
      pendingAutoRefresh = refreshPlayerRealSeasonStats(cachedInput, {
        force: false,
        trigger: "auto-background",
        playerIds: autoRefreshPlayerIds,
      }).finally(() => {
        pendingAutoRefresh = null;
      });
      // Surface uncaught background failures without blocking the render.
      pendingAutoRefresh.catch((error) => {
        console.error("[nhl-player-stats] background refresh failed", error);
      });
    }
    return {
      input: cachedInput,
      autoRefreshed: false,
    };
  }

  if (!pendingAutoRefresh) {
    pendingAutoRefresh = refreshPlayerRealSeasonStats(cachedInput, {
      force: false,
      maxBatchSize: BACKGROUND_AUTO_REFRESH_FOREGROUND_BUDGET,
      trigger: "auto-foreground",
      playerIds: autoRefreshPlayerIds,
    }).finally(() => {
      pendingAutoRefresh = null;
    });
  }

  const result = await pendingAutoRefresh;

  return {
    input: result.input,
    autoRefreshed: result.input !== input,
    result,
  };
};

export const refreshLivePlayerRealSeasonStats = async (
  input: NormalizedDashboardInput,
  options?: { force?: boolean; playerIds?: string[] },
) => {
  if (getConfiguredSourceMode() !== "live-file") {
    throw new Error("NHL real-season stats refresh requires NHL_SIM_DATA_SOURCE=live-file.");
  }

  return refreshPlayerRealSeasonStats(input, { ...options, trigger: "manual" });
};