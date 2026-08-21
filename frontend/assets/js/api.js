/* =========================================================================
   Shared API client + small helpers. Loaded by both the storefront and the
   admin panel.

   If you host the API on a different domain than the pages, set
   API_BASE below to that origin, e.g. "https://api.myshop.com".
   ========================================================================= */

const API_BASE = "";

/* The shop and the dashboard keep separate sessions, under separate keys.
   Signing in to one does not sign you in to the other — so you can be logged
   in as the owner in one tab and browse as a customer in another, and a
   shared computer does not leak the dashboard to whoever shops next.

   The scope is set in admin.html before this file loads. */
const TOKEN_KEYS = { store: "shopkit_token", admin: "shopkit_admin_token" };
const tokenKey = () => TOKEN_KEYS[window.AUTH_SCOPE] || TOKEN_KEYS.store;

const Auth = {
  get scope() { return window.AUTH_SCOPE === "admin" ? "admin" : "store"; },
  get token() { return localStorage.getItem(tokenKey()) || ""; },
  set token(value) {
    if (value) localStorage.setItem(tokenKey(), value);
    else localStorage.removeItem(tokenKey());
  },
  clear() { localStorage.removeItem(tokenKey()); },
};

/** Thrown for any non-2xx response. `.message` is safe to show a person. */
class ApiError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

function readError(status, body) {
  const detail = body && body.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length) {
    const first = detail[0];
    const field = (first.loc || []).filter((p) => p !== "body").join(".");
    return field ? `${field}: ${first.msg}` : first.msg;
  }
  if (status === 401) return "Sign in to continue.";
  if (status === 403) return "You do not have access to that.";
  if (status >= 500) return "The server had a problem. Try again in a moment.";
  return "Something went wrong.";
}

async function request(path, { method = "GET", body, query, isForm } = {}) {
  let url = API_BASE + path;
  if (query) {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") params.append(k, v);
    });
    const qs = params.toString();
    if (qs) url += "?" + qs;
  }

  const headers = {};
  if (Auth.token) headers.Authorization = `Bearer ${Auth.token}`;
  if (body && !isForm) headers["Content-Type"] = "application/json";

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: isForm ? body : body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Cannot reach the server. Check that it is running.");
  }

  if (response.status === 204) return null;

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    if (response.status === 401) Auth.clear();
    throw new ApiError(response.status, readError(response.status, data), data);
  }
  return data;
}

/** Every endpoint the frontend uses, in one place. */
const API = {
  // auth
  register: (body) => request("/api/auth/register", { method: "POST", body }),
  login: (body) => request("/api/auth/login", { method: "POST", body }),
  me: () => request("/api/auth/me"),
  updateProfile: (body) => request("/api/auth/me", { method: "PATCH", body }),
  changePassword: (body) => request("/api/auth/change-password", { method: "POST", body }),

  // storefront
  settings: () => request("/api/settings"),
  categories: () => request("/api/categories"),
  products: (query) => request("/api/products", { query }),
  product: (slug) => request(`/api/products/${slug}`),
  previewCart: (items, promo_code = "") =>
    request("/api/cart/preview", { method: "POST", body: { items, promo_code } }),

  // orders
  placeOrder: (body) => request("/api/orders", { method: "POST", body }),
  myOrders: (query) => request("/api/orders", { query }),
  myOrder: (number) => request(`/api/orders/${number}`),

  // admin
  dashboard: () => request("/api/admin/dashboard"),
  adminProducts: (query) => request("/api/admin/products", { query }),
  adminProduct: (id) => request(`/api/admin/products/${id}`),
  createProduct: (body) => request("/api/admin/products", { method: "POST", body }),
  updateProduct: (id, body) => request(`/api/admin/products/${id}`, { method: "PATCH", body }),
  deleteProduct: (id) => request(`/api/admin/products/${id}`, { method: "DELETE" }),

  adminCategories: () => request("/api/admin/categories"),
  createCategory: (body) => request("/api/admin/categories", { method: "POST", body }),
  updateCategory: (id, body) => request(`/api/admin/categories/${id}`, { method: "PATCH", body }),
  deleteCategory: (id) => request(`/api/admin/categories/${id}`, { method: "DELETE" }),

  adminOrders: (query) => request("/api/admin/orders", { query }),
  adminOrder: (id) => request(`/api/admin/orders/${id}`),
  setOrderStatus: (id, status) =>
    request(`/api/admin/orders/${id}/status`, { method: "PATCH", body: { status } }),

  adminUsers: (query) => request("/api/admin/users", { query }),
  createUser: (body) => request("/api/admin/users", { method: "POST", body }),
  updateUser: (id, body) => request(`/api/admin/users/${id}`, { method: "PATCH", body }),
  deleteUser: (id) => request(`/api/admin/users/${id}`, { method: "DELETE" }),

  // languages and promo codes
  languages: () => request("/api/languages"),
  languagePack: (code) => request(`/api/i18n/${code}`),
  checkPromo: (code, subtotal) => request("/api/promo/check", { method: "POST", body: { code, subtotal } }),
  adminLanguages: () => request("/api/admin/languages"),
  createLanguage: (body) => request("/api/admin/languages", { method: "POST", body }),
  updateLanguage: (id, body) => request(`/api/admin/languages/${id}`, { method: "PATCH", body }),
  deleteLanguage: (id) => request(`/api/admin/languages/${id}`, { method: "DELETE" }),
  languagePackAdmin: (id) => request(`/api/admin/languages/${id}/pack`),
  saveLanguagePack: (id, values) => request(`/api/admin/languages/${id}/pack`, { method: "PUT", body: { values } }),
  adminPromos: () => request("/api/admin/promos"),
  createPromo: (body) => request("/api/admin/promos", { method: "POST", body }),
  updatePromo: (id, body) => request(`/api/admin/promos/${id}`, { method: "PATCH", body }),
  deletePromo: (id) => request(`/api/admin/promos/${id}`, { method: "DELETE" }),

  // system email
  emailSettings: () => request("/api/admin/email/settings"),
  saveEmailSettings: (body) => request("/api/admin/email/settings", { method: "PUT", body }),
  emailTemplates: () => request("/api/admin/email/templates"),
  emailTemplate: (key) => request(`/api/admin/email/templates/${key}`),
  saveEmailTemplate: (key, body) => request(`/api/admin/email/templates/${key}`, { method: "PUT", body }),
  resetEmailTemplate: (key) => request(`/api/admin/email/templates/${key}/reset`, { method: "POST" }),
  sendTestEmail: (body) => request("/api/admin/email/test", { method: "POST", body }),
  emailLog: () => request("/api/admin/email/log"),

  // payments
  paymentMethods: () => request("/api/payments/methods"),
  startPayment: (number) => request(`/api/payments/${number}/initiate`, { method: "POST" }),
  confirmPayment: (number, body) =>
    request(`/api/payments/${number}/confirm`, { method: "POST", body }),
  adminGateways: () => request("/api/admin/payment-gateways"),
  saveGateway: (provider, body) =>
    request(`/api/admin/payment-gateways/${provider}`, { method: "PUT", body }),
  clearGatewayKeys: (provider) =>
    request(`/api/admin/payment-gateways/${provider}/secrets`, { method: "DELETE" }),
  orderPayments: (orderId) => request(`/api/admin/orders/${orderId}/payments`),

  // API credentials
  adminApiKeys: () => request("/api/admin/api-keys"),
  createApiKey: (body) => request("/api/admin/api-keys", { method: "POST", body }),
  revokeApiKey: (id) => request(`/api/admin/api-keys/${id}/revoke`, { method: "POST" }),
  deleteApiKey: (id) => request(`/api/admin/api-keys/${id}`, { method: "DELETE" }),

  adminSettings: () => request("/api/admin/settings"),
  saveSettings: (values) => request("/api/admin/settings", { method: "PUT", body: { values } }),
  upload: (file) => {
    const form = new FormData();
    form.append("file", file);
    return request("/api/admin/uploads", { method: "POST", body: form, isForm: true });
  },
};

/* ------------------------------------------------------------- helpers */

const Site = {
  values: {},
  get(key, fallback = "") { return this.values[key] ?? fallback; },
  num(key, fallback = 0) {
    const n = parseFloat(this.values[key]);
    return Number.isFinite(n) ? n : fallback;
  },
  bool(key) { return String(this.values[key]).toLowerCase() === "true"; },
};

/** Paints settings colors onto the CSS variables the stylesheet reads. */
/* The shop and the dashboard are styled independently. Dashboard keys are the
   same names with an `admin_` prefix; if one is blank the shop's value is used,
   so an upgraded shop still looks like itself until you change something. */
function styleScope() {
  return window.STYLE_SCOPE === "admin" ? "admin" : "store";
}

function applyTheme(values, scope) {
  scope = scope || styleScope();
  const prefix = scope === "admin" ? "admin_" : "";
  const pick = (key) => values[prefix + key] || values[key];

  const root = document.documentElement.style;
  const ink = pick("color_ink");
  const accent = pick("color_accent");
  const paper = pick("color_paper");
  const radius = pick("corner_radius");

  if (ink) root.setProperty("--ink", ink);
  if (accent) {
    root.setProperty("--accent", accent);
    root.setProperty("--accent-ink", readableOn(accent));
  }
  if (paper) root.setProperty("--paper", paper);
  if (radius) root.setProperty("--radius", `${radius}px`);

  applyFonts(values, scope);
  if (scope === "store") document.title = `${values.site_name || "Shop"}`;
}

/* ---------------------------------------------------------------- fonts
   Storefront and dashboard keep separate font settings, so the shop can be
   characterful while the panel you stare at all day stays plain. Both are set
   in Admin → Storefront → Type.

   Fonts load from Google Fonts on demand. A name that is not on Google simply
   falls through to the stack below it, so a typo degrades to a system font
   rather than breaking the page. */

/* The weight string each family actually publishes on Google Fonts.
   This is not decoration: ask a font for a weight it does not have and Google
   rejects the request with a 400, and the font silently never loads. Lato and
   Ubuntu are the ones that catch people out — neither has a 600. */
const FONT_SPECS = {
  "Roboto": "wght@400;500;700;900",
  "Inter": "wght@400;500;600;700;800",
  "Poppins": "wght@400;500;600;700;800",
  "Montserrat": "wght@400;500;600;700;800",
  "Open Sans": "wght@400;500;600;700;800",
  "Lato": "wght@400;700;900",            // no 500 or 600 exists
  "Nunito": "wght@400;500;600;700;800",
  "Raleway": "wght@400;500;600;700;800",
  "Work Sans": "wght@400;500;600;700;800",
  "Source Sans 3": "wght@400;500;600;700;800",
  "Ubuntu": "wght@400;500;700",          // no 600 or 800 exists
  // Still supported so shops that already chose them keep working.
  "Bricolage Grotesque": "opsz,wght@12..96,400;12..96,600;12..96,800",
  "Karla": "wght@400;500;700",
  "JetBrains Mono": "wght@400;600;700",
  "Noto Sans Devanagari": "wght@400;500;600;700",
  "Noto Sans Telugu": "wght@400;500;600;700",
  "Noto Sans Arabic": "wght@400;500;600;700",
};

/* Google renamed Source Sans Pro to Source Sans 3 and retired the old name —
   asking for "Source Sans Pro" returns nothing. The label keeps the name
   people know; the request uses the one that works. */
const FONT_ALIASES = { "Source Sans Pro": "Source Sans 3" };

/* Already on the machine. Requesting these from Google would 404. */
const SYSTEM_FONTS = new Set(["Arial", "Helvetica", "Georgia", "Times New Roman", "Verdana"]);

/* What the dropdowns offer. Anything in FONT_SPECS still works if it is
   already saved, or if you type it in. */
const FONT_CHOICES = [
  "Roboto", "Arial", "Inter", "Poppins", "Montserrat", "Open Sans",
  "Lato", "Nunito", "Raleway", "Work Sans", "Source Sans Pro", "Ubuntu",
];

const SYSTEM_FALLBACK = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** One <link> per family. Kept separate on purpose: if one name is wrong,
 *  only that font fails instead of taking the others down with it. */
function loadGoogleFonts(names) {
  [...new Set(names.filter(Boolean))].forEach((chosen) => {
    if (SYSTEM_FONTS.has(chosen)) return;           // already on the machine
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

/** The CSS font-family value for a chosen name, aliases resolved. */
function fontStack(name) {
  const real = FONT_ALIASES[name] || name || "";
  return `"${real}", ${SYSTEM_FALLBACK}`;
}

/** scope is "store" or "admin" — they read different settings keys. */
function applyFonts(values, scope = "store") {
  const display = values[`font_${scope}_display`] || "Montserrat";
  const body = values[`font_${scope}_body`] || "Open Sans";
  loadGoogleFonts([display, body]);
  const root = document.documentElement.style;
  root.setProperty("--display", fontStack(display));
  root.setProperty("--body", fontStack(body));
}

/* --------------------------------------------------------------- i18n
   Every visible string goes through t("some.key"). The pack from the server
   already has English laid underneath, so a key can never come back blank. */

const LANG_KEY = "shopkit_lang";

const I18n = {
  code: "en",
  direction: "ltr",
  languages: [],
  strings: {},

  get chosen() { return localStorage.getItem(LANG_KEY) || ""; },
  set chosen(code) {
    if (code) localStorage.setItem(LANG_KEY, code);
    else localStorage.removeItem(LANG_KEY);
  },

  /** Picks the shopper's language: their saved choice, else the shop default,
   *  else whatever is enabled. Falls back safely if a saved code was removed. */
  async load(defaultCode = "en") {
    try { this.languages = await API.languages(); } catch { this.languages = []; }
    const codes = this.languages.map((l) => l.code);
    let code = this.chosen && codes.includes(this.chosen) ? this.chosen : "";
    if (!code) code = codes.includes(defaultCode) ? defaultCode : (codes[0] || "en");

    this.code = code;
    const language = this.languages.find((l) => l.code === code);
    this.direction = language ? language.direction : "ltr";
    try { this.strings = await API.languagePack(code); } catch { this.strings = {}; }

    document.documentElement.lang = code;
    document.documentElement.dir = this.direction;
  },

  async switchTo(code) {
    this.chosen = code;
    await this.load(code);
  },
};

/** Translate. The second argument is what to show if the key is unknown —
 *  useful while adding a string before it exists in the catalogue. */
function t(key, fallback) {
  return I18n.strings[key] ?? fallback ?? key;
}

/** Black or white text, whichever is legible on the given background. */
function readableOn(hex) {
  const clean = (hex || "").replace("#", "");
  if (clean.length !== 6) return "#14231C";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.55 ? "#14231C" : "#FFFFFF";
}

function money(value) {
  const symbol = Site.get("currency_symbol", "₹");
  const n = Number(value || 0);
  return symbol + n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function esc(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function formatDate(value) {
  return new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Products without a photo get a typographic tile instead of a broken image. */
function imageTile(url, name, className = "thumb") {
  if (url) return `<div class="${className}"><img src="${esc(url)}" alt="${esc(name)}" loading="lazy"></div>`;
  const initials = String(name || "?").split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase();
  const hue = [...String(name || "")].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  return `<div class="${className}"><div class="thumb-mono" style="background-color:hsl(${hue} 32% 92%);font-size:1.6rem">${esc(initials)}</div></div>`;
}

function toast(message, kind = "ok") {
  let stack = document.querySelector(".toast-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.className = "toast-stack";
    document.body.appendChild(stack);
  }
  const node = document.createElement("div");
  node.className = `toast ${kind === "bad" ? "toast-bad" : ""}`;
  node.textContent = message;
  node.setAttribute("role", "status");
  stack.appendChild(node);
  setTimeout(() => node.remove(), 3600);
}

/** Minimal modal. `html` is the inner content; returns the element. */
function openModal(html, { wide = false } = {}) {
  closeModal();
  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `<div class="modal ${wide ? "modal-wide" : ""}" role="dialog" aria-modal="true">${html}</div>`;
  backdrop.addEventListener("mousedown", (e) => { if (e.target === backdrop) closeModal(); });
  // Any element marked data-close dismisses the modal, so a Cancel button is
  // just markup and needs no handler of its own.
  backdrop.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) { e.preventDefault(); closeModal(); }
  });
  document.body.appendChild(backdrop);
  document.addEventListener("keydown", escToClose);
  const focusable = backdrop.querySelector("input, select, textarea, button");
  if (focusable) focusable.focus();
  return backdrop;
}
function closeModal() {
  document.querySelectorAll(".modal-backdrop").forEach((n) => n.remove());
  document.removeEventListener("keydown", escToClose);
}
function escToClose(event) { if (event.key === "Escape") closeModal(); }

function statusBadge(status) {
  return `<span class="badge badge-${esc(status)}">${esc(status)}</span>`;
}
