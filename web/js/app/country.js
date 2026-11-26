// Temporary shim over app/edition.js while the browser code stops asking which country it is (docs/GLOBAL_PLAN.md,
// phase 2). Every export here is to be replaced by what the edition's manifest says; then this file goes.
import { DEFAULT_EDITION, EDITION_ID, edition } from "./edition.js";

export const DEFAULT_COUNTRY = DEFAULT_EDITION;
export const country = EDITION_ID;
export const canada = EDITION_ID === "ca";
export const countryName = edition.name;
export const regionName = edition.terms.region.one;
export const regionsName = edition.terms.region.many;
// The project this copy extends, credited in the Almanac and the help.
export const ORIGINAL_URL = "https://karpathy.ai/usaciv";
export const ANNOUNCEMENT_URL = "https://x.com/karpathy/status/2125779541952246039";
