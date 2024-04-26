'use strict';

const { Device } = require('homey');
const moment = require('moment');
const axios = require('axios');
const geolib = require('geolib');
const base64url = require('base64-url');

class PolestarBetaDevice extends Device {
    async onInit() {
        this.name = this.getName();

        this.homey.app.log(this.homey.__({
            en: `${this.name} has been initialized`,
            no: `${this.name} har blitt initialisert`,
            nl: `${this.name} is geinitialiseerd`,
        }), this.name, 'DEBUG');

        moment.locale(this.homey.i18n.getLanguage() == 'no' ? 'nb' : 'en');
        this.locale = this.homey.i18n.getLanguage() == 'no' ? 'nb' : 'en';

        this.homeyId = await this.homey.cloud.getHomeyId();
        this.settings = await this.getSettings();
        this.capabilities = this.getCapabilities();
        this.slug = this.settings.webhook_slug || null;
        this.tripSummaryEnabled = this.settings.tripSummaryEnabled || false;
        this.vehicleId = this.getData().id;
        this.vehicleData = null;
        this.updatedInterval = null;
        this.previousLat = null;
        this.previousLon = null;
        this.threshold = 10; // Threshold in meters for distance updates
        /*if (this.settings.tripSummaryEnabled) {
            this.tripSummaryImage = await this.homey.images.createImage();
            this.tripInfoImage = await this.homey.images.createImage();
            this.tripScoreImage = await this.homey.images.createImage();
            const lastTripString = this.homey.__({ "en": "Last trip", "no": "Din siste tur" });
            const lastTripInfoString = this.homey.__({ "en": "Last trip info", "no": "Tur-informasjon" });
            const lastTripScoreString = this.homey.__({ "en": "Trip score", "no": "Kjørescore" });
            await this.setCameraImage('polestarTrip', lastTripString, this.tripSummaryImage);
            await this.setCameraImage('polestarTripInfo', lastTripInfoString, this.tripInfoImage);
            await this.setCameraImage('polestarTripScore', lastTripScoreString, this.tripScoreImage);
        }*/
        this.webhook = null;
        this.apiUrl = 'https://homey.crdx.us';

        await this.initWebhook();

        await this.updateLastUpdated();
        this.updatedInterval = this.homey.setInterval(async () => {
            await this.updateLastUpdated();
        }, 60 * 1000);

        await this.initListeners();

        this.homey.app.log(this.homey.__({
            en: 'Interval for ' + this.name + ' has been set',
            no: 'Intervall for ' + this.name + ' har blitt satt'
        }), this.name, 'DEBUG');
    }

    async initListeners() {
        this.homey.app.log(this.homey.__({
            en: 'Initializing listeners for ' + this.name,
            no: 'Initialiserer lytter for ' + this.name
        }), this.name, 'DEBUG');

        if (this.hasCapability('measure_polestarPower')) {
            return this.registerCapabilityListener('measure_polestarPower', async (value) => {
                console.log(value);
            });
        } else {
            this.homey.app.log(this.homey.__({
                en: 'Capability measure_polestarPower not found for ' + this.name,
                no: 'Capability measure_polestarPower ikke funnet for ' + this.name
            }), this.name, 'DEBUG');
        }
    }

    async initWebhook() {
        let drivingData = [];
        let tripEndTimer = null;
        let tripInProgress = false;

        /*const updateImage = async () => {
            const encodedSlug = base64url.encode(this.slug);
            this.tripSummaryImage.setUrl(`${this.apiUrl}/tripSummary/${encodedSlug}?mapType=${this.settings.mapImageType}&theme=${this.settings.tripSummaryStyle}&lang=${this.locale}`);
            this.tripInfoImage.setUrl(`${this.apiUrl}/tripInfo/${encodedSlug}?theme=${this.settings.tripInfoStyle}&lang=${this.locale}`);
            this.tripScoreImage.setUrl(`${this.apiUrl}/tripScore/${encodedSlug}?theme=${this.settings.tripScoreStyle}&lang=${this.locale}`);
            await this.tripSummaryImage.update();
            await this.tripInfoImage.update();
            await this.tripScoreImage.update();

            this.homey.app.log(this.homey.__({
                en: 'Updated image(s) for ' + this.name,
                no: 'Oppdaterte bilde(r) for ' + this.name
            }), this.name, 'DEBUG');
        }

        if (this.tripSummaryEnabled) {
            await updateImage();
        }*/

        const id = this.settings.webhook_id || null;
        const secret = this.settings.webhook_secret || null;
        const data = {};
        this.webhook = await this.homey.cloud.createWebhook(id, secret, data);

        this.webhook.on('message', async args => {
            const fields = ['ambientTemperature', 'batteryLevel', 'chargePortConnected', 'ignitionState', 'power', 'selectedGear', 'speed', 'stateOfCharge'];
            const isDataMissing = fields.some(field => args.body[field] === undefined || args.body[field] === null);
            const hasFields = ['drivingPoints'];
            const hasData = hasFields.some(field => args.body[field] !== undefined && args.body[field] !== null);

            if (!args.body || isDataMissing) {
                this.homey.app.log(this.homey.__({
                    en: 'Received webhook message for ' + this.name + ' but data is missing.',
                    no: 'Mottok webhook data med kjøretøydata for ' + this.name + ' men mangler data.'
                }), this.name, 'WARNING', args.body);

                return;
            }

            if (args.body && hasData) {
                this.homey.app.log(this.homey.__({
                    en: 'Received webhook message with trip data for ' + this.name,
                    no: 'Mottok webhook data med turdata for ' + this.name
                }), this.name, 'DEBUG', args.body);

                if (args.body.drivingPoints && this.tripSummaryEnabled) {
                    drivingData = [...drivingData, ...args.body.drivingPoints];

                    const isTripEnded = args.body.drivingPoints.some(point => point.point_marker_type === 2);
                    if (isTripEnded) {
                        tripInProgress = false;
                        if (tripEndTimer) {
                            clearTimeout(tripEndTimer);
                        }

                        const endTripThreshold = this.settings.endTripThreshold * 60 * 1000 || 10 * 60 * 1000; // Standardverdi på 10 minutter
                        this.homey.app.log(this.homey.__({
                            en: 'Trip ended. Waiting ' + endTripThreshold / 1000 + ' seconds before saving data.',
                            no: 'Tur avsluttet. Venter ' + endTripThreshold / 1000 + ' sekunder før data lagres.'
                        }), this.name, 'DEBUG');
                        
                        tripEndTimer = setTimeout(async () => {
                            if (!tripInProgress) {
                                try {
                                    if (!this.homeyId) {
                                        throw new Error('homeyId er ikke satt');
                                    } else if (!this.slug) {
                                        throw new Error('slug er ikke satt');
                                    }

                                    const response = await axios.post(`${this.apiUrl}/save/${this.slug}`, drivingData, { headers: { 'Content-Type': 'application/json' } });
                                    if (response.status !== 200) {
                                        return this.homey.app.log(this.homey.__({
                                            en: 'Failed to save data',
                                            no: 'Kunne ikke lagre data'
                                        }), this.name, 'ERROR');
                                    } else {
                                        this.homey.app.log(this.homey.__({
                                            en: 'Saved data',
                                            no: 'Lagret data'
                                        }), this.name, 'DEBUG', response.data.encodedId);
                                    }
                                } catch (error) {
                                    this.homey.app.log(this.homey.__({
                                        en: 'Failed to save data',
                                        no: 'Kunne ikke lagre data'
                                    }), this.name, 'ERROR', error.message);
                                }
                            }
                        }, endTripThreshold);

                        const from = await this.reverseGeocode(drivingData[0].lat, drivingData[0].lon);
                        const to = await this.reverseGeocode(drivingData[drivingData.length - 1].lat, drivingData[drivingData.length - 1].lon);
                        let addressFrom;
                        let addressTo;
                        if (from) {
                            addressFrom = from.road ? `${from.road}` : '';
                            addressFrom += from.house_number ? ` ${from.house_number}` : '';
                            addressFrom += from.postcode ? `, ${from.postcode}` : '';
                            addressFrom += from.suburb ? ` ${from.suburb}` : `${from.municipality ? ` ${from.municipality}` : ''}`;
                        }
                        if (to) {
                            addressTo = to.road ? `${to.road}` : '';
                            addressTo += to.house_number ? ` ${to.house_number}` : '';
                            addressTo += to.postcode ? `, ${to.postcode}` : '';
                            addressTo += to.suburb ? ` ${to.suburb}` : `${to.municipality ? ` ${to.municipality}` : ''}`;
                        }

                        let totalDistance = drivingData.reduce((acc, point) => acc + point.distance_delta, 0);
                        if (totalDistance > 1000) {
                            totalDistance /= 1000;
                            totalDistance = totalDistance.toFixed(1) + ' km';
                        } else {
                            totalDistance = totalDistance.toFixed(0) + ' m';
                        }

                        const drivingPointStart = new Date(drivingData[0].driving_point_epoch_time);
                        const drivingPointEnd = new Date(drivingData[drivingData.length - 1].driving_point_epoch_time);
                        const dateStringStart = drivingPointStart.toLocaleString(this.locale, { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' });
                        const dateStringEnd = drivingPointEnd.toLocaleString(this.locale, { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit', day: '2-digit' });
                        let dateString;
                        if (dateStringStart === dateStringEnd) {
                            dateString = `${dateStringStart}`;
                        } else {
                            dateString = `${dateStringStart} - ${dateStringEnd}`;
                        }
                        if (!dateString) {
                            dateString = this.homey.__({ "en": "Unknown", "no": "Ukjent" });
                        }

                        let totalEnergy = drivingData.reduce((acc, point) => acc + point.energy_delta, 0);
                        let energyUnit = 'Wh';
                        if (totalEnergy > 1000) {
                            totalEnergy /= 1000; // Wh -> kWh
                            energyUnit = 'kWh';
                        }

                        const tripData = {
                            tripFrom: addressFrom,
                            tripTo: addressTo,
                            totalDistance: totalDistance,
                            dateString: dateString,
                            timeStringStart: drivingPointStart.toLocaleString(this.locale, { timeZone: 'Europe/Oslo', hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                            timeStringEnd: drivingPointEnd.toLocaleString(this.locale, { timeZone: 'Europe/Oslo', hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                            tripDuration: moment.duration(drivingData[0].driving_point_epoch_time - drivingData[drivingData.length - 1].driving_point_epoch_time).humanize(),
                            socStart: `${drivingData[0].state_of_charge * 100}%`,
                            socEnd: `${drivingData[drivingData.length - 1].state_of_charge * 100}%`,
                            energyUsed: `${totalEnergy.toFixed(2)} ${energyUnit}`,
                            altStart: `${drivingData[0].alt.toFixed(0)} m`,
                            altEnd: `${drivingData[drivingData.length - 1].alt.toFixed(0)} m`,
                        };
                        const encodedSlug = base64url.encode(this.slug);
                        /*this.tripSummaryImage.setUrl(`${this.apiUrl}/tripSummary/${encodedSlug}?mapType=${this.settings.mapImageType}&theme=${this.settings.tripSummaryStyle}&lang=${this.locale}`);
                        this.tripInfoImage.setUrl(`${this.apiUrl}/tripInfo/${encodedSlug}?theme=${this.settings.tripInfoStyle}&lang=${this.locale}`);
                        this.tripScoreImage.setUrl(`${this.apiUrl}/tripScore/${encodedSlug}?theme=${this.settings.tripScoreStyle}&lang=${this.locale}`);

                        await this.tripSummaryImage.update();
                        await this.tripInfoImage.update();
                        await this.tripScoreImage.update();*/
                        await this.driver._tripEndedFlow.trigger(this, {
                            //lastTrip: this.tripSummaryImage,
                            //tripInfo: this.tripInfoImage,
                            //tripScore: this.tripScoreImage,
                            tripFrom: tripData.tripFrom || this.homey.__({ "en": "Unavailable", "no": "Utilgjengelig" }),
                            tripTo: tripData.tripTo || this.homey.__({ "en": "Unavailable", "no": "Utilgjengelig" }),
                            totalDistance: tripData.totalDistance || this.homey.__({ "en": "Unavailable", "no": "Utilgjengelig" }),
                            dateString: tripData.dateString || this.homey.__({ "en": "Unavailable", "no": "Utilgjengelig" }),
                            timeStringStart: tripData.timeStringStart || this.homey.__({ "en": "Unavailable", "no": "Utilgjengelig" }),
                            timeStringEnd: tripData.timeStringEnd || this.homey.__({ "en": "Unavailable", "no": "Utilgjengelig" }),
                            tripDuration: tripData.tripDuration || this.homey.__({ "en": "Unavailable", "no": "Utilgjengelig" }),
                            socStart: tripData.socStart || this.homey.__({ "en": "Unavailable", "no": "Utilgjengelig" }),
                            socEnd: tripData.socEnd || this.homey.__({ "en": "Unavailable", "no": "Utilgjengelig" }),
                            energyUsed: tripData.energyUsed || this.homey.__({ "en": "Unavailable", "no": "Utilgjengelig" }),
                            altStart: tripData.altStart || this.homey.__({ "en": "Unavailable", "no": "Utilgjengelig" }),
                            altEnd: tripData.altEnd || this.homey.__({ "en": "Unavailable", "no": "Utilgjengelig" }),
                        });

                        drivingData = [];
                    } else if (tripInProgress && tripEndTimer) {
                        // Ny tur startet før timeren er ferdig
                        args.body.drivingPoints[args.body.drivingPoints.length - 1].point_marker_type = 1;
                        clearTimeout(tripEndTimer);
                        tripEndTimer = null;
                    }
                }
            }

            this.homey.app.log(this.homey.__({
                en: 'Received webhook message for ' + this.name,
                no: 'Mottok webhook data med kjøretøydata for ' + this.name
            }), this.name, 'DEBUG', args.body);

            this.vehicleData = {
                ...args.body
            };

            await this.updateDeviceData();
        });
    }

    async updateDeviceData() {
        if (!this.vehicleData) {
            this.homey.app.log(this.homey.__({
                en: 'No data available for ' + this.name,
                no: 'Ingen data tilgjengelig for ' + this.name
            }), this.name, 'DEBUG');
            return;
        }
        this.homey.app.log(this.homey.__({
            en: 'Updating device data for ' + this.name,
            no: 'Oppdaterer enhetsdata for ' + this.name
        }), this.name, 'DEBUG');

        if (this.vehicleData) {
            const lastUpdated = moment(this.vehicleData.timestamp).fromNow();
            let soc = parseInt(this.vehicleData.stateOfCharge * 100);
            if (soc > 100) {
                soc = 100;
            }
            let range = parseInt((soc / 100) * 487, 10) / 1.5;
            range = `≈ ${parseInt(range).toFixed(0)} km`;
            const batteryLevel = parseFloat((this.vehicleData.batteryLevel / 1000).toFixed(2));
            let connected = this.vehicleData.chargePortConnected;
            let alt = Math.round(this.vehicleData.alt);
            const speed = parseInt(this.vehicleData.speed * 3.6);
            const powerW = parseInt(this.vehicleData.power / 1000);
            const powerKW = parseFloat((powerW / 1000).toFixed(2));
            const temp = parseInt(this.vehicleData.ambientTemperature);
            let ignitionState = this.vehicleData.ignitionState;
            const lat = this.vehicleData.lat || 0;
            const lon = this.vehicleData.lon || 0;

            let location;
            if (lat && lon) {
                const locationPromise = await this.reverseGeocode(lat, lon);
                if (locationPromise) {
                    const { road, house_number, postcode, city } = locationPromise;
                    if (speed > 10) {
                        // Vis kun vei og by for høyere hastigheter
                        location = road ? `${road}` : '';
                        location += city ? `, ${city}` : '';
                    } else {
                        // Vis full adresse for lavere hastigheter
                        location = road ? `${road}` : '';
                        location += house_number ? ` ${house_number}` : '';
                        location += postcode ? `, ${postcode}` : '';
                        location += city ? ` ${city}` : '';
                    }
                } else {
                    location = this.homey.__({ "en": "Unknown road", "no": "Ukjent vei" });
                }
            } else {
                location = this.homey.__({ "en": "Unknown road", "no": "Ukjent vei" });
            }
            if (!alt) {
                alt = 0;
            }

            switch (ignitionState) {
                case 'Started':
                    ignitionState = this.homey.__({ "en": "Started", "no": "Startet" });
                    break;
                case 'On':
                    ignitionState = this.homey.__({ "en": "On", "no": "På" });
                    break;
                case 'Off':
                    ignitionState = this.homey.__({ "en": "Off", "no": "Av" });
                    break;
                case 'Accessory':
                    ignitionState = this.homey.__({ "en": "Idle", "no": "Klar" });
                    break;
                default:
                    ignitionState = this.homey.__({ "en": "Unknown", "no": "Ukjent" });
                    break;
            }

            if (connected) {
                if (connected && Math.abs(powerW) >= 1000) {
                    connected = this.homey.__({ "en": "Charging", "no": "Lader" });
                } else {
                    connected = this.homey.__({ "en": "Connected", "no": "Tilkoblet" });
                }
            } else {
                connected = this.homey.__({ "en": "Disconnected", "no": "Frakoblet" });
            }

            await this.setCapabilityValue('measure_battery', soc);
            await this.setCapabilityValue('measure_polestarBattery', soc);
            await this.setCapabilityValue('measure_polestarRange', range);
            await this.setCapabilityValue('measure_polestarBatteryLevel', batteryLevel);
            await this.setCapabilityValue('measure_polestarConnected', connected);
            await this.setCapabilityValue('measure_polestarIgnitionState', ignitionState);
            await this.setCapabilityValue('measure_polestarLocation', location);
            await this.setCapabilityValue('measure_polestarSpeed', speed);
            await this.setCapabilityValue('measure_polestarAlt', alt);
            await this.setCapabilityValue('measure_polestarPower', powerKW);
            await this.setCapabilityValue('measure_polestarGear', this.vehicleData.selectedGear);
            await this.setCapabilityValue('measure_polestarTemp', temp);
            await this.setCapabilityValue('measure_polestarUpdated', lastUpdated);
        } else {
            this.homey.app.log(this.homey.__({
                en: 'Failed to update device data for ' + this.name,
                no: 'Klarte ikke å oppdatere enhetsdata for ' + this.name
            }), this.name, 'ERROR');
        }

        this.homey.app.log(this.homey.__({
            en: 'Device data updated successfully',
            no: 'Enhetsdata ble oppdatert vellykket'
        }), this.name, 'DEBUG');
    }

    async updateLastUpdated() {
        if (this.vehicleData && this.vehicleData.timestamp) {
            const lastUpdated = moment(this.vehicleData.timestamp).fromNow();
            await this.setCapabilityValue('measure_polestarUpdated', lastUpdated);
        }
    }

    async reverseGeocode(lat, lon) {
        if (
            this.previousLat &&
            this.previousLon &&
            geolib.getDistance(
                { latitude: lat, longitude: lon },
                { latitude: this.previousLat, longitude: this.previousLon }
            ) <= this.threshold
        ) {
            // Return the previous address without making a new request
            this.homey.app.log(this.homey.__({
                en: 'Using previous address',
                no: 'Bruker forrige adresse'
            }), this.name, 'DEBUG');

            return this.previousAddress;
        }

        const url = `https://nominatim.openstreetmap.org/reverse.php?lat=${lat}&lon=${lon}&zoom=18&format=jsonv2`;
        const response = await axios.get(url);
        if (response.data && response.data.address) {
            //const address = response.data.features[0].properties.formatted;
            //const address = `${response.data.address.road} ${response.data.address.house_number}, ${response.data.address.postcode} ${response.data.address.suburb}`;
            const address = {
                road: response.data.address.road || null,
                house_number: response.data.address.house_number || null,
                postcode: response.data.address.postcode || null,
                city: response.data.address.suburb || null,
                city_district: response.data.address.city_district || null,
                county: response.data.address.county || null,
                country: response.data.address.country || null,
            }

            // Update the previous values with the current values
            this.previousLat = lat;
            this.previousLon = lon;
            this.previousAddress = address;

            this.homey.app.log(this.homey.__({
                en: 'Using new address',
                no: 'Bruker ny adresse'
            }), this.name, 'DEBUG');

            return address;
        }
        return null;
    }

    async onAdded() {
        this.homey.app.log(this.homey.__({
            en: this.name + ' has been added',
            no: this.name + ' har blitt lagt til'
        }),
            this.name, 'DEBUG');
    }

    async onSettings({ oldSettings, newSettings, changedKeys }) {
        if (changedKeys.includes('polestar_webhook')) {
            if (oldSettings.polestar_webhook !== newSettings.polestar_webhook) {
                await this.setSettings({ polestar_webhook: oldSettings.polestar_webhook });
                this.homey.app.log(this.homey.__({
                    en: 'polestar_webhook was attempted to change. This is not allowed, and will be ignored. No changes have been made.',
                    no: 'polestar_webhook ble forsøkt endret. Dette er ikke tillatt. ingen endringer har blitt utført.'
                }), this.name, 'ERROR');
            }
        } else if (changedKeys.includes('webhook_url_short')) {
            if (oldSettings.webhook_url_short !== newSettings.webhook_url_short) {
                await this.setSettings({ webhook_url_short: oldSettings.webhook_url_short });
                this.homey.app.log(this.homey.__({
                    en: 'webhook_url_short was attempted to change. This is not allowed, and will be ignored. No changes have been made.',
                    no: 'webhook_url_short ble forsøkt endret. Dette er ikke tillatt. ingen endringer har blitt utført.'
                }), this.name, 'ERROR');
            }
        }
        this.settings = newSettings;
        await this.homey.cloud.unregisterWebhook(this.webhook);
        await this.initWebhook();
        this.homey.app.log(this.homey.__({
            en: 'Settings have been updated',
            no: 'Innstillingene har blitt oppdatert'
        }), this.name, 'DEBUG');
    }

    async onRenamed(name) {
        this.homey.app.log(this.homey.__({
            en: this.name + ' has been renamed to ' + name,
            no: 'Navnet på ' + this.name + ' har blitt endret til ' + name
        }), name, 'DEBUG');
    }

    async onDeleted() {
        if (this.updatedInterval) {
            this.homey.clearInterval(this.updatedInterval);
        }

        await this.homey.cloud.unregisterWebhook(this.webhook);

        try {
            const response = await axios.delete(`${this.apiUrl}/delete/${this.slug}`);
            if (response.status !== 200) {
                return this.homey.app.log(this.homey.__({
                    en: 'Failed to delete data',
                    no: 'Kunne ikke slette data'
                }), this.name, 'ERROR');
            } else {
                this.homey.app.log(this.homey.__({
                    en: 'Data has been deleted successfully',
                    no: 'Sletting av data i databasen var vellykket'
                }), this.name, 'DEBUG');
            }

            return this.homey.app.log(this.homey.__({
                en: this.name + ' has been deleted',
                no: this.name + ' har blitt slettet'
            }), this.name, 'DEBUG');
        } catch (error) {
            this.homey.app.log(this.homey.__({
                en: this.name + ' has been deleted, but failed to delete data in database',
                no: this.name + ' har blitt slettet, men feilet med å slette data i databasen'
            }), this.name, 'ERROR', error.message);
        }
    }
}

module.exports = PolestarBetaDevice;
