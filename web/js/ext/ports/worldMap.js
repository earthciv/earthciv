// Interactive Civ-styled world map canvas for the world view (web/js/ext/ports).
// Draws simplified Natural Earth country polygons in the Natural Earth I projection, shades each country by the best
// map anyone has made of it (an EarthCiv edition, a live community map, source code only, or none yet), labels the
// countries that fit, marks the tiny ones with a dot and plots a pin per map.
//
// Every country is clickable: a click inside a country picks it, a click just beside a small one picks the nearest
// country within a few pixels (more on touch screens), and a pin picks its map's country. Pan by dragging, zoom with
// the wheel, a pinch, a double click / double tap or the host's buttons; focusCountry() flies to a country.

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
// Natural Earth I polynomial coefficients (Tom Patterson / Bojan Šavrič).
const A0 = 0.8707, A1 = -0.131979, A2 = -0.013791, A3 = 0.003971, A4 = -0.001529;
const B0 = 1.007226, B1 = 0.015085, B2 = -0.044475, B3 = 0.028874, B4 = -0.005916;
const MAX_X = Math.PI * A0; // ~2.7354
const MIN_Y = projectRaw(0, -60)[1];
const MAX_Y = projectRaw(0, 84)[1];

function projectRaw(lonDeg, latDeg) {
  const lam = Math.max(-180, Math.min(180, lonDeg)) * RAD;
  const phi = Math.max(-85, Math.min(85, latDeg)) * RAD;
  const p2 = phi * phi;
  const p4 = p2 * p2;
  const x = lam * (A0 + p2 * (A1 + p2 * (A2 + p4 * (A3 + p2 * A4))));
  const y = phi * (B0 + p2 * (B1 + p4 * (B2 + p2 * (B3 + p2 * B4))));
  return [x, y];
}

function unprojectRaw(x, y) {
  let phi = Math.max(-1.48, Math.min(1.48, y / B0));
  for (let i = 0; i < 6; i++) {
    const p2 = phi * phi, p4 = p2 * p2;
    const f = phi * (B0 + p2 * (B1 + p4 * (B2 + p2 * (B3 + p2 * B4)))) - y;
    const df = B0 + p2 * (3 * B1 + p4 * (7 * B2 + p2 * (9 * B3 + 11 * p2 * B4)));
    phi -= f / (df || 1);
  }
  const p2 = phi * phi, p4 = p2 * p2;
  const denom = A0 + p2 * (A1 + p2 * (A2 + p4 * (A3 + p2 * A4)));
  const lam = denom ? x / denom : 0;
  return [lam * DEG, phi * DEG];
}

const WORLD_W = MAX_X * 2;
const WORLD_H = MAX_Y - MIN_Y;

function pointInRing(px, py, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i], yi = ring[i + 1];
    const xj = ring[j], yj = ring[j + 1];
    if (((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-12) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

// Squared distance from point (px, py) to the closed ring's edges, in world units.
function ringDist2(px, py, ring) {
  let best = Infinity;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const ax = ring[j], ay = ring[j + 1], bx = ring[i], by = ring[i + 1];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + t * dx - px, qy = ay + t * dy - py;
    const d2 = qx * qx + qy * qy;
    if (d2 < best) best = d2;
  }
  return best;
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) a += ring[j] * ring[i + 1] - ring[i] * ring[j + 1];
  return Math.abs(a / 2);
}

const STATUS_RANK = { none: 0, repo: 1, external: 2, live: 3, merged: 4 };

// Natural Earth abbreviates names to fit map labels; lists and cards show them in full. The shorter of the two labels
// the map.
const FULL_NAMES = {
  AG: "Antigua and Barbuda", BA: "Bosnia and Herzegovina", CD: "Democratic Republic of the Congo",
  CF: "Central African Republic", CK: "Cook Islands", CYN: "Northern Cyprus", DO: "Dominican Republic",
  EH: "Western Sahara", FK: "Falkland Islands", FO: "Faroe Islands", GQ: "Equatorial Guinea",
  GS: "South Georgia and the South Sandwich Islands", HM: "Heard Island and McDonald Islands",
  IO: "British Indian Ocean Territory", KN: "Saint Kitts and Nevis", KY: "Cayman Islands", MH: "Marshall Islands",
  MP: "Northern Mariana Islands", PF: "French Polynesia", PM: "Saint Pierre and Miquelon", PN: "Pitcairn Islands",
  SB: "Solomon Islands", SS: "South Sudan", TC: "Turks and Caicos Islands", TF: "French Southern and Antarctic Lands",
  US: "United States", VC: "Saint Vincent and the Grenadines", VG: "British Virgin Islands", VI: "U.S. Virgin Islands",
  WF: "Wallis and Futuna",
};

// EarthCiv palette: deep ocean, warm parchment gold for EarthCiv editions, emerald teal for community maps (a map on
// its own site has a diamond pin, the same country colour), steel blue for source code only, sea-slate for the rest.
const FILL = {
  none: "#1a2b3d",
  noneHover: "#2b4560",
  repo: "#36506e",
  repoHover: "#4f739b",
  external: "#236c5e",
  externalHover: "#36a088",
  live: "#236c5e",
  liveHover: "#36a088",
  merged: "#9e7c36",
  mergedHover: "#cfa95e",
};
const STROKE = {
  none: "rgba(116, 152, 184, 0.3)",
  repo: "rgba(155, 192, 228, 0.6)",
  external: "rgba(124, 218, 192, 0.72)",
  live: "rgba(124, 218, 192, 0.72)",
  merged: "rgba(244, 216, 146, 0.92)",
};
const PIN_COLOR = {
  merged: { fill: "#ecd08e", ring: "#1a1208" },
  live: { fill: "#43c6a3", ring: "#0c2220" },
  external: { fill: "#e09d4f", ring: "#241608" },
  custom: { fill: "#b08cf0", ring: "#1d1033" },
  repo: { fill: "#8fb2d9", ring: "#111e2d" },
};
const LABEL_FONT = '"Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif';

/** A port's map status as the world view shows it: merged | live | external | custom | repo. */
export function portKind(p) {
  if (p.status === "merged") return "merged";
  if (p.status === "custom") return "custom";
  if (p.status === "live") return p.embed ? "live" : "external";
  return "repo";
}

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function createWorldMap({ canvas, outlines, onHover, onSelectCountry, homeLon = 0, insets: initialInsets = null }) {
  const ctx = canvas.getContext("2d");
  const coarse = () => matchMedia("(pointer: coarse)").matches;

  // Pre-project every country polygon once for instant redraws & fast point-in-polygon hit tests.
  const countries = (outlines.countries || []).map((c) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const rings = (c.rings || []).map((flat) => {
      const out = new Float32Array(flat.length);
      for (let i = 0; i < flat.length; i += 2) {
        const [x, y] = projectRaw(flat[i], flat[i + 1]);
        out[i] = x;
        out[i + 1] = -y; // canvas y grows downward
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (-y < y0) y0 = -y;
        if (-y > y1) y1 = -y;
      }
      return out;
    });
    // The "main" box frames the parts that matter for zooming and labelling: rings at least a quarter the size of the
    // largest, so the U.S. frames the 48 states and Alaska rather than the Aleutians across the 180° line, and France
    // its mainland rather than French Guiana.
    const areas = rings.map(ringArea);
    const maxArea = Math.max(0, ...areas);
    let m0 = Infinity, m1 = Infinity, m2 = -Infinity, m3 = -Infinity;
    rings.forEach((r, k) => {
      if (areas[k] < maxArea * 0.25) return;
      for (let i = 0; i < r.length; i += 2) {
        if (r[i] < m0) m0 = r[i];
        if (r[i] > m2) m2 = r[i];
        if (r[i + 1] < m1) m1 = r[i + 1];
        if (r[i + 1] > m3) m3 = r[i + 1];
      }
    });
    if (!Number.isFinite(m0)) [m0, m1, m2, m3] = [x0, y0, x1, y1];
    const [cx, cy] = projectRaw(c.center?.[0] ?? 0, c.center?.[1] ?? 0);
    const full = FULL_NAMES[c.id] || c.name;
    return {
      id: c.id, name: full, short: c.name, label: full.length <= c.name.length ? full : c.name,
      continent: c.continent, cx, cy: -cy, rings,
      box: [x0, y0, x1, y1], mbox: [m0, m1, m2, m3], size: Math.max(m2 - m0, m3 - m1),
    };
  });
  const countryById = new Map(countries.map((c) => [c.id, c]));
  // Biggest first: labels go to the countries with the most room before smaller neighbours crowd them out.
  const bySize = countries.slice().sort((a, b) => b.size - a.size);

  // Projected canvas frame: x in [-MAX_X, MAX_X], y in [-MAX_Y, -MIN_Y].
  const MID_X = 0;
  const MID_Y = (-MAX_Y + -MIN_Y) / 2;

  const cam = { cx: MID_X, cy: MID_Y, zoom: 1, minZoom: 1, maxZoom: 14 };
  const insets = { bottom: 0, right: 0, ...(initialInsets || {}) }; // css px covered by a panel (a phone's sheet)
  let cssW = 1, cssH = 1, dpr = 1;
  let ports = [];
  let visiblePorts = [];
  let countryPorts = new Map(); // iso -> port[]
  let countryBest = new Map(); // iso -> "repo" | "external" | "live" | "merged"
  let pinCoords = []; // [{port, x, y, kind}]
  let selectedCountry = null;
  let hoveredCountry = null; // under the pointer
  let listHoverCountry = null; // a row hovered in the host's list
  let hoveredPortId = null;
  let highlightPortId = null; // hovered or picked card in the host's panel
  let raf = 0;
  let anim = null; // {from, to, t0, ms}
  let homed = false;
  const textW = new Map();

  function baseScale() {
    const padX = 28, padY = 26;
    return Math.min((cssW - padX) / WORLD_W, (cssH - padY) / WORLD_H);
  }
  function worldToScreen(wx, wy) {
    const s = baseScale() * cam.zoom;
    return [cssW / 2 + (wx - cam.cx) * s, cssH / 2 + (wy - cam.cy) * s];
  }
  function screenToWorld(sx, sy) {
    const s = baseScale() * cam.zoom;
    return [cam.cx + (sx - cssW / 2) / s, cam.cy + (sy - cssH / 2) / s];
  }
  function clampCam(c = cam) {
    c.zoom = Math.max(c.minZoom ?? cam.minZoom, Math.min(cam.maxZoom, c.zoom));
    const s = baseScale() * c.zoom;
    // Allow the edges to come into the area left uncovered by a bottom sheet / side panel.
    const slackX = insets.right / s / 2;
    const slackY = insets.bottom / s / 2;
    const maxDx = Math.max(0, (WORLD_W / 2) * (1 - 1 / c.zoom)) + 0.35 + slackX;
    const maxDy = Math.max(0, (WORLD_H / 2) * (1 - 1 / c.zoom)) + 0.25 + slackY;
    if (c.zoom <= 1.001 && !insets.bottom && !insets.right) {
      c.zoom = 1;
      c.cx = MID_X;
      c.cy = MID_Y;
      return c;
    }
    c.cx = Math.max(MID_X - maxDx + slackX, Math.min(MID_X + maxDx + slackX, c.cx));
    c.cy = Math.max(MID_Y - maxDy + slackY, Math.min(MID_Y + maxDy + slackY, c.cy));
    return c;
  }

  // The opening view: the whole world on a wide screen; on a narrow one (a phone held upright, where the whole world
  // is a thin strip) zoomed in so countries are big enough to tap, centred on the viewer's own longitude (from the
  // device's time zone, so nothing leaves the browser).
  function homeView() {
    const visH = Math.max(1, cssH - insets.bottom);
    const s1 = baseScale();
    const worldH1 = WORLD_H * s1;
    let zoom = 1;
    const narrow = cssW < 600 || visH > cssW * 1.05; // a phone, or any canvas taller than wide
    if (narrow && worldH1 < visH * 0.55) zoom = Math.min(2.6, (visH * 0.62) / worldH1);
    if (zoom <= 1.001) return clampCam({ cx: MID_X, cy: MID_Y + insets.bottom / (2 * s1), zoom: 1, minZoom: 1 });
    const [x] = projectRaw(homeLon, 20);
    const s = s1 * zoom;
    return clampCam({ cx: x, cy: MID_Y - 0.12 + insets.bottom / (2 * s), zoom });
  }

  function rebuildIndex() {
    countryPorts = new Map();
    countryBest = new Map();
    for (const p of visiblePorts) {
      const kind = portKind(p);
      const rankKey = kind === "custom" ? "live" : kind;
      for (const iso of p.countries || []) {
        if (!countryPorts.has(iso)) countryPorts.set(iso, []);
        countryPorts.get(iso).push(p);
        const cur = countryBest.get(iso) || "none";
        if ((STATUS_RANK[rankKey] || 0) > (STATUS_RANK[cur] || 0)) countryBest.set(iso, rankKey);
      }
    }
    // Pin positions (sorted so higher-priority pins draw last / hit first).
    const priority = { merged: 4, custom: 3, live: 2, external: 1, repo: 0 };
    pinCoords = visiblePorts
      .map((p) => {
        let x = null, y = null;
        if (Array.isArray(p.center) && p.center.length === 2) {
          const proj = projectRaw(p.center[0], p.center[1]);
          x = proj[0];
          y = -proj[1];
        } else if (p.countries?.length) {
          const c = countryById.get(p.countries[0]);
          if (c) { x = c.cx; y = c.cy; }
        }
        if (x == null || y == null) return null;
        return { port: p, x, y, kind: portKind(p) };
      })
      .filter(Boolean)
      .sort((a, b) => priority[a.kind] - priority[b.kind]);
  }

  function requestDraw() {
    if (raf) return;
    raf = requestAnimationFrame(draw);
  }

  function drawGlobeBoundary(s) {
    ctx.beginPath();
    for (let lat = -60; lat <= 84; lat += 3) {
      const [x, y] = projectRaw(-180, lat);
      const sx = cssW / 2 + (x - cam.cx) * s;
      const sy = cssH / 2 + (-y - cam.cy) * s;
      if (lat === -60) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    for (let lat = 84; lat >= -60; lat -= 3) {
      const [x, y] = projectRaw(180, lat);
      const sx = cssW / 2 + (x - cam.cx) * s;
      const sy = cssH / 2 + (-y - cam.cy) * s;
      ctx.lineTo(sx, sy);
    }
    ctx.closePath();
  }

  function measure(text, px) {
    const key = `${px}|${text}`;
    let w = textW.get(key);
    if (w == null) {
      ctx.font = `600 ${px}px ${LABEL_FONT}`;
      w = ctx.measureText(text).width;
      textW.set(key, w);
    }
    return w;
  }

  function stepAnimation(now) {
    if (!anim) return;
    const t = Math.min(1, (now - anim.t0) / anim.ms);
    const e = easeInOut(t);
    const { from, to } = anim;
    cam.zoom = Math.exp(Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * e);
    cam.cx = from.cx + (to.cx - from.cx) * e;
    cam.cy = from.cy + (to.cy - from.cy) * e;
    if (t >= 1) anim = null;
  }

  function flyTo(target, ms = 520) {
    const to = clampCam({ ...target });
    if (ms <= 0 || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      anim = null;
      Object.assign(cam, { cx: to.cx, cy: to.cy, zoom: to.zoom });
      requestDraw();
      return;
    }
    anim = { from: { cx: cam.cx, cy: cam.cy, zoom: cam.zoom }, to, t0: performance.now(), ms };
    requestDraw();
  }

  function draw(now = performance.now()) {
    raf = 0;
    if (cssW < 2 || cssH < 2) return;
    stepAnimation(now);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Deep nautical ocean background
    const bg = ctx.createRadialGradient(cssW * 0.5, cssH * 0.45, Math.min(cssW, cssH) * 0.08, cssW * 0.5, cssH * 0.5, Math.max(cssW, cssH) * 0.72);
    bg.addColorStop(0, "#133252");
    bg.addColorStop(1, "#08192b");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, cssW, cssH);

    const s = baseScale() * cam.zoom;

    // Globe sphere & subtle cartographic graticule
    ctx.save();
    drawGlobeBoundary(s);
    const sea = ctx.createRadialGradient(cssW * 0.5, cssH * 0.46, 20, cssW * 0.5, cssH * 0.5, Math.max(cssW, cssH) * 0.55);
    sea.addColorStop(0, "#163b60");
    sea.addColorStop(1, "#0b223a");
    ctx.fillStyle = sea;
    ctx.fill();
    ctx.strokeStyle = "rgba(201, 164, 92, 0.32)";
    ctx.lineWidth = 1.25;
    ctx.stroke();
    ctx.clip();

    // Graticule lines every 30°
    ctx.strokeStyle = "rgba(180, 210, 238, 0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let lat = -60; lat <= 60; lat += 30) {
      for (let lon = -180; lon <= 180; lon += 6) {
        const [x, y] = projectRaw(lon, lat);
        const sx = cssW / 2 + (x - cam.cx) * s;
        const sy = cssH / 2 + (-y - cam.cy) * s;
        if (lon === -180) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
    }
    for (let lon = -150; lon <= 150; lon += 30) {
      for (let lat = -60; lat <= 84; lat += 4) {
        const [x, y] = projectRaw(lon, lat);
        const sx = cssW / 2 + (x - cam.cx) * s;
        const sy = cssH / 2 + (-y - cam.cy) * s;
        if (lat === -60) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
    }
    ctx.stroke();

    // Highlighted port's country footprint (when hovering a card in the panel or a pin on the map)
    const activePort = highlightPortId
      ? ports.find((p) => p.id === highlightPortId)
      : hoveredPortId
        ? ports.find((p) => p.id === hoveredPortId)
        : null;
    const highlightSet = activePort ? new Set(activePort.countries || []) : null;

    const traceCountry = (c) => {
      ctx.beginPath();
      for (const ring of c.rings) {
        for (let i = 0; i < ring.length; i += 2) {
          const sx = cssW / 2 + (ring[i] - cam.cx) * s;
          const sy = cssH / 2 + (ring[i + 1] - cam.cy) * s;
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.closePath();
      }
    };
    const onScreen = (b, m = 0) => {
      const [ax, ay] = worldToScreen(b[0], b[1]);
      const [bx, by] = worldToScreen(b[2], b[3]);
      return bx >= -m && ax <= cssW + m && by >= -m && ay <= cssH + m;
    };

    // Country fills & borders
    for (const c of countries) {
      if (!onScreen(c.box, 2)) continue;
      const status = countryBest.get(c.id) || "none";
      const isHot = c.id === hoveredCountry || c.id === listHoverCountry || c.id === selectedCountry || !!highlightSet?.has(c.id);
      traceCountry(c);
      ctx.fillStyle = isHot ? FILL[`${status}Hover`] || FILL.liveHover : FILL[status] || FILL.none;
      ctx.fill();
      ctx.strokeStyle = STROKE[status] || STROKE.none;
      ctx.lineWidth = status === "none" ? 0.65 : 0.9;
      ctx.stroke();
    }

    // Crisp gold outline on selected / hovered / highlighted countries; the selected one glows.
    const emphasisIds = new Set();
    if (highlightSet) for (const id of highlightSet) emphasisIds.add(id);
    if (hoveredCountry) emphasisIds.add(hoveredCountry);
    if (listHoverCountry) emphasisIds.add(listHoverCountry);
    for (const id of emphasisIds) {
      const c = countryById.get(id);
      if (!c || id === selectedCountry) continue;
      traceCountry(c);
      ctx.strokeStyle = "#ecd08e";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    const sel = selectedCountry ? countryById.get(selectedCountry) : null;
    if (sel) {
      traceCountry(sel);
      ctx.save();
      ctx.shadowColor = "rgba(255, 228, 150, 0.85)";
      ctx.shadowBlur = 12;
      ctx.strokeStyle = "#fff3c8";
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.restore();
    }

    // Tiny countries (a few pixels across at this zoom) get a dot so they can be seen and clicked. Countries with a
    // map already carry a pin.
    for (const c of countries) {
      if (c.size * s >= 6 || countryPorts.has(c.id)) continue;
      const [sx, sy] = worldToScreen(c.cx, c.cy);
      if (sx < -6 || sx > cssW + 6 || sy < -6 || sy > cssH + 6) continue;
      const hot = c.id === hoveredCountry || c.id === listHoverCountry || c.id === selectedCountry;
      ctx.beginPath();
      ctx.arc(sx, sy, hot ? 3.6 : 2.3, 0, Math.PI * 2);
      ctx.fillStyle = hot ? "#ecd08e" : "rgba(150, 182, 212, 0.55)";
      ctx.fill();
      ctx.strokeStyle = "rgba(6, 16, 28, 0.85)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Pins: screen positions first, so labels can keep clear of them.
    const pinScale = Math.min(1.35, 0.92 + (cam.zoom - 1) * 0.1);
    const pins = [];
    for (const item of pinCoords) {
      const [sx, sy] = worldToScreen(item.x, item.y);
      if (sx < -20 || sx > cssW + 20 || sy < -20 || sy > cssH + 20) continue;
      const isActive = item.port.id === hoveredPortId || item.port.id === highlightPortId;
      const baseR = item.kind === "merged" ? 6.5 : item.kind === "repo" ? 4.0 : 5.0;
      pins.push({ item, sx, sy, isActive, r: (isActive ? baseR + 2.2 : baseR) * pinScale });
    }

    const forced = drawLabels(s, pins);

    for (const { item, sx, sy, isActive, r } of pins) {
      const pal = PIN_COLOR[item.kind] || PIN_COLOR.live;
      if (isActive || item.kind === "merged") {
        ctx.beginPath();
        ctx.arc(sx, sy, r + (isActive ? 4.5 : 3), 0, Math.PI * 2);
        ctx.fillStyle = item.kind === "merged" ? "rgba(236, 208, 142, 0.28)" : "rgba(67, 198, 163, 0.28)";
        ctx.fill();
      }
      ctx.beginPath();
      if (item.kind === "external") {
        // Diamond marker for community maps that open on their own site (a new tab)
        ctx.moveTo(sx, sy - r * 1.15);
        ctx.lineTo(sx + r * 1.15, sy);
        ctx.lineTo(sx, sy + r * 1.15);
        ctx.lineTo(sx - r * 1.15, sy);
        ctx.closePath();
      } else {
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
      }
      ctx.fillStyle = pal.fill;
      ctx.fill();
      ctx.strokeStyle = isActive ? "#fff8de" : pal.ring;
      ctx.lineWidth = isActive ? 2 : 1.3;
      ctx.stroke();
      if (item.kind === "merged") {
        ctx.beginPath();
        ctx.arc(sx, sy, r * 0.34, 0, Math.PI * 2);
        ctx.fillStyle = pal.ring;
        ctx.fill();
      }
    }
    forced(); // the picked country's name goes on top of its pins

    ctx.restore();
    if (anim) requestDraw();
  }

  // Country names, biggest countries first, wherever the name fits inside the country and clear of other labels and
  // pins. The picked country, and a country hovered in the host's list, are always named, in a pill drawn on top of
  // the pins: drawLabels() returns the function that draws those.
  function drawLabels(s, pins) {
    const placed = pins.map((p) => [p.sx - p.r - 1, p.sy - p.r - 1, p.sx + p.r + 1, p.sy + p.r + 1]);
    const hits = (r) => placed.some((q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1]);
    const forced = [...new Set([selectedCountry, listHoverCountry].filter(Boolean))];
    const setText = (px) => {
      ctx.font = `600 ${px}px ${LABEL_FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
    };

    for (const c of bySize) {
      if (forced.includes(c.id)) continue;
      const wScreen = (c.mbox[2] - c.mbox[0]) * s;
      const hScreen = (c.mbox[3] - c.mbox[1]) * s;
      if (wScreen < 34 || hScreen < 13) {
        if (c.size * s < 22) break; // sorted by size: nothing smaller fits either
        continue;
      }
      const px = countryBest.has(c.id) ? 12 : 11;
      const tw = measure(c.label, px);
      if (tw > wScreen * 0.92) continue;
      const [lx, ly] = worldToScreen(c.cx, c.cy);
      if (lx < -tw || lx > cssW + tw || ly < -20 || ly > cssH + 20) continue;
      const h = px + 4;
      // The label point, else just below or above it (clear of a pin sitting on it).
      for (const dy of [0, 13, -13]) {
        const rect = [lx - tw / 2 - 2, ly + dy - h / 2, lx + tw / 2 + 2, ly + dy + h / 2];
        if (hits(rect)) continue;
        placed.push(rect);
        setText(px);
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(7, 18, 30, 0.82)";
        ctx.strokeText(c.label, lx, ly + dy);
        ctx.fillStyle = countryBest.has(c.id) ? "rgba(255, 243, 209, 0.95)" : "rgba(196, 214, 232, 0.62)";
        ctx.fillText(c.label, lx, ly + dy);
        break;
      }
    }

    return () => {
      for (const id of forced) {
        const c = countryById.get(id);
        if (!c) continue;
        const px = 12.5;
        const tw = measure(c.label, px);
        const [lx, ly] = worldToScreen(c.cx, c.cy);
        if (lx < -tw || lx > cssW + tw || ly < -20 || ly > cssH + 20) continue;
        setText(px);
        const w = tw + 16, h = px + 8;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(lx - w / 2, ly - h / 2, w, h, h / 2);
        else ctx.rect(lx - w / 2, ly - h / 2, w, h);
        ctx.fillStyle = "rgba(10, 20, 32, 0.9)";
        ctx.fill();
        ctx.strokeStyle = "rgba(236, 208, 142, 0.8)";
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = "#fff3d1";
        ctx.fillText(c.label, lx, ly + 0.5);
      }
    };
  }

  function hitTest(sx, sy, touch = coarse()) {
    // 1. Pins (highest priority first: pinCoords is sorted low→high, so walk it backwards).
    const hitR = touch ? 17 : 11;
    let bestPin = null;
    let bestD2 = hitR * hitR;
    for (let i = pinCoords.length - 1; i >= 0; i--) {
      const item = pinCoords[i];
      const [px, py] = worldToScreen(item.x, item.y);
      const d2 = (sx - px) ** 2 + (sy - py) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestPin = item.port;
      }
    }
    // 2. The country under the point.
    const [wx, wy] = screenToWorld(sx, sy);
    let hitCountry = null;
    for (const c of countries) {
      const [x0, y0, x1, y1] = c.box;
      if (wx < x0 || wx > x1 || wy < y0 || wy > y1) continue;
      if (c.rings.some((ring) => pointInRing(wx, wy, ring))) {
        hitCountry = c;
        break;
      }
    }
    // 3. Else the nearest country within a few pixels: small islands and microstates are easy to miss.
    if (!hitCountry) {
      const s = baseScale() * cam.zoom;
      const tol = (touch ? 16 : 9) / s;
      let best = tol * tol;
      for (const c of countries) {
        const [x0, y0, x1, y1] = c.box;
        if (wx < x0 - tol || wx > x1 + tol || wy < y0 - tol || wy > y1 + tol) continue;
        let d2 = (wx - c.cx) ** 2 + (wy - c.cy) ** 2;
        if (c.size * s >= 6) for (const ring of c.rings) d2 = Math.min(d2, ringDist2(wx, wy, ring));
        if (d2 < best) {
          best = d2;
          hitCountry = c;
        }
      }
    }
    return { port: bestPin, country: hitCountry };
  }

  // The country a hit picks: a pin picks its map's country (the one under the pin if the map covers several).
  function pickFromHit(hit) {
    let country = hit.country;
    if (hit.port) {
      const isos = hit.port.countries || [];
      if (!country || !isos.includes(country.id)) country = countryById.get(isos[0]) || country;
    }
    return country;
  }

  // --- pointer & wheel interaction -------------------------------------------------------------------------------
  const pointers = new Map(); // pointerId -> {x, y}
  let drag = null; // one finger / the mouse: {id, x0, y0, cx0, cy0, moved}
  let pinch = null; // two fingers: {d0, zoom0, wx, wy}
  let lastTap = null; // {t, x, y} for double tap

  function localXY(e) {
    const rect = canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function startPinch() {
    const [a, b] = [...pointers.values()];
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const [wx, wy] = screenToWorld(mx, my);
    pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom0: cam.zoom, wx, wy };
    drag = null;
  }

  function onPointerDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    anim = null;
    canvas.setPointerCapture?.(e.pointerId);
    const [x, y] = localXY(e);
    pointers.set(e.pointerId, { x, y });
    if (pointers.size === 2) {
      startPinch();
      return;
    }
    if (pointers.size > 2) return;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, cx0: cam.cx, cy0: cam.cy, moved: 0 };
    canvas.classList.add("dragging");
  }
  function onPointerMove(e) {
    const [sx, sy] = localXY(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: sx, y: sy });
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      cam.zoom = Math.max(cam.minZoom, Math.min(cam.maxZoom, pinch.zoom0 * (d / pinch.d0)));
      const s = baseScale() * cam.zoom;
      cam.cx = pinch.wx - (mx - cssW / 2) / s;
      cam.cy = pinch.wy - (my - cssH / 2) / s;
      clampCam();
      requestDraw();
      onHover?.(null);
      return;
    }
    if (drag && drag.id === e.pointerId) {
      const dx = e.clientX - drag.x0;
      const dy = e.clientY - drag.y0;
      drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
      if (drag.moved > 4) {
        const s = baseScale() * cam.zoom;
        cam.cx = drag.cx0 - dx / s;
        cam.cy = drag.cy0 - dy / s;
        clampCam();
        requestDraw();
        onHover?.(null);
      }
      return;
    }
    if (e.pointerType !== "mouse") return; // hover is for mice; touch shows the panel on tap
    const hit = hitTest(sx, sy, false);
    const country = pickFromHit(hit);
    const nextCountry = country?.id ?? null;
    const nextPort = hit.port?.id ?? null;
    if (nextCountry !== hoveredCountry || nextPort !== hoveredPortId) {
      hoveredCountry = nextCountry;
      hoveredPortId = nextPort;
      canvas.style.cursor = country ? "pointer" : "";
      requestDraw();
    }
    if (country) {
      onHover?.({ x: e.clientX, y: e.clientY, port: hit.port, country, ports: countryPorts.get(country.id) || [] });
    } else {
      onHover?.(null);
    }
  }
  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    if (pinch) {
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 1) {
        // Carry on panning with the finger that stayed down.
        const [[id, p]] = [...pointers.entries()];
        const rect = canvas.getBoundingClientRect();
        drag = { id, x0: p.x + rect.left, y0: p.y + rect.top, cx0: cam.cx, cy0: cam.cy, moved: 99 };
      } else {
        canvas.classList.remove("dragging");
      }
      return;
    }
    if (!drag || drag.id !== e.pointerId) return;
    const wasTap = drag.moved <= 6 && e.type !== "pointercancel";
    drag = null;
    canvas.classList.remove("dragging");
    if (!wasTap) return;
    const [sx, sy] = localXY(e);
    const touch = e.pointerType !== "mouse";
    // A second tap on the same spot zooms in (a mouse uses dblclick).
    const now = performance.now();
    if (touch && lastTap && now - lastTap.t < 320 && Math.hypot(sx - lastTap.x, sy - lastTap.y) < 30) {
      lastTap = null;
      zoomAtAnimated(sx, sy, 2.2);
      return;
    }
    lastTap = touch ? { t: now, x: sx, y: sy } : null;
    const hit = hitTest(sx, sy, touch);
    const country = pickFromHit(hit);
    onSelectCountry?.(country ? { id: country.id, name: country.name } : null, {
      ports: country ? countryPorts.get(country.id) || [] : [],
      port: hit.port || null,
      x: e.clientX,
      y: e.clientY,
    });
  }
  function onPointerLeave(e) {
    if (e.pointerType !== "mouse" || drag) return;
    hoveredCountry = null;
    hoveredPortId = null;
    canvas.style.cursor = "";
    onHover?.(null);
    requestDraw();
  }
  function onWheel(e) {
    e.preventDefault();
    anim = null;
    const [sx, sy] = localXY(e);
    // Trackpad pinches arrive as ctrl+wheel with small deltas; mouse wheels as larger steps.
    const k = e.ctrlKey ? 0.01 : 0.0022;
    const factor = Math.exp(-Math.max(-240, Math.min(240, e.deltaY)) * k);
    zoomAt(sx, sy, factor);
  }
  function onDblClick(e) {
    e.preventDefault();
    const [sx, sy] = localXY(e);
    zoomAtAnimated(sx, sy, e.shiftKey ? 1 / 2 : 2);
  }
  function zoomAt(sx, sy, factor) {
    const [wx, wy] = screenToWorld(sx, sy);
    cam.zoom = Math.max(cam.minZoom, Math.min(cam.maxZoom, cam.zoom * factor));
    const s = baseScale() * cam.zoom;
    cam.cx = wx - (sx - cssW / 2) / s;
    cam.cy = wy - (sy - cssH / 2) / s;
    clampCam();
    requestDraw();
  }
  function zoomAtAnimated(sx, sy, factor) {
    const [wx, wy] = screenToWorld(sx, sy);
    const zoom = Math.max(cam.minZoom, Math.min(cam.maxZoom, cam.zoom * factor));
    const s = baseScale() * zoom;
    flyTo({ cx: wx - (sx - cssW / 2) / s, cy: wy - (sy - cssH / 2) / s, zoom }, 320);
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("dblclick", onDblClick);

  function resize() {
    const rect = canvas.parentElement?.getBoundingClientRect() || canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    const nextDpr = window.devicePixelRatio || 1;
    if (w === cssW && h === cssH && nextDpr === dpr && homed) return;
    cssW = w;
    cssH = h;
    dpr = nextDpr;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    if (!homed && cssW > 1 && cssH > 1) {
      homed = true;
      Object.assign(cam, homeView());
    }
    clampCam();
    requestDraw();
  }
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => resize()) : null;
  if (canvas.parentElement) ro?.observe(canvas.parentElement);
  resize();

  // Zoom and centre for a country: its main parts fill about half the area left uncovered by panels.
  function countryView(c) {
    const visW = Math.max(60, cssW - insets.right);
    const visH = Math.max(60, cssH - insets.bottom);
    const bw = Math.max(1e-4, c.mbox[2] - c.mbox[0]);
    const bh = Math.max(1e-4, c.mbox[3] - c.mbox[1]);
    const s1 = baseScale();
    let zoom = Math.min((visW * 0.55) / (bw * s1), (visH * 0.55) / (bh * s1));
    zoom = Math.max(1.4, Math.min(c.size * s1 < 4 ? 7 : 10, zoom));
    const s = s1 * zoom;
    const midX = (c.mbox[0] + c.mbox[2]) / 2;
    const midY = (c.mbox[1] + c.mbox[3]) / 2;
    // A country's main box can be lopsided (France and its overseas parts are excluded, but Chile is long), so centre
    // on the box, nudged towards the label point.
    const cx = midX * 0.6 + c.cx * 0.4;
    const cy = midY * 0.6 + c.cy * 0.4;
    return { cx: cx + insets.right / (2 * s), cy: cy + insets.bottom / (2 * s), zoom };
  }

  return {
    setPorts(allPorts, filtered = allPorts) {
      ports = allPorts || [];
      visiblePorts = filtered || ports;
      rebuildIndex();
      requestDraw();
    },
    setSelectedCountry(iso) {
      selectedCountry = iso || null;
      requestDraw();
    },
    setListHover(iso) {
      if (listHoverCountry === (iso || null)) return;
      listHoverCountry = iso || null;
      requestDraw();
    },
    setHighlightPort(portId) {
      if (highlightPortId === (portId || null)) return;
      highlightPortId = portId || null;
      requestDraw();
    },
    /** Fly to a country so its main parts fill about half the uncovered area. */
    focusCountry(iso, { animate = true } = {}) {
      const c = countryById.get(iso);
      if (!c) return;
      flyTo(countryView(c), animate ? 560 : 0);
    },
    /** Pan (without zooming) so the country's label point sits inside the uncovered area, if it is not already. */
    revealCountry(iso) {
      const c = countryById.get(iso);
      if (!c) return;
      const [sx, sy] = worldToScreen(c.cx, c.cy);
      const m = 36;
      if (sx > m && sx < cssW - insets.right - m && sy > m && sy < cssH - insets.bottom - m) return;
      const s = baseScale() * cam.zoom;
      const tx = (cssW - insets.right) / 2, ty = (cssH - insets.bottom) / 2;
      flyTo({ cx: c.cx - (tx - cssW / 2) / s, cy: c.cy - (ty - cssH / 2) / s, zoom: cam.zoom }, 380);
    },
    setInsets({ bottom = 0, right = 0 } = {}) {
      insets.bottom = Math.max(0, bottom);
      insets.right = Math.max(0, right);
    },
    zoomBy(factor) {
      zoomAtAnimated(cssW / 2, (cssH - insets.bottom) / 2, factor);
    },
    panBy(dx, dy) {
      anim = null;
      const s = baseScale() * cam.zoom;
      cam.cx += dx / s;
      cam.cy += dy / s;
      clampCam();
      requestDraw();
    },
    resetView({ animate = true } = {}) {
      flyTo(homeView(), animate ? 450 : 0);
    },
    getCountryName(iso) {
      return countryById.get(iso)?.name || iso;
    },
    getCountry(iso) {
      const c = countryById.get(iso);
      return c ? { id: c.id, name: c.name, short: c.short, continent: c.continent } : null;
    },
    listCountries() {
      return countries.map((c) => ({ id: c.id, name: c.name, short: c.short, continent: c.continent }));
    },
    countryStatus(iso) {
      return countryBest.get(iso) || "none";
    },
    getCountryCoverage() {
      return countryPorts.size;
    },
    /** Where a country's label point is, in css px from the canvas's top left (for tests and the console). */
    pointOf(iso) {
      const c = countryById.get(iso);
      if (!c) return null;
      const [x, y] = worldToScreen(c.cx, c.cy);
      return { x, y };
    },
    resize,
    unproject: unprojectRaw,
    destroy() {
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("dblclick", onDblClick);
    },
  };
}
