// Interactive Civ-styled world map canvas for the All Ports atlas (web/js/ext/ports).
// Draws simplified Natural Earth country polygons in the Natural Earth I projection, shades each country by its
// best available port (merged in EarthCiv, live community port, source-only repo, or unmapped), plots clickable
// port medallions, and supports pan, zoom, hover tooltips and country/port hit testing.

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

const STATUS_RANK = { none: 0, repo: 1, live: 2, custom: 2, merged: 3 };

// EarthCiv palette: deep ocean, warm parchment gold for merged editions, emerald teal for live unmerged ports,
// steel blue for source-only repos, muted sea-slate for unmapped land.
const FILL = {
  none: "#1a2b3d",
  noneHover: "#243b52",
  repo: "#36506e",
  repoHover: "#4b6e94",
  live: "#236c5e",
  liveHover: "#339480",
  merged: "#9e7c36",
  mergedHover: "#c9a45c",
};
const STROKE = {
  none: "rgba(116, 152, 184, 0.28)",
  repo: "rgba(155, 192, 228, 0.6)",
  live: "rgba(124, 218, 192, 0.72)",
  merged: "rgba(244, 216, 146, 0.92)",
};
const PIN_COLOR = {
  merged: { fill: "#ecd08e", ring: "#1a1208", text: "#1a1208" },
  live: { fill: "#43c6a3", ring: "#0c2220", text: "#071a16" },
  external: { fill: "#e09d4f", ring: "#241608", text: "#1a1004" },
  custom: { fill: "#b08cf0", ring: "#1d1033", text: "#140926" },
  repo: { fill: "#8fb2d9", ring: "#111e2d", text: "#0d1722" },
};

export function createWorldMap({ canvas, outlines, onHover, onSelectCountry, onSelectPort }) {
  const ctx = canvas.getContext("2d");

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
    const [cx, cy] = projectRaw(c.center?.[0] ?? 0, c.center?.[1] ?? 0);
    return { id: c.id, name: c.name, continent: c.continent, cx, cy: -cy, rings, box: [x0, y0, x1, y1] };
  });
  const countryById = new Map(countries.map((c) => [c.id, c]));

  // Projected canvas frame: x in [-MAX_X, MAX_X], y in [-MAX_Y, -MIN_Y].
  const MID_X = 0;
  const MID_Y = (-MAX_Y + -MIN_Y) / 2;

  const cam = { cx: MID_X, cy: MID_Y, zoom: 1, minZoom: 1, maxZoom: 9 };
  let cssW = 1, cssH = 1, dpr = 1;
  let ports = [];
  let visiblePorts = [];
  let countryPorts = new Map(); // iso -> port[]
  let countryBest = new Map(); // iso -> "none" | "repo" | "live" | "merged"
  let pinCoords = []; // [{port, x, y, kind}]
  let selectedCountry = null;
  let hoveredCountry = null;
  let hoveredPortId = null;
  let highlightPortId = null; // hovered or selected card in the sidebar
  let raf = 0;

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
  function clampCam() {
    if (cam.zoom <= 1.001) {
      cam.zoom = 1;
      cam.cx = MID_X;
      cam.cy = MID_Y;
      return;
    }
    const maxDx = (WORLD_W / 2) * (1 - 1 / cam.zoom) + 0.35;
    const maxDy = (WORLD_H / 2) * (1 - 1 / cam.zoom) + 0.25;
    cam.cx = Math.max(MID_X - maxDx, Math.min(MID_X + maxDx, cam.cx));
    cam.cy = Math.max(MID_Y - maxDy, Math.min(MID_Y + maxDy, cam.cy));
  }

  function rebuildIndex() {
    countryPorts = new Map();
    countryBest = new Map();
    for (const p of visiblePorts) {
      for (const iso of p.countries || []) {
        if (!countryPorts.has(iso)) countryPorts.set(iso, []);
        countryPorts.get(iso).push(p);
        const cur = countryBest.get(iso) || "none";
        const rankKey = p.status === "custom" ? "live" : p.status;
        if ((STATUS_RANK[rankKey] || 0) > (STATUS_RANK[cur] || 0)) {
          countryBest.set(iso, rankKey);
        }
      }
    }
    // Build pin positions (sorted so higher-priority pins draw last / hit first).
    const priority = (p) => (p.status === "merged" ? 4 : p.status === "custom" ? 3 : p.status === "live" && p.embed ? 2 : p.status === "live" ? 1 : 0);
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
        const kind = p.status === "merged" ? "merged" : p.status === "custom" ? "custom" : p.status === "live" ? (p.embed ? "live" : "external") : "repo";
        return { port: p, x, y, kind };
      })
      .filter(Boolean)
      .sort((a, b) => priority(a.port) - priority(b.port));
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

  function draw() {
    raf = 0;
    if (cssW < 2 || cssH < 2) return;
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

    // Highlighted port's country footprint (when hovering a sidebar card or map pin)
    const activePort = highlightPortId
      ? ports.find((p) => p.id === highlightPortId)
      : hoveredPortId
        ? ports.find((p) => p.id === hoveredPortId)
        : null;
    const highlightSet = activePort ? new Set(activePort.countries || []) : null;

    // Draw country fills & borders
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

    for (const c of countries) {
      const status = countryBest.get(c.id) || "none";
      const isHot = c.id === hoveredCountry || c.id === selectedCountry || !!highlightSet?.has(c.id);
      traceCountry(c);
      ctx.fillStyle = isHot ? FILL[`${status}Hover`] || FILL.liveHover : FILL[status] || FILL.none;
      ctx.fill();
      ctx.strokeStyle = STROKE[status] || STROKE.none;
      ctx.lineWidth = status === "none" ? 0.65 : 0.9;
      ctx.stroke();
    }

    // Crisp gold outline on selected / hovered / highlighted countries
    const emphasisIds = new Set();
    if (highlightSet) for (const id of highlightSet) emphasisIds.add(id);
    if (selectedCountry) emphasisIds.add(selectedCountry);
    if (hoveredCountry) emphasisIds.add(hoveredCountry);
    for (const id of emphasisIds) {
      const c = countryById.get(id);
      if (!c) continue;
      traceCountry(c);
      ctx.strokeStyle = id === selectedCountry ? "#ffefb8" : "#ecd08e";
      ctx.lineWidth = id === selectedCountry ? 2.1 : 1.5;
      ctx.stroke();
    }

    // Draw port pins
    const pinScale = Math.min(1.35, 0.92 + (cam.zoom - 1) * 0.1);
    for (const item of pinCoords) {
      const [sx, sy] = worldToScreen(item.x, item.y);
      if (sx < -20 || sx > cssW + 20 || sy < -20 || sy > cssH + 20) continue;
      const isActive = item.port.id === hoveredPortId || item.port.id === highlightPortId;
      const pal = PIN_COLOR[item.kind] || PIN_COLOR.live;
      const baseR = item.kind === "merged" ? 6.5 : item.kind === "repo" ? 4.0 : 5.0;
      const r = (isActive ? baseR + 2.2 : baseR) * pinScale;

      if (isActive || item.kind === "merged") {
        ctx.beginPath();
        ctx.arc(sx, sy, r + (isActive ? 4.5 : 3), 0, Math.PI * 2);
        ctx.fillStyle = item.kind === "merged" ? "rgba(236, 208, 142, 0.28)" : "rgba(67, 198, 163, 0.28)";
        ctx.fill();
      }

      ctx.beginPath();
      if (item.kind === "external") {
        // Diamond marker for live ports that open in a new tab
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

      // Inner star / center dot for merged editions
      if (item.kind === "merged") {
        ctx.beginPath();
        ctx.arc(sx, sy, r * 0.34, 0, Math.PI * 2);
        ctx.fillStyle = pal.ring;
        ctx.fill();
      }
    }

    ctx.restore();
  }

  function hitTest(sx, sy) {
    // 1. Check port pins (highest priority first — pinCoords is sorted low→high so iterate reverse).
    const hitR = 11;
    let bestPin = null;
    let bestD2 = hitR * hitR;
    for (let i = pinCoords.length - 1; i >= 0; i--) {
      const item = pinCoords[i];
      const [px, py] = worldToScreen(item.x, item.y);
      const d2 = (sx - px) ** 2 + (sy - py) ** 2;
      if (d2 <= bestD2) {
        bestD2 = d2;
        bestPin = item.port;
      }
    }
    // 2. Check country polygons.
    const [wx, wy] = screenToWorld(sx, sy);
    let hitCountry = null;
    for (const c of countries) {
      const [x0, y0, x1, y1] = c.box;
      if (wx < x0 || wx > x1 || wy < y0 || wy > y1) continue;
      for (const ring of c.rings) {
        if (pointInRing(wx, wy, ring)) {
          hitCountry = c;
          break;
        }
      }
      if (hitCountry) break;
    }
    return { port: bestPin, country: hitCountry };
  }

  // --- pointer & wheel interaction -------------------------------------------------------------------------------
  let drag = null;

  function onPointerDown(e) {
    if (e.button !== 0) return;
    canvas.setPointerCapture?.(e.pointerId);
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, cx0: cam.cx, cy0: cam.cy, moved: 0 };
    canvas.classList.add("dragging");
  }
  function onPointerMove(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    if (drag && drag.id === e.pointerId) {
      const dx = e.clientX - drag.x0;
      const dy = e.clientY - drag.y0;
      drag.moved = Math.hypot(dx, dy);
      if (drag.moved > 3) {
        const s = baseScale() * cam.zoom;
        cam.cx = drag.cx0 - dx / s;
        cam.cy = drag.cy0 - dy / s;
        clampCam();
        requestDraw();
        onHover?.(null);
      }
      return;
    }
    const hit = hitTest(sx, sy);
    const nextCountry = hit.country?.id ?? (hit.port?.countries?.length === 1 ? hit.port.countries[0] : null);
    const nextPort = hit.port?.id ?? null;
    if (nextCountry !== hoveredCountry || nextPort !== hoveredPortId) {
      hoveredCountry = nextCountry;
      hoveredPortId = nextPort;
      canvas.style.cursor = hit.port || hit.country ? "pointer" : "grab";
      requestDraw();
    }
    if (hit.port || hit.country) {
      const iso = hit.country?.id ?? hit.port?.countries?.[0] ?? null;
      const matching = iso ? countryPorts.get(iso) || [] : [];
      onHover?.({
        x: e.clientX,
        y: e.clientY,
        port: hit.port,
        country: hit.country,
        ports: matching,
      });
    } else {
      onHover?.(null);
    }
  }
  function onPointerUp(e) {
    if (!drag || drag.id !== e.pointerId) return;
    const wasTap = drag.moved <= 4;
    drag = null;
    canvas.classList.remove("dragging");
    if (!wasTap) return;
    const rect = canvas.getBoundingClientRect();
    const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (hit.port && (!hit.country || hit.port.scope === "region" || hit.port.scope === "multi" || (countryPorts.get(hit.country.id)?.length || 0) <= 1)) {
      onSelectPort?.(hit.port);
    } else if (hit.country) {
      onSelectCountry?.(hit.country, countryPorts.get(hit.country.id) || []);
    } else if (hit.port) {
      onSelectPort?.(hit.port);
    } else {
      onSelectCountry?.(null, []);
    }
  }
  function onPointerLeave() {
    if (drag) return;
    hoveredCountry = null;
    hoveredPortId = null;
    onHover?.(null);
    requestDraw();
  }
  function onWheel(e) {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const factor = Math.exp(-Math.max(-240, Math.min(240, e.deltaY)) * 0.0022);
    zoomAt(sx, sy, factor);
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

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  function resize() {
    const rect = canvas.parentElement?.getBoundingClientRect() || canvas.getBoundingClientRect();
    cssW = Math.max(1, Math.floor(rect.width));
    cssH = Math.max(1, Math.floor(rect.height));
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    clampCam();
    requestDraw();
  }
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
  if (canvas.parentElement) ro?.observe(canvas.parentElement);
  resize();

  return {
    setPorts(allPorts, filteredPorts = allPorts) {
      ports = allPorts || [];
      visiblePorts = filteredPorts || ports;
      rebuildIndex();
      requestDraw();
    },
    setSelectedCountry(iso) {
      selectedCountry = iso || null;
      requestDraw();
    },
    setHighlightPort(portId) {
      if (highlightPortId === (portId || null)) return;
      highlightPortId = portId || null;
      requestDraw();
    },
    focusCountry(iso) {
      const c = countryById.get(iso);
      if (!c) return;
      selectedCountry = iso;
      const bw = Math.max(0.18, c.box[2] - c.box[0]);
      const bh = Math.max(0.18, c.box[3] - c.box[1]);
      const targetS = Math.min((cssW * 0.55) / bw, (cssH * 0.55) / bh);
      cam.zoom = Math.max(1.5, Math.min(cam.maxZoom, targetS / Math.max(1e-6, baseScale())));
      cam.cx = c.cx;
      cam.cy = c.cy;
      clampCam();
      requestDraw();
    },
    zoomBy(factor) {
      zoomAt(cssW / 2, cssH / 2, factor);
    },
    resetView() {
      cam.zoom = 1;
      cam.cx = MID_X;
      cam.cy = MID_Y;
      requestDraw();
    },
    getCountryName(iso) {
      return countryById.get(iso)?.name || iso;
    },
    getCountryCoverage() {
      return countryPorts.size;
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
    },
  };
}
