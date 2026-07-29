'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const codec = require('../clone_modules/polestar-c3/codec');
const { PolestarC3 } = require('../clone_modules/polestar-c3/client');
const PolestarCompat = require('../clone_modules/polestar-c3/compat');
const {
    BatterySchema,
    GetBatteryResponseSchema,
    ManualPreconditioningSchema,
} = require('../clone_modules/polestar-c3/messages');
const {
    normalizeManualPreconditioning,
    transitionPreconditioningState,
} = require('../clone_modules/polestar-c3/preconditioning');

function batteryResponse(status, unavailableReason = 0) {
    return codec.encode(GetBatteryResponseSchema, {
        battery: codec.encode(BatterySchema, {
            charge_level: 42,
            manual_preconditioning: codec.encode(ManualPreconditioningSchema, {
                status,
                unavailable_reason: unavailableReason,
                started_at: { seconds: 100 },
                ending_at: { seconds: 200 },
            }),
        }),
    });
}

test('C3 battery field 29 decodes status and unavailable-reason labels', async () => {
    const client = new PolestarC3('test@example.com', 'unused');
    client._vin = 'test-vin';
    client._call = async () => batteryResponse(5, 5);

    const manual = (await client.getLatestBattery()).battery.manual_preconditioning;
    assert.equal(manual.status_label, 'UNAVAILABLE');
    assert.equal(manual.unavailable_reason_label, 'PRECONDITIONING_IN_PROGRESS');
    assert.equal(manual.started_at.seconds, 100);
    assert.equal(manual.ending_at.seconds, 200);
});

test('preconditioning-in-progress and charging-in-progress remain distinct states', () => {
    assert.deepEqual(normalizeManualPreconditioning({
        status_label: 'UNAVAILABLE',
        unavailable_reason_label: 'PRECONDITIONING_IN_PROGRESS',
    }), {
        reported: true,
        key: 'in_progress',
        label: 'In progress',
    });

    assert.deepEqual(normalizeManualPreconditioning({
        status_label: 'UNAVAILABLE',
        unavailable_reason_label: 'CHARGING_IN_PROGRESS',
    }), {
        reported: true,
        key: 'charging',
        label: 'Unavailable: charging',
    });
});

test('compat exposes normalized preconditioning state to the Homey driver', async () => {
    const compat = new PolestarCompat('test@example.com', 'unused');
    compat._fetchBattery = async () => ({
        battery: {
            charge_level: 42,
            manual_preconditioning: {
                status_label: 'ON',
                unavailable_reason_label: 'UNSPECIFIED',
                started_at: { seconds: 100 },
            },
        },
    });

    const battery = await compat.getBattery();
    assert.equal(battery.batteryPreconditioningReported, true);
    assert.equal(battery.batteryPreconditioningStatusKey, 'on');
    assert.equal(battery.batteryPreconditioningStatusLabel, 'On');
});

test('first observation is silent and reported state changes fire once', () => {
    assert.deepEqual(transitionPreconditioningState(null, 'in_progress'), {
        key: 'in_progress',
        changed: false,
    });
    assert.deepEqual(transitionPreconditioningState('off', 'in_progress'), {
        key: 'in_progress',
        changed: true,
    });
    assert.deepEqual(transitionPreconditioningState('in_progress', 'in_progress'), {
        key: 'in_progress',
        changed: false,
    });
    assert.deepEqual(transitionPreconditioningState('in_progress', 'charging'), {
        key: 'charging',
        changed: true,
    });
});

test('missing field 29 remains unknown and does not fabricate a transition', () => {
    assert.deepEqual(normalizeManualPreconditioning(undefined), {
        reported: false,
        key: null,
        label: 'Not reported',
    });
});

test('missing field 29 preserves the last reported state', () => {
    let transition = transitionPreconditioningState(null, 'off');
    assert.deepEqual(transition, { key: 'off', changed: false });

    transition = transitionPreconditioningState(transition.key, null);
    assert.deepEqual(transition, { key: 'off', changed: false });

    transition = transitionPreconditioningState(transition.key, 'on');
    assert.deepEqual(transition, { key: 'on', changed: true });
});

test('Flow contract uses one generic trigger and an enum condition', () => {
    const flow = JSON.parse(fs.readFileSync(
        path.join(__dirname, '../drivers/vehicle/driver.flow.compose.json'),
        'utf8',
    ));
    const trigger = flow.triggers.find((card) => card.id === 'battery_preconditioning_changed');
    assert.ok(trigger);
    assert.equal(trigger.args, undefined);
    assert.equal(trigger.$filter, undefined);
    assert.deepEqual(trigger.tokens.map((token) => token.name), ['state']);
    assert.equal(flow.triggers.some((card) => card.id.startsWith('battery_preconditioning_')
        && card.id !== 'battery_preconditioning_changed'), false);

    const condition = flow.conditions.find((card) => card.id === 'battery_preconditioning_state_is');
    assert.ok(condition);
    assert.equal(condition.$filter, undefined);
    const stateArg = condition.args.find((arg) => arg.name === 'state');
    assert.deepEqual(stateArg.values.map((value) => value.id), [
        'in_progress',
        'on',
        'off',
        'finished',
        'optimal',
        'planned',
        'fault',
        'charging',
        'low_energy',
        'unavailable',
        'unknown',
    ]);

    assert.equal(
        fs.existsSync(path.join(
            __dirname,
            '../.homeycompose/capabilities/measure_polestarBatteryPreconditioningStatus.json',
        )),
        false,
        'preconditioning must not be exposed as a device capability',
    );
});
