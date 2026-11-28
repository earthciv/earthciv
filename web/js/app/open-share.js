// A share page is a static document for crawlers. Open its map in the browser,
// restoring the city or lens from the page and the rest of the view from the link.
// A map's own page (/map/<id>/, its link carries data-map) also notes which map the visitor came for, in this tab
// only: the world view points out that map's stars once (ext/ports/mapShare.js, ARRIVAL_KEY).
const link = document.getElementById("open-map");
const target = new URL(link.href);
for (const [key, value] of new URLSearchParams(location.search)) {
  if (key !== "country") target.searchParams.append(key, value);
}
const state = new URLSearchParams(location.hash.slice(1));
for (const [key, value] of new URLSearchParams(target.hash.slice(1))) state.set(key, value);
target.hash = state.toString();
if (link.dataset.map) {
  try {
    sessionStorage.setItem("earthciv.arrivedFor.v1", JSON.stringify({ id: link.dataset.map, at: Date.now() }));
  } catch {
    /* no storage here: the map opens all the same */
  }
}
location.replace(target.href);
