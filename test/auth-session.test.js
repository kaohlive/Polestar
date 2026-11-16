'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { AuthManager, RefreshRejectedError } = require('../clone_modules/polestar-c3/auth');
const SecretStore = require('../lib/secretStore');

// AuthManager with the network calls replaced: _refresh / _fullAuth only
// record that they ran and hand out tokens.
function makeAuth({ tokens = null, refresh = 'ok' } = {}) {
    const events = [];
    const saved = [];
    const calls = { refresh: 0, password: 0, passwordProvider: 0 };
    const auth = new AuthManager({
        tokens,
        onTokens: (t) => saved.push(t),
        onEvent: (type, detail) => events.push({ type, detail }),
    });
    auth._discover = async () => {};
    auth._refresh = async () => {
        calls.refresh++;
        if (refresh === 'rejected') throw new RefreshRejectedError('Refresh failed: 400 invalid_grant');
        if (refresh === 'transient') throw new Error('Refresh failed: 503');
        auth._storeTokens({ access_token: 'A2', refresh_token: 'R2', expires_in: 3600 });
    };
    auth._fullAuth = async () => {
        calls.password++;
        auth._storeTokens({ access_token: 'A1', refresh_token: 'R1', expires_in: 3600 });
    };
    const password = async () => { calls.passwordProvider++; return 'secret'; };
    return { auth, events, saved, calls, password };
}

test('a stored refresh token restores the session without touching the password', async () => {
    const { auth, events, saved, calls, password } = makeAuth({ tokens: { refresh_token: 'R0' } });
    await auth.authenticate('me@example.com', password);
    assert.equal(calls.refresh, 1);
    assert.equal(calls.password, 0);
    assert.equal(calls.passwordProvider, 0);
    assert.equal(auth.accessToken, 'A2');
    assert.equal(saved.at(-1).refresh_token, 'R2');
    assert.deepEqual(events.map((e) => e.type), ['session_restored']);
});

test('no stored token: password login, logged with its reason', async () => {
    const { auth, events, calls, password } = makeAuth();
    await auth.authenticate('me@example.com', password);
    assert.equal(calls.refresh, 0);
    assert.equal(calls.password, 1);
    assert.deepEqual(events.map((e) => [e.type, e.detail.reason]), [['password_login', 'no_stored_token']]);
});

test('a rejected refresh falls back to the password and logs both steps', async () => {
    const { auth, events, calls, password } = makeAuth({ tokens: { refresh_token: 'R0' }, refresh: 'rejected' });
    await auth.authenticate('me@example.com', password);
    assert.equal(calls.password, 1);
    assert.deepEqual(events.map((e) => e.type), ['refresh_failed', 'password_login']);
    assert.match(events[0].detail.reason, /invalid_grant/);
});

test('a transient refresh failure keeps the token and does not use the password', async () => {
    const { auth, events, calls, password } = makeAuth({ tokens: { refresh_token: 'R0' }, refresh: 'transient' });
    await assert.rejects(auth.authenticate('me@example.com', password), /503/);
    assert.equal(calls.passwordProvider, 0);
    assert.deepEqual(events, []);
});

test('refresh rejected and password unreadable: password_unavailable, asks for repair', async () => {
    const { auth, events } = makeAuth({ tokens: { refresh_token: 'R0' }, refresh: 'rejected' });
    const broken = async () => { throw new Error('No password stored'); };
    await assert.rejects(auth.authenticate('me@example.com', broken), /repair the device/);
    assert.deepEqual(events.map((e) => e.type), ['refresh_failed', 'password_unavailable']);
});

test('concurrent expiry shares one refresh (a rotating token is not spent twice)', async () => {
    const { auth, calls, password } = makeAuth({ tokens: { refresh_token: 'R0' } });
    await auth.authenticate('me@example.com', password);
    auth._tokens.expires_at = Date.now() - 1000;
    let release;
    const gate = new Promise((r) => { release = r; });
    const original = auth._refresh;
    auth._refresh = async () => { await gate; return original(); };
    const p = Promise.all([auth.ensureValidToken(), auth.ensureValidToken(), auth.ensureValidToken()]);
    release();
    await p;
    assert.equal(calls.refresh, 2); // one at startup, one shared renewal
});

function fakeHomey() {
    const store = new Map();
    return { settings: { get: (k) => store.get(k), set: (k, v) => store.set(k, v) }, _store: store };
}

test('secretStore round-trips and keeps one key per installation', () => {
    const homey = fakeHomey();
    const a = SecretStore.encrypt(homey, 'p@ssw0rd');
    const b = SecretStore.encrypt(homey, 'p@ssw0rd');
    assert.ok(SecretStore.isEncrypted(a));
    assert.notEqual(a, b, 'random IV per encryption');
    assert.equal(SecretStore.decrypt(homey, a), 'p@ssw0rd');
    assert.equal(SecretStore.decrypt(homey, b), 'p@ssw0rd');
    assert.equal(homey._store.size, 1, 'only the key setting is written');
});

test('secretStore refuses a value from another installation', () => {
    const value = SecretStore.encrypt(fakeHomey(), 'p@ssw0rd');
    assert.throws(() => SecretStore.decrypt(fakeHomey(), value));
});
