import type { Player } from "@/lib/domain";

/**
 * League salary parameters for the LHC (Ligue de Hockey du Canada).
 * Values follow the 2025-2026 rulebook (Règlements LHC, §3.3). All monetary
 * amounts are expressed in millions of dollars to match the `capHit` units
 * used across the player model (e.g. 8.4 === $8,400,000).
 */
export type LeagueCapParameters = {
  /** Reference season (e.g. "2025-2026"). */
  season: string;
  /** Salary floor (§3.3). */
  salaryFloor: number;
  /** Salary ceiling / cap (§3.3). */
  salaryCeiling: number;
  /** Minimum player salary (§5.1). */
  minimumSalary: number;
  /**
   * Spending ceiling margin above the salary ceiling (§3.3).
   * 0.25 === ceiling + 25%.
   */
  spendingCeilingMargin: number;
};

export const LHC_CAP_PARAMETERS_2025_2026: LeagueCapParameters = {
  season: "2025-2026",
  salaryFloor: 70.6,
  salaryCeiling: 95.5,
  minimumSalary: 0.775,
  spendingCeilingMargin: 0.25,
};

/**
 * Spending ceiling = salary ceiling + margin (§3.3).
 */
export const getSpendingCeiling = (parameters: LeagueCapParameters) =>
  parameters.salaryCeiling * (1 + parameters.spendingCeilingMargin);

/**
 * Cap impact of a contract buried in the minor league (club école) on the
 * salary cap (§3.2.1), matching the PlayHockeyOnline (source of truth)
 * computation.
 *
 * Only the first two (2) million of a farm contract carry a cap impact, taken
 * at 10%. Anything above $2M has no salary-cap impact, so the maximum impact of
 * a buried contract is $0.2M. e.g. a $3M contract counts for $0.2M, a $0.9M
 * contract counts for $0.09M.
 *
 * Note: this does NOT apply a minimum-salary floor — that floor only applies to
 * buyouts (§5.4) and retained salary in trades (§8.2.1).
 *
 * @param capHit annual contract value, in millions of dollars.
 */
export const getMinorLeagueCapImpact = (capHit: number) => {
  if (!Number.isFinite(capHit) || capHit <= 0) {
    return 0;
  }

  return Math.min(capHit, 2) * 0.1;
};

export type CapComplianceStatus = "below-floor" | "compliant" | "over-ceiling" | "over-spending-ceiling";

/**
 * Team-level financial adjustments sourced from PlayHockeyOnline (the source of
 * truth). All amounts are in millions of dollars.
 */
export type PayrollAdjustments = {
  /** Contract penalties (buyouts §5.4, retained salary §8.2.1, etc.). */
  contractPenalties?: number;
  /** Injured-player cap relief (LTIR-style), reduces the cap charge. */
  injuredRelief?: number;
};

export type PayrollSummary = {
  parameters: LeagueCapParameters;
  /** Number of cap-counting contracts (pro + farm, excludes prospects). */
  contractCount: number;
  /** Number of contracts buried in the minor league. */
  minorContractCount: number;
  /** Number of prospect contracts excluded from the cap. */
  prospectContractCount: number;

  // --- Salary breakdown (millions) ---
  /** Total pro salaries (100% impact). */
  proPayroll: number;
  /** Total farm salaries at full value (100% impact, spending ceiling). */
  minorPayroll: number;
  /** Total farm salaries at adjusted value (§3.2.1, salary cap). */
  minorPayrollAdjusted: number;
  /** Cap relief gained by burying contracts in the minors (millions). */
  minorReliefSavings: number;
  /** Total prospect salaries excluded from the cap (junior, no impact). */
  prospectPayroll: number;

  // --- Adjustments (millions) ---
  /** Total contract penalties charged against the cap. */
  contractPenalties: number;
  /** Total injured-player relief credited back to the cap. */
  injuredRelief: number;

  // --- Cap view ("Masse salariale") ---
  /** Adjusted payroll = pro + farm adjusted (millions). */
  capPayroll: number;
  /** Effective cap charge = capPayroll + penalties − injured relief (millions). */
  capCharges: number;
  /** Space remaining under the salary ceiling (millions, negative if exceeded). */
  capSpaceRemaining: number;

  // --- Spending view ("Finances") ---
  /** Credit margin above the salary ceiling (millions). */
  creditMargin: number;
  /** Spending ceiling = salary ceiling + credit margin (millions). */
  spendingCeiling: number;
  /** Total player salaries at full value = pro + farm full (millions). */
  spendingPayroll: number;
  /** Effective spending charge = spendingPayroll + penalties (millions). */
  spendingCharges: number;
  /** Space remaining under the spending ceiling (millions). */
  spendingSpaceRemaining: number;

  /** Distance from the floor (millions, negative if below the floor). */
  floorCushion: number;
  /** Salary compliance status. */
  status: CapComplianceStatus;
};

export type PayrollContract = Pick<Player, "capHit"> & {
  /** true if the contract is buried in the minor league (reduced impact §3.2.1). */
  inMinors?: boolean;
  /** Contract status; prospects (junior) carry no salary-cap impact. */
  contractStatus?: Player["contractStatus"];
};

/**
 * Computes a team's payroll and its compliance status (§3.2.1, §3.3),
 * mirroring the PlayHockeyOnline "Finances" and "Masse salariale" tables.
 *
 * - The salary cap ("Masse salariale") counts pro salaries at 100% and farm
 *   salaries at the reduced §3.2.1 impact, plus contract penalties and minus
 *   injured-player relief.
 * - The spending ceiling ("Finances") counts every contract at 100% plus
 *   contract penalties, against the salary ceiling expanded by the credit margin.
 */
export const summarizePayroll = (
  contracts: PayrollContract[],
  adjustments: PayrollAdjustments = {},
  parameters: LeagueCapParameters = LHC_CAP_PARAMETERS_2025_2026,
): PayrollSummary => {
  let proPayroll = 0;
  let proContractCount = 0;
  let minorPayroll = 0;
  let minorPayrollAdjusted = 0;
  let minorContractCount = 0;
  let prospectPayroll = 0;
  let prospectContractCount = 0;

  for (const contract of contracts) {
    const capHit = Number.isFinite(contract.capHit) ? contract.capHit : 0;

    if (capHit <= 0) {
      continue;
    }

    // Prospects (junior players) carry no salary-cap or spending impact (§3.2).
    if (contract.contractStatus === "prospect") {
      prospectPayroll += capHit;
      prospectContractCount += 1;
      continue;
    }

    if (contract.inMinors) {
      minorPayroll += capHit;
      minorPayrollAdjusted += getMinorLeagueCapImpact(capHit);
      minorContractCount += 1;
    } else {
      proPayroll += capHit;
      proContractCount += 1;
    }
  }

  const contractPenalties = Math.max(adjustments.contractPenalties ?? 0, 0);
  const injuredRelief = Math.max(adjustments.injuredRelief ?? 0, 0);

  const capPayroll = proPayroll + minorPayrollAdjusted;
  const capCharges = capPayroll + contractPenalties - injuredRelief;
  const capSpaceRemaining = parameters.salaryCeiling - capCharges;

  const creditMargin = parameters.salaryCeiling * parameters.spendingCeilingMargin;
  const spendingCeiling = parameters.salaryCeiling + creditMargin;
  const spendingPayroll = proPayroll + minorPayroll;
  const spendingCharges = spendingPayroll + contractPenalties;
  const spendingSpaceRemaining = spendingCeiling - spendingCharges;

  const floorCushion = capCharges - parameters.salaryFloor;

  let status: CapComplianceStatus = "compliant";

  if (spendingCharges > spendingCeiling) {
    status = "over-spending-ceiling";
  } else if (capCharges > parameters.salaryCeiling) {
    status = "over-ceiling";
  } else if (capCharges < parameters.salaryFloor) {
    status = "below-floor";
  }

  return {
    parameters,
    contractCount: proContractCount + minorContractCount,
    minorContractCount,
    prospectContractCount,
    proPayroll: roundMillions(proPayroll),
    minorPayroll: roundMillions(minorPayroll),
    minorPayrollAdjusted: roundMillions(minorPayrollAdjusted),
    minorReliefSavings: roundMillions(minorPayroll - minorPayrollAdjusted),
    prospectPayroll: roundMillions(prospectPayroll),
    contractPenalties: roundMillions(contractPenalties),
    injuredRelief: roundMillions(injuredRelief),
    capPayroll: roundMillions(capPayroll),
    capCharges: roundMillions(capCharges),
    capSpaceRemaining: roundMillions(capSpaceRemaining),
    creditMargin: roundMillions(creditMargin),
    spendingCeiling: roundMillions(spendingCeiling),
    spendingPayroll: roundMillions(spendingPayroll),
    spendingCharges: roundMillions(spendingCharges),
    spendingSpaceRemaining: roundMillions(spendingSpaceRemaining),
    floorCushion: roundMillions(floorCushion),
    status,
  };
};

const roundMillions = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Formats a millions-of-dollars amount into a readable string.
 * e.g. 8.4 -> "$8.40M", 0.775 -> "$0.78M".
 */
export const formatMillions = (value: number) => {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toFixed(2)}M`;
};

export const CAP_STATUS_LABELS: Record<CapComplianceStatus, string> = {
  "below-floor": "Below floor",
  compliant: "Compliant",
  "over-ceiling": "Over ceiling",
  "over-spending-ceiling": "Over spending ceiling",
};
