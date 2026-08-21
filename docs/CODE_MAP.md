# Where to change what

A map of the project, then a set of recipes for the changes you are most
likely to want. Each recipe lists every file you have to touch — no hunting.

---

## The file tree

```
shopkit/
├── backend/
│   ├── .env                    ← your secrets and database URL (never commit)
│   ├── .env.example            ← template for the above
│   ├── requirements.txt        ← Python packages
│   ├── shop.db                 ← the SQLite database file (created on first run)
│   ├── media/                  ← uploaded images land here
│   └── app/
│       ├── main.py             ← starts the app, wires routers, serves the frontend
│       ├── config.py           ← reads .env; every tunable setting
│       ├── database.py         ← the database connection
│       ├── models.py           ← THE TABLES. Columns live here
│       ├── schemas.py          ← what the API accepts and returns
│       ├── security.py         ← password hashing, JWT tokens
│       ├── deps.py             ← "must be signed in" / "must be admin"
│       ├── serializers.py      ← turns a database row into an API response
│       ├── site_settings.py    ← the editable storefront settings + defaults
│       ├── utils.py            ← slugs, order numbers, SHIPPING AND TAX MATH
│       ├── seed.py             ← first admin + demo catalogue
│       └── routers/
│           ├── auth.py         ← register, login, profile
│           ├── catalog.py      ← products, categories, cart pricing, settings
│           ├── orders.py       ← checkout, order history
│           └── admin.py        ← everything the admin panel calls
│
├── frontend/
│   ├── index.html              ← storefront shell (fonts + script tags only)
│   ├── admin.html              ← admin shell
│   └── assets/
│       ├── css/app.css         ← ALL styling, for both interfaces
│       └── js/
│           ├── api.js          ← the API client + shared helpers
│           ├── store.js        ← every storefront page
│           └── admin.js        ← every admin page
│
└── docs/
    ├── API.md                  ← endpoint reference
    ├── SETUP.md                ← running, hosting, going live
    └── CODE_MAP.md             ← this file
```

### The one rule worth remembering

**Money is calculated on the server, never in the browser.** Prices come from
the database, shipping and tax come from `utils.price_order()`. The browser
only ever says "product 4, quantity 2". If you change pricing logic, change it
in `utils.py` and the storefront, checkout and admin all follow.

---

## No code needed

These are all in the admin panel under **Storefront**, and take effect as soon
as you save:

| You want to change | Where |
|---|---|
| Shop name, tagline, logo | Storefront → Identity |
| Colours and corner roundness | Storefront → Colours |
| Home page headline, about text, footer, announcement bar | Storefront → Home page |
| Currency symbol, delivery charge, free-delivery threshold, tax % | Storefront → Selling rules |
| Whether new customers can sign up | Storefront → Selling rules |
| Payment methods shown at checkout | Storefront → Selling rules |
| Products, prices, stock, photos, collections | Products / Collections |
| Who is an admin | Customers → Edit → Role |

Do not edit these in code. They live in the database so you can change them
without a deploy.

---

## Recipe: add a field to products

Say you want a **weight** on every product. Four files, in this order.

**1. `backend/app/models.py`** — add the column to `class Product`:

```python
weight_grams: Mapped[int] = mapped_column(Integer, default=0)
```

**2. `backend/app/schemas.py`** — three places:

```python
class ProductIn(BaseModel):
    weight_grams: int = 0            # what create accepts

class ProductUpdate(BaseModel):
    weight_grams: int | None = None  # what patch accepts

class ProductOut(BaseModel):
    weight_grams: int                # what the API returns
```

**3. `backend/app/serializers.py`** — add it to `product_out()`:

```python
weight_grams=product.weight_grams,
```

**4. Recreate the table.** Delete `backend/shop.db` and restart, or add a
migration (see SETUP.md).

Now it flows through the API. To edit it in the admin panel, add a field in
`frontend/assets/js/admin.js` → `productDrawer()`:

```html
<label class="field"><span>Weight (g)</span>
  <input type="number" name="weight_grams" value="${p.weight_grams}"></label>
```

…and include it in the body that gets sent, a few lines below:

```javascript
weight_grams: parseInt(raw.weight_grams || 0, 10),
```

To show it on the product page, add a row to the spec table in
`store.js` → `viewProduct()`:

```html
<tr><th>Weight</th><td class="num">${product.weight_grams} g</td></tr>
```

The same four-file pattern works for any field on any table.

---

## Recipe: add a new storefront setting

Settings are the things you want to change without deploying. Adding one is a
single line.

**`backend/app/site_settings.py`** — add a key to `DEFAULTS`:

```python
"returns_policy": "Returns accepted within 14 days, unused.",
```

That is it on the backend. It is now readable at `GET /api/settings`, writable
at `PUT /api/admin/settings`, and unknown-key protection covers it.

To give it a box in the admin panel, add it to a group in
`frontend/assets/js/admin.js` → `SETTING_GROUPS`:

```javascript
["returns_policy", "Returns policy", "textarea"],
```

Field types available: `text`, `textarea`, `number`, `color`, `toggle`,
`image` (which gets an upload button).

To use it on the storefront, anywhere in `store.js`:

```javascript
${esc(Site.get("returns_policy"))}
```

---

## Recipe: change the shipping or tax rules

All of it is in one function: `backend/app/utils.py` → `price_order()`.

```python
def price_order(db, subtotal):
    flat = site_settings.get_float(db, "shipping_flat_rate", 0)
    threshold = site_settings.get_float(db, "free_shipping_threshold", 0)
    ...
```

For a flat rate, a free-delivery threshold or a tax percentage, **do not touch
this** — change the numbers in the admin panel instead.

Change the function when the *rule* changes. Weight-based shipping, for
example:

```python
def price_order(db, subtotal, total_weight=0):
    shipping = 0 if subtotal >= threshold else 50 + (total_weight / 1000) * 30
```

Both callers — `routers/catalog.py` → `preview_cart()` and `routers/orders.py`
→ `place_order()` — need the new argument. Because they both call the same
function, the price the customer is quoted and the price they are charged can
never drift apart.

---

## Recipe: add a discount code

There is no coupon system. Here is the shape of one:

1. **`models.py`** — a `Coupon` table: `code`, `percent_off`, `amount_off`,
   `expires_at`, `max_uses`, `times_used`, `is_active`.
2. **`utils.py`** — `price_order()` takes an optional `coupon` and subtracts
   the discount before shipping and tax; return `discount` in the dict.
3. **`schemas.py`** — add `coupon_code` to `CartIn` and `OrderIn`, and
   `discount` to `CartOut` and `OrderOut`.
4. **`routers/catalog.py` and `routers/orders.py`** — look the code up,
   validate it (active, not expired, under `max_uses`), pass it through. On a
   successful order, increment `times_used`.
5. **`routers/admin.py`** — a CRUD section for coupons, copied from the
   categories section.
6. **Frontend** — a code box on the cart page in `store.js` → `viewCart()`,
   and a Coupons page in `admin.js` modelled on `pageCategories()`.

Validate the code server-side in step 4. A discount applied only in the
browser is a discount anyone can give themselves.

---

## Recipe: taking real payments

Right now an order records *how* someone intends to pay (`cod`,
`bank_transfer`) and is created with status `pending`. Nothing is charged.

The hook is marked in `backend/app/routers/orders.py`, at the end of
`place_order()`:

```python
db.commit()
db.refresh(order)
# >>> Payment gateway hook: charge here, then set order.status = "paid".
```

### Stripe

```bash
pip install stripe
```

```python
import stripe
stripe.api_key = os.getenv("STRIPE_SECRET_KEY")

# in place_order(), instead of returning immediately:
session = stripe.checkout.Session.create(
    mode="payment",
    line_items=[{
        "price_data": {
            "currency": "inr",
            "product_data": {"name": item.product_name},
            "unit_amount": int(item.unit_price * 100),   # paise, not rupees
        },
        "quantity": item.quantity,
    } for item in order.items],
    success_url=f"https://yourdomain.com/#/order/{order.order_number}",
    cancel_url="https://yourdomain.com/#/cart",
    metadata={"order_number": order.order_number},
)
return {"order": order, "checkout_url": session.url}
```

Then in `store.js` → the checkout submit handler, redirect to
`response.checkout_url` instead of jumping to the order page.

**The important half:** add a webhook endpoint that Stripe calls when payment
actually succeeds, and flip the status there — not in the browser.

```python
@router.post("/api/webhooks/stripe")
async def stripe_webhook(request: Request, db: Session = Depends(get_db)):
    event = stripe.Webhook.construct_event(
        await request.body(),
        request.headers["stripe-signature"],
        os.getenv("STRIPE_WEBHOOK_SECRET"),
    )
    if event["type"] == "checkout.session.completed":
        number = event["data"]["object"]["metadata"]["order_number"]
        order = db.query(Order).filter(Order.order_number == number).first()
        if order:
            order.status = "paid"
            db.commit()
    return {"received": True}
```

A browser redirect proves the customer *reached* the success page. Only the
webhook proves the money moved.

### Razorpay

Same structure: create an order with `razorpay.Order.create()`, open Checkout
in the browser with the returned id, and verify the signature server-side in a
webhook before marking the order paid.

---

## Recipe: sending emails

Nothing is emailed yet. Add `backend/app/mailer.py`:

```python
import smtplib
from email.message import EmailMessage
from .config import settings

def send(to: str, subject: str, body: str) -> None:
    message = EmailMessage()
    message["From"] = settings.MAIL_FROM
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)
    with smtplib.SMTP_SSL(settings.SMTP_HOST, 465) as server:
        server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        server.send_message(message)
```

Add `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` and `MAIL_FROM` to `config.py`
and `.env`. Then call it from two places:

- `routers/orders.py` → `place_order()`, after the commit — the confirmation.
- `routers/admin.py` → `set_order_status()` — "your order has shipped".

Send it in the background so a slow mail server does not hold up the response:

```python
from fastapi import BackgroundTasks

def place_order(payload: OrderIn, background: BackgroundTasks, ...):
    ...
    background.add_task(mailer.send, order.customer_email,
                        f"Order {order.order_number} confirmed", body)
```

For anything beyond a trickle, use a service with an API — Resend, Postmark or
SendGrid — rather than raw SMTP.

---

## Recipe: storing images somewhere permanent

`POST /api/admin/uploads` writes to `backend/media/`. That is fine on a VPS and
useless on Render, Railway or Fly, where the filesystem is wiped on every
deploy.

Replace the body of `upload_image()` in `backend/app/routers/admin.py`:

```python
import boto3
s3 = boto3.client("s3")

@router.post("/uploads", response_model=UploadOut)
async def upload_image(file: UploadFile = File(...)):
    key = f"products/{uuid.uuid4().hex}{Path(file.filename).suffix}"
    s3.upload_fileobj(file.file, os.getenv("S3_BUCKET"), key,
                      ExtraArgs={"ContentType": file.content_type})
    return UploadOut(url=f"{os.getenv('S3_PUBLIC_URL')}/{key}", filename=key)
```

Nothing else changes — the frontend just stores whatever URL comes back.
Cloudflare R2 and Backblaze B2 both speak the S3 API, so the same code works
with different credentials.

---

## Recipe: change how the storefront looks

**Colours, roundness, copy** → admin panel. They are database values that
overwrite CSS variables at page load (`api.js` → `applyTheme()`).

**Everything else** → `frontend/assets/css/app.css`. It is organised top to
bottom as: variables, resets, controls, storefront, admin, responsive. The
`:root` block at the top drives most of it:

```css
--display: "Bricolage Grotesque", …;   /* headings */
--body: "Karla", …;                    /* paragraphs */
--mono: "JetBrains Mono", …;           /* prices, codes, order numbers */
--wrap: 1180px;                        /* page width */
```

Changing a font means changing the `<link>` in **both** `index.html` and
`admin.html` as well as the variable here.

**Page structure** → `frontend/assets/js/store.js`. Each page is one function
that returns HTML: `viewHome()`, `viewShop()`, `viewProduct()`, `viewCart()`,
`viewCheckout()`, `viewAccount()`, `viewOrder()`. Find the function, edit the
template string.

The product card that appears in every grid is `productCard()` — edit once,
changes everywhere.

The receipt block used on the cart, checkout and order pages is `receipt()`.

---

## Recipe: add a page to the storefront

Three edits in `store.js`.

**1.** Write the function:

```javascript
async function viewShipping() {
  app().innerHTML = `<div class="wrap section">
    <h1>Delivery and returns</h1>
    <p>${esc(Site.get("returns_policy"))}</p>
  </div>`;
}
```

**2.** Register the route in `router()`:

```javascript
case "shipping": return viewShipping();
```

**3.** Link to it in `renderChrome()`:

```html
<a href="#/shipping">Delivery</a>
```

Routing is hash-based on purpose: no server rules, and links survive a
refresh. Admin pages follow the same pattern in `admin.js` — write the
function, add a `case` to `route()`, add an entry to the `NAV` array.

---

## Recipe: add a new API endpoint

Say you want a public "best sellers" list.

**1. `backend/app/routers/catalog.py`:**

```python
@router.get("/products/bestsellers", response_model=list[ProductOut])
def bestsellers(db: Session = Depends(get_db), limit: int = 5):
    rows = (db.query(Product, func.sum(OrderItem.quantity).label("sold"))
            .join(OrderItem, OrderItem.product_id == Product.id)
            .filter(Product.is_active.is_(True))
            .group_by(Product.id)
            .order_by(func.sum(OrderItem.quantity).desc())
            .limit(limit).all())
    return [product_out(p) for p, _ in rows]
```

Put it **above** `@router.get("/products/{slug}")` — FastAPI matches routes in
order, and `{slug}` would otherwise swallow `bestsellers`.

**2. `frontend/assets/js/api.js`** — add it to the `API` object:

```javascript
bestsellers: (limit) => request("/api/products/bestsellers", { query: { limit } }),
```

**3.** Call it: `const top = await API.bestsellers(5);`

It appears in `/docs` automatically. If it should be admin-only, put it in
`routers/admin.py` instead — that router already requires an admin token for
every route in it.

---

## Recipe: change security settings

| Change | File | What to do |
|---|---|---|
| How long a login lasts | `.env` | `ACCESS_TOKEN_EXPIRE_MINUTES=10080` for a week |
| Minimum password length | `schemas.py` | `Field(min_length=8)` on `RegisterIn` and `AdminUserIn` |
| Password hashing algorithm | `security.py` | Rewrite `hash_password` and `verify_password`. Nothing else calls into them. Existing hashes stop verifying, so plan a reset |
| Who counts as an admin | `deps.py` | `require_admin()` — the single gate for the whole admin API |
| Max upload size | `.env` | `MAX_UPLOAD_MB=10` |
| Allowed image types | `config.py` | `ALLOWED_IMAGE_TYPES` |

To switch to bcrypt:

```bash
pip install bcrypt
```

```python
import bcrypt

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def verify_password(password: str, stored: str) -> bool:
    return bcrypt.checkpw(password.encode(), stored.encode())
```

---

## Things that will trip you up

**You added a column and nothing happened.** `create_all()` creates missing
tables; it never alters existing ones. Delete `shop.db` in development, or use
Alembic on anything with real data.

**A new route returns the wrong thing.** FastAPI matches in registration
order. `/products/{slug}` matches `/products/anything`, so specific routes go
above dynamic ones.

**The browser is serving an old JavaScript file.** Hard-reload with Ctrl/Cmd +
Shift + R. Browsers cache `.js` aggressively.

**A checkbox saved as unchecked when it was checked.** `FormData` omits
unchecked boxes entirely. Read them with `form.fieldname.checked`, as
`productDrawer()` and `pageAppearance()` both do.

**Anything you print into HTML must go through `esc()`.** A product named
`<script>` should render as text, not run. Every template string in this
project does this — keep it up.

**Two people edited the same product at once.** Last write wins; there is no
locking. Fine for one or two staff, worth thinking about beyond that.

---

## Payments and API keys

Added as two self-contained features. Neither changes an existing table, so an
existing shop needs no migration — the new tables appear on the next boot.

### Files

| File | What it holds |
|---|---|
| `backend/app/crypto.py` | encrypt/decrypt gateway secrets, generate and hash API keys |
| `backend/app/models.py` | `PaymentGateway`, `PaymentAttempt`, `ApiKey` (appended at the end) |
| `backend/app/deps.py` | `require_api_key`, `require_scope` (appended at the end) |
| `backend/app/routers/payments.py` | methods, initiate, confirm, webhooks |
| `backend/app/routers/integration.py` | the API-key surface for Postman |
| `backend/app/routers/admin.py` | gateway CRUD and API-key CRUD (appended at the end) |
| `frontend/assets/js/admin.js` | `pagePayments()` and `pageApiKeys()` (appended at the end) |
| `frontend/assets/js/api.js` | the matching client methods |

### Add another gateway (say PayPal)

1. `seed.py` → `ensure_payment_gateways`, add the provider so a row exists.
2. `routers/admin.py` → `GATEWAY_DEFAULTS` and `NEEDS_KEYS`.
3. `routers/payments.py` → `initiate()`, add a branch returning a `next_action`.
4. Same file → `webhook()`, add a branch reading that gateway's event shape.
5. `frontend/assets/js/admin.js` → `GATEWAY_HELP`, add the key labels.
6. Wherever your checkout runs, handle the new `next_action`.

A method you settle by hand needs none of this — add it to `OFFLINE` in
`payments.py` alongside `cod` and `bank_transfer`.

### Add an API scope

1. `routers/admin.py` → `VALID_SCOPES`.
2. `frontend/assets/js/admin.js` → `SCOPES` (the checkbox list).
3. Use it: `key = Depends(require_scope("your:scope"))` in `integration.py`.

Scopes are a comma-separated string on the row, so nothing else needs changing.

### Two things worth knowing

- **`SECRET_KEY` decrypts the gateway secrets.** Change it and saved Stripe or
  Razorpay keys become unreadable — re-enter them in Admin → Payments. Login
  tokens are invalidated too, which is harmless.
- **Saving a gateway rewrites the older `payment_methods` setting** to match
  whichever gateways are switched on, so the storefront keeps working whichever
  of the two it reads.

---

## Languages, promo codes and fonts

### Files

| File | What it holds |
|---|---|
| `backend/app/i18n.py` | the string catalogue and pack merge/save logic |
| `backend/app/promos.py` | promo validation and discount maths |
| `backend/app/migrate.py` | adds new columns to an existing database on boot |
| `backend/app/routers/public_extras.py` | `/api/languages`, `/api/i18n/{code}`, `/api/promo/check` |
| `backend/app/routers/admin.py` | language and promo CRUD (appended at the end) |
| `frontend/assets/js/api.js` | `I18n`, `t()`, `applyFonts()`, `FONT_CHOICES` |
| `frontend/assets/js/store.js` | language picker, `Promo`, `promoBox()` |
| `frontend/assets/js/admin.js` | `pageLanguages()`, `pageLanguageEditor()`, `pagePromos()` |

### Add a translatable string

1. `backend/app/i18n.py` → `CATALOGUE`, add `"your.key": "English wording"`.
2. Use it in the frontend: `${esc(t("your.key"))}`.

It appears in the dashboard editor for every language automatically. Untranslated
keys fall through to English, so nothing breaks in the meantime.

### Translate product names and descriptions

Not built, deliberately — it roughly doubles the product form. The shape that
works: a `product_translations` table keyed on `(product_id, language_code,
field)`, joined in `serializers.product_out` based on a language passed by the
frontend. Budget a day, not an hour.

### Change how a discount is calculated

`backend/app/promos.py` → `discount_for()`. Everything — cart preview, checkout
and the Apply button — goes through that one function.

To add a kind (say, buy-one-get-one):

1. `models.py` → the comment on `PromoCode.kind`.
2. `schemas.py` → the `kind` pattern on `PromoIn`.
3. `promos.py` → a branch in `discount_for()`.
4. `admin.js` → `PROMO_KINDS`.

### Fonts

Four settings keys: `font_store_display`, `font_store_body`,
`font_admin_display`, `font_admin_body`. `applyFonts(values, scope)` in
`api.js` loads them from Google Fonts and sets `--display` and `--body`.

Which pair a page uses is decided by `window.FONT_SCOPE`, set to `"admin"` at
the top of `admin.js` and left unset (so, `"store"`) everywhere else.

To offer more fonts, add names to `FONT_CHOICES` in `api.js`. Any Google Fonts
family works; a name that is not on Google falls through to the system stack
rather than breaking the page.

### Adding a database column safely

`backend/app/migrate.py` runs on every boot and adds missing columns to tables
that already exist — which `create_all` will not do. Add the column to
`models.py`, add one line to `ADDED_COLUMNS`, restart. It only ever adds; it
never drops, renames or retypes, so it cannot lose data. Anything beyond that
wants Alembic.

### The two sessions

The shop and the dashboard authenticate separately:

| | localStorage key | Set by |
|---|---|---|
| Storefront | `shopkit_token` | default |
| Dashboard | `shopkit_admin_token` | `window.AUTH_SCOPE = "admin"` in `admin.html` |

`Auth` in `api.js` picks the key at call time from `window.AUTH_SCOPE`, which
`admin.html` declares in an inline script **before** `api.js` loads. Keep that
ordering — if the scope is set after the first token read, the dashboard reads
the shop's key instead.

The same switch drives `window.FONT_SCOPE`, which decides whether `applyTheme`
applies the `font_store_*` or `font_admin_*` settings.

Both tokens are the same kind of JWT; nothing on the server distinguishes them.
The separation is about whose session lives in which browser tab, not about
permissions — those still come from the user's `role`.

### Styling: shop versus dashboard

Two independent sets of settings, distinguished by an `admin_` prefix:

| | Shop keys | Dashboard keys |
|---|---|---|
| Colours | `color_ink`, `color_accent`, `color_paper`, `corner_radius` | the same names with `admin_` in front |
| Fonts | `font_store_display`, `font_store_body` | `font_admin_display`, `font_admin_body` |

`applyTheme(values, scope)` in `api.js` reads one set or the other. The scope
comes from `window.STYLE_SCOPE`, declared in `admin.html` before `api.js`
loads; anywhere else it is absent, so the shop's keys are used.

A blank `admin_` value falls back to the shop's, which is why upgrading an
existing shop changes nothing until you edit something.

The two dashboard pages are `pageAppearance()` (`#/appearance`) and
`pageDashboardStyle()` (`#/dashboard-style`). Both build their fields from a
group list — `SETTING_GROUPS` and `ADMIN_STYLE_GROUPS` — so adding a setting is
one line in the right list plus one key in `site_settings.DEFAULTS`.

### Adding a font

1. `FONT_SPECS` in `api.js` — the name, and the weight string Google publishes
   for it. Check on fonts.google.com; a wrong weight makes the request 400 and
   the font silently never loads.
2. `FONT_CHOICES` — to put it in the dropdowns.
3. A font already on the machine goes in `SYSTEM_FONTS` instead, so no request
   is made. A font Google has renamed goes in `FONT_ALIASES`.

### API docs authentication

`deps.py` declares two security schemes, `api_key_scheme` (an `APIKeyHeader`)
and `basic_scheme` (an `HTTPBasic`), both with `auto_error=False` so a missing
one falls through to the other. `require_api_key` reads the header first, then
Basic, accepting the credential whole in the username or split across username
and password.

Declaring them as schemes rather than reading the header by hand is what puts
them in the Authorize dialog on `/docs`.

### System email

| File | What it holds |
|---|---|
| `backend/app/mailer.py` | template defaults, `{{placeholder}}` rendering, SMTP send, logging |
| `backend/app/models.py` | `EmailSettings`, `EmailTemplate`, `EmailLog` |
| `backend/app/routers/admin.py` | the email endpoints and the background tasks |
| `frontend/assets/js/admin.js` | `pageEmail()`, `pageEmailTemplate()` |

**Add a template:** append to `DEFAULT_TEMPLATES` in `mailer.py` with a `key`,
`name`, `description`, `variables`, `subject` and `body`. It appears in the
dashboard on the next boot. Then call it from wherever the event happens:

```python
background.add_task(email_order_task, "your_key", order.id)
```

**Why background tasks open their own session:** by the time one runs, the
request's session is closed and its objects are detached. Each task takes an id
and re-fetches. Passing an ORM object into a task will fail at runtime.

**Where the events are wired:**

| Event | File |
|---|---|
| Sign-up | `routers/auth.py` → `register` |
| Checkout | `routers/orders.py` → `place_order` |
| Order status | `routers/admin.py` → `set_order_status` |
| Password reset | `routers/admin.py` → `reset_user_password` |

**Not built:** a self-serve "forgot my password" flow. A customer cannot
trigger a reset themselves — an admin issues one from Customers, and the
template goes out with it. Adding self-serve needs a token table with expiry;
do not shortcut it by emailing a password to whoever types an address in.

### Full-page editors

Products and promo codes open as pages, not overlays:

```
#/products/new   #/products/12
#/promos/new     #/promos/4
#/email/order_placed
```

The router splits the hash on `/` and passes `parts[1]` through, so a list page
and its editor share one `case`. Saving does `location.hash = "#/products"`,
which sends you back to the list with the new row already in it.

The pattern for a new one: render into `main()` with `pageHead(...)`, wrap the
form in `.edit-page`, and put the buttons in `.edit-actions` — that gives you
the sticky save bar for free.

### The API docs page

`/docs` and `/redoc` are custom routes in `main.py`, not FastAPI's built-in
ones (`docs_url=None, redoc_url=None` on the app). The reason is that the
built-ins load Swagger UI from a public CDN, and when that is blocked the page
still renders — but Authorize quietly stops working, which looks exactly like a
bad credential.

Swagger UI's files live in `backend/static/docs/`, mounted at `/static`. To
update them:

```bash
npm pack swagger-ui-dist@5
tar xzf swagger-ui-dist-*.tgz
cp package/swagger-ui-bundle.js package/swagger-ui.css \
   package/favicon-32x32.png backend/static/docs/
```

`deps._lookup_api_key` decides what counts as a valid credential. It accepts
`key_id.secret` and the bare secret, and refuses a bare key id — the key id is
displayed in the dashboard list, so treating it as a secret would make every
credential public. Each rejection returns a different message so a 401 is
diagnosable; keep that if you change the function.

### Who may read /docs

`main.py` → `docs_credential` guards `/docs`, `/redoc` and `/openapi.json` with
HTTP Basic, checked against the same API credentials as the API itself
(`deps._lookup_api_key`). The browser's own sign-in box collects it: Client ID
in Username, Client secret in Password.

The app is created with `openapi_url=None` so FastAPI does not publish an
unguarded schema route; `OPENAPI_PATH` is served by the gated route instead. If
you ever set `openapi_url` back on the app, the schema becomes public again
while the page above it stays locked — which is worse than either choice made
deliberately.

After the gate passes, the credential is embedded in the page as a
`preauthorizeApiKey` call so *Try it out* needs no second entry. It only goes
back to a browser that just proved it has it. `DOCS_PUBLIC=true` skips the gate
and the pre-authorisation together, leaving the normal Authorize button.

### A specificity trap worth remembering

The base input rule in `app.css` is deliberately `input, select, textarea` —
low specificity — with opt-outs for checkboxes and radios below it. An earlier
version used `input:not([type=checkbox]):not([type=radio])…`, which scores
(0,4,1) and quietly beat `.swatch-row input[type=color]` at (0,2,1), stretching
the colour swatches to full width. If you need to exclude input types, add an
override rule rather than lengthening a `:not()` chain.

### Why the login token is a declared scheme

`deps.bearer_scheme` is an `HTTPBearer` used with `Security(...)` in
`get_current_user` and `get_current_user_optional`. That is the only reason a
**Login token** box appears in the Authorize dialog and padlocks appear on the
Auth, Orders and Admin endpoints.

An earlier version read the `Authorization` header by hand. It worked perfectly
for the storefront and for curl, and was invisibly broken in the docs: those
endpoints declared no security, so Swagger offered nowhere to paste a token and
every call came back `401 Sign in to continue.` If you add another way to
authenticate, declare it as a scheme rather than reading the header directly.

`_presented_token` still falls back to the raw header, so nothing outside the
docs changed.

The docs page also carries a `responseInterceptor` that watches for a
successful `POST /api/auth/login` or `/register` and calls
`preauthorizeApiKey("Login token", …)` with the token from the response. That
is a convenience for the docs page only; it never runs anywhere else.

---

## The storefront is React now

`storefront/` is a Vite + React app. The admin panel is deliberately untouched:
plain HTML and JS, no build.

| File | Holds |
|---|---|
| `storefront/src/main.jsx` | mounts the app, imports the shared stylesheet |
| `storefront/src/App.jsx` | routes, plus the offline and maintenance screens |
| `storefront/src/lib/api.js` | every endpoint, the token, error shaping |
| `storefront/src/lib/shop.jsx` | one context: settings, language, cart, promo, session, toasts |
| `storefront/src/lib/theme.js` | colours and Google Fonts, shop scope only |
| `storefront/src/components/` | Layout (header, footer, toasts), Bits (receipt, promo box, tiles) |
| `storefront/src/pages/` | one file per page |

### Adding a page

1. Write `storefront/src/pages/Thing.jsx`.
2. Add a `<Route>` in `App.jsx`.
3. Link to it with `<Link to="/thing">`.

Routing is `HashRouter`, matching the old storefront, so URLs stay
`#/shop` and no rewrite rule is needed on the server.

### Two rules the port kept

**Class names come from `app.css`.** The stylesheet is shared with the admin
panel and was written first. Invent a class in JSX and it silently renders
unstyled — that happened during the port with `.p-grid` and `.hero-art`, which
should have been `.product-grid` and `.hero-figure`. Check the stylesheet
before naming anything.

**`NavLink` is told to use `.on`.** React Router's default active class is
`active`; this stylesheet marks the current page with `on`.

### Where the build output goes

`vite.config.js` writes to `../frontend/store` with `base: "/store/"`. FastAPI
serves `frontend/store/index.html` at `/` and mounts the hashed assets at
`/store`. `frontend/assets` is still mounted for the admin panel.

The output is committed. That is unusual, and it is deliberate: Render's free
Python runtime has no Node, so committing the build keeps the free deployment
path in DEPLOY.md working. The `Dockerfile` has a Node stage that rebuilds it,
so container images never carry stale assets.

### Guest orders and the confirmation page

`GET /api/orders/{number}` needs a login token, so a guest cannot fetch their
own order back. Checkout therefore hands the finished order to the confirmation
page through router state, and `Order.jsx` only falls back to fetching when it
arrives without one. Remove that and guest checkout ends on "we cannot find
that order" — which is what the old storefront did.

---

## The stylesheet

`frontend/assets/css/app.css` is the only stylesheet. The React storefront
imports it; the admin panel links to it. Both applications, one file.

It is organised as: tokens → base elements → forms → buttons → containers →
storefront → admin → right-to-left → responsive → print. Add to the section a
rule belongs in rather than the end of the file.

**Only four values are themed** — `--ink`, `--accent`, `--paper`, `--radius`,
plus the two font families. Everything else derives from them, which is why a
shop can be recoloured from the dashboard without any CSS changing. If you add
a colour, derive it with `color-mix(in srgb, var(--ink) …)` rather than
hard-coding a hex, or it will not follow the theme.

`--accent-ink` is computed at runtime from the accent's luminance, so text on
a primary button stays legible whatever colour someone picks.

### Two traps this file has fallen into before

**Specificity.** The base input rule is deliberately plain
`input, select, textarea`. An earlier version used
`input:not([type=checkbox]):not([type=radio])…`, which scores (0,4,1) and
silently beat `.swatch-row input[type=color]` at (0,2,1) — the colour swatches
stretched to full width with no error anywhere. Exclude input types with an
override rule below, never by lengthening a `:not()` chain.

**Invented class names.** The stylesheet is shared and was written first. A
class that only exists in JSX renders unstyled and reports nothing. Check
`app.css` before naming anything; `.p-grid` and `.hero-art` cost an hour
because they should have been `.product-grid` and `.hero-figure`.

### The API reference page

Three files, and the split matters:

| File | Holds |
|---|---|
| `main.py` → `api_docs` | a thin HTML shell, plus one JSON blob of config |
| `backend/static/docs/console.js` | the sign-in bar and the Swagger UI setup |
| `backend/static/docs/console.css` | the bar's styling |

The behaviour lives in a real `.js` file rather than a Python f-string. That is
deliberate: an f-string containing JavaScript needs every brace doubled, which
is how a regex in an earlier version ended up as `\\{` and silently never
matched.

**Authentication does not go through Swagger's Authorize dialog.** A
`requestInterceptor` attaches `Authorization: Bearer …` to everything except
`/api/integration/*`, and `X-API-Key` to those. Whatever the person did or did
not do in the dialog, the right header goes out. `preauthorizeApiKey` is still
called, but only so Swagger's padlocks look right — nothing depends on it.

A `responseInterceptor` watches for a successful `POST /api/auth/login` and
adopts the token, so signing in through the endpoint counts as signing in on
the bar.

### Booting several workers at once

Production runs multiple worker processes and they all execute the lifespan
together. Three things there had to be made race-safe, and each failed in a
different way before it was:

| Step | What went wrong |
|---|---|
| `migrate.prepare_database` | all workers saw an empty database and all ran `CREATE TABLE`; the losers got "table already exists", exited, and **gunicorn took the whole app down** — so the first deploy of a new database died and the second worked |
| `migrate.run` | two workers adding the same column |
| `seed.run` | two workers inserting the same admin, language or template |

All three now absorb the "someone else got there first" error and carry on.
If you add anything to the lifespan that writes to the database, assume four
processes will run it simultaneously on an empty schema.

### Hosting the shop away from the API

Two environment variables decide where the built shop expects to live:

| Variable | Default | Vercel |
|---|---|---|
| `VITE_BASE` | `/store/` | `/` |
| `VITE_OUT_DIR` | `../frontend/store` | `dist` |
| `VITE_API_BASE` | empty (same origin) | the Render URL |

`vercel.json` sets the first two. All three are build-time — Vite bakes them
into the bundle, so changing one needs a rebuild, not a restart.

`mediaUrl()` in `lib/api.js` is what makes uploaded photos work off-origin: a
stored path like `/media/x.jpg` is relative to the API, so it gets prefixed
with `VITE_API_BASE`. Absolute URLs and data URIs pass through untouched. Any
new place that renders a stored image path must go through it — `ImageTile`
already does, so most code gets it for free.
