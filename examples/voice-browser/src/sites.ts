// Spoken site names → URLs, and per-site search URLs.

const SITES: Record<string, { url: string; search?: (q: string) => string }> = {
  youtube: { url: "https://www.youtube.com/", search: (q) => `https://www.youtube.com/results?search_query=${q}` },
  wikipedia: { url: "https://en.wikipedia.org/", search: (q) => `https://en.wikipedia.org/w/index.php?search=${q}` },
  github: { url: "https://github.com/", search: (q) => `https://github.com/search?q=${q}` },
  amazon: { url: "https://www.amazon.com/", search: (q) => `https://www.amazon.com/s?k=${q}` },
  reddit: { url: "https://www.reddit.com/", search: (q) => `https://www.reddit.com/search/?q=${q}` },
  google: { url: "https://www.google.com/", search: (q) => `https://www.google.com/search?q=${q}` },
  duckduckgo: { url: "https://duckduckgo.com/", search: (q) => `https://duckduckgo.com/?q=${q}` },
  maps: { url: "https://www.google.com/maps", search: (q) => `https://www.google.com/maps/search/${q}` },
  "google maps": { url: "https://www.google.com/maps", search: (q) => `https://www.google.com/maps/search/${q}` },
  "hacker news": { url: "https://news.ycombinator.com/" },
  twitter: { url: "https://x.com/" },
  x: { url: "https://x.com/" },
  gmail: { url: "https://mail.google.com/" },
  linkedin: { url: "https://www.linkedin.com/" },
  "stack overflow": { url: "https://stackoverflow.com/", search: (q) => `https://stackoverflow.com/search?q=${q}` },
};

const DEFAULT_SEARCH = SITES.duckduckgo.search!;

export function siteKey(hostOrName: string): string | null {
  const n = hostOrName.toLowerCase().replace(/^www\./, "");
  if (SITES[n]) return n;
  for (const k of Object.keys(SITES)) {
    const host = new URL(SITES[k].url).hostname.replace(/^www\./, "");
    if (n === host || n.endsWith(`.${host}`)) return k;
  }
  return null;
}

/** "youtube" → youtube.com; "news.ycombinator.com" → https://news.ycombinator.com; else a lucky search. */
export function resolveSite(spoken: string): string {
  const name = spoken.toLowerCase().trim();
  const key = siteKey(name);
  if (key) return SITES[key].url;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(name)) return `https://${name}`;
  // Unknown name: let DuckDuckGo's "!" bang jump to the first result.
  return `https://duckduckgo.com/?q=${encodeURIComponent(`! ${spoken}`)}`;
}

/** Search on the named site, else on the current site if it has search, else DuckDuckGo. */
export function searchUrl(query: string, named: string | null, currentUrl: string): string {
  const q = encodeURIComponent(query);
  const key = (named && siteKey(named)) || hostKey(currentUrl);
  const search = key ? SITES[key].search : undefined;
  return (search ?? DEFAULT_SEARCH)(q);
}

function hostKey(url: string): string | null {
  try {
    return siteKey(new URL(url).hostname);
  } catch {
    return null;
  }
}
