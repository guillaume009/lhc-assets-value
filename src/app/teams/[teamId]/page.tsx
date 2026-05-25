import type { Metadata } from "next";
import { notFound } from "next/navigation";

import type { SourceHoverSummary } from "@/app/source-hover-label";
import { TeamProfileShell } from "@/app/teams/[teamId]/team-profile-shell";
import { loadDashboardInput } from "@/lib/dashboard-data-source";
import { getDirectoryPlayers } from "@/lib/player-directory";
import { getTradesForTeam, loadTradeHistory } from "@/lib/trade-history";
import {
  getDirectoryTeam,
  getTeamDirectoryEntries,
  getTeamNameFromId,
  getTeamPicks,
  getTeamPlayers,
} from "@/lib/team-directory";
import { assessTeam } from "@/lib/valuation";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ teamId: string }>;
}): Promise<Metadata> {
  const { teamId } = await params;
  const [{ input }, tradeHistory] = await Promise.all([loadDashboardInput(), loadTradeHistory()]);
  const players = getDirectoryPlayers(input, tradeHistory.valueSignals);
  const teams = getTeamDirectoryEntries(input, players, tradeHistory.valueSignals);
  const team = getDirectoryTeam(teams, teamId);

  if (!team) {
    return {
      title: "Team Not Found | Northstar GM",
    };
  }

  return {
    title: `${team.name} | Northstar GM`,
    description: `${team.name} roster and tracked draft assets in the Northstar GM dashboard.`,
  };
}

export default async function TeamPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  const [{ input, source }, tradeHistory] = await Promise.all([loadDashboardInput(), loadTradeHistory()]);
  const players = getDirectoryPlayers(input, tradeHistory.valueSignals);
  const teams = getTeamDirectoryEntries(input, players, tradeHistory.valueSignals);
  const team = getDirectoryTeam(teams, teamId);

  if (!team) {
    notFound();
  }

  const teamName = getTeamNameFromId(teamId);
  const teamPlayers = getTeamPlayers(players, teamName);
  const teamPicks = getTeamPicks(input, teamName, tradeHistory.valueSignals);
  const teamAssessment = assessTeam(teamPlayers, tradeHistory.valueSignals);
  const sourceSummary: SourceHoverSummary = {
    rosterCount: input.roster.length,
    targetCount: input.leagueTargets.length,
    ownedPickCount: input.draftPicks.length,
    draftOrderCount: input.draftOrders.length,
  };

  return (
    <TeamProfileShell
      picks={teamPicks}
      players={teamPlayers}
      source={source}
      sourceSummary={sourceSummary}
      team={team}
      teamAssessment={teamAssessment}
      trades={getTradesForTeam(tradeHistory, team.name)}
    />
  );
}