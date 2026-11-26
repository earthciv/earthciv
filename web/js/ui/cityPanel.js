import { canada } from "../app/country.js";
import { css } from "../color.js";
import { esc } from "../format.js";
import { isCapital } from "../world.js";
import { yieldGrid, amenities, censusGeography, industries, gdpRow, popLine, growthSpan, showPanel, hidePanel, yieldsTitle, censusTitle } from "./infoPanel.js";

/**
 * ctx: {w, nation, onClose, onPedia, onState(stateIndex)}
 */
export function openCityPanel(city, ctx) {
  const { w, nation } = ctx;
  const n = nation.nation;
  const owner = city.cell != null ? w.raw.owner[city.cell] : -1;
  const col = css(w.stateColor[owner] || [190, 190, 190]);

  // The city's states as links to their state panels.
  const states = (city.states || [])
    .map((abbr) => ({ abbr, i: w.raw.states.findIndex((s) => s.abbr === abbr) }))
    .map(({ abbr, i }) => (i >= 0 && ctx.onState
      ? `<button class="chip" data-state="${i}" title="Open ${esc(w.raw.states[i].name)}">${esc(abbr)}</button>`
      : `<span class="chip">${esc(abbr)}</span>`))
    .join("");

  const growth = growthSpan(city, n);

  showPanel({
    kind: "city",
    stripe: col,
    title: city.name,
    titleHtml: `${isCapital(city) ? `<span class="cap" title="National capital">★</span> ` : ""}${esc(city.name)}`,
    sub: `${esc(city.full || "")}${states ? `<div class="chips">${states}</div>` : ""}`,
    headExtra: popLine(city, growth),
    sections: [
      { title: canada ? yieldsTitle(city) : "Yields", html: `<div class="yield-grid">${yieldGrid(nation, city.yields)}</div>` },
      { title: "Amenities &amp; Housing", html: amenities(city, n) + gdpRow(city) },
      canada && { title: "Census geography", html: censusGeography(city) },
      city.jobs && { title: canada ? censusTitle("Industries · where people work") : "Districts · where people work", html: industries(city, nation) },
    ],
    foot: canada ? `Population: ${esc(nation.population_vintage || "")} (table 17-10-0148). Census figures: ${esc(nation.census_vintage || nation.vintage)} (tables 98-10-0448, 98-10-0061, 98-10-0253, 98-10-0256). Unemployment: ${city.unemployment != null
      ? `${esc(nation.unemployment_vintage || "Labour Force Survey")} (table 14-10-0461).`
      : "2021 Census. The Labour Force Survey does not publish census agglomerations, and the census week, in May 2021, fell during COVID-19 restrictions."}
      ${city.gdp != null ? `GDP at basic prices, ${esc(city.gdp_year)} (the latest year published), on the boundaries in Statistics Canada table 36-10-0468-01; per person divides by the July 1, ${esc(city.gdp_year)} population.` : "The metro GDP table has no figure for this area."}
      Green ×N = this industry's share of jobs is N× the Canadian share.` : `Source: ${esc(nation.vintage)} (tables C24030, B19025, B19013, B25064, B25077, B23025)${nation.gdp_vintage ? `; GDP: ${esc(nation.gdp_vintage)}` : ""}.
      Green ×N = this industry's share of jobs is N× the U.S. share.`,
    onClose: ctx.onClose,
    onPedia: ctx.onPedia,
    wire(panel) {
      panel.querySelectorAll("[data-state]").forEach((b) => (b.onclick = () => ctx.onState(+b.dataset.state)));
    },
  });
}

export const closeCityPanel = hidePanel;
