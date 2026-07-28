'use strict';

function toPairingDevice(bev) {
    const modelName = bev.content.model.name;

    return {
        id: bev.vin,
        name: bev.registrationNo ? `${modelName} (${bev.registrationNo})` : modelName,
        data: {
            vin: bev.vin,
            registration: bev.registrationNo,
            internalVehicleIdentifier: bev.internalVehicleIdentifier,
            modelName,
            modelYear: bev.modelYear,
            carImage: bev.content.images?.studio?.url || null,
            deliveryDate: bev.deliveryDate,
            hasPerformancePackage: bev.hasPerformancePackage
        }
    };
}

module.exports = toPairingDevice;
