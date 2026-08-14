'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const originalLoad = Module._load;
Module._load = function loadWithHomeyStub(request, parent, isMain) {
    if (request === 'homey') return { Device: class Device {} };
    return originalLoad.call(this, request, parent, isMain);
};
const PolestarVehicle = require('../drivers/vehicle/device');
Module._load = originalLoad;

function vehicleHarness({ modelName = 'Polestar 3', capabilities = [], unsupportedFeatures = {} } = {}) {
    const device = Object.create(PolestarVehicle.prototype);
    device.name = 'Test car';
    device._caps = new Set(capabilities);
    device._options = {};
    device._values = {};
    device._store = { unsupportedFeatures: { ...unsupportedFeatures } };
    device.homey = { app: { log() {} } };
    device.getData = () => ({ modelName });
    device.hasCapability = (capability) => device._caps.has(capability);
    device.addCapability = async (capability) => device._caps.add(capability);
    device.removeCapability = async (capability) => device._caps.delete(capability);
    device.getCapabilityOptions = async (capability) => device._options[capability] || {};
    device.setCapabilityOptions = async (capability, options) => { device._options[capability] = { ...options }; };
    device.setCapabilityValue = async (capability, value) => { device._values[capability] = value; };
    device.getStoreValue = (key) => device._store[key];
    device.setStoreValue = async (key, value) => { device._store[key] = value; };
    return device;
}

test('startup probe configures and applies a Polestar 3 charge limit of 40%', async () => {
    const device = vehicleHarness();
    device.polestar = { getTargetSoc: async () => 40 };

    await device.refreshChargeLimit({ forceProbe: true });

    assert.equal(device._caps.has('target_polestarChargeLimit'), true);
    assert.deepEqual(device._options.target_polestarChargeLimit, { min: 40, max: 100, step: 10 });
    assert.equal(device._values.target_polestarChargeLimit, 40);
});

test('UNIMPLEMENTED removes the amp capability and records unsupported state', async () => {
    const device = vehicleHarness({ capabilities: ['target_polestarAmpLimit'] });
    device.polestar = { getAmpLimit: async () => { throw new Error('status=12 message="Functionality not supported: AMP_LIMIT"'); } };

    await device.refreshAmpLimit({ forceProbe: true });

    assert.equal(device._caps.has('target_polestarAmpLimit'), false);
    assert.equal(device._store.unsupportedFeatures.amp_limit, true);
});

test('a repeated UNIMPLEMENTED probe still removes a capability re-added by Homey', async () => {
    const device = vehicleHarness({
        capabilities: ['target_polestarAmpLimit'],
        unsupportedFeatures: { amp_limit: true },
    });
    device.polestar = { getAmpLimit: async () => { throw new Error('status=12 UNIMPLEMENTED'); } };

    await device.refreshAmpLimit({ forceProbe: true });

    assert.equal(device._caps.has('target_polestarAmpLimit'), false);
    assert.equal(device._store.unsupportedFeatures.amp_limit, true);
});

test('a later successful startup probe restores a previously unsupported capability', async () => {
    const device = vehicleHarness({ unsupportedFeatures: { amp_limit: true } });
    device.polestar = { getAmpLimit: async () => 16 };

    await device.refreshAmpLimit({ forceProbe: true });

    assert.equal(device._caps.has('target_polestarAmpLimit'), true);
    assert.equal(device._store.unsupportedFeatures.amp_limit, undefined);
    assert.equal(device._values.target_polestarAmpLimit, 16);
});

test('a transient startup probe failure preserves capability and stored support state', async () => {
    const device = vehicleHarness({ capabilities: ['target_polestarAmpLimit'] });
    device.polestar = { getAmpLimit: async () => { throw new Error('status=14 service unavailable'); } };

    await device.refreshAmpLimit({ forceProbe: true });

    assert.equal(device._caps.has('target_polestarAmpLimit'), true);
    assert.deepEqual(device._store.unsupportedFeatures, {});
});

test('model bounds are configured even when the target-SoC startup probe is transiently unavailable', async () => {
    const device = vehicleHarness({ capabilities: ['target_polestarChargeLimit'] });
    device._options.target_polestarChargeLimit = { min: 40, max: 100, step: 5 };
    device.polestar = { getTargetSoc: async () => { throw new Error('status=14 service unavailable'); } };

    await device._configureChargeLimitProfile();
    await device.refreshChargeLimit({ forceProbe: true });

    assert.deepEqual(device._options.target_polestarChargeLimit, { min: 40, max: 100, step: 10 });
    await assert.rejects(device._validateTargetSoc(45), /40–100% in 10% steps/);

    const polestar2 = vehicleHarness({ modelName: 'Polestar 2', capabilities: ['target_polestarChargeLimit'] });
    polestar2._options.target_polestarChargeLimit = { min: 40, max: 100, step: 5 };
    await polestar2._configureChargeLimitProfile();
    assert.deepEqual(polestar2._options.target_polestarChargeLimit, { min: 50, max: 100, step: 5 });
});

test('charge-limit setup does not read capability options from Homey', async () => {
    const device = vehicleHarness({ capabilities: ['target_polestarChargeLimit'] });
    device.getCapabilityOptions = () => { throw new Error('Invalid Capability: target_polestarChargeLimit'); };

    await device._configureChargeLimitProfile();

    assert.deepEqual(device._options.target_polestarChargeLimit, { min: 40, max: 100, step: 10 });
    assert.deepEqual(device._store.configuredChargeLimitProfile, { min: 40, max: 100, step: 10 });
    assert.equal(await device._validateTargetSoc(40), 40);
});

test('a non-12 gRPC status containing not supported does not remove a capability', async () => {
    const device = vehicleHarness({ capabilities: ['target_polestarAmpLimit'] });
    device.polestar = { getAmpLimit: async () => { throw new Error('status=9 not supported while charging'); } };

    await device.refreshAmpLimit({ forceProbe: true });

    assert.equal(device._caps.has('target_polestarAmpLimit'), true);
    assert.deepEqual(device._store.unsupportedFeatures, {});
});

test('a transient re-probe also preserves a previously unsupported state', async () => {
    const device = vehicleHarness({ unsupportedFeatures: { amp_limit: true } });
    device.polestar = { getAmpLimit: async () => { throw new Error('status=14 service unavailable'); } };

    await device.refreshAmpLimit({ forceProbe: true });

    assert.equal(device._caps.has('target_polestarAmpLimit'), false);
    assert.equal(device._store.unsupportedFeatures.amp_limit, true);
});

test('routine polling skips a service stored as unsupported', async () => {
    const device = vehicleHarness({ unsupportedFeatures: { amp_limit: true } });
    let calls = 0;
    device.polestar = { getAmpLimit: async () => { calls += 1; return 16; } };

    await device.refreshAmpLimit();

    assert.equal(calls, 0);
    assert.equal(device._caps.has('target_polestarAmpLimit'), false);
});

test('an expanded API-discovered charge profile is retained on later reads', async () => {
    const device = vehicleHarness();
    let target = 45;
    device.polestar = { getTargetSoc: async () => target };

    await device.refreshChargeLimit({ forceProbe: true });
    target = 50;
    await device.refreshChargeLimit();

    assert.deepEqual(device._options.target_polestarChargeLimit, { min: 40, max: 100, step: 1 });
    assert.deepEqual(device._store.chargeLimitProfile, { min: 40, max: 100, step: 1 });
});

test('charge-limit writes are validated against the effective device profile', async () => {
    const device = vehicleHarness({ capabilities: ['target_polestarChargeLimit'] });
    device._options.target_polestarChargeLimit = { min: 40, max: 100, step: 10 };

    assert.equal(await device._validateTargetSoc(40), 40);
    await assert.rejects(device._validateTargetSoc(45), /40–100% in 10% steps/);
});
