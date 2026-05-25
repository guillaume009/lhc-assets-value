"use client";

import { useMemo, useState } from "react";

import { StandalonePageHeader } from "@/app/standalone-page-header";
import type { SourceHoverSummary } from "@/app/source-hover-label";
import type { DashboardSourceInfo } from "@/lib/domain";
import {
  evaluateTradeImpact,
  summarizeTradePackage,
  type WorkbenchAsset,
  type WorkbenchTeam,
} from "@/lib/trade-workbench";

type TradeWorkbenchShellProps = {
  source: DashboardSourceInfo;
  sourceSummary: SourceHoverSummary;
  teams: WorkbenchTeam[];
};

const formatSignedDelta = (value: number) => (value > 0 ? `+${value}` : `${value}`);

const assetTypeLabel = (asset: WorkbenchAsset) => (asset.kind === "player" ? "Player" : "Pick");

const getDefaultLeftTeamName = (teams: WorkbenchTeam[]) => teams.find((team) => team.team.isOwnTeam)?.team.name ?? teams[0]?.team.name ?? "";

const getDefaultRightTeamName = (teams: WorkbenchTeam[], leftTeamName: string) =>
  teams.find((team) => team.team.name !== leftTeamName)?.team.name ?? leftTeamName;

type TeamAssetColumnProps = {
  team: WorkbenchTeam;
  selectedAssetIds: string[];
  onToggleAsset: (assetId: string) => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
  title: string;
};

function TeamAssetColumn({ team, selectedAssetIds, onToggleAsset, searchValue, onSearchChange, title }: TeamAssetColumnProps) {
  const selectedAssetIdSet = useMemo(() => new Set(selectedAssetIds), [selectedAssetIds]);
  const filteredAssets = useMemo(() => {
    const normalizedQuery = searchValue.trim().toLowerCase();

    if (!normalizedQuery) {
      return team.assets;
    }

    return team.assets.filter((asset) => `${asset.label} ${asset.subtitle}`.toLowerCase().includes(normalizedQuery));
  }, [searchValue, team.assets]);

  return (
    <section className="rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[0_20px_60px_rgba(17,32,49,0.06)]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-slate-500">{title}</p>
          <h2 className="mt-2 text-2xl font-semibold text-slate-900">{team.team.name}</h2>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            Select the assets this club is sending out. The workbench recalculates package totals and team impact on both sides immediately.
          </p>
        </div>
        <div className="rounded-[1.25rem] border border-[var(--line)] bg-white/85 px-4 py-3 text-right">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Team score</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{team.team.averageScore}</p>
        </div>
      </div>
      <label className="mt-5 block text-sm text-slate-700">
        <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-500">Filter assets</span>
        <input
          className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-slate-900"
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search by player, pick, position, or label"
          type="search"
          value={searchValue}
        />
      </label>
      <div className="mt-5 max-h-[32rem] space-y-3 overflow-y-auto pr-1">
        {filteredAssets.map((asset) => {
          const isSelected = selectedAssetIdSet.has(asset.assetId);

          return (
            <label
              key={asset.assetId}
              className={`flex cursor-pointer items-start gap-3 rounded-[1.35rem] border p-4 transition ${isSelected ? "border-[var(--accent)] bg-[rgba(37,99,235,0.08)]" : "border-[var(--line)] bg-white/80 hover:bg-slate-50"}`}
            >
              <input
                checked={isSelected}
                className="mt-1 h-4 w-4 rounded border-[var(--line)] text-[var(--accent)]"
                onChange={() => onToggleAsset(asset.assetId)}
                type="checkbox"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-900">{asset.label}</p>
                    <p className="mt-1 text-sm leading-6 text-slate-600">{asset.subtitle}</p>
                  </div>
                  <div className="text-right">
                    <p className="rounded-full bg-white/90 px-3 py-1 text-sm font-semibold text-slate-900">{asset.score}</p>
                    <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-slate-500">{assetTypeLabel(asset)}</p>
                  </div>
                </div>
              </div>
            </label>
          );
        })}
      </div>
    </section>
  );
}

type ImpactCardProps = {
  title: string;
  teamName: string;
  outgoingAssets: WorkbenchAsset[];
  incomingAssets: WorkbenchAsset[];
  impact: ReturnType<typeof evaluateTradeImpact>;
};

function ImpactCard({ title, teamName, outgoingAssets, incomingAssets, impact }: ImpactCardProps) {
  const outgoingSummary = summarizeTradePackage(outgoingAssets);
  const incomingSummary = summarizeTradePackage(incomingAssets);

  return (
    <article className="rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[0_20px_60px_rgba(17,32,49,0.06)]">
      <p className="text-xs uppercase tracking-[0.24em] text-slate-500">{title}</p>
      <h3 className="mt-2 text-2xl font-semibold text-slate-900">{teamName}</h3>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[1.35rem] border border-[var(--line)] bg-white/85 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Roster score</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{impact.after.overall}</p>
          <p className={`mt-2 text-sm font-semibold ${impact.rosterDelta >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{formatSignedDelta(impact.rosterDelta)}</p>
        </div>
        <div className="rounded-[1.35rem] border border-[var(--line)] bg-white/85 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Pick value</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{impact.pickValueAfter}</p>
          <p className={`mt-2 text-sm font-semibold ${impact.pickValueDelta >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{formatSignedDelta(impact.pickValueDelta)}</p>
        </div>
        <div className="rounded-[1.35rem] border border-[var(--line)] bg-white/85 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Outgoing value</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{outgoingSummary.totalScore}</p>
          <p className="mt-2 text-sm text-slate-600">{outgoingSummary.assetCount} assets</p>
        </div>
        <div className="rounded-[1.35rem] border border-[var(--line)] bg-white/85 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Incoming value</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{incomingSummary.totalScore}</p>
          <p className="mt-2 text-sm text-slate-600">{incomingSummary.assetCount} assets</p>
        </div>
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-[1.5rem] border border-[var(--line)] bg-white/80 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">After trade outlook</p>
          <p className="mt-3 text-lg font-semibold text-slate-900">
            Strongest: {impact.after.strongest.bucket} / Weakest: {impact.after.weakest.bucket}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            Players {impact.playerCountBefore} to {impact.playerCountAfter} and picks {impact.pickCountBefore} to {impact.pickCountAfter}.
          </p>
        </div>
        <div className="rounded-[1.5rem] border border-[var(--line)] bg-white/80 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Package balance</p>
          <p className="mt-3 text-lg font-semibold text-slate-900">{formatSignedDelta(incomingSummary.totalScore - outgoingSummary.totalScore)} net package swing</p>
          <p className="mt-2 text-sm leading-6 text-slate-700">
            Outgoing: {outgoingSummary.playerCount} players / {outgoingSummary.pickCount} picks. Incoming: {incomingSummary.playerCount} players / {incomingSummary.pickCount} picks.
          </p>
        </div>
      </div>
    </article>
  );
}

export function TradeWorkbenchShell({ source, sourceSummary, teams }: TradeWorkbenchShellProps) {
  const [leftTeamName, setLeftTeamName] = useState(() => getDefaultLeftTeamName(teams));
  const [rightTeamName, setRightTeamName] = useState(() => getDefaultRightTeamName(teams, getDefaultLeftTeamName(teams)));
  const [leftSearch, setLeftSearch] = useState("");
  const [rightSearch, setRightSearch] = useState("");
  const [leftAssetIds, setLeftAssetIds] = useState<string[]>([]);
  const [rightAssetIds, setRightAssetIds] = useState<string[]>([]);

  const leftTeam = useMemo(() => teams.find((team) => team.team.name === leftTeamName) ?? teams[0], [leftTeamName, teams]);
  const rightTeam = useMemo(() => teams.find((team) => team.team.name === rightTeamName) ?? teams[1] ?? teams[0], [rightTeamName, teams]);

  const leftOutgoingAssets = useMemo(
    () => leftTeam?.assets.filter((asset) => leftAssetIds.includes(asset.assetId)) ?? [],
    [leftAssetIds, leftTeam],
  );
  const rightOutgoingAssets = useMemo(
    () => rightTeam?.assets.filter((asset) => rightAssetIds.includes(asset.assetId)) ?? [],
    [rightAssetIds, rightTeam],
  );

  const leftImpact = useMemo(
    () => (leftTeam ? evaluateTradeImpact(leftTeam, leftOutgoingAssets, rightOutgoingAssets) : null),
    [leftOutgoingAssets, leftTeam, rightOutgoingAssets],
  );
  const rightImpact = useMemo(
    () => (rightTeam ? evaluateTradeImpact(rightTeam, rightOutgoingAssets, leftOutgoingAssets) : null),
    [leftOutgoingAssets, rightOutgoingAssets, rightTeam],
  );

  const handleLeftTeamChange = (nextTeamName: string) => {
    setLeftTeamName(nextTeamName);
    setLeftAssetIds([]);

    if (nextTeamName === rightTeamName) {
      const replacement = teams.find((team) => team.team.name !== nextTeamName)?.team.name ?? nextTeamName;
      setRightTeamName(replacement);
      setRightAssetIds([]);
    }
  };

  const handleRightTeamChange = (nextTeamName: string) => {
    setRightTeamName(nextTeamName);
    setRightAssetIds([]);

    if (nextTeamName === leftTeamName) {
      const replacement = teams.find((team) => team.team.name !== nextTeamName)?.team.name ?? nextTeamName;
      setLeftTeamName(replacement);
      setLeftAssetIds([]);
    }
  };

  const toggleAsset = (selectedAssetIds: string[], setSelectedAssetIds: (assetIds: string[]) => void, assetId: string) => {
    setSelectedAssetIds(
      selectedAssetIds.includes(assetId)
        ? selectedAssetIds.filter((selectedId) => selectedId !== assetId)
        : [...selectedAssetIds, assetId],
    );
  };

  if (!leftTeam || !rightTeam) {
    return null;
  }

  return (
    <div className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <main className="mx-auto flex w-full max-w-[96rem] flex-col gap-5">
        <StandalonePageHeader activeTab="workbench" source={source} sourceSummary={sourceSummary} />
        <section className="rounded-[2rem] border border-[var(--line)] bg-[var(--surface)] p-6 shadow-[0_20px_60px_rgba(17,32,49,0.06)]">
          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Trade workbench</p>
              <h1 className="mt-2 text-3xl font-semibold text-slate-900">Build a deal and watch both teams move</h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-700">
                Start with two clubs, choose the assets each side is sending out, and compare package value, roster impact, and draft-capital movement before you talk to another GM.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-slate-700">
                <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-500">Team A</span>
                <select className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-slate-900" onChange={(event) => handleLeftTeamChange(event.target.value)} value={leftTeamName}>
                  {teams.map((team) => (
                    <option key={team.team.id} value={team.team.name}>{team.team.name}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-slate-700">
                <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-slate-500">Team B</span>
                <select className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-slate-900" onChange={(event) => handleRightTeamChange(event.target.value)} value={rightTeamName}>
                  {teams.map((team) => (
                    <option key={team.team.id} value={team.team.name}>{team.team.name}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </section>
        <section className="grid gap-5 xl:grid-cols-2">
          <TeamAssetColumn
            onSearchChange={setLeftSearch}
            onToggleAsset={(assetId) => toggleAsset(leftAssetIds, setLeftAssetIds, assetId)}
            searchValue={leftSearch}
            selectedAssetIds={leftAssetIds}
            team={leftTeam}
            title="Team A outgoing"
          />
          <TeamAssetColumn
            onSearchChange={setRightSearch}
            onToggleAsset={(assetId) => toggleAsset(rightAssetIds, setRightAssetIds, assetId)}
            searchValue={rightSearch}
            selectedAssetIds={rightAssetIds}
            team={rightTeam}
            title="Team B outgoing"
          />
        </section>
        {leftImpact && rightImpact ? (
          <section className="grid gap-5 xl:grid-cols-2">
            <ImpactCard impact={leftImpact} incomingAssets={rightOutgoingAssets} outgoingAssets={leftOutgoingAssets} teamName={leftTeam.team.name} title="Team A impact" />
            <ImpactCard impact={rightImpact} incomingAssets={leftOutgoingAssets} outgoingAssets={rightOutgoingAssets} teamName={rightTeam.team.name} title="Team B impact" />
          </section>
        ) : null}
      </main>
    </div>
  );
}