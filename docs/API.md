# API reference

Base URL while developing: `http://127.0.0.1:8000`

Two docs pages are generated live by the server and are always in sync with the
code:

| Page | URL | Good for |
|---|---|---|
| Swagger UI | `/docs` | Trying calls in the browser, with an **Authorize** button |
| ReDoc | `/redoc` | Reading |
| Raw schema | `/openapi.json` | Importing into Postman, Insomnia or a client generator |

This file is the hand-written version: the same endpoints with examples and
notes on why things behave the way they do.

---

## Authentication

`POST /api/auth/login` returns a JWT. Send it on every protected call:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

Tokens expire after `ACCESS_TOKEN_EXPIRE_MINUTES` (default 24 hours). There is
no refresh token — an expired token returns `401` and the frontend sends the
person back to the sign-in screen.

Two roles:

| Role | Can reach |
|---|---|
| `customer` | Their own profile and their own orders |
| `admin` | Everything, including `/api/admin/*` |

Anything under `/api/admin` returns `401` without a token and `403` with a
customer's token.

---

## Errors

Every failure returns the same shape, and `detail` is written to be shown to a
person as-is:

```json
{ "detail": "Only 3 of “Waxed canvas tote” left. Update the quantity and try again." }
```

Validation failures (`422`) return a list instead, one entry per bad field —
the frontend's `readError()` in `assets/js/api.js` flattens it to one line.

| Code | Means |
|---|---|
| 400 | The request was understood but not allowed (e.g. removing the last admin) |
| 401 | No token, or the token expired |
| 403 | Signed in, but not permitted |
| 404 | No such record |
| 409 | Conflict — duplicate email, or not enough stock |
| 413 / 415 | Upload too large / wrong file type |
| 422 | A field failed validation |

---

## Public endpoints

### `GET /api/health`
Uptime check. Returns `{"status": "ok", "version": "1.0.0"}`.

### `GET /api/settings`
Every storefront setting as a flat object — branding, copy, currency, shipping
rules. The frontend calls this first and themes itself from the result.

```json
{
  "site_name": "Marigold Supply",
  "color_accent": "#F2B705",
  "currency_symbol": "₹",
  "shipping_flat_rate": "80",
  "free_shipping_threshold": "1500"
}
```

All values are strings, including numbers and booleans. The full key list lives
in `backend/app/site_settings.py`.

### `GET /api/categories`
Active collections with a live product count.

```json
[{ "id": 1, "name": "Kitchen", "slug": "kitchen", "description": "…",
   "sort_order": 1, "is_active": true, "product_count": 3 }]
```

### `GET /api/products`
Only active products. Paginated.

| Query | Type | Default | Notes |
|---|---|---|---|
| `q` | string | — | Matches name, description or item code |
| `category` | string | — | Category **slug**, not id |
| `featured` | bool | — | `true` for the home page shelf |
| `in_stock` | bool | — | `true` hides sold-out items |
| `min_price` / `max_price` | number | — | |
| `sort` | enum | `newest` | `newest`, `price_asc`, `price_desc`, `name` |
| `page` | int | 1 | |
| `page_size` | int | 12 | Max 100 |

```
GET /api/products?category=kitchen&sort=price_asc&page=1
```

```json
{
  "items": [{
    "id": 2, "name": "Cast iron skillet, 10\"", "slug": "cast-iron-skillet-10",
    "sku": "MS-CAST-IR", "short_description": "Sand-cast, pre-seasoned, one piece.",
    "description": "…", "price": 2450.0, "compare_at_price": null,
    "stock": 12, "image_url": "", "gallery": [],
    "category_id": 1, "category_name": "Kitchen",
    "is_active": true, "is_featured": true, "in_stock": true,
    "created_at": "2026-07-02T09:14:00"
  }],
  "total": 3, "page": 1, "page_size": 12, "pages": 1
}
```

### `GET /api/products/{slug}`
One product by its slug. `404` if hidden or missing.

### `POST /api/cart/preview`
The cart lives in the customer's browser. This endpoint is how it is priced —
send the raw lines, get back real prices, stock warnings and totals. **The
client never calculates money.**

```json
{ "items": [{ "product_id": 2, "quantity": 3 }] }
```

```json
{
  "items": [{
    "product_id": 2, "name": "Cast iron skillet, 10\"", "slug": "cast-iron-skillet-10",
    "image_url": "", "unit_price": 2450.0, "quantity": 3, "line_total": 7350.0,
    "stock": 12, "available": true, "message": ""
  }],
  "subtotal": 7350.0, "shipping_fee": 0.0, "tax": 0.0, "total": 7350.0,
  "free_shipping_threshold": 1500.0, "currency_symbol": "₹", "has_problems": false
}
```

If a line asks for more than is in stock, the quantity comes back reduced,
`message` explains why, and `has_problems` turns `true` — the cart page uses
that to block checkout.

---

## Accounts

### `POST /api/auth/register` → `201`
```json
{ "email": "asha@example.org", "password": "atleast8chars", "full_name": "Asha Rao" }
```
Returns a token and the user, so the person is signed in straight away.
`409` if the email is taken, `403` if `allow_registration` is off.

### `POST /api/auth/login`
```json
{ "email": "asha@example.org", "password": "atleast8chars" }
```
```json
{ "access_token": "eyJ…", "token_type": "bearer",
  "user": { "id": 4, "email": "asha@example.org", "role": "customer", "…": "…" } }
```

### `GET /api/auth/me` 🔒
The signed-in user.

### `PATCH /api/auth/me` 🔒
Send only what changed: `full_name`, `phone`, `address_line`, `city`,
`postal_code`, `country`. The saved address prefills checkout next time.

### `POST /api/auth/change-password` 🔒 → `204`
```json
{ "current_password": "…", "new_password": "atleast8chars" }
```

---

## Orders

### `POST /api/orders` → `201`
Works signed in **or** as a guest. Sending a token links the order to the
account so it appears under "Your orders".

```json
{
  "items": [{ "product_id": 2, "quantity": 1 }],
  "customer_name": "Asha Rao",
  "customer_email": "asha@example.org",
  "phone": "+91 90000 00000",
  "address_line": "12 Beach Road",
  "city": "Visakhapatnam",
  "postal_code": "530003",
  "country": "India",
  "note": "Leave with the neighbour",
  "payment_method": "cod"
}
```

The server re-reads every price from the database, re-applies the shipping and
tax rules, decrements stock, and returns the finished order with its number.
`409` if stock ran out between adding to cart and checking out.

### `GET /api/orders` 🔒
The signed-in customer's own orders, newest first. `page`, `page_size`.

### `GET /api/orders/{order_number}` 🔒
One order by its number, e.g. `ORD-260821-4KQP`. Customers only see their own.

---

## Admin 🔒 admin only

### `GET /api/admin/dashboard`
Everything the dashboard shows in one call: totals, a 15-day revenue series,
best sellers, low stock, recent orders. Revenue counts orders that are `paid`,
`shipped` or `delivered`.

### Products

| Call | Purpose |
|---|---|
| `GET /api/admin/products` | Includes hidden and sold-out. Filters: `q`, `category_id`, `status_filter` (`active`/`hidden`/`out_of_stock`), `page`, `page_size` |
| `GET /api/admin/products/{id}` | One product, by id |
| `POST /api/admin/products` | Create. Slug is generated from the name |
| `PATCH /api/admin/products/{id}` | Partial update — send only changed fields |
| `DELETE /api/admin/products/{id}` | Deletes, **unless** the product appears in an order, in which case it is hidden so history stays readable |

Create body:
```json
{
  "name": "Waxed canvas tote", "sku": "MS-TOTE",
  "short_description": "Holds a week of groceries.",
  "description": "12oz canvas, hot-waxed by hand…",
  "price": 2790, "compare_at_price": 3200, "stock": 9,
  "image_url": "/media/9f2c….jpg",
  "gallery": ["/media/aa11….jpg"],
  "category_id": 3, "is_active": true, "is_featured": true
}
```

### Categories

| Call | Purpose |
|---|---|
| `GET /api/admin/categories` | All, with product counts |
| `POST /api/admin/categories` | `{ "name", "description", "sort_order", "is_active" }` |
| `PATCH /api/admin/categories/{id}` | Full replace of those four fields |
| `DELETE /api/admin/categories/{id}` | Products in it are kept and left uncategorised |

### Orders

| Call | Purpose |
|---|---|
| `GET /api/admin/orders` | Filters: `q` (number, name, email), `order_status`, `page`, `page_size` |
| `GET /api/admin/orders/{id}` | One order, by numeric id |
| `PATCH /api/admin/orders/{id}/status` | `{ "status": "shipped" }` |

Statuses: `pending` → `paid` → `shipped` → `delivered`, plus `cancelled` from
anywhere. **Cancelling returns the reserved stock to the products.**

### Customers and staff

| Call | Purpose |
|---|---|
| `GET /api/admin/users` | Filters: `q`, `role`, `page`, `page_size` |
| `POST /api/admin/users` | `{ "email", "password", "full_name", "role" }` |
| `PATCH /api/admin/users/{id}` | `full_name`, `phone`, `role`, `is_active`, `password` |
| `DELETE /api/admin/users/{id}` | Their orders are kept and unlinked |

Guard rails, enforced server-side: you cannot remove your own admin access,
delete your own account, or leave the shop without an active admin.

### Storefront settings

`GET /api/admin/settings` — same payload as the public one.

`PUT /api/admin/settings` — send only the keys you want changed:
```json
{ "values": { "site_name": "Marigold Supply", "color_accent": "#F2B705" } }
```
Unknown keys are ignored rather than stored, so a typo cannot pollute the
settings table. Returns the full updated set.

### Image uploads

`POST /api/admin/uploads` — `multipart/form-data` with one field, `file`.

```json
{ "url": "/media/9f2c1b…jpg", "filename": "9f2c1b…jpg" }
```

JPG, PNG, WebP, GIF and SVG, up to `MAX_UPLOAD_MB` (default 5 MB). Paste the
returned `url` into any image field.

---

## Calling the API from your own code

```bash
# Sign in
curl -X POST http://127.0.0.1:8000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@myshop.com","password":"admin12345"}'

# Add a product
curl -X POST http://127.0.0.1:8000/api/admin/products \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Beeswax candles","price":640,"stock":40}'
```

```python
import requests

api = "http://127.0.0.1:8000"
token = requests.post(f"{api}/api/auth/login", json={
    "email": "admin@myshop.com", "password": "admin12345"
}).json()["access_token"]

requests.post(f"{api}/api/admin/products",
              headers={"Authorization": f"Bearer {token}"},
              json={"name": "Beeswax candles", "price": 640, "stock": 40})
```

---

## Payments

Configured in **Admin → Payments**. Keys are encrypted before they are stored,
and no endpoint anywhere returns a gateway secret in the clear.

### `GET /api/payments/methods` — public

What the checkout page should offer. Returns only the safe fields: provider,
label, test mode, publishable key and the note to show the customer.

```json
[
  { "provider": "stripe", "label": "Card payment", "test_mode": true,
    "publishable_key": "pk_test_…", "instructions": "Secure card payment." },
  { "provider": "cod", "label": "Cash on delivery", "test_mode": false,
    "publishable_key": "", "instructions": "Pay the courier." }
]
```

### `POST /api/payments/{order_number}/initiate`

Creates the gateway-side object and tells the browser what to do next.

| `next_action` | What the frontend does |
|---|---|
| `none` | Nothing — cash or bank transfer. Show `checkout_payload.instructions`. |
| `confirm_stripe_payment_intent` | Use `checkout_payload.client_secret` with Stripe.js |
| `open_razorpay_checkout` | Load Razorpay's script and open it with `checkout_payload` |
| `sandbox_confirm` | No live keys saved — a fake reference so you can test the flow |

The sandbox path is the useful one on day one: the whole checkout works before
you have a merchant account.

### `POST /api/payments/{order_number}/confirm`

```json
{ "status": "paid", "reference": "pi_3O…", "note": "" }
```

Records the outcome and moves the order from `pending` to `paid`. Used by the
storefront after the SDK returns, and by an admin logging an offline payment.

> For real money, trust the webhook rather than this call. A browser can lie
> about `confirm`; a signed webhook cannot.

### `POST /api/payments/webhook/{provider}`

Register in your gateway dashboard — the exact address is shown on the
Payments page, next to a copy button:

```
https://your-domain.com/api/payments/webhook/stripe
https://your-domain.com/api/payments/webhook/razorpay
```

Razorpay signatures are verified with HMAC-SHA256 against the signing secret
you saved. Handled events: `payment.captured` and `order.paid` (Razorpay),
`payment_intent.succeeded` (Stripe). Anything else returns 200 and is ignored,
which is what gateways expect.

### Admin endpoints

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/admin/payment-gateways` | all providers, secrets masked |
| `PUT` | `/api/admin/payment-gateways/{provider}` | omit a secret to keep the stored one |
| `DELETE` | `/api/admin/payment-gateways/{provider}/secrets` | forget the keys and switch it off |
| `GET` | `/api/admin/orders/{order_id}/payments` | every payment attempt for an order |

Switching a gateway on without a secret key is refused with `400` — that stops
a broken method reaching your checkout page.

---

## API credentials

Created in **Admin → API keys**. These are for Postman, scripts and partner
systems: no expiry, scoped, and revocable.

### The header

```
X-API-Key: sk_id_xxxxxxxx.sk_secret_yyyyyyyy
```

The secret is shown exactly once, when you create it. Only a SHA-256 hash is
stored, so it cannot be recovered — revoke and make a new one.

### Scopes

| Scope | Allows |
|---|---|
| `catalog:read` | list and read products |
| `catalog:write` | add products, change stock |
| `orders:read` | list orders |
| `orders:write` | move orders between statuses |

A key missing the right scope gets `403`, not `401`, so you can tell "wrong
credential" apart from "not allowed".

### Integration endpoints

| Method | Path | Scope |
|---|---|---|
| `GET` | `/api/integration/whoami` | any valid key |
| `GET` | `/api/integration/products` | `catalog:read` |
| `GET` | `/api/integration/products/{sku}` | `catalog:read` |
| `PATCH` | `/api/integration/products/{sku}/stock?stock=42` | `catalog:write` |
| `GET` | `/api/integration/orders?status=paid` | `orders:read` |
| `PATCH` | `/api/integration/orders/{order_number}/status?status=shipped` | `orders:write` |

Products are addressed by **SKU**, so your warehouse system never needs to know
this shop's internal ids.

```bash
curl http://localhost:8000/api/integration/whoami \
  -H "X-API-Key: sk_id_xxxxxxxx.sk_secret_yyyyyyyy"
```

**What an API key cannot do:** reach anything under `/api/admin`. It cannot
read your customer list, change settings, or see your payment keys. If one
leaks, your shop's configuration is still safe.

### Admin endpoints

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/admin/api-keys` | never includes secrets |
| `POST` | `/api/admin/api-keys` | the only response containing the secret |
| `POST` | `/api/admin/api-keys/{id}/revoke` | stops it working, keeps the record |
| `DELETE` | `/api/admin/api-keys/{id}` | removes it entirely |

---

## Languages

The shop's *interface* is translatable. Product names and descriptions are not —
those live in the products table in whatever language you typed them.

### `GET /api/languages` — public

Only the enabled ones, in sort order. The storefront hides its picker when
fewer than two come back, so a single-language shop shows no dropdown.

```json
[ { "code": "en", "name": "English", "native_name": "English",
    "direction": "ltr", "is_enabled": true, "is_default": true } ]
```

### `GET /api/i18n/{code}` — public

A flat `{key: text}` pack, with **English already laid underneath**, so every
key always has a value and a half-finished translation never shows blanks. An
unknown code returns plain English rather than a 404 — a stale bookmark should
not break the shop.

### Admin endpoints

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/admin/languages` | every language, enabled or not |
| `POST` | `/api/admin/languages` | `{code, name, native_name, direction}` |
| `PATCH` | `/api/admin/languages/{id}` | enable, reorder, or make default |
| `DELETE` | `/api/admin/languages/{id}` | its translations go with it |
| `GET` | `/api/admin/languages/{id}/pack` | English source + translations + progress |
| `PUT` | `/api/admin/languages/{id}/pack` | `{values: {key: text}}` |

Saving an **empty** value deletes that string, sending it back to English —
that is the way to undo a translation, not a bug.

The default language cannot be disabled or deleted; make another one the
default first. That is what stops a shop ending up with no language at all.

---

## Promo codes

Every calculation happens on the server. The browser only ever sends the code
that was typed — never what it is worth.

### `POST /api/promo/check` — public

What the Apply button calls. Nothing is reserved or counted here.

```json
{ "code": "DIWALI20", "subtotal": 3840 }
```

```json
{ "valid": true, "code": "DIWALI20", "kind": "percent",
  "message": "20% off for Diwali", "discount": 500.0, "saved": 500.0,
  "shipping_fee": 0.0, "total": 3340.0, "currency_symbol": "₹" }
```

An invalid code is **not** an error status — it returns `200` with
`valid: false` and a message written for a shopper ("That code has expired",
"Spend ₹500 more to use this code").

### Using one

`POST /api/cart/preview` takes `promo_code` and returns `discount`,
`promo_ok` and `promo_message` alongside the usual totals.

`POST /api/orders` takes `promo_code` too. At that point the code is validated
**again** against the real subtotal, and only then counted against its limits.
A code that fails here returns `400` with the reason. Order responses carry
`discount` and `promo_code`.

That split matters: clicking Apply does not consume a limited code, so window
shoppers cannot exhaust a "first 100 customers" promotion.

### Kinds

| `kind` | `value` means | Notes |
|---|---|---|
| `percent` | 1–100 | pair with `max_discount` to cap the damage |
| `fixed` | an amount off | never takes the order below zero |
| `free_shipping` | ignored | sets delivery to zero |

The discount comes off the goods first, then delivery and tax are worked out on
what is left — so a code can tip an order over the free-delivery threshold, or
drop it back under.

### Admin endpoints

| Method | Path |
|---|---|
| `GET` | `/api/admin/promos` |
| `POST` | `/api/admin/promos` |
| `PATCH` | `/api/admin/promos/{id}` |
| `DELETE` | `/api/admin/promos/{id}` |

Rejected with `400`: a percentage outside 1–100, a fixed amount of zero or
less, or an end date before the start date.

---

## Trying the API from the docs page

The reference at `/docs` has a **sign-in bar across the top**. Enter your email
and password there and every endpoint below works — including everything under
Admin. There is nothing to copy and nothing to paste.

That bar exists because the old flow was too easy to get wrong: Swagger's
Authorize dialog was the only way in, and if you missed it, or pressed Close
instead of Authorize, every call came back `401` with no clue why. The
generated curl simply had no `Authorization` header.

Now the page attaches credentials itself, in a request interceptor:

| Section | Header attached | Comes from |
|---|---|---|
| Auth, Orders, Admin | `Authorization: Bearer …` | the sign-in bar |
| Integration | `X-API-Key: …` | the credential you opened the page with |
| Storefront, Meta | none | public |

Your session is kept in `sessionStorage`, so it survives a reload but not the
tab closing — a reference page left open on a shared machine should not keep an
admin token.

Running `POST /api/auth/login` from the page itself also signs you in on the
bar, so either route works. Swagger's **Authorize** button still works too; you
should not need it.

### If a call comes back 401

The message tells you which part is wrong, rather than a flat "invalid key":

| Message | Means |
|---|---|
| *That is the key id, not the secret* | you pasted the wrong half |
| *The secret does not match that key id* | mixed halves from two credentials |
| *That credential has been revoked* | it exists, but you switched it off |
| *That credential is not valid …shown only once* | wrong or lost secret — make a new one |
| *No credential sent* | Authorize did not apply; check you pressed Authorize, not just Close |

### The docs page does not need the internet

Swagger UI is served from `backend/static/docs`, not a CDN. This matters more
than it sounds: with the CDN version, a blocked or slow CDN leaves the page
looking normal while **Authorize silently does nothing**, which reads as "my
credential is wrong" when it is not. Self-hosted, `/docs` works offline and
behind a firewall.

ReDoc at `/redoc` still loads from a CDN — it has no *Try it out*, so it is
reading material only and degrades to nothing worse than an unstyled page.

**Postman is unchanged.** Keep using the `X-API-Key` header and the existing
collection — nothing about it needs updating.

### Signing in as a person, not a script

Everything under **Auth**, **Orders** and **Admin** needs a *login token*, not
an API key. Sending an API key to those returns `401 Sign in to continue.`

From the docs page: run `POST /api/auth/login` with your email and password.
The page reads `access_token` out of the response and fills the **Login token**
box for you — admin endpoints work immediately, with nothing to copy. To do it
by hand, paste the token into **Login token** under Authorize (just the token;
Swagger adds the word Bearer).

The three Authorize boxes and what each is for:

| Box | Used by | What to paste |
|---|---|---|
| **Login token** | Auth, Orders, Admin | `access_token` from `POST /api/auth/login` |
| **API key** | Integration | the credential, or just the secret |
| **API key as username** | Integration, for Basic-only tools | Client ID / Client secret |

Every endpoint's padlock shows which it wants.

---

## System email

Configured in **Admin → System email**. SMTP credentials live in their own
table, never in site settings — `GET /api/settings` is public and an SMTP
password has no business being one fetch away from anyone.

### Templates

Seeded on first boot and editable after that. Missing ones are recreated;
wording you have changed is never overwritten.

| Key | Sent when |
|---|---|
| `account_created` | someone finishes signing up |
| `password_reset` | a new password is issued for an account |
| `order_placed` | checkout succeeds |
| `order_shipped` | an order moves to Shipped |
| `order_delivered` | an order moves to Delivered |
| `order_returned` | an order moves to Returned |
| `order_cancelled` | an order moves to Cancelled |

Status emails fire only on an actual change, so re-saving the same status does
not send a second copy.

Placeholders are `{{name}}` and are filled by plain string replacement — there
is no expression evaluation, so a template cannot become a way to run something
on the server. An unknown name is left visible rather than blanked, so a typo
shows up in the preview instead of vanishing.

### Endpoints

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/admin/email/settings` | password masked |
| `PUT` | `/api/admin/email/settings` | omit `password` to keep the stored one |
| `GET` | `/api/admin/email/templates` | |
| `GET` | `/api/admin/email/templates/{key}` | includes `variables`, a preview, and the sample behind it |
| `PUT` | `/api/admin/email/templates/{key}` | `{subject, body, is_enabled}` |
| `POST` | `/api/admin/email/templates/{key}/reset` | restore the original wording |
| `POST` | `/api/admin/email/test` | `{to, template_key}` — sends immediately, returns the real error |
| `GET` | `/api/admin/email/log` | last 50 attempts |
| `POST` | `/api/admin/users/{id}/reset-password` | issues and emails a temporary password |

Rejected with `400`: switching sending on without a host and sender address, or
ticking both STARTTLS and SSL.

### Sending never breaks a request

Order and account emails go out as background tasks after the response. A mail
server that is slow, wrong or down produces a row in the email log — not a
failed checkout. The test send is the exception: it runs in the foreground so
you get the actual SMTP error back.

`POST /api/admin/orders/{id}/status` now also accepts `returned`, which puts
the stock back the same way `cancelled` does.
