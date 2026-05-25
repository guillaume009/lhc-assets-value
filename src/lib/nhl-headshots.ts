type NhlPlayerSearchEntry = {
  playerId?: string;
  name?: string;
};

type NhlPlayerSearchResponse =
  | NhlPlayerSearchEntry[]
  | {
      value?: NhlPlayerSearchEntry[];
    };

const NHL_SEARCH_ENDPOINT = "https://search.d3.nhle.com/api/v1/search/player";
const NHL_MUG_ENDPOINT = "https://assets.nhle.com/mugs/nhl/latest";

const resolvedHeadshots = new Map<string, string | null>();
const pendingHeadshots = new Map<string, Promise<string | null>>();

const normalizeName = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const buildHeadshotUrl = (playerId: string) => `${NHL_MUG_ENDPOINT}/${playerId}.png`;

const chooseBestMatch = (
  name: string,
  candidates: NhlPlayerSearchEntry[],
) => {
  const normalizedName = normalizeName(name);

  return (
    candidates.find((candidate) => normalizeName(candidate.name ?? "") === normalizedName) ??
    candidates.find((candidate) => normalizeName(candidate.name ?? "").startsWith(normalizedName)) ??
    candidates[0] ??
    null
  );
};

const getSearchEntries = (payload: NhlPlayerSearchResponse): NhlPlayerSearchEntry[] =>
  Array.isArray(payload) ? payload : payload.value ?? [];

export const resolveNhlHeadshot = async (name: string) => {
  const normalizedName = normalizeName(name);

  if (!normalizedName) {
    return null;
  }

  const cached = resolvedHeadshots.get(normalizedName);

  if (cached !== undefined) {
    return cached;
  }

  const pending = pendingHeadshots.get(normalizedName);

  if (pending) {
    return pending;
  }

  const request = (async () => {
    const searchParams = new URLSearchParams({
      active: "true",
      culture: "en-us",
      limit: "10",
      q: `${normalizedName}*`,
    });

    const response = await fetch(`${NHL_SEARCH_ENDPOINT}?${searchParams.toString()}`, {
      next: { revalidate: 60 * 60 * 24 * 30 },
    });

    if (!response.ok) {
      resolvedHeadshots.set(normalizedName, null);
      return null;
    }

    const payload = (await response.json()) as NhlPlayerSearchResponse;
    const bestMatch = chooseBestMatch(name, getSearchEntries(payload));
    const headshotUrl = bestMatch?.playerId ? buildHeadshotUrl(bestMatch.playerId) : null;

    resolvedHeadshots.set(normalizedName, headshotUrl);
    return headshotUrl;
  })()
    .catch(() => {
      resolvedHeadshots.set(normalizedName, null);
      return null;
    })
    .finally(() => {
      pendingHeadshots.delete(normalizedName);
    });

  pendingHeadshots.set(normalizedName, request);
  return request;
};
