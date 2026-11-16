'use strict';

const crypto = require('crypto');
const axios = require('axios');
const qs = require('qs');

const OIDC_PROVIDER = 'https://polestarid.eu.polestar.com';
const OIDC_DISCOVERY = `${OIDC_PROVIDER}/.well-known/openid-configuration`;
const CLIENT_ID = 'lp8dyrd_10';
const REDIRECT_URI = 'polestar-explore://explore.polestar.com';
const SCOPES = 'openid profile email customer:attributes customer:attributes:write';

function b64url(buf) {
    return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function generatePkce() {
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    return { verifier, challenge };
}

function generateState() {
    return b64url(crypto.randomBytes(32));
}

/**
 * A refresh that the identity provider rejected outright (expired, revoked,
 * rotated away). Anything else — network trouble, a 5xx — is transient: the
 * refresh token is kept and the caller simply retries later, instead of
 * falling back to a password login that would fail for the same reason.
 */
class RefreshRejectedError extends Error {}

class AuthManager {
    /**
     * @param {object}   [opts]
     * @param {object}   [opts.tokens]   previously persisted tokens ({ refresh_token, ... })
     * @param {function} [opts.onTokens] called with a copy of the tokens after every login/refresh
     * @param {function} [opts.onEvent]  called with (type, detail) for auth events worth logging:
     *                                   session_restored, refresh_failed, password_login,
     *                                   password_login_failed, password_unavailable
     */
    constructor({ tokens = null, onTokens = null, onEvent = null } = {}) {
        this._tokens = tokens && tokens.refresh_token ? { ...tokens, expires_at: 0 } : null;
        this._onTokens = onTokens;
        this._onEvent = onEvent;
        this._authEndpoint = null;
        this._tokenEndpoint = null;
        this._renewing = null;
    }

    get accessToken() { return this._tokens ? this._tokens.access_token : null; }
    get isExpired() {
        if (!this._tokens || !this._tokens.access_token) return true;
        if (!this._tokens.expires_at) return false;
        return Date.now() > this._tokens.expires_at - 60_000;
    }

    _emit(type, detail = {}) {
        if (!this._onEvent) return;
        try { this._onEvent(type, detail); } catch (_) { /* logging must never break auth */ }
    }

    async _discover() {
        if (this._authEndpoint && this._tokenEndpoint) return;
        const r = await axios.get(OIDC_DISCOVERY, { timeout: 30000 });
        this._authEndpoint = r.data.authorization_endpoint;
        this._tokenEndpoint = r.data.token_endpoint;
    }

    /**
     * Log in, preferring a stored refresh token over the password.
     * @param {string} email
     * @param {string|function} password  the password, or an (async) function
     *        returning it — only called when a password login is really needed.
     */
    async authenticate(email, password) {
        this._email = email;
        this._password = password;
        await this._discover();
        await this._renew('startup');
        if (!this._lastRenewWasPassword) {
            this._emit('session_restored', {
                rotated: this._tokens.refresh_rotated,
                refreshExpiresIn: this._tokens.refresh_expires_in,
            });
        }
    }

    async ensureValidToken() {
        if (!this._tokens || !this._tokens.access_token) throw new Error('Not authenticated');
        if (this.isExpired) await this._renew('runtime');
        return this._tokens.access_token;
    }

    /** Single-flight: concurrent callers share one refresh, so a rotating
     *  refresh token is never spent twice. */
    _renew(phase) {
        if (!this._renewing) {
            this._renewing = this._doRenew(phase).finally(() => { this._renewing = null; });
        }
        return this._renewing;
    }

    async _doRenew(phase) {
        this._lastRenewWasPassword = false;
        let reason = 'no_stored_token';
        if (this._tokens && this._tokens.refresh_token) {
            try {
                await this._refresh();
                return;
            } catch (err) {
                if (!(err instanceof RefreshRejectedError)) throw err; // transient: keep token, retry later
                this._emit('refresh_failed', { phase, reason: err.message });
                reason = 'refresh_rejected';
            }
        }
        await this._passwordLogin(reason, phase);
        this._lastRenewWasPassword = true;
    }

    async _passwordLogin(reason, phase) {
        let password = null;
        try {
            password = typeof this._password === 'function' ? await this._password() : this._password;
        } catch (err) {
            this._emit('password_unavailable', { phase, reason, error: err.message });
            throw new Error('Login required: stored password cannot be read — repair the device');
        }
        if (!this._email || !password) {
            this._emit('password_unavailable', { phase, reason });
            throw new Error('Login required: no valid session and no password stored — repair the device');
        }
        try {
            await this._fullAuth(this._email, password);
        } catch (err) {
            this._emit('password_login_failed', { phase, reason, error: err.message });
            throw err;
        }
        this._emit('password_login', { phase, reason });
    }

    async _fullAuth(email, password) {
        const { verifier, challenge } = generatePkce();
        const code = await this._authorize(challenge, email, password);
        await this._exchange(code, verifier);
    }

    async _authorize(codeChallenge, email, password) {
        const state = generateState();
        const params = {
            response_type: 'code',
            client_id: CLIENT_ID,
            redirect_uri: REDIRECT_URI,
            scope: SCOPES,
            state,
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
            response_mode: 'query',
        };

        // Step 1: follow through to login form, collecting cookies.
        const jar = [];
        const collectCookies = (res) => {
            const sc = res.headers && res.headers['set-cookie'];
            if (sc) for (const c of sc) jar.push(c.split(';')[0]);
        };
        const cookieHeader = () => jar.join('; ');

        let r = await axios.get(this._authEndpoint, {
            params,
            maxRedirects: 0,
            validateStatus: () => true,
        });
        collectCookies(r);
        // Follow redirects manually so we can keep cookies.
        while (r.status >= 300 && r.status < 400 && r.headers.location) {
            const loc = r.headers.location.startsWith('http') ? r.headers.location : OIDC_PROVIDER + r.headers.location;
            r = await axios.get(loc, { maxRedirects: 0, validateStatus: () => true, headers: { cookie: cookieHeader() } });
            collectCookies(r);
        }

        const html = typeof r.data === 'string' ? r.data : '';
        const m = html.match(/(?:url|action)\s*:\s*"([^"]+)"/);
        if (!m) throw new Error(`Auth page did not contain resume URL (status ${r.status})`);
        const resumeUrl = m[1].startsWith('http') ? m[1] : OIDC_PROVIDER + m[1];

        // Step 2: post credentials.
        r = await axios.post(resumeUrl, qs.stringify({ 'pf.username': email, 'pf.pass': password }), {
            params,
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
                cookie: cookieHeader(),
            },
            maxRedirects: 0,
            validateStatus: () => true,
        });
        collectCookies(r);

        if (r.status !== 302 && r.status !== 303) {
            const body = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
            if (body.includes('ERR001')) throw new Error('Invalid username or password');
            throw new Error(`Auth failed with status ${r.status}`);
        }

        let location = r.headers.location || '';
        let parsed = new URL(location, OIDC_PROVIDER);
        let code = parsed.searchParams.get('code');
        const uid = parsed.searchParams.get('uid');

        // Terms & Conditions flow.
        if (!code && uid) {
            r = await axios.post(resumeUrl, qs.stringify({ 'pf.submit': 'true', subject: uid }), {
                params,
                headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookieHeader() },
                maxRedirects: 0,
                validateStatus: () => true,
            });
            collectCookies(r);
            if (r.status === 302 || r.status === 303) {
                location = r.headers.location || '';
                parsed = new URL(location, OIDC_PROVIDER);
                code = parsed.searchParams.get('code');
            }
        }

        if (!code) throw new Error(`No auth code in redirect: ${location}`);
        return code;
    }

    async _exchange(code, verifier) {
        const r = await axios.post(this._tokenEndpoint, qs.stringify({
            grant_type: 'authorization_code',
            code,
            redirect_uri: REDIRECT_URI,
            client_id: CLIENT_ID,
            code_verifier: verifier,
        }), {
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            validateStatus: () => true,
            timeout: 30000,
        });
        if (r.status !== 200) throw new Error(`Token exchange failed: ${r.status} ${JSON.stringify(r.data)}`);
        this._storeTokens(r.data);
    }

    async _refresh() {
        const r = await axios.post(this._tokenEndpoint, qs.stringify({
            grant_type: 'refresh_token',
            refresh_token: this._tokens.refresh_token,
            client_id: CLIENT_ID,
        }), {
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            validateStatus: () => true,
            timeout: 30000,
        });
        if (r.status !== 200) {
            const code = r.data && typeof r.data === 'object' && r.data.error ? ` ${r.data.error}` : '';
            const msg = `Refresh failed: ${r.status}${code}`;
            // 400/401 = the IdP rejected this refresh token (invalid_grant & co).
            if (r.status === 400 || r.status === 401) throw new RefreshRejectedError(msg);
            throw new Error(msg);
        }
        this._storeTokens(r.data);
    }

    _storeTokens(data) {
        this._tokens = {
            access_token: data.access_token,
            refresh_token: data.refresh_token || (this._tokens && this._tokens.refresh_token) || null,
            token_type: data.token_type || 'Bearer',
            expires_in: data.expires_in || 0,
            expires_at: data.expires_in ? Date.now() + data.expires_in * 1000 : 0,
            // Diagnostics only: lets the auth log show how long refresh tokens live
            // and whether Polestar rotates them.
            refresh_rotated: !!data.refresh_token,
            refresh_expires_in: data.refresh_expires_in || data.refresh_token_expires_in || null,
            obtained_at: Date.now(),
        };
        if (this._onTokens) {
            try { this._onTokens({ ...this._tokens }); } catch (_) { /* persisting is best-effort */ }
        }
    }
}

module.exports = { AuthManager, RefreshRejectedError, CLIENT_ID, REDIRECT_URI };
