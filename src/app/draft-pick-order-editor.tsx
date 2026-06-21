"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
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

type DraggedDraftOrder = {
  season: number;
  team: string;
};

const sortDraftOrders = (draftOrders: DraftOrder[], currentTeamName: string) =>
  [...draftOrders].sort(
    (left, right) =>
      left.season - right.season ||
      Number(right.team === currentTeamName) - Number(left.team === currentTeamName) ||
      left.projectedSlot - right.projectedSlot ||
      left.team.localeCompare(right.team),
  );

const reorderDraftOrders = (
  currentOrders: DraftOrder[],
  season: number,
  sourceTeam: string,
  targetTeam: string,
) => {
  if (sourceTeam === targetTeam) {
    return currentOrders;
  }

  const seasonOrders = currentOrders
    .filter((order) => order.season === season)
    .sort(
      (left, right) =>
        left.projectedSlot - right.projectedSlot || left.team.localeCompare(right.team),
    );
  const sourceIndex = seasonOrders.findIndex((order) => order.team === sourceTeam);
  const targetIndex = seasonOrders.findIndex((order) => order.team === targetTeam);

  if (sourceIndex === -1 || targetIndex === -1) {
    return currentOrders;
  }

  const reorderedSeasonOrders = [...seasonOrders];
  const [movedOrder] = reorderedSeasonOrders.splice(sourceIndex, 1);
  reorderedSeasonOrders.splice(targetIndex, 0, movedOrder);

  const nextSeasonOrders = new Map(
    reorderedSeasonOrders.map((order, index) => [
      order.team,
      {
        ...order,
        projectedSlot: index + 1,
      },
    ]),
  );

  return currentOrders.map((order) => {
    if (order.season !== season) {
      return order;
    }

    return nextSeasonOrders.get(order.team) ?? order;
  });
};

export function DraftPickOrderEditor({ draftOrders, picks, teamName }: DraftPickOrderEditorProps) {
  const router = useRouter();
  const [draftOrderState, setDraftOrderState] = useState(() => sortDraftOrders(draftOrders, teamName));
  const draftOrderStateRef = useRef(draftOrderState);
  const [selectedYear, setSelectedYear] = useState(
    () => draftOrders[0]?.season ?? new Date().getFullYear(),
  );
  const [draggedDraftOrder, setDraggedDraftOrder] = useState<DraggedDraftOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const queuedDraftOrdersRef = useRef<DraftOrder[] | null>(null);
  const isFlushingSaveRef = useRef(false);

  useEffect(() => {
    draftOrderStateRef.current = draftOrderState;
  }, [draftOrderState]);

  const resolvedPicks = applyDraftOrdersToPicks(picks, draftOrderState);
  const ownedPickGroups = buildDraftPickOrderGroups(resolvedPicks);
  const years = [...new Set(draftOrderState.map((draftOrder) => draftOrder.season))].sort(
    (left, right) => left - right,
  );
  const activeYear = years.includes(selectedYear) ? selectedYear : years[0];

  const persistDraftOrders = async (orders: DraftOrder[]) => {
    const response = await fetch("/api/dashboard/picks", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(orders),
    });

    const payload = (await response.json()) as { ok: boolean; error?: string };

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error ?? "Unable to save draft-pick order.");
    }
  };

  const flushDraftOrderSaveQueue = () => {
    if (isFlushingSaveRef.current) {
      return;
    }

    isFlushingSaveRef.current = true;
    setIsSaving(true);

    void (async () => {
      let didSave = false;
      let didFail = false;

      try {
        while (queuedDraftOrdersRef.current) {
          const nextOrders = queuedDraftOrdersRef.current;
          queuedDraftOrdersRef.current = null;

          try {
            await persistDraftOrders(nextOrders);
            didSave = true;
          } catch (saveError) {
            queuedDraftOrdersRef.current = nextOrders;
            didFail = true;
            setError(saveError instanceof Error ? saveError.message : "Unable to save draft-pick order.");
            setSuccess(null);
            break;
          }
        }

        if (didSave && !didFail) {
          setSuccess("Pick order saved automatically.");
          setError(null);
          router.refresh();
        }
      } finally {
        isFlushingSaveRef.current = false;
        setIsSaving(false);

        if (!didFail && queuedDraftOrdersRef.current) {
          flushDraftOrderSaveQueue();
        }
      }
    })();
  };

  const queueDraftOrderSave = (orders: DraftOrder[]) => {
    queuedDraftOrdersRef.current = orders;
    setError(null);
    setSuccess(null);
    flushDraftOrderSaveQueue();
  };

  const moveDraftOrder = (season: number, sourceTeam: string, targetTeam: string) => {
    const nextOrders = reorderDraftOrders(
      draftOrderStateRef.current,
      season,
      sourceTeam,
      targetTeam,
    );

    if (nextOrders === draftOrderStateRef.current) {
      return;
    }

    draftOrderStateRef.current = nextOrders;
    setDraftOrderState(nextOrders);
    queueDraftOrderSave(nextOrders);
  };

  const formatRounds = (rounds: number[]) => {
    if (rounds.length === 1) {
      return `Round ${rounds[0]}`;
    }

    return `Rounds ${rounds.join(", ")}`;
  };

  const getDraftOrdersForYear = (season: number) =>
    draftOrderState
      .filter((draftOrder) => draftOrder.season === season)
      .sort(
        (left, right) =>
          left.projectedSlot - right.projectedSlot || left.team.localeCompare(right.team),
      );

  const nudgeDraftOrder = (season: number, team: string, offset: number) => {
    const seasonOrders = getDraftOrdersForYear(season);
    const sourceIndex = seasonOrders.findIndex((order) => order.team === team);

    if (sourceIndex === -1) {
      return;
    }

    const targetIndex = Math.min(Math.max(sourceIndex + offset, 0), seasonOrders.length - 1);

    if (targetIndex === sourceIndex) {
      return;
    }

    moveDraftOrder(season, team, seasonOrders[targetIndex].team);
  };

  const handleDragStart = (event: DragEvent<HTMLDivElement>, season: number, team: string) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `${season}:${team}`);
    setDraggedDraftOrder({ season, team });
    setError(null);
    setSuccess(null);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (season: number, team: string) => {
    if (!draggedDraftOrder || draggedDraftOrder.season !== season) {
      return;
    }

    moveDraftOrder(season, draggedDraftOrder.team, team);
    setDraggedDraftOrder(null);
  };

  const handleDragEnd = () => {
    setDraggedDraftOrder(null);
  };

  const getPickValue = (order: DraftPickOrderGroup, round: number) =>
    scorePick({
      id: `${order.season}-${order.team}-${round}`,
      team: order.team,
      issuerTeam: order.issuerTeam,
      season: order.season,
      round,
      projectedSlot: order.projectedSlot,
    });

  return (
    <div className="mt-5 space-y-3">
      <div className="grid gap-4 xl:grid-cols-2">
        <section className="rounded-[1.75rem] border border-[var(--line)] bg-white/75 p-4">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-slate-500">Draft capital</p>
            <p className="mt-2 text-sm leading-6 text-slate-700">
              Owned picks update live against the current league order so you can see value changes before the board is saved.
            </p>
          </div>
          <div className="mt-4 space-y-3">
            {ownedPickGroups.map((order: DraftPickOrderGroup) => (
              <div key={`${order.season}-${order.issuerTeam}`} className="rounded-3xl bg-white p-4">
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
                  <div className="rounded-full border border-[var(--line)] bg-white px-4 py-2 text-sm text-slate-700">
                    Projected slot <span className="ml-2 font-mono font-semibold text-slate-900">{order.projectedSlot}</span>
                  </div>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
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
          </div>
        </section>
        <section className="rounded-[1.75rem] border border-[var(--line)] bg-white/75 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-slate-500">League order board</p>
              <p className="mt-2 text-sm leading-6 text-slate-700">
                {isSaving
                  ? "Saving updated league order..."
                  : "Drag teams into projected finish order for each season. Future years default to the current-year slot for the same team until you override them. Owned pick values update from this board and reorder changes save automatically."}
              </p>
            </div>
            {years.length > 0 ? (
              <label className="flex shrink-0 flex-col gap-2 text-sm text-slate-700">
                <span className="text-xs uppercase tracking-[0.18em] text-slate-500">Year</span>
                <select
                  className="rounded-xl border border-[var(--line)] bg-white px-3 py-2 font-semibold text-slate-900"
                  onChange={(event) => setSelectedYear(Number(event.target.value))}
                  value={activeYear}
                >
                  {years.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          {activeYear ? (
            <section className="mt-4 rounded-3xl border border-[var(--line)] bg-white/75 p-4">
              <div className="flex items-center justify-between gap-4">
                <h3 className="text-lg font-semibold text-slate-900">{activeYear}</h3>
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Drag a card onto another slot</p>
              </div>
              <div className="mt-3 space-y-3">
                {getDraftOrdersForYear(activeYear).map((order) => (
                  <div
                    key={`${order.season}-${order.team}`}
                    className={`rounded-2xl border bg-white px-4 py-4 text-left text-sm text-slate-700 transition ${draggedDraftOrder?.season === activeYear && draggedDraftOrder.team === order.team ? "border-slate-900 shadow-[0_12px_30px_rgba(15,23,42,0.14)] opacity-60" : "border-[var(--line)] hover:border-slate-400 hover:shadow-[0_12px_30px_rgba(15,23,42,0.08)]"}`}
                    draggable
                    onDragEnd={handleDragEnd}
                    onDragOver={handleDragOver}
                    onDragStart={(event) => handleDragStart(event, order.season, order.team)}
                    onDrop={() => handleDrop(order.season, order.team)}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <span className="block font-semibold text-slate-900">
                          <span className="mr-2 font-mono text-slate-500">{order.projectedSlot}.</span>
                          <TeamLink className="underline-offset-4 hover:underline" team={order.team}>
                            {order.team}
                          </TeamLink>
                        </span>
                      </div>
                      <div className="flex flex-col gap-2">
                        <button
                          aria-label={`Move ${order.team} earlier`}
                          className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--line)] text-slate-700 transition hover:border-slate-400 hover:bg-slate-100 hover:text-slate-900 focus-visible:border-slate-500 focus-visible:bg-slate-100 focus-visible:text-slate-900 focus-visible:outline-none disabled:opacity-40 disabled:hover:border-[var(--line)] disabled:hover:bg-transparent disabled:hover:text-slate-700"
                          disabled={order.projectedSlot === 1}
                          onClick={() => nudgeDraftOrder(order.season, order.team, -1)}
                          type="button"
                        >
                          &uarr;
                        </button>
                        <button
                          aria-label={`Move ${order.team} later`}
                          className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--line)] text-slate-700 transition hover:border-slate-400 hover:bg-slate-100 hover:text-slate-900 focus-visible:border-slate-500 focus-visible:bg-slate-100 focus-visible:text-slate-900 focus-visible:outline-none disabled:opacity-40 disabled:hover:border-[var(--line)] disabled:hover:bg-transparent disabled:hover:text-slate-700"
                          disabled={order.projectedSlot === getDraftOrdersForYear(activeYear).length}
                          onClick={() => nudgeDraftOrder(order.season, order.team, 1)}
                          type="button"
                        >
                          &darr;
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </section>
      </div>
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-700">{success}</p> : null}
    </div>
  );
}