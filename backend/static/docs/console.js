/* =========================================================================
   The API reference.

   The problem this solves: Swagger's Authorize dialog is the only way in by
   default, and it is easy to miss. Sign in somewhere else, or press Close
   instead of Authorize, and every call comes back 401 with no clue why — the
   generated curl simply has no Authorization header.

   So authentication does not depend on Swagger's dialog at all. A sign-in bar
   sits above the page, and a request interceptor attaches the header to every
   call. The Authorize button still works; it is just no longer the only way.

   Two credentials are in play, and they are not interchangeable:
     · a login token  — Auth, Orders and everything under Admin
     · an API key     — everything under Integration
   Both are attached automatically to the endpoints that want them.
   ========================================================================= */

(function () {
  const CONFIG = window.__DOCS__ || {};
  const TOKEN_KEY = "shopkit_docs_token";
  const USER_KEY = "shopkit_docs_user";

  /* sessionStorage, not localStorage: a reference page left open on a shared
     machine should not keep an admin token after the tab closes. */
  let token = sessionStorage.getItem(TOKEN_KEY) || "";
  let user = JSON.parse(sessionStorage.getItem(USER_KEY) || "null");

  const bar = document.getElementById("console-bar");

  function render(message, isError) {
    const note = message
      ? `<p class="console-note ${isError ? "bad" : ""}">${message}</p>`
      : `<p class="console-note">Signing in here fills in the header for every
           endpoint below — including <code>/api/admin/*</code>. The
           <b>Integration</b> endpoints use an API key instead, and already have
           one from the credential you opened this page with.</p>`;

    bar.innerHTML = `
      <div class="console-inner">
        <div class="console-brand">
          <span class="console-mark">${(CONFIG.siteName || "S").slice(0, 2).toUpperCase()}</span>
          <div>
            <div class="console-title">${CONFIG.siteName || "Shop"}</div>
            <div class="console-sub">API reference</div>
          </div>
        </div>

        ${user
          ? `<div class="console-who">
               <span class="console-chip">
                 <span class="console-dot"></span>
                 <b>${user.email}</b>
                 <span class="console-role">${user.role}</span>
               </span>
               <button class="console-btn ghost" id="console-out">Sign out</button>
             </div>`
          : `<form class="console-auth" id="console-form">
               <input type="email" id="console-email" placeholder="Email" autocomplete="username">
               <input type="password" id="console-password" placeholder="Password" autocomplete="current-password">
               <button class="console-btn" type="submit">Sign in</button>
             </form>`}

        ${note}
      </div>`;

    const form = document.getElementById("console-form");
    if (form) form.addEventListener("submit", signIn);

    const out = document.getElementById("console-out");
    if (out) out.addEventListener("click", signOut);
  }

  async function signIn(event) {
    event.preventDefault();
    const email = document.getElementById("console-email").value.trim();
    const password = document.getElementById("console-password").value;
    if (!email || !password) return render("Enter an email and a password.", true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await response.json();
      if (!response.ok) {
        return render(typeof data.detail === "string" ? data.detail : "That did not work.", true);
      }
      adopt(data);
      render(`Signed in. Every endpoint below now sends your token —
              open one and press <b>Try it out</b>.`);
    } catch {
      render("Could not reach the server.", true);
    }
  }

  /** Called both by the sign-in bar and by the response interceptor, so
   *  logging in through the endpoint itself signs you in on the bar too. */
  function adopt(data) {
    token = data.access_token;
    user = data.user;
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(USER_KEY, JSON.stringify(user));
    try {
      window.ui.preauthorizeApiKey("Login token", token);
    } catch {
      /* The interceptor attaches the header anyway; this only keeps Swagger's
         own padlocks looking right. */
    }
  }

  function signOut() {
    token = "";
    user = null;
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    render("Signed out. Admin endpoints will return 401 until you sign in again.");
  }

  render();

  window.ui = SwaggerUIBundle({
    url: CONFIG.openapiUrl || "/openapi.json",
    dom_id: "#swagger-ui",
    deepLinking: true,
    persistAuthorization: true,
    displayRequestDuration: true,
    docExpansion: "none",
    filter: true,
    tryItOutEnabled: true,
    defaultModelsExpandDepth: -1,
    presets: [SwaggerUIBundle.presets.apis],

    /* This is what makes the page reliable. Whatever you did or did not do in
       the Authorize dialog, the right credential goes out with the request. */
    requestInterceptor(request) {
      const url = request.url || "";
      if (!url.includes("/api/")) return request;
      request.headers = request.headers || {};

      const isIntegration = url.includes("/api/integration/");
      if (isIntegration && CONFIG.credential && !request.headers["X-API-Key"]) {
        request.headers["X-API-Key"] = CONFIG.credential;
      }
      if (!isIntegration && token && !request.headers.Authorization) {
        request.headers.Authorization = `Bearer ${token}`;
      }
      return request;
    },

    /* Signing in through POST /api/auth/login on the page itself counts as
       signing in on the bar. */
    responseInterceptor(response) {
      try {
        const url = response.url || "";
        const signedIn = url.endsWith("/api/auth/login") || url.endsWith("/api/auth/register");
        if (response.status === 200 && signedIn) {
          const body = response.body || JSON.parse(response.text || "{}");
          if (body && body.access_token) {
            adopt(body);
            render(`Signed in as <b>${body.user.email}</b>. Every endpoint below
                    now sends your token.`);
          }
        }
      } catch {
        /* Never let this break the response view. */
      }
      return response;
    },

    onComplete() {
      if (CONFIG.credential) {
        try { window.ui.preauthorizeApiKey("API key", CONFIG.credential); } catch { /* padlocks only */ }
      }
      if (token) {
        try { window.ui.preauthorizeApiKey("Login token", token); } catch { /* padlocks only */ }
      }
    },
  });
})();
