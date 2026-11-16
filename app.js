'use strict';

const Homey = require('homey');
const moment = require('moment');
const SecretStore = require('./lib/secretStore');
const HomeyCrypt = require('./lib/homeycrypt');
const { DataPortalClient } = require('./lib/dataportal');

const AUTH_LOG_KEY = 'authLog';
const AUTH_LOG_MAX = 50;

// Auth events (from clone_modules/polestar-c3/auth.js and the migration below)
// and how loudly each one is logged.
const AUTH_EVENT_SEVERITY = {
	session_restored: 'DEBUG',
	refresh_failed: 'WARNING',
	password_login: 'WARNING',
	password_login_failed: 'ERROR',
	password_unavailable: 'ERROR',
	legacy_password_login: 'DEBUG',
	migration_ok: 'DEBUG',
	migration_failed: 'ERROR',
	credentials_saved: 'DEBUG',
};

class Polestar extends Homey.App {
	async onInit() {
		this.userLanguage = this.homey.i18n.getLanguage();
		moment.locale(this.userLanguage == 'no' ? 'nb' : 'en');

		this.homey.settings.set('debugLog', null);

		this.log(this.homey.__({
			nl: 'Polestar App is geinitialiseert',
			en: 'Polestar App has been initialized',
			no: 'Polestar App har blitt initialisert'
		}));

		// Before any device starts: move a MAC-salted password to the random-key
		// format while the old salt still decrypts it.
		await this.migrateCredentials();

		// Don't ever log credentials or tokens in plaintext. For sensitive keys we
		// log the string length so we can still verify the user entered something.
		const SENSITIVE_KEYS = new Set(['user_email', 'user_password', 'polestar_token',
			SecretStore.KEY_SETTING, 'dataportal_client_id', 'dataportal_client_secret', 'dataportal_account_id']);
		this.homey.settings.on('set', (key) => {
			if (key === 'debugLog' || key === AUTH_LOG_KEY || key === 'dataportal_status') return;
			const value = this.homey.settings.get(key);
			const display = SENSITIVE_KEYS.has(key)
				? (typeof value === 'string' && value.length > 0 ? `[${value.length} chars]` : '[empty]')
				: value;
			this.log(this.homey.__({
				nl: 'Setting bijgewerkt:',
				en: 'Setting updated:',
				no: 'Innstilling oppdatert:'
			}), 'Polestar App', 'DEBUG', `${key}: ${display}`);
		});

		try {
			this.homey.dashboards
			  .getWidget('dashboard')
			  .registerSettingAutocompleteListener('device', async (query, settings) => {
				this.log("List Polestar vehicles for widget settings")
				const driver = await this.homey.drivers.getDriver('vehicle');
				const devices = await driver.getDevices();
				this.log('Located '+devices.length+' vehicles: filter using '+query)
				// Homey stores the picked entry verbatim, so this object is the
				// widget's identity. The VIN is what the dashboard API keys on;
				// registration rides along so widgets configured before the VIN
				// switch keep resolving through the fallback.
				return Object.values(devices)
				  .map(device => {
					const data = device.getData();
					return {
					  name: device.getName(),
					  vin: data.vin,
					  registration: data.registration || null,
					};
				  })
				  .filter(vehicle => vehicle.name.toLowerCase().includes(query.toLowerCase()));
			  });
		  } catch (err) {
			this.log(`Dashboards might not be available: ${err.message}`);
		  }
	}

	// ---- Polestar ID credentials -------------------------------------------

	/**
	 * One-time move from the MAC-salted format (lib/homeycrypt.js) to the
	 * random-key format (lib/secretStore.js). If the old salt no longer
	 * decrypts (MAC already changed), the password is unreadable: devices keep
	 * working on their stored refresh token, and a repair stores it anew.
	 */
	async migrateCredentials() {
		const email = this.homey.settings.get('user_email');
		const stored = this.homey.settings.get('user_password');
		if (!email || typeof stored !== 'string' || stored === '' || SecretStore.isEncrypted(stored)) return;
		try {
			const plain = await this._decryptLegacyPassword(stored, email);
			this.homey.settings.set('user_password', SecretStore.encrypt(this.homey, plain));
			this.logAuth('migration_ok', 'Polestar App', { note: 'password re-encrypted with installation key' });
		} catch (err) {
			this.logAuth('migration_failed', 'Polestar App', {
				note: 'stored password could not be decrypted with the old network-based key; repair the device if the session is lost',
				error: err.message,
			});
		}
	}

	/** Returns the Polestar ID password, or throws when none can be read. */
	async getPassword() {
		const email = this.homey.settings.get('user_email');
		const stored = this.homey.settings.get('user_password');
		if (typeof stored !== 'string' || stored === '') throw new Error('No password stored');
		if (SecretStore.isEncrypted(stored)) return SecretStore.decrypt(this.homey, stored);
		// Not migrated yet (or the old salt broke): try once more, migrate on success.
		const plain = await this._decryptLegacyPassword(stored, email);
		this.homey.settings.set('user_password', SecretStore.encrypt(this.homey, plain));
		this.logAuth('migration_ok', 'Polestar App', { note: 'password re-encrypted on first use' });
		return plain;
	}

	async _decryptLegacyPassword(stored, email) {
		// Before 3.5.0 the settings page saved the password field as typed, so
		// a value that is not the old cipher's hex output is a plain password.
		if (!/^[0-9a-f]+$/i.test(stored) || stored.length % 32 !== 0) return stored;
		return HomeyCrypt.decrypt(stored, email);
	}

	getEmail() {
		return this.homey.settings.get('user_email') || '';
	}

	setCredentials(email, password) {
		this.homey.settings.set('user_email', email);
		if (password) this.homey.settings.set('user_password', SecretStore.encrypt(this.homey, password));
		this.logAuth('credentials_saved', 'Polestar App', { passwordChanged: !!password });
	}

	encryptSecret(value) { return SecretStore.encrypt(this.homey, value); }
	decryptSecret(value) { return SecretStore.decrypt(this.homey, value); }

	// ---- Auth log: a separate, persistent buffer shown in the app settings ----

	logAuth(type, source = 'Polestar App', detail = {}) {
		const severity = AUTH_EVENT_SEVERITY[type] || 'DEBUG';
		const now = new Date();
		const entry = {
			at: now.toISOString(),
			registered: `${now.toLocaleDateString(this.userLanguage, { dateStyle: 'short', timeZone: 'Europe/Oslo' })} ${now.toLocaleTimeString(this.userLanguage, { timeStyle: 'medium', timeZone: 'Europe/Oslo' })}`,
			type,
			severity,
			source,
			detail,
		};
		// Unlike debugLog, this one survives app restarts: it exists to show
		// how often a password login was needed over days and weeks.
		const list = this.homey.settings.get(AUTH_LOG_KEY) || [];
		list.push(entry);
		while (list.length > AUTH_LOG_MAX) list.shift();
		this.homey.settings.set(AUTH_LOG_KEY, list);
		this.homey.api.realtime(AUTH_LOG_KEY, entry);
		this.log(`Auth: ${type}`, source, severity, detail);
	}

	clearAuthLog() {
		this.homey.settings.set(AUTH_LOG_KEY, []);
	}

	// ---- Polestar Data Portal (EU) -----------------------------------------

	getDataPortalConfig() {
		return {
			enabled: this.homey.settings.get('dataportal_enabled') === true,
			clientId: this.homey.settings.get('dataportal_client_id') || '',
			accountId: this.homey.settings.get('dataportal_account_id') || '',
			hasSecret: !!this.homey.settings.get('dataportal_client_secret'),
			status: this.homey.settings.get('dataportal_status') || null,
		};
	}

	/** Shared client (one token for all vehicles), or null when the feature is off. */
	getDataPortalClient() {
		const cfg = this.getDataPortalConfig();
		if (!cfg.enabled || !cfg.clientId || !cfg.accountId || !cfg.hasSecret) return null;
		if (!this._dataPortalClient) {
			let secret;
			try {
				secret = SecretStore.decrypt(this.homey, this.homey.settings.get('dataportal_client_secret'));
			} catch (err) {
				this.log('Data Portal: stored client secret cannot be read', 'Polestar App', 'ERROR', err);
				return null;
			}
			this._dataPortalClient = new DataPortalClient({ clientId: cfg.clientId, clientSecret: secret, accountId: cfg.accountId });
		}
		return this._dataPortalClient;
	}

	/**
	 * Save Data Portal settings from the settings page. When enabling, the
	 * credentials are tested first and nothing is stored if they fail.
	 */
	async saveDataPortalConfig({ enabled, clientId, clientSecret, accountId }) {
		clientId = (clientId || '').trim();
		accountId = (accountId || '').trim();
		clientSecret = (clientSecret || '').trim();
		let secret = clientSecret;
		if (!secret && this.homey.settings.get('dataportal_client_secret')) {
			secret = SecretStore.decrypt(this.homey, this.homey.settings.get('dataportal_client_secret'));
		}

		let status;
		if (enabled) {
			const client = new DataPortalClient({ clientId, clientSecret: secret, accountId });
			const vins = await client.getVehicles();
			const devices = this.homey.drivers.getDriver('vehicle').getDevices();
			const matched = devices.filter((d) => vins.includes(d.getData().vin)).length;
			status = { ok: true, checkedAt: new Date().toISOString(), vehicles: vins.length, matched, scopes: client.scopes };
		} else {
			status = null;
		}

		this.homey.settings.set('dataportal_client_id', clientId);
		this.homey.settings.set('dataportal_account_id', accountId);
		if (clientSecret) this.homey.settings.set('dataportal_client_secret', SecretStore.encrypt(this.homey, clientSecret));
		this.homey.settings.set('dataportal_status', status);
		this.homey.settings.set('dataportal_enabled', !!enabled);
		this._dataPortalClient = null;

		for (const device of this.homey.drivers.getDriver('vehicle').getDevices()) {
			if (typeof device.onDataPortalChanged === 'function') {
				device.onDataPortalChanged().catch((err) =>
					this.log('Data Portal: device update failed', device.getName(), 'ERROR', err));
			}
		}
		return this.getDataPortalConfig();
	}

	async log(message, instance = 'Polestar App', severity = 'DEBUG', data = null) {
		const now = new Date();

		let datestring = now.toLocaleDateString(this.userLanguage, {
			dateStyle: 'short',
			timeZone: 'Europe/Oslo'
		});
		let timestring = now.toLocaleTimeString(this.userLanguage, {
			timeStyle: 'medium',
			timeZone: 'Europe/Oslo'
		});

		let debugDateString = `${datestring} ${timestring}`;
		datestring = `${datestring} - ${timestring}`;

		const debugLog = this.homey.settings.get('debugLog') || [];
		const entry = { registered: debugDateString, severity, message };

		switch (severity) {
			case 'DEBUG':
				severity = '\x1b[36mDEBUG\x1b[0m';
				break;
			case 'WARNING':
				severity = '\x1b[33mWARNING\x1b[0m';
				break;
			case 'ERROR':
				severity = '\x1b[31mERROR\x1b[0m';
				break;
			default:
				severity = '\x1b[36mDEBUG\x1b[0m';
				break;
		}

		const logMessage = `${datestring} [${instance}] [${severity}] ${message}`;

		// Use a nullish check so we still log explicit 0 / false / '' values —
		// `if (data)` would silently drop them and we'd be unable to tell
		// "vehicle count: 0" from "vehicle count: undefined" in the log.
		if (data !== null && data !== undefined) {
			console.log(logMessage, data);

			if (typeof data === 'string') {
				entry.data = { data };
			} else if (data && data.message) {
				entry.data = { error: data.message, stacktrace: data.stack };
			} else {
				entry.data = data;
			}
		} else {
			console.log(logMessage);
		}

		debugLog.push(entry);
		if (debugLog.length > 100) {
			debugLog.splice(0, 1);
		}
		this.homey.settings.set('debugLog', debugLog);
		this.homey.api.realtime('debugLog', entry);
	}
}

module.exports = Polestar;