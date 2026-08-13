import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

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
app.get('/api/health', (req, res) => {
  const creds = getCredentials();
  const missing = [];
  if (!creds.consumerKey) missing.push('CT_CONSUMER_KEY');
  if (!creds.consumerSecret) missing.push('CT_CONSUMER_SECRET');
  if (!creds.tokenId) missing.push('CT_TOKEN_ID');
  if (!creds.tokenSecret) missing.push('CT_TOKEN_SECRET');
  if (!creds.customerId) missing.push('CT_CUSTOMER_ID');
  if (!creds.customerToken) missing.push('CT_CUSTOMER_TOKEN');

  res.json({
    status: missing.length === 0 ? 'ok' : 'missing_credentials',
    missing,
    environment: creds.environment,
    accountId: getAccountConfig(creds.environment).accountId,
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
const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
