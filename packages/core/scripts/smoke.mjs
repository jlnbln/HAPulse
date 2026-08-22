/**
 * Smoke test for @hapulse/core.
 * Run: node packages/core/scripts/smoke.mjs
 *
 * Verifies:
 *  - buildRooms produces ≥6 rooms with expected IDs
 *  - roomSummary produces sensible values for each room
 *  - DEMO_ENTITIES and DEMO_REGISTRIES are well-formed
 *  - domainOf, isToggleable, formatEntityState, domainIcon work correctly
 *  - createDemoTicker fires callbacks
 *  - applyDemoService mutates state correctly
 *  - THEMES has all 4 identities with matching light/dark token key sets
 *  - resolveThemeMode / accentOverride pure theme math
 *  - buildHAAuthorizeUrl / exchangeHAAuthCode / connectWithAuthData (mobile OAuth)
 *  - HAConnection.suspend is exported
 *  - translate() / resolveLanguage() and en/sv dictionary parity
 */

import {
  buildRooms,
  roomSummary,
  DEMO_ENTITIES,
  DEMO_REGISTRIES,
  domainOf,
  isToggleable,
  formatEntityState,
  domainIcon,
  isFavoriteRelevant,
  createDemoTicker,
  applyDemoService,
  HAAuthError,
  HAConnectionError,
  startHASignIn,
  resumeHASession,
  roomIconName,
  roomStatusIconName,
  CANONICAL_ROOM_ICONS,
  mdiIconExportName,
  THEMES,
  THEME_NAMES,
  THEME_LABELS,
  resolveThemeMode,
  accentOverride,
  buildHAAuthorizeUrl,
  exchangeHAAuthCode,
  connectWithAuthData,
  HAConnection,
  translate,
  resolveLanguage,
} from '../dist/index.js';
import EN_DICT from '../../../apps/dashboard/src/i18n/locales/en.json' with { type: 'json' };
import SV_DICT from '../../../apps/dashboard/src/i18n/locales/sv.json' with { type: 'json' };

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

function assertEqual(actual, expected, label) {
  assert(actual === expected, `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ---------------------------------------------------------------------------
// buildRooms
// ---------------------------------------------------------------------------

console.log('\n── buildRooms ──');

const rooms = buildRooms(DEMO_REGISTRIES, DEMO_ENTITIES);

assert(rooms.length >= 6, `at least 6 rooms (got ${rooms.length})`);

const roomIds = rooms.map(r => r.id);
for (const expected of ['living_room', 'kitchen', 'bedroom', 'office', 'bathroom', 'hallway']) {
  assert(roomIds.includes(expected), `room "${expected}" exists`);
}

// Rooms are alphabetically sorted
const names = rooms.map(r => r.name);
const sorted = [...names].sort((a, b) => a.localeCompare(b));
assert(JSON.stringify(names) === JSON.stringify(sorted), 'rooms are sorted alphabetically');

// Living room should have lights
const lr = rooms.find(r => r.id === 'living_room');
assert(lr !== undefined, 'living_room room found');
assert(Array.isArray(lr.domains['light']) && lr.domains['light'].length > 0, 'living_room has lights in domains');
assert(lr.entityIds.length > 0, 'living_room has entityIds');

// ---------------------------------------------------------------------------
// roomSummary
// ---------------------------------------------------------------------------

console.log('\n── roomSummary ──');

for (const room of rooms) {
  const summary = roomSummary(room, DEMO_ENTITIES);
  assert(typeof summary.lightsOn === 'number', `${room.name}: lightsOn is number`);
  assert(typeof summary.lightsTotal === 'number', `${room.name}: lightsTotal is number`);
  assert(typeof summary.mediaPlaying === 'boolean', `${room.name}: mediaPlaying is boolean`);
  assert(typeof summary.anyMotion === 'boolean', `${room.name}: anyMotion is boolean`);
  assert(summary.lightsOn <= summary.lightsTotal, `${room.name}: lightsOn <= lightsTotal`);
}

// Living room: should have temperature, lights on, motion
const lrSummary = roomSummary(lr, DEMO_ENTITIES);
assert(typeof lrSummary.temperature === 'number', 'living room has temperature');
assert(lrSummary.lightsOn > 0, 'living room has lights on');
assert(lrSummary.anyMotion === true, 'living room motion detected');

// Living room TV is playing
assert(lrSummary.mediaPlaying === true, 'living room media playing');

// Kitchen: lights on (ceiling on), media not playing
const kitchen = rooms.find(r => r.id === 'kitchen');
const kitchenSummary = roomSummary(kitchen, DEMO_ENTITIES);
assert(kitchenSummary.lightsOn > 0, 'kitchen has lights on');

// ---------------------------------------------------------------------------
// domain helpers
// ---------------------------------------------------------------------------

console.log('\n── domain helpers ──');

assertEqual(domainOf('light.living_room_ceiling'), 'light', 'domainOf light');
assertEqual(domainOf('sensor.temperature'), 'sensor', 'domainOf sensor');
assertEqual(domainOf('media_player.tv'), 'media_player', 'domainOf media_player');
assertEqual(domainOf('noDotsHere'), 'noDotsHere', 'domainOf no dot');

assert(isToggleable('light'), 'light is toggleable');
assert(isToggleable('switch'), 'switch is toggleable');
assert(isToggleable('fan'), 'fan is toggleable');
assert(isToggleable('input_boolean'), 'input_boolean is toggleable');
assert(!isToggleable('sensor'), 'sensor is NOT toggleable');
assert(!isToggleable('climate'), 'climate is NOT toggleable');

const tvEntity = DEMO_ENTITIES['media_player.living_room_tv'];
assertEqual(formatEntityState(tvEntity), 'playing', 'formatEntityState playing');

const tempEntity = DEMO_ENTITIES['sensor.living_room_temperature'];
const formatted = formatEntityState(tempEntity);
assert(formatted.includes('°C'), `formatEntityState includes unit (got "${formatted}")`);

const unavailEntity = { ...tempEntity, state: 'unavailable' };
assertEqual(formatEntityState(unavailEntity), 'unavailable', 'formatEntityState unavailable');

const lightEntity = DEMO_ENTITIES['light.living_room_ceiling'];
assertEqual(domainIcon(lightEntity), 'lightbulb', 'domainIcon light → lightbulb');

const doorEntity = DEMO_ENTITIES['binary_sensor.front_door'];
assertEqual(domainIcon(doorEntity), 'door-open', 'domainIcon door binary_sensor → door-open');

const thermometerEntity = DEMO_ENTITIES['sensor.living_room_temperature'];
assertEqual(domainIcon(thermometerEntity), 'thermometer', 'domainIcon temperature sensor → thermometer');

// ---------------------------------------------------------------------------
// isFavoriteRelevant
// ---------------------------------------------------------------------------

console.log('\n── isFavoriteRelevant ──');

// Helper: build a minimal entity stub for testing
function makeEntity(entity_id, state, attributes = {}) {
  return { entity_id, state, attributes, last_changed: '', last_updated: '', context: { id: '', parent_id: null, user_id: null } };
}

// Light ON → relevant
assert(isFavoriteRelevant(makeEntity('light.living_room', 'on')), 'light on → relevant');

// Light OFF → not relevant
assert(!isFavoriteRelevant(makeEntity('light.living_room', 'off')), 'light off → not relevant');

// Binary sensor ON (e.g. motion detected) → relevant
assert(isFavoriteRelevant(makeEntity('binary_sensor.front_door', 'on', { device_class: 'door' })), 'binary_sensor on → relevant');

// Binary sensor OFF (door closed) → not relevant
assert(!isFavoriteRelevant(makeEntity('binary_sensor.front_door', 'off', { device_class: 'door' })), 'binary_sensor off → not relevant');

// Sensor always relevant (value-type)
assert(isFavoriteRelevant(makeEntity('sensor.living_room_temperature', '21.5', { unit_of_measurement: '°C' })), 'sensor always relevant');

// Unavailable → not relevant (even for sensor domain)
assert(!isFavoriteRelevant(makeEntity('sensor.broken', 'unavailable')), 'unavailable → not relevant');

// Media player playing → relevant
assert(isFavoriteRelevant(makeEntity('media_player.living_room_tv', 'playing')), 'media_player playing → relevant');

// Media player idle → not relevant
assert(!isFavoriteRelevant(makeEntity('media_player.speaker', 'idle')), 'media_player idle → not relevant');

// ---------------------------------------------------------------------------
// roomIconName + roomStatusIconName
// ---------------------------------------------------------------------------

console.log('\n── roomIconName ──');

assertEqual(roomIconName({ name: 'Kitchen' }), 'utensils', 'keyword kitchen → utensils');
assertEqual(roomIconName({ name: 'Living Room' }), 'sofa', 'keyword living → sofa');
assertEqual(roomIconName({ name: 'Bedroom', icon: 'mdi:bed' }), 'bed', 'mdi:bed → bed');
assertEqual(roomIconName({ name: 'Living Room', icon: 'sofa' }), 'sofa', 'passthrough sofa → sofa');
assertEqual(roomIconName({ name: 'Foobar' }), 'house', 'unknown name → house');
assertEqual(roomIconName({ name: 'Master Suite', icon: 'mdi:bed-double' }), 'bed', 'mdi:bed-double → bed');
assertEqual(roomIconName({ name: 'Hallway', icon: 'door-open' }), 'door-open', 'passthrough door-open → door-open');

console.log('\n── mdiIconExportName ──');
assertEqual(mdiIconExportName('mdi:sofa-outline'), 'mdiSofaOutline', 'mdi:sofa-outline → mdiSofaOutline');
assertEqual(mdiIconExportName('mdi:sofa'), 'mdiSofa', 'mdi:sofa → mdiSofa');
assertEqual(mdiIconExportName('sofa-outline'), 'mdiSofaOutline', 'bare sofa-outline → mdiSofaOutline');
assertEqual(mdiIconExportName('mdi:silverware-fork-knife'), 'mdiSilverwareForkKnife', 'multi-segment kebab → camel');
assertEqual(mdiIconExportName('mdi:numeric-1-box'), 'mdiNumeric1Box', 'digits preserved in segments');
assertEqual(mdiIconExportName('MDI:Sofa'), 'mdiSofa', 'case-insensitive prefix/name');
assertEqual(mdiIconExportName(''), null, 'empty → null');
assertEqual(mdiIconExportName(null), null, 'null → null');
assertEqual(mdiIconExportName('hass:foo'), null, 'other icon pack → null');
assertEqual(mdiIconExportName('mdi:bad name'), null, 'invalid chars → null');

console.log('\n── roomStatusIconName ──');

// Build a minimal room with a door binary sensor in 'on' state
const hallwayRoom = rooms.find(r => r.id === 'hallway');
assert(hallwayRoom !== undefined, 'hallway room found for status tests');

// No sensor triggered → null
const noStatusEntities = { ...DEMO_ENTITIES };
assertEqual(roomStatusIconName(hallwayRoom, noStatusEntities), null, 'status: no trigger → null');

// Open door → 'door-open'
const openDoorEntities = {
  ...DEMO_ENTITIES,
  'binary_sensor.front_door': {
    ...DEMO_ENTITIES['binary_sensor.front_door'],
    state: 'on',
    attributes: { ...DEMO_ENTITIES['binary_sensor.front_door'].attributes, device_class: 'door' },
  },
};
assertEqual(roomStatusIconName(hallwayRoom, openDoorEntities), 'door-open', 'status: open door → door-open');

// Open window → 'air-vent'
const bedroomRoom = rooms.find(r => r.id === 'bedroom');
assert(bedroomRoom !== undefined, 'bedroom room found for window status test');
const openWindowEntities = {
  ...DEMO_ENTITIES,
  'binary_sensor.bedroom_window': {
    ...DEMO_ENTITIES['binary_sensor.bedroom_window'],
    state: 'on',
    attributes: { ...DEMO_ENTITIES['binary_sensor.bedroom_window'].attributes, device_class: 'window' },
  },
};
assertEqual(roomStatusIconName(bedroomRoom, openWindowEntities), 'air-vent', 'status: open window → air-vent');

// CANONICAL_ROOM_ICONS includes expected values
assert(Array.isArray(CANONICAL_ROOM_ICONS), 'CANONICAL_ROOM_ICONS is array');
assert(CANONICAL_ROOM_ICONS.includes('house'), 'CANONICAL_ROOM_ICONS includes house');
assert(CANONICAL_ROOM_ICONS.includes('sofa'), 'CANONICAL_ROOM_ICONS includes sofa');
assert(CANONICAL_ROOM_ICONS.includes('air-vent'), 'CANONICAL_ROOM_ICONS includes air-vent');

// ---------------------------------------------------------------------------
// createDemoTicker
// ---------------------------------------------------------------------------

console.log('\n── createDemoTicker ──');

let tickerFired = false;
const stop = createDemoTicker((entities) => {
  tickerFired = true;
  assert(typeof entities === 'object' && entities !== null, 'ticker provides entity map');
  assert(Object.keys(entities).length > 0, 'ticker entity map is not empty');
  stop();
  finish();
});

// ---------------------------------------------------------------------------
// applyDemoService
// ---------------------------------------------------------------------------

console.log('\n── applyDemoService ──');

// Toggle a light on
const afterTurnOff = applyDemoService(DEMO_ENTITIES, 'light', 'turn_off', {}, { entity_id: 'light.living_room_ceiling' });
assertEqual(afterTurnOff['light.living_room_ceiling'].state, 'off', 'turn_off light → off');

const afterTurnOn = applyDemoService(afterTurnOff, 'light', 'turn_on', { brightness: 128 }, { entity_id: 'light.living_room_ceiling' });
assertEqual(afterTurnOn['light.living_room_ceiling'].state, 'on', 'turn_on light → on');
assertEqual(afterTurnOn['light.living_room_ceiling'].attributes['brightness'], 128, 'brightness set');

// Lock/unlock
const afterUnlock = applyDemoService(DEMO_ENTITIES, 'lock', 'unlock', {}, { entity_id: 'lock.front_door' });
assertEqual(afterUnlock['lock.front_door'].state, 'unlocked', 'unlock → unlocked');

// Climate temp
const afterTemp = applyDemoService(DEMO_ENTITIES, 'climate', 'set_temperature', { temperature: 23 }, { entity_id: 'climate.living_room' });
assertEqual(afterTemp['climate.living_room'].attributes['temperature'], 23, 'climate temperature set');

// Media pause
const afterPause = applyDemoService(DEMO_ENTITIES, 'media_player', 'media_pause', {}, { entity_id: 'media_player.living_room_tv' });
assertEqual(afterPause['media_player.living_room_tv'].state, 'paused', 'media_pause → paused');

// Cover open
const afterOpen = applyDemoService(DEMO_ENTITIES, 'cover', 'open_cover', {}, { entity_id: 'cover.bedroom_blinds' });
assertEqual(afterOpen['cover.bedroom_blinds'].state, 'open', 'open_cover → open');

// Alarm arm away
const afterArm = applyDemoService(DEMO_ENTITIES, 'alarm_control_panel', 'alarm_arm_away', {}, { entity_id: 'alarm_control_panel.home' });
assertEqual(afterArm['alarm_control_panel.home'].state, 'armed_away', 'alarm arm away');

// ---------------------------------------------------------------------------
// OAuth helpers — error-mapping (no real HA needed)
// ---------------------------------------------------------------------------

console.log('\n── OAuth error mapping ──');

// HAAuthError has expected properties
const authErr = new HAAuthError('test');
assert(authErr instanceof Error, 'HAAuthError is instanceof Error');
assert(authErr instanceof HAAuthError, 'HAAuthError is instanceof HAAuthError');
assertEqual(authErr.code, 'ERR_INVALID_AUTH', 'HAAuthError.code');
assertEqual(authErr.name, 'HAAuthError', 'HAAuthError.name');

// HAConnectionError has expected properties
const connErr = new HAConnectionError('test conn');
assert(connErr instanceof Error, 'HAConnectionError is instanceof Error');
assertEqual(connErr.code, 'ERR_CANNOT_CONNECT', 'HAConnectionError.code');
assertEqual(connErr.name, 'HAConnectionError', 'HAConnectionError.name');

// startHASignIn rejects with HAConnectionError when hassUrl cannot redirect
// (ERR_HASS_HOST_REQUIRED is thrown by getAuth when hassUrl is empty/missing — here we pass a
//  non-empty but clearly unreachable URL so getAuth throws ERR_CANNOT_CONNECT or similar)
try {
  await startHASignIn({
    hassUrl: 'http://localhost:9',
    clientId: 'http://localhost:9/',
    redirectUrl: 'http://localhost:9/onboarding',
    saveTokens: () => {},
    loadTokens: async () => undefined,
  });
  assert(false, 'startHASignIn should reject for unreachable host');
} catch (err) {
  assert(
    err instanceof HAConnectionError || err instanceof HAAuthError,
    'startHASignIn rejects with typed error for unreachable host'
  );
}

// resumeHASession returns null when loadTokens returns undefined and there's no callback
try {
  const result = await resumeHASession({
    clientId: 'http://localhost:9/',
    redirectUrl: 'http://localhost:9/onboarding',
    saveTokens: () => {},
    loadTokens: async () => undefined,
  });
  assert(result === null, 'resumeHASession returns null when no tokens and no callback');
} catch (err) {
  // getAuth may throw ERR_HASS_HOST_REQUIRED which we map to null — also acceptable
  assert(
    err instanceof HAConnectionError || err instanceof HAAuthError,
    'resumeHASession throws typed error (no tokens path)'
  );
}

// resumeHASession rejects with HAAuthError for expired/invalid tokens
try {
  const expiredToken = {
    hassUrl: 'http://localhost:9',
    clientId: 'http://localhost:9/',
    expires: Date.now() - 1000,
    refresh_token: 'invalid',
    access_token: 'invalid',
    expires_in: 1800,
  };
  await resumeHASession({
    clientId: 'http://localhost:9/',
    redirectUrl: 'http://localhost:9/onboarding',
    saveTokens: () => {},
    loadTokens: async () => expiredToken,
  });
  assert(false, 'resumeHASession should reject for invalid tokens');
} catch (err) {
  assert(
    err instanceof HAAuthError || err instanceof HAConnectionError,
    'resumeHASession rejects with typed error for invalid tokens'
  );
}

// startHASignIn and resumeHASession are exported and callable
assert(typeof startHASignIn === 'function', 'startHASignIn exported as function');
assert(typeof resumeHASession === 'function', 'resumeHASession exported as function');

// ---------------------------------------------------------------------------
// THEMES
// ---------------------------------------------------------------------------

console.log('\n── THEMES ──');

const expectedThemeNames = ['aurora', 'sunset', 'ocean', 'forest'];
assertEqual(THEME_NAMES.length, 4, 'THEME_NAMES has exactly 4 identities');
assert(
  expectedThemeNames.every((n) => THEME_NAMES.includes(n)),
  'THEME_NAMES has exactly the 4 expected identities'
);
assert(
  Object.keys(THEMES).length === 4 && expectedThemeNames.every((n) => n in THEMES),
  'THEMES has exactly the 4 expected identities'
);

for (const name of THEME_NAMES) {
  assert(THEMES[name] && THEMES[name].light && THEMES[name].dark, `THEMES.${name} has light + dark variants`);
  assert(typeof THEME_LABELS[name] === 'string' && THEME_LABELS[name].length > 0, `THEME_LABELS.${name} is a non-empty string`);
}

// Spot-check known token values (aurora is the default identity)
assertEqual(THEMES.aurora.light.accent, '#f2941c', 'THEMES.aurora.light.accent');
assertEqual(THEMES.aurora.dark.accent, '#f5a623', 'THEMES.aurora.dark.accent');
assertEqual(THEMES.aurora.light.bg, '#f3f4f6', 'THEMES.aurora.light.bg');
assertEqual(THEMES.forest.dark.accent, '#5cc486', 'THEMES.forest.dark.accent');
assertEqual(THEMES.ocean.light.accent, '#2f7fd6', 'THEMES.ocean.light.accent');

// Every token set (across all identities and both modes) has identical key sets
const referenceKeys = Object.keys(THEMES.aurora.light).sort().join(',');
let allKeysMatch = true;
for (const name of THEME_NAMES) {
  for (const mode of ['light', 'dark']) {
    const keys = Object.keys(THEMES[name][mode]).sort().join(',');
    if (keys !== referenceKeys) allKeysMatch = false;
  }
}
assert(allKeysMatch, 'every THEMES token set has an identical key set');

// ---------------------------------------------------------------------------
// resolveThemeMode
// ---------------------------------------------------------------------------

console.log('\n── resolveThemeMode ──');

assertEqual(resolveThemeMode('auto', true), 'dark', "resolveThemeMode('auto', true) === 'dark'");
assertEqual(resolveThemeMode('auto', false), 'light', "resolveThemeMode('auto', false) === 'light'");
assertEqual(resolveThemeMode('dark', false), 'dark', "resolveThemeMode('dark', false) === 'dark'");
assertEqual(resolveThemeMode('light', true), 'light', "resolveThemeMode('light', true) === 'light'");

// ---------------------------------------------------------------------------
// accentOverride
// ---------------------------------------------------------------------------

console.log('\n── accentOverride ──');

const overrideLight = accentOverride(200, 'light');
const overrideDark = accentOverride(200, 'dark');

assert(typeof overrideLight.accent === 'string', 'accentOverride(light).accent is a string');
assert(typeof overrideLight.accentSoft === 'string', 'accentOverride(light).accentSoft is a string');
assert(typeof overrideLight.onAccent === 'string', 'accentOverride(light).onAccent is a string');
assert(
  overrideLight.accent !== overrideDark.accent ||
    overrideLight.accentSoft !== overrideDark.accentSoft ||
    overrideLight.onAccent !== overrideDark.onAccent,
  'accentOverride differs between light and dark mode'
);
assertEqual(overrideLight.accent, 'hsl(200, 78%, 50%)', 'accentOverride(200, light).accent');
assertEqual(overrideDark.accent, 'hsl(200, 78%, 60%)', 'accentOverride(200, dark).accent');
assertEqual(overrideLight.onAccent, '#ffffff', 'accentOverride(200, light).onAccent');
assertEqual(overrideDark.onAccent, '#140e04', 'accentOverride(200, dark).onAccent');

// ---------------------------------------------------------------------------
// buildHAAuthorizeUrl
// ---------------------------------------------------------------------------

console.log('\n── buildHAAuthorizeUrl ──');

const authorizeUrl = buildHAAuthorizeUrl({
  hassUrl: 'http://homeassistant.local:8123',
  clientId: 'hapulse-mobile',
  redirectUri: 'hapulse://auth-callback',
  state: 'xyz123',
});
assertEqual(
  authorizeUrl,
  'http://homeassistant.local:8123/auth/authorize?client_id=hapulse-mobile&redirect_uri=hapulse%3A%2F%2Fauth-callback&state=xyz123',
  'buildHAAuthorizeUrl encodes redirect_uri and appends state'
);

// Trailing-slash normalization of hassUrl
const authorizeUrlNoState = buildHAAuthorizeUrl({
  hassUrl: 'http://homeassistant.local:8123/',
  clientId: 'hapulse-mobile',
  redirectUri: 'hapulse://auth-callback',
});
assertEqual(
  authorizeUrlNoState,
  'http://homeassistant.local:8123/auth/authorize?client_id=hapulse-mobile&redirect_uri=hapulse%3A%2F%2Fauth-callback',
  'buildHAAuthorizeUrl strips trailing slash from hassUrl and omits state when absent'
);

// ---------------------------------------------------------------------------
// exchangeHAAuthCode
// ---------------------------------------------------------------------------

console.log('\n── exchangeHAAuthCode ──');

try {
  await exchangeHAAuthCode({
    hassUrl: 'http://localhost:9',
    clientId: 'hapulse-mobile',
    code: 'fake-code',
  });
  assert(false, 'exchangeHAAuthCode should reject for unreachable host');
} catch (err) {
  assert(err instanceof HAConnectionError, 'exchangeHAAuthCode rejects with HAConnectionError for unreachable host');
}

// ---------------------------------------------------------------------------
// connectWithAuthData + HAConnection.suspend (existence checks; no network)
// ---------------------------------------------------------------------------

console.log('\n── connectWithAuthData / suspend ──');

assert(typeof connectWithAuthData === 'function', 'connectWithAuthData exported as function');
assert(typeof HAConnection.prototype.suspend === 'function', 'HAConnection.prototype.suspend exported as function');

// ---------------------------------------------------------------------------
// HA-backed settings sync (frontend/user_data methods) — existence only, no network
// ---------------------------------------------------------------------------

console.log('\n── frontend/user_data methods ──');

assert(typeof HAConnection.prototype.getUserData === 'function', 'HAConnection.prototype.getUserData exported as function');
assert(typeof HAConnection.prototype.setUserData === 'function', 'HAConnection.prototype.setUserData exported as function');
assert(typeof HAConnection.prototype.subscribeUserData === 'function', 'HAConnection.prototype.subscribeUserData exported as function');

// ---------------------------------------------------------------------------
// i18n — translate()
// ---------------------------------------------------------------------------
console.log('\n── i18n: translate ──');

const EN = {
  'nav.devices': 'Devices',
  'devices.count.one': '{count} device',
  'devices.count.other': '{count} devices',
  'greeting': 'Hello {name}',
};
const FR = {
  'nav.devices': 'Appareils',
  'devices.count.one': '{count} appareil',
  'devices.count.other': '{count} appareils',
};

assertEqual(translate(EN, EN, 'en', 'nav.devices'), 'Devices', 'simple key');
assertEqual(translate(FR, EN, 'fr', 'nav.devices'), 'Appareils', 'translated key');

// Fallback: incomplete target dictionary → English
assertEqual(translate(FR, EN, 'fr', 'greeting', { name: 'Bap' }), 'Hello Bap',
  'falls back to en when the key is missing in the locale');

// Ultimate fallback: the key itself, never a blank screen
assertEqual(translate(EN, EN, 'en', 'inconnue.totale'), 'inconnue.totale',
  'falls back to the key when it is nowhere to be found');

// Interpolation: an unprovided variable is left visible, to spot the bug
assertEqual(translate(EN, EN, 'en', 'greeting'), 'Hello {name}',
  'unprovided variable left as-is');

// English plurals
assertEqual(translate(EN, EN, 'en', 'devices.count', { count: 1 }), '1 device', 'en, count=1 → singular');
assertEqual(translate(EN, EN, 'en', 'devices.count', { count: 2 }), '2 devices', 'en, count=2 → plural');
assertEqual(translate(EN, EN, 'en', 'devices.count', { count: 0 }), '0 devices', 'en, count=0 → plural');

// French plurals: the case that catches real regressions.
// In French, 0 and 1 both take the SINGULAR, unlike English.
assertEqual(translate(FR, EN, 'fr', 'devices.count', { count: 0 }), '0 appareil', 'fr, count=0 → singular');
assertEqual(translate(FR, EN, 'fr', 'devices.count', { count: 1 }), '1 appareil', 'fr, count=1 → singular');
assertEqual(translate(FR, EN, 'fr', 'devices.count', { count: 2 }), '2 appareils', 'fr, count=2 → plural');

// Non-integer and negative count values
assertEqual(translate(EN, EN, 'en', 'devices.count', { count: -1 }), '-1 device', 'en, count=-1 → singular (negative)');
assertEqual(translate(EN, EN, 'en', 'devices.count', { count: 1.5 }), '1.5 devices', 'en, count=1.5 → plural (fractional)');
assertEqual(translate(FR, EN, 'fr', 'devices.count', { count: -1 }), '-1 appareil', 'fr, count=-1 → singular (negative)');

// Completely empty target dictionary
const EMPTY_FR = {};
assertEqual(translate(EMPTY_FR, EN, 'fr', 'nav.devices'), 'Devices', 'empty dict → fallback English');
assertEqual(translate(EMPTY_FR, EN, 'fr', 'totally.unknown'), 'totally.unknown', 'empty dict, unknown key → key itself');

// ---------------------------------------------------------------------------
// i18n — resolveLanguage()
// ---------------------------------------------------------------------------
console.log('\n── i18n: resolveLanguage ──');

const AVAIL = ['en', 'fr'];

// An explicit preference wins over everything else
assertEqual(resolveLanguage('fr', 'en', ['en-US'], AVAIL), 'fr', 'explicit preference takes priority');

// auto: HA's language first
assertEqual(resolveLanguage('auto', 'fr', ['en-US'], AVAIL), 'fr', 'auto → HA language');

// auto: navigator second, when HA says nothing
assertEqual(resolveLanguage('auto', null, ['fr-FR', 'en'], AVAIL), 'fr', 'auto → navigator');

// Regional tags are reduced to the base language
assertEqual(resolveLanguage('auto', 'fr-CA', [], AVAIL), 'fr', 'fr-CA → fr');

// An unsupported HA language must not win: the chain continues
assertEqual(resolveLanguage('auto', 'de', ['fr-FR'], AVAIL), 'fr',
  'unsupported HA language → falls through to navigator');

// Last resort
assertEqual(resolveLanguage('auto', 'de', ['ja-JP'], AVAIL), 'en', 'no match → en');
assertEqual(resolveLanguage('auto', null, [], AVAIL), 'en', 'no information → en');

// An explicit preference that became unavailable must not block the UI
assertEqual(resolveLanguage('fr', null, [], ['en']), 'en', 'unavailable preference → en');

// ---------------------------------------------------------------------------
// i18n — dictionary parity (en/sv)
// ---------------------------------------------------------------------------
console.log('\n── i18n: en/sv parity ──');

const enKeys = Object.keys(EN_DICT).sort();
const svKeys = Object.keys(SV_DICT).sort();

const missingInSv = enKeys.filter((k) => !svKeys.includes(k));
const extraInSv = svKeys.filter((k) => !enKeys.includes(k));

assert(missingInSv.length === 0, `sv.json must not omit anything (missing: ${missingInSv.join(', ') || 'none'})`);
assert(extraInSv.length === 0, `sv.json must not add anything (extra: ${extraInSv.join(', ') || 'none'})`);

// Placeholders must survive translation
const dictPlaceholders = (s) => (s.match(/\{(\w+)\}/g) ?? []).sort().join(',');
for (const k of enKeys) {
  assertEqual(dictPlaceholders(SV_DICT[k] ?? ''), dictPlaceholders(EN_DICT[k]), `placeholders preserved for "${k}"`);
}

// Every .one key has a matching .other and vice versa, in both dictionaries —
// a lone .one/.other silently resolves to the raw key for the other plural
// category, which reads as a missing translation rather than a loud failure.
for (const [label, dict] of [['en', EN_DICT], ['sv', SV_DICT]]) {
  const keys = Object.keys(dict);
  const ones = keys.filter((k) => k.endsWith('.one'));
  const others = keys.filter((k) => k.endsWith('.other'));
  const oneWithoutOther = ones.filter((k) => !dict[`${k.slice(0, -4)}.other`]);
  const otherWithoutOne = others.filter((k) => !dict[`${k.slice(0, -6)}.one`]);
  assert(oneWithoutOther.length === 0, `${label}.json: every .one has a matching .other (missing: ${oneWithoutOther.join(', ') || 'none'})`);
  assert(otherWithoutOne.length === 0, `${label}.json: every .other has a matching .one (missing: ${otherWithoutOne.join(', ') || 'none'})`);
}

// Every value containing {count} belongs to a .one/.other pair — a plural
// placeholder outside that shape means the plural category was never selected.
for (const [label, dict] of [['en', EN_DICT], ['sv', SV_DICT]]) {
  for (const [k, v] of Object.entries(dict)) {
    if (v.includes('{count}') && !k.endsWith('.one') && !k.endsWith('.other')) {
      assert(false, `${label}.json: "${k}" contains {count} but is not a .one/.other key`);
    }
  }
}

// ---------------------------------------------------------------------------
// Finish (after ticker or timeout)
// ---------------------------------------------------------------------------

const timeout = setTimeout(() => {
  if (!tickerFired) {
    console.error('  ✗ FAIL: createDemoTicker never fired within 8s');
    failed++;
  }
  finish();
}, 8000);

function finish() {
  clearTimeout(timeout);
  console.log(`\n── Results: ${passed} passed, ${failed} failed ──\n`);
  if (failed > 0) {
    process.exit(1);
  }
}
