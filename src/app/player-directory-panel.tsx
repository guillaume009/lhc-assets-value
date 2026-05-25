"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { PlayerHeadshot } from "@/app/player-headshot";
import { TeamLink } from "@/app/team-link";
import type { DirectoryPlayer } from "@/lib/player-directory";

type PlayerDirectoryPanelProps = {
  players: DirectoryPlayer[];
  teams: string[];
};

type DirectoryView = "table" | "cards";
type DirectorySortKey = "name" | "team" | "position" | "age" | "score" | "capHit";
type SortDirection = "asc" | "desc";

const sortPlayers = (
  players: DirectoryPlayer[],
  sortKey: DirectorySortKey,
  sortDirection: SortDirection,
) =>
  [...players].sort((left, right) => {
    const comparison = (() => {
      switch (sortKey) {
        case "name":
          return left.name.localeCompare(right.name);
        case "team":
          return left.team.localeCompare(right.team);
        case "position":
          return left.position.localeCompare(right.position);
        case "age":
          return left.age - right.age;
        case "capHit":
          return left.capHit - right.capHit;
        case "score":
          return left.score - right.score;
      }
    })();

    return sortDirection === "asc" ? comparison : -comparison;
  });

const renderSortLabel = (isActive: boolean, direction: SortDirection) => {
  if (!isActive) {
    return "↕";
  }

  return direction === "asc" ? "↑" : "↓";
};

const ringStyle = (value: number) => ({
  background: `conic-gradient(var(--accent) ${value}%, rgba(15,118,110,0.12) ${value}% 100%)`,
});

export function PlayerDirectoryPanel({ players, teams }: PlayerDirectoryPanelProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [teamFilter, setTeamFilter] = useState("all");
  const [positionFilter, setPositionFilter] = useState("all");
  const [view, setView] = useState<DirectoryView>("table");
  const [pendingView, setPendingView] = useState<DirectoryView | null>(null);
  const [sortKey, setSortKey] = useState<DirectorySortKey>("score");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [isViewPending, startViewTransition] = useTransition();

  const positions = [...new Set(players.map((player) => player.position))].sort();

  const filteredPlayers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return players.filter((player) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        player.name.toLowerCase().includes(normalizedQuery) ||
        player.role.toLowerCase().includes(normalizedQuery) ||
        player.team.toLowerCase().includes(normalizedQuery);
      const matchesTeam = teamFilter === "all" || player.team === teamFilter;
      const matchesPosition = positionFilter === "all" || player.position === positionFilter;

      return matchesQuery && matchesTeam && matchesPosition;
    });
  }, [players, positionFilter, query, teamFilter]);

  const sortedPlayers = useMemo(
    () => sortPlayers(filteredPlayers, sortKey, sortDirection),
    [filteredPlayers, sortDirection, sortKey],
  );

  const averageScore =
    sortedPlayers.length === 0
      ? 0
      : Math.round(sortedPlayers.reduce((total, player) => total + player.score, 0) / sortedPlayers.length);
  const ownTeamCount = sortedPlayers.filter((player) => player.isOwnTeam).length;
  const highValueCount = sortedPlayers.filter((player) => player.score >= 76).length;

  const toggleSort = (nextSortKey: DirectorySortKey) => {
    if (nextSortKey === sortKey) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(nextSortKey);
    setSortDirection(
      nextSortKey === "name" || nextSortKey === "team" || nextSortKey === "position" ? "asc" : "desc",
    );
  };

  const handleViewChange = (nextView: DirectoryView) => {
    if (nextView === view) {
      return;
    }

    setPendingView(nextView);
    startViewTransition(() => {
      setView(nextView);
    });
  };

  const openPlayerProfile = (playerId: string) => {
    router.push(`/players/${encodeURIComponent(playerId)}`);
  };

  return (
    <div className="relative">
      {isViewPending ? (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-start justify-center rounded-[2rem] bg-[rgba(243,244,248,0.78)] px-4 py-20 backdrop-blur-sm">
          <div className="flex items-center gap-3 rounded-full border border-[var(--line)] bg-white/90 px-5 py-3 text-sm font-semibold text-slate-700 shadow-[0_18px_40px_rgba(17,32,49,0.12)]">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-[var(--accent)]" />
            Switching to {pendingView === "cards" ? "card list" : "table view"}
          </div>
        </div>
      ) : null}
      <section className="relative overflow-hidden rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] shadow-[0_20px_60px_rgba(17,32,49,0.08)]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.16),transparent_32%),radial-gradient(circle_at_top_right,rgba(225,29,72,0.18),transparent_28%),linear-gradient(135deg,rgba(255,255,255,0.55),transparent_50%)]" />
        <div className="relative space-y-5 px-5 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-[1.5rem] border border-[var(--line)] bg-white/80 p-4 backdrop-blur">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Visible players</p>
              <p className="mt-3 text-3xl font-semibold text-slate-900">{sortedPlayers.length}</p>
              <p className="mt-2 text-sm text-slate-600">Across {teams.length} teams</p>
            </div>
            <div className="rounded-[1.5rem] border border-[var(--line)] bg-white/80 p-4 backdrop-blur">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Average value</p>
              <p className="mt-3 text-3xl font-semibold text-slate-900">{averageScore}</p>
              <p className="mt-2 text-sm text-slate-600">Mean score after filters</p>
            </div>
            <div className="rounded-[1.5rem] border border-[var(--line)] bg-white/80 p-4 backdrop-blur">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Own roster</p>
              <p className="mt-3 text-3xl font-semibold text-slate-900">{ownTeamCount}</p>
              <p className="mt-2 text-sm text-slate-600">Current-team players</p>
            </div>
            <div className="rounded-[1.5rem] border border-[var(--line)] bg-white/80 p-4 backdrop-blur">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Core assets</p>
              <p className="mt-3 text-3xl font-semibold text-slate-900">{highValueCount}</p>
              <p className="mt-2 text-sm text-slate-600">Score 76 and above</p>
            </div>
          </div>
          <div className="space-y-4 rounded-[1.5rem] border border-[var(--line)] bg-white/70 p-4 backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-2 text-sm leading-6 text-slate-600">
                <p>Dense board, fast scanning, direct profile jump.</p>
                <p>Showing {sortedPlayers.length} of {players.length} players in the current filtered view.</p>
              </div>
              <div className="flex gap-2">
                <button
                  className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${view === "table" ? "border-[var(--accent)] bg-[rgba(37,99,235,0.12)] text-[var(--accent)] shadow-[0_10px_24px_rgba(37,99,235,0.18)]" : "border-[var(--line)] bg-slate-100 text-slate-700 hover:bg-slate-200 hover:text-slate-900"}`}
                  onClick={() => handleViewChange("table")}
                  type="button"
                >
                  Table view
                </button>
                <button
                  className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${view === "cards" ? "border-[var(--accent)] bg-[rgba(37,99,235,0.12)] text-[var(--accent)] shadow-[0_10px_24px_rgba(37,99,235,0.18)]" : "border-[var(--line)] bg-slate-100 text-slate-700 hover:bg-slate-200 hover:text-slate-900"}`}
                  onClick={() => handleViewChange("cards")}
                  type="button"
                >
                  Card list
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <label className="min-w-[14rem] flex-1 text-sm text-slate-700">
                <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-500">Search players</span>
                <input
                  className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-slate-900"
                  placeholder="Name, team, or role"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <label className="w-full max-w-[14rem] text-sm text-slate-700">
                <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-500">Team</span>
                <select
                  className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-slate-900"
                  value={teamFilter}
                  onChange={(event) => setTeamFilter(event.target.value)}
                >
                  <option value="all">All teams</option>
                  {teams.map((team) => (
                    <option key={team} value={team}>{team}</option>
                  ))}
                </select>
              </label>
              <label className="w-full max-w-[10rem] text-sm text-slate-700">
                <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-500">Position</span>
                <select
                  className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-slate-900"
                  value={positionFilter}
                  onChange={(event) => setPositionFilter(event.target.value)}
                >
                  <option value="all">All</option>
                  {positions.map((position) => (
                    <option key={position} value={position}>{position}</option>
                  ))}
                </select>
              </label>

            </div>
          </div>
        </div>
      </section>

      {view === "table" ? (
        <section className="rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[0_20px_60px_rgba(17,32,49,0.06)]">
          <div className="overflow-hidden rounded-[1.5rem] border border-[var(--line)] bg-white/75 shadow-[0_18px_40px_rgba(37,99,235,0.08)]">
            <table className="min-w-full border-collapse text-left">
              <thead className="bg-[linear-gradient(90deg,rgba(37,99,235,0.96),rgba(225,29,72,0.9))] text-sm uppercase tracking-[0.18em] text-white">
                <tr>
                  {([
                    ["name", "Player"],
                    ["team", "Team"],
                    ["position", "Pos"],
                    ["age", "Age"],
                    ["capHit", "Cap"],
                    ["score", "Value"],
                  ] as const).map(([key, label]) => (
                    <th key={key} className="px-4 py-3 font-medium">
                      <button className="flex items-center gap-2" onClick={() => toggleSort(key)} type="button">
                        <span>{label}</span>
                        <span className="text-[10px] text-white/70">{renderSortLabel(sortKey === key, sortDirection)}</span>
                      </button>
                    </th>
                  ))}
                  <th className="px-4 py-3 font-medium">Market</th>
                </tr>
              </thead>
              <tbody>
                {sortedPlayers.map((player, index) => (
                  <tr
                    key={player.id}
                    className={`${index % 2 === 0 ? "bg-white/88" : "bg-[rgba(239,242,255,0.82)]"} group cursor-pointer border-t border-[var(--line)] transition hover:bg-[rgba(219,234,254,0.7)]`}
                    onClick={() => openPlayerProfile(player.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openPlayerProfile(player.id);
                      }
                    }}
                    role="link"
                    tabIndex={0}
                  >
                    <td className="px-4 py-4 align-top">
                      <div className="flex items-start gap-3">
                        <PlayerHeadshot
                          alt={player.name}
                          className="h-11 w-11 rounded-2xl object-cover shadow-[0_10px_20px_rgba(15,118,110,0.18)]"
                          fallbackClassName="grid h-11 w-11 place-items-center rounded-2xl bg-[linear-gradient(135deg,rgba(37,99,235,0.95),rgba(225,29,72,0.82))] text-sm font-semibold text-white shadow-[0_10px_20px_rgba(37,99,235,0.18)]"
                          name={player.name}
                        />
                        <div>
                          <p className="font-semibold text-slate-900 underline-offset-4 group-hover:underline group-hover:decoration-2 group-has-[a:hover]:no-underline group-has-[a:hover]:decoration-auto">{player.name}</p>
                          <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">{player.role}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 align-top text-sm text-slate-700">
                      <TeamLink
                        className="inline-flex cursor-pointer rounded-lg px-2 py-1 -mx-2 -my-1 font-medium text-slate-700 underline-offset-4 transition hover:bg-[rgba(37,99,235,0.12)] hover:text-[var(--accent)] hover:underline hover:decoration-2"
                        stopPropagation
                        team={player.team}
                      />
                    </td>
                    <td className="px-4 py-4 align-top text-sm text-slate-700">{player.position}</td>
                    <td className="px-4 py-4 align-top text-sm text-slate-700">{player.age}</td>
                    <td className="px-4 py-4 align-top text-sm text-slate-700">${player.capHit.toFixed(1)}M</td>
                    <td className="px-4 py-4 align-top">
                      <div className="flex items-center gap-3">
                        <div className="relative h-11 w-11 rounded-full p-[4px]" style={ringStyle(player.score)}>
                          <div className="grid h-full w-full place-items-center rounded-full bg-white text-sm font-semibold text-slate-900">
                            {player.score}
                          </div>
                        </div>
                        <div className="min-w-24">
                          <div className="h-2 rounded-full bg-slate-200">
                            <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${player.score}%` }} />
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 align-top text-sm text-slate-700">{player.market}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sortedPlayers.map((player) => (
            <article
              key={player.id}
              className="group relative cursor-pointer overflow-hidden rounded-[1.75rem] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[0_20px_60px_rgba(17,32,49,0.06)] transition hover:bg-[rgba(219,234,254,0.35)]"
              onClick={() => openPlayerProfile(player.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openPlayerProfile(player.id);
                }
              }}
              role="link"
              tabIndex={0}
            >
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(15,118,110,0.12),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(180,83,9,0.16),transparent_34%)]" />
              <div className="relative">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <PlayerHeadshot
                      alt={player.name}
                      className="h-14 w-14 rounded-[1.15rem] object-cover shadow-[0_16px_24px_rgba(15,118,110,0.18)]"
                      fallbackClassName="grid h-14 w-14 place-items-center rounded-[1.15rem] bg-[linear-gradient(135deg,rgba(15,118,110,0.95),rgba(180,83,9,0.9))] text-base font-semibold text-white shadow-[0_16px_24px_rgba(15,118,110,0.18)]"
                      name={player.name}
                    />
                    <div>
                      <TeamLink
                        className="inline-flex cursor-pointer rounded-lg px-2 py-1 -mx-2 -my-1 text-xs uppercase tracking-[0.18em] text-slate-500 underline-offset-4 transition hover:bg-[rgba(37,99,235,0.12)] hover:text-[var(--accent)] hover:underline hover:decoration-2"
                        stopPropagation
                        team={player.team}
                      />
                      <h2 className="mt-2 text-2xl font-semibold text-slate-900 underline-offset-4 group-hover:underline group-hover:decoration-2 group-has-[a:hover]:no-underline group-has-[a:hover]:decoration-auto">{player.name}</h2>
                      <p className="mt-1 text-sm text-slate-600">{player.position} / age {player.age}</p>
                    </div>
                  </div>
                  <div className="relative h-14 w-14 rounded-full p-[5px]" style={ringStyle(player.score)}>
                    <div className="grid h-full w-full place-items-center rounded-full bg-white text-sm font-semibold text-slate-900">
                      {player.score}
                    </div>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-6 text-slate-700">{player.role}</p>
                <div className="mt-4 h-2 rounded-full bg-slate-200">
                  <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${player.score}%` }} />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-2xl bg-white/85 p-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Market</p>
                    <p className="mt-2 font-semibold text-slate-900">{player.market}</p>
                  </div>
                  <div className="rounded-2xl bg-white/85 p-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Cap hit</p>
                    <p className="mt-2 font-semibold text-slate-900">${player.capHit.toFixed(1)}M</p>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="rounded-full border border-[var(--line)] bg-white/80 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-600">
                    {player.tradeRange}
                  </span>
                  <span className="rounded-full border border-[var(--line)] bg-white/80 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-600">
                    {player.isOwnTeam ? "Current roster" : "Other team"}
                  </span>
                </div>
                <p className="mt-5 text-xs uppercase tracking-[0.18em] text-slate-500">Open player profile</p>
              </div>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}