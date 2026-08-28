'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const PolestarC3Compat = require('../clone_modules/polestar-c3/compat');
const {
    contactStatesFromExterior,
    aggregateWindowState,
    isRealContactTransition,
    mergeSupportedContactCapabilities,
    observedContactCapabilities,
} = require('../drivers/vehicle/contact-capabilities');

test('C3 exterior mapping preserves absent contacts and individual window states', async () => {
    const compat = Object.create(PolestarC3Compat.prototype);
    compat._client = {
        getLatestExterior: async () => ({
            exterior: {
                central_lock: 2,
                central_lock_label: 'LOCKED',
                door_front_left: 2,
                door_front_right: 1,
                door_rear_left: 2,
                door_rear_right: 2,
                window_front_left: 2,
                window_front_right: 3,
                window_rear_left: 2,
                window_rear_right: 2,
                hood: 2,
                tailgate: 2,
                // P3 does not report tank_lid or sunroof.
            },
        }),
    };

    const exterior = await compat.getExterior();
    assert.equal(exterior.isLocked, true);
    assert.equal(exterior.doors.frontRightOpen, true);
    assert.equal(exterior.windows.frontRightOpen, true);
    assert.equal(exterior.windows.frontLeftOpen, false);
    assert.equal(exterior.tankLidOpen, undefined);
    assert.equal(exterior.sunroofOpen, undefined);

    const observed = observedContactCapabilities(contactStatesFromExterior(exterior));
    assert.deepEqual(observed, [
        'alarm_contact.door_front_left',
        'alarm_contact.door_front_right',
        'alarm_contact.door_rear_left',
        'alarm_contact.door_rear_right',
        'alarm_contact.window_front_left',
        'alarm_contact.window_front_right',
        'alarm_contact.window_rear_left',
        'alarm_contact.window_rear_right',
        'alarm_contact.tailgate',
        'alarm_contact.hood',
    ]);
});

test('explicit UNSPECIFIED contacts are discovered and retain the existing closed mapping', async () => {
    const compat = Object.create(PolestarC3Compat.prototype);
    compat._client = {
        getLatestExterior: async () => ({
            exterior: {
                door_front_left: 0,
                window_front_left: 0,
                tank_lid: 0,
            },
        }),
    };

    const exterior = await compat.getExterior();
    assert.equal(exterior.doors.frontLeftOpen, false);
    assert.equal(exterior.windows.frontLeftOpen, false);
    assert.equal(exterior.tankLidOpen, false);
    assert.deepEqual(observedContactCapabilities(contactStatesFromExterior(exterior)), [
        'alarm_contact.door_front_left',
        'alarm_contact.window_front_left',
        'alarm_contact.tank_lid',
    ]);
});

test('later partial snapshots add contacts without removing previously discovered ones', () => {
    const stored = [
        'alarm_contact.door_front_left',
        'alarm_contact.window_front_left',
    ];
    const partial = {
        'alarm_contact.door_front_left': false,
        'alarm_contact.window_front_right': false,
    };

    assert.deepEqual(mergeSupportedContactCapabilities(stored, partial), [
        'alarm_contact.door_front_left',
        'alarm_contact.window_front_left',
        'alarm_contact.window_front_right',
    ]);
});

test('initial contact population is not treated as an open or close transition', () => {
    assert.equal(isRealContactTransition(null, false), false);
    assert.equal(isRealContactTransition(undefined, true), false);
    assert.equal(isRealContactTransition(false, false), false);
    assert.equal(isRealContactTransition(false, true), true);
    assert.equal(isRealContactTransition(true, false), true);
});

test('legacy aggregate window state is retained only when it is knowable', () => {
    assert.equal(aggregateWindowState({ windows: {
        frontLeftOpen: false,
        frontRightOpen: false,
        rearLeftOpen: false,
        rearRightOpen: false,
    } }), false);
    assert.equal(aggregateWindowState({ windows: {
        frontLeftOpen: null,
        frontRightOpen: true,
    } }), true);
    assert.equal(aggregateWindowState({ windows: {
        frontLeftOpen: false,
        frontRightOpen: null,
    } }), null);
});
