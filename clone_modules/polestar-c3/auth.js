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

class AuthManager {
    constructor() {
        this._tokens = null;
        this._authEndpoint = null;
        this._tokenEndpoint = null;
    }

    get accessToken() { return this._tokens ? this._tokens.access_token : null; }
    get isExpired() {
        if (!this._tokens) return true;
        if (!this._tokens.expires_at) return false;
        return Date.now() > this._tokens.expires_at - 60_000;
    }

    async _discover() {
        if (this._authEndpoint && this._tokenEndpoint) return;
        const r = await axios.get(OIDC_DISCOVERY, { timeout: 30000 });
        this._authEndpoint = r.data.authorization_endpoint;
        this._tokenEndpoint = r.data.token_endpoint;
    }

    async authenticate(email, password) {
        this._email = email;
        this._password = password;
        await this._discover();
        await this._fullAuth(email, password);
    }

    async ensureValidToken() {
        if (!this._tokens) throw new Error('Not authenticated');
        if (this.isExpired) {
            if (this._tokens.refresh_token) {
                try { await this._refresh(); return this._tokens.access_token; }
                catch (_) { /* fall through */ }
            }
            if (this._email && this._password) {
                await this._fullAuth(this._email, this._password);
            } else {
                throw new Error('Token expired and no credentials available');
            }
        }
        return this._tokens.access_token;
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
        if (r.status !== 200) throw new Error(`Refresh failed: ${r.status}`);
        this._storeTokens(r.data);
    }

    _storeTokens(data) {
        this._tokens = {
            access_token: data.access_token,
            refresh_token: data.refresh_token || (this._tokens && this._tokens.refresh_token) || null,
            token_type: data.token_type || 'Bearer',
            expires_in: data.expires_in || 0,
            expires_at: data.expires_in ? Date.now() + data.expires_in * 1000 : 0,
        };
    }
}

module.exports = { AuthManager, CLIENT_ID, REDIRECT_URI };
