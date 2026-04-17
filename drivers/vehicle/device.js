'use strict';

const { Device } = require('homey');
const LegacyPolestar = require('../../clone_modules/polestar.js');
const PolestarC3Compat = require('../../clone_modules/polestar-c3/compat');
const HomeyCrypt = require('../../lib/homeycrypt')

const measureInterval = 60000;
const KM_TO_MILES = 0.621371;

function selectClient(homey) {
    const legacy = homey.settings.get('c3_backend_disabled') === true;
    return legacy ? LegacyPolestar : PolestarC3Compat;
}

var polestar = null;

class PolestarVehicle extends Device {

    /**
     * Check if the user has selected miles as the distance unit
     * @returns {boolean} true if miles, false if km (default)
     */
    usesMiles() {
        return this.homey.settings.get('distance_unit') === 'miles';
    }

    /**
     * Update capability units based on distance unit setting
     */
    async updateCapabilityUnits() {
        const unit = this.usesMiles() ? { en: 'mi' } : { en: 'km' };
        try {
            await this.setCapabilityOptions('measure_vehicleOdometer', { units: unit });
            await this.setCapabilityOptions('measure_vehicleRange', { units: unit });
            await this.setCapabilityOptions('measure_vehicleDistanceTillService', { units: unit });
            this.homey.app.log(`Updated capability units to ${this.usesMiles() ? 'miles' : 'km'}`, 'PolestarVehicle', 'DEBUG');
        } catch (err) {
            this.homey.app.log('Failed to update capability units', 'PolestarVehicle', 'ERROR', err);
        }
    }

    /**
     * Attempt to re-login when session has expired
     */
    async attemptReLogin() {
        // Prevent multiple simultaneous re-login attempts
        if (this._reLoginInProgress) {
            this.homey.app.log('Re-login already in progress, skipping', 'PolestarVehicle', 'DEBUG');
            return;
        }

        this._reLoginInProgress = true;
        try {
            let PolestarUser = this.homey.settings.get('user_email');
            let PolestarPwd = await HomeyCrypt.decrypt(this.homey.settings.get('user_password'), PolestarUser);

            const Client = selectClient(this.homey);
            this.polestar = new Client(PolestarUser, PolestarPwd);
            await this.polestar.login();
            await this.polestar.setVehicle(this.getData().vin);

            this.homey.app.log('Re-login successful', 'PolestarVehicle', 'DEBUG');
        } catch (err) {
            this.homey.app.log('Re-login failed', 'PolestarVehicle', 'ERROR', err);
        } finally {
            this._reLoginInProgress = false;
        }
    }

    async onInit() {
        if (this.polestar == null) {
            let PolestarUser = this.homey.settings.get('user_email');
            try {
                let PolestarPwd = await HomeyCrypt.decrypt(this.homey.settings.get('user_password'), PolestarUser);
                const Client = selectClient(this.homey);
                this.polestar = new Client(PolestarUser, PolestarPwd);
            } catch (err) {
                this.homey.app.log('Could not decrypt using salt, network connection changed?', 'PolestarVehicle', 'ERROR', err);
                return;
            }
            try {
                await this.polestar.login();
                await this.polestar.setVehicle(this.getData().vin);
            } catch (err) {
                this.homey.app.log('Could not login. Please check your credentials or try again later', 'PolestarVehicle', 'ERROR', err);
                return;
            }
        }
        
        await this.fixCapabilities();
        await this.fixEnergy();
        await this.updateCapabilityUnits();
        this.update_loop_timers();

        // Listen for distance unit setting changes
        this.homey.settings.on('set', async (key) => {
            if (key === 'distance_unit') {
                this.homey.app.log('Distance unit setting changed', 'PolestarVehicle', 'DEBUG');
                await this.updateCapabilityUnits();
                // Refresh values with new unit
                await this.updateVehicleState();
                await this.updateHealthState();
                // Send specific event for widget to refresh
                this.homey.api.realtime('distanceUnitChanged');
            }
        });

        this.homey.app.log(this.homey.__({
          en: `${this.name} has been initialized`,
          no: `${this.name} har blitt initialisert`,
          nl: `${this.name} is geinitialiseerd`,
      }), this.name, 'DEBUG');
    }

    async update_loop_timers() {
        await this.updateVehicleState();
        let interval = measureInterval;
        this._timerTimers = this.homey.setInterval(async () => {
            await this.updateVehicleState();
        }, interval);
        await this.updateHealthState();
        let intervalHealth = 3600000;
        this._timerHealth = this.homey.setInterval(async () => {
            await this.updateHealthState();
        }, intervalHealth);
    }

    async fixEnergy()
    {
        const currentEnergy = await this.getEnergy();
        //Check if this ev was created with the right energy object
        if(!currentEnergy?.electricCar)
        {
            await this.setEnergy({
                "electricCar": true
            })
        }
    }

    async fixCapabilities() {
        if (!this.hasCapability('measure_battery'))
            await this.addCapability('measure_battery');
        if (!this.hasCapability('ev_charging_state'))
            await this.addCapability('ev_charging_state');
        if (!this.hasCapability('measure_polestarBattery'))
            await this.addCapability('measure_polestarBattery');
        if(!this.hasCapability('measure_current'))
           await this.addCapability('measure_current');
        if(!this.hasCapability('measure_power'))
           await this.addCapability('measure_power');
        if(!this.hasCapability('meter_power'))
            await this.addCapability('meter_power');
        if (!this.hasCapability('measure_vehicleChargeTimeRemaining'))
            await this.addCapability('measure_vehicleChargeTimeRemaining');
        if (!this.hasCapability('measure_vehicleOdometer'))
            await this.addCapability('measure_vehicleOdometer');
        if (!this.hasCapability('measure_vehicleRange'))
            await this.addCapability('measure_vehicleRange');
        if (!this.hasCapability('measure_vehicleChargeState'))
            await this.addCapability('measure_vehicleChargeState');
        if (!this.hasCapability('measure_vehicleConnected'))
            await this.addCapability('measure_vehicleConnected');
        if (!this.hasCapability('alarm_generic'))
            await this.addCapability('alarm_generic');
        if (!this.hasCapability('measure_vehicleDaysTillService'))
            await this.addCapability('measure_vehicleDaysTillService');
        if (!this.hasCapability('measure_vehicleDistanceTillService'))
            await this.addCapability('measure_vehicleDistanceTillService');
        if (!this.hasCapability('measure_voltage'))
            await this.addCapability('measure_voltage');
        if (!this.hasCapability('measure_polestarChargingType'))
            await this.addCapability('measure_polestarChargingType');
        if (!this.hasCapability('measure_polestarDrivingKwh'))
            await this.addCapability('measure_polestarDrivingKwh');
        if (!this.hasCapability('measure_polestarSessionKwh'))
            await this.addCapability('measure_polestarSessionKwh');
        if (!this.hasCapability('alarm_polestarTyrePressure'))
            await this.addCapability('alarm_polestarTyrePressure');
        if (!this.hasCapability('measure_polestarTyrePressureFL'))
            await this.addCapability('measure_polestarTyrePressureFL');
        if (!this.hasCapability('measure_polestarTyrePressureFR'))
            await this.addCapability('measure_polestarTyrePressureFR');
        if (!this.hasCapability('measure_polestarTyrePressureRL'))
            await this.addCapability('measure_polestarTyrePressureRL');
        if (!this.hasCapability('measure_polestarTyrePressureRR'))
            await this.addCapability('measure_polestarTyrePressureRR');
    }

    async updateHealthState(){
        this.homey.app.log('Retrieve vehicle health', 'PolestarVehicle', 'DEBUG');
        try {
            var healthInfo = await this.polestar.getHealthData();
            this.homey.app.log('Health:', 'PolestarVehicle', 'DEBUG', healthInfo);
            if(healthInfo!=null)
            {
                this.setCapabilityValue('alarm_generic', healthInfo.serviceWarning!='SERVICE_WARNING_NO_WARNING');
                this.setCapabilityValue('measure_vehicleDaysTillService', healthInfo.daysToService);
                // Convert distance to service based on user preference
                let distanceToService = healthInfo.distanceToServiceKm;
                if (this.usesMiles() && distanceToService != null) {
                    distanceToService = Math.floor(distanceToService * KM_TO_MILES);
                } else if (distanceToService != null) {
                    distanceToService = Math.floor(distanceToService);
                }
                this.setCapabilityValue('measure_vehicleDistanceTillService', distanceToService);

                // C3-only fields — legacy GraphQL does not supply these, so guard each one.
                if (healthInfo.tyrePressures) {
                    const tp = healthInfo.tyrePressures;
                    if (Number.isFinite(tp.frontLeftKpa)) this.setCapabilityValue('measure_polestarTyrePressureFL', tp.frontLeftKpa);
                    if (Number.isFinite(tp.frontRightKpa)) this.setCapabilityValue('measure_polestarTyrePressureFR', tp.frontRightKpa);
                    if (Number.isFinite(tp.rearLeftKpa)) this.setCapabilityValue('measure_polestarTyrePressureRL', tp.rearLeftKpa);
                    if (Number.isFinite(tp.rearRightKpa)) this.setCapabilityValue('measure_polestarTyrePressureRR', tp.rearRightKpa);
                }
                if (typeof healthInfo.anyTyreWarning === 'boolean') {
                    this.setCapabilityValue('alarm_polestarTyrePressure', healthInfo.anyTyreWarning);
                }
            } else {
                this.setCapabilityValue('alarm_generic', false);
            }
        } catch (err) {
            if (err.message === 'Not logged in') {
                this.homey.app.log('Session expired, attempting to re-login', 'PolestarVehicle', 'WARNING');
                await this.attemptReLogin();
            } else {
                this.homey.app.log('Failed to retrieve health state', 'PolestarVehicle', 'ERROR', err);
            }
        }
    }

    async updateVehicleState() {
        this.homey.app.log('Retrieve device details', 'PolestarVehicle', 'DEBUG');
        try {
            var odometer = await this.polestar.getOdometer();
            this.homey.app.log('Odometers:', 'PolestarVehicle', 'DEBUG', odometer);
            var odo = odometer.odometerMeters;
            try {
                odo = odo / 1000; //Convert to KM instead of M
                if (this.usesMiles()) {
                    odo = Math.floor(odo * KM_TO_MILES); //Convert to miles
                } else {
                    odo = Math.floor(odo);
                }
            } catch {
                odo = null;
            }
            this.homey.app.log((this.usesMiles() ? 'Miles:' : 'KM:') + odo, 'PolestarVehicle', 'DEBUG');
            this.setCapabilityValue('measure_vehicleOdometer', odo);
        } catch (err) {
            if (err.message === 'Not logged in') {
                this.homey.app.log('Session expired, attempting to re-login', 'PolestarVehicle', 'WARNING');
                await this.attemptReLogin();
                return; // Exit early, next interval will retry
            }
            this.homey.app.log('Failed to retrieve odometer', 'PolestarVehicle', 'ERROR', err);
        };
        try {
            var batteryInfo = await this.polestar.getBattery();
            this.homey.app.log('Battery:', 'PolestarVehicle', 'DEBUG', batteryInfo);

            const batterySoc = Math.floor(batteryInfo.batteryChargeLevelPercentage);
            this.setCapabilityValue('measure_polestarBattery', batterySoc);
            this.setCapabilityValue('measure_battery', batterySoc);

            // Restored charging metrics — C3 fills these reliably; GraphQL used to leave them null.
            const amps = Number.isFinite(batteryInfo.chargingCurrentAmps) ? batteryInfo.chargingCurrentAmps : 0;
            const watts = Number.isFinite(batteryInfo.chargingPowerWatts) ? batteryInfo.chargingPowerWatts : 0;
            const volts = Number.isFinite(batteryInfo.chargingVoltageVolts) ? batteryInfo.chargingVoltageVolts : 0;
            this.setCapabilityValue('measure_current', amps);
            this.setCapabilityValue('measure_power', watts);
            this.setCapabilityValue('measure_voltage', volts);
            const isCharging = batteryInfo.chargingStatus === 'CHARGING_STATUS_CHARGING';
            const hoursPerPoll = measureInterval / (1000 * 60 * 60);
            const deltaKwh = isCharging && watts > 0 ? (watts / 1000) * hoursPerPoll : 0;

            // meter_power — monotonic lifetime charging meter.
            // Never reset, never overwritten by C3 driving-consumption (different semantics).
            let meterPower = this.getCapabilityValue('meter_power');
            if (meterPower === null || meterPower === undefined) meterPower = 0;
            if (deltaKwh > 0) meterPower += deltaKwh;
            this.setCapabilityValue('meter_power', meterPower);

            // measure_polestarSessionKwh — resets on idle→charging transition, accumulates
            // while charging, holds the last session total while idle.
            const wasCharging = this._wasCharging === true;
            let sessionKwh = this.getCapabilityValue('measure_polestarSessionKwh');
            if (sessionKwh === null || sessionKwh === undefined) sessionKwh = 0;
            if (isCharging && !wasCharging) sessionKwh = 0; // new session starts
            if (deltaKwh > 0) sessionKwh += deltaKwh;
            this.setCapabilityValue('measure_polestarSessionKwh', sessionKwh);
            this._wasCharging = isCharging;

            // measure_polestarDrivingKwh — monotonic lifetime driving consumption from C3.
            // Guard against downward jumps (rare but cheap to ignore).
            if (Number.isFinite(batteryInfo.totalEnergyConsumedKwh) && batteryInfo.totalEnergyConsumedKwh > 0) {
                const prevDriving = this.getCapabilityValue('measure_polestarDrivingKwh') || 0;
                if (batteryInfo.totalEnergyConsumedKwh >= prevDriving) {
                    this.setCapabilityValue('measure_polestarDrivingKwh', batteryInfo.totalEnergyConsumedKwh);
                }
            }

            if (batteryInfo.chargingTypeLabel) {
                this.setCapabilityValue('measure_polestarChargingType', batteryInfo.chargingTypeLabel);
            }

            //Set the estimated range for the vehicle based on user preference
            let range;
            if (this.usesMiles() && batteryInfo.estimatedDistanceToEmptyMiles != null) {
                range = Math.floor(batteryInfo.estimatedDistanceToEmptyMiles);
            } else if (this.usesMiles()) {
                // Fallback: convert km to miles if miles not available from API
                range = Math.floor(batteryInfo.estimatedDistanceToEmptyKm * KM_TO_MILES);
            } else {
                range = Math.floor(batteryInfo.estimatedDistanceToEmptyKm);
            }
            this.setCapabilityValue('measure_vehicleRange', range);

            // C3 exposes charger_connection_status as a separate, authoritative field.
            // Fall back to the chargingStatus heuristic only when that label is absent (legacy client).
            const connectedByStatus = new Set([
                'CHARGING_STATUS_CHARGING',
                'CHARGING_STATUS_DONE',
                'CHARGING_STATUS_SCHEDULED',
                'CHARGING_STATUS_SMART_CHARGING',
                'CHARGING_STATUS_SMART_CHARGING_PAUSED',
                'CHARGING_STATUS_ERROR',
                'CHARGING_STATUS_FAULT'
            ]);
            const isConnected = batteryInfo.chargerConnectionStatusLabel
                ? batteryInfo.chargerConnectionStatusLabel === 'CONNECTED'
                : connectedByStatus.has(batteryInfo.chargingStatus);

            if (isConnected) {
                this.setCapabilityValue('measure_vehicleConnected', true);
            } else {
                this.setCapabilityValue('measure_vehicleConnected', false);
                this.setCapabilityValue('ev_charging_state', 'plugged_out');
            }

            switch (batteryInfo.chargingStatus) {
                case 'CHARGING_STATUS_CHARGING':
                    this.setCapabilityValue('measure_vehicleChargeState', true);
                    this.setCapabilityValue('ev_charging_state', 'plugged_in_charging');
                    this.setCapabilityValue('measure_vehicleChargeTimeRemaining', batteryInfo.estimatedChargingTimeToFullMinutes);
                break;
                case 'CHARGING_STATUS_IDLE':
                    this.setCapabilityValue('measure_vehicleChargeState', false);
                    this.setCapabilityValue('ev_charging_state', isConnected ? 'plugged_in' : 'plugged_out');
                    this.setCapabilityValue('measure_vehicleChargeTimeRemaining', null);
                break;
                case 'CHARGING_STATUS_SCHEDULED':
                case 'CHARGING_STATUS_DONE':
                case 'CHARGING_STATUS_SMART_CHARGING':
                case 'CHARGING_STATUS_SMART_CHARGING_PAUSED':
                    this.setCapabilityValue('measure_vehicleChargeState', false);
                    this.setCapabilityValue('ev_charging_state', 'plugged_in_paused');
                    this.setCapabilityValue('measure_vehicleChargeTimeRemaining', null);
                break;
                case 'CHARGING_STATUS_DISCHARGING':
                    this.setCapabilityValue('measure_vehicleChargeState', false);
                    this.setCapabilityValue('ev_charging_state', 'plugged_in');
                    this.setCapabilityValue('measure_vehicleChargeTimeRemaining', null);
                break;

                case 'CHARGING_STATUS_ERROR':
                case 'CHARGING_STATUS_FAULT':
                    this.setCapabilityValue('measure_vehicleChargeState', false);
                    this.setCapabilityValue('ev_charging_state', 'plugged_in');
                    this.setCapabilityValue('measure_vehicleChargeTimeRemaining', null);
                    // TODO: Add capability to show charging error
                break;
                default:
                    this.setCapabilityValue('measure_vehicleChargeState', false);
                    this.setCapabilityValue('ev_charging_state', 'plugged_out');
                    this.setCapabilityValue('measure_vehicleChargeTimeRemaining', null);
                break;
            }

            // if (batteryInfo.chargerConnectionStatus == 'CHARGER_CONNECTION_STATUS_CONNECTED')
            //     this.setCapabilityValue('measure_vehicleConnected', true);
            // else
            //     this.setCapabilityValue('measure_vehicleConnected', false);
        } catch (err) {
            if (err.message === 'Not logged in') {
                this.homey.app.log('Session expired, attempting to re-login', 'PolestarVehicle', 'WARNING');
                await this.attemptReLogin();
                return; // Exit early, next interval will retry
            }
            this.homey.app.log('Failed to retrieve batterystate', 'PolestarVehicle', 'ERROR', err);
        }
        this.homey.api.realtime('updatevehicle');
    }

    async onAdded() {
        this.homey.app.log('PolestarVehicle has been added', 'PolestarVehicle');
    }

    async onSettings({ oldSettings, newSettings, changedKeys }) {
        this.homey.app.log('PolestarVehicle settings where changed', 'PolestarVehicle');
    }

    async onRenamed(name) {
        this.homey.app.log('PolestarVehicle was renamed', 'PolestarVehicle');
    }

    async onDeleted() {
        this.homey.app.log('PolestarVehicle has been deleted', 'PolestarVehicle');
    }

}

module.exports = PolestarVehicle;
