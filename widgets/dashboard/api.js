'use strict';

async function getVehicle({ homey, registration }) {
  if (!homey) {
    throw new Error('Missing Homey');
  }

  if (!registration) {
    throw new Error('Missing Vehicle registration');
  }

  const driver = await homey.drivers.getDriver('vehicle');
  const vehicle = driver.getDevices().find(device => device.getData().registration === registration);
  if (!vehicle) {
    throw new Error('Vehicle Not Found');
  }

  return vehicle;
}

module.exports = {

  async getVehicleStatus({ homey, query }) {
    const { registration } = query;
    const vehicle = await getVehicle({ homey, registration });

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
    return await homey.drivers.getDriver('vehicle').getDevices();
  }
};
