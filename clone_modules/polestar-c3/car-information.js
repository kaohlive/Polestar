'use strict';

const codec = require('./codec');

// Stable identity subset of the APK's conncar mdapi protobufs. The server also
// returns a large capability matrix; unknown fields are deliberately ignored.
const CarSchema = {
    vin: { num: 1, type: 'string' },
    vehicleTypeCode: { num: 5, type: 'string' },
    vehicleTypeName: { num: 6, type: 'string' },
    modelYear: { num: 7, type: 'string' },
    consumerSoftwareVersion: { num: 9, type: 'string' },
    market: { num: 10, type: 'string' },
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

function decodeGetMyCarsResponse(bytes) {
    const decoded = codec.decode(GetMyCarsResponseSchema, bytes);
    const cars = decoded.myCars
        ? (Array.isArray(decoded.myCars) ? decoded.myCars : [decoded.myCars])
        : [];

    return cars
        .filter((entry) => entry.car && entry.car.vin)
        .map((entry) => ({
            vin: entry.car.vin,
            internalVehicleIdentifier: undefined,
            registrationNo: entry.registrationPlate || null,
            modelYear: entry.car.modelYear || undefined,
            market: entry.car.market || undefined,
            userIsLinked: entry.userIsLinked === true,
            userIsOwner: entry.userIsOwner === true,
            content: {
                model: {
                    name: entry.car.vehicleTypeName || `Polestar ${entry.car.vehicleTypeCode || ''}`.trim(),
                },
            },
        }));
}

module.exports = {
    CarSchema,
    MyCarSchema,
    GetMyCarsResponseSchema,
    decodeGetMyCarsResponse,
};
