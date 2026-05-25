import { PlayerLink } from "@/app/player-link";
import { TeamLink } from "@/app/team-link";
import type { TradeRecord } from "@/lib/trade-history";

type TradeHistoryListProps = {
  trades: TradeRecord[];
  emptyMessage: string;
  highlightPlayerId?: string;
  highlightTeamName?: string;
  limit?: number;
};

const formatTradeDate = (value: string | null) => {
  if (!value) {
    return "Date unavailable";
  }

  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    return value;
  }

  return parsedDate.toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

export function TradeHistoryList({ trades, emptyMessage, highlightPlayerId, highlightTeamName, limit }: TradeHistoryListProps) {
  const visibleTrades = limit ? trades.slice(0, limit) : trades;

  if (visibleTrades.length === 0) {
    return (
      <p className="rounded-[1.5rem] border border-[var(--line)] bg-white/75 p-4 text-sm leading-7 text-slate-700">
        {emptyMessage}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {visibleTrades.map((trade) => (
        <article key={trade.id} className="rounded-[1.5rem] border border-[var(--line)] bg-white/75 p-5 shadow-[0_18px_40px_rgba(17,32,49,0.06)]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Trade #{trade.id}</p>
              <h3 className="mt-2 text-xl font-semibold text-slate-900">{trade.teams.join(" <-> ")}</h3>
            </div>
            <p className="rounded-full border border-[var(--line)] bg-white/85 px-3 py-1 text-sm font-semibold text-slate-700">
              {formatTradeDate(trade.approvedAt ?? trade.createdAt)}
            </p>
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {trade.sides.map((side) => {
              const isHighlightedTeam = highlightTeamName === side.teamName;

              return (
                <section
                  key={side.id}
                  className={`rounded-[1.5rem] border p-4 ${isHighlightedTeam ? "border-[var(--accent)] bg-[rgba(37,99,235,0.08)]" : "border-[var(--line)] bg-slate-50/80"}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Sending team</p>
                      <p className="mt-2 text-lg font-semibold text-slate-900">
                        <TeamLink className="underline-offset-4 hover:underline" team={side.teamName}>
                          {side.teamName}
                        </TeamLink>
                      </p>
                    </div>
                    <span className="rounded-full bg-white/85 px-3 py-1 text-sm font-semibold text-slate-700">
                      est. value {side.assetScoreTotal}
                    </span>
                  </div>
                  {side.comments ? <p className="mt-3 text-sm leading-6 text-slate-700">{side.comments}</p> : null}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {side.assets.map((asset) => {
                      const isHighlightedAsset = asset.playerId === highlightPlayerId;
                      const assetClassName = `inline-flex flex-col rounded-2xl border px-3 py-2 text-sm ${isHighlightedAsset ? "border-[var(--accent)] bg-[rgba(37,99,235,0.08)] text-slate-900" : "border-[var(--line)] bg-white/90 text-slate-700"}`;

                      return asset.playerId ? (
                        <PlayerLink key={asset.id} className={assetClassName} playerId={asset.playerId}>
                          <span className="font-semibold">{asset.label}</span>
                          <span className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">
                            {asset.type.replace("_", " ")}{asset.score === null ? "" : ` / ${asset.score}`}
                          </span>
                        </PlayerLink>
                      ) : (
                        <div key={asset.id} className={assetClassName}>
                          <span className="font-semibold">{asset.label}</span>
                          <span className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">
                            {asset.type.replace("_", " ")}{asset.score === null ? "" : ` / ${asset.score}`}
                          </span>
                          {asset.description ? (
                            <span className="mt-1 text-xs text-slate-500">
                              {asset.type === "draft_pick" ? (
                                <TeamLink className="underline-offset-4 hover:underline" team={asset.description}>
                                  {asset.description}
                                </TeamLink>
                              ) : (
                                asset.description
                              )}
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </article>
      ))}
    </div>
  );
}