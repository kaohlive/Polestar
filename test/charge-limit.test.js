'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    chargeLimitProfileForModel,
    effectiveChargeLimitProfile,
    isChargeLimitAllowed,
} = require('../drivers/vehicle/charge-limit');

test('Polestar 3 uses a 40-100% range in 10% steps', () => {
    assert.deepEqual(chargeLimitProfileForModel('Polestar 3'), { min: 40, max: 100, step: 10 });
    assert.equal(isChargeLimitAllowed(40, chargeLimitProfileForModel('Polestar 3')), true);
    assert.equal(isChargeLimitAllowed(45, chargeLimitProfileForModel('Polestar 3')), false);
});

test('other and unknown models retain the conservative default profile', () => {
    for (const model of ['Polestar 2', 'Polestar 4', undefined]) {
        assert.deepEqual(chargeLimitProfileForModel(model), { min: 50, max: 100, step: 5 });
    }
});

test('a valid unexpected API value expands the range instead of being discarded', () => {
    assert.deepEqual(effectiveChargeLimitProfile('Polestar 2', 40), { min: 40, max: 100, step: 5 });
    assert.deepEqual(effectiveChargeLimitProfile('Polestar 3', 45), { min: 40, max: 100, step: 1 });
    assert.equal(isChargeLimitAllowed(45, effectiveChargeLimitProfile('Polestar 3', 45)), true);
});

test('invalid API values do not alter the model profile', () => {
    assert.deepEqual(effectiveChargeLimitProfile('Polestar 3', 0), { min: 40, max: 100, step: 10 });
    assert.deepEqual(effectiveChargeLimitProfile('Polestar 3', 101), { min: 40, max: 100, step: 10 });
    assert.deepEqual(effectiveChargeLimitProfile('Polestar 3', 40.5), { min: 40, max: 100, step: 10 });
});
