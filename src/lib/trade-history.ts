import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { DraftPick, Player, Position } from "@/lib/domain";
import { scorePick, scorePlayer, type TradeValueSignals } from "@/lib/valuation";

const DEFAULT_TRADES_API_URL = "https://playhockeyonline.com/api/trades";
const DEFAULT_TRADES_CACHE_PATH = path.join(process.cwd(), "data", "playhockeyonline-trades.raw.json");
const TRADE_HISTORY_CACHE_TTL_MS = 300_000;
const SLOW_TRADE_HISTORY_READ_THRESHOLD_MS = 1_000;
const PHO_PLAYER_ID_PREFIX = "pho-";
const PHO_PICK_ID_PREFIX = "pho-pick-";
const DEFAULT_PROJECTED_SLOT = 16;

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

type PhoTradeTeam = {
  id: number;
  name: string;
  city: string;
};

type PhoTradePlayer = {
  id: number;
  team_id: number | null;
  name: string;
  is_prospect: boolean;
  computed_age: number | null;
  years_left_before_Ufa: number | null;
  base_free_agent_salary: number | null;
  position_id: number | null;
  positions: PhoPosition[];
  player_stats: PhoPlayerStat[];
};

type PhoTradeDraftPick = {
  id: number;
  round: number;
  year: number;
  rank: number | null;
  issuer_name: string | null;
  issuer?: PhoTradeTeam | null;
};

type PhoTradeProspect = {
  id: number;
  name: string;
};

type PhoTradeDetail = {
  id: number;
  player_id: number | null;
  draft_pick_id: number | null;
  prospect_id: number | null;
  trade_detail_type?: {
    id: number;
    name: string;
  } | null;
  player?: PhoTradePlayer | null;
  prospect?: PhoTradeProspect | null;
  draft_pick?: PhoTradeDraftPick | null;
};

type PhoTeamTrade = {
  id: number;
  trade_id: number;
  team_id: number;
  comments: string;
  payroll_after_trade: number | null;
  team?: PhoTradeTeam | null;
  trade_details: PhoTradeDetail[];
};

type PhoTrade = {
  id: number;
  created_at: string;
  updated_at: string;
  approved_at: string | null;
  is_approved: boolean;
  is_rejected: boolean;
  is_frozen: boolean;
  is_waiting_for_approval: boolean;
  team_trades: PhoTeamTrade[];
};

type PhoTradesPage = {
  current_page: number;
  data: PhoTrade[];
  last_page: number;
  next_page_url: string | null;
  total: number;
};

type TradeAssetType = "player" | "draft_pick" | "prospect" | "unknown";

export type TradeAssetSummary = {
  id: string;
  label: string;
  description?: string;
  type: TradeAssetType;
  score: number | null;
  playerId?: string;
  pickId?: string;
};

export type TradeSideSummary = {
  id: string;
  teamName: string;
  comments: string;
  payrollAfterTrade: number | null;
  assets: TradeAssetSummary[];
  assetScoreTotal: number;
};

export type TradeRecord = {
  id: number;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  teams: string[];
  sides: TradeSideSummary[];
};

export type TradeHistoryData = {
  trades: TradeRecord[];
  valueSignals: TradeValueSignals;
};

type TradeImportResult = {
  authVariant: string;
  pageCount: number;
  rawFilePath: string;
  tradeCount: number;
};

export const getPhoTradeImportConfig = () => ({
  apiUrl: getTradesApiUrl(),
  rawFilePath: getTradesCachePath(),
  hasBearerToken: Boolean(process.env.PHO_AUTH_BEARER_TOKEN?.trim()),
  authorizationVariants: getAuthorizationVariants().map((variant) => variant.label),
  hasCookie: Boolean(process.env.PHO_AUTH_COOKIE?.trim()),
  hasXsrfToken: Boolean(process.env.PHO_XSRF_TOKEN?.trim()),
});

let tradeHistoryCache:
  | {
      filePath: string;
      mtimeMs: number;
      size: number;
      expiresAt: number;
      data: TradeHistoryData;
    }
  | null = null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const logTradeHistoryActivity = (event: string, details: Record<string, unknown>) => {
  console.info(`[trade-history] ${event}`, details);
};

const logTradeHistoryFailure = (event: string, error: unknown, details: Record<string, unknown>) => {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`[trade-history] ${event}`, {
    ...details,
    error: message,
  });
};

const getTradesApiUrl = () => process.env.PHO_TRADES_API_URL?.trim() || DEFAULT_TRADES_API_URL;

const getTradesCachePath = () =>
  process.env.PHO_TRADES_RAW_PATH?.trim() || DEFAULT_TRADES_CACHE_PATH;

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

const roundCapHitMillions = (salary: number) => Math.round((salary / 1_000_000) * 100) / 100;

const getTradeTeamLabel = (team: PhoTradeTeam | null | undefined, fallback = "Unknown team") => {
  if (!team) {
    return fallback;
  }

  return [team.city, team.name].filter(Boolean).join(" ").trim() || fallback;
};

const getStatValue = (player: PhoTradePlayer, key: string, fallback = 50) =>
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
    case "defense":
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

const getPrimaryPosition = (player: PhoTradePlayer): Position => {
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

const mapContractStatus = (player: PhoTradePlayer): Player["contractStatus"] => {
  if (player.is_prospect) {
    return "prospect";
  }

  if ((player.years_left_before_Ufa ?? 0) <= 0) {
    return "ufa";
  }

  return "signed";
};

const normalizeTradePlayer = (player: PhoTradePlayer, teamName: string): Player => {
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
    id: `${PHO_PLAYER_ID_PREFIX}${player.id}`,
    name: player.name,
    team: teamName,
    position,
    role: buildRoleLabel(position, overall, player.is_prospect),
    age: player.computed_age ?? 18,
    capHit: roundCapHitMillions(player.base_free_agent_salary ?? 775000),
    yearsRemaining: Math.max(player.years_left_before_Ufa ?? 0, 0),
    contractStatus: mapContractStatus(player),
    performance: clamp(Math.round(overall * 0.55 + scoring * 0.3 + passing * 0.15), 0, 100),
    playDriving: clamp(Math.round(passing * 0.4 + puckControl * 0.35 + skating * 0.25), 0, 100),
    defense: clamp(Math.round(defense * 0.5 + checking * 0.3 + discipline * 0.2), 0, 100),
    specialTeams: clamp(Math.round(scoring * 0.35 + penaltyShot * 0.2 + endurance * 0.25 + faceOff * 0.2), 0, 100),
    chemistryFit: clamp(Math.round(leadership * 0.45 + morale * 0.35 + discipline * 0.2), 0, 100),
    upside: clamp(Math.round(potential), 0, 100),
  };
};

const getIssuerTeamLabel = (pick: PhoTradeDraftPick) => {
  if (pick.issuer) {
    return getTradeTeamLabel(pick.issuer, pick.issuer_name?.trim() || "Unknown issuer");
  }

  return pick.issuer_name?.trim() || "Unknown issuer";
};

const normalizeTradePick = (pick: PhoTradeDraftPick): DraftPick => ({
  id: `${PHO_PICK_ID_PREFIX}${pick.id}`,
  team: getIssuerTeamLabel(pick),
  issuerTeam: getIssuerTeamLabel(pick),
  season: pick.year,
  round: pick.round,
  projectedSlot: pick.rank ?? DEFAULT_PROJECTED_SLOT,
});

const buildTradeAssetSummary = (detail: PhoTradeDetail, sideTeamName: string): TradeAssetSummary => {
  const detailType = detail.trade_detail_type?.name;

  if (detailType === "player" && detail.player) {
    const normalizedPlayer = normalizeTradePlayer(detail.player, sideTeamName);
    return {
      id: `player-${detail.player.id}`,
      label: detail.player.name,
      description: `${normalizedPlayer.position} / ${normalizedPlayer.role}`,
      type: "player",
      score: scorePlayer(normalizedPlayer),
      playerId: normalizedPlayer.id,
    };
  }

  if (detailType === "draft_pick" && detail.draft_pick) {
    const normalizedPick = normalizeTradePick(detail.draft_pick);
    const issuerTeam = getIssuerTeamLabel(detail.draft_pick);

    return {
      id: `pick-${detail.draft_pick.id}`,
      label: `${detail.draft_pick.year} Round ${detail.draft_pick.round}`,
      description: issuerTeam,
      type: "draft_pick",
      score: scorePick(normalizedPick),
      pickId: normalizedPick.id,
    };
  }

  if (detailType === "prospect") {
    return {
      id: `prospect-${detail.prospect?.id ?? detail.prospect_id ?? detail.id}`,
      label: detail.prospect?.name ?? "Prospect rights",
      type: "prospect",
      score: null,
    };
  }

  return {
    id: `detail-${detail.id}`,
    label: "Untracked asset",
    type: "unknown",
    score: null,
  };
};

const normalizeTradeRecord = (trade: PhoTrade): TradeRecord => {
  const sides = trade.team_trades.map((teamTrade) => {
    const teamName = getTradeTeamLabel(teamTrade.team, `Team ${teamTrade.team_id}`);
    const assets = teamTrade.trade_details.map((detail) => buildTradeAssetSummary(detail, teamName));
    const assetScoreTotal = Math.round(
      assets.reduce((total, asset) => total + (asset.score ?? 0), 0),
    );

    return {
      id: `${trade.id}-${teamTrade.id}`,
      teamName,
      comments: teamTrade.comments?.trim() || "",
      payrollAfterTrade: teamTrade.payroll_after_trade,
      assets,
      assetScoreTotal,
    } satisfies TradeSideSummary;
  });

  return {
    id: trade.id,
    createdAt: trade.created_at,
    updatedAt: trade.updated_at,
    approvedAt: trade.approved_at,
    teams: sides.map((side) => side.teamName),
    sides,
  };
};

const buildTradeValueSignals = (trades: TradeRecord[]): TradeValueSignals => {
  const playerValues = new Map<string, number[]>();
  const pickValues = new Map<string, number[]>();

  for (const trade of trades) {
    for (const side of trade.sides) {
      const otherSideValue = trade.sides
        .filter((candidate) => candidate.id !== side.id)
        .reduce((total, candidate) => total + candidate.assetScoreTotal, 0);
      const scoredAssets = side.assets.filter((asset) => asset.score !== null && (asset.playerId || asset.pickId));

      if (otherSideValue <= 0 || scoredAssets.length === 0) {
        continue;
      }

      const observedValue = Math.round((otherSideValue / scoredAssets.length) * 100) / 100;

      for (const asset of scoredAssets) {
        if (asset.playerId) {
          playerValues.set(asset.playerId, [...(playerValues.get(asset.playerId) ?? []), observedValue]);
        }

        if (asset.pickId) {
          pickValues.set(asset.pickId, [...(pickValues.get(asset.pickId) ?? []), observedValue]);
        }
      }
    }
  }

  const toAverageRecord = (entries: Map<string, number[]>) =>
    Object.fromEntries(
      [...entries.entries()].map(([assetId, values]) => [
        assetId,
        Math.round((values.reduce((total, value) => total + value, 0) / Math.max(values.length, 1)) * 100) / 100,
      ]),
    );

  return {
    playerHistoricalScores: toAverageRecord(playerValues),
    pickHistoricalScores: toAverageRecord(pickValues),
  };
};

const fetchTradesPage = async (pageNumber: number, authorizationValue: string | null) => {
  const url = new URL(getTradesApiUrl());
  url.searchParams.set("page", String(pageNumber));

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: buildRequestHeaders(authorizationValue),
    cache: "no-store",
  });

  const text = await response.text();
  const payload = parseJsonSafely(text);

  if (!response.ok) {
    const errorMessage =
      isRecord(payload) && typeof payload.message === "string"
        ? payload.message
        : `PHO trades API request failed with status ${response.status}.`;
    throw new Error(errorMessage);
  }

  if (
    !isRecord(payload) ||
    typeof payload.current_page !== "number" ||
    typeof payload.last_page !== "number" ||
    !Array.isArray(payload.data)
  ) {
    throw new Error("PHO trades response did not match the expected paginated shape.");
  }

  return payload as PhoTradesPage;
};

const persistTradePayload = async (payload: unknown) => {
  const rawFilePath = getTradesCachePath();
  await mkdir(path.dirname(rawFilePath), { recursive: true });
  await writeFile(rawFilePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return rawFilePath;
};

const normalizeTradeHistory = (payload: unknown): TradeHistoryData => {
  if (!isRecord(payload) || !Array.isArray(payload.data)) {
    return {
      trades: [],
      valueSignals: {
        playerHistoricalScores: {},
        pickHistoricalScores: {},
      },
    };
  }

  const trades = payload.data
    .filter((trade): trade is PhoTrade => isRecord(trade) && typeof trade.id === "number" && Array.isArray(trade.team_trades))
    .map(normalizeTradeRecord)
    .sort(
      (left, right) =>
        new Date(right.approvedAt ?? right.createdAt).getTime() - new Date(left.approvedAt ?? left.createdAt).getTime() ||
        right.id - left.id,
    );

  return {
    trades,
    valueSignals: buildTradeValueSignals(trades),
  };
};

export const refreshPhoTradeCache = async (): Promise<TradeImportResult> => {
  let lastError: Error | null = null;

  for (const variant of getAuthorizationVariants()) {
    try {
      const firstPage = await fetchTradesPage(1, variant.value);
      const pages: PhoTradesPage[] = [firstPage];

      for (let pageNumber = 2; pageNumber <= firstPage.last_page; pageNumber += 1) {
        pages.push(await fetchTradesPage(pageNumber, variant.value));
      }

      const allTrades = pages.flatMap((page) => page.data);
      const rawFilePath = await persistTradePayload({
        importedAt: new Date().toISOString(),
        pageCount: pages.length,
        total: allTrades.length,
        data: allTrades,
      });

      tradeHistoryCache = null;

      return {
        authVariant: variant.label,
        pageCount: pages.length,
        rawFilePath,
        tradeCount: allTrades.length,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unexpected PHO trade import failure.");

      if (lastError.message !== "Unauthenticated") {
        break;
      }
    }
  }

  throw lastError ?? new Error("Unexpected PHO trade import failure.");
};

export const loadTradeHistory = async (): Promise<TradeHistoryData> => {
  const filePath = getTradesCachePath();
  const startedAt = Date.now();

  try {
    const fileStats = await stat(filePath);
    const cachedTradeHistory = tradeHistoryCache;

    if (
      cachedTradeHistory &&
      cachedTradeHistory.filePath === filePath &&
      cachedTradeHistory.mtimeMs === fileStats.mtimeMs &&
      cachedTradeHistory.size === fileStats.size &&
      cachedTradeHistory.expiresAt > Date.now()
    ) {
      const durationMs = Date.now() - startedAt;

      if (durationMs >= SLOW_TRADE_HISTORY_READ_THRESHOLD_MS) {
        logTradeHistoryActivity("load:cache-hit", {
          durationMs,
          filePath,
          size: fileStats.size,
        });
      }

      return cachedTradeHistory.data;
    }

    const raw = await readFile(filePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    const data = normalizeTradeHistory(parsed);

    tradeHistoryCache = {
      filePath,
      mtimeMs: fileStats.mtimeMs,
      size: fileStats.size,
      expiresAt: Date.now() + TRADE_HISTORY_CACHE_TTL_MS,
      data,
    };

    const durationMs = Date.now() - startedAt;

    if (durationMs >= SLOW_TRADE_HISTORY_READ_THRESHOLD_MS) {
      logTradeHistoryActivity("load:slow", {
        durationMs,
        filePath,
        size: fileStats.size,
        tradeCount: data.trades.length,
      });
    }

    return data;
  } catch (error) {
    logTradeHistoryFailure("load:fallback", error, {
      durationMs: Date.now() - startedAt,
      filePath,
    });

    return {
      trades: [],
      valueSignals: {
        playerHistoricalScores: {},
        pickHistoricalScores: {},
      },
    };
  }
};

export const getTradesForPlayer = (tradeHistory: TradeHistoryData, playerId: string) =>
  tradeHistory.trades.filter((trade) =>
    trade.sides.some((side) => side.assets.some((asset) => asset.playerId === playerId)),
  );

export const getTradesForTeam = (tradeHistory: TradeHistoryData, teamName: string) =>
  tradeHistory.trades.filter((trade) => trade.teams.includes(teamName));
