'use strict';

/**
 * ChronosRequest envelope used by all /chronos.services.v1.* gRPC services
 * (ChargeNow, TargetSoc, AmpLimit, ChargeTimer, ParkingClimateTimer).
 *
 * Wire layout:
 *   field 1: string id              — random UUID per call
 *   field 2: string vin
 *   field 3: string source          — always "RCS"
 *   field 4: TimeZone {
 *     field 1: int32 offset_minutes
 *   }
 *
 * Outer request wraps ChronosRequest at field 1, then appends any
 * service-specific fields (level, amperage, etc.) at fields 2+.
 */

const { randomUUID } = require('crypto');
const codec = require('./codec');

const CHRONOS_REQUEST_SCHEMA = {
    id: { num: 1, type: 'string' },
    vin: { num: 2, type: 'string' },
    source: { num: 3, type: 'string' },
    time_zone: { num: 4, type: 'message' },
};

const TIMEZONE_SCHEMA = {
    offset_minutes: { num: 1, type: 'int32' },
};

function utcOffsetMinutes() {
    // Node returns minutes WEST of UTC (positive = behind UTC). Polestar wants
    // minutes EAST of UTC (positive = ahead), matching Python's utcoffset().
    return -new Date().getTimezoneOffset();
}

function buildChronosRequest(vin) {
    const tz = codec.encode(TIMEZONE_SCHEMA, { offset_minutes: utcOffsetMinutes() });
    return codec.encode(CHRONOS_REQUEST_SCHEMA, {
        id: randomUUID(),
        vin,
        source: 'RCS',
        time_zone: tz,
    });
}

function wrapChronos(vin, innerPayload = Buffer.alloc(0)) {
    // Field 1 = ChronosRequest (length-delimited nested message), followed by
    // raw payload bytes (already encoded with tags for field 2+).
    return Buffer.concat([
        codec.encodeField(1, 'message', buildChronosRequest(vin)),
        innerPayload,
    ]);
}

module.exports = { buildChronosRequest, wrapChronos };
