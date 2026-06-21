import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { DashboardInput, DraftPick, Player, Position } from "@/lib/domain";

const DEFAULT_PLAYERS_API_URL = "https://playhockeyonline.com/api/players";
const DEFAULT_TEAMS_API_URL = "https://playhockeyonline.com/api/teams";
const DEFAULT_DRAFT_PICKS_API_URL = "https://playhockeyonline.com/api/draft_picks";
const DEFAULT_RAW_CACHE_PATH = path.join(process.cwd(), "data", "playhockeyonline-players.raw.json");
const DEFAULT_CONTRACT_CACHE_PATH = path.join(process.cwd(), "data", "playhockeyonline-player-contracts.raw.json");
const DEFAULT_PHO_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_PHO_PAGE_FETCH_CONCURRENCY = 4;
const DEFAULT_PHO_CONTRACT_FETCH_CONCURRENCY = 4;
const DEFAULT_PHO_MAX_MISSING_CONTRACT_FETCHES = 250;
const PHO_FILE_CACHE_TTL_MS = 300_000;

type PhoFetchSummary = {
  status: number;
  ok: boolean;
  contentType: string | null;
  topLevelType: "array" | "object" | "primitive";
  collectionLength: number | null;
  collectionPath: string | null;
  topLevelKeys: string[];
  sampleKeys: string[];
};

type PhoImportResult = {
  summary: PhoFetchSummary;
  rawFilePath: string;
  authVariant: string;
};

type PhoPosition = {
  id: number;
  name: string;
  pivot?: {
    is_active?: number;
  };
};

type PhoPlayerStat = {
  key: string;
  value: number;
};

type PhoPlayerSalary = {
  year: number;
  salary: number;
  player_id: number;
};

type PhoPlayer = {
  id: number;
  team_id: number | null;
  name: string;
  is_prospect: boolean;
  is_retired: boolean;
  team_type: string | null;
  computed_age: number | null;
  years_left_before_Ufa: number | null;
  base_free_agent_salary: number | null;
  belongs_to_current_team: boolean;
  position_id: number | null;
  positions: PhoPosition[];
  player_stats: PhoPlayerStat[];
};

type PhoContractSnapshot = {
  capHit: number;
  contractStatus: Player["contractStatus"];
  yearsRemaining: number;
};

type PhoPlayersPage = {
  current_page: number;
  data: PhoPlayer[];
  last_page: number;
  next_page_url: string | null;
};

type PhoDashboardImportResult = {
  dashboardInput: DashboardInput;
  rawFilePath: string;
  authVariant: string;
  pageCount: number;
  playerCount: number;
  rosterCount: number;
  leagueTargetCount: number;
  currentTeamId: number | null;
};

type CachedFileData<T> = {
  filePath: string;
  mtimeMs: number;
  size: number;
  expiresAt: number;
  data: T;
};

type PhoTeam = {
  id: number;
  name: string;
  city: string;
};

type PhoDraftPick = {
  id: number;
  round: number;
  year: number;
  rank: number | null;
  issuer_name: string | null;
  owner?: {
    id: number;
    name: string;
    city: string;
  } | null;
  issuer?: {
    id: number;
    name: string;
    city: string;
  } | null;
};

type PhoDraftPickTeamRef = NonNullable<PhoDraftPick["owner"]>;

type PhoDraftPickSeason = {
  year: number;
  draft_picks: PhoDraftPick[];
};

let cachedPhoContractSnapshots: CachedFileData<Map<number, PhoContractSnapshot>> | null = null;
let cachedPhoSimulationStats: CachedFileData<Map<number, NonNullable<Player["simulationStats"]>>> | null = null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const parseNonNegativeInteger = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return Math.floor(parsed);
};

const getPhoRequestTimeoutMs = () => {
  const configuredTimeout = Number(process.env.PHO_REQUEST_TIMEOUT_MS);

  if (!Number.isFinite(configuredTimeout) || configuredTimeout <= 0) {
    return DEFAULT_PHO_REQUEST_TIMEOUT_MS;
  }

  return Math.round(configuredTimeout);
};

const getPhoPageFetchConcurrency = () =>
  Math.max(1, parseNonNegativeInteger(process.env.PHO_PAGE_FETCH_CONCURRENCY, DEFAULT_PHO_PAGE_FETCH_CONCURRENCY));

const getPhoContractFetchConcurrency = () =>
  Math.max(
    1,
    parseNonNegativeInteger(
      process.env.PHO_CONTRACT_FETCH_CONCURRENCY,
      DEFAULT_PHO_CONTRACT_FETCH_CONCURRENCY,
    ),
  );

const getPhoMaxMissingContractFetches = () =>
  parseNonNegativeInteger(
    process.env.PHO_IMPORT_MAX_MISSING_CONTRACT_FETCHES,
    DEFAULT_PHO_MAX_MISSING_CONTRACT_FETCHES,
  );

const logPhoActivity = (event: string, details?: Record<string, unknown>) => {
  if (details) {
    console.info(`[pho] ${event}`, details);
    return;
  }

  console.info(`[pho] ${event}`);
};

const logPhoFailure = (event: string, error: unknown, details?: Record<string, unknown>) => {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[pho] ${event}`, {
    ...details,
    error: message,
  });
};

const getPlayersApiUrl = () => process.env.PHO_PLAYERS_API_URL?.trim() || DEFAULT_PLAYERS_API_URL;

const getTeamsApiUrl = () => process.env.PHO_TEAMS_API_URL?.trim() || DEFAULT_TEAMS_API_URL;

const getDraftPicksApiUrl = () =>
  process.env.PHO_DRAFT_PICKS_API_URL?.trim() || DEFAULT_DRAFT_PICKS_API_URL;

const getRawCachePath = () =>
  process.env.PHO_PLAYERS_RAW_PATH?.trim() || DEFAULT_RAW_CACHE_PATH;

const getContractCachePath = () =>
  process.env.PHO_PLAYER_CONTRACTS_RAW_PATH?.trim() || DEFAULT_CONTRACT_CACHE_PATH;

const getCurrentTeamName = () => process.env.PHO_CURRENT_TEAM_NAME?.trim() || "Current Team";

const getAuthorizationVariants = () => {
  const configuredToken = process.env.PHO_AUTH_BEARER_TOKEN?.trim();

  if (!configuredToken) {
    return [{ label: "no-authorization-header", value: null }];
  }

  if (/^Bearer\s+/i.test(configuredToken)) {
    return [{ label: "authorization-header", value: configuredToken }];
  }

  return [
    { label: "bearer-token", value: `Bearer ${configuredToken}` },
    { label: "raw-authorization", value: configuredToken },
  ];
};

const PHO_DRAFT_PICK_ID_PREFIX = "pho-pick-";
const PHO_PLAYER_ID_PREFIX = "pho-";

const buildRequestHeaders = (authorizationValue: string | null) => {
  const headers = new Headers({
    Accept: "application/json",
    "User-Agent": "NorthstarGM/0.1",
  });

  if (authorizationValue) {
    headers.set("Authorization", authorizationValue);
  }

  if (process.env.PHO_AUTH_COOKIE?.trim()) {
    headers.set("Cookie", process.env.PHO_AUTH_COOKIE.trim());
  }

  if (process.env.PHO_XSRF_TOKEN?.trim()) {
    headers.set("X-XSRF-TOKEN", process.env.PHO_XSRF_TOKEN.trim());
  }

  return headers;
};

const parseJsonSafely = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

const fetchPhoResponse = async (
  url: string,
  authorizationValue: string | null,
  requestLabel: string,
) => {
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: buildRequestHeaders(authorizationValue),
      cache: "no-store",
      signal: AbortSignal.timeout(getPhoRequestTimeoutMs()),
    });

    logPhoActivity(`${requestLabel}:response`, {
      durationMs: Date.now() - startedAt,
      status: response.status,
      ok: response.ok,
      url,
    });

    return response;
  } catch (error) {
    logPhoFailure(`${requestLabel}:failed`, error, {
      durationMs: Date.now() - startedAt,
      url,
      timeoutMs: getPhoRequestTimeoutMs(),
    });
    throw error;
  }
};

const roundCapHitMillions = (salary: number) => Math.round((salary / 1_000_000) * 100) / 100;

const getPlayerDetailApiUrl = (playerId: number) => {
  const url = new URL(getPlayersApiUrl());
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${playerId}`;
  url.search = "";
  url.searchParams.append("with[]", "salaries");
  return url.toString();
};

const isPhoPlayerStat = (value: unknown): value is PhoPlayerStat =>
  isRecord(value) && typeof value.key === "string" && typeof value.value === "number";

const isPhoPlayerSalary = (value: unknown): value is PhoPlayerSalary =>
  isRecord(value) && typeof value.year === "number" && typeof value.salary === "number" && typeof value.player_id === "number";

const isPhoPosition = (value: unknown): value is PhoPosition =>
  isRecord(value) && typeof value.id === "number" && typeof value.name === "string";

const isPhoPlayer = (value: unknown): value is PhoPlayer =>
  isRecord(value) &&
  typeof value.id === "number" &&
  typeof value.name === "string" &&
  Array.isArray(value.positions) &&
  value.positions.every(isPhoPosition) &&
  Array.isArray(value.player_stats) &&
  value.player_stats.every(isPhoPlayerStat) &&
  typeof value.belongs_to_current_team === "boolean";

const isPhoPlayersPage = (value: unknown): value is PhoPlayersPage =>
  isRecord(value) &&
  typeof value.current_page === "number" &&
  typeof value.last_page === "number" &&
  Array.isArray(value.data) &&
  value.data.every(isPhoPlayer);

const isPhoTeam = (value: unknown): value is PhoTeam =>
  isRecord(value) &&
  typeof value.id === "number" &&
  typeof value.name === "string" &&
  typeof value.city === "string";

const isPhoTeamsResponse = (value: unknown): value is PhoTeam[] =>
  Array.isArray(value) && value.every(isPhoTeam);

const isPhoDraftPick = (value: unknown): value is PhoDraftPick =>
  isRecord(value) &&
  typeof value.id === "number" &&
  typeof value.round === "number" &&
  typeof value.year === "number";

const isPhoDraftPickSeason = (value: unknown): value is PhoDraftPickSeason =>
  isRecord(value) &&
  typeof value.year === "number" &&
  Array.isArray(value.draft_picks) &&
  value.draft_picks.every(isPhoDraftPick);

const isPhoDraftPicksResponse = (value: unknown): value is PhoDraftPickSeason[] =>
  Array.isArray(value) && value.every(isPhoDraftPickSeason);

const extractPlayerCollection = (
  payload: unknown,
): { path: string | null; items: unknown[] | null } => {
  if (Array.isArray(payload)) {
    return { path: "$", items: payload };
  }

  if (!isRecord(payload)) {
    return { path: null, items: null };
  }

  const candidates = ["data", "players", "results", "items"];

  for (const key of candidates) {
    const candidate = payload[key];
    if (Array.isArray(candidate)) {
      return { path: key, items: candidate };
    }
  }

  return { path: null, items: null };
};

const summarizePayload = (
  payload: unknown,
  response: Response,
): PhoFetchSummary => {
  const collection = extractPlayerCollection(payload);
  const sample = collection.items?.[0];

  return {
    status: response.status,
    ok: response.ok,
    contentType: response.headers.get("content-type"),
    topLevelType: Array.isArray(payload) ? "array" : isRecord(payload) ? "object" : "primitive",
    collectionLength: collection.items?.length ?? null,
    collectionPath: collection.path,
    topLevelKeys: isRecord(payload) ? Object.keys(payload).slice(0, 20) : [],
    sampleKeys: isRecord(sample) ? Object.keys(sample).slice(0, 30) : [],
  };
};

const persistRawPayload = async (payload: unknown) => {
  const rawFilePath = getRawCachePath();
  const serializedPayload = `${JSON.stringify(payload, null, 2)}\n`;
  await mkdir(path.dirname(rawFilePath), { recursive: true });
  await writeFile(rawFilePath, serializedPayload, "utf8");

  if (isRecord(payload) && Array.isArray(payload.data) && payload.data.every(isPhoPlayer)) {
    cachedPhoSimulationStats = {
      filePath: rawFilePath,
      mtimeMs: (await stat(rawFilePath)).mtimeMs,
      size: Buffer.byteLength(serializedPayload, "utf8"),
      expiresAt: Date.now() + PHO_FILE_CACHE_TTL_MS,
      data: new Map(payload.data.map((player) => [player.id, getSimulationStatsFromPhoPlayer(player)])),
    };
  } else {
    cachedPhoSimulationStats = null;
  }

  return rawFilePath;
};

const getCurrentSimulationYear = (payload: Record<string, unknown>) => {
  const updatedAt = payload.updated_at;

  if (typeof updatedAt === "string") {
    const updatedAtYear = new Date(updatedAt).getUTCFullYear();

    if (Number.isFinite(updatedAtYear)) {
      return updatedAtYear;
    }
  }

  return new Date().getUTCFullYear();
};

const getPhoPlayerSalaries = (payload: unknown): PhoPlayerSalary[] => {
  if (!isRecord(payload) || !Array.isArray(payload.salaries) || !payload.salaries.every(isPhoPlayerSalary)) {
    return [];
  }

  return payload.salaries;
};

const getPhoContractSnapshot = (payload: unknown): PhoContractSnapshot | null => {
  if (!isRecord(payload)) {
    return null;
  }

  const salaries = getPhoPlayerSalaries(payload)
    .slice()
    .sort((left, right) => left.year - right.year || left.salary - right.salary);

  if (salaries.length === 0) {
    return null;
  }

  const currentYear = getCurrentSimulationYear(payload);
  const currentOrFutureSalaries = salaries.filter((salary) => salary.year >= currentYear);
  const latestSalaryYear = currentOrFutureSalaries.at(-1)?.year ?? salaries.at(-1)?.year;
  const selectedSalary =
    currentOrFutureSalaries.find((salary) => salary.year === currentYear)?.salary ??
    currentOrFutureSalaries[0]?.salary ??
    salaries.at(-1)?.salary;

  if (latestSalaryYear === undefined || selectedSalary === undefined) {
    return null;
  }

  return {
    capHit: roundCapHitMillions(selectedSalary),
    yearsRemaining: latestSalaryYear >= currentYear ? Math.max(latestSalaryYear - currentYear, 0) : 0,
    contractStatus: latestSalaryYear >= currentYear ? "signed" : "ufa",
  };
};

const readPhoContractCache = async (): Promise<Map<number, PhoContractSnapshot>> => {
  const filePath = getContractCachePath();

  try {
    const fileStats = await stat(filePath);
    const cachedSnapshots = cachedPhoContractSnapshots;

    if (
      cachedSnapshots &&
      cachedSnapshots.filePath === filePath &&
      cachedSnapshots.mtimeMs === fileStats.mtimeMs &&
      cachedSnapshots.size === fileStats.size &&
      cachedSnapshots.expiresAt > Date.now()
    ) {
      return cachedSnapshots.data;
    }

    const raw = await readFile(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);

    if (!isRecord(parsed) || !isRecord(parsed.data)) {
      return new Map();
    }

    const snapshots = new Map(
      Object.entries(parsed.data)
        .map(([playerId, snapshot]) => {
          const numericPlayerId = Number(playerId);

          if (
            !Number.isInteger(numericPlayerId) ||
            !isRecord(snapshot) ||
            typeof snapshot.capHit !== "number" ||
            typeof snapshot.contractStatus !== "string" ||
            typeof snapshot.yearsRemaining !== "number"
          ) {
            return null;
          }

          return [numericPlayerId, snapshot as PhoContractSnapshot] as const;
        })
        .filter((entry): entry is readonly [number, PhoContractSnapshot] => entry !== null),
    );

    cachedPhoContractSnapshots = {
      filePath,
      mtimeMs: fileStats.mtimeMs,
      size: fileStats.size,
      expiresAt: Date.now() + PHO_FILE_CACHE_TTL_MS,
      data: snapshots,
    };

    return snapshots;
  } catch {
    return new Map();
  }
};

const writePhoContractCache = async (snapshotsById: Map<number, PhoContractSnapshot>) => {
  const rawFilePath = getContractCachePath();
  await mkdir(path.dirname(rawFilePath), { recursive: true });
  const payload = {
    importedAt: new Date().toISOString(),
    data: Object.fromEntries(
      [...snapshotsById.entries()]
        .sort((left, right) => left[0] - right[0])
        .map(([playerId, snapshot]) => [String(playerId), snapshot]),
    ),
  };
  const serializedPayload = `${JSON.stringify(payload, null, 2)}\n`;

  await writeFile(rawFilePath, serializedPayload, "utf8");
  const fileStats = await stat(rawFilePath);

  cachedPhoContractSnapshots = {
    filePath: rawFilePath,
    mtimeMs: fileStats.mtimeMs,
    size: Buffer.byteLength(serializedPayload, "utf8"),
    expiresAt: Date.now() + PHO_FILE_CACHE_TTL_MS,
    data: new Map(snapshotsById),
  };
};

const fetchPhoPlayerContractSnapshot = async (
  playerId: number,
  authorizationValue: string | null,
): Promise<PhoContractSnapshot | null> => {
  const response = await fetchPhoResponse(
    getPlayerDetailApiUrl(playerId),
    authorizationValue,
    `player-detail:${playerId}`,
  );

  const text = await response.text();
  const payload = parseJsonSafely(text);

  if (!response.ok) {
    const errorMessage =
      isRecord(payload) && typeof payload.message === "string"
        ? payload.message
        : `PHO player detail request failed with status ${response.status}.`;
    throw new Error(errorMessage);
  }

  return getPhoContractSnapshot(payload);
};

const runTasksWithConcurrencyLimit = async <T>(
  tasks: Array<() => Promise<T>>,
  concurrencyLimit: number,
): Promise<T[]> => {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < tasks.length) {
      const taskIndex = nextIndex;
      nextIndex += 1;
      results[taskIndex] = await tasks[taskIndex]();
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrencyLimit, tasks.length) }, () => worker()));

  return results;
};

const getStatValue = (player: PhoPlayer, key: string, fallback = 50) =>
  player.player_stats.find((stat) => stat.key === key)?.value ?? fallback;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const mapPositionName = (name: string | undefined, positionId: number | null | undefined): Position => {
  switch (name) {
    case "center":
      return "C";
    case "left_wing":
      return "LW";
    case "right_wing":
      return "RW";
    case "left_defense":
      return "LD";
    case "right_defense":
      return "RD";
    case "goalie":
      return "G";
    default:
      switch (positionId) {
        case 1:
          return "LW";
        case 2:
          return "C";
        case 3:
          return "RW";
        case 4:
          return "LD";
        case 5:
          return "RD";
        case 6:
          return "G";
        default:
          return "C";
      }
  }
};

const getPrimaryPosition = (player: PhoPlayer): Position => {
  const activePosition = player.positions.find((position) => position.pivot?.is_active === 1);
  return mapPositionName(activePosition?.name ?? player.positions[0]?.name, player.position_id);
};

const buildRoleLabel = (position: Position, overall: number, prospect: boolean) => {
  const family = position === "G" ? "goalie" : ["LD", "RD"].includes(position) ? "defenseman" : "forward";

  if (prospect) {
    return `Prospect ${family}`;
  }

  if (overall >= 82) {
    return `Top-line ${family}`;
  }

  if (overall >= 74) {
    return `Middle-line ${family}`;
  }

  if (overall >= 66) {
    return `Depth ${family}`;
  }

  return `Replacement-level ${family}`;
};

const mapContractStatus = (player: PhoPlayer): Player["contractStatus"] => {
  if (player.is_prospect) {
    return "prospect";
  }

  if ((player.years_left_before_Ufa ?? 0) <= 0) {
    return "ufa";
  }

  return "signed";
};

const applyContractSnapshot = (player: Player, snapshot: PhoContractSnapshot): Player => {
  if (player.contractStatus === "prospect") {
    return {
      ...player,
      capHit: snapshot.capHit,
      yearsRemaining: snapshot.yearsRemaining,
    };
  }

  return {
    ...player,
    capHit: snapshot.capHit,
    yearsRemaining: snapshot.yearsRemaining,
    contractStatus: snapshot.contractStatus,
  };
};

const mapTeamLabel = (
  player: PhoPlayer,
  currentTeamName: string,
  teamNamesById: Map<number, string>,
) => {
  if (player.belongs_to_current_team) {
    return currentTeamName;
  }

  if (player.team_id === null) {
    return "Free Agent";
  }

  return teamNamesById.get(player.team_id) ?? `Team ${player.team_id}`;
};

const normalizePhoPlayer = (
  player: PhoPlayer,
  currentTeamName: string,
  teamNamesById: Map<number, string>,
): Player => {
  const overall = getStatValue(player, "overall");
  const scoring = getStatValue(player, "scoring");
  const passing = getStatValue(player, "pass");
  const puckControl = getStatValue(player, "puck_control");
  const skating = getStatValue(player, "skating");
  const defense = getStatValue(player, "defense");
  const checking = getStatValue(player, "checking");
  const discipline = getStatValue(player, "discipline");
  const faceOff = getStatValue(player, "face_off");
  const leadership = getStatValue(player, "leadership");
  const morale = getStatValue(player, "morale");
  const potential = getStatValue(player, "potential");
  const endurance = getStatValue(player, "endurance");
  const penaltyShot = getStatValue(player, "penalty_shot");

  const position = getPrimaryPosition(player);

  return {
    id: `pho-${player.id}`,
    name: player.name,
    team: mapTeamLabel(player, currentTeamName, teamNamesById),
    position,
    role: buildRoleLabel(position, overall, player.is_prospect),
    age: player.computed_age ?? 18,
    capHit: Math.round(((player.base_free_agent_salary ?? 775000) / 1_000_000) * 100) / 100,
    yearsRemaining: Math.max(player.years_left_before_Ufa ?? 0, 0),
    contractStatus: mapContractStatus(player),
    performance: clamp(Math.round(overall * 0.55 + scoring * 0.3 + passing * 0.15), 0, 100),
    playDriving: clamp(Math.round(passing * 0.4 + puckControl * 0.35 + skating * 0.25), 0, 100),
    defense: clamp(Math.round(defense * 0.5 + checking * 0.3 + discipline * 0.2), 0, 100),
    specialTeams: clamp(Math.round(scoring * 0.35 + penaltyShot * 0.2 + endurance * 0.25 + faceOff * 0.2), 0, 100),
    chemistryFit: clamp(Math.round(leadership * 0.45 + morale * 0.35 + discipline * 0.2), 0, 100),
    upside: clamp(Math.round(potential), 0, 100),
    simulationStats: getSimulationStatsFromPhoPlayer(player),
  };
};

const fetchTeams = async (authorizationValue: string | null) => {
  const response = await fetchPhoResponse(getTeamsApiUrl(), authorizationValue, "teams");

  const text = await response.text();
  const payload = parseJsonSafely(text);

  if (!response.ok) {
    const errorMessage =
      isRecord(payload) && typeof payload.message === "string"
        ? payload.message
        : `PHO teams API request failed with status ${response.status}.`;
    throw new Error(errorMessage);
  }

  if (!isPhoTeamsResponse(payload)) {
    throw new Error("PHO teams response did not match the expected array shape.");
  }

  return payload;
};

const fetchDraftPicks = async (authorizationValue: string | null) => {
  const response = await fetchPhoResponse(getDraftPicksApiUrl(), authorizationValue, "draft-picks");

  const text = await response.text();
  const payload = parseJsonSafely(text);

  if (!response.ok) {
    const errorMessage =
      isRecord(payload) && typeof payload.message === "string"
        ? payload.message
        : `PHO draft picks API request failed with status ${response.status}.`;
    throw new Error(errorMessage);
  }

  if (!isPhoDraftPicksResponse(payload)) {
    throw new Error("PHO draft picks response did not match the expected season-grouped shape.");
  }

  return payload;
};

const readExistingDraftPicks = async (): Promise<DraftPick[]> => {
  try {
    const raw = await import("@/lib/dashboard-data-source").then((module) => module.loadDashboardInput());
    return raw.input.draftPicks;
  } catch {
    return [];
  }
};

const getDefaultProjectedSlot = () => 16;

const getPhoTeamLabel = (
  team: PhoDraftPickTeamRef | null | undefined,
  teamNamesById: Map<number, string>,
) => {
  if (!team) {
    return null;
  }

  const fullName = [team.city, team.name].filter(Boolean).join(" ").trim();

  if (fullName) {
    return fullName;
  }

  return teamNamesById.get(team.id) ?? `Team ${team.id}`;
};

const getDraftPickIssuerLabel = (pick: PhoDraftPick, fallbackTeamName: string) => {
  if (pick.issuer_name?.trim()) {
    return pick.issuer_name.trim();
  }

  const issuerTeamLabel = [pick.issuer?.city, pick.issuer?.name].filter(Boolean).join(" ").trim();

  return issuerTeamLabel || fallbackTeamName;
};

const getSimulationStatsFromPhoPlayer = (player: PhoPlayer) =>
  [...player.player_stats]
    .map((stat) => ({
      key: stat.key,
      value: stat.value,
    }))
    .sort((left, right) => right.value - left.value || left.key.localeCompare(right.key));

const readPhoSimulationStatsCache = async (): Promise<Map<number, NonNullable<Player["simulationStats"]>>> => {
  const filePath = getRawCachePath();

  try {
    const fileStats = await stat(filePath);
    const cachedStats = cachedPhoSimulationStats;

    if (
      cachedStats &&
      cachedStats.filePath === filePath &&
      cachedStats.mtimeMs === fileStats.mtimeMs &&
      cachedStats.size === fileStats.size &&
      cachedStats.expiresAt > Date.now()
    ) {
      return cachedStats.data;
    }

    const raw = await readFile(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);

    if (!isRecord(parsed) || !Array.isArray(parsed.data) || !parsed.data.every(isPhoPlayer)) {
      return new Map();
    }

    const statsByPlayerId = new Map(
      parsed.data.map((player) => [player.id, getSimulationStatsFromPhoPlayer(player)]),
    );

    cachedPhoSimulationStats = {
      filePath,
      mtimeMs: fileStats.mtimeMs,
      size: fileStats.size,
      expiresAt: Date.now() + PHO_FILE_CACHE_TTL_MS,
      data: statsByPlayerId,
    };

    return statsByPlayerId;
  } catch {
    return new Map();
  }
};

export const hydratePhoPlayerSimulationStats = async (players: Player[]): Promise<Player[]> => {
  const missingPhoPlayers = players.filter(
    (player) => (!player.simulationStats || player.simulationStats.length === 0) && player.id.startsWith(PHO_PLAYER_ID_PREFIX),
  );

  if (missingPhoPlayers.length === 0) {
    return players;
  }

  try {
    const statsByPlayerId = await readPhoSimulationStatsCache();

    let didChange = false;
    const hydratedPlayers = players.map((player) => {
      if (player.simulationStats?.length || !player.id.startsWith(PHO_PLAYER_ID_PREFIX)) {
        return player;
      }

      const playerId = Number(player.id.slice(PHO_PLAYER_ID_PREFIX.length));
      const simulationStats = statsByPlayerId.get(playerId);

      if (!simulationStats || simulationStats.length === 0) {
        return player;
      }

      didChange = true;
      return {
        ...player,
        simulationStats,
      };
    });

    return didChange ? hydratedPlayers : players;
  } catch {
    return players;
  }
};

export const hydratePhoPlayerContracts = async (
  players: Player[],
  authorizationValue?: string | null,
  options?: {
    fetchMissing?: boolean;
  },
): Promise<Player[]> => {
  const phoPlayerIds = players
    .map((player) => {
      if (!player.id.startsWith(PHO_PLAYER_ID_PREFIX)) {
        return null;
      }

      const numericId = Number(player.id.slice(PHO_PLAYER_ID_PREFIX.length));
      return Number.isInteger(numericId) ? numericId : null;
    })
    .filter((playerId): playerId is number => playerId !== null);

  if (phoPlayerIds.length === 0) {
    return players;
  }

  const contractSnapshotsById = await readPhoContractCache();
  const missingPlayerIds = [...new Set(phoPlayerIds)].filter((playerId) => !contractSnapshotsById.has(playerId));
  const shouldFetchMissing = options?.fetchMissing ?? true;
  const maxMissingContractFetches = getPhoMaxMissingContractFetches();
  const fetchableMissingPlayerIds = missingPlayerIds.slice(0, maxMissingContractFetches);
  const skippedMissingPlayerCount = missingPlayerIds.length - fetchableMissingPlayerIds.length;

  if (shouldFetchMissing && missingPlayerIds.length > 0) {
    const variants =
      authorizationValue === undefined
        ? getAuthorizationVariants()
        : [{ label: "explicit-authorization", value: authorizationValue }];

    logPhoActivity("contract-hydration:start", {
      cachedContractCount: contractSnapshotsById.size,
      missingPlayerCount: missingPlayerIds.length,
      fetchableMissingPlayerCount: fetchableMissingPlayerIds.length,
      skippedMissingPlayerCount,
      concurrency: getPhoContractFetchConcurrency(),
    });

    if (fetchableMissingPlayerIds.length === 0) {
      logPhoActivity("contract-hydration:skipped", {
        reason: "max-missing-contract-fetches",
        skippedMissingPlayerCount,
      });
    }

    for (const variant of variants) {
      if (fetchableMissingPlayerIds.length === 0) {
        break;
      }

      try {
        const fetchedSnapshots = await runTasksWithConcurrencyLimit(
          fetchableMissingPlayerIds.map((playerId) => async () => {
            try {
              return {
                playerId,
                snapshot: await fetchPhoPlayerContractSnapshot(playerId, variant.value),
              };
            } catch (error) {
              if (error instanceof Error && error.message === "Unauthenticated") {
                throw error;
              }

              return {
                playerId,
                snapshot: null,
              };
            }
          }),
          getPhoContractFetchConcurrency(),
        );

        let didCacheChange = false;
        let fetchedSnapshotCount = 0;

        for (const result of fetchedSnapshots) {
          if (!result.snapshot) {
            continue;
          }

          contractSnapshotsById.set(result.playerId, result.snapshot);
          didCacheChange = true;
          fetchedSnapshotCount += 1;
        }

        if (didCacheChange) {
          await writePhoContractCache(contractSnapshotsById);
        }

        logPhoActivity("contract-hydration:success", {
          authVariant: variant.label,
          fetchedSnapshotCount,
          skippedMissingPlayerCount,
          cacheSize: contractSnapshotsById.size,
        });

        break;
      } catch (error) {
        logPhoFailure("contract-hydration:error", error, {
          authVariant: variant.label,
          fetchableMissingPlayerCount: fetchableMissingPlayerIds.length,
          skippedMissingPlayerCount,
        });

        if (!(error instanceof Error) || error.message !== "Unauthenticated") {
          break;
        }
      }
    }
  }

  let didChange = false;
  const hydratedPlayers = players.map((player) => {
    if (!player.id.startsWith(PHO_PLAYER_ID_PREFIX)) {
      return player;
    }

    const playerId = Number(player.id.slice(PHO_PLAYER_ID_PREFIX.length));
    const snapshot = contractSnapshotsById.get(playerId);

    if (!snapshot) {
      return player;
    }

    if (
      player.capHit === snapshot.capHit &&
      player.yearsRemaining === snapshot.yearsRemaining &&
      (player.contractStatus === "prospect" || player.contractStatus === snapshot.contractStatus)
    ) {
      return player;
    }

    didChange = true;
    return applyContractSnapshot(player, snapshot);
  });

  return didChange ? hydratedPlayers : players;
};

export const hydratePhoDraftPickIssuers = async (draftPicks: DraftPick[]): Promise<DraftPick[]> => {
  const legacyPhoPickIds = draftPicks
    .map((pick) => {
      if (!pick.id.startsWith(PHO_DRAFT_PICK_ID_PREFIX)) {
        return null;
      }

      const numericId = Number(pick.id.slice(PHO_DRAFT_PICK_ID_PREFIX.length));
      return Number.isInteger(numericId) ? numericId : null;
    })
    .filter((pickId): pickId is number => pickId !== null);

  if (legacyPhoPickIds.length === 0) {
    return draftPicks;
  }

  for (const variant of getAuthorizationVariants()) {
    try {
      const seasons = await fetchDraftPicks(variant.value);
      const issuerById = new Map(
        seasons
          .flatMap((season) => season.draft_picks)
          .map((pick) => [pick.id, getDraftPickIssuerLabel(pick, pick.owner?.name ?? "")]),
      );

      let didChange = false;
      const hydratedPicks = draftPicks.map((pick) => {
        if (!pick.id.startsWith(PHO_DRAFT_PICK_ID_PREFIX)) {
          return pick;
        }

        const numericId = Number(pick.id.slice(PHO_DRAFT_PICK_ID_PREFIX.length));
        const issuerTeam = issuerById.get(numericId);

        if (!issuerTeam || issuerTeam === pick.issuerTeam) {
          return pick;
        }

        didChange = true;
        return {
          ...pick,
          issuerTeam,
        };
      });

      return didChange ? hydratedPicks : draftPicks;
    } catch {
      continue;
    }
  }

  return draftPicks;
};

const normalizePhoDraftPicks = (
  seasons: PhoDraftPickSeason[],
  currentTeamId: number,
  currentTeamName: string,
  teamNamesById: Map<number, string>,
): DraftPick[] =>
  seasons
    .flatMap((season) => season.draft_picks)
    .filter((pick) => pick.owner?.id !== undefined)
    .map((pick) => {
      const team =
        pick.owner?.id === currentTeamId
          ? currentTeamName
          : getPhoTeamLabel(pick.owner, teamNamesById) ?? currentTeamName;

      return {
        id: `pho-pick-${pick.id}`,
        team,
        issuerTeam: getDraftPickIssuerLabel(pick, team),
        season: pick.year,
        round: pick.round,
        projectedSlot: pick.rank ?? getDefaultProjectedSlot(),
      };
    })
    .sort(
      (left, right) =>
        left.team.localeCompare(right.team) ||
        left.season - right.season ||
        (left.issuerTeam ?? left.team).localeCompare(right.issuerTeam ?? right.team) ||
        left.round - right.round ||
        left.projectedSlot - right.projectedSlot,
    );

const fetchPlayersPage = async (url: string, authorizationValue: string | null) => {
  const response = await fetchPhoResponse(url, authorizationValue, "players-page");

  const text = await response.text();
  const payload = parseJsonSafely(text);

  if (!response.ok) {
    const errorMessage =
      isRecord(payload) && typeof payload.message === "string"
        ? payload.message
        : `PHO players API request failed with status ${response.status}.`;
    throw new Error(errorMessage);
  }

  if (!isPhoPlayersPage(payload)) {
    throw new Error("PHO players response did not match the expected paginated shape.");
  }

  return { response, payload };
};

const fetchRemainingPlayersPages = async (
  lastPage: number,
  authorizationValue: string | null,
): Promise<PhoPlayersPage[]> => {
  if (lastPage <= 1) {
    return [];
  }

  const pageNumbers = Array.from({ length: lastPage - 1 }, (_, index) => index + 2);
  const concurrency = getPhoPageFetchConcurrency();

  logPhoActivity("players-pagination:start", {
    remainingPageCount: pageNumbers.length,
    concurrency,
  });

  const pages = await runTasksWithConcurrencyLimit(
    pageNumbers.map((pageNumber) => async () => {
      const pageUrl = new URL(getPlayersApiUrl());
      pageUrl.searchParams.set("page", String(pageNumber));
      const nextPage = await fetchPlayersPage(pageUrl.toString(), authorizationValue);
      return nextPage.payload;
    }),
    concurrency,
  );

  logPhoActivity("players-pagination:success", {
    remainingPageCount: pageNumbers.length,
    concurrency,
  });

  return pages;
};

export const importPhoPlayers = async (): Promise<PhoImportResult> => {
  let lastError: Error | null = null;

  for (const variant of getAuthorizationVariants()) {
    const response = await fetchPhoResponse(getPlayersApiUrl(), variant.value, `players-import:${variant.label}`);

    const text = await response.text();
    const payload = parseJsonSafely(text);
    const summary = summarizePayload(payload, response);

    if (response.ok) {
      const rawFilePath = await persistRawPayload(payload);

      return {
        summary,
        rawFilePath,
        authVariant: variant.label,
      };
    }

    const errorMessage =
      isRecord(payload) && typeof payload.message === "string"
        ? payload.message
        : `PHO players API request failed with status ${response.status}.`;

    lastError = new Error(errorMessage);

    if (errorMessage !== "Unauthenticated") {
      break;
    }
  }

  throw lastError ?? new Error("Unexpected PHO import failure.");
};

export const importPhoDashboard = async (): Promise<PhoDashboardImportResult> => {
  let lastError: Error | null = null;

  for (const variant of getAuthorizationVariants()) {
    try {
      const startedAt = Date.now();
      logPhoActivity("dashboard-import:start", {
        authVariant: variant.label,
      });
      const firstPage = await fetchPlayersPage(getPlayersApiUrl(), variant.value);
      const teams = await fetchTeams(variant.value);
      const draftPickSeasons = await fetchDraftPicks(variant.value);
      const teamNamesById = new Map(
        teams.map((team) => [team.id, `${team.city} ${team.name}`.trim()] as const),
      );
      const remainingPages = await fetchRemainingPlayersPages(firstPage.payload.last_page, variant.value);
      const pages: PhoPlayersPage[] = [firstPage.payload, ...remainingPages];

      const allPlayers = pages.flatMap((page) => page.data).filter((player) => !player.is_retired);
      const rawPayload = {
        importedAt: new Date().toISOString(),
        pageCount: pages.length,
        last_page: firstPage.payload.last_page,
        total: allPlayers.length,
        data: allPlayers,
      };
      const rawFilePath = await persistRawPayload(rawPayload);
      const currentTeamName = getCurrentTeamName();
      const normalizedPlayers = await hydratePhoPlayerContracts(
        allPlayers.map((player) => normalizePhoPlayer(player, currentTeamName, teamNamesById)),
        variant.value,
      );
      const roster = normalizedPlayers.filter((player) => player.team === currentTeamName);
      const leagueTargets = normalizedPlayers.filter((player) => player.team !== currentTeamName);
      const currentTeamId = allPlayers.find((player) => player.belongs_to_current_team)?.team_id ?? null;
      const draftPicks = currentTeamId
        ? normalizePhoDraftPicks(draftPickSeasons, currentTeamId, currentTeamName, teamNamesById)
        : await readExistingDraftPicks();

      logPhoActivity("dashboard-import:success", {
        authVariant: variant.label,
        durationMs: Date.now() - startedAt,
        pageCount: pages.length,
        playerCount: normalizedPlayers.length,
        rosterCount: roster.length,
        leagueTargetCount: leagueTargets.length,
      });

      return {
        dashboardInput: {
          teamName: currentTeamName,
          roster,
          leagueTargets,
          draftPicks,
        },
        rawFilePath,
        authVariant: variant.label,
        pageCount: pages.length,
        playerCount: normalizedPlayers.length,
        rosterCount: roster.length,
        leagueTargetCount: leagueTargets.length,
        currentTeamId,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unexpected PHO dashboard import failure.");
      logPhoFailure("dashboard-import:error", lastError, {
        authVariant: variant.label,
      });
      if (lastError.message !== "Unauthenticated") {
        break;
      }
    }
  }

  throw lastError ?? new Error("Unexpected PHO dashboard import failure.");
};

export const getPhoImportConfig = () => ({
  apiUrl: getPlayersApiUrl(),
  rawFilePath: getRawCachePath(),
  contractCachePath: getContractCachePath(),
  pageFetchConcurrency: getPhoPageFetchConcurrency(),
  contractFetchConcurrency: getPhoContractFetchConcurrency(),
  maxMissingContractFetches: getPhoMaxMissingContractFetches(),
  hasBearerToken: Boolean(process.env.PHO_AUTH_BEARER_TOKEN?.trim()),
  authorizationVariants: getAuthorizationVariants().map((variant) => variant.label),
  hasCookie: Boolean(process.env.PHO_AUTH_COOKIE?.trim()),
  hasXsrfToken: Boolean(process.env.PHO_XSRF_TOKEN?.trim()),
});