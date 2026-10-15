'use strict';

// Standalone, loopback-only screenshot fixture for the immutable native10031 source.
// No database client, environment credential lookup, outbound fetch or production fallback.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const fixtures = require('./fixtures.json');
const SOURCE = '6151ee8a341c0e5cffe1a7f4b95ded2f3d004ba7';
const uuid = (family, n) => `a531${family}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const clone = value => JSON.parse(JSON.stringify(value));
const iso = value => new Date(value).toISOString();
const fold = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const DAY = 86400000;

/** Build one coherent world. Its date anchor stays fixed for the entire capture run. */
function makeData(origin, now = Date.now()) {
  if (fixtures.source !== SOURCE) throw new Error('Unexpected source binding');
  const ago = days => iso(now - days * DAY);
  const datePR = (offset, hour = 18) => {
    const d = new Date(now - 4 * 3600000);
    return iso(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + offset, hour + 4));
  };
  const asset = filename => `${origin}/assets/${filename}`;
  const players = fixtures.players.map((p, i) => ({
    id: uuid('0000', i + 1), user_id: uuid('1000', i + 1), name: p.name, handle: p.handle,
    role: 'player', dupr: p.dupr, dupr_verified: true, dupr_verified_source: 'organizer',
    dupr_id: null, dupr_full_name: null, dupr_doubles: p.dupr, dupr_singles: null,
    dupr_doubles_rel: null, dupr_provisional: false,
    rating: p.rating, rating_sigma: 0.17 + i * 0.004, rating_games: p.games,
    rating_peak: +(p.rating + 0.06).toFixed(2), rating_peak_at: ago(10),
    rating_elig: p.rating, rating_form: p.form, rating_updated_at: ago(1),
    created_at: ago(120 + i), updated_at: ago(1), onboarded_at: ago(119 + i),
    banned_at: null, ban_reason: null, ban_until: null,
    avatar_path: `cast/${p.portrait}`, avatar_at: ago(80), show_upcoming: 'all',
  }));
  const me = players[0];
  const person = p => ({
    id: p.id, name: p.name, handle: p.handle, avatar_path: p.avatar_path,
    rating: p.rating, dupr: p.dupr, dupr_verified: p.dupr_verified,
    games: p.rating_games, has_account: true,
  });
  const lite = p => ({ ...person(p), user_id: p.user_id });
  const venues = fixtures.venues.map((v, i) => ({
    id: uuid('2000', i + 1), slug: v.slug, name: v.name, kind: v.kind,
    tagline: i === 0 ? 'Canchas frente al mar' : null,
    about: `${v.courts} canchas de pickleball en ${v.municipality}.`,
    signoff: 'Nos vemos en la cancha', logo_url: null,
    cover_url: v.cover ? asset(`courts/${v.cover}`) : null,
    municipality: v.municipality, address: null, lat: v.lat, lng: v.lng,
    courts: v.courts, setting: 'aire_libre', surface: 'dedicada', lights: true,
    access: v.kind === 'publica' ? 'gratis' : 'pago',
    amenities: ['parking', 'water', 'restrooms', 'seating'],
    hours: Array.from({ length: 7 }, () => ['06:00', '23:00']),
    phone: null, whatsapp: null, instagram: null, website: null, email: null,
    status: v.status, approved_at: ago(90), following: v.following,
    followers: v.followers, players: v.players, upcoming: 0, next: null,
  }));
  const seasonId = uuid('4000', 1), leagueId = uuid('3000', 1);
  const events = fixtures.events.map(e => {
    const starts_at = e.offsetMinutes != null ? iso(now + e.offsetMinutes * 60000) : datePR(e.offsetDays, e.hourPR);
    return {
      id: uuid('0000', e.number), title: e.title, kind: e.kind, phase: e.phase,
      starts_at, venue_id: venues[e.venue].id, season_id: seasonId,
      league_id: e.kind === 'liga' ? leagueId : null, version: 4,
      created_at: ago(20), updated_at: iso(now - 60000), created_by: null,
      finished_at: e.phase === 'campeon' ? iso(Date.parse(starts_at) + 3 * 3600000) : null,
      config: {
        heroLine1: e.line1, heroLine2: e.line2,
        maxTeams: 12, gamesPerTeam: 3, advance: 4, courts: 2, courtFrom: 1,
        points: 11, winBy: 2, qualBo: 1, quartersBo: 1, semisBo: 1, finalBo: 3,
        openScoring: true, fee: 15, eligibility: { mode: 'open' }, pairRule: { enabled: false },
        rated: true, ratingWeight: 1, countsForSeason: true, thirdPlace: false,
        endsAt: iso(Date.parse(starts_at) + 8 * 3600000),
        prize1: { label: '1er lugar', big: '$120', sub: 'Para la pareja campeona', short: '$120', icon: 'emoji_events' },
        prize2: { label: '2do lugar', big: '$60', sub: 'Para la pareja finalista', short: '$60', icon: 'military_tech' },
        notes: '',
      },
    };
  });
  const teamsByEvent = new Map();
  const teamNames = ['Lucas y Mateo', 'Valeria y Andrés', 'Camila y Diego', 'Isabel y Santiago', 'Lucía y Daniel', 'Paula y Marina'];
  for (const [index, event] of events.entries()) {
    teamsByEvent.set(event.id, Array.from({ length: fixtures.events[index].teams }, (_, i) => ({
      id: uuid('5000', (index + 1) * 100 + i + 1), event_id: event.id, name: teamNames[i],
      waitlist: false, seq: i + 1, color: i, created_by: players[i * 2].user_id,
      p1: lite(players[i * 2]), p2: lite(players[i * 2 + 1]),
      withdrawn_at: null, kind: 'team', seed: i + 1, team_id: null, members: null,
      created_at: ago(7 - i / 10), checked_in_at: event.phase === 'clasificatoria' ? iso(now - 50 * 60000) : null,
    })));
  }
  const makeMatch = (event, t, i, row) => {
    const done = row.status === 'done', playing = row.status === 'live';
    const winner = done ? t[row.score[0] > row.score[1] ? row.a : row.b].id : null;
    const stage = row.stage || 'q';
    return {
      id: uuid('6000', Number(event.id.slice(-3)) * 100 + i + 1), event_id: event.id,
      code: `${stage}${i + 1}`, stage, label: stage === 'q' ? `Ronda ${row.round}` : stage === 'sf' ? 'Semifinales' : 'Final',
      round: row.round, ord: i, a: t[row.a].id, b: t[row.b].id, bo: row.bo || 1,
      court: playing ? row.court : null, status: row.status,
      games: done ? (row.games || [row.score]) : [], games_at: done ? [iso(now - 25 * 60000)] : [],
      cur: done ? [0, 0] : row.score || [0, 0], winner,
      started_at: playing || done ? iso(now - (done ? 40 : 12) * 60000) : null,
      finished_at: done ? iso(now - 25 * 60000) : null, updated_at: iso(now - 60000),
      hold_until: null, stage_no: 0, grp: null, bracket: null, src_a: null, src_b: null,
      kind: 'match', parent_id: null, conditional: false, result: null, meta: {},
    };
  };
  const bundles = new Map(events.map(event => {
    const t = teamsByEvent.get(event.id), venue = venues.find(v => v.id === event.venue_id);
    let matches = [], tables = [], placements = [];
    if (event.phase === 'clasificatoria') {
      matches = fixtures.liveGames.map((m, i) => makeMatch(event, t, i, m));
      tables = [{ stage: 0, group: null, type: 'qualifying', kind: 'teams', complete: false,
        rows: fixtures.liveTable.map(({ team, ...r }) => ({ team_id: t[team].id, ...r })) }];
    } else if (event.phase === 'campeon') {
      matches = [
        makeMatch(event, t, 0, { stage: 'sf', round: 1, a: 0, b: 2, status: 'done', score: [11, 7] }),
        makeMatch(event, t, 1, { stage: 'sf', round: 1, a: 1, b: 3, status: 'done', score: [11, 8] }),
        makeMatch(event, t, 2, { stage: 'f', round: 2, a: 0, b: 1, status: 'done', score: [11, 8], games: [[11, 8], [11, 9]], bo: 3 }),
      ].map(m => ({ ...m, started_at: event.starts_at, finished_at: event.finished_at, updated_at: event.finished_at,
        games_at: m.games.map(() => event.finished_at) }));
      placements = [{ team_id: t[0].id, place: 'champion' }, { team_id: t[1].id, place: 'finalist' },
        { team_id: t[2].id, place: 'semifinalist' }, { team_id: t[3].id, place: 'semifinalist' }];
    }
    return [event.id, { event, teams: t, matches, venue,
      format_state: { v: 1, kind: 'classic', spec: null, active_stage: matches.length ? 0 : null, tables, placements } }];
  }));
  for (const venue of venues) {
    const ahead = events.filter(e => e.venue_id === venue.id && e.phase === 'registro').sort((a, b) => a.starts_at.localeCompare(b.starts_at));
    venue.upcoming = ahead.length;
    venue.next = ahead.length ? { id: ahead[0].id, title: ahead[0].title, kind: ahead[0].kind, starts_at: ahead[0].starts_at, phase: ahead[0].phase } : null;
  }
  const ranks = players.map((p, i) => ({
    player_id: p.id, name: p.name, handle: p.handle, avatar_path: p.avatar_path, dupr: p.dupr,
    rating: p.rating, sigma: p.rating_sigma, games: p.rating_games, wins: fixtures.players[i].wins,
    losses: p.rating_games - fixtures.players[i].wins, pf: fixtures.players[i].wins * 11 + 75,
    pa: (p.rating_games - fixtures.players[i].wins) * 11 + 65,
    titles: fixtures.players[i].titles, last_played: ago(1), last_delta: i === 0 ? 0.04 : 0.02 + i / 1000,
    has_account: true, verified: true, peak: p.rating_peak, form: p.rating_form,
  })).sort((a, b) => b.rating - a.rating);
  const primes = new Map(players.map((p, index) => [p.id, {
    player_id: p.id, rating: p.rating, sigma: p.rating_sigma, games: p.rating_games,
    peak: p.rating_peak, peak_at: p.rating_peak_at, elig: p.rating_elig, form: p.rating_form,
    dupr: p.dupr, verified: true, verified_source: 'organizer', dupr_id: null, dupr_name: null,
    dupr_doubles: p.dupr, dupr_rel: null, dupr_checked_at: null, claim: null,
    history: Array.from({ length: 10 }, (_, i) => ({
      at: ago(i + 1), before: +(p.rating - (i + 1) * 0.04).toFixed(3), after: +(p.rating - i * 0.04).toFixed(3),
      pf: 11, pa: [8, 7, 9, 6, 8][i % 5], edge: 0.06, expected: 0.52, perf: 0.59, fast: false, note: null,
      event_id: events[5 + i % 2].id, match_id: uuid('6000', 40000 + index * 100 + i), gi: 0,
      event_title: events[5 + i % 2].title, team_name: teamNames[Math.floor(index / 2)],
      opp_team_name: teamNames[(Math.floor(index / 2) + 1) % 6], partner: players[index % 2 ? index - 1 : index + 1].name,
      opp1: players[(index + 2) % 12].name, opp2: players[(index + 3) % 12].name,
    })),
  }]));
  const friends = { friends: players.slice(1, 9).map(p => ({ ...person(p), since: ago(50) })), received: [], sent: [] };
  const profiles = new Map(players.map((p, index) => [p.id, {
    player: { ...person(p), created_at: p.created_at, banned: false }, self: index === 0,
    friend: index === 0 ? 'self' : index < 9 ? 'friends' : 'none', friends: index === 0 ? 8 : 12,
    mutual: index === 0 ? [] : players.slice(1, 4).filter(x => x.id !== p.id).map(person), mutual_count: index === 0 ? 0 : 2,
    numbers: { games: p.rating_games, wins: fixtures.players[index].wins, events: 9 + index, streak: index === 0 ? 4 : 3 },
    trophies: events.filter(e => e.phase === 'campeon').map(e => ({ event_id: e.id, title: e.title, at: e.starts_at,
      venue: venues.find(v => v.id === e.venue_id).name, place: index < 2 ? 'champion' : 'finalist' })),
    client: { ...person(players[(index + 2) % 12]), games: 8, wins: 6 },
    nemesis: { ...person(players[(index + 7) % 12]), games: 7, wins: 2 },
    partners: [{ ...person(players[index % 2 ? index - 1 : index + 1]), games: 18, wins: 14 }],
    vs: null, upcoming: events.filter(e => e.phase === 'registro').slice(0, 2).map(e => ({
      event_id: e.id, title: e.title, starts_at: e.starts_at, venue: venues.find(v => v.id === e.venue_id).name,
      phase: e.phase, partner: person(players[index % 2 ? index - 1 : index + 1]),
    })), show_upcoming: 'all',
  }]));
  const places = venues.map((v, i) => ({ ...v, visibility: 'public',
    pioneer: i > 2 ? person(players[i]) : null, games: 39 + i * 13,
    open: i === 0 ? 2 : i === 1 ? 1 : 0, distance_m: [850, 4200, 2600, 7300, 3100][i],
  }));
  const livePlaces = Object.fromEntries(venues.map((v, i) => [v.id, {
    range: fixtures.venues[i].range, friends: fixtures.venues[i].friends,
  }]));
  const seasons = [{ id: seasonId, venue_id: venues[0].id, name: 'Temporada de otoño',
    starts_on: datePR(-30).slice(0, 10), ends_on: datePR(60).slice(0, 10),
    config: { copaSlots: 8, cutLabel: 'Línea de Copa', points: {} } }];
  const leagues = [{ id: leagueId, venue_id: venues[0].id, name: 'Liga de la costa',
    description: 'Dobles todos los jueves', status: 'activa', starts_on: datePR(-14).slice(0, 10),
    ends_on: datePR(35).slice(0, 10), config: { fee: 15, maxTeams: 12, playoffs: 4 }, created_at: ago(30) }];
  const leagueEntries = teamsByEvent.get(events[3].id).map((t, i) => ({
    id: uuid('8000', i + 1), league_id: leagueId, name: t.name, p1: t.p1.id, p2: t.p2.id,
    active: true, withdrawn_at: null, created_at: ago(15),
  }));
  const tableRows = fixtures.liveTable.map(({ team, ...r }) => ({ team_id: teamsByEvent.get(events[0].id)[team].id, ...r }));
  const eventTable = events.map(e => ({ ...e, event_teams: [{ count: teamsByEvent.get(e.id).length }],
    venues: venues.find(v => v.id === e.venue_id) }));
  const teamTable = [...teamsByEvent.values()].flat().map(t => ({ ...t, p1: t.p1.id, p2: t.p2.id }));
  const config = {
    rating: { name: 'PRIME', provisionalGames: 6, minGamesToRank: 1, sigmaMin: 0.1, sigmaNone: 0.75, formLo: 0.07 },
    points: {}, kinds: { torneito: { label: 'Torneito' }, mensual: { label: 'Mensual' }, copa: { label: 'Copa' },
      liga: { label: 'Liga' }, especial: { label: 'Especial' } }, business: true, minBuild: 0,
  };
  const champions = events.filter(e => e.phase === 'campeon').map(e => ({
    event_id: e.id, venue: venues.find(v => v.id === e.venue_id).name, venue_slug: venues.find(v => v.id === e.venue_id).slug,
    title: e.title, kind: e.kind, starts_at: e.starts_at, team: teamNames[0], p1: me.name, p2: players[1].name,
    p1_id: me.id, p2_id: players[1].id, score: [11, 9],
  }));
  const featuredEvent = e => ({ ...e, ends_at: datePR(8), teams: teamsByEvent.get(e.id).length,
    venue: venues.find(v => v.id === e.venue_id) });
  const tables = {
    app_settings: [{ id: 1, config }], players, venues, events: eventTable, event_teams: teamTable,
    matches: [...bundles.values()].flatMap(b => b.matches), seasons, leagues, league_entries: leagueEntries,
    event_payments: [], photos: [], photo_likes: [], native_releases: [],
    event_checkins: teamTable.filter(t => t.checked_in_at).map(t => ({ event_id: t.event_id, team_id: t.id, at: t.checked_in_at })),
  };
  function rpc(name, p, signedIn) {
    const player = players.find(x => x.id === p.p_player) || me;
    switch (name) {
      case 'll_my_player': return signedIn ? me : null;
      case 'll_onboarded': return null;
      case 'll_featured_event': return events[0].id;
      case 'll_event_bundle': case 'll_public_event': return bundles.get(p.p_event) || null;
      case 'll_rankings': case 'll_venue_rankings': return ranks;
      case 'll_prime': return primes.get(player.id);
      case 'll_profile': return p.p_player && !players.some(x => x.id === p.p_player) ? null : profiles.get(player.id);
      case 'll_friends': return friends;
      case 'll_find_players': {
        const term = fold(p.p_q).replace(/^@/, '');
        return players.filter(x => !term || fold(`${x.name} ${x.handle}`).includes(term)).slice(0, p.p_limit || 10)
          .map(x => ({ ...lite(x), rating_elig: x.rating_elig, recent: true }));
      }
      case 'll_player_by_handle': return players.find(x => fold(x.handle) === fold(p.p_handle).replace(/^@/, ''))?.id || null;
      case 'll_my_friend_code': return 'K7R4N9VC';
      case 'll_blocks': return [];
      case 'll_my_partidos': case 'll_my_torneitos': case 'll_my_open_plays': return [];
      case 'll_places': return places;
      case 'll_places_live': return livePlaces;
      case 'll_place_live': {
        const i = venues.findIndex(v => v.id === p.p_venue);
        if (i < 0) return null;
        return { range: fixtures.venues[i].range, count: i === 0 ? '8–12' : null,
          friends: players.slice(1, 1 + fixtures.venues[i].friends).map(person), me: null };
      }
      case 'll_place': {
        const place = places.find(v => v.id === p.p_id);
        return place ? { ...place, mine: false, edit: false, can: null, suggestions: [], changes: [],
          players: place.players, recent: [], top: players.slice(0, 5).map(person) } : null;
      }
      case 'll_place_photos': return [];
      case 'll_venues': return venues.filter(v => v.status === 'approved');
      case 'll_my_venues': return venues.filter(v => v.following);
      case 'll_venue': {
        const v = venues.find(x => x.slug === p.p_slug);
        return v ? { ...v, events: events.filter(e => e.venue_id === v.id).map(e => ({ ...e, teams: teamsByEvent.get(e.id).length })),
          champions: champions.filter(c => c.venue_slug === v.slug), top: ranks.slice(0, 5).map(x => ({ ...x, id: x.player_id })),
          stats: { players: v.players, events: 18, games: 126 } } : null;
      }
      case 'll_featured': return p.p_kind === 'venue' ? [{ ...venues[0], ends_at: datePR(8) }] : [featuredEvent(events[1])];
      case 'll_home_ads': return { from_cents: null, ads: [{
        id: uuid('9000', 1), kind: 'event', advertiser: venues[0].name, advertiser_logo_url: null,
        image_url: venues[0].cover_url, headline: events[1].title, body: null,
        cta_label: 'Ver torneo', cta_kind: 'event', cta_target: events[1].id,
        details: { focus_y: 60 }, venue_slug: venues[0].slug, event_id: events[1].id, demo: false,
      }] };
      case 'll_ad_event': return null;
      case 'll_recent_champions': return champions.slice(0, p.p_limit || 6);
      case 'll_hot_streaks': return [0, 2, 4, 7].map((i, k) => ({ ...person(players[i]), player_id: players[i].id, streak: 4 + k }));
      case 'll_season_table': return ranks.map((r, i) => ({ player_id: r.player_id, pos: i + 1,
        points: 48 - i * 3, events: 8, wins: 18 - i, titles: r.titles, finals: r.titles + 1 }));
      case 'll_pairs': return teamNames.map((name, i) => ({ pa: players[i * 2].id, pb: players[i * 2 + 1].id,
        name_a: players[i * 2].name, name_b: players[i * 2 + 1].name, team_names: [name],
        games: 18 - i, wins: 14 - i, pf: 161 - i * 6, pa_pts: 112, titles: 3, events: 7 }));
      case 'll_event_table': return tableRows;
      case 'll_league_table': return leagueEntries.map((e, i) => ({ entry_id: e.id, name: e.name, p1: lite(players[i * 2]),
        p2: lite(players[i * 2 + 1]), points: 18 - i * 2, games: 6, w: 4, l: 2, pos: i + 1 }));
      case 'll_win_chance': return { p_a: 0.57, expected_a: 11, expected_b: 9, gap: 0.12, balanced: true };
      case 'll_native_release': return null;
      case 'll_payments_mode': return 'live';
      case 'll_is_platform_admin': return false;
      case 'll_can_report': return { left: 3 };
      case 'll_whoami': return { user: null, active: null, venues: [], organizations: [], accounts: [], grants: [] };
      case 'll_my_push_enabled': return false;
      default: return undefined;
    }
  }
  return { anchor: iso(now), players, me, ranks, venues, places, events, bundles, tables, rpc, origin };
}

function tokenSession(origin, now) {
  const user = { id: fixtures.login.userId, aud: 'authenticated', role: 'authenticated',
    email: fixtures.login.email, email_confirmed_at: iso(now - DAY), phone: '',
    confirmed_at: iso(now - DAY), last_sign_in_at: iso(now),
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: { name: fixtures.players[0].name, handle: fixtures.login.handle, email_verified: true, dupr: 3.75 },
    identities: [{ identity_id: fixtures.login.userId, id: fixtures.login.userId, user_id: fixtures.login.userId,
      identity_data: { sub: fixtures.login.userId, email: fixtures.login.email, email_verified: true }, provider: 'email',
      last_sign_in_at: iso(now), created_at: iso(now - DAY), updated_at: iso(now) }],
    created_at: iso(now - 120 * DAY), updated_at: iso(now), is_anonymous: false,
  };
  const enc = x => Buffer.from(JSON.stringify(x)).toString('base64url');
  const body = `${enc({ alg: 'HS256', typ: 'JWT' })}.${enc({
    iss: `${origin}/auth/v1`, sub: user.id, aud: 'authenticated', role: 'authenticated', email: user.email,
    session_id: fixtures.login.sessionId, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 86400,
    aal: 'aal1', amr: [{ method: 'password', timestamp: Math.floor(now / 1000) }], is_anonymous: false,
  })}`;
  const signature = crypto.createHmac('sha256', 'local-synthetic-apple-screenshots-only').update(body).digest('base64url');
  return { access_token: `${body}.${signature}`, refresh_token: 'apple-screenshots-10031-fixed-refresh',
    token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(now / 1000) + 86400, user };
}

function field(row, key) { return key.split('.').reduce((v, k) => v?.[k], row); }
function predicate(row, key, value) {
  const at = value.indexOf('.');
  const op = value.slice(0, at), term = value.slice(at + 1), actual = field(row, key);
  switch (op) {
    case 'eq': return String(actual) === term;
    case 'neq': return String(actual) !== term;
    case 'is': return term === 'null' ? actual == null : String(actual) === term;
    case 'in': return term.replace(/^\(|\)$/g, '').split(',').includes(String(actual));
    case 'gt': return actual > term;
    case 'gte': return actual >= term;
    case 'lt': return actual < term;
    case 'lte': return actual <= term;
    case 'ilike': case 'like': return fold(actual).includes(fold(term.replace(/[%*]/g, '')));
    case 'not': return !predicate(row, key, term);
    default: throw new Error(`Unsupported table filter ${op}`);
  }
}
function tableRead(rows, query) {
  let out = rows.slice();
  for (const [key, val] of query) {
    if (['select', 'order', 'limit', 'offset'].includes(key)) continue;
    if (key === 'or') {
      const tests = val.replace(/^\(|\)$/g, '').split(',').map(x => {
        const at = x.indexOf('.'); return [x.slice(0, at), x.slice(at + 1)];
      });
      out = out.filter(row => tests.some(([k, v]) => predicate(row, k, v)));
    } else out = out.filter(row => predicate(row, key, val));
  }
  const orders = (query.get('order') || '').split(',').filter(Boolean).map(x => x.split('.'));
  if (orders.length) out.sort((a, b) => {
    for (const [key, direction] of orders) {
      const x = field(a, key), y = field(b, key);
      if (x === y) continue;
      return (x == null ? -1 : y == null ? 1 : x < y ? -1 : 1) * (direction === 'desc' ? -1 : 1);
    }
    return 0;
  });
  const total = out.length, offset = Number(query.get('offset') || 0), limit = Number(query.get('limit') || out.length);
  out = out.slice(offset, offset + limit);
  // PostgREST embedded projections used here are pre-shaped in tables; extra fields are intentionally harmless.
  return { rows: out, total, offset };
}

/** Minimal Phoenix JSON websocket: join, heartbeat and leave only. Fixtures are immutable. */
function realtime(server, sockets) {
  const frame = (data, opcode = 1) => {
    const body = Buffer.from(data), head = body.length < 126 ? Buffer.from([0x80 | opcode, body.length]) : Buffer.from([0x80 | opcode, 126, body.length >> 8, body.length & 255]);
    return Buffer.concat([head, body]);
  };
  server.on('upgrade', (req, socket, head) => {
    if (!req.url.startsWith('/realtime/v1/websocket') || !req.headers['sec-websocket-key']) return socket.destroy();
    const key = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${key}\r\n\r\n`);
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    let buffer = Buffer.alloc(0);
    const receive = data => {
      buffer = Buffer.concat([buffer, data]);
      while (buffer.length >= 2) {
        const opcode = buffer[0] & 15, masked = !!(buffer[1] & 128);
        let len = buffer[1] & 127, start = 2;
        if (len === 127) return socket.destroy();
        if (len === 126) { if (buffer.length < 4) return; len = buffer.readUInt16BE(2); start = 4; }
        if (buffer.length < start + (masked ? 4 : 0) + len) return;
        const mask = masked ? buffer.subarray(start, start + 4) : null; if (masked) start += 4;
        const payload = Buffer.from(buffer.subarray(start, start + len)); buffer = buffer.subarray(start + len);
        if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
        if (opcode === 8) { socket.end(frame(payload, 8)); return; }
        if (opcode === 9) { socket.write(frame(payload, 10)); continue; }
        if (opcode !== 1) continue;
        let m; try { m = JSON.parse(payload.toString()); } catch { continue; }
        const array = Array.isArray(m);
        const [joinRef, ref, topic, event, params] = array ? m : [m.join_ref, m.ref, m.topic, m.event, m.payload];
        if (!['phx_join', 'phx_leave', 'heartbeat', 'access_token'].includes(event)) continue;
        const response = event === 'phx_join' ? { postgres_changes: (params?.config?.postgres_changes || []).map((v, i) => ({ ...v, id: i + 1 })) } : {};
        const reply = { status: 'ok', response };
        socket.write(frame(JSON.stringify(array ? [joinRef, ref, topic, 'phx_reply', reply] : { join_ref: joinRef, ref, topic, event: 'phx_reply', payload: reply })));
      }
    };
    socket.on('data', receive); if (head.length) receive(head);
  });
}

/** Start only on IPv4 loopback. Supplying port0 gives tests a private ephemeral port. */
async function createBackend({ port = 8787, evidenceDir = null, now = Date.now() } = {}) {
  const requests = [], sockets = new Set();
  let data, session, loggedIn = false;
  if (evidenceDir) fs.mkdirSync(path.resolve(evidenceDir), { recursive: true });
  const record = item => {
    const row = { at: new Date().toISOString(), ...item }; requests.push(row);
    if (evidenceDir) fs.appendFileSync(path.join(evidenceDir, 'backend-requests.jsonl'), JSON.stringify(row) + '\n');
  };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const send = (status, value, headers = {}) => {
      const bytes = value === undefined ? Buffer.alloc(0) : Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value));
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,apikey,content-type,accept,prefer,range,x-client-info,x-supabase-api-version,cache-control',
        'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS', 'Access-Control-Expose-Headers': 'Content-Range,Range-Unit',
        'Content-Length': bytes.length, ...headers });
      if (req.method === 'HEAD') res.end(); else res.end(bytes);
      record({ method: req.method, path: url.pathname, status, ...(url.pathname.startsWith('/rest/v1/rpc/') ? { rpc: url.pathname.split('/').pop() } : {}) });
    };
    const error = (status, message, code = 'P0001') => send(status, { code, message, details: null, hint: null });
    try {
      const host = (req.headers.host || '').split(':')[0];
      if (!['127.0.0.1', 'localhost'].includes(host)) return error(403, 'Loopback only');
      if (req.method === 'OPTIONS') return send(204);
      if (url.pathname === '/health') return send(200, { ok: true, source: SOURCE, fixtureSchema: fixtures.schema,
        origin: data.origin, anchor: data.anchor, counts: { players: data.players.length, events: data.events.length, venues: data.venues.length },
        authenticated: loggedIn, routes: fixtures.routes, unexpectedRequests: requests.filter(x => x.status >= 400 && !x.expected).length });
      if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/storage/v1/object/public/')) {
        let relative;
        const avatar = /^\/storage\/v1\/object\/public\/avatars\/cast\/([a-z]+?)(?:_t)?\.webp$/.exec(url.pathname);
        if (avatar && fixtures.players.some(p => p.portrait === avatar[1])) relative = `people/${avatar[1]}.jpg`;
        else if (url.pathname.startsWith('/assets/')) relative = decodeURIComponent(url.pathname.slice('/assets/'.length));
        else return error(404, 'No local asset');
        const root = path.resolve(__dirname, 'assets'), target = path.resolve(root, relative);
        if (!target.startsWith(root + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) return error(404, 'No local asset');
        const ext = path.extname(target).toLowerCase();
        const type = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[ext];
        if (!type) return error(404, 'No local asset');
        return send(200, fs.readFileSync(target), { 'Content-Type': type, 'Cache-Control': 'public,max-age=3600' });
      }
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (raw.length > 256000) return error(413, 'Body too large'); }
      let params = {};
      if (raw) { try { params = JSON.parse(raw); } catch { return error(400, 'Invalid JSON'); } }
      const auth = req.headers.authorization || '';
      const signedIn = loggedIn && auth === `Bearer ${session.access_token}`;
      if (url.pathname === '/auth/v1/token' && req.method === 'POST') {
        const grant = url.searchParams.get('grant_type');
        if (grant === 'password' && (params.email !== fixtures.login.email || params.password !== fixtures.login.password)) return error(400, 'Usuario o contraseña incorrectos', 'invalid_credentials');
        if (grant === 'refresh_token' && params.refresh_token !== session.refresh_token) return error(400, 'Refresh token inválido', 'refresh_token_not_found');
        if (!['password', 'refresh_token'].includes(grant)) return error(400, 'Unsupported local grant');
        loggedIn = true; return send(200, session);
      }
      if (url.pathname === '/auth/v1/user' && req.method === 'GET') return signedIn ? send(200, session.user) : error(401, 'No session', 'bad_jwt');
      if (url.pathname === '/auth/v1/logout' && req.method === 'POST') { loggedIn = false; return send(204); }
      if (url.pathname === '/auth/v1/settings') return send(200, { external: { email: true, phone: false }, disable_signup: true, mailer_autoconfirm: true, phone_autoconfirm: false });
      if (url.pathname.startsWith('/rest/v1/rpc/')) {
        if (req.method !== 'POST' && req.method !== 'GET') return error(405, 'Read only');
        const name = url.pathname.split('/').pop();
        const value = data.rpc(name, req.method === 'GET' ? Object.fromEntries(url.searchParams) : params, signedIn);
        if (value === undefined) return error(404, `Unmapped local RPC: ${name}`, 'PGRST202');
        return send(200, value);
      }
      if (url.pathname.startsWith('/rest/v1/')) {
        if (!['GET', 'HEAD'].includes(req.method)) return error(405, 'Screenshot data is read only');
        const table = url.pathname.slice('/rest/v1/'.length);
        if (!Object.hasOwn(data.tables, table)) return error(404, `Unmapped local table: ${table}`, 'PGRST205');
        const result = tableRead(data.tables[table], url.searchParams);
        if ((req.headers.accept || '').includes('vnd.pgrst.object')) {
          return result.rows.length === 1 ? send(200, result.rows[0]) : error(406, 'Expected one row', 'PGRST116');
        }
        return send(200, result.rows, { 'Content-Range': result.rows.length ? `${result.offset}-${result.offset + result.rows.length - 1}/${result.total}` : `*/${result.total}`, 'Range-Unit': 'items' });
      }
      return error(404, 'No local route');
    } catch (e) {
      // Do not serialize request/auth bodies in diagnostics.
      record({ method: req.method, path: url.pathname, exception: e instanceof SyntaxError ? 'invalid-json' : 'handler-error' });
      if (!res.headersSent) error(500, 'Local fixture contract failed'); else res.end();
    }
  });
  realtime(server, sockets);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  data = makeData(origin, now); session = tokenSession(origin, now);
  if (evidenceDir) fs.writeFileSync(path.join(evidenceDir, 'backend-manifest.json'), JSON.stringify({
    source: SOURCE, origin, anchor: data.anchor, pid: process.pid, schema: fixtures.schema,
    routes: fixtures.routes, player: { id: data.me.id, name: data.me.name, handle: data.me.handle },
    liveEvent: { id: data.events[0].id, title: data.events[0].title },
    files: ['backend.cjs', 'fixtures.json'].map(file => ({ file, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, file))).digest('hex') })),
  }, null, 2) + '\n');
  return { server, origin, data, requests, close: async () => {
    for (const socket of sockets) socket.destroy();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  } };
}

module.exports = { createBackend, makeData, fixtures, SOURCE, tableRead };
if (require.main === module) {
  if (process.argv[2] !== 'serve') { console.error('Usage: node backend.cjs serve <EVIDENCE_DIR> [port]'); process.exitCode = 2; }
  else createBackend({ evidenceDir: process.argv[3] || null, port: Number(process.argv[4] || process.env.PORT || 8787) })
    .then(app => {
      console.log(JSON.stringify({ ready: true, origin: app.origin, source: SOURCE, anchor: app.data.anchor }));
      for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void app.close().then(() => process.exit(0)));
    }).catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
}
