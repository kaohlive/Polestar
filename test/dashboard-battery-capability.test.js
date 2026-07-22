'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const dashboardApi = require('../widgets/dashboard/api');

test('dashboard reads the standard battery capability from vehicle devices', async () => {
    const capabilityReads = [];
    const vehicle = {
        getData: () => ({ registration: 'test-registration' }),
        getCapabilityValue: (capability) => {
            capabilityReads.push(capability);
            return capability === 'measure_battery' ? 42 : null;
        },
    };
    const homey = {
        drivers: {
            getDriver: async (driverId) => {
                assert.equal(driverId, 'vehicle');
                return { getDevices: () => [vehicle] };
            },
        },
        settings: { get: () => null },
    };

    const status = await dashboardApi.getVehicleStatus({
        homey,
        query: { registration: 'test-registration' },
    });

    assert.equal(status.battery, 42);
    assert.equal(capabilityReads.includes('measure_polestarBattery'), false);
});
