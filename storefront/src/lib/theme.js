/* =========================================================================
   Colours and fonts, both driven by Admin → Storefront.

   The dashboard has its own separate settings (the `admin_` keys); this file
   only ever reads the shop's.
   ========================================================================= */

/* The weight string each family actually publishes on Google Fonts. This is
   not decoration: ask a font for a weight it does not have and Google rejects
   the request, and the font silently never loads. Lato and Ubuntu are the ones
   that catch people out — neither has a 600. */
export const FONT_SPECS = {
  Roboto: "wght@400;500;700;900",
  Inter: "wght@400;500;600;700;800",
  Poppins: "wght@400;500;600;700;800",
  Montserrat: "wght@400;500;600;700;800",
  "Open Sans": "wght@400;500;600;700;800",
  Lato: "wght@400;700;900",
  Nunito: "wght@400;500;600;700;800",
  Raleway: "wght@400;500;600;700;800",
  "Work Sans": "wght@400;500;600;700;800",
  "Source Sans 3": "wght@400;500;600;700;800",
  Ubuntu: "wght@400;500;700",
  "Bricolage Grotesque": "opsz,wght@12..96,400;12..96,600;12..96,800",
  Karla: "wght@400;500;700",
  "JetBrains Mono": "wght@400;600;700",
  "Noto Sans Devanagari": "wght@400;500;600;700",
  "Noto Sans Telugu": "wght@400;500;600;700",
  "Noto Sans Arabic": "wght@400;500;600;700",
};

/* Google retired Source Sans Pro and renamed it Source Sans 3 — asking for the
   old name returns nothing. The dashboard keeps the name people know; the
   request uses the one that works. */
const FONT_ALIASES = { "Source Sans Pro": "Source Sans 3" };

/* Already on the machine. Requesting these from Google would 404. */
const SYSTEM_FONTS = new Set(["Arial", "Helvetica", "Georgia", "Times New Roman", "Verdana"]);

const SYSTEM_FALLBACK = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** One <link> per family, on purpose: if one name is wrong only that font
 *  fails, instead of taking the others down with it. */
function loadGoogleFonts(names) {
  [...new Set(names.filter(Boolean))].forEach((chosen) => {
    if (SYSTEM_FONTS.has(chosen)) return;
    const name = FONT_ALIASES[chosen] || chosen;
    const id = `font-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    if (document.getElementById(id)) return;
    const spec = FONT_SPECS[name] || "wght@400;700";
    const family = encodeURIComponent(name).replace(/%20/g, "+");
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${family}:${spec}&display=swap`;
    document.head.appendChild(link);
  });
}

export function fontStack(name) {
  const real = FONT_ALIASES[name] || name || "";
  return `"${real}", ${SYSTEM_FALLBACK}`;
}

/** Black or white text, whichever is legible on the given background. */
function readableOn(hex) {
  const clean = (hex || "").replace("#", "");
  if (clean.length !== 6) return "#14231C";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? "#14231C" : "#FFFFFF";
}

export function applyTheme(values) {
  if (!values) return;
  const root = document.documentElement.style;

  if (values.color_ink) root.setProperty("--ink", values.color_ink);
  if (values.color_accent) {
    root.setProperty("--accent", values.color_accent);
    root.setProperty("--accent-ink", readableOn(values.color_accent));
  }
  if (values.color_paper) root.setProperty("--paper", values.color_paper);
  if (values.corner_radius) root.setProperty("--radius", `${values.corner_radius}px`);

  const display = values.font_store_display || "Work Sans";
  const body = values.font_store_body || "Inter";
  loadGoogleFonts([display, body]);
  root.setProperty("--display", fontStack(display));
  root.setProperty("--body", fontStack(body));

  document.title = values.site_name || "Shop";
}
