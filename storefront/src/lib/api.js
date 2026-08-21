/* =========================================================================
   Talking to the API.

   Same origin in production — FastAPI serves this app. In development Vite
   proxies /api to the Python server, so there is nothing to configure and no
   CORS to think about. Set VITE_API_BASE only if you host the two separately.
   ========================================================================= */

export const API_BASE = import.meta.env.VITE_API_BASE ?? "";

/** Turn a stored image path into something this page can actually load.

    Uploaded photos are stored as `/media/abc.jpg` — relative to the API. That
    is fine when FastAPI serves the shop too, and wrong the moment the shop
    lives somewhere else (Vercel, Netlify, a CDN), where it would resolve
    against the wrong host and 404. Absolute URLs are left alone, so a photo
    hosted on Cloudinary or S3 still works. */
export function mediaUrl(url) {
  if (!url) return "";
  if (/^(https?:)?\/\//.test(url) || url.startsWith("data:")) return url;
  return API_BASE + url;
}

/* The shop and the dashboard keep separate sessions under separate keys.
   Signing in as the owner does not sign you in as a customer, and a shared
   computer never leaks the dashboard to whoever shops next. */
const TOKEN_KEY = "shopkit_token";

export const Auth = {
  get token() {
    return localStorage.getItem(TOKEN_KEY) || "";
  },
  set token(value) {
    if (value) localStorage.setItem(TOKEN_KEY, value);
    else localStorage.removeItem(TOKEN_KEY);
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
  },
};

/** Thrown for any non-2xx. `.message` is always safe to show a person. */
export class ApiError extends Error {
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
    const field = (first.loc || []).filter((part) => part !== "body").join(".");
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
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") params.append(key, value);
    });
    const qs = params.toString();
    if (qs) url += `?${qs}`;
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
    throw new ApiError(0, "Cannot reach the shop. Check your connection.");
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

/** Every endpoint the shop uses, in one place. */
export const API = {
  // auth
  register: (body) => request("/api/auth/register", { method: "POST", body }),
  login: (body) => request("/api/auth/login", { method: "POST", body }),
  me: () => request("/api/auth/me"),
  updateProfile: (body) => request("/api/auth/me", { method: "PATCH", body }),
  changePassword: (body) => request("/api/auth/change-password", { method: "POST", body }),

  // shop
  settings: () => request("/api/settings"),
  categories: () => request("/api/categories"),
  products: (query) => request("/api/products", { query }),
  product: (slug) => request(`/api/products/${slug}`),
  previewCart: (items, promoCode = "") =>
    request("/api/cart/preview", { method: "POST", body: { items, promo_code: promoCode } }),

  // orders
  placeOrder: (body) => request("/api/orders", { method: "POST", body }),
  myOrders: (query) => request("/api/orders", { query }),
  myOrder: (number) => request(`/api/orders/${number}`),

  // languages and promos
  languages: () => request("/api/languages"),
  languagePack: (code) => request(`/api/i18n/${code}`),
  checkPromo: (code, subtotal) =>
    request("/api/promo/check", { method: "POST", body: { code, subtotal } }),

  // payments
  paymentMethods: () => request("/api/payments/methods"),
};
