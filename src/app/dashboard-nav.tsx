import Link from "next/link";

export type DashboardNavTab = "overview" | "roster" | "market" | "draft" | "players" | "teams" | "trades" | "workbench" | "admin";
type DashboardButtonTab = Exclude<DashboardNavTab, "teams" | "trades" | "workbench" | "admin">;

const tabOptions: Array<{ id: DashboardNavTab; label: string; href: string }> = [
  { id: "overview", label: "Overview", href: "/?tab=overview" },
  { id: "roster", label: "Roster", href: "/?tab=roster" },
  { id: "market", label: "Market", href: "/?tab=market" },
  { id: "draft", label: "Draft", href: "/?tab=draft" },
  { id: "players", label: "Player directory", href: "/?tab=players" },
  { id: "teams", label: "Team directory", href: "/teams" },
  { id: "trades", label: "Past trades", href: "/trades" },
  { id: "workbench", label: "Trade workbench", href: "/workbench" },
  { id: "admin", label: "Data status", href: "/admin/data-status" },
];

type DashboardNavProps = {
  activeTab: DashboardNavTab;
  onSelectTab?: (tab: DashboardButtonTab) => void;
};

export function DashboardNav({ activeTab, onSelectTab }: DashboardNavProps) {
  return (
    <div className="inline-flex max-w-full flex-wrap gap-2 rounded-[1.25rem] border border-[var(--line)] bg-white/70 p-2">
      {tabOptions.map((tab) => {
        const isActive = tab.id === activeTab;
        const buttonTab: DashboardButtonTab | null =
          tab.id !== "teams" && tab.id !== "trades" && tab.id !== "workbench" && tab.id !== "admin" ? tab.id : null;

        if (onSelectTab && buttonTab) {
          return (
            <button
              key={tab.id}
              aria-pressed={isActive}
              className={`inline-flex cursor-pointer items-center rounded-xl px-3 py-2 text-sm font-semibold transition ${
                isActive
                  ? "bg-slate-900 text-white shadow-[0_10px_24px_rgba(17,32,49,0.16)] hover:bg-slate-900 hover:text-white"
                  : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
              }`}
              onClick={() => onSelectTab(buttonTab)}
              type="button"
            >
              {tab.label}
            </button>
          );
        }

        if (isActive) {
          return (
            <span
              key={tab.id}
              aria-current="page"
              className="inline-flex cursor-default items-center rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(17,32,49,0.16)]"
            >
              {tab.label}
            </span>
          );
        }

        return (
          <Link
            key={tab.id}
            className="inline-flex cursor-pointer items-center rounded-xl px-3 py-2 text-sm font-semibold text-slate-700 no-underline transition visited:text-slate-700 hover:bg-slate-100 hover:text-slate-900"
            href={tab.href}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}