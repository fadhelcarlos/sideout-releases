'use strict';

// Endpoint and relational checks, not a substitute for the seven actual iOS renders.
// Binds an ephemeral loopback port; it never connects to the currently running8787.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createBackend, fixtures, SOURCE } = require('./backend.cjs');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const results = [];
const check = (name, fn) => Promise.resolve().then(fn).then(() => results.push({ name, pass: true }));

async function main() {
  const app = await createBackend({ port: 0 });
  let token = null;
  const request = async (route, { method = 'GET', body, object = false, status = 200 } = {}) => {
    const response = await fetch(app.origin + route, { method, headers: {
      apikey: 'synthetic-loopback-key', 'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(object ? { Accept: 'application/vnd.pgrst.object+json' } : {}),
    }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    assert.equal(response.status, status, `${method} ${route}`);
    if (response.status === 204) return null;
    return response.json();
  };
  const rpc = (name, body = {}) => request(`/rest/v1/rpc/${name}`, { method: 'POST', body });
  try {
    await check('loopback ephemeral listener and immutable source binding', async () => {
      const health = await request('/health');
      assert.equal(health.source, SOURCE);
      assert.notEqual(new URL(app.origin).port, '8787');
      assert.equal(app.server.address().address, '127.0.0.1');
      assert.equal(health.counts.players, 12);
      assert.equal(health.authenticated, false);
    });
    await check('actual handle/password auth protocol, JWT and user linkage', async () => {
      assert.equal(await rpc('ll_my_player'), null);
      await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: fixtures.login.email, password: 'wrong' }, status: 400 });
      const session = await request('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: fixtures.login.email, password: fixtures.login.password } });
      token = session.access_token;
      assert.match(token, /^[\w-]+\.[\w-]+\.[\w-]+$/);
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
      assert.equal(payload.sub, fixtures.login.userId);
      assert.equal(Buffer.from(token.split('.')[2], 'base64url').length, 32);
      assert.equal((await request('/auth/v1/user')).id, fixtures.login.userId);
      const me = await rpc('ll_my_player');
      assert.equal(me.user_id, fixtures.login.userId); assert.equal(me.id, fixtures.login.playerId);
      assert.equal(me.name, 'Lucas Rivera'); assert.ok(me.onboarded_at); assert.equal(me.banned_at, null);
      const renewed = await request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh_token } });
      assert.equal(renewed.user.id, me.user_id);
    });
    await check('PostgREST settings single/array shape and safe current release', async () => {
      const cfg = await request('/rest/v1/app_settings?select=config&id=eq.1', { object: true });
      const array = await request('/rest/v1/app_settings?select=config&id=eq.1');
      assert.deepEqual(cfg.config, array[0].config);
      assert.equal(cfg.config.minBuild, 0); assert.equal(cfg.config.rating.name, 'PRIME');
      assert.equal(await rpc('ll_native_release'), null);
    });
    let events, ranks, bundle;
    await check('calendar dates, embedded venue/count and current hero', async () => {
      events = await request('/rest/v1/events?select=id,kind,title,starts_at,event_teams(count),venues(id,name,slug,logo_url)&kind=neq.partido&order=starts_at.asc');
      assert.equal(events.length, 7);
      assert.equal(events.filter(e => e.phase === 'registro').length, 4);
      assert.equal(events.filter(e => e.phase === 'campeon').length, 2);
      const hero = events.find(e => e.id === 'a5310000-0000-4000-8000-000000000101');
      assert.equal(hero.venues.name, 'Costa Clara Pickleball');
      assert.equal(hero.event_teams[0].count, 6);
      assert.ok(Date.parse(hero.config.endsAt) > Date.now());
      for (const event of events) assert.ok(Math.abs(Date.parse(event.starts_at) - Date.now()) < 9 * 86400000);
      assert.equal(await rpc('ll_featured_event'), hero.id);
      const mine = await request(`/rest/v1/event_teams?select=event_id&or=(p1.eq.${fixtures.login.playerId},p2.eq.${fixtures.login.playerId})`);
      assert.ok(mine.some(t => t.event_id === hero.id));
      const featured = await rpc('ll_featured', { p_kind: 'event' });
      assert.ok(featured[0].venue.name); assert.ok(featured[0].teams > 0);
    });
    await check('Ranking Lucas in first four, numeric stats and all approved faces', async () => {
      ranks = await rpc('ll_rankings');
      assert.equal(ranks.length, 12);
      assert.ok(ranks.findIndex(r => r.player_id === fixtures.login.playerId) < 4);
      assert.equal(new Set(ranks.map(r => r.player_id)).size, ranks.length);
      for (const row of ranks) {
        assert.ok(row.avatar_path.startsWith('cast/')); assert.ok(row.games >= 6);
        assert.equal(row.games, row.wins + row.losses); assert.ok(Number.isFinite(row.rating));
        assert.match(row.handle, /^[a-z0-9_.]{3,20}$/);
      }
      assert.deepEqual(await rpc('ll_venue_rankings', { p_venue: app.data.venues[0].id }), ranks);
      const season = (await request('/rest/v1/seasons?select=*&order=starts_on.desc'))[0];
      assert.ok(season.starts_on < new Date().toISOString().slice(0, 10));
      assert.ok(season.ends_on > new Date().toISOString().slice(0, 10));
      const points = await rpc('ll_season_table', { p_season: season.id });
      assert.equal(points.length, ranks.length);
    });
    await check('Profile and PRIME agree with session/ranking, trophies and partners resolve', async () => {
      const profile = await rpc('ll_profile', { p_player: fixtures.login.playerId });
      const prime = await rpc('ll_prime', { p_player: fixtures.login.playerId, p_limit: 40 });
      assert.equal(profile.self, true); assert.equal(profile.friend, 'self');
      assert.equal(profile.player.rating, ranks.find(r => r.player_id === fixtures.login.playerId).rating);
      assert.equal(prime.rating, profile.player.rating);
      assert.equal(prime.history[0].after, prime.rating); assert.equal(prime.history.length, 10);
      assert.equal(profile.numbers.games, prime.games); assert.equal(profile.friends, 8);
      assert.ok(profile.partners[0].avatar_path); assert.equal(profile.trophies.length, 2);
      for (const trophy of profile.trophies) assert.ok(events.some(e => e.id === trophy.event_id && e.phase === 'campeon'));
      for (const next of profile.upcoming) assert.ok(next.partner.avatar_path && Date.parse(next.starts_at) > Date.now());
      assert.equal(await rpc('ll_player_by_handle', { p_handle: 'lucasrivera' }), fixtures.login.playerId);
    });
    await check('Torneito creation picker has linked friends, searchable names and usable places', async () => {
      const friends = await rpc('ll_friends');
      assert.equal(friends.friends.length, 8); assert.deepEqual(friends.received, []);
      for (const name of ['Mateo Vega', 'Valeria Cruz', 'Andrés Lozano']) {
        const found = await rpc('ll_find_players', { p_q: name, p_limit: 10 });
        assert.equal(found.length, 1); assert.equal(found[0].name, name); assert.ok(found[0].avatar_path);
        assert.ok(friends.friends.some(f => f.id === found[0].id));
      }
      const places = await rpc('ll_places', { p_lat: null, p_lng: null });
      assert.equal(places[0].name, 'Costa Clara Pickleball'); assert.equal(places.length, 5);
      for (const p of places) assert.ok(p.courts > 0 && p.municipality && p.lat && p.lng);
    });
    await check('Canchas directory, featured image and live audiences use the same venues', async () => {
      const venues = await rpc('ll_venues'), featured = await rpc('ll_featured', { p_kind: 'venue' });
      assert.equal(venues.length, 3); assert.equal(featured[0].name, 'Costa Clara Pickleball');
      const live = await rpc('ll_places_live');
      assert.equal(live[venues[0].id].friends, 3);
      const detail = await rpc('ll_venue', { p_slug: venues[0].slug });
      assert.ok(detail.stats.games > 0 && detail.champions.length && detail.events.length);
      const here = await rpc('ll_place_live', { p_venue: venues[0].id });
      assert.equal(here.friends.length, live[venues[0].id].friends);
      const response = await fetch(featured[0].cover_url);
      assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/jpeg');
    });
    await check('Juegos has coherent participants, scores, courts, Ronda1 and server table', async () => {
      bundle = await rpc('ll_event_bundle', { p_event: 'a5310000-0000-4000-8000-000000000101' });
      assert.equal(bundle.event.phase, 'clasificatoria'); assert.equal(bundle.teams.length, 6);
      assert.equal(bundle.matches.length, 9); assert.equal(bundle.venue.name, 'Costa Clara Pickleball');
      const teams = new Set(bundle.teams.map(t => t.id)), live = bundle.matches.filter(m => m.status === 'live');
      assert.equal(live.length, 2); assert.deepEqual(live.map(m => m.court), [1, 2]);
      assert.equal(new Set(live.flatMap(m => [m.a, m.b])).size, 4);
      assert.equal(bundle.matches[0].label, 'Ronda 1');
      for (const t of bundle.teams) { assert.ok(t.p1.avatar_path); assert.ok(t.p2.avatar_path); }
      for (const m of bundle.matches) {
        assert.ok(teams.has(m.a) && teams.has(m.b) && m.a !== m.b);
        if (m.status === 'done') assert.equal(m.winner, m.games[0][0] > m.games[0][1] ? m.a : m.b);
        else assert.equal(m.winner, null);
      }
      const projected = bundle.format_state.tables[0].rows;
      for (const row of projected) {
        const played = bundle.matches.filter(m => m.status === 'done' && (m.a === row.team_id || m.b === row.team_id));
        assert.equal(row.played, played.length);
        assert.equal(row.w, played.filter(m => m.winner === row.team_id).length);
        assert.equal(row.pf, played.reduce((n, m) => n + m.games[0][m.a === row.team_id ? 0 : 1], 0));
      }
      assert.deepEqual(await rpc('ll_public_event', { p_event: bundle.event.id }), bundle);
      const unknown = await rpc('ll_event_bundle', { p_event: '00000000-0000-4000-8000-000000000000' });
      assert.equal(unknown, null);
    });
    await check('all local asset bytes are approved copies, both avatar sizes resolve', async () => {
      const provenance = JSON.parse(fs.readFileSync(path.join(__dirname, 'assets/provenance.json'), 'utf8').replace(/^\uFEFF/, ''));
      assert.equal(provenance.assets.length, 15);
      for (const a of provenance.assets) {
        const bytes = fs.readFileSync(path.join(__dirname, 'assets', a.file));
        assert.equal(sha(bytes), a.sha256); assert.equal(bytes.length, a.bytes);
        assert.equal(bytes.subarray(0, 3).toString('hex'), 'ffd8ff');
      }
      for (const p of app.data.players) for (const size of ['', '_t']) {
        const response = await fetch(`${app.origin}/storage/v1/object/public/avatars/${p.avatar_path}${size}.webp`);
        assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/jpeg');
        const bytes = Buffer.from(await response.arrayBuffer());
        const file = p.avatar_path.replace('cast/', 'people/') + '.jpg';
        assert.equal(sha(bytes), provenance.assets.find(a => a.file === file).sha256);
      }
    });
    await check('all content references stay inside the synthetic world and loopback', async () => {
      const data = JSON.stringify({ tables: app.data.tables, bundle, ranks, ads: await rpc('ll_home_ads') });
      assert.ok(!/2099|business-proof|fixture\.invalid|\bQA\b/i.test(data));
      const urls = data.match(/https?:[^"\s]+/g) || [];
      assert.ok(urls.length > 0);
      for (const url of urls) assert.equal(new URL(url).origin, app.origin);
      for (const route of Object.values(fixtures.routes).filter(r => r.startsWith('sideout:'))) assert.match(route, /^sideout:\/\//);
      for (const id of [...app.data.players, ...app.data.events, ...app.data.venues].map(v => v.id)) assert.match(id, /^a531[0-9]{4}-0000-4000-8000-\d{12}$/);
    });
    await check('real Phoenix JSON join/heartbeat and orderly socket close', async () => {
      assert.equal(typeof WebSocket, 'function', 'Node22+ is required for the websocket contract check');
      const ws = new WebSocket(app.origin.replace('http:', 'ws:') + '/realtime/v1/websocket?vsn=1.0.0');
      const wait = event => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Websocket ${event} timeout`)), 3000);
        ws.addEventListener(event, result => { clearTimeout(timer); resolve(result); }, { once: true });
        ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Websocket transport error')); }, { once: true });
      });
      await wait('open');
      let reply = wait('message');
      ws.send(JSON.stringify(['1', '1', 'realtime:events', 'phx_join', { config: { postgres_changes: [{ event: '*', schema: 'public', table: 'events' }] } }]));
      let frame = JSON.parse((await reply).data);
      assert.equal(frame[3], 'phx_reply'); assert.equal(frame[4].status, 'ok'); assert.equal(frame[4].response.postgres_changes.length, 1);
      reply = wait('message'); ws.send(JSON.stringify({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: '2' }));
      frame = JSON.parse((await reply).data); assert.equal(frame.payload.status, 'ok');
      const closed = wait('close'); ws.close(); await closed;
    });
    const sourceAt = process.argv.indexOf('--source');
    if (sourceAt >= 0) await check('installed Supabase SDK password/session/table/RPC integration', async () => {
      const { createClient } = require(path.join(path.resolve(process.argv[sourceAt + 1]), 'node_modules/@supabase/supabase-js'));
      const client = createClient(app.origin, 'synthetic-loopback-key', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
      const auth = await client.auth.signInWithPassword({ email: fixtures.login.email, password: fixtures.login.password });
      assert.equal(auth.error, null); assert.equal(auth.data.user.id, fixtures.login.userId);
      const me = await client.rpc('ll_my_player'); assert.equal(me.error, null); assert.equal(me.data.id, fixtures.login.playerId);
      const cfg = await client.from('app_settings').select('config').eq('id', 1).maybeSingle();
      assert.equal(cfg.error, null); assert.equal(cfg.data.config.minBuild, 0);
      const ev = await client.from('events').select('id,kind,title,starts_at,event_teams(count),venues(id,name,slug,logo_url)').neq('kind', 'partido').order('starts_at');
      assert.equal(ev.error, null); assert.equal(ev.data.length, 7);
      const search = await client.rpc('ll_find_players', { p_q: 'Andres', p_limit: 10 });
      assert.equal(search.error, null); assert.equal(search.data[0].name, 'Andrés Lozano');
      await client.removeAllChannels();
    });
    await check('unknown operations and writes fail explicitly; no original data can be reached', async () => {
      await request('/rest/v1/players', { method: 'POST', body: { name: 'Changed' }, status: 405 });
      await request('/rest/v1/rpc/ll_torneito_create_v2', { method: 'POST', body: {}, status: 404 });
      assert.equal(app.data.me.name, 'Lucas Rivera');
      await request('/rest/v1/other_customer_table?select=*', { status: 404 });
      await request('/auth/v1/logout', { method: 'POST', status: 204 });
      assert.equal(await rpc('ll_my_player'), null);
    });
    console.log(JSON.stringify({ ok: true, source: SOURCE, at: new Date().toISOString(), port: Number(new URL(app.origin).port),
      checks: results.length, results, assets: 15, backendSHA256: sha(fs.readFileSync(path.join(__dirname, 'backend.cjs'))),
      fixturesSHA256: sha(fs.readFileSync(path.join(__dirname, 'fixtures.json'))), boundary: 'Endpoint contracts only; actual iOS render acceptance belongs to captured screenshots.' }, null, 2));
  } finally { await app.close(); }
}
main().catch(error => { console.error(JSON.stringify({ ok: false, passed: results.length, error: error.message, stack: error.stack })); process.exitCode = 1; });
