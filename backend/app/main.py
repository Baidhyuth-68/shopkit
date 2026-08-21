"""Application entrypoint.

Run from the backend/ folder:
    uvicorn app.main:app --reload

Serves three things on one port:
    /            the storefront
    /admin       the admin panel
    /api/...     the JSON API (interactive docs at /docs)
"""
from contextlib import asynccontextmanager

import json

from fastapi import Depends, FastAPI, HTTPException, Request, Security, status
from fastapi.responses import HTMLResponse
from fastapi.security import HTTPBasic, HTTPBasicCredentials
from sqlalchemy.orm import Session
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_redoc_html, get_swagger_ui_html
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import migrate, seed
from .config import FRONTEND_DIR, MEDIA_DIR, STATIC_DIR, STORE_DIR, settings
from .database import Base, engine
from .database import get_db
from . import site_settings
from .deps import _lookup_api_key
from .routers import admin, auth, catalog, integration, orders, payments, public_extras

# The browser's own sign-in box guards the reference. Not added to the OpenAPI
# schema — it protects the documentation, not the API.
docs_scheme = HTTPBasic(auto_error=False, scheme_name="Docs access")

# The app is created with openapi_url=None so FastAPI does not publish an
# unprotected schema route. It is served by a gated route further down, at
# this path.
OPENAPI_PATH = "/openapi.json"

API_DESCRIPTION = """
The full API behind the storefront and the admin panel.

**To try anything below, sign in on the bar at the top of this page.** That
fills in the right header for every endpoint — there is nothing to copy and
nothing to paste.

| Section | Needs | Where it comes from |
|---|---|---|
| Auth, Orders, **Admin** | a login token | the sign-in bar above, or `POST /api/auth/login` |
| **Integration** | an API key | already applied, from the credential you opened this page with |
| Storefront, Meta | nothing | public |

An **API key can never reach `/api/admin/*`**, whatever scopes it has. A leaked
key cannot read your customers or your payment credentials.

Swagger's own **Authorize** button still works if you prefer it, but you should
not need it.
"""


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("→ Preparing database…")
    # Race-safe: several workers boot at once and all try this.
    migrate.prepare_database(engine, Base)
    migrate.run(engine)     # adds columns new features need to an existing database
    seed.run()
    print(f"→ Storefront  http://127.0.0.1:8000/")
    print(f"→ Admin       http://127.0.0.1:8000/admin")
    print(f"→ API docs    http://127.0.0.1:8000/docs")
    yield


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.API_VERSION,
    description=API_DESCRIPTION,
    lifespan=lifespan,
    # The built-in /docs and /redoc pages pull Swagger UI from a public CDN.
    # That fails on a locked-down network, offline, or if the CDN is slow —
    # and it fails *quietly*: the page renders but Authorize does nothing.
    # Both are served from files in backend/static/docs instead, below.
    docs_url=None,
    redoc_url=None,
    openapi_url=None,   # served by the gated route below instead
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(catalog.router)
app.include_router(orders.router)
app.include_router(admin.router)
app.include_router(payments.router)
app.include_router(integration.router)
app.include_router(public_extras.router)


# --------------------------------------------------------------------------
# The API reference.
#
# Two things are different from FastAPI's built-in /docs:
#
#  1. Swagger UI is served from backend/static/docs rather than a public CDN.
#     A blocked CDN leaves the built-in page looking fine while Authorize
#     silently does nothing, which reads as "my credential is wrong".
#
#  2. The page asks for an API credential before it opens. The browser shows
#     its own sign-in box: Client ID is the key id, Client secret is the
#     secret. Once past it, Swagger is handed the same credential, so Try it
#     out works immediately — you enter it once, not twice.
#
#     Set DOCS_PUBLIC=true in .env to drop the gate. The endpoints themselves
#     are protected either way; this only decides who may read the reference.
# --------------------------------------------------------------------------
def docs_credential(
    request: Request,
    basic: HTTPBasicCredentials | None = Security(docs_scheme),
    db: Session = Depends(get_db),
) -> str:
    """Returns the credential to hand Swagger, or "" when the gate is off."""
    if settings.DOCS_PUBLIC:
        return ""

    unauthorised = HTTPException(
        status.HTTP_401_UNAUTHORIZED,
        "This API reference is private. Sign in with an API credential — "
        "Client ID is the key id, Client secret is the secret. "
        "Create one in the dashboard under API keys.",
        headers={"WWW-Authenticate": 'Basic realm="API reference"'},
    )
    if not basic:
        raise unauthorised

    username = (basic.username or "").strip()
    password = (basic.password or "").strip()
    presented = f"{username}.{password}" if password and "." not in username else username

    record, problem = _lookup_api_key(db, presented)
    if not record:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, problem,
            headers={"WWW-Authenticate": 'Basic realm="API reference"'},
        )
    return presented


@app.get("/docs", include_in_schema=False)
def api_docs(credential: str = Depends(docs_credential), db: Session = Depends(get_db)):
    """The API reference.

    The page is a thin shell: everything it needs is handed over in one JSON
    blob, and the behaviour lives in static/docs/console.js. Keeping the logic
    out of a Python f-string is the difference between readable JavaScript and
    a wall of doubled braces.
    """
    shop = site_settings.get_all(db)
    config = {
        "openapiUrl": OPENAPI_PATH,
        "siteName": shop.get("site_name", settings.APP_NAME),
        # Only ever sent back to a browser that already proved it holds it.
        "credential": credential,
    }
    return HTMLResponse(f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>{shop.get("site_name", settings.APP_NAME)} — API reference</title>
  <link rel="icon" href="/static/docs/favicon-32x32.png" sizes="32x32">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/static/docs/swagger-ui.css">
  <link rel="stylesheet" href="/static/docs/console.css">
</head>
<body>
  <header class="console-bar" id="console-bar"></header>
  <div id="swagger-ui"></div>
  <script>window.__DOCS__ = {json.dumps(config)};</script>
  <script src="/static/docs/swagger-ui-bundle.js"></script>
  <script src="/static/docs/console.js"></script>
</body>
</html>""")


@app.get("/redoc", include_in_schema=False)
def api_redoc(credential: str = Depends(docs_credential)):
    """A reading-style reference. No Try it out, so nothing to authorise."""
    return get_redoc_html(
        openapi_url=OPENAPI_PATH,
        title=f"{settings.APP_NAME} — reference",
        redoc_js_url="https://cdn.jsdelivr.net/npm/redoc@2/bundles/redoc.standalone.js",
    )


@app.get(OPENAPI_PATH, include_in_schema=False)
def api_schema(credential: str = Depends(docs_credential)):
    """Behind the same gate as the page that reads it."""
    return app.openapi()


@app.get("/api/health", tags=["Meta"])
def health():
    """Cheap check for uptime monitors and deploy pipelines."""
    return {"status": "ok", "version": settings.API_VERSION}


# --- static files -----------------------------------------------------
app.mount("/media", StaticFiles(directory=MEDIA_DIR), name="media")
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# The storefront is a React app built by Vite into frontend/store. Its hashed
# JS and CSS live under /store; the page itself is served at / below.
if (STORE_DIR / "assets").exists():
    app.mount("/store", StaticFiles(directory=STORE_DIR), name="store")

# The admin panel is still plain HTML and JS and needs no build step.
if (FRONTEND_DIR / "assets").exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIR / "assets"), name="assets")


@app.get("/", include_in_schema=False)
def storefront():
    """The React storefront. Run `npm run build` in storefront/ after changing
    it; the built output is committed so deploying stays a Python-only job."""
    built = STORE_DIR / "index.html"
    if built.exists():
        return FileResponse(built)
    return HTMLResponse(
        "<h1>The storefront has not been built yet</h1>"
        "<p>Run <code>npm install &amp;&amp; npm run build</code> inside the "
        "<code>storefront</code> folder, then reload.</p>",
        status_code=503,
    )


@app.get("/admin", include_in_schema=False)
def admin_panel():
    return FileResponse(FRONTEND_DIR / "admin.html")


@app.exception_handler(404)
async def not_found(request, exc):
    """API misses stay JSON; anything else falls back to the storefront so
    hash routes and refreshes never dead-end."""
    if request.url.path.startswith(("/api", "/media", "/static", "/store", "/assets")):
        return JSONResponse({"detail": "Not found."}, status_code=404)
    built = STORE_DIR / "index.html"
    if built.exists():
        return FileResponse(built, status_code=200)
    return JSONResponse({"detail": "Not found."}, status_code=404)
