export type Position = "C" | "LW" | "RW" | "LD" | "RD" | "G";

export type ContractStatus = "signed" | "rfa" | "ufa" | "prospect";

export type SimulationStat = {
  key: string;
  value: number;
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
  performance: number;
  playDriving: number;
  defense: number;
  specialTeams: number;
  chemistryFit: number;
  upside: number;
  simulationStats?: SimulationStat[];
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

export type DashboardInput = {
  teamName: string;
  roster: Player[];
  leagueTargets: Player[];
  draftPicks: DraftPick[];
  draftOrders?: DraftOrder[];
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