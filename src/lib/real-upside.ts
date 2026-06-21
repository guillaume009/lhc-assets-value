import type { Player, RealSeasonHistoryEntry, RealSeasonStatsLine } from "@/lib/domain";

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const normalizeToScore = (value: number, min: number, max: number) =>
  clamp(((value - min) / (max - min)) * 100, 0, 100);

const normalizeInverseToScore = (value: number, min: number, max: number) =>
  clamp(100 - normalizeToScore(value, min, max), 0, 100);

export type RealUpsideProfile = {
  baseUpside: number;
  adjustedUpside: number;
  currentSignal: number;
  baselineSignal: number;
  trend: number;
  confidence: number;
  adjustment: number;
};

const getCurrentSeasonLine = (player: Player): RealSeasonStatsLine | null => {
  if (!player.realSeasonStats) {
    return null;
  }

  return {
    gamesPlayed: player.realSeasonStats.gamesPlayed,
    pim: player.realSeasonStats.pim,
    goals: player.realSeasonStats.goals,
    assists: player.realSeasonStats.assists,
    points: player.realSeasonStats.points,
    plusMinus: player.realSeasonStats.plusMinus,
    powerPlayPoints: player.realSeasonStats.powerPlayPoints,
    shots: player.realSeasonStats.shots,
    shootingPctg: player.realSeasonStats.shootingPctg,
    wins: player.realSeasonStats.wins,
    savePctg: player.realSeasonStats.savePctg,
    goalsAgainstAvg: player.realSeasonStats.goalsAgainstAvg,
    shutouts: player.realSeasonStats.shutouts,
  };
};

const getRegularSeasonHistory = (entries: RealSeasonHistoryEntry[] | undefined) =>
  (entries ?? []).map((entry) => entry.regularSeason).filter((entry): entry is RealSeasonStatsLine => Boolean(entry));

const getSkaterSeasonSignal = (line: RealSeasonStatsLine) => {
  const gamesPlayed = Math.max(line.gamesPlayed, 0);

  if (gamesPlayed <= 0) {
    return null;
  }

  const goals = line.goals ?? 0;
  const assists = line.assists ?? 0;
  const points = line.points ?? goals + assists;
  const shots = line.shots ?? 0;
  const shootingPctg = line.shootingPctg ?? (shots > 0 ? goals / shots : 0);
  const plusMinus = line.plusMinus ?? 0;

  return Math.round(
    clamp(
      normalizeToScore(points / gamesPlayed, 0.15, 1.35) * 0.45 +
        normalizeToScore(goals / gamesPlayed, 0.03, 0.6) * 0.15 +
        normalizeToScore(shots / gamesPlayed, 0.5, 4.5) * 0.1 +
        normalizeToScore(plusMinus / gamesPlayed, -0.4, 0.4) * 0.1 +
        normalizeToScore(shootingPctg, 0.05, 0.2) * 0.1 +
        normalizeToScore(gamesPlayed, 10, 82) * 0.1,
      0,
      100,
    ),
  );
};

const getGoalieSeasonSignal = (line: RealSeasonStatsLine) => {
  const gamesPlayed = Math.max(line.gamesPlayed, 0);

  if (gamesPlayed <= 0) {
    return null;
  }

  return Math.round(
    clamp(
      normalizeToScore(line.savePctg ?? 0.9, 0.885, 0.925) * 0.48 +
        normalizeInverseToScore(line.goalsAgainstAvg ?? 2.8, 1.9, 3.6) * 0.28 +
        normalizeToScore((line.wins ?? 0) / gamesPlayed, 0.3, 0.7) * 0.14 +
        normalizeToScore((line.shutouts ?? 0) / gamesPlayed, 0, 0.12) * 0.05 +
        normalizeToScore(gamesPlayed, 8, 62) * 0.05,
      0,
      100,
    ),
  );
};

const getSeasonSignal = (player: Player, line: RealSeasonStatsLine) =>
  player.position === "G" ? getGoalieSeasonSignal(line) : getSkaterSeasonSignal(line);

const getAgeLeverage = (player: Player) => {
  if (player.contractStatus === "prospect" || player.age <= 22) {
    return 1.15;
  }

  if (player.age <= 24) {
    return 1;
  }

  if (player.age <= 26) {
    return 0.82;
  }

  if (player.age <= 28) {
    return 0.6;
  }

  if (player.age <= 30) {
    return 0.35;
  }

  return 0.18;
};

export const getRealUpsideProfile = (player: Player): RealUpsideProfile | null => {
  const currentLine = getCurrentSeasonLine(player);

  if (!currentLine || currentLine.gamesPlayed <= 0) {
    return null;
  }

  const currentSignal = getSeasonSignal(player, currentLine);

  if (currentSignal === null) {
    return null;
  }

  const regularSeasonHistory = getRegularSeasonHistory(player.realSeasonStats?.seasonHistory).slice(1, 4);
  const baselineCandidates = regularSeasonHistory
    .map((line) => ({
      line,
      signal: getSeasonSignal(player, line),
    }))
    .filter((entry): entry is { line: RealSeasonStatsLine; signal: number } => entry.signal !== null && entry.line.gamesPlayed > 0);

  const baselineSignal =
    baselineCandidates.length === 0
      ? player.upside
      : Math.round(
          baselineCandidates.reduce((total, entry) => total + entry.signal * entry.line.gamesPlayed, 0) /
            Math.max(baselineCandidates.reduce((total, entry) => total + entry.line.gamesPlayed, 0), 1),
        );
  const currentSampleConfidence = clamp(currentLine.gamesPlayed / (player.position === "G" ? 22 : 30), 0, 1);
  const historyGames = baselineCandidates.reduce((total, entry) => total + entry.line.gamesPlayed, 0);
  const historyConfidence =
    baselineCandidates.length === 0 ? 0.42 : clamp(historyGames / (player.position === "G" ? 55 : 110), 0.45, 1);
  const confidence = Number((currentSampleConfidence * historyConfidence).toFixed(2));
  const trend = currentSignal - baselineSignal;
  const adjustment = Math.round(clamp(trend * getAgeLeverage(player) * confidence * 0.32, -10, 14));
  const adjustedUpside = Math.round(clamp(player.upside + adjustment, 0, 100));

  return {
    baseUpside: player.upside,
    adjustedUpside,
    currentSignal,
    baselineSignal,
    trend,
    confidence,
    adjustment,
  };
};