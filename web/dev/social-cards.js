// Render the published cards offline using the same maps as the app.
import { DATA_URL, loadJSON } from "../js/app/edition-index.js";
import { Camera } from "../js/camera.js";
import { createWorldMap } from "../js/ext/ports/worldMap.js";
import { applyLens, prepareWorld } from "../js/world.js";

const WIDTH = 1200, HEIGHT = 630, HEADER = 128;
const MAP_HEIGHT = HEIGHT - HEADER;
const SERIF = 'Georgia, "Times New Roman", serif';
const SANS = 'system-ui, sans-serif';

function canvas(width, height) {
  const node = document.createElement("canvas");
  node.width = width;
  node.height = height;
  return node;
}

function compose(map, title, subtitle, brand = "EARTHCIV") {
  const card = canvas(WIDTH, HEIGHT);
  const ctx = card.getContext("2d");
  ctx.drawImage(map, 0, HEADER);
  const fill = ctx.createLinearGradient(0, 0, WIDTH, 0);
  fill.addColorStop(0, "#25374a");
  fill.addColorStop(1, "#111c2a");
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, WIDTH, HEADER);
  ctx.strokeStyle = "#aa8a4e";
  ctx.strokeRect(1, 1, WIDTH - 2, HEIGHT - 2);
  ctx.fillStyle = "#c9a45c";
  ctx.fillRect(1, HEADER - 2, WIDTH - 2, 2);
  ctx.font = `bold 16px ${SANS}`;
  ctx.letterSpacing = "3px";
  ctx.fillText(brand, 30, 29);
  ctx.letterSpacing = "0px";
  ctx.font = `bold 51px ${SERIF}`;
  ctx.fillStyle = "#f7e9c9";
  ctx.fillText(title, 28, 79, WIDTH - 56);
  ctx.font = `20px ${SANS}`;
  ctx.fillStyle = "#dacbaa";
  ctx.fillText(subtitle, 30, 109, WIDTH - 60);
  return card.toDataURL("image/jpeg", 0.83).split(",")[1];
}

async function worldCard() {
  const [outlines, catalog] = await Promise.all(
    ["world-outlines.json", "ports.json"].map((file) => loadJSON(new URL(file, DATA_URL)))
  );
  const map = canvas(WIDTH, MAP_HEIGHT);
  const frame = document.createElement("div");
  frame.style.cssText = `width:${WIDTH}px;height:${MAP_HEIGHT}px`;
  frame.append(map);
  document.body.append(frame);
  createWorldMap({ canvas: map, outlines }).setPorts(catalog.ports);
  await new Promise((resolve) => requestAnimationFrame(resolve));
  return {
    render: () => compose(map, "EarthCiv", "The real world, mapped like a strategy game", "WORLD ATLAS"),
  };
}

async function editionCards() {
  const { edition, dataURL, declares } = await import("../js/app/edition.js");
  const { renderToCanvas } = await import("../js/render/snapshot.js");
  const [world, cities, nation, lensData] = await Promise.all(
    ["world", "cities", "nation", "lenses"].map((name) => declares(name) ? loadJSON(dataURL(name)) : null)
  );
  const lenses = lensData?.lenses || [];
  const country = edition.name;
  const cards = [
    { kind: null, id: null, name: country },
    ...cities.map((city) => ({ kind: "city", id: city.id, name: city.name, regions: city.states || [] })),
    ...lenses.map((lens) => ({ kind: "lens", id: lens.id, name: lens.name })),
  ];
  const citiesById = new Map(cities.map((city) => [city.id, city]));
  const lensesById = new Map(lenses.map((lens) => [lens.id, lens]));
  const w = prepareWorld(world, cities);
  const map = canvas(WIDTH, MAP_HEIGHT);
  const dpr = 1.5;
  const home = new Camera(world.width, world.height);
  home.resize(WIDTH / dpr, MAP_HEIGHT / dpr);
  const xs = [], ys = [];
  for (let i = 0; i < w.grid.size; i++) {
    if (world.owner[i] < 0) continue;
    xs.push(w.grid.cx(i));
    ys.push(w.grid.cy(i));
  }
  const r = w.grid.R;
  home.fit(Math.min(...xs) - r, Math.min(...ys) - r, Math.max(...xs) + r, Math.max(...ys) + r, 9);
  let lastLens;

  function render({ kind, id, name, regions }) {
    const city = kind === "city" ? citiesById.get(id) : null;
    const lens = kind === "lens" ? lensesById.get(id) : null;
    if (lens !== lastLens) {
      applyLens(w, lens);
      lastLens = lens;
    }
    const state = { cities, lens, selectedCity: city, hoverCell: -1 };
    const view = city ? { x: city.x, y: city.y - r / 2, scale: 40 / r } : {};
    renderToCanvas(map, home, w, state, nation, { ...view, dpr, banners: !lens });
    const subtitle = city ? [...regions, country].join(", ")
      : lens ? `${country} · Map lens` : "Explore its cities, terrain, and economy";
    return compose(map, name, subtitle);
  }

  return { cards, render };
}

window.socialCards = new URLSearchParams(location.search).has("country") ? editionCards() : worldCard();
