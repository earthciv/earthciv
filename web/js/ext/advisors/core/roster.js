// The advisors: who they are and their colours. The advisors' dock (../index.js) adds each one's view; the world map's
// World Rankings (web/js/ext/ports/rankingsView.js) gives its tabs the same medallions. No imports, so the world map
// can read it without loading an edition.
export const ROSTER = [
  { id: "energy", name: "Energy & Resources", role: "Minister of Power", color: "#d98a2b", dark: "#3a1f08", blurb: "Where the power comes from, and what lies underground." },
  { id: "economy", name: "Economy", role: "Treasurer", color: "#c9a43a", dark: "#3a2c08", blurb: "Who makes what: GDP by industry and the metros that lead it." },
  { id: "people", name: "People", role: "Keeper of the Census", color: "#c46a4f", dark: "#3a140c", blurb: "Where people live, where they are moving, how old and how new." },
  { id: "prosperity", name: "Prosperity & Housing", role: "Steward of the Hearth", color: "#3f9c82", dark: "#082a22", blurb: "Incomes, home prices, rents and who is being left behind." },
  { id: "knowledge", name: "Knowledge", role: "Royal Scholar", color: "#4a86d6", dark: "#0a1c3a", blurb: "Degrees, broadband and the science workforce." },
  { id: "land", name: "Land", role: "Surveyor General", color: "#6e9a3c", dark: "#18280a", blurb: "Forest, farmland, desert and city: what covers the country." },
  { id: "military", name: "Military", role: "General", color: "#8796ab", dark: "#141b26", blurb: "Bases and ranges, troops and defense dollars by state, and where veterans live." },
  { id: "commerce", name: "Commerce", role: "Master of Trade", color: "#2fa4b8", dark: "#062630", blurb: "The great freight routes between metros, and the busiest ports and airports." },
  { id: "culture", name: "Culture", role: "Keeper of Wonders", color: "#c25b9a", dark: "#2e0c22", blurb: "Wonders of the land, faith and wellbeing, and the disasters places endure." },
  { id: "explorer", name: "Explorer", role: "Cartographer", color: "#9a7bc9", dark: "#1e1236", blurb: "Slice and dice every number: any level, any columns, any chart." },
];
