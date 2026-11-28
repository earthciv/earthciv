// The makers of the maps in the world view (./index.js): who each map in web/data/ports.json is credited to, the
// list of everyone who made one, and the order that list is shown in.
//
//   * A map is credited to its "author". Where its repository is on GitHub, the repository's owner is taken to be
//     that author's account: their name links to it and their picture comes from it. An entry says otherwise with
//     "author_github" (a map with no repository, or one kept in somebody else's; null for an author who wants their
//     name alone, with no picture and no profile link) and "author_url" (a page of the author's own to link to
//     instead).
//   * Maps with the same account, or with the same name where there is no account, are one maker's.
//   * The list starts with the maker of the map that the others began with ("original": true in ports.json) and
//     ends with this site's own editions. In between, makers with a map that can be opened come before those with
//     source code only; makers whose maps have enough ratings come by rating. GitHub stars break rating ties,
//     counting each repository once. Remaining ties rotate one place each day.
//   * One community map a day is "today's map" on the country list: every map that can be opened takes a day in
//     turn, so each maker is on the first screen in their turn.
//
// This file imports nothing and never touches the page, so its rules can be tested outside a browser.

// A GitHub login: letters, digits and single hyphens, at most 39 characters. Anything else is not put into an address.
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const AVATARS = "https://avatars.githubusercontent.com/";
const PROFILES = "https://github.com/";

/** How many ratings a maker's maps need before their rating places them in the list. */
export const MIN_RATINGS = 3;
// How strongly a maker's average is pulled toward the average of all ratings: as if they had this many more ratings
// of exactly that average. A handful of ratings then moves a maker a little, and many ratings speak for themselves.
const PRIOR_RATINGS = 3;
const DAY_MS = 86_400_000;

const login = (value) => (typeof value === "string" && LOGIN.test(value) ? value : null);
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
/** A map that can be opened: an EarthCiv edition, or a community map with a site, inside EarthCiv or in a new tab. */
const opens = (port) => port.status === "merged" || (port.status === "live" && !!port.url);

/** A map's repository star count when its repository belongs to the credited maker, or null otherwise. */
export function ownRepoStars(port) {
  if (!port?.repo || !REPO.test(port.repo) || !Number.isSafeInteger(port.github_stars) || port.github_stars < 0) return null;
  const owner = port.repo.split("/")[0].toLowerCase();
  if ("author_github" in port && (!port.author_github || String(port.author_github).toLowerCase() !== owner)) return null;
  return port.github_stars;
}

function webAddress(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Who a map is credited to, or null for a map nobody is named for (a link a visitor saved for themselves).
 * @returns {{key: string, name: string, github: string|null, url: string|null}|null} key: what makes two maps the
 *   same maker's; github: the account their picture comes from; url: where their name links
 */
export function makerOf(port) {
  const name = typeof port?.author === "string" ? port.author.trim() : "";
  if (!name || port.status === "custom") return null;
  // Where an entry has "author_github", that is the answer, also when it says there is no account to show (null).
  const github = "author_github" in port ? login(port.author_github) : login(String(port.repo || "").split("/")[0]);
  return {
    key: (github || name).toLowerCase(),
    name,
    github,
    ...(typeof port.author_twitter === "string" && /^[A-Za-z0-9_]{1,15}$/.test(port.author_twitter)
      ? { twitter: port.author_twitter } : {}),
    url: webAddress(port.author_url) || (github ? PROFILES + github : null),
  };
}

/** The address of a maker's picture, `px` pixels square, or null when they have no account to take it from. */
export function avatarUrl(github, px = 80) {
  return login(github) ? `${AVATARS}${github}?s=${Math.round(px)}` : null;
}

/** One or two letters that stand for a maker where there is no picture: "Andrej Karpathy" → "AK", "mutwil" → "M". */
export function initials(name) {
  const words = String(name || "").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const first = (word) => String.fromCodePoint(word.codePointAt(0)).toUpperCase();
  if (!words.length) return "?";
  return words.length === 1 ? first(words[0]) : first(words[0]) + first(words[1]);
}

/** A colour for a maker's initials, the same every time for the same maker: a hue from 0 to 359. */
export function hueOf(key) {
  let h = 0;
  for (const ch of String(key || "")) h = (h * 31 + ch.codePointAt(0)) % 360;
  return h;
}

/**
 * Everyone the maps are credited to, in the catalog's order, each with their maps.
 * @param {object[]} ports    the catalog's entries
 * @param {string|null} house the account of this site's own editions: its entry is marked `house`
 * @returns {{key, name, github, url, ports: object[], original: boolean, house: boolean}[]}
 */
export function listMakers(ports, { house = null } = {}) {
  const byKey = new Map();
  for (const port of ports || []) {
    const maker = makerOf(port);
    if (!maker) continue;
    let entry = byKey.get(maker.key);
    if (!entry) {
      entry = { ...maker, ports: [], original: false, house: !!house && maker.key === String(house).toLowerCase() };
      byKey.set(maker.key, entry);
    }
    entry.ports.push(port);
    entry.url ||= maker.url;
    if (maker.twitter) entry.twitter ||= maker.twitter;
    if (port.original === true) entry.original = true;
  }
  return [...byKey.values()];
}

/** The day a date falls on, counted in whole UTC days: what the makers' turns go by. */
export const dayNumber = (date = new Date()) => Math.floor(date.getTime() / DAY_MS);

/**
 * Today's map: the community map the country list puts forward on day `day`. Each community map with a site takes a
 * day in turn, in the catalog's order. The original map and this site's own editions have their place on that list
 * already, so they take no turn.
 */
export function featuredPort(ports, { day = 0 } = {}) {
  const turns = (ports || []).filter((p) => p.status === "live" && !!p.url && p.original !== true && !!makerOf(p));
  return turns.length ? turns[((day % turns.length) + turns.length) % turns.length] : null;
}

/**
 * The makers in the order the list shows them, each with the numbers it shows: `n` ratings, their `sum` of stars,
 * `average` (null when unrated) and `ranked` (whether the ratings place the maker).
 *
 *   1. the maker of the original map;
 *   2. the makers with a map that can be opened, by their rating: an average weighted toward the average of all
 *      ratings, counted only from MIN_RATINGS ratings on. A maker with fewer has exactly the average, so the well
 *      rated come before them, the poorly rated after, and they keep their place among themselves by turns (below);
 *   3. the makers with source code only, by turns (source code cannot be rated);
 *   4. this site's own editions.
 *
 * GitHub stars break ties after rating scores and vote counts. Each repository counts once per maker.
 * Remaining ties use the catalog order, moved round by one place for every day.
 *
 * @param {object[]} makers            from listMakers()
 * @param {(id: string) => {n: number, sum: number}} ratingOf  a map's number of ratings and the sum of their stars
 * @param {number} day                 dayNumber() of today
 */
export function rankMakers(makers, { ratingOf = () => ({ n: 0, sum: 0 }), day = 0 } = {}) {
  const rows = (makers || []).map((maker, index) => {
    let n = 0;
    let sum = 0;
    const repositories = new Map();
    for (const port of maker.ports) {
      const r = ratingOf(port.id) || {};
      const stars = ownRepoStars(port);
      if (stars !== null) {
        const repo = port.repo.toLowerCase();
        repositories.set(repo, Math.max(repositories.get(repo) || 0, stars));
      }
      n += r.n || 0;
      sum += r.sum || 0;
    }
    const githubStars = [...repositories.values()].reduce((total, stars) => total + stars, 0);
    return { ...maker, n, sum, githubStars, average: n ? sum / n : null, ranked: n >= MIN_RATINGS, index };
  });
  const all = rows.reduce((t, r) => ({ n: t.n + r.n, sum: t.sum + r.sum }), { n: 0, sum: 0 });
  const mean = all.n ? all.sum / all.n : 0;
  const count = rows.length || 1;
  const shift = ((day % count) + count) % count;
  for (const r of rows) {
    r.score = r.ranked ? (PRIOR_RATINGS * mean + r.sum) / (PRIOR_RATINGS + r.n) : mean;
    r.turn = (r.index - shift + count) % count;
  }
  const group = (r) => (r.original ? 0 : r.house ? 3 : r.ports.some(opens) ? 1 : 2);
  // Equal rating scores use vote count, then GitHub stars from distinct repositories, then daily rotation.
  const byRatings = (a, b) => (a.ranked && b.ranked ? b.n - a.n : 0);
  rows.sort((a, b) => group(a) - group(b) || b.score - a.score || byRatings(a, b) || b.githubStars - a.githubStars || a.turn - b.turn);
  return rows.map(({ index, turn, ...row }) => row);
}

const PORT_KIND_ORDER = { merged: 0, custom: 1, live: 2, external: 3, repo: 4 };
const PORT_SCOPE_ORDER = { country: 0, multi: 1, region: 2 };

function portKindOf(port) {
  if (port.status === "merged") return "merged";
  if (port.status === "custom") return "custom";
  if (port.status === "live") return port.embed ? "live" : "external";
  return "repo";
}

function portScopeRank(port) {
  if (port.scope in PORT_SCOPE_ORDER) return PORT_SCOPE_ORDER[port.scope];
  return (port.countries || []).length === 1 ? 0 : 1;
}

/**
 * Order a country's maps, best and most popular first:
 *   1. Kind: EarthCiv edition, visitor's own link, community map (opens inside), community map (own site), source code.
 *   2. Scope: dedicated single-country map before multi-country regional maps before sub-national/region maps.
 *   3. Popularity: weighted visitor rating (once a map has MIN_RATINGS ratings), vote count on ties, GitHub stars,
 *      featured creator flag, then the catalog's own order (falling back to name).
 *
 * @param {object[]} ports
 * @param {object} [options]
 * @param {(id: string) => {n: number, sum: number}} [options.ratingOf]
 * @param {number|null} [options.globalMean]
 * @param {Map<string, number>|object[]|null} [options.catalogOrder]
 */
export function rankCountryPorts(ports, { ratingOf = () => ({ n: 0, sum: 0 }), globalMean = null, catalogOrder = null } = {}) {
  const orderById = catalogOrder instanceof Map
    ? catalogOrder
    : Array.isArray(catalogOrder)
      ? new Map(catalogOrder.map((p, idx) => [p.id, idx]))
      : null;

  const list = (ports || []).map((port, idx) => {
    const r = ratingOf(port.id) || {};
    const n = r.n || 0;
    const sum = r.sum || 0;
    const stars = ownRepoStars(port) || 0;
    return { port, n, sum, average: n ? sum / n : null, ranked: n >= MIN_RATINGS, stars, idx };
  });

  let mean = globalMean;
  if (mean == null) {
    const tot = list.reduce((t, x) => ({ n: t.n + x.n, sum: t.sum + x.sum }), { n: 0, sum: 0 });
    mean = tot.n ? tot.sum / tot.n : 0;
  }
  for (const x of list) {
    x.score = x.ranked ? (PRIOR_RATINGS * mean + x.sum) / (PRIOR_RATINGS + x.n) : mean;
  }

  // When scores tie (for instance when only one map is rated so its average equals the mean), a well-rated map still
  // leads an unrated one, and more votes break ties between rated maps.
  const rankedVotes = (x) => (x.ranked && x.average >= 3 ? x.n : 0);

  list.sort((a, b) => {
    const ka = PORT_KIND_ORDER[portKindOf(a.port)] ?? 9;
    const kb = PORT_KIND_ORDER[portKindOf(b.port)] ?? 9;
    if (ka !== kb) return ka - kb;
    const sa = portScopeRank(a.port);
    const sb = portScopeRank(b.port);
    if (sa !== sb) return sa - sb;
    if (b.score !== a.score) return b.score - a.score;
    const byVotes = rankedVotes(b) - rankedVotes(a);
    if (byVotes) return byVotes;
    if (b.stars !== a.stars) return b.stars - a.stars;
    const fa = a.port.featured_creator === true ? 1 : 0;
    const fb = b.port.featured_creator === true ? 1 : 0;
    if (fb !== fa) return fb - fa;
    if (orderById) {
      const oa = orderById.get(a.port.id) ?? 9999;
      const ob = orderById.get(b.port.id) ?? 9999;
      if (oa !== ob) return oa - ob;
    }
    return a.port.name.localeCompare(b.port.name) || a.idx - b.idx;
  });

  return list.map((x) => x.port);
}
