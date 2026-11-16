'use strict';

// App API used by settings/index.html. Secrets go through here instead of
// Homey.set() so they are encrypted before they are stored, and are never
// handed back to the page.

module.exports = {
    async saveAccount({ homey, body }) {
        const email = (body && body.email || '').trim();
        if (!email) throw new Error('E-mail is required');
        homey.app.setCredentials(email, body.password || null);
        if (body.distanceUnit === 'km' || body.distanceUnit === 'miles') {
            homey.settings.set('distance_unit', body.distanceUnit);
        }
        return { ok: true };
    },

    async getDataPortal({ homey }) {
        return homey.app.getDataPortalConfig();
    },

    async saveDataPortal({ homey, body }) {
        return homey.app.saveDataPortalConfig(body || {});
    },

    async clearAuthLog({ homey }) {
        homey.app.clearAuthLog();
        return { ok: true };
    },
};
