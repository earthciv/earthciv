// The world map as the home page. index.html opts in with <html data-home="world">: the bare address then opens the
// world map (ext/ports), where any country can be picked, and each built-in edition lives at ?country=<id>
// (?country=us, ?country=ca). Pages without the attribute (the dev pages, a copy that hosts one edition) open on
// their default edition as before.
//
// With the opt-in, the page opens on the world map unless the address names a built-in edition or its hash carries
// an edition's state, so an old shared link such as /#city=35620&lens=income still opens the default edition. A
// ?country= that is not a built-in edition (?country=fr) opens the world map with that country picked.

const html = typeof document !== "undefined" ? document.documentElement : null;
export const WORLD_HOME = html?.dataset?.home === "world";

// Hash keys the world view owns (ext/ports): the open map ("all" or a map's id) and the picked country.
export const WORLD_HASH_KEYS = ["ports", "country"];

// The built-in editions, as index.html lists them in the country picker.
function builtInEditions() {
  if (typeof document === "undefined") return [];
  return [...document.querySelectorAll("#country-picker option")].map((o) => o.value).filter((v) => /^[a-z]{2,}$/.test(v));
}

function decide() {
  if (!WORLD_HOME || typeof location === "undefined") return { world: false, pick: null };
  const requested = new URLSearchParams(location.search).get("country");
  if (requested && builtInEditions().includes(requested)) return { world: false, pick: null };
  const keys = [...new URLSearchParams(location.hash.replace(/^#/, "")).keys()];
  if (keys.some((k) => !WORLD_HASH_KEYS.includes(k))) return { world: false, pick: null };
  const pick = requested && /^[a-z]{2}$/i.test(requested) ? requested.toUpperCase() : null;
  return { world: true, pick };
}

const decision = decide();
/** True when this page load opens on the world map rather than an edition. */
export const OPENS_ON_WORLD = decision.world;
/** An ISO 3166 code from ?country= to pick on the world map (?country=fr), or null. */
export const REQUESTED_PICK = decision.pick;

/** The address of a built-in edition: ?country=<id>. Without WORLD_HOME the default edition needs no parameter. */
export function editionUrl(id, defaultId = null) {
  const target = new URL(location.href);
  if (!WORLD_HOME && id === defaultId) target.searchParams.delete("country");
  else target.searchParams.set("country", id);
  target.hash = "";
  return target.href;
}

/**
 * An edition opened from an old link without ?country= (/#city=…) writes its ?country= into the address, so that
 * reloading or sharing it stays on that edition once its hash empties out (the bare address is the world map).
 */
export function pinEditionInUrl(id) {
  if (!WORLD_HOME || typeof location === "undefined") return;
  const params = new URLSearchParams(location.search);
  if (params.get("country") === id) return;
  params.set("country", id);
  try {
    history.replaceState(history.state, "", `${location.pathname}?${params}${location.hash}`);
  } catch {
    /* some sandboxes forbid history writes */
  }
}
