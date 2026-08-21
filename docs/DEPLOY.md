# Deploying ShopKit

Yes, you can run this on free hosting with an online database. This guide gets
you to a live HTTPS address in about half an hour, for nothing.

Read the [honest limits](#what-free-actually-costs-you) section before you send
the address to a real customer. Free is genuinely fine for showing the shop to
people, testing the whole flow, and taking your first few orders. It is not
fine for a shop you depend on, and the reasons are specific rather than vague.

Everything below was checked in **August 2026**. Free tiers change often —
treat the shape of the advice as durable and re-check the numbers.

---

## The short version

| Piece | Use | Cost |
|---|---|---|
| App hosting | **Render**, free web service | £0 |
| Database | **Neon**, free Postgres | £0 |
| Address | `your-shop.onrender.com`, free HTTPS | £0 |
| Your own domain | a `.xyz` or `.store` from a registrar | about $1–3 for the first year |
| Product photos | see [the one real gap](#the-one-real-gap-product-photos) | £0 with a workaround |

**Why not Render's own free database?** It expires 30 days after you create
it. Fine for a demo, useless for a shop. Neon's free tier does not expire.

---

## 1. Put the code on GitHub

Render deploys from a repository.

**Build the storefront first if you have changed it:**

```bash
cd storefront && npm install && npm run build
```

That writes `frontend/store/`, which **must be committed**. Render's free
Python runtime has no Node, so the build cannot happen there — shipping the
built output is what keeps this deployment free and simple. If the shop looks
out of date after a deploy, this is almost always why.

```bash
cd shopkit
git init
git add .
git commit -m "ShopKit"
git branch -M main
git remote add origin https://github.com/YOUR-NAME/shopkit.git
git push -u origin main
```

`.gitignore` already keeps `backend/.env` and `shop.db` out. **Check that
before you push** — `.env` holds your secret key.

---

## 2. Create the database (Neon)

1. Sign up at <https://neon.tech> — no card needed.
2. Create a project. Pick the region closest to your customers; **Singapore**
   or **Mumbai** if you are selling in India.
3. Copy the connection string. It looks like:

```
postgresql://user:password@ep-cool-name-123456.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
```

Keep that tab open. Nothing else to do — ShopKit creates its own tables on
first boot, and `postgres://` and `postgresql://` are both normalised to the
driver ShopKit uses, so paste the string exactly as Neon gives it to you.

---

## 3. Deploy the app (Render)

The repo has a `render.yaml`, so Render can set itself up:

1. Sign up at <https://render.com> with your GitHub account.
2. **New → Blueprint**, choose the repo. Render reads `render.yaml`.
3. It will ask for the values marked `sync: false`:

| Variable | What to put |
|---|---|
| `DATABASE_URL` | the Neon string from step 2 |
| `ADMIN_EMAIL` | your email — this becomes the owner account |
| `ADMIN_PASSWORD` | a real password, not `admin12345` |
| `CORS_ORIGINS` | leave blank for now; fill in after step 4 |

`SECRET_KEY` is generated for you. **Never change it afterwards** — it
encrypts your saved payment keys and SMTP password, and rotating it makes them
unreadable. It also signs login tokens, so changing it signs everyone out.

4. Deploy. First build takes three or four minutes.

You now have `https://your-shop.onrender.com`. The shop is at `/`, the
dashboard at `/admin`, the API reference at `/docs`.

### Putting the shop on Vercel instead

Optional. FastAPI can serve the shop perfectly well, and one host is one fewer
thing to go wrong. Vercel buys you a CDN in front of the shop and a shop that
stays up while the API is asleep — worth it if the free instance's cold start
bothers you.

The pieces:

| Lives on | What |
|---|---|
| **Render** | the API, the admin panel, `/docs`, uploaded photos |
| **Vercel** | the React storefront only |
| **Neon** | the database |

1. Vercel → New Project → your repo → **Root directory: `storefront`**.
   `storefront/vercel.json` sets the build; nothing else to configure.
2. Add an environment variable **`VITE_API_BASE`** = your Render URL, e.g.
   `https://your-shop.onrender.com`. No trailing slash. It is baked in at build
   time, so changing it needs a redeploy.
3. On Render, set **`CORS_ORIGINS`** to your Vercel URL,
   e.g. `https://your-shop.vercel.app`.

Two things this needed that are easy to miss, and both are handled:

- **Asset paths differ by host.** Served by FastAPI the assets live at
  `/store/`; on Vercel the shop is the site root, so they live at `/`. Build
  with the wrong one and the page loads with every asset 404ing. `vercel.json`
  sets `VITE_BASE=/` and builds to `dist`; the default build still targets
  `frontend/store`.
- **Uploaded photos are stored as `/media/…`**, relative to the API. On Vercel
  that would resolve against Vercel and 404, so the shop rewrites them against
  `VITE_API_BASE`. Photos on Cloudinary or S3 are absolute and left alone.

Sign-in works across the two hosts because the token is a bearer header in
`localStorage`, not a cookie — there is no third-party cookie problem to hit.

The admin panel stays on Render. It could be static-hosted too, but it is
low-traffic and keeping it next to the API is one less thing to configure.

### Prefer a different host?

The `Dockerfile` works anywhere that runs containers — Fly.io, Koyeb, Railway,
or your own VPS. Same environment variables. Render's Python runtime does not
need it; `render.yaml` covers that path.

---

## 4. Finish the setup

In the dashboard, in this order:

1. **Storefront** — name, contact details, currency, delivery charge, tax.
   Set **Public web address** to your live URL; emails use it for links.
2. **Payments** — cash on delivery works immediately. For Razorpay or Stripe,
   paste your keys and copy the webhook address shown on the card into their
   dashboard.
3. **System email** — see [step 5](#5-email).
4. **Products** — add yours.

Then go back to Render → Environment and set `CORS_ORIGINS` to your live
address, e.g. `https://your-shop.onrender.com`. Leaving it as `*` works, but
tightening it costs nothing.

---

## 5. Email

Free hosts block outgoing SMTP ports, and mail sent from a shared host lands in
spam anyway. Use a sending service — all of these have a free tier big enough
for a small shop:

| Service | Free allowance | Notes |
|---|---|---|
| **Brevo** | 300 emails/day | easiest to start, no domain needed at first |
| **Resend** | 3,000/month | needs a domain you control |
| **Mailgun** | limited trial then paid | |
| **Gmail SMTP** | ~500/day | needs an App Password, and 2FA on the account |

Put the SMTP host, port, username and password into **Admin → System email**,
tick *Send email*, and use **Send a test**. It sends in the foreground and
hands back the real error, so you are not guessing.

Sender addresses must be one the service lets you send as. That is the usual
cause of a rejected test.

---

## 6. Your own domain

**Freenom is gone** — it stopped handing out free `.tk`/`.ml` domains in 2024.
Guides still recommending it are out of date. There is no reputable source of a
free, real, top-level domain any more.

Three honest options:

**Free:** use the `onrender.com` subdomain. It has HTTPS and works properly.
The only cost is that it looks like a hosted app rather than a business.

**Nearly free:** a `.xyz`, `.store` or `.online` is often $1–3 for the first
year at Namecheap, Porkbun or Cloudflare Registrar. Compare on
<https://tld-list.com>. **Check the renewal price, not the first-year price** —
that is where these get you; a $1 domain can renew at $15.

**Free subdomain that looks like a developer:** services like `is-a.dev` give
out subdomains such as `yourshop.is-a.dev` via a pull request. Fine for a
portfolio, wrong for a shop that takes money.

To connect a domain you bought: Render → Settings → Custom Domain, add it, and
create the CNAME record Render shows you at your registrar. HTTPS is issued
automatically within a few minutes. Then update `CORS_ORIGINS` and the
**Public web address** setting to the new domain.

---

## What free actually costs you

Four specific things, in the order they will bother you.

### The shop sleeps

A free Render service **spins down after 15 minutes with no traffic**, and the
next visitor waits **30–60 seconds** for it to wake. A customer who clicks your
link and sees a blank tab for a minute usually leaves.

Render gives 750 instance hours a month and a month is about 730, so a service
that never sleeps just fits — but pinging yourself to stay awake is working
against the free tier rather than with it. If people are genuinely visiting,
that is the point to pay for the smallest paid instance.

### The database sleeps too

Neon suspends compute after about five minutes idle. The first query then takes
a second or two. ShopKit already handles the dropped connection that comes with
it (`pool_pre_ping` and `pool_recycle` in `database.py`), so it reconnects
rather than erroring — but the first page load after a quiet spell is slow.

### Storage is small

Neon's free tier is 0.5 GB. For a small catalogue that is thousands of orders,
not dozens — you will not hit it soon. Exceeding it suspends compute; it does
not delete your data.

### Backups are on you

No free tier promises real backups. Do this monthly, or before any change you
are unsure about:

```bash
pg_dump "postgresql://...your neon url..." > shopkit-backup-$(date +%F).sql
```

Keep it somewhere that is not the same account.

---

## The one real gap: product photos

**Uploaded photos do not survive on a free host.** Render's free tier has no
persistent disk: the filesystem is rebuilt on every deploy and every wake-up,
so anything in `backend/media/` disappears. Products keep their records; the
images 404.

This is the one thing that will actually catch you out, so pick a fix now:

**Simplest, free, no code.** Host the images somewhere else and paste the links
into the product form — it already accepts a URL as well as an upload.
Cloudinary and ImageKit both have free tiers and give you a permanent link.

**Proper, free, a little code.** Point uploads at object storage — Cloudflare
R2 (10 GB free) or Supabase Storage (1 GB free). Only one function needs to
change: `upload_image` in `backend/app/routers/admin.py`. It writes a file and
returns `{"url": ...}`; make it upload to a bucket and return that URL instead.
Nothing else in the app cares where the string points.

**Paid, no code.** Render's smallest paid instance can mount a persistent disk
at `backend/media/` and everything works as it does locally.

---

## Before you take real money

- [ ] `ADMIN_PASSWORD` changed from anything that was ever in a file
- [ ] `SECRET_KEY` set once and untouched since
- [ ] `SEED_DEMO_DATA=false` — no demo catalogue on a live shop
- [ ] `CORS_ORIGINS` set to your real address
- [ ] Gateway keys entered, **test mode off**, webhooks registered
- [ ] A test order placed end to end, and the confirmation email received
- [ ] Photos on storage that survives a redeploy
- [ ] A database backup taken, and a reminder set to take more
- [ ] Someone other than you has tried to buy something

---

## When free stops being enough

The order to spend money in, and roughly why:

1. **A paid web instance (~$7/month).** Buys you no cold starts. This is the
   first thing customers notice, so it is the first thing worth paying for.
2. **A paid database (~$5–19/month).** Buys backups and no idle suspend. Worth
   it once losing the data would actually hurt.
3. **A domain (~$10–15/year).** Buys credibility. Cheap, and you can do it at
   any point.
4. **Object storage (a few pence).** Only if you outgrow the free tiers above.

Under about $15 a month covers a small shop with no cold starts, real backups
and its own domain.

---

## If something breaks

| What you see | Usually |
|---|---|
| Deploy fails on `pip install` | Python version. `PYTHON_VERSION` is pinned in `render.yaml`. |
| First deploy dies, second works | Was a real bug: workers raced to create the schema. Fixed in `migrate.prepare_database`. If you see it, you are on an old copy. |
| Shop shows old content after deploy | `frontend/store/` was not rebuilt and committed. Run `npm run build` in `storefront/`. |
| Shop says "has not been built yet" | `frontend/store/` is missing from the repo. Same fix. |
| App boots then 500s on every page | `DATABASE_URL` wrong or missing. Check Render → Logs. |
| `SSL connection has been closed unexpectedly` | Neon suspended and reconnected. Harmless once; constant means a networking problem. |
| Saved payment keys read as blank | `SECRET_KEY` changed. Re-enter the keys under Payments. |
| Photos 404 after a deploy | The ephemeral disk. See [the one real gap](#the-one-real-gap-product-photos). |
| First visit takes a minute | The free instance was asleep. Expected. |
| Emails not arriving | Use **Send a test** in the dashboard — it returns the real SMTP error. |
| Dashboard loads but the shop looks unstyled | Google Fonts blocked or unreachable. The shop still works; fonts fall back. |
