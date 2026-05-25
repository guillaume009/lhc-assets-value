"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { TeamLink } from "@/app/team-link";
import type { DraftOrder, DraftPick } from "@/lib/domain";
import {
  applyDraftOrdersToPicks,
  buildDraftPickOrderGroups,
  hasTradedDraftPick,
  isSameDraftPickTeam,
  type DraftPickOrderGroup,
} from "@/lib/draft-pick-order";
import { scorePick } from "@/lib/valuation";

type DraftPickOrderEditorProps = {
  teamName: string;
  picks: DraftPick[];
  draftOrders: DraftOrder[];
};

const sortDraftOrders = (draftOrders: DraftOrder[], currentTeamName: string) =>
  [...draftOrders].sort(
    (left, right) =>
      left.season - right.season ||
      Number(right.team === currentTeamName) - Number(left.team === currentTeamName) ||
      left.projectedSlot - right.projectedSlot ||
      left.team.localeCompare(right.team),
  );

export function DraftPickOrderEditor({ draftOrders, picks, teamName }: DraftPickOrderEditorProps) {
  const router = useRouter();
  const [draftOrderState, setDraftOrderState] = useState(() => sortDraftOrders(draftOrders, teamName));
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const resolvedPicks = applyDraftOrdersToPicks(picks, draftOrderState);
  const ownedPickGroups = buildDraftPickOrderGroups(resolvedPicks);
  const years = [...new Set(draftOrderState.map((draftOrder) => draftOrder.season))].sort(
    (left, right) => left - right,
  );

  const updateProjectedSlot = (team: string, season: number, projectedSlot: number) => {
    setDraftOrderState((currentOrders) =>
      currentOrders.map((order) =>
        order.team === team && order.season === season
          ? {
              ...order,
              projectedSlot,
            }
          : order,
      ),
    );
  };

  const formatRounds = (rounds: number[]) => {
    if (rounds.length === 1) {
      return `Round ${rounds[0]}`;
    }

    return `Rounds ${rounds.join(", ")}`;
  };

  const getDraftOrdersForYear = (season: number) =>
    draftOrderState.filter((draftOrder) => draftOrder.season === season);

  const getPickValue = (order: DraftPickOrderGroup, round: number) =>
    scorePick({
      id: `${order.season}-${order.team}-${round}`,
      team: order.team,
      issuerTeam: order.issuerTeam,
      season: order.season,
      round,
      projectedSlot: order.projectedSlot,
    });

  const handleSave = () => {
    setError(null);
    setSuccess(null);

    startTransition(async () => {
      const response = await fetch("/api/dashboard/picks", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(draftOrderState),
      });

      const payload = (await response.json()) as { ok: boolean; error?: string };

      if (!response.ok || !payload.ok) {
        setError(payload.error ?? "Unable to save draft-pick order.");
        return;
      }

      setSuccess("Pick order saved.");
      router.refresh();
    });
  };

  return (
    <div className="mt-5 space-y-3">
      {ownedPickGroups.map((order: DraftPickOrderGroup) => (
        <div key={`${order.season}-${order.issuerTeam}`} className="rounded-3xl bg-white/75 p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-slate-900">
                {order.season}{" "}
                <TeamLink className="underline-offset-4 hover:underline" team={order.team}>
                  {order.team}
                </TeamLink>
                {!isSameDraftPickTeam(order.issuerTeam, order.team) ? (
                  <>
                    {" "}(
                    <TeamLink className="underline-offset-4 hover:underline" team={order.issuerTeam}>
                      {order.issuerTeam}
                    </TeamLink>
                    )
                  </>
                ) : null}
              </p>
              <p className="mt-1 text-sm text-slate-600">{formatRounds(order.rounds)} across {order.pickCount} owned pick{order.pickCount === 1 ? "" : "s"}</p>
            </div>
            <label className="flex items-center gap-3 text-sm text-slate-700">
              <span>Projected slot</span>
              <input
                className="w-20 rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-right font-mono text-slate-900"
                min={1}
                step={1}
                type="number"
                value={order.projectedSlot}
                onChange={(event) =>
                  updateProjectedSlot(order.issuerTeam, order.season, Number(event.target.value) || 1)
                }
              />
            </label>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {order.picks.map((pick) => (
              <div key={pick.id} className="rounded-2xl border border-[var(--line)] bg-white px-3 py-3">
                <p className="text-sm font-semibold text-slate-900">Round {pick.round}</p>
                {hasTradedDraftPick(pick) ? <p className="mt-1 text-xs text-slate-500">Original owner: {pick.issuerTeam}</p> : null}
                <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">Slot {order.projectedSlot}</p>
                <p className="mt-2 text-2xl font-semibold text-slate-900">{getPickValue(order, pick.round)}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="rounded-[1.75rem] border border-[var(--line)] bg-[#f6efe3] p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">League order board</p>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              Set the projected finish for every team and year. Future years default to the current-year slot for the same team until you override them.
            </p>
          </div>
        </div>
        <div className="mt-4 space-y-4">
          {years.map((season) => (
            <section key={season} className="rounded-3xl bg-white/70 p-4">
              <h3 className="text-lg font-semibold text-slate-900">{season}</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {getDraftOrdersForYear(season).map((order) => (
                  <label key={`${order.season}-${order.team}`} className="rounded-2xl border border-[var(--line)] bg-white px-3 py-3 text-sm text-slate-700">
                    <span className="block font-semibold text-slate-900">
                      <TeamLink className="underline-offset-4 hover:underline" team={order.team}>
                        {order.team}
                      </TeamLink>
                    </span>
                    <span className="mt-1 block text-xs uppercase tracking-[0.18em] text-slate-500">Projected slot</span>
                    <input
                      className="mt-2 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-right font-mono text-slate-900"
                      min={1}
                      step={1}
                      type="number"
                      value={order.projectedSlot}
                      onChange={(event) =>
                        updateProjectedSlot(order.team, order.season, Number(event.target.value) || 1)
                      }
                    />
                  </label>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
      <div className="flex items-center justify-between gap-4 rounded-3xl bg-slate-900 px-4 py-3 text-slate-50">
        <p className="text-sm text-slate-300">Owned pick values above are recalculated from the league order board before you save.</p>
        <button
          className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isPending}
          onClick={handleSave}
          type="button"
        >
          {isPending ? "Saving..." : "Save pick order"}
        </button>
      </div>
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-700">{success}</p> : null}
    </div>
  );
}