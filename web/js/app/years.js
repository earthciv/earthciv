// Figures from different years (an edition with label_years; DATA_CONTRACTS.md, "Years on figures"): the year a figure
// is from, and the figures of that same year it may be divided by or compared with, so no ratio or comparison mixes
// two years.
import { defaults, txt } from "./text.js";

defaults({
  "report.employed_period": "{year} Census",
});

/** The year of the employed counts (employed, jobs, the worker yields): nation.json employed_year, else census_year. */
export const employedYear = (nation) => nation?.employed_year ?? nation?.census_year ?? null;

/** That year as the top bar and panels name it: "2021 Census", or the edition's own wording for its survey. */
export const employedPeriod = (nation) => txt("report.employed_period", { year: employedYear(nation) ?? "" });

/** The residents a row's employed counts are a share of: its population in the counts' year, where the row gives it. */
export const employedBase = (o) => o?.employed_population ?? o?.census_population ?? o?.population ?? null;

/**
 * The national unemployment rate to compare `o`'s with: the nation's rate in the year of `o`'s (national row
 * unemployment_by_year, where areas' rates come from different years), else the nation's own rate.
 */
export const nationalUnemployment = (n, o) => n?.unemployment_by_year?.[o?.unemployment_year] ?? n?.unemployment ?? null;

/** The year of the unemployment rates in `rows` (the first row that has one), else `fallback`. */
export const unemploymentYear = (rows, fallback = null) =>
  (rows || []).find((o) => Number.isFinite(o?.unemployment))?.unemployment_year ?? fallback;
