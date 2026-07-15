'use strict';

const axios = require('axios');
const codec = require('./codec');

const C3_DISCOVERY_URL = 'https://cnepmob.volvocars.com/';
const C3_ACCEPT_HEADER = 'application/volvo.cloud.cnepmob.v1+json';

const CarSchema = {
    vin: { num: 1, type: 'string' },
    vehicleTypeCode: { num: 5, type: 'string' },
    vehicleTypeName: { num: 6, type: 'string' },
    modelYear: { num: 7, type: 'string' },
};

const MyCarSchema = {
    car: { num: 1, type: 'message', schema: CarSchema },
    userIsLinked: { num: 2, type: 'bool' },
    userIsOwner: { num: 3, type: 'bool' },
    registrationPlate: { num: 4, type: 'string' },
};

const GetMyCarsResponseSchema = {
    myCars: { num: 1, type: 'message', schema: MyCarSchema },
};

async function discoverC3Endpoint(accessToken) {
    const r = await axios.get(C3_DISCOVERY_URL, {
        headers: {
            authorization: `Bearer ${accessToken}`,
            accept: C3_ACCEPT_HEADER,
        },
        timeout: 30000,
        validateStatus: () => true,
    });
    if (r.status !== 200) throw new Error(`C3 discovery failed: ${r.status}`);
    const c3 = r.data.c3 || {};
    if (!c3.grpcHost) throw new Error('C3 discovery response missing grpcHost');
    return {
        host: c3.grpcHost,
        port: Number(c3.grpcPort || 443),
        keepAliveTime: c3.grpcKeepAliveTime || null,
    };
}

function decodeGetMyCarsResponse(bytes) {
    const decoded = codec.decode(GetMyCarsResponseSchema, bytes);
    const cars = decoded.myCars
        ? (Array.isArray(decoded.myCars) ? decoded.myCars : [decoded.myCars])
        : [];

    return cars
        .filter((entry) => entry.car && entry.car.vin)
        .map((entry) => ({
            vin: entry.car.vin,
            registrationNo: entry.registrationPlate || null,
            modelYear: entry.car.modelYear || undefined,
            userIsLinked: entry.userIsLinked === true,
            userIsOwner: entry.userIsOwner === true,
            content: {
                model: {
                    name: entry.car.vehicleTypeName
                        || `Polestar ${entry.car.vehicleTypeCode || ''}`.trim(),
                },
            },
        }));
}

module.exports = { discoverC3Endpoint, decodeGetMyCarsResponse };
