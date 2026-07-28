'use strict';

// A vehicle's identity is its VIN — the Polestar API is built on it and a car
// cannot exist without one. The registration number is optional (some accounts,
// notably Polestar 3, report none) and mutable (import, re-registration, new
// plates), so it was never a safe key.
//
// Widgets configured before this change stored a registration, so both keys are
// accepted: VIN first, registration as a fallback. That fallback is permanent —
// a widget cannot rewrite its own settings, so existing installs can only be
// migrated by the user re-picking their car, which we are not going to demand.
function identify(value) {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

async function getVehicle({ homey, vin, registration }) {
    if (!homey) {
        throw new Error('Missing Homey');
    }

    // Both keys are validated before use. A car with no registration has
    // data.registration === null, so matching an absent key against it would
    // silently bind the widget to whichever car happens to lack a plate.
    const wantedVin = identify(vin);
    const wantedRegistration = identify(registration);

    if (!wantedVin && !wantedRegistration) {
        throw new Error('Missing Vehicle identifier');
    }

    const driver = await homey.drivers.getDriver('vehicle');
    const devices = driver.getDevices();

    const vehicle = (wantedVin && devices.find(device => device.getData().vin === wantedVin))
        || (wantedRegistration && devices.find(device => device.getData().registration === wantedRegistration));

    if (!vehicle) {
        throw new Error('Vehicle Not Found');
    }

    return vehicle;
}

module.exports = {

  async getVehicleStatus({ homey, query }) {
    const { vin, registration } = query;
    const vehicle = await getVehicle({ homey, vin, registration });

    // Get distance unit setting (default to 'km')
    const distanceUnit = homey.settings.get('distance_unit') || 'km';
    const unitLabel = distanceUnit === 'miles' ? 'MI' : 'KM';

    return {
      battery: vehicle.getCapabilityValue('measure_battery'),
      connected: vehicle.getCapabilityValue('measure_vehicleConnected'),
      charging: vehicle.getCapabilityValue('measure_vehicleChargeState'),
      current: vehicle.getCapabilityValue('measure_current'),
      power: vehicle.getCapabilityValue('measure_power'),
      time_remaining: vehicle.getCapabilityValue('measure_vehicleChargeTimeRemaining'),
      odometer: vehicle.getCapabilityValue('measure_vehicleOdometer'),
      range: vehicle.getCapabilityValue('measure_vehicleRange'),
      service: vehicle.getCapabilityValue('alarm_generic'),
      distanceUnit: unitLabel,
    };
  },

  async getVehicles({ homey, body }){
    if (!homey) {
      throw new Error('Missing Homey');
    }

    // Note: the widget's settings picker does NOT come through here — it is
    // served by the autocomplete listener registered in app.js. This endpoint is
    // declared in widget.compose.json and kept consistent with it.
    //
    // Returns an explicit shape rather than raw Device instances: this is what
    // ends up stored in the widget's settings, so it needs to be a contract we
    // control and one that always carries the VIN.
    return homey.drivers.getDriver('vehicle').getDevices().map(device => {
      const data = device.getData();
      return {
        id: data.vin,
        vin: data.vin,
        registration: data.registration || null,
        name: device.getName(),
      };
    });
  }
};
