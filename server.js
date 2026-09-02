import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pg from 'pg';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Prefer the platform-standard PORT (Render/Railway/Fly inject this);
// PROXY_PORT remains for local setups that used it.
const PORT = process.env.PORT || process.env.PROXY_PORT || 3001;

const CT_CONFIG = {
  sandbox: {
    baseUrl: 'https://8031691-sb1.restlets.api.netsuite.com/app/site/hosting/restlet.nl',
    realm: '8031691_SB1',
  },
  production: {
    baseUrl: 'https://8031691.restlets.api.netsuite.com/app/site/hosting/restlet.nl',
    realm: '8031691',
  },
};

function getCredentials() {
  return {
    consumerKey: process.env.CT_CONSUMER_KEY || '',
    consumerSecret: process.env.CT_CONSUMER_SECRET || '',
    tokenId: process.env.CT_TOKEN_ID || '',
    tokenSecret: process.env.CT_TOKEN_SECRET || '',
    customerId: process.env.CT_CUSTOMER_ID || '',
    customerToken: process.env.CT_CUSTOMER_TOKEN || '',
    environment: process.env.CT_ENVIRONMENT || 'production',
  };
}

/**
 * Resolve the NetSuite account/endpoint for the configured environment.
 * The account ID is read from CT_ACCOUNT_ID (defaults to 8031691) so it can be
 * corrected without editing code.
 */
function getAccountConfig(environment) {
  const accountId = (process.env.CT_ACCOUNT_ID || '8031691').trim();
  const isSandbox = environment === 'sandbox';
  const baseUrl = `https://${accountId}${isSandbox ? '-sb1' : ''}.restlets.api.netsuite.com/app/site/hosting/restlet.nl`;
  const realm = isSandbox ? `${accountId}_SB1` : accountId;
  return { baseUrl, realm, accountId };
}

// === CLOUD SYNC — SHARED DATA ACROSS DEVICES ================================
// What lives where:
//   - Canada Tire's synced catalog stays in each browser (it is reproducible
//     with the Sync button), so it is never uploaded.
//   - Everything the user creates or edits — manual tires (Star Tires,
//     Convenient, CSV imports, added tires), price/sale overrides on synced
//     tires, deleted-tire tombstones, and the warehouse list — is stored here
//     and shared with every device.
//
// Storage backend: Postgres when DATABASE_URL is set (required on Render's
// free tier, whose filesystem is ephemeral and wiped on every restart or
// redeploy). A local JSON file is used only as a development fallback.
const store = (() => {
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    const pool = new pg.Pool({
      connectionString: dbUrl,
      connectionTimeoutMillis: 10000,
      ssl: /localhost|127\.0\.0\.1/.test(dbUrl) ? false : { rejectUnauthorized: false },
    });
    pool.query(`CREATE TABLE IF NOT EXISTS sync_state (
      id integer PRIMARY KEY,
      data jsonb NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`).catch(err => console.error('sync_state table init failed:', err.message));
    return {
      kind: 'postgres',
      async read() {
        const r = await pool.query('SELECT data FROM sync_state WHERE id = 1');
        return r.rows[0]?.data || null;
      },
      async write(data) {
        await pool.query(
          `INSERT INTO sync_state (id, data, updated_at) VALUES (1, $1, now())
           ON CONFLICT (id) DO UPDATE SET data = $1, updated_at = now()`,
          [JSON.stringify(data)]
        );
      },
      async ping() { await pool.query('SELECT 1'); return true; },
    };
  }
  const file = path.join(__dirname, 'sync-state.json');
  return {
    kind: 'file',
    async read() {
      try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
    },
    async write(data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); },
    async ping() { return true; },
  };
})();

// Light guard for the sync endpoints. Defaults make local dev zero-config;
// set APP_SYNC_KEY in production to a random string to lock them down.
const SYNC_KEY = process.env.APP_SYNC_KEY || 'quickrev-app';

function requireSyncKey(req, res, next) {
  if ((req.get('x-sync-key') || '') !== SYNC_KEY) {
    return res.status(401).json({ success: false, error: 'Invalid sync key.' });
  }
  next();
}

const EMPTY_SYNC = { manualTires: [], overrides: {}, deletedKeys: [], warehouseLocations: [], customDistributors: [] };

// Pull the shared data (the app calls this on load).
app.get('/api/sync-data', requireSyncKey, async (req, res) => {
  try {
    const data = await store.read();
    res.json({ success: true, data: data || EMPTY_SYNC, storage: store.kind });
  } catch (err) {
    console.error('sync-data read failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Push the shared data (the app calls this after every local change,
// debounced). The server reconciles deletions: a tombstone key is kept only
// while the key is absent from the incoming manual tires, so a tire that is
// re-added stops being filtered out on every device.
app.put('/api/sync-data', requireSyncKey, async (req, res) => {
  const body = req.body || {};
  const manualTires = Array.isArray(body.manualTires) ? body.manualTires : [];
  const overrides = body.overrides && typeof body.overrides === 'object' ? body.overrides : {};
  const deletedKeys = Array.isArray(body.deletedKeys) ? body.deletedKeys : [];
  const warehouseLocations = Array.isArray(body.warehouseLocations) ? body.warehouseLocations : [];
  const customDistributors = Array.isArray(body.customDistributors) ? body.customDistributors : [];
  try {
    const prev = (await store.read()) || EMPTY_SYNC;

    // Merge manual tires by sync key (union, newest updatedAt wins) rather than
    // wholesale-replacing the stored list. A cold-starting client can upload an
    // empty catalog before its pulled data has landed; merging keeps everyone's
    // shared manual tires intact when that happens, so previously-added items
    // don't vanish from other devices / the online app.
    const byKey = new Map();
    for (const t of (Array.isArray(prev.manualTires) ? prev.manualTires : [])) {
      if (t && t.syncKey) byKey.set(t.syncKey, t);
    }
    for (const t of manualTires) {
      if (!t || !t.syncKey) continue;
      const ex = byKey.get(t.syncKey);
      if (!ex || (t.updatedAt || '') >= (ex.updatedAt || '')) byKey.set(t.syncKey, t);
    }

    // Tombstones mark tires deliberately deleted. A stored tombstone is kept
    // only while its key is still missing (re-adding a tire stops it being
    // filtered out on every device); an incoming tombstone removes the merged
    // tire so a deliberate delete stays gone.
    const prevDeleted = new Set(Array.isArray(prev.deletedKeys) ? prev.deletedKeys : []);
    const incomingKeys = new Set(manualTires.map(t => t && t.syncKey).filter(Boolean));
    for (const k of deletedKeys) if (k && !incomingKeys.has(k)) prevDeleted.add(k);
    for (const k of [...prevDeleted]) if (incomingKeys.has(k)) prevDeleted.delete(k);

    const mergedManual = [...byKey.values()].filter(t => !prevDeleted.has(t.syncKey));

    await store.write({
      manualTires: mergedManual,
      overrides,
      deletedKeys: [...prevDeleted].slice(-500),
      warehouseLocations,
      customDistributors,
    });
    res.json({ success: true, storage: store.kind });
  } catch (err) {
    console.error('sync-data write failed:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * Generate OAuth 1.0 signature for NetSuite TBA
 * Try WITHOUT realm in signature to see if error changes
 */
function generateOAuthAuth(method, baseUrl, script, deploy, creds) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomBytes(16).toString('hex');
  const env = getAccountConfig(creds.environment);

  const url = new URL(baseUrl);
  url.searchParams.set('script', script);
  url.searchParams.set('deploy', deploy);
  const fullUrl = url.toString();

  // Parameters WITHOUT realm in signature
  const allParams = {
    deploy: deploy,
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA256',
    oauth_timestamp: timestamp,
    oauth_token: creds.tokenId,
    oauth_version: '1.0',
    script: script,
  };

  const paramString = Object.keys(allParams)
    .sort()
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(allParams[key])}`)
    .join('&');

  const baseString = [
    method.toUpperCase(),
    encodeURIComponent(baseUrl),
    encodeURIComponent(paramString),
  ].join('&');

  const signingKey = `${encodeURIComponent(creds.consumerSecret)}&${encodeURIComponent(creds.tokenSecret)}`;
  const signature = crypto.createHmac('sha256', signingKey).update(baseString).digest('base64');

  console.log('=== OAuth Debug ===');
  console.log('Base URL (no query):', baseUrl);
  console.log('Full URL:', fullUrl);
  console.log('Base String:', baseString);
  console.log('Signing Key:', signingKey.substring(0, 20) + '...');
  console.log('Signature:', signature.substring(0, 30) + '...');

  const authParams = {
    realm: env.realm,
    oauth_consumer_key: creds.consumerKey,
    oauth_token: creds.tokenId,
    oauth_signature_method: 'HMAC-SHA256',
    oauth_timestamp: timestamp,
    oauth_nonce: nonce,
    oauth_version: '1.0',
    oauth_signature: signature,
  };

  const authHeader = 'OAuth ' + Object.entries(authParams)
    .map(([k, v]) => `${k}="${v}"`)
    .join(', ');

  return { fullUrl, authHeader };
}

// === HEALTH CHECK ===
app.get('/api/health', async (req, res) => {
  const creds = getCredentials();
  const missing = [];
  if (!creds.consumerKey) missing.push('CT_CONSUMER_KEY');
  if (!creds.consumerSecret) missing.push('CT_CONSUMER_SECRET');
  if (!creds.tokenId) missing.push('CT_TOKEN_ID');
  if (!creds.tokenSecret) missing.push('CT_TOKEN_SECRET');
  if (!creds.customerId) missing.push('CT_CUSTOMER_ID');
  if (!creds.customerToken) missing.push('CT_CUSTOMER_TOKEN');

  let storageOk = null;
  if (store.kind === 'postgres') {
    try {
      storageOk = await store.ping() === true;
    } catch {
      storageOk = false;
    }
  }

  res.json({
    status: missing.length === 0 ? 'ok' : 'missing_credentials',
    missing,
    environment: creds.environment,
    accountId: getAccountConfig(creds.environment).accountId,
    storage: store.kind,
    storageOk,
  });
});

// === TEST: Simple GET to check if API is reachable ===
app.get('/api/canada-tire/test', async (req, res) => {
  const creds = getCredentials();
  const env = getAccountConfig(creds.environment);

  // Try a simple GET request to the base URL to see if we get a different error
  try {
    const response = await fetch(env.baseUrl, { method: 'GET' });
    const text = await response.text();
    res.json({ status: response.status, body: text.substring(0, 200) });
  } catch (error) {
    res.json({ error: error.message });
  }
});

// === PRODUCT SEARCH ===
app.post('/api/canada-tire/search', async (req, res) => {
  const creds = getCredentials();

  if (!creds.consumerKey || !creds.consumerSecret || !creds.tokenId || !creds.tokenSecret) {
    return res.status(400).json({
      success: false,
      error: { code: 400, errorMsg: 'Canada Tire API credentials not configured. Check your .env file.' },
    });
  }

  const env = getAccountConfig(creds.environment);

  const { width, rimSize, aspectRatio, size, brand, isWinter, location, page } = req.body;

  console.log('=== Search Request ===');
  console.log('Filters:', { width, rimSize, aspectRatio, size, brand, isWinter, location, page });

  const requestBody = {
    customerId: creds.customerId,
    customerToken: creds.customerToken,
    filters: {
      ...(width !== undefined && { width: Number(width) }),
      ...(rimSize !== undefined && { rimSize: Number(rimSize) }),
      ...(aspectRatio !== undefined && { aspectRatio: Number(aspectRatio) }),
      ...(size && { size: size.replace(/\//g, '') }),
      ...(brand && { brand }),
      ...(isWinter !== undefined && { isWinter: Boolean(isWinter) }),
      ...(location && { location }),
      partNumber: [],
      searchKey: '',
      ...(page && { page: Number(page) }),
    },
  };

  console.log('Request Body:', JSON.stringify(requestBody, null, 2));

  try {
    // Canada Tire's gateway intermittently rejects bursts of requests with
    // 403 INVALID_LOGIN_ATTEMPT / 429 / 5xx, then recovers after tens of
    // seconds of quiet. Retry with a growing cool-down so a throttled sync
    // self-heals instead of erroring. Each attempt uses a FRESH OAuth
    // signature — the nonce/timestamp must be unique per request.
    const MAX_ATTEMPTS = 4;
    const BACKOFF_MS = [10000, 30000, 60000]; // waits before attempts 2, 3, 4
    let response;
    let attempt = 0;
    while (attempt < MAX_ATTEMPTS) {
      const { fullUrl, authHeader } = generateOAuthAuth(
        'POST',
        env.baseUrl,
        'customscript_item_search_rl',
        'customdeploy_item_search_rl',
        creds
      );
      console.log('Auth Header (first 150 chars):', authHeader.substring(0, 150) + '...');

      response = await fetch(fullUrl, {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      console.log(`Response Status (attempt ${attempt + 1}):`, response.status);

      const transient = response.status === 403 || response.status === 429 || response.status >= 500;
      if (!transient) break;

      attempt++;
      if (attempt >= MAX_ATTEMPTS) break;
      const delay = BACKOFF_MS[attempt - 1] || 60000;
      console.log(`Canada Tire gateway throttling (HTTP ${response.status}) — retrying in ${delay / 1000}s`);
      await new Promise(r => setTimeout(r, delay));
    }

    const responseText = await response.text();
    console.log('Response Body:', responseText.substring(0, 500));

    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      data = {};
    }

    // Forward NetSuite's HTTP status and a readable error message
    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: {
          code: data?.error?.code || response.status,
          message: data?.error?.message || data?.error?.errorMsg || responseText.substring(0, 300),
        },
      });
    }

    res.json(data);
  } catch (error) {
    console.error('Fetch Error:', error.message);
    res.status(500).json({
      success: false,
      error: { code: 500, errorMsg: error.message },
    });
  }
});

// === WAREHOUSE LOCATIONS ===
// Runs one broad catalog search and returns the distinct warehouse/location
// names found in inventory, so the app can offer a warehouse dropdown.
app.get('/api/canada-tire/locations', async (req, res) => {
  const creds = getCredentials();
  const env = getAccountConfig(creds.environment);

  const requestBody = {
    customerId: creds.customerId,
    customerToken: creds.customerToken,
    filters: { partNumber: [], searchKey: '' },
  };

  try {
    const { fullUrl, authHeader } = generateOAuthAuth(
      'POST',
      env.baseUrl,
      'customscript_item_search_rl',
      'customdeploy_item_search_rl',
      creds
    );
    const response = await fetch(fullUrl, {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: { code: data?.error?.code || response.status, message: data?.error?.message || data?.error?.errorMsg },
      });
    }

    const locations = [...new Set(
      (data.data || [])
        .flatMap(item => (item.inventory || []).map(loc => loc.location))
        .filter(Boolean)
    )].sort();

    res.json({ success: true, locations });
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 500, errorMsg: error.message } });
  }
});

// === USER SHIP-TO SEARCH ===
app.post('/api/canada-tire/shipto', async (req, res) => {
  const creds = getCredentials();
  const env = getAccountConfig(creds.environment);

  const requestBody = {
    customerId: creds.customerId,
    customerToken: creds.customerToken,
  };

  const { fullUrl, authHeader } = generateOAuthAuth(
    'POST',
    env.baseUrl,
    'customscript_get_cust_addr_rl',
    'customdeploy_get_cust_addr_rl',
    creds
  );

  try {
    const response = await fetch(fullUrl, {
      method: 'POST',
      headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ success: false, error: { code: 500, errorMsg: error.message } });
  }
});

// === STATIC PRODUCTION BUILD ===
// Serve the built app (npm run build) from the same port as the API proxy, so
// the whole application runs from one process/server in production.
const distDir = path.join(__dirname, 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  // SPA fallback: non-API routes serve index.html (client-side routing)
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(distDir, 'index.html')));
  console.log(`Serving production build from ${distDir}`);
} else {
  console.log('No dist/ folder found — run `npm run build` to serve the production app.');
}

app.listen(PORT, () => {
  console.log(`Canada Tire API Proxy running on http://localhost:${PORT}`);
  console.log(`Environment: ${getCredentials().environment}`);
});
