// Render the published cards offline using the same maps as the app.
import { DATA_URL, loadJSON } from "../js/app/edition-index.js";
import { Camera } from "../js/camera.js";
import { makerOf } from "../js/ext/ports/makers.js";
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

// The largest size, from `px` down to `min`, at which `text` fits in `width`; at the smallest it is squeezed to fit.
function fitText(ctx, text, x, y, width, font, px, min) {
  let size = px;
  for (; size > min; size -= 1) {
    ctx.font = font(size);
    if (ctx.measureText(text).width <= width) break;
  }
  ctx.font = font(size);
  ctx.fillText(text, x, y, width);
}

// `aside`, when given, draws in the header's right end and returns how wide it is: the title keeps clear of it.
function compose(map, title, subtitle, brand = "EARTHCIV", aside = null) {
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
  const room = aside ? WIDTH - 30 - aside(ctx) - 40 : WIDTH;
  ctx.textAlign = "left";
  ctx.fillStyle = "#c9a45c";
  ctx.font = `bold 16px ${SANS}`;
  ctx.letterSpacing = "3px";
  ctx.fillText(brand, 30, 29);
  ctx.letterSpacing = "0px";
  ctx.fillStyle = "#f7e9c9";
  if (aside) fitText(ctx, title, 28, 79, room - 28, (px) => `bold ${px}px ${SERIF}`, 51, 34);
  else {
    ctx.font = `bold 51px ${SERIF}`;
    ctx.fillText(title, 28, 79, WIDTH - 56);
  }
  ctx.font = `20px ${SANS}`;
  ctx.fillStyle = "#dacbaa";
  ctx.fillText(subtitle, 30, 109, (aside ? room : WIDTH) - 60);
  return card.toDataURL("image/jpeg", 0.83).split(",")[1];
}

function starPath(ctx, x, y, outer, inner) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? inner : outer;
    ctx[i ? "lineTo" : "moveTo"](x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  ctx.closePath();
}

// A map's call to be rated, at the header's right end: five empty stars under the words, as the site's stars look
// before anyone picks one (they say nothing about the map's rating, which changes after the card is made).
function rateIt(ctx) {
  const size = 36, gap = 9, right = WIDTH - 30;
  const width = 5 * size + 4 * gap;
  ctx.textAlign = "right";
  ctx.fillStyle = "#c9a45c";
  ctx.font = `bold 15px ${SANS}`;
  ctx.letterSpacing = "3px";
  ctx.fillText("RATE IT ON EARTHCIV", right + 3, 40); // the spacing after the last letter, given back
  ctx.letterSpacing = "0px";
  ctx.textAlign = "left";
  ctx.lineJoin = "round";
  for (let i = 0; i < 5; i++) {
    starPath(ctx, right - width + i * (size + gap) + size / 2, 84, size / 2, size / 5);
    ctx.fillStyle = "rgba(236, 208, 142, .12)";
    ctx.fill();
    ctx.strokeStyle = "#ecd08e";
    ctx.lineWidth = 2.4;
    ctx.stroke();
  }
  return Math.max(width, 250);
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

// The cards of the maps' own pages (/map/<id>/, pipeline/share_pages.py): the world map around the map's countries,
// lit as when the map is picked on the world map, with its name, its maker and the call to rate it. render(id) also
// returns the words the page is written with, so that the page and its picture name the same maker.
async function mapCards() {
  const [outlines, catalog] = await Promise.all(
    ["world-outlines.json", "ports.json"].map((file) => loadJSON(new URL(file, DATA_URL)))
  );
  const map = canvas(WIDTH, MAP_HEIGHT);
  const frame = document.createElement("div");
  frame.style.cssText = `width:${WIDTH}px;height:${MAP_HEIGHT}px`;
  frame.append(map);
  document.body.append(frame);
  const world = createWorldMap({ canvas: map, outlines });
  world.setPorts(catalog.ports);
  const byId = new Map(catalog.ports.map((port) => [port.id, port]));
  const drawn = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  async function render(id) {
    const port = byId.get(id);
    if (!port) throw new Error(`ports.json has no map ${id}`);
    const isos = (port.countries || []).filter((iso) => world.getCountry(iso));
    // One country is picked, as a click on it would; a map of several has them all outlined instead.
    world.setSelectedCountry(isos.length === 1 ? isos[0] : null);
    world.setHighlightPort(port.id);
    if (isos.length) world.focusCountries(isos, { animate: false, fill: isos.length > 1 ? 0.92 : 0.55 });
    else world.resetView({ animate: false });
    await drawn();
    const maker = makerOf(port);
    const where = isos.length > 2 ? `${isos.length} countries` : isos.map((iso) => world.getCountryName(iso)).join(" · ");
    const by = maker ? `by ${maker.twitter ? `@${maker.twitter}` : maker.name}` : "";
    const edition = port.status === "merged" ? port.editionId || port.id : null;
    const brand = edition ? "EARTHCIV EDITION" : "COMMUNITY MAP";
    return {
      id: port.id,
      name: port.name,
      maker: maker?.name || null,
      handle: maker?.twitter || null,
      where,
      description: port.description || "",
      edition,
      jpeg: compose(map, port.name, [by, where].filter(Boolean).join(" · "), brand, rateIt),
    };
  }

  return { render };
}

const query = new URLSearchParams(location.search);
window.socialCards = query.has("maps") ? mapCards() : query.has("country") ? editionCards() : worldCard();
