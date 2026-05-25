import type { NormalizedDashboardInput } from "@/lib/domain";
import type { DirectoryPlayer } from "@/lib/player-directory";
import {
  getTeamDirectoryEntries,
  getTeamPicks,
  getTeamPlayers,
  type DirectoryTeam,
  type TeamDirectoryPick,
} from "@/lib/team-directory";
import { assessTeam, type TeamAssessment, type TradeValueSignals } from "@/lib/valuation";

export type WorkbenchAsset = {
  assetId: string;
  kind: "player" | "pick";
  id: string;
  teamName: string;
  label: string;
  subtitle: string;
  score: number;
  player?: DirectoryPlayer;
  pick?: TeamDirectoryPick;
};

export type WorkbenchTeam = {
  team: DirectoryTeam;
  players: DirectoryPlayer[];
  picks: TeamDirectoryPick[];
  assets: WorkbenchAsset[];
};

export type TradePackageSummary = {
  assetCount: number;
  playerCount: number;
  pickCount: number;
  totalScore: number;
};

export type TradeWorkbenchImpact = {
  before: TeamAssessment;
  after: TeamAssessment;
  rosterDelta: number;
  pickValueBefore: number;
  pickValueAfter: number;
  pickValueDelta: number;
  playerCountBefore: number;
  playerCountAfter: number;
  pickCountBefore: number;
  pickCountAfter: number;
};

const buildPlayerAsset = (player: DirectoryPlayer): WorkbenchAsset => ({
  assetId: `player:${player.id}`,
  kind: "player",
  id: player.id,
  teamName: player.team,
  label: player.name,
  subtitle: `${player.position} / ${player.market} / $${player.capHit.toFixed(1)}M`,
  score: player.score,
  player,
});

const buildPickAsset = (pick: TeamDirectoryPick): WorkbenchAsset => ({
  assetId: `pick:${pick.id}`,
  kind: "pick",
  id: pick.id,
  teamName: pick.team,
  label: `${pick.season} Round ${pick.round}`,
  subtitle: `Projected slot ${pick.projectedSlot}${pick.issuerTeam && pick.issuerTeam !== pick.team ? ` / ${pick.issuerTeam}` : ""}`,
  score: pick.score,
  pick,
});

export const buildWorkbenchTeams = (
  input: NormalizedDashboardInput,
  players: DirectoryPlayer[],
  tradeValueSignals?: TradeValueSignals,
): WorkbenchTeam[] => {
  const teams = getTeamDirectoryEntries(input, players, tradeValueSignals);

  return teams.map((team) => {
    const teamPlayers = getTeamPlayers(players, team.name);
    const teamPicks = getTeamPicks(input, team.name, tradeValueSignals);

    return {
      team,
      players: teamPlayers,
      picks: teamPicks,
      assets: [...teamPlayers.map(buildPlayerAsset), ...teamPicks.map(buildPickAsset)].sort(
        (left, right) => right.score - left.score || left.label.localeCompare(right.label),
      ),
    };
  });
};

export const summarizeTradePackage = (assets: WorkbenchAsset[]): TradePackageSummary => ({
  assetCount: assets.length,
  playerCount: assets.filter((asset) => asset.kind === "player").length,
  pickCount: assets.filter((asset) => asset.kind === "pick").length,
  totalScore: Math.round(assets.reduce((total, asset) => total + asset.score, 0)),
});

export const evaluateTradeImpact = (
  team: WorkbenchTeam,
  outgoingAssets: WorkbenchAsset[],
  incomingAssets: WorkbenchAsset[],
): TradeWorkbenchImpact => {
  const outgoingPlayerIds = new Set(outgoingAssets.filter((asset) => asset.kind === "player").map((asset) => asset.id));
  const outgoingPickIds = new Set(outgoingAssets.filter((asset) => asset.kind === "pick").map((asset) => asset.id));
  const incomingPlayers = incomingAssets.flatMap((asset) => (asset.player ? [asset.player] : []));
  const incomingPicks = incomingAssets.flatMap((asset) => (asset.pick ? [asset.pick] : []));
  const afterPlayers = [...team.players.filter((player) => !outgoingPlayerIds.has(player.id)), ...incomingPlayers];
  const afterPicks = [...team.picks.filter((pick) => !outgoingPickIds.has(pick.id)), ...incomingPicks];
  const before = assessTeam(team.players);
  const after = assessTeam(afterPlayers);
  const pickValueBefore = Math.round(team.picks.reduce((total, pick) => total + pick.score, 0));
  const pickValueAfter = Math.round(afterPicks.reduce((total, pick) => total + pick.score, 0));

  return {
    before,
    after,
    rosterDelta: after.overall - before.overall,
    pickValueBefore,
    pickValueAfter,
    pickValueDelta: pickValueAfter - pickValueBefore,
    playerCountBefore: team.players.length,
    playerCountAfter: afterPlayers.length,
    pickCountBefore: team.picks.length,
    pickCountAfter: afterPicks.length,
  };
};