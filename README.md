# ShopKit

A small online shop you own end to end: a Python API, a database, a customer
storefront and an admin panel where you run the whole thing without touching
code.

One command brings all three parts up on the same port. The storefront is a
built React app that ships with the repo, so running it needs Python only.

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload
```

Changing the storefront needs Node as well — see
[Working on the storefront](#working-on-the-storefront).

| | |
|---|---|
| Storefront | http://127.0.0.1:8000/ |
| Admin panel | http://127.0.0.1:8000/admin |
| API docs | http://127.0.0.1:8000/docs |

Sign in to the admin panel with the `ADMIN_EMAIL` and `ADMIN_PASSWORD` in your
`.env`. Change both before you put this anywhere public.

> Upgrading an existing copy? Re-run `pip install -r requirements.txt` — the
> payments feature adds `cryptography` and `httpx`. Your database updates
> itself: new tables are created on the next boot, and the two columns promo
> codes need are added to your existing `orders` table by
> `backend/app/migrate.py`. Nothing is dropped or rewritten.

---

## What is in it

**Storefront** — React, built with Vite. Home page, searchable and filterable
shop, product pages with a photo gallery, cart with promo codes, checkout as a
guest or signed in, and an account area with profile details, password change
and order history.

**Two separate sessions.** The shop and the dashboard sign in independently and
store their tokens under different keys. Signing in as the owner does not sign
you in as a customer, so you can run the dashboard in one tab and browse the
shop as a shopper in another — and a shared computer never leaks the dashboard
to whoever shops next.

**Admin panel** — a dashboard with revenue, best sellers and low-stock
warnings; products with photo upload, each on its own full page; collections;
orders with status changes that put stock back when you cancel or accept a
return; **promo codes**; **system email** with editable templates; customers
and staff; a
Storefront page that controls the shop's name, colours, **fonts**, copy,
currency, delivery charges and tax without a deploy; **language packs**; a
**Payments** page for your Stripe and Razorpay keys; and an **API keys** page
for letting other systems in.

**API** — 52 JSON endpoints with interactive docs generated from the code, and
three ways to authenticate: a login token for people, an API key for machines,
or nothing at all for the public catalogue.

---

## How it is put together

```
Browser                       FastAPI                 Database
─────────                     ─────────               ──────────
/          React shop  ─fetch─▶  /api/products   ──▶  SQLite (dev)
/admin     admin panel ─fetch─▶  /api/admin/*         Postgres (live)
                                 /api/auth/*
```

One server process serves the API and both HTML pages, so there is nothing to
deploy separately and no CORS to configure.

- **Backend** — FastAPI, SQLAlchemy 2, PyJWT. Python 3.10+.
- **Database** — SQLite by default. Point `DATABASE_URL` at a hosted Postgres
  and nothing else changes.
- **Storefront** — React 18 with React Router, built by Vite into
  `frontend/store`. Three runtime dependencies, no state library — there is not
  enough shared state here to earn one.
- **Admin panel** — plain HTML, CSS and JavaScript. No bundler, no build step.
  Edit a file, reload the page. It is a dense internal tool that one person
  uses; a framework would have added a build without adding much else.
- **One stylesheet** — `frontend/assets/css/app.css` is shared. The React app
  imports it and the admin panel links to it, so there is one place to change
  how anything looks.

### Two decisions worth knowing about

**The cart lives in the browser, the prices do not.** Adding to a cart works
without an account. But `POST /api/cart/preview` re-reads every price from the
database and applies the shipping rules server-side, and checkout does it
again before the order is written. Nothing the browser sends about money is
trusted.

**Orders are snapshots.** Product names and prices are copied into the order
when it is placed, so editing or deleting a product never rewrites history.

---

## Working on the storefront

The shop lives in `storefront/` — React, built by Vite. You need Node 18+.

```bash
cd storefront
npm install
npm run dev            # http://localhost:5173, hot reload
```

Keep the Python server running on port 8000 at the same time. Vite proxies
`/api` and `/media` to it, so the browser sees one origin and there is no CORS
to configure.

When you are done:

```bash
npm run build          # writes frontend/store/
```

**Commit `frontend/store/`.** It is built output, and normally that would not
belong in a repo — but committing it means deploying stays a Python-only job,
and Render's free Python runtime has no Node. The `Dockerfile` rebuilds it
anyway, so a container image can never ship stale assets.

| Path | What |
|---|---|
| `storefront/src/pages/` | one file per page |
| `storefront/src/components/` | layout, receipt, promo box, product tile |
| `storefront/src/lib/api.js` | every endpoint the shop calls |
| `storefront/src/lib/shop.jsx` | settings, language, cart, promo, session |
| `storefront/src/lib/theme.js` | colours and Google Fonts loading |
| `frontend/assets/css/app.css` | the stylesheet, shared with the admin panel |

Routing is hash-based (`#/shop`, `#/p/thing`) so no server rewrite rule is
needed and links you have already shared still work.

The **admin panel is not React** and needs no build — `frontend/admin.html`
plus `frontend/assets/js/admin.js`. Edit and reload.

---

## Languages

Turn a language on in **Admin → Languages** and a picker appears in the shop
header. Pick one and the whole interface re-reads in that language — the choice
is remembered on that device.

English, Hindi, Telugu, Spanish, French and Arabic are listed out of the box;
only English is switched on. Hindi and Telugu come with a **starter pack** of
the most common shop words — a head start for a translator, not a finished job.
Read them before you switch those languages on.

Everything a translator has not filled in **falls back to English**, so a
half-finished pack never shows a customer a blank label. That also means you
can switch a language on the day you start translating it.

The editor lists every string grouped by where it appears, with the English
original above each box. Arabic is set up right-to-left, and the layout flips
with it — prices stay left-to-right so they never read backwards.

**What this translates:** the shop's interface — navigation, buttons, cart,
checkout, account. **What it does not:** product names and descriptions, which
live in the products table in whatever language you typed them.
`docs/CODE_MAP.md` sketches what translated product copy would take.

---

## Promo codes

Create one in **Admin → Promo codes** and customers type it in at the cart or
checkout.

| Kind | Does |
|---|---|
| Percentage off | with an optional cap, so "20% off" cannot cost you ₹4,000 on one order |
| Fixed amount off | never takes an order below zero |
| Free delivery | drops the shipping charge |

Each code can require a minimum order, run between two dates, be limited to a
number of uses in total, and be limited per customer — counted by account, or
by email for guests.

Two details worth knowing. **Clicking Apply does not consume a code**; it is
only counted when an order is actually placed, so window shoppers cannot
exhaust a "first 100 customers" promotion. And **the discount comes off before
delivery and tax are worked out**, so a code can tip an order over your
free-delivery threshold, or drop it back under.

The maths always runs on the server. The browser only ever sends the word that
was typed; it is never trusted about what that word is worth. It is re-checked
one last time at checkout, against the real subtotal.

A switched-off example code, `WELCOME10`, ships with the shop so the page
explains itself.

---

## Style

### The look

Deep navy ink, a single copper accent, generous white space and hairline rules.
The intent is *official*: a shop that reads as a real business and a back
office that reads as an instrument, rather than a craft stall.

Three details do most of the work:

- **One accent, spent in one way.** Copper appears as a 2px hairline above
  every eyebrow, under the current nav item, and across the top of a stat card
  — and on primary buttons. Nowhere else. Restraint is what makes it read as
  considered rather than decorated.
- **Tabular figures everywhere money appears.** Prices, totals and dashboard
  numbers line up in columns. It is most of why a price list reads as a price
  list rather than as prose.
- **The receipt survived.** The cart and order summary are still a paper
  receipt with dashed rules and a torn bottom edge. It was the one memorable
  thing in the old design and it suits a shop that wants to look exact.

All of it is driven by the same four tokens you can change below, so recolouring
a shop never means touching CSS.

### Where to change it

The shop and the dashboard are styled **separately**, on two pages:

| Page | Controls |
|---|---|
| **Admin → Storefront** | shop colours, shop fonts, plus the shop's name, copy and selling rules |
| **Admin → Dashboard style** | the panel's own colours and fonts, and nothing a customer sees |

Nothing crosses over. Change the shop's accent to pink and the dashboard stays
as it was. There is a **Match the shop** button on the Dashboard style page if
you do want them the same.

Dashboard changes apply the moment you save. **Shop changes need the shop tab
reloaded** — the storefront reads its settings once when the page loads.

### Fonts

Twelve to choose from, on both sides:

Roboto · Arial · Inter · Poppins · Montserrat · Open Sans · Lato · Nunito ·
Raleway · Work Sans · Source Sans Pro · Ubuntu

Defaults: **Montserrat over Open Sans** for the shop — Montserrat has presence
in a heading and Open Sans is unfussy underneath it. **Inter** for the
dashboard, because it was drawn for dense screen interfaces and holds up in a
table of numbers at 13px.

Three details that make this work reliably:

- **Each family is requested from Google separately**, with the exact weight
  string that family actually publishes. Ask a font for a weight it does not
  have and Google rejects the request — and if several families share one
  request, one bad name takes them all down. Lato has no 600; Ubuntu has no 600
  or 800. Those are the ones that usually break silently.
- **Arial is never requested** — it is already on the machine.
- **Source Sans Pro** was retired by Google and renamed Source Sans 3. The menu
  keeps the name you know; the request quietly uses the one that works.

Adding your own font: put its name and weight string in `FONT_SPECS` in
`frontend/assets/js/api.js`, then add the name to `FONT_CHOICES`.

---

## System email

**Admin → System email** holds your mail server and seven message templates:

| Message | Goes out when |
|---|---|
| Welcome | someone finishes signing up |
| Password reset | you issue a new password from Customers |
| Order received | checkout succeeds |
| Order shipped · delivered · return accepted · cancelled | you move an order to that stage |

Each template has a subject, a body, and an on/off switch. Placeholders like
`{{order_number}}` and `{{order_items}}` are click-to-insert, and the preview
beside the editor fills them in **from your most recent real order**, so what
you see is close to what a customer gets.

Nothing sends until you add a mail server and tick *Send email*, so you can
write all the wording first. **Send a test** goes out immediately and hands
back the real SMTP error if there is one, rather than failing quietly.

Two things worth knowing. **A broken mail server cannot break a checkout** —
order and account emails are sent after the response, and a failure becomes a
row in the send log rather than an error for the customer. And **status emails
only fire on an actual change**, so re-saving the same status does not send a
second copy.

Your SMTP password is encrypted before it is stored and never sent back to the
browser. It is deliberately kept out of site settings, which is a public
endpoint.

Orders now also have a **Returned** status, which puts the stock back the way
cancelling does and sends the return email.

---

## Taking payments

Everything is configured in **Admin → Payments** — no code, no redeploy. There
is a card for each provider:

| | Needs keys | Good for |
|---|---|---|
| Stripe | yes | cards, international |
| Razorpay | yes | UPI, cards, netbanking (India) |
| Bank transfer | no | you reconcile by hand |
| Cash on delivery | no | you collect on the doorstep |

Each card holds the keys, a test-mode switch, the note the customer reads at
checkout, and an on/off toggle. Stripe and Razorpay also show the **webhook
address to paste into their dashboard**, with a copy button.

Two things the page does to keep you out of trouble: switching a gateway on
without a secret key is refused rather than silently putting a broken method on
your checkout, and leaving a secret box empty keeps the key already saved, so
toggling a gateway off and on never means re-typing credentials.

**Secrets are encrypted** with a key derived from `SECRET_KEY` before they are
written to the database, and no endpoint returns one in the clear — the panel
only ever shows the last four characters. The storefront receives publishable
keys only.

**You can test the whole checkout before you have a merchant account.** With no
live keys saved, starting a payment returns a sandbox reference and the order
flows through exactly as it would in production.

Cash on delivery is switched on out of the box, so the shop can take orders the
moment it boots.

---

## Letting other systems in

**Admin → API keys** issues credentials for Postman, a script, or a partner
system. They are separate from user logins: no expiry, scoped, and revocable in
one click.

```
X-API-Key: sk_id_xxxxxxxx.sk_secret_yyyyyyyy
```

Pick from four scopes when you create one — `catalog:read`, `catalog:write`,
`orders:read`, `orders:write` — and give it the least it needs. The secret is
shown once, on the screen where you create it; only a hash is stored, so it
cannot be recovered later.

Keys reach `/api/integration/*` and nothing else. They **cannot** touch
`/api/admin/*`, so a leaked key still cannot read your customer list, change
your settings, or see your Stripe secret.

**The reference page has its own sign-in bar.** Enter your email and password
at the top of `/docs` and every endpoint works, Admin included — the page
attaches the right header to each request itself. Nothing to copy or paste.

**The API reference is private.** Opening <http://127.0.0.1:8000/docs> asks for
a credential — **Client ID** as the username, **Client secret** as the
password, both from Admin → API keys. The page is then handed that same
credential, so *Try it out* works immediately with no second step. Set
`DOCS_PUBLIC=true` in `.env` if you would rather anyone could read it.

Swagger UI is served from the repo rather than a CDN, so `/docs` works offline
and behind a firewall. That matters: with the CDN version a blocked script
leaves the page looking normal while Authorize silently does nothing, which
reads as a bad credential when it is not.

```bash
curl http://127.0.0.1:8000/api/integration/whoami \
  -H "X-API-Key: sk_id_xxxxxxxx.sk_secret_yyyyyyyy"
```

Products are addressed by SKU on these routes, so a warehouse system never
needs to know this shop's internal ids:

```bash
curl -X PATCH "http://127.0.0.1:8000/api/integration/products/MUG-01/stock?stock=42" \
  -H "X-API-Key: sk_id_xxxxxxxx.sk_secret_yyyyyyyy"
```

Import [`docs/shopkit.postman_collection.json`](docs/shopkit.postman_collection.json)
and it is all set up: sign in, create a credential, and the collection captures
the key into its variables so the Integration folder works immediately.

---

## Documentation

| | |
|---|---|
| [docs/SETUP.md](docs/SETUP.md) | Running locally and moving to an online database |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Getting it online free — Render plus Neon, domains, email, and what free actually costs you |
| [docs/API.md](docs/API.md) | Every endpoint with request and response examples |
| [docs/CODE_MAP.md](docs/CODE_MAP.md) | Where to change what — adding a product field, changing the pricing rules, adding a gateway or an API scope, sending emails, restyling the shop |
| [docs/shopkit.postman_collection.json](docs/shopkit.postman_collection.json) | Import into Postman: auth, payments, API keys and the integration routes, with variables wired up |

---

## Demo data

The first run seeds a small catalogue and some order history so the dashboard
is not blank. Set `SEED_DEMO_DATA=false` in `.env` and delete `backend/shop.db`
when you are ready to add your own products.

Demo accounts:

| Role | Email | Password |
|---|---|---|
| Admin | from your `.env` | from your `.env` |
| Customer | `asha@example.org` | `customer123` |

---

## Putting it online

It runs on free hosting with an online database: **Render** for the app,
**Neon** for Postgres, HTTPS included. About half an hour, nothing to pay.
The repo carries a `render.yaml` so Render can configure itself, and a
`Dockerfile` for anywhere else.

Two things to know before you rely on it. A free web service **sleeps after 15
minutes** and takes 30–60 seconds to wake, so the first visitor after a quiet
spell waits. And **uploaded photos do not survive a redeploy** on a free
instance, because there is no persistent disk — paste image links instead, or
point uploads at object storage.

Neither is a reason to avoid free hosting; both are reasons to know what you
are choosing. [docs/DEPLOY.md](docs/DEPLOY.md) has the full walkthrough, the
honest limits, and what to pay for first when free stops being enough.

---

## Before going live

The full list is in [SETUP.md](docs/SETUP.md), but the three that matter most:

1. Set a real `SECRET_KEY` — anyone who has it can forge an admin token, and it
   is also the key your saved gateway secrets are encrypted with. Set it
   **before** you enter any Stripe or Razorpay keys; changing it afterwards
   makes them unreadable and you will have to re-enter them.
2. Change the admin password. The one in `.env.example` is public.
3. Add your live gateway keys in Admin → Payments, turn test mode off, and
   register the webhook address shown on each card. Until a gateway has keys,
   payments run in sandbox mode and no money moves.
4. Serve over HTTPS. Stripe and Razorpay will not send webhooks to plain HTTP.
