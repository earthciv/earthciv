// Which edition the page shows. `?country=ca` or `?country=us` picks one; without it, the page's default edition
// applies: index.html declares it as <html data-default-country="…"> (this deployment opens on Canada). Pages that
// declare none, such as the dev tools, and anything running outside a browser, use the U.S. edition.
const COUNTRIES = ["us", "ca"];
const declared = typeof document !== "undefined" ? document.documentElement?.dataset?.defaultCountry : null;
export const DEFAULT_COUNTRY = COUNTRIES.includes(declared) ? declared : "us";
const requested = typeof location !== "undefined" ? new URLSearchParams(location.search).get("country") : null;
export const country = COUNTRIES.includes(requested) ? requested : DEFAULT_COUNTRY;
export const canada = country === "ca";
export const countryName = canada ? "Canada" : "United States";
export const regionName = canada ? "Province or territory" : "State";
export const regionsName = canada ? "Provinces & territories" : "States";
// The project this copy extends, credited in the Almanac and the help.
export const ORIGINAL_URL = "https://karpathy.ai/usaciv";
export const ANNOUNCEMENT_URL = "https://x.com/karpathy/status/2125779541952246039";
