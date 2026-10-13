'use strict';
// Simulator-only transport. No HTTP client, upstream URL, provider credential or production fallback.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const LOCAL_URL = 'http://127.0.0.1:8787';
const KEY = 'sideout-simulator-local-public-key';
const HANDLE = 'simulator_proof';
const EMAIL = `${HANDLE}@jugadores.lalocal.app`;
const PASSWORD = 'Simulator-Local-Only-42!';
const UID = '97cf0000-0000-4000-8000-000000000001';
const PLAYER = '97cf0000-0000-4000-8000-000000000002';
const KIND = 'sideout-isolated-ios-simulator-v1';
const TARGET = '97cf0000-0000-4000-8000-000000000004';
function proofPerson(state) {
  assert(/^\d{8,14}$/.test(state.proofRun), 'This fixture requires its actual GitHub run ID');
  return { id: TARGET, name: 'QA Copy ' + state.proofRun, handle: 'copy_' + state.proofRun,
    avatar_path: null, rating: 3.5, dupr_verified: false, games: 0, has_account: true };
}
const CREATED = '2026-10-12T00:00:00.000Z';
const empty = b => b && typeof b === 'object' && !Array.isArray(b) && Object.keys(b).length === 0;
const result = (body, status = 200) => ({ status, body });
const refuse = (status = 403, message = 'Only the isolated Simulator contract is available') => result({ code: 'SIMULATOR_LOCAL_ONLY', message }, status);
const fresh = () => ({ kind: KIND, wall: false, onboarded_at: null, login_at: null, logged_in: false, logins: 0, completions: 0 });
const user = () => ({ id: UID, aud: 'authenticated', role: 'authenticated', email: EMAIL, email_confirmed_at: CREATED,
  created_at: CREATED, updated_at: CREATED, app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [], is_anonymous: false });
function session(state) {
  assert(Number.isInteger(state.login_at));
  const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const access_token = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({ sub: UID, aud: 'authenticated', role: 'authenticated',
    email: EMAIL, aal: 'aal1', iat: state.login_at, exp: state.login_at + 86400, session_id: '97cf0000-0000-4000-8000-000000000003' })}.simulator-local-only`;
  return { access_token, token_type: 'bearer', expires_in: 86400, expires_at: state.login_at + 86400,
    refresh_token: 'simulator-local-only-refresh', user: user() };
}
function player(state) {
  return { id: PLAYER, user_id: UID, handle: HANDLE, name: 'Simulador Local', dupr: 3.5, dupr_verified: false,
    role: 'player', rating: 3.5, rating_sigma: 0.75, rating_games: 0, rating_peak: null, rating_elig: 3.5, rating_form: 0,
    created_at: CREATED, onboarded_at: state.onboarded_at, banned_at: null, ban_reason: null, ban_until: null,
    avatar_path: null, avatar_at: null, show_upcoming: 'friends' };
}
function prime() {
  return { player_id: PLAYER, rating: 3.5, sigma: 0.75, games: 0, peak: null, peak_at: null, elig: 3.5, form: 0,
    dupr: 3.5, verified: false, verified_source: null, dupr_id: null, dupr_name: null, dupr_doubles: null,
    dupr_rel: null, dupr_checked_at: null, claim: null, history: [] };
}
function profile(state) {
  const me = player(state);
  return { player: { id: PLAYER, name: me.name, handle: HANDLE, avatar_path: null, rating: 3.5, dupr_verified: false,
    games: 0, has_account: true, created_at: CREATED, banned: false }, self: true, friend: 'self', friends: 0,
    mutual: [], mutual_count: 0, numbers: { games: 0, wins: 0, events: 0, streak: 0 }, trophies: [], client: null,
    nemesis: null, partners: [], vs: null, upcoming: [], show_upcoming: 'friends' };
}
function dispatch(request, state) {
  assert.equal(state.kind, KIND);
  if (typeof request.url !== 'string' || !request.url.startsWith('/') || request.url.startsWith('//')) return refuse(400);
  const u = new URL(request.url, LOCAL_URL), method = request.method;
  const headers = request.headers || {}, body = request.body;
  if (method === 'GET' && u.pathname === '/health') return result({ kind: KIND, backend: LOCAL_URL });
  if (headers.apikey !== KEY) return refuse(401);
  const token = state.login_at === null ? null : session(state).access_token;
  const signed = state.logged_in && headers.authorization === `Bearer ${token}`;
  const anonymous = !headers.authorization || headers.authorization === `Bearer ${KEY}`;
  if (!signed && !anonymous) return refuse(401, 'Foreign or expired local session');
  if (u.pathname === '/auth/v1/token' && method === 'POST') {
    const password = u.searchParams.get('grant_type') === 'password' && body?.email === EMAIL && body?.password === PASSWORD;
    const refresh = u.searchParams.get('grant_type') === 'refresh_token' && state.logged_in && body?.refresh_token === 'simulator-local-only-refresh';
    if (!password && !refresh) return refuse(400, 'Invalid login credentials');
    state.login_at = Math.floor(Date.now() / 1000); state.logged_in = true;
    if (password) state.logins++;
    return result(session(state));
  }
  if (u.pathname === '/auth/v1/user' && method === 'GET') return signed ? result(user()) : refuse(401);
  if (u.pathname === '/auth/v1/logout' && method === 'POST' && signed) {
    state.logged_in = false; return result(null, 204);
  }
  if (u.pathname === '/rest/v1/app_settings' && method === 'GET' && u.searchParams.get('id') === 'eq.1') {
    const row = { config: { business: true, rating: { name: 'PRIME' }, kinds: {}, points: {} } };
    return result(String(headers.accept || '').includes('vnd.pgrst.object') ? row : [row]);
  }
  if (method === 'GET' && ['/rest/v1/events', '/rest/v1/event_teams', '/rest/v1/leagues', '/rest/v1/seasons'].includes(u.pathname)) return result([]);
  if (method !== 'POST' || !u.pathname.startsWith('/rest/v1/rpc/') || !body || Array.isArray(body) || typeof body !== 'object') return refuse(404);
  const rpc = u.pathname.slice('/rest/v1/rpc/'.length);
  if (rpc === 'll_native_release' && empty(body)) return result(state.wall ? { min_ios_build: 99999, ios_build: 0 } : { min_ios_build: 0, ios_build: 0 });
  if (rpc === 'll_featured_event' && empty(body)) return result(null);
  if (rpc === 'll_venues' && empty(body)) return result([]);
  if (rpc === 'll_rankings' && empty(body)) return result([]);
  if (rpc === 'll_recent_champions' && Object.keys(body).every(k => k === 'p_limit')) return result([]);
  if (rpc === 'll_hot_streaks' && Object.keys(body).every(k => k === 'p_min')) return result([]);
  if (rpc === 'll_home_ads' && empty(body)) return result({ ads: [], from_cents: null });
  if (rpc === 'll_my_player' && empty(body)) return result(signed ? player(state) : null);
  if (!signed) return refuse(401);
  if (rpc === 'll_onboarded' && empty(body)) {
    if (!state.onboarded_at) { state.onboarded_at = new Date().toISOString(); state.completions++; }
    return result(null);
  }
  if (rpc === 'll_prime' && body.p_player === PLAYER && body.p_limit === 40 && Object.keys(body).length === 2) return result(prime());
  if (rpc === 'll_profile' && body.p_player === PLAYER && Object.keys(body).length === 1) return result(profile(state));
  if (rpc === 'll_prime' && body.p_player === TARGET && body.p_limit === 40 && Object.keys(body).length === 2) return result({ ...prime(), player_id: TARGET });
  if (rpc === 'll_profile' && body.p_player === TARGET && Object.keys(body).length === 1) {
    const own = profile(state);
    return result({ ...own, player: { ...own.player, ...proofPerson(state) }, self: false, friend: 'friends' });
  }
  if (rpc === 'll_friends' && empty(body)) return result({ friends: [{ ...proofPerson(state), since: CREATED }], received: [], sent: [] });
  if (rpc === 'll_my_partidos' && empty(body)) return result([]);
  if (rpc === 'll_is_platform_admin' && empty(body)) return result(false);
  if (rpc === 'll_payments_mode' && empty(body)) return result('live');
  if (rpc === 'll_places' && Object.keys(body).every(k => ['p_lat', 'p_lng'].includes(k))) return result([]);
  if (rpc === 'll_places_live' && empty(body)) return result({});
  return refuse(404);
}
function write(file, data) { fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2) + '\n'); fs.renameSync(file + '.tmp', file); }
function readState(dir) { const s = JSON.parse(fs.readFileSync(path.join(dir, 'local-state.json'), 'utf8')); assert.equal(s.kind, KIND); return s; }
function init(dir) {
  fs.mkdirSync(dir, { recursive: true });
  assert(!fs.existsSync(path.join(dir, 'local-state.json')), 'Refuse to overwrite an earlier proof state');
  write(path.join(dir, 'local-state.json'), fresh());
}
function server(dir) {
  readState(dir);
  const service = http.createServer((req, res) => {
    let raw = '', tooLarge = false;
    req.on('data', chunk => { if (raw.length + chunk.length > 32768) tooLarge = true; else raw += chunk; });
    req.on('end', () => {
      let response, state;
      try {
        if (tooLarge) throw new Error('Body limit');
        const body = raw ? JSON.parse(raw) : {};
        state = readState(dir);
        response = dispatch({ method: req.method, url: req.url, headers: req.headers, body }, state);
        write(path.join(dir, 'local-state.json'), state);
      } catch { response = refuse(400, 'Invalid local request'); }
      const pathname = typeof req.url === 'string' && req.url.startsWith('/') ? req.url.split('?')[0] : '(invalid)';
      // Never log bodies, authentication headers or credentials, even synthetic ones.
      fs.appendFileSync(path.join(dir, 'local-requests.jsonl'), JSON.stringify({ at: new Date().toISOString(), method: req.method,
        pathname, status: response.status, wall: state?.wall ?? null }) + '\n');
      res.writeHead(response.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(response.status === 204 ? undefined : JSON.stringify(response.body));
    });
  });
  service.on('upgrade', (_req, socket) => { socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); });
  return service;
}
if (require.main === module) {
  const [action, dir] = process.argv.slice(2); assert(dir);
  if (action === 'init') init(dir);
  else if (action === 'wall') { const s = readState(dir); s.wall = true; write(path.join(dir, 'local-state.json'), s); }
  else if (action === 'serve') server(dir).listen(8787, '127.0.0.1', () => console.log('Isolated Simulator backend listening on 127.0.0.1:8787'));
  else if (action === 'verify-onboarding') {
    const s = readState(dir); assert.equal(s.logins, 1); assert.equal(s.completions, 1); assert(s.onboarded_at);
    const rows = fs.readFileSync(path.join(dir, 'local-requests.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert(!rows.some(r => /push|notify|signup|purchase|functions\/v1/.test(r.pathname) && r.status < 400), 'No provider or account-creation mutation is permitted');
    write(path.join(dir, 'local-onboarding-receipt.json'), { observedAt: new Date().toISOString(), kind: KIND,
      successfulSyntheticLogins: s.logins, completions: s.completions, onboarded_at: s.onboarded_at, requests: rows.length,
      refusedRequests: rows.filter(r => r.status >= 400), productionRequests: 0, boundary: 'Runner-local synthetic backend; visible UI/OS evidence is separate' });
  } else throw new Error('Unknown local backend command');
}
module.exports = { LOCAL_URL, KEY, HANDLE, EMAIL, PASSWORD, UID, PLAYER, KIND, fresh, session, player, dispatch, init, server, proofPerson, TARGET };
