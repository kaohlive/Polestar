'use strict'

// Resolves the C3 battery payload into Homey's `ev_charging_state` enum.
//
// `ev_charging_state` (cars) and `evcharger_charging_state` (chargers) are the
// same five values in homey-lib, so the car and the charger it is plugged into
// are expected to report the same value for the same physical moment. These
// mappings were checked against the Tesla car app, the Tesla Wall Connector,
// Easee and SolarEdge; where they disagreed, the majority-of-chargers reading
// wins — except for ERROR, where both *car* apps deliberately differ from the
// chargers (see resolveChargingState).
//
// Pure module: no Homey SDK, no I/O, so drivers/vehicle/device.js can resolve
// once per poll and every consumer reads the same answer.

const PLUGGED_IN_CHARGING = 'plugged_in_charging';
const PLUGGED_IN_DISCHARGING = 'plugged_in_discharging';
const PLUGGED_IN_PAUSED = 'plugged_in_paused';
const PLUGGED_IN = 'plugged_in';
const PLUGGED_OUT = 'plugged_out';

// Statuses that imply the connector is physically in. Only consulted when C3
// gives no authoritative charger_connection_status — the status field alone
// can't distinguish "idle, cable in" from "idle, cable out", which is why
// IDLE and UNSPECIFIED are absent here.
const CONNECTED_BY_STATUS = new Set([
    'CHARGING_STATUS_CHARGING',
    'CHARGING_STATUS_SMART_CHARGING',
    'CHARGING_STATUS_SMART_CHARGING_PAUSED',
    'CHARGING_STATUS_SCHEDULED',
    'CHARGING_STATUS_DISCHARGING',
    'CHARGING_STATUS_DONE',
    'CHARGING_STATUS_ERROR',
]);

// True when the vehicle is smart charging, in either direction. Charging and
// smart charging are separate states that happen to share a plug state; this
// keeps the smart/manual axis addressable without re-deriving it from the raw
// status at the call site.
module.exports.isSmartCharging = function (chargingStatus) {
    return chargingStatus === 'CHARGING_STATUS_SMART_CHARGING'
        || chargingStatus === 'CHARGING_STATUS_SMART_CHARGING_PAUSED';
};

// Is the connector in? `charger_connection_status` is authoritative when it
// actually says CONNECTED or DISCONNECTED. Anything else — UNSPECIFIED (the
// enum's zero value, which the C3 client renders as the truthy string
// 'UNSPECIFIED'), FAULT, or an absent field — carries no connection verdict, so
// we fall back to what the charging status implies rather than defaulting to
// "unplugged".
module.exports.resolveConnected = function ({ chargerConnectionStatusLabel, chargingStatus }) {
    if (chargerConnectionStatusLabel === 'CONNECTED') return true;
    if (chargerConnectionStatusLabel === 'DISCONNECTED') return false;
    return CONNECTED_BY_STATUS.has(chargingStatus);
};

module.exports.resolveChargingState = function ({ chargingStatus, connected }) {
    // Connection wins outright. The two fields can contradict each other around
    // an unplug (status still says CHARGING while the connector already reports
    // DISCONNECTED); resolving from one source keeps ev_charging_state and
    // measure_vehicleConnected from disagreeing within a single poll, and the
    // next poll corrects a briefly-early plugged_out.
    if (!connected) return PLUGGED_OUT;

    switch (chargingStatus) {
        case 'CHARGING_STATUS_CHARGING':
            return PLUGGED_IN_CHARGING;

        // Smart charging is its own status, not a flavour of CHARGING — but
        // power is flowing, and that is the only thing this capability encodes.
        // Every charger app reports plugged_in_charging for the same moment.
        case 'CHARGING_STATUS_SMART_CHARGING':
            return PLUGGED_IN_CHARGING;

        // V2L / V2G. C3 reports this explicitly, so unlike the Tesla car app
        // (whose API has no such state) there is no reason to flatten it.
        case 'CHARGING_STATUS_DISCHARGING':
            return PLUGGED_IN_DISCHARGING;

        // Session held, resumable — the car resumes on its own schedule, and
        // button.charge_start overrides the timer immediately. Matches the Wall
        // Connector's ReadyToChargeWaitingOnVehicle and Tesla's Stopped.
        case 'CHARGING_STATUS_SCHEDULED':
            return PLUGGED_IN_PAUSED;
        case 'CHARGING_STATUS_SMART_CHARGING_PAUSED':
            return PLUGGED_IN_PAUSED;

        // DONE — target SoC reached. Not "paused": nothing resumes without
        // raising the limit. Tesla (Complete) and the Wall Connector
        // (ConnectedFullyCharged) both land on plugged_in too.
        //
        // ERROR — chargers report plugged_out on a fault, but a car knows its
        // own cable is still in. Both car apps keep this at plugged_in
        // (Tesla routes NoPower here), so we follow the car vantage point.
        //
        // IDLE / UNSPECIFIED / anything unrecognised — the connector is in and
        // nothing says otherwise. Never fall through to plugged_out here: that
        // is the one value consumers act on as "nothing to do here".
        case 'CHARGING_STATUS_DONE':
        case 'CHARGING_STATUS_ERROR':
        case 'CHARGING_STATUS_IDLE':
        default:
            return PLUGGED_IN;
    }
};

module.exports.PLUGGED_IN_CHARGING = PLUGGED_IN_CHARGING;
module.exports.PLUGGED_IN_DISCHARGING = PLUGGED_IN_DISCHARGING;
module.exports.PLUGGED_IN_PAUSED = PLUGGED_IN_PAUSED;
module.exports.PLUGGED_IN = PLUGGED_IN;
module.exports.PLUGGED_OUT = PLUGGED_OUT;
