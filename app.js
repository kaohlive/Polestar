'use strict';

const Homey = require('homey');
const moment = require('moment');

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

		// Don't ever log credentials or tokens in plaintext. For sensitive keys we
		// log the string length so we can still verify the user entered something.
		const SENSITIVE_KEYS = new Set(['user_email', 'user_password', 'polestar_token']);
		this.homey.settings.on('set', (key) => {
			if (key === 'debugLog') return;
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
				this.log(devices[0].getData().registration)
				return Object.values(devices)
				  .map(device => ({
					name: device.getName(),
					registration: device.getData().registration,
				  }))
				  .filter(vehicle => vehicle.name.toLowerCase().includes(query.toLowerCase()));
			  });
		  } catch (err) {
			this.log(`Dashboards might not be available: ${err.message}`);
		  }
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