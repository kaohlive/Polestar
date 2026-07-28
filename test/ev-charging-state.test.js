'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
    resolveConnected,
    resolveChargingState,
    isSmartCharging,
} = require('../lib/evChargingState');

// Every member of the C3 ChargingStatus enum (clone_modules/polestar-c3/messages.js),
// as compat.js renders it: 'CHARGING_STATUS_' + label.
const ALL_STATUSES = [
    'CHARGING_STATUS_UNSPECIFIED',
    'CHARGING_STATUS_CHARGING',
    'CHARGING_STATUS_IDLE',
    'CHARGING_STATUS_SCHEDULED',
    'CHARGING_STATUS_DISCHARGING',
    'CHARGING_STATUS_ERROR',
    'CHARGING_STATUS_SMART_CHARGING',
    'CHARGING_STATUS_DONE',
    'CHARGING_STATUS_SMART_CHARGING_PAUSED',
];

// Every ChargerConnectionStatus label the client can produce, plus the absent
// case (legacy client / field missing from the decoded message).
const ALL_CONNECTION_LABELS = ['CONNECTED', 'DISCONNECTED', 'UNSPECIFIED', 'FAULT', null];

const resolve = (chargingStatus, chargerConnectionStatusLabel) => resolveChargingState({
    chargingStatus,
    connected: resolveConnected({ chargingStatus, chargerConnectionStatusLabel }),
});

test('CONNECTED / DISCONNECTED are authoritative; everything else falls back to the status', () => {
    for (const chargingStatus of ALL_STATUSES) {
        assert.equal(resolveConnected({ chargingStatus, chargerConnectionStatusLabel: 'CONNECTED' }), true);
        assert.equal(resolveConnected({ chargingStatus, chargerConnectionStatusLabel: 'DISCONNECTED' }), false);
    }

    // UNSPECIFIED is the enum's zero value and the client renders it as a truthy
    // string, so it must not be mistaken for a verdict either way.
    for (const chargerConnectionStatusLabel of ['UNSPECIFIED', 'FAULT', null, undefined]) {
        assert.equal(
            resolveConnected({ chargingStatus: 'CHARGING_STATUS_CHARGING', chargerConnectionStatusLabel }),
            true,
        );
        assert.equal(
            resolveConnected({ chargingStatus: 'CHARGING_STATUS_IDLE', chargerConnectionStatusLabel }),
            false,
        );
    }

    // Discharging implies the connector is in — it was missing from the old set.
    assert.equal(
        resolveConnected({ chargingStatus: 'CHARGING_STATUS_DISCHARGING', chargerConnectionStatusLabel: null }),
        true,
    );
});

test('charging states map to the value the charger on the other end reports', () => {
    // Power is flowing. Charging and smart charging are separate statuses that
    // share this plug state; every charger app agrees on plugged_in_charging.
    assert.equal(resolve('CHARGING_STATUS_CHARGING', 'CONNECTED'), 'plugged_in_charging');
    assert.equal(resolve('CHARGING_STATUS_SMART_CHARGING', 'CONNECTED'), 'plugged_in_charging');

    // V2L / V2G — C3 reports it explicitly, so it must not be flattened.
    assert.equal(resolve('CHARGING_STATUS_DISCHARGING', 'CONNECTED'), 'plugged_in_discharging');

    // Held but resumable, matching the Wall Connector's waiting-on-vehicle state.
    assert.equal(resolve('CHARGING_STATUS_SCHEDULED', 'CONNECTED'), 'plugged_in_paused');
    assert.equal(resolve('CHARGING_STATUS_SMART_CHARGING_PAUSED', 'CONNECTED'), 'plugged_in_paused');

    // Connected, nothing flowing, nothing queued.
    assert.equal(resolve('CHARGING_STATUS_DONE', 'CONNECTED'), 'plugged_in');
    assert.equal(resolve('CHARGING_STATUS_IDLE', 'CONNECTED'), 'plugged_in');
    assert.equal(resolve('CHARGING_STATUS_ERROR', 'CONNECTED'), 'plugged_in');
    assert.equal(resolve('CHARGING_STATUS_UNSPECIFIED', 'CONNECTED'), 'plugged_in');
});

test('never reports plugged_out while the connector is in', () => {
    for (const chargingStatus of ALL_STATUSES) {
        assert.notEqual(
            resolve(chargingStatus, 'CONNECTED'),
            'plugged_out',
            `${chargingStatus} claimed plugged_out despite CONNECTED`,
        );
    }

    // An UNSPECIFIED status with an equally unhelpful connection label used to
    // fall through to plugged_out. It must resolve from the cable, not the gap.
    assert.equal(resolve('CHARGING_STATUS_UNSPECIFIED', 'UNSPECIFIED'), 'plugged_out');
    assert.equal(resolve('CHARGING_STATUS_DONE', 'UNSPECIFIED'), 'plugged_in');
    assert.equal(resolve('CHARGING_STATUS_CHARGING', 'UNSPECIFIED'), 'plugged_in_charging');
});

test('DISCONNECTED collapses every status to plugged_out', () => {
    // The old code could publish measure_vehicleConnected=false alongside
    // ev_charging_state='plugged_in' in the same poll.
    for (const chargingStatus of ALL_STATUSES) {
        assert.equal(
            resolve(chargingStatus, 'DISCONNECTED'),
            'plugged_out',
            `${chargingStatus} disagreed with DISCONNECTED`,
        );
    }
});

test('every status and connection label resolves to a valid enum member', () => {
    const valid = new Set([
        'plugged_in_charging',
        'plugged_in_discharging',
        'plugged_in_paused',
        'plugged_in',
        'plugged_out',
    ]);
    for (const chargingStatus of [...ALL_STATUSES, 'CHARGING_STATUS_SOMETHING_NEW']) {
        for (const label of ALL_CONNECTION_LABELS) {
            const state = resolve(chargingStatus, label);
            assert.ok(valid.has(state), `${chargingStatus}/${label} produced ${state}`);
        }
    }
});

test('smart charging stays distinguishable from plain charging', () => {
    assert.equal(isSmartCharging('CHARGING_STATUS_SMART_CHARGING'), true);
    assert.equal(isSmartCharging('CHARGING_STATUS_SMART_CHARGING_PAUSED'), true);
    assert.equal(isSmartCharging('CHARGING_STATUS_CHARGING'), false);
    assert.equal(isSmartCharging('CHARGING_STATUS_SCHEDULED'), false);
});
