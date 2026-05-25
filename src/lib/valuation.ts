import type { DraftPick, NormalizedDashboardInput, Player, Position } from "@/lib/domain";
import { applyDraftOrdersToPicks } from "@/lib/draft-pick-order";

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

type TeamBucket = "forward" | "defense" | "goalie";

export type ExtensionAdvice = {
  label: string;
  detail: string;
};

export type TradeValueSignals = {
  playerHistoricalScores: Record<string, number>;
  pickHistoricalScores: Record<string, number>;
};

export const DEFAULT_TRADE_SIGNAL_WEIGHT = 0.15;

export type RosterScore = Player & {
  score: number;
  market: string;
  extension: ExtensionAdvice;
};

export type TeamBucketScore = {
  bucket: TeamBucket;
  score: number;
  count: number;
};

export type TeamAssessment = {
  overall: number;
  strongest: TeamBucketScore;
  weakest: TeamBucketScore;
  prospectCount: number;
  bucketScores: TeamBucketScore[];
};

export type TradeTarget = Player & {
  score: number;
  fitScore: number;
};

export type PickScore = DraftPick & {
  score: number;
};

export type DashboardSnapshot = {
  teamName: string;
  rosterScores: RosterScore[];
  team: TeamAssessment;
  targets: TradeTarget[];
  picks: PickScore[];
};

const ageScore = (player: Player) => {
  if (player.contractStatus === "prospect") {
    return clamp(70 + (23 - player.age) * 6, 40, 95);
  }

  const distanceFromPrime = Math.abs(player.age - 26);
  return clamp(94 - distanceFromPrime * 5, 38, 94);
};

const capEfficiency = (player: Player) => {
  const estimatedMarketHit = player.performance / 11.5;
  const savings = estimatedMarketHit - player.capHit;

  return clamp(55 + savings * 9, 20, 95);
};

export const getTradeSignalWeight = () => {
  const configuredValue = process.env.NHL_SIM_TRADE_SIGNAL_WEIGHT?.trim();

  if (!configuredValue) {
    return DEFAULT_TRADE_SIGNAL_WEIGHT;
  }

  const parsedValue = Number(configuredValue);

  if (!Number.isFinite(parsedValue)) {
    return DEFAULT_TRADE_SIGNAL_WEIGHT;
  }

  return clamp(parsedValue, 0, 1);
};

const blendTradeSignal = (baseScore: number, signal: number | undefined) => {
  if (!isFinite(signal ?? Number.NaN)) {
    return baseScore;
  }

  const tradeSignalWeight = getTradeSignalWeight();
  const baseWeight = 1 - tradeSignalWeight;

  return Math.round(clamp(baseScore * baseWeight + (signal ?? 0) * tradeSignalWeight, 0, 100));
};

export const scorePlayer = (player: Player, tradeValueSignals?: TradeValueSignals) => {
  const score =
    player.performance * 0.29 +
    player.playDriving * 0.16 +
    player.defense * 0.14 +
    player.specialTeams * 0.08 +
    player.chemistryFit * 0.12 +
    player.upside * 0.11 +
    ageScore(player) * 0.06 +
    capEfficiency(player) * 0.04;

  return blendTradeSignal(Math.round(clamp(score, 0, 100)), tradeValueSignals?.playerHistoricalScores[player.id]);
};

export const marketLabel = (score: number) => {
  if (score >= 85) return "Franchise asset";
  if (score >= 76) return "Core piece";
  if (score >= 66) return "Strong trade chip";
  if (score >= 56) return "Useful roster asset";
  return "Depth or speculative asset";
};

export const tradeRange = (score: number) => {
  if (score >= 85) return "Equivalent to elite young player or premium 1st + add";
  if (score >= 76) return "1st-round pick plus roster player";
  if (score >= 66) return "Late 1st or multiple 2nds";
  if (score >= 56) return "2nd-round value band";
  return "3rd-round or swing asset";
};

export const extensionAdvice = (player: Player, tradeValueSignals?: TradeValueSignals) => {
  const score = scorePlayer(player, tradeValueSignals);
  const efficiency = capEfficiency(player);

  if (player.contractStatus === "prospect") {
    return {
      label: "Keep on development path",
      detail: "Do not force a long-term projection yet; monitor role growth and special-teams usage.",
    };
  }

  if ((player.contractStatus === "ufa" || player.contractStatus === "rfa") && score >= 74 && player.age <= 30) {
    return {
      label: player.age <= 27 ? "Prioritize extension" : "Extension makes sense at the right term",
      detail:
        efficiency >= 60
          ? "Current production and cost profile support keeping this player before the market gets expensive."
          : "Retain if term stays controlled; avoid paying future decline years.",
    };
  }

  if (player.contractStatus === "ufa" && (score < 70 || player.age > 31)) {
    return {
      label: "Test the market",
      detail: "Explore trade value before committing term; aging curve risk is starting to outweigh certainty.",
    };
  }

  return {
    label: "Hold current contract",
    detail: "Value is stable enough that you can wait for more information before committing.",
  };
};

const positionBucket: Record<Position, TeamBucket> = {
  C: "forward",
  LW: "forward",
  RW: "forward",
  LD: "defense",
  RD: "defense",
  G: "goalie",
};

export const assessTeam = (players: Player[], tradeValueSignals?: TradeValueSignals) => {
  const scored = players.map((player) => ({
    ...player,
    score: scorePlayer(player, tradeValueSignals),
  }));

  const average =
    scored.length === 0
      ? 0
      : Math.round(scored.reduce((total, player) => total + player.score, 0) / scored.length);

  const byBucket = {
    forward: scored.filter((player) => positionBucket[player.position] === "forward"),
    defense: scored.filter((player) => positionBucket[player.position] === "defense"),
    goalie: scored.filter((player) => positionBucket[player.position] === "goalie"),
  };

  const bucketScores: TeamBucketScore[] = ([
    ["forward", byBucket.forward],
    ["defense", byBucket.defense],
    ["goalie", byBucket.goalie],
  ] as const).map(([bucket, bucketPlayers]) => ({
    bucket,
    score: Math.round(
      bucketPlayers.reduce((total, player) => total + player.score, 0) /
        Math.max(bucketPlayers.length, 1),
    ),
    count: bucketPlayers.length,
  }));

  const weakest = [...bucketScores].sort((left, right) => left.score - right.score)[0];
  const strongest = [...bucketScores].sort((left, right) => right.score - left.score)[0];
  const prospectCount = players.filter((player) => player.contractStatus === "prospect").length;

  return {
    overall: average,
    strongest,
    weakest,
    prospectCount,
    bucketScores,
  };
};

export const scorePick = (pick: DraftPick, tradeValueSignals?: TradeValueSignals) => {
  const roundBase = [0, 92, 67, 43, 28, 18, 11, 7][pick.round] ?? 5;
  const slotPenalty = Math.min((pick.projectedSlot - 1) * 1.4, roundBase * 0.42);
  const yearDiscount = (pick.season - new Date().getFullYear()) * 6;

  return blendTradeSignal(
    Math.round(clamp(roundBase - slotPenalty - yearDiscount, 4, 95)),
    tradeValueSignals?.pickHistoricalScores[pick.id],
  );
};

export const findTargets = (roster: Player[], targets: Player[], tradeValueSignals?: TradeValueSignals) => {
  const team = assessTeam(roster, tradeValueSignals);
  const need = team.weakest.bucket;

  return targets
    .map((player) => {
      const score = scorePlayer(player, tradeValueSignals);
      const needBoost =
        (need === "defense" && (player.position === "LD" || player.position === "RD")) ||
        (need === "forward" && ["C", "LW", "RW"].includes(player.position)) ||
        (need === "goalie" && player.position === "G")
          ? 8
          : 0;

      return {
        ...player,
        score,
        fitScore: clamp(score + needBoost + Math.round(player.chemistryFit * 0.08), 0, 100),
      };
    })
    .sort((left, right) => right.fitScore - left.fitScore)
    .slice(0, 3);
};

export const getDashboardSnapshot = ({
  teamName,
  roster,
  leagueTargets,
  draftPicks,
  draftOrders,
}: NormalizedDashboardInput, tradeValueSignals?: TradeValueSignals): DashboardSnapshot => {
  const rosterScores = roster.map((player) => {
    const score = scorePlayer(player, tradeValueSignals);

    return {
      ...player,
      score,
      market: marketLabel(score),
      extension: extensionAdvice(player, tradeValueSignals),
    };
  });

  const picks = applyDraftOrdersToPicks(draftPicks, draftOrders).map((pick) => ({
    ...pick,
    score: scorePick(pick, tradeValueSignals),
  }));

  const team = assessTeam(roster, tradeValueSignals);

  return {
    teamName,
    rosterScores,
    team,
    targets: findTargets(roster, leagueTargets, tradeValueSignals),
    picks,
  };
};