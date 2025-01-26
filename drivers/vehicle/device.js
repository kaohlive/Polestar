'use strict';

const { Device } = require('homey');
const Polestar = require('@andysmithfal/polestar.js');
//const Polestar = require('../../lib/polestar.js');
const HomeyCrypt = require('../../lib/homeycrypt')

const measureInterval = 60000;

var polestar = null;

class PolestarVehicle extends Device {
    async onInit() {
        if (this.polestar == null) {
            let PolestarUser = this.homey.settings.get('user_email');
            try {
                let PolestarPwd = await HomeyCrypt.decrypt(this.homey.settings.get('user_password'), PolestarUser);
                this.log(PolestarPwd);
                this.polestar = new Polestar(PolestarUser, PolestarPwd);
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
        this.update_loop_timers();

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

    async fixCapabilities() {
        if (this.hasCapability('measure_battery'))
            await this.removeCapability('measure_battery');
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
    }

    async updateHealthState(){
        this.homey.app.log('Retrieve vehicle health', 'PolestarVehicle', 'DEBUG');
        var healthInfo = await this.polestar.getHealthData();
        this.homey.app.log('Health:', 'PolestarVehicle', 'DEBUG', healthInfo);
        if(healthInfo!=null)
        {
            this.setCapabilityValue('alarm_generic', healthInfo.serviceWarning!='SERVICE_WARNING_NO_WARNING');
        } else {
            this.setCapabilityValue('alarm_generic', false);
        }
    }

    async updateVehicleState() {
        this.homey.app.log('Retrieve device details', 'PolestarVehicle', 'DEBUG');
        try {
            var odometer = await this.polestar.getOdometer();
            var odo = odometer.odometerMeters;
            try {
                odo = odo / 1000; //Convert to KM instead of M
            } catch {
                odo = null;
            }
            this.homey.app.log('KM:' + odo, 'PolestarVehicle', 'DEBUG');
            this.setCapabilityValue('measure_vehicleOdometer', odo);
        } catch {
            this.homey.app.log('Failed to retrieve odometer', 'PolestarVehicle', 'ERROR');
        };
        try {
            var batteryInfo = await this.polestar.getBattery();
            this.homey.app.log('Battery:', 'PolestarVehicle', 'DEBUG', batteryInfo);

            this.setCapabilityValue('measure_polestarBattery', batteryInfo.batteryChargeLevelPercentage);
            this.setCapabilityValue('measure_current', batteryInfo.chargingCurrentAmps);
            if(batteryInfo.chargingCurrentAmps!==null){
                this.setCapabilityValue('measure_current', batteryInfo.chargingCurrentAmps);
            } else {
                this.setCapabilityValue('measure_current', 0); //We set 0 first, this is for insights sake
            }
            if(batteryInfo.chargingPowerWatts!==null){
                this.setCapabilityValue('measure_power', batteryInfo.chargingPowerWatts);
                let hours = measureInterval / (1000 * 60 * 60);
                let usedPower = (batteryInfo.chargingPowerWatts/1000) * (hours);
                this.setCapabilityValue('meter_power', (usedPower+this.getCapabilityValue('meter_power')));
            } else {
                this.setCapabilityValue('measure_power', 0); //We set 0 first, this is for insights sake
            }
            
            this.setCapabilityValue('measure_vehicleRange', batteryInfo.estimatedDistanceToEmptyKm);
            if (batteryInfo.chargingStatus == 'CHARGING_STATUS_CHARGING') {
                this.setCapabilityValue('measure_vehicleChargeState', true);
                this.setCapabilityValue('measure_vehicleChargeTimeRemaining', batteryInfo.estimatedChargingTimeToFullMinutes);
            } else {
                this.setCapabilityValue('measure_vehicleChargeState', false);
                this.setCapabilityValue('measure_vehicleChargeTimeRemaining', null);
            }
            if (batteryInfo.chargerConnectionStatus == 'CHARGER_CONNECTION_STATUS_CONNECTED')
                this.setCapabilityValue('measure_vehicleConnected', true);
            else
                this.setCapabilityValue('measure_vehicleConnected', false);
        } catch {
            this.homey.app.log('Failed to retrieve batterystate', 'PolestarVehicle', 'ERROR');
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
