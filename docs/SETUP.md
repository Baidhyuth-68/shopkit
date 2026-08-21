> **Storefront changes need Node.** Running ShopKit needs only Python — the
> React storefront ships pre-built in `frontend/store`. To change it, see
> "Working on the storefront" in the README, or `docs/CODE_MAP.md`.

# Setup and deployment

Three sections: get it running locally, move the database online, put the whole
thing on the internet.

---

## 1. Run it locally

You need Python 3.10 or newer. Nothing else — no Node, no build step.

```bash
cd shopkit/backend

python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate

pip install -r requirements.txt

cp .env.example .env               # Windows: copy .env.example .env
```

Open `.env` and change two things before you go further:

```ini
SECRET_KEY=<paste a long random string>
ADMIN_PASSWORD=<your own password>
```

Generate a secret key with:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Then start the server:

```bash
uvicorn app.main:app --reload
```

| What | Where |
|---|---|
| Storefront | http://127.0.0.1:8000/ |
| Admin panel | http://127.0.0.1:8000/admin |
| Interactive API docs | http://127.0.0.1:8000/docs |

On the first run the server creates the tables, your admin account, and a demo
catalogue of eight products with some order history so the dashboard is not an
empty page.

**Sign in to the admin panel** with the `ADMIN_EMAIL` and `ADMIN_PASSWORD` from
your `.env`. The demo customer is `asha@example.org` / `customer123`.

### Clearing the demo data

Once you are ready to add your own products:

```ini
SEED_DEMO_DATA=false
```

Then delete `backend/shop.db` and restart. You get a clean shop with just your
admin account. (Deleting the file only works for SQLite — for Postgres, drop
the demo rows from the admin panel instead.)

---

## 2. Move the database online

SQLite is a single file on your laptop. It is perfect while you build, and
wrong the moment you deploy — most hosts wipe the filesystem on every restart.

Any hosted Postgres works. Free tiers that take about five minutes to set up:

| Provider | Notes |
|---|---|
| [Neon](https://neon.tech) | Serverless Postgres, generous free tier, sleeps when idle |
| [Supabase](https://supabase.com) | Postgres plus a dashboard for browsing rows |
| [Railway](https://railway.app) | Postgres alongside your app in the same project |

The steps are the same for all three:

**a. Create a database** and copy the connection string it gives you. It looks
like `postgresql://user:password@host/dbname`.

**b. Install the Postgres driver.** Open `backend/requirements.txt`, uncomment
the last line, and reinstall:

```bash
pip install -r requirements.txt
```

**c. Point `.env` at it:**

```ini
DATABASE_URL=postgresql+psycopg://user:password@ep-xxx.neon.tech/shop?sslmode=require
```

If your provider hands you a URL starting with `postgres://` or
`postgresql://`, paste it as-is — `backend/app/config.py` rewrites the prefix
for you.

**d. Restart.** The tables are created automatically on startup. Your admin
account is created again from `.env`.

Nothing else in the code changes. That is the whole point of keeping the
database URL in one place.

### A note on schema changes

`Base.metadata.create_all()` creates tables that do not exist. It does **not**
alter tables that already exist. So if you add a column to `models.py` later:

- **SQLite in development** — delete `shop.db` and restart. Fastest option.
- **A live database with real orders in it** — add [Alembic](https://alembic.sqlalchemy.org):

```bash
pip install alembic
alembic init migrations
# point sqlalchemy.url at your DATABASE_URL in alembic.ini
alembic revision --autogenerate -m "add weight column to products"
alembic upgrade head
```

Do this before you have customers, not after.

### Backups

Whichever provider you pick, turn on automatic backups on day one. For SQLite,
a backup is `cp shop.db shop-backup.db` — put it in a cron job.

---

## 3. Put it on the internet

The server serves the API *and* both frontends, so you deploy one thing.

### The short version

```bash
# On the server
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
```

Set these environment variables in your host's dashboard rather than shipping
a `.env` file:

```ini
DATABASE_URL=postgresql+psycopg://…
SECRET_KEY=<long random string>
ADMIN_EMAIL=you@yourdomain.com
ADMIN_PASSWORD=<strong password>
SEED_DEMO_DATA=false
CORS_ORIGINS=https://yourdomain.com
```

### Render, Railway or Fly.io

These read your repo and run a command. Use:

- **Build command:** `pip install -r backend/requirements.txt`
- **Start command:** `cd backend && uvicorn app.main:app --host 0.0.0.0 --port $PORT`

Add the environment variables above in their dashboard. Point your domain at
the service and you are live.

### Docker

Create `shopkit/Dockerfile`:

```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
WORKDIR /app/backend
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

```bash
docker build -t shopkit .
docker run -p 8000:8000 --env-file backend/.env shopkit
```

### Behind Nginx

If you terminate TLS yourself:

```nginx
server {
  server_name yourdomain.com;
  client_max_body_size 10M;          # so image uploads are not rejected

  location / {
    proxy_pass http://127.0.0.1:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

---

## Before you take real money

Work down this list. None of it is optional.

- [ ] **`SECRET_KEY` is long, random and secret.** Anyone with it can forge an
      admin token. Never commit it.
- [ ] **`.env` is in `.gitignore`.** It already is in the included file.
- [ ] **The default admin password is changed.** `admin12345` is in this repo
      and therefore public.
- [ ] **HTTPS is on.** Tokens travel in a header; without TLS they are readable
      in transit.
- [ ] **`SEED_DEMO_DATA=false`** so demo products never appear in your shop.
- [ ] **`CORS_ORIGINS` names your domain**, not `*`.
- [ ] **The database is Postgres, with backups on.**
- [ ] **Uploaded images go somewhere permanent.** `backend/media/` is fine on a
      normal VPS and disappears on ephemeral hosts — see "Storing images
      somewhere permanent" in `CODE_MAP.md`.
- [ ] **Payments are actually wired up.** Out of the box, orders are recorded
      with a payment *method*, not a payment. See "Taking real payments" in
      `CODE_MAP.md`.
- [ ] **Order emails are sent.** Nothing is emailed yet — see "Sending emails".
- [ ] **Rate limiting on `/api/auth/login`**, so nobody can grind passwords:
      [slowapi](https://github.com/laurentS/slowapi) is a ten-line addition.

---

## Troubleshooting

**"Cannot reach the server" on the storefront**
The page loaded but the API did not answer. Check the terminal running
uvicorn — it usually printed the real error.

**`ModuleNotFoundError: No module named 'app'`**
You are in the wrong folder. `uvicorn app.main:app` must be run from inside
`backend/`.

**Admin panel bounces back to the sign-in screen**
Your token expired, or the account is not an admin. Sign in again; if it keeps
happening, check the account's role under Customers.

**Uploads return 413**
The image is over `MAX_UPLOAD_MB`. Raise it in `.env`, and raise
`client_max_body_size` in Nginx too if you use it.

**Emails with a `.test` or `.local` domain are rejected**
The validator refuses reserved domains. Use a real one — even `example.org`
works for testing.

**Colours changed in the admin panel but the shop looks the same**
Hard-reload the storefront tab (Ctrl/Cmd + Shift + R). Settings are read once
when the page loads.
