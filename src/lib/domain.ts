export type Position = "C" | "LW" | "RW" | "LD" | "RD" | "G";

export type ContractStatus = "signed" | "rfa" | "ufa" | "prospect";

export type SimulationStat = {
  key: string;
  value: number;
};

export type RealSeasonStatsLine = {
  gamesPlayed: number;
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

export type RealSeasonHistoryEntry = {
  seasonId: number;
  teamName: string;
  leagueAbbrev: string;
  regularSeason?: RealSeasonStatsLine;
  playoffs?: RealSeasonStatsLine;
};

export type RealSeasonStats = {
  source: "nhl";
  refreshedAt: string;
  seasonId: number;
  gamesPlayed: number;
  valueSignal: number;
  nhlPlayerId: number;
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
  seasonHistory?: RealSeasonHistoryEntry[];
};

export type Player = {
  id: string;
  name: string;
  team: string;
  position: Position;
  role: string;
  age: number;
  capHit: number;
  yearsRemaining: number;
  contractStatus: ContractStatus;
  /** true if the player is assigned to the minor-league club (club école, §3.2.1). */
  inMinors?: boolean;
  performance: number;
  playDriving: number;
  defense: number;
  specialTeams: number;
  chemistryFit: number;
  upside: number;
  simulationStats?: SimulationStat[];
  realSeasonStats?: RealSeasonStats;
};

export type DraftPick = {
  id: string;
  team: string;
  issuerTeam?: string;
  season: number;
  round: number;
  projectedSlot: number;
};

export type DraftOrder = {
  team: string;
  season: number;
  projectedSlot: number;
};

/**
 * Team-level financial figures sourced from PlayHockeyOnline (source of truth).
 * All amounts are in millions of dollars to match `Player.capHit`.
 */
export type TeamFinances = {
  /** Total contract penalties (buyouts §5.4, retained salary §8.2.1). */
  contractPenalties?: number;
  /** Total injured-player cap relief (LTIR-style). */
  injuredRelief?: number;
};

export type DashboardInput = {
  teamName: string;
  roster: Player[];
  leagueTargets: Player[];
  draftPicks: DraftPick[];
  draftOrders?: DraftOrder[];
  finances?: TeamFinances;
};

export type NormalizedDashboardInput = Omit<DashboardInput, "draftOrders"> & {
  draftOrders: DraftOrder[];
};

export type DashboardDataSource = {
  getDashboardInput: () => Promise<NormalizedDashboardInput>;
};

export type DashboardSourceMode = "demo" | "live-file";

export type DashboardSourceInfo = {
  configuredMode: DashboardSourceMode;
  resolvedMode: DashboardSourceMode;
  fallback: boolean;
  detail?: string;
  liveFilePath?: string;
};

export type ResolvedDashboardInput = {
  input: NormalizedDashboardInput;
  source: DashboardSourceInfo;
};