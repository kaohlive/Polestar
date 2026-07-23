'use strict';

const { Driver } = require('homey');
const LegacyPolestar = require('../../clone_modules/polestar.js');
const PolestarC3Compat = require('../../clone_modules/polestar-c3/compat');
const HomeyCrypt = require('../../lib/homeycrypt')
const toPairingDevice = require('./pairing-device');

function Polestar(email, password, homey) {
    const legacy = homey && homey.settings.get('c3_backend_disabled') === true;
    const Client = legacy ? LegacyPolestar : PolestarC3Compat;
    return new Client(email, password);
}

class Vehicle extends Driver {
    async onInit() {
        this.homey.app.log('Polestar Driver has been initialized', 'Polestar Driver', 'DEBUG');
        this._registerFlowCards();
    }

    _registerFlowCards() {
        const actionRun = (method) => async (args) => {
            if (!args.device) throw new Error('No device supplied to flow card');
            await args.device[method](args);
            return true;
        };

        this.homey.flow.getActionCard('charge_start').registerRunListener(actionRun('chargeStart'));
        this.homey.flow.getActionCard('charge_stop').registerRunListener(actionRun('chargeStop'));
        this.homey.flow.getActionCard('set_target_soc').registerRunListener(actionRun('setTargetSoc'));
        this.homey.flow.getActionCard('set_amp_limit').registerRunListener(actionRun('setAmpLimit'));

        this.homey.flow.getActionCard('lock_car').registerRunListener(actionRun('lockCar'));
        this.homey.flow.getActionCard('unlock_car').registerRunListener(actionRun('unlockCar'));
        this.homey.flow.getActionCard('unlock_trunk_action').registerRunListener(actionRun('unlockTrunkAction'));
        this.homey.flow.getActionCard('honk_flash').registerRunListener(actionRun('honkFlashAction'));
        this.homey.flow.getActionCard('climate_start').registerRunListener(actionRun('climateStartAction'));
        this.homey.flow.getActionCard('climate_start_simple').registerRunListener(actionRun('climateStartSimpleAction'));
        this.homey.flow.getActionCard('climate_stop').registerRunListener(actionRun('climateStopAction'));
        this.homey.flow.getActionCard('windows_open').registerRunListener(actionRun('windowsOpenAction'));
        this.homey.flow.getActionCard('windows_close').registerRunListener(actionRun('windowsCloseAction'));
        this.homey.flow.getActionCard('get_location').registerRunListener(async (args) => {
            if (!args.device) throw new Error('No device supplied to flow card');
            return args.device.getLocationForFlow();
        });

        this.homey.flow.getConditionCard('target_soc_is').registerRunListener(async (args) => {
            if (!args.device) return false;
            const current = await args.device.getCurrentTargetSoc();
            return Number.isFinite(current) ? current >= args.level : false;
        });
        this.homey.flow.getConditionCard('amp_limit_is').registerRunListener(async (args) => {
            if (!args.device) return false;
            const current = await args.device.getCurrentAmpLimit();
            return Number.isFinite(current) ? current >= args.amperage : false;
        });
        this.homey.flow.getConditionCard('is_locked').registerRunListener(async (args) => {
            return args.device ? args.device.isLocked() : false;
        });

        // Contact-sensor cards: one trigger card per direction (opened/closed)
        // with a dropdown selecting which alarm_contact sub-capability. The
        // device fires the trigger with state.sensor = full sub-cap id; the
        // run-listener gates by matching the user's selected dropdown value.
        this._contactOpenedTrigger = this.homey.flow.getDeviceTriggerCard('contact_opened');
        this._contactOpenedTrigger.registerRunListener(async (args, state) => args.sensor === state.sensor);
        this._contactClosedTrigger = this.homey.flow.getDeviceTriggerCard('contact_closed');
        this._contactClosedTrigger.registerRunListener(async (args, state) => args.sensor === state.sensor);
        this.homey.flow.getConditionCard('contact_is_open').registerRunListener(async (args) => {
            if (!args.device || !args.sensor) return false;
            return args.device.getCapabilityValue(args.sensor) === true;
        });

        // At-home cards: no args; the device fires them from _evaluateAtHome
        // whenever the measure_polestarAtHome boolean transitions. Condition
        // reads the current capability value — invertable by the user in the
        // flow editor via the !{{is|is not}} tokens in the title.
        this._carCameHomeTrigger = this.homey.flow.getDeviceTriggerCard('car_came_home');
        this._carLeftHomeTrigger = this.homey.flow.getDeviceTriggerCard('car_left_home');
        this.homey.flow.getConditionCard('car_is_at_home').registerRunListener(async (args) => {
            return args.device ? args.device.getCapabilityValue('measure_polestarAtHome') === true : false;
        });

        // OTA / tyre-pressure / climate transition triggers. Fired by
        // _setBoolAndTrigger() in device.js from the respective update
        // functions when the boolean value flips.
        this._otaAvailableTrigger = this.homey.flow.getDeviceTriggerCard('ota_update_available');
        this._otaInstalledTrigger = this.homey.flow.getDeviceTriggerCard('ota_update_installed');
        this._tyreWarningRaisedTrigger  = this.homey.flow.getDeviceTriggerCard('tyre_pressure_warning_raised');
        this._tyreWarningClearedTrigger = this.homey.flow.getDeviceTriggerCard('tyre_pressure_warning_cleared');
        this._climateStartedTrigger = this.homey.flow.getDeviceTriggerCard('climate_started');
        this._climateStoppedTrigger = this.homey.flow.getDeviceTriggerCard('climate_stopped');

        // Conditions for the other custom booleans. Each just reads the current
        // capability value; the !{{is|is not}} tokens in the title let the user
        // invert the check in the flow editor.
        const boolCondition = (capId) => async (args) =>
            args.device ? args.device.getCapabilityValue(capId) === true : false;
        this.homey.flow.getConditionCard('is_charging').registerRunListener(boolCondition('measure_vehicleChargeState'));
        this.homey.flow.getConditionCard('is_connected_to_charger').registerRunListener(boolCondition('measure_vehicleConnected'));
        this.homey.flow.getConditionCard('ota_is_available').registerRunListener(boolCondition('alarm_polestarOtaAvailable'));
        this.homey.flow.getConditionCard('tyre_pressure_warning_active').registerRunListener(boolCondition('alarm_polestarTyrePressure'));
        this.homey.flow.getConditionCard('climate_is_running').registerRunListener(boolCondition('onoff.climate'));

        this.homey.app.log('Polestar flow cards registered', 'Polestar Driver', 'DEBUG');
    }

    async onRepair(session, device) {
        session.setHandler("showView", async (data) => {
            this.homey.app.log('Login page of repair is showing, send credentials');

            var username = this.homey.settings.get('user_email');
            var cryptedpassword = this.homey.settings.get('user_password');
            try {
                plainpass = await HomeyCrypt.decrypt(cryptedpassword, username);
                await session.emit('loadaccount', { username, password: plainpass });
            } catch (err) {
                await session.emit('loadaccount', { username, password: '' })
            }
        });

        session.setHandler('testlogin', async (data) => {
            this.homey.app.log('Test login and provide feedback, username length: ' + data.username.length + ' password length: ' + data.password.length, 'Polestar Driver');
            //Store the provided credentials, but hash and salt it first
            this.homey.settings.set('user_email', data.username);
            HomeyCrypt.crypt(data.password, data.username).then(cryptedpass => {
                //this.homey.app.log(JSON.stringify(cryptedpass));
                this.homey.settings.set('user_password', cryptedpass);
            })
            this.homey.app.log('Password encrypted, credentials stored. Clear existing tokens.', 'Polestar Driver');
            //Now we have the encrypted password stored we can start testing the info
            try {
                var polestar = Polestar(data.username, data.password, this.homey);
                await polestar.login();
                var testresult = await polestar.getVehicles();
                this.homey.app.log('Credential test ok:', 'Polestar Driver', 'DEBUG', testresult);
                if (!testresult || testresult.length === 0) {
                    const legacy = await this._tryLegacyFallback(data.username, data.password);
                    if (legacy.ok) {
                        this.homey.settings.set('c3_backend_disabled', true);
                        this.homey.app.log('Repair: C3 returned no vehicles; legacy backend found ' + legacy.count + '. Switching to legacy.', 'Polestar Driver');
                        await session.nextView();
                        return true;
                    }
                    return false;
                }
                await session.nextView();
                return true;
            } catch (err) {
                this.homey.app.log('Credential test failed:', 'Polestar Driver', 'ERROR', err);
                return false;
            }
        });
    }

    async onPair(session) {
        let mydevices;

        session.setHandler('showView', async (viewId) => {
            //These actions send data to the custom views

            if (viewId === 'login') {
                this.homey.app.log('Login page of pairing is showing, send credentials', 'Polestar Driver');
                //Send the stored credentials to the 
                var username = this.homey.settings.get('user_email');
                var cryptedpassword = this.homey.settings.get('user_password');
                try {
                    plainpass = await HomeyCrypt.decrypt(cryptedpassword, username);
                    await session.emit('loadaccount', { username, password: plainpass });
                } catch (err) {
                    await session.emit('loadaccount', { username, password: '' })
                }
            };
        });

        session.setHandler('list_devices', async (data) => {
            return mydevices;
        });

        session.setHandler('add_devices', async (data) => {
            if (data.length > 0) {
                this.homey.app.log('vehicle [' + data[0].name + '] added', 'Polestar Driver');
            } else {
                this.homey.app.log('No vehicle added', 'Polestar Driver', 'WARNING');
            }
        });

        session.setHandler('discover_vehicles', async (data) => {
            this.homey.app.log('Polestar vehicles discovery started...', 'Polestar Driver');
            let PolestarUser = this.homey.settings.get('user_email');
            let PolestarPwd = await HomeyCrypt.decrypt(this.homey.settings.get('user_password'), PolestarUser);
            try {
                this.homey.app.log('Attempting to login to Polestar', 'Polestar Driver');
                var polestar = Polestar(PolestarUser, PolestarPwd, this.homey);
                await polestar.login();
                this.homey.app.log('Login successful, retrieving vehicles', 'Polestar Driver');
                var vehiclelist = await polestar.getVehicles();
                if (vehiclelist && vehiclelist.length > 0) {
                    var vehicles = vehiclelist.map((bev) => {
                        try {
                            // Log ownership status so we can correlate feature-availability
                            // complaints with linked/owner state (C3 GetMyCars returns these
                            // as of PR #3). Non-owner accounts on lease / secondhand cars may
                            // hit permission-limited endpoints; we don't know yet which
                            // features degrade without owner rights.
                            const linked = bev.userIsLinked === true ? 'yes' : (bev.userIsLinked === false ? 'no' : '?');
                            const owner  = bev.userIsOwner  === true ? 'yes' : (bev.userIsOwner  === false ? 'no' : '?');
                            this.homey.app.log(`Located vehicle ${bev.content.model.name} — linked:${linked} owner:${owner}`, 'Polestar Driver');
                            const device = toPairingDevice(bev);

                            return device;
                        } catch (err) {
                            this.homey.app.log('Could not convert vehicle info to bev', 'Polestar Driver', 'ERROR', err);
                            return err;
                        }
                    });
                } else {
                    this.homey.app.log('No vehicles found', 'Polestar Driver', 'WARNING');
                    var vehicles = [];
                    return await session.emit('noVehiclesFound', 'No vehicles found, please try again.');
                }

                this.homey.app.log('Vehicles ready to be added:', 'Polestar Driver', 'DEBUG', vehicles);
                mydevices = vehicles;
                await session.showView('list_devices');
            } catch (err) {
                this.homey.app.log('Could not login to Polestar', 'Polestar Driver', 'ERROR', err);
                return err;
            }
        });

        session.setHandler('testlogin', async (data) => {
            this.homey.app.log('Test login and provide feedback, username length: ' + data.username.length + ' password length: ' + data.password.length, 'Polestar Driver');
            this.homey.settings.set('user_email', data.username);
            HomeyCrypt.crypt(data.password, data.username).then(cryptedpass => {
                this.homey.settings.set('user_password', cryptedpass);
            })
            this.homey.app.log('Password encrypted, credentials stored.', 'Polestar Driver');

            const polestar = Polestar(data.username, data.password, this.homey);
            try {
                await polestar.login();
            } catch (err) {
                this.homey.app.log('Credential test failed:', 'Polestar Driver', 'ERROR', err);
                return { ok: false, reason: 'login_failed' };
            }
            let vehicles;
            try {
                vehicles = await polestar.getVehicles();
            } catch (err) {
                this.homey.app.log('Retrieve vehicles failed:', 'Polestar Driver', 'ERROR', err);
                return { ok: false, reason: 'login_failed' };
            }
            this.homey.app.log('Credential test ok, vehicle count:', 'Polestar Driver', 'DEBUG', (vehicles || []).length);
            if (!vehicles || vehicles.length === 0) {
                // C3 backend doesn't list some older Polestar 2 cars (2021-ish).
                // Try the legacy backend before giving up — and if it finds
                // vehicles, persist the preference so all later operations
                // use it too.
                const legacy = await this._tryLegacyFallback(data.username, data.password);
                if (legacy.ok) {
                    this.homey.settings.set('c3_backend_disabled', true);
                    this.homey.app.log('C3 returned no vehicles; legacy backend found ' + legacy.count + '. Switching to legacy.', 'Polestar Driver');
                    return { ok: true };
                }
                return { ok: false, reason: 'no_vehicles' };
            }
            return { ok: true };
        });
    }

    async _tryLegacyFallback(email, password) {
        try {
            const legacy = new LegacyPolestar(email, password);
            await legacy.login();
            const vehicles = await legacy.getVehicles();
            if (vehicles && vehicles.length > 0) {
                return { ok: true, count: vehicles.length };
            }
        } catch (err) {
            this.homey.app.log('Legacy fallback failed:', 'Polestar Driver', 'DEBUG', err && err.message);
        }
        return { ok: false, count: 0 };
    }

}

module.exports = Vehicle;
