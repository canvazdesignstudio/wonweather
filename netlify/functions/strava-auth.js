/*
  netlify/functions/strava-auth.js

  Handles Strava OAuth code exchange.
  - Saves the athlete's refresh token so we can write to their activities
  - Registers a Strava webhook subscription (once) so we're notified of new activities
  - Returns the public profile to the client

  Environment variables (set in Netlify dashboard):
    STRAVA_CLIENT_ID       — Strava app Client ID
    STRAVA_CLIENT_SECRET   — Strava app Client Secret
    STRAVA_WEBHOOK_SECRET  — any random string you choose, e.g. "won_webhook_2024"
    SITE_URL               — your live Netlify URL, e.g. https://won.netlify.app
*/

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const WAITLIST_FILE = path.join('/tmp', 'waitlist.json');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let code;
  try {
    ({ code } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, body: 'Bad Request' };
  }

  if (!code) return { statusCode: 400, body: 'Missing code' };

  // 1. Exchange code for tokens
  let tokenData;
  try {
    tokenData = await stravaPost('/oauth/token', {
      client_id:     process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
    });
  } catch (err) {
    console.error('Token exchange failed:', err);
    return { statusCode: 502, body: 'Strava auth failed' };
  }

  const { athlete, access_token, refresh_token, expires_at } = tokenData;

  // 2. Save athlete + tokens to waitlist
  await saveToWaitlist({
    stravaId:      athlete.id,
    firstname:     athlete.firstname,
    lastname:      athlete.lastname,
    profile:       athlete.profile_medium,
    city:          athlete.city,
    country:       athlete.country,
    accessToken:   access_token,
    refreshToken:  refresh_token,
    expiresAt:     expires_at,
    joinedAt:      new Date().toISOString(),
  });

  // 3. Register webhook subscription (idempotent)
  await ensureWebhookSubscription();

  // 4. Return public profile to client
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id:             athlete.id,
      firstname:      athlete.firstname,
      lastname:       athlete.lastname,
      profile:        athlete.profile,
      profile_medium: athlete.profile_medium,
      city:           athlete.city,
      country:        athlete.country,
    }),
  };
};

async function ensureWebhookSubscription() {
  const callbackUrl = `${process.env.SITE_URL}/.netlify/functions/strava-webhook`;
  try {
    await stravaPost('/push_subscriptions', {
      client_id:     process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      callback_url:  callbackUrl,
      verify_token:  process.env.STRAVA_WEBHOOK_SECRET,
    });
    console.log('Webhook subscription registered:', callbackUrl);
  } catch (err) {
    // 422 = subscription already exists, that's fine
    if (!err.message.includes('422')) {
      console.warn('Webhook registration warning:', err.message);
    }
  }
}

async function saveToWaitlist(entry) {
  let list = [];
  try {
    list = JSON.parse(fs.readFileSync(WAITLIST_FILE, 'utf8'));
  } catch { /* first entry */ }

  const idx = list.findIndex(e => e.stravaId === entry.stravaId);
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...entry };
  } else {
    list.push(entry);
    console.log(`New waitlist entry: ${entry.firstname} ${entry.lastname} (${entry.stravaId})`);
  }
  fs.writeFileSync(WAITLIST_FILE, JSON.stringify(list, null, 2));
}

function stravaPost(apiPath, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    // oauth/token uses a different base path
    const isOAuth = apiPath === '/oauth/token';
    const req = https.request(
      {
        hostname: 'www.strava.com',
        path:     isOAuth ? apiPath : `/api/v3${apiPath}`,
        method:   'POST',
        headers:  {
          'Content-Type':   'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          if (res.statusCode >= 400) {
            return reject(new Error(`Strava ${res.statusCode}: ${data}`));
          }
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(e); }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}
