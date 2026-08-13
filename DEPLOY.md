# Deploying QuickRev Tire Quotes (Render)

QuickRev is a single Node.js process: the Express server (port `3001`) serves
**both** the built frontend and the Canada Tire API proxy. One Docker image, one
port — no separate static hosting needed. This guide deploys it to **Render**
(free tier is enough for a single-user internal tool).

## What you'll need

1. A **GitHub account** (free) — Render pulls the code from there.
2. A **Render account** (free) — sign up at https://render.com with GitHub.
3. Your Canada Tire credentials — the same `CT_*` values as your local `.env`
   (`CT_CONSUMER_KEY`, `CT_CONSUMER_SECRET`, `CT_TOKEN_ID`, `CT_TOKEN_SECRET`,
   `CT_CUSTOMER_ID`, `CT_CUSTOMER_TOKEN`).

---

## Step 1 — Put the code on GitHub

Open a terminal in the project folder (`...\quickrev-tire-quotes (10)`) and run:

```bash
# 1. Create a repo on github.com first (New repository, keep it Private),
#    then connect this folder to it:
git init
git add .
git commit -m "QuickRev tire quotes app"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/quickrev-tire-quotes.git
git push -u origin main
```

> **Security:** make sure `.env` is in `.gitignore` so your credentials are NOT
> uploaded. The repo contains no secrets; they live only in Render's dashboard.

## Step 2 — Create the service on Render

1. Go to https://dashboard.render.com and click **New + → Blueprint**.
   (Blueprint reads the included `render.yaml` and pre-creates the service,
   port, and health check for you.)
2. Pick your **quickrev-tire-quotes** repository.
3. Render detects `render.yaml` — click **Apply**.
4. If you prefer the manual route instead: **New + → Web Service**, pick the
   repo, and Render auto-detects the `Dockerfile`. Either path works.

## Step 3 — Add your Canada Tire credentials

1. In the Render dashboard, open the **quickrev** service.
2. Go to the **Environment** tab and fill in the six secrets:

   | Key                  | Value                                  |
   | -------------------- | -------------------------------------- |
   | `CT_CONSUMER_KEY`    | from your `.env`                       |
   | `CT_CONSUMER_SECRET` | from your `.env`                       |
   | `CT_TOKEN_ID`        | from your `.env`                       |
   | `CT_TOKEN_SECRET`    | from your `.env`                       |
   | `CT_CUSTOMER_ID`     | from your `.env` (e.g. `20446`)        |
   | `CT_CUSTOMER_TOKEN`  | from your `.env`                       |

   (`CT_ENVIRONMENT`, `CT_ACCOUNT_ID`, and `PORT` are already set by the
   blueprint — leave them as-is.)

3. Click **Save Changes**, then **Manual Deploy → Deploy latest commit**.

## Step 4 — Verify it's live

1. Wait for the deploy to finish (first build takes a few minutes).
2. Open the URL Render gives you — something like
   `https://quickrev.onrender.com`. You should see the QuickRev search page.
3. Click the **Sync** button at the top of the page. It syncs all Canada Tire
   warehouses and shows live progress (e.g. `4/6`). If Canada Tire throttles a
   request, the server retries automatically with backoff — just let it run.
4. Check the health endpoint works: `https://quickrev.onrender.com/api/health`
   should return `{"status":"ok",...}`.

## Step 5 — Optional polish

- **Custom domain:** Render → your service → **Settings → Custom Domain**.
- **Always-on:** the free plan sleeps after ~15 min of inactivity and takes
  ~30–60 s to wake on the next visit. If that bothers you, upgrade to the
  **Starter** plan ($7/month) for an always-on instance. For occasional use,
  the free plan is fine.
- **Redeploy after code changes:** push to GitHub, then Render auto-deploys
  (or click **Manual Deploy**).

---

## Local production check (same as what runs on Render)

```bash
npm run build
npm start        # serves app + API on http://localhost:3001
```

## Docker (alternative hosts: Railway, Fly.io, any VPS)

```bash
docker build -t quickrev .
docker run -p 3001:3001 --env-file .env quickrev
```

## Notes

- The proxy calls NetSuite RESTlets with OAuth 1.0 HMAC-SHA256 and retries
  throttled requests (Canada Tire intermittently rejects bursts with
  `INVALID_LOGIN_ATTEMPT`, then recovers).
- Inventory refreshes are **manual**: use the **Sync** button at the top of any
  page, or the Sync Now / Sync All Warehouses buttons on the Import tab. There
  is no background auto-sync.
- All data (tires, prices, sale dates) is stored in the browser's localStorage,
  so it lives on the device you use — syncing updates the Canada Tire stock on
  that device.
