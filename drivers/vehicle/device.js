'use strict';

const { Device } = require('homey');
//const Polestar = require('@andysmithfal/polestar.js');
const Polestar = require('../../clone_modules/polestar.js');
const HomeyCrypt = require('../../lib/homeycrypt')

const measureInterval = 60000;

var polestar = null;

class PolestarVehicle extends Device {
    async onInit() {
        if (this.polestar == null) {
            let PolestarUser = this.homey.settings.get('user_email');
            try {
                let PolestarPwd = await HomeyCrypt.decrypt(this.homey.settings.get('user_password'), PolestarUser);
                //this.log(PolestarPwd);
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
        await this.fixEnergy();
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

    async fixEnergy()
    {
        const currentEnergy = await this.getEnergy();
        //Check if this ev was created with the right energy object
        if(!currentEnergy.electricCar)
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
    }

    async updateHealthState(){
        this.homey.app.log('Retrieve vehicle health', 'PolestarVehicle', 'DEBUG');
        var healthInfo = await this.polestar.getHealthData();
        this.homey.app.log('Health:', 'PolestarVehicle', 'DEBUG', healthInfo);
        if(healthInfo!=null)
        {
            this.setCapabilityValue('alarm_generic', healthInfo.serviceWarning!='SERVICE_WARNING_NO_WARNING');
            this.setCapabilityValue('measure_vehicleDaysTillService', healthInfo.daysToService);
            this.setCapabilityValue('measure_vehicleDistanceTillService', healthInfo.distanceToServiceKm);
        } else {
            this.setCapabilityValue('alarm_generic', false);
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
            this.setCapabilityValue('measure_battery', batteryInfo.batteryChargeLevelPercentage);
            //this.setCapabilityValue('measure_current', batteryInfo.chargingCurrentAmps);
            // if(batteryInfo.chargingCurrentAmps!==null){
            //     this.setCapabilityValue('measure_current', batteryInfo.chargingCurrentAmps);
            // } else {
            //     this.setCapabilityValue('measure_current', 0); //We set 0 first, this is for insights sake
            // }
            // if(batteryInfo.chargingPowerWatts!==null){
            //     this.setCapabilityValue('measure_power', batteryInfo.chargingPowerWatts);
            //     let hours = measureInterval / (1000 * 60 * 60);
            //     let usedPower = (batteryInfo.chargingPowerWatts/1000) * (hours);
            //     this.setCapabilityValue('meter_power', (usedPower+this.getCapabilityValue('meter_power')));
            // } else {
            //     this.setCapabilityValue('measure_power', 0); //We set 0 first, this is for insights sake
            // }

            //Set the estimated range for the vhicle
            this.setCapabilityValue('measure_vehicleRange', batteryInfo.estimatedDistanceToEmptyKm);

            //Lets assign statusses we consider connected
            const connectedStatuses = new Set([
                'CHARGING_STATUS_CHARGING',
                'CHARGING_STATUS_DONE',
                'CHARGING_STATUS_SCHEDULED',
                'CHARGING_STATUS_SMART_CHARGING',
                'CHARGING_STATUS_ERROR',
                'CHARGING_STATUS_FAULT'
            ]);

            //Lets see if the car is in a state that suggests the connector is connected
            if(connectedStatuses.has(batteryInfo.chargingStatus)){
                this.setCapabilityValue('measure_vehicleConnected', true);
                //Determine the ev_charging_state in our switch
            } else {
                this.setCapabilityValue('measure_vehicleConnected', false);
                this.setCapabilityValue('ev_charging_state', 'plugged_out');
            }
           
            //Now Lets see if it is actually charging 
            switch (batteryInfo.chargingStatus) {
                case 'CHARGING_STATUS_CHARGING':
                    this.setCapabilityValue('measure_vehicleChargeState', true);
                    this.setCapabilityValue('ev_charging_state', 'plugged_in_charging');
                    this.setCapabilityValue('measure_vehicleChargeTimeRemaining', batteryInfo.estimatedChargingTimeToFullMinutes);
                break;
                case 'CHARGING_STATUS_SCHEDULED':
                case 'CHARGING_STATUS_DONE':
                case 'CHARGING_STATUS_SMART_CHARGING':
                    this.setCapabilityValue('measure_vehicleChargeState', false);
                    this.setCapabilityValue('ev_charging_state', 'plugged_in_paused');
                    this.setCapabilityValue('measure_vehicleChargeTimeRemaining', null);
                    // TODO: Add capability to show scheduled charging
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
