/*
  netlify/functions/strava-webhook.js

  Two responsibilities:
  
  1. GET — Strava webhook verification handshake.
     When you register the webhook, Strava sends a GET with a challenge.
     We echo it back to confirm ownership.

  2. POST — Strava activity event.
     When a waitlisted athlete creates a new activity, Strava POSTs here.
     We refresh their token if needed, then prepend the WON mention
     to their activity description.

  Environment variables:
    STRAVA_CLIENT_ID       — Strava app Client ID
    STRAVA_CLIENT_SECRET   — Strava app Client Secret
    STRAVA_WEBHOOK_SECRET  — same string used during webhook registration
*/

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const WAITLIST_FILE  = path.join('/tmp', 'waitlist.json');
const WON_TAG        = 'I found the best time to run using www.weatherornot.app 🏃';

exports.handler = async (event) => {

  // ── GET: Strava webhook verification ──────────────────────
  if (event.httpMethod === 'GET') {
    const q = event.queryStringParameters || {};
    if (
      q['hub.mode'] === 'subscribe' &&
      q['hub.verify_token'] === process.env.STRAVA_WEBHOOK_SECRET
    ) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 'hub.challenge': q['hub.challenge'] }),
      };
    }
    return { statusCode: 403, body: 'Forbidden' };
  }

  // ── POST: Activity event ───────────────────────────────────
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Bad Request' };
  }

  // Only care about new activity creates
  if (payload.object_type !== 'activity' || payload.aspect_type !== 'create') {
    return { statusCode: 200, body: 'OK' }; // acknowledge silently
  }

  const athleteId  = payload.owner_id;
  const activityId = payload.object_id;

  // Look up athlete in waitlist
  const athlete = findAthlete(athleteId);
  if (!athlete) {
    console.log(`Athlete ${athleteId} not on waitlist — skipping`);
    return { statusCode: 200, body: 'OK' };
  }

  try {
    // Refresh token if expired
    const token = await getValidToken(athlete);

    // Fetch current activity description (so we prepend, not overwrite)
    const activity = await stravaGet(`/activities/${activityId}`, token);
    const existing  = activity.description || '';
    const newDesc   = existing
      ? `${WON_TAG}\n\n${existing}` // prepend above existing text
      : WON_TAG;

    // Update activity description
    await stravaPut(`/activities/${activityId}`, token, { description: newDesc });
    console.log(`Tagged activity ${activityId} for athlete ${athleteId}`);
  } catch (err) {
    console.error(`Failed to tag activity ${activityId}:`, err.message);
    // Return 200 anyway — Strava will retry on non-200, causing spam
  }

  return { statusCode: 200, body: 'OK' };
};

// ── Find athlete in local waitlist ───────────────────────────────────────────
function findAthlete(stravaId) {
  try {
    const list = JSON.parse(fs.readFileSync(WAITLIST_FILE, 'utf8'));
    return list.find(a => a.stravaId === stravaId) || null;
  } catch {
    return null;
  }
}

// ── Save updated token back to waitlist ──────────────────────────────────────
function updateAthleteToken(stravaId, accessToken, expiresAt) {
  try {
    const list = JSON.parse(fs.readFileSync(WAITLIST_FILE, 'utf8'));
    const idx  = list.findIndex(a => a.stravaId === stravaId);
    if (idx >= 0) {
      list[idx].accessToken = accessToken;
      list[idx].expiresAt   = expiresAt;
      fs.writeFileSync(WAITLIST_FILE, JSON.stringify(list, null, 2));
    }
  } catch (err) {
    console.error('Failed to update token in waitlist:', err);
  }
}

// ── Return a valid access token, refreshing if expired ──────────────────────
async function getValidToken(athlete) {
  const now = Math.floor(Date.now() / 1000);
  // Refresh if token expires within 5 minutes
  if (athlete.expiresAt > now + 300) {
    return athlete.accessToken;
  }

  const data = await stravaRequest('POST', '/oauth/token', null, {
    client_id:     process.env.STRAVA_CLIENT_ID,
    client_secret: process.env.STRAVA_CLIENT_SECRET,
    grant_type:    'refresh_token',
    refresh_token: athlete.refreshToken,
  });

  updateAthleteToken(athlete.stravaId, data.access_token, data.expires_at);
  return data.access_token;
}

// ── Strava API helpers ───────────────────────────────────────────────────────
function stravaGet(apiPath, token) {
  return stravaRequest('GET', apiPath, token, null);
}

function stravaPut(apiPath, token, body) {
  return stravaRequest('PUT', apiPath, token, body);
}

function stravaRequest(method, apiPath, token, body) {
  return new Promise((resolve, reject) => {
    const isOAuth = apiPath === '/oauth/token';
    const fullPath = isOAuth ? apiPath : `/api/v3${apiPath}`;
    const payload  = body ? JSON.stringify(body) : null;

    const headers = { 'Content-Type': 'application/json' };
    if (token)   headers['Authorization']  = `Bearer ${token}`;
    if (payload) headers['Content-Length'] = Buffer.byteLength(payload);

    const req = https.request(
      { hostname: 'www.strava.com', path: fullPath, method, headers },
      (res) => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          if (res.statusCode >= 400) {
            return reject(new Error(`Strava ${res.statusCode} on ${method} ${apiPath}: ${data}`));
          }
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(e); }
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
