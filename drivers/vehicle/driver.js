'use strict';

const { Driver } = require('homey');
const LegacyPolestar = require('../../clone_modules/polestar.js');
const PolestarC3Compat = require('../../clone_modules/polestar-c3/compat');
const HomeyCrypt = require('../../lib/homeycrypt')

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
                            this.homey.app.log('Located vehicle info, lets convert it into a Polestar bev', 'Polestar Driver');
                            let device = {
                                id: bev.vin,
                                name: bev.content.model.name + ' (' + bev.registrationNo + ')',
                                data: {
                                    vin: bev.vin,
                                    registration: bev.registrationNo,
                                    internalVehicleIdentifier: bev.internalVehicleIdentifier,
                                    modelName: bev.content.model.name,
                                    modelYear: bev.modelYear,
                                    carImage: bev.content.images?.studio?.url || null,
                                    deliveryDate: bev.deliveryDate,
                                    hasPerformancePackage: bev.hasPerformancePackage
                                }
                            }

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
            //Store the provided credentials, but hash and salt it first
            this.homey.settings.set('user_email', data.username);
            HomeyCrypt.crypt(data.password, data.username).then(cryptedpass => {
                //this.homey.app.log(JSON.stringify(cryptedpass));
                this.homey.settings.set('user_password', cryptedpass);
            })
            this.homey.app.log('Password encrypted, credentials stored. Clear existing tokens.', 'Polestar Driver');
            //Now we have the encrypted password stored we can start testing the info
            var polestar = Polestar(data.username, data.password, this.homey);
            //this.homey.app.log('Credential test password:', 'Polestar Driver', 'DEBUG', data.password);
            try {
                await polestar.login();
                this.homey.app.log('Credential test ok:', 'Polestar Driver', 'DEBUG', vehicles);
            } catch (err) {
                this.homey.app.log('Credential test failed:', 'Polestar Driver', 'ERROR', err);
                return false;
            }
            try {
                var vehicles = await polestar.getVehicles();
                return true;
            } catch (err) {
                this.homey.app.log('Retrieve vehicles failed:', 'Polestar Driver', 'ERROR', err);
                return false;
            }
        });
    }

}

module.exports = Vehicle;
