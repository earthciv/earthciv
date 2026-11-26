// Phones and touch screens. The top bar on phones (css/style.css, max-width 700px) is two fixed rows instead of one
// sideways-scrolling strip: the country picker, Countries, a search button and a menu (Advisors, Share, Help,
// Almanac and any extension buttons) on top, the national yields below. This wires the parts CSS cannot:
//  * the menu button and closing the menu;
//  * the search field's close button (the field opens over the first row while it has focus);
//  * dropping the word "Countries" (keeping its globe and count) when the first row is too narrow for it;
//  * the map's Home button;
//  * on iOS, stopping Safari from zooming the page into a text field or menu whose font is under 16 px.
import { icon } from "./icon.js";

const PHONE = "(max-width: 700px)";
const MENU_SVG = `<svg class="icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 6.5h16M4 12h16M4 17.5h16" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/></svg>`;
const HOME_SVG = `<svg class="icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="12" cy="12" r="2.6" fill="currentColor"/></svg>`;

export function initMobile({ app } = {}) {
  const phone = matchMedia(PHONE);
  preventIosInputZoom();

  const bar = document.getElementById("topbar");
  if (!bar) return;

  // --- menu ------------------------------------------------------------------------------------------------------
  const menuBtn = document.getElementById("btn-menu");
  const menu = bar.querySelector(".tb-buttons");
  const help = document.getElementById("btn-help");
  // Help is an icon on desktop; the menu lists it by name.
  if (help && !help.querySelector(".lbl")) help.insertAdjacentHTML("beforeend", `<span class="lbl lbl-menu">Help</span>`);
  if (help && matchMedia("(hover: none)").matches) help.setAttribute("aria-label", "Help: touch controls");
  if (menuBtn && menu) {
    menuBtn.innerHTML = MENU_SVG;
    const setOpen = (open) => {
      bar.classList.toggle("menu-open", open);
      menuBtn.setAttribute("aria-expanded", String(open));
    };
    menuBtn.addEventListener("click", () => setOpen(!bar.classList.contains("menu-open")));
    // Choosing an item closes the menu (the item's own handler has already run).
    menu.addEventListener("click", (e) => {
      if (e.target.closest("button")) setOpen(false);
    });
    document.addEventListener("pointerdown", (e) => {
      if (bar.classList.contains("menu-open") && !e.target.closest(".tb-buttons, #btn-menu")) setOpen(false);
    }, true);
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !bar.classList.contains("menu-open")) return;
      e.stopPropagation();
      setOpen(false);
      menuBtn.focus();
    }, true);
    phone.addEventListener?.("change", () => setOpen(false));
  }

  // --- search ----------------------------------------------------------------------------------------------------
  const input = document.getElementById("search-input");
  const closeSearch = bar.querySelector(".search-close");
  if (input && closeSearch) {
    closeSearch.innerHTML = icon("close", "✕", { size: 12 });
    closeSearch.addEventListener("click", () => {
      if (input.value) {
        input.value = "";
        input.dispatchEvent(new Event("input"));
      }
      input.blur();
      closeSearch.blur();
    });
  }

  // --- first row: drop the "Countries" label when it does not fit ------------------------------------------------
  // The switcher's width with every label showing is measured whenever the label shows, so hiding it cannot flip
  // the decision back (no resize loop).
  const switcher = bar.querySelector(".country-switcher");
  const searchBox = bar.querySelector(".search");
  let natural = 0;
  function fitFirstRow() {
    if (!switcher) return;
    if (!phone.matches) {
      bar.classList.remove("tb-tight");
      return;
    }
    // While the search field is open it covers the row (and a phone keyboard resizes the window): measure later.
    if (searchBox?.matches(":focus-within")) return;
    if (!bar.classList.contains("tb-tight")) natural = switcher.offsetWidth;
    const cs = getComputedStyle(bar);
    const gap = parseFloat(cs.columnGap) || 0;
    const avail = bar.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    let rest = gap; // the spacer between the switcher and Search takes a gap of its own
    for (const el of [searchBox, menuBtn]) if (el) rest += el.offsetWidth + gap;
    bar.classList.toggle("tb-tight", natural + rest > avail);
  }
  if (typeof ResizeObserver === "function" && switcher) new ResizeObserver(() => fitFirstRow()).observe(switcher);
  addEventListener("resize", fitFirstRow);
  searchBox?.addEventListener("focusout", () => requestAnimationFrame(fitFirstRow));
  document.fonts?.ready?.then(fitFirstRow);
  fitFirstRow();

  // --- map controls ----------------------------------------------------------------------------------------------
  const homeBtn = document.getElementById("btn-home");
  if (homeBtn) {
    homeBtn.innerHTML = HOME_SVG;
    homeBtn.addEventListener("click", () => app?.home?.());
  }
}

// Safari on iOS zooms the page into any focused text field or <select> whose font is under 16 px, and leaves it
// zoomed. maximum-scale=1 stops that; iOS still lets people pinch-zoom the page (it has ignored the limit for user
// zoom since iOS 10), so it is only added there: elsewhere it would turn pinch-zoom off.
function preventIosInputZoom() {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const meta = document.querySelector('meta[name="viewport"]');
  if (!ios || !meta || /maximum-scale/.test(meta.content)) return;
  meta.content += ", maximum-scale=1";
}
