'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const toPairingDevice = require('../drivers/vehicle/pairing-device');

function vehicle(registrationNo) {
    return {
        vin: 'YSMTESTCAR0000001',
        registrationNo,
        internalVehicleIdentifier: 'test-vehicle',
        modelYear: '2025',
        content: {
            model: { name: 'Polestar 3' },
            images: { studio: { url: 'https://example.invalid/car.png' } },
        },
        deliveryDate: '2025-01-01',
        hasPerformancePackage: false,
    };
}

const nameScenarios = [
    {
        description: 'with registration',
        registrationNo: 'EV 12345',
        expectedName: 'Polestar 3 (EV 12345)',
    },
    {
        description: 'without registration',
        registrationNo: null,
        expectedName: 'Polestar 3',
    },
];

for (const { description, registrationNo, expectedName } of nameScenarios) {
    test(`proposed name ${description}: ${expectedName}`, () => {
        const pairedDevice = toPairingDevice(vehicle(registrationNo));

        assert.equal(pairedDevice.name, expectedName);
        assert.equal(pairedDevice.id, 'YSMTESTCAR0000001');
        assert.equal(pairedDevice.data.vin, 'YSMTESTCAR0000001');
        assert.equal(pairedDevice.data.registration, registrationNo);
    });
}
