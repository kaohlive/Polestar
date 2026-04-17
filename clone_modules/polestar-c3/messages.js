'use strict';

const TimestampSchema = {
    seconds: { num: 1, type: 'int64' },
    nanos: { num: 2, type: 'int32' },
};

const VehicleRequestSchema = {
    id: { num: 1, type: 'string' },
    vin: { num: 2, type: 'string' },
};

const BatterySchema = {
    timestamp: { num: 1, type: 'message', schema: TimestampSchema },
    charge_level: { num: 2, type: 'double' },
    avg_consumption: { num: 3, type: 'double' },
    range_km: { num: 4, type: 'double' },
    time_to_full: { num: 5, type: 'int64' },
    charger_connection_status: { num: 6, type: 'enum' },
    charging_status: { num: 7, type: 'enum' },
    range_miles: { num: 8, type: 'double' },
    time_to_target: { num: 9, type: 'int64' },
    power_watts: { num: 10, type: 'int64' },
    current_amps: { num: 11, type: 'int64' },
    avg_consumption_auto: { num: 12, type: 'double' },
    avg_consumption_since_charge: { num: 13, type: 'double' },
    total_consumption_wh: { num: 14, type: 'double' },
    total_consumption_wh_auto: { num: 15, type: 'double' },
    total_consumption_wh_since_charge: { num: 16, type: 'double' },
    charging_type: { num: 17, type: 'enum' },
    voltage_volts: { num: 18, type: 'int64' },
    time_to_min_soc: { num: 19, type: 'int64' },
    consumption_wh_manual: { num: 20, type: 'double' },
    consumption_wh_auto: { num: 21, type: 'double' },
    consumption_wh_since_charge: { num: 22, type: 'double' },
    consumption_pct_manual: { num: 23, type: 'double' },
    consumption_pct_auto: { num: 24, type: 'double' },
    consumption_pct_since_charge: { num: 25, type: 'double' },
    charger_power_status: { num: 26, type: 'enum' },
};

const GetBatteryResponseSchema = {
    id: { num: 1, type: 'string' },
    vin: { num: 2, type: 'string' },
    battery: { num: 3, type: 'message', schema: BatterySchema },
};

const ChargingStatus = {
    0: 'UNSPECIFIED',
    1: 'CHARGING',
    2: 'IDLE',
    3: 'SCHEDULED',
    4: 'DISCHARGING',
    5: 'ERROR',
    6: 'SMART_CHARGING',
    7: 'DONE',
    8: 'SMART_CHARGING_PAUSED',
};

const ChargerConnectionStatus = {
    0: 'UNSPECIFIED',
    1: 'CONNECTED',
    2: 'DISCONNECTED',
    3: 'FAULT',
};

const ChargingType = {
    0: 'UNSPECIFIED',
    1: 'NONE',
    2: 'AC',
    3: 'DC',
    4: 'WIRELESS',
};

const OdometerStatusSchema = {
    timestamp: { num: 1, type: 'message', schema: TimestampSchema },
    odometer_meters: { num: 2, type: 'int64' },
    trip_meter_manual_km: { num: 3, type: 'double' },
    trip_meter_automatic_km: { num: 4, type: 'double' },
};

const GetOdometerResponseSchema = {
    id: { num: 1, type: 'string' },
    vin: { num: 2, type: 'string' },
    odometer: { num: 3, type: 'message', schema: OdometerStatusSchema },
};

// Subset of Health — we skip light-failure/turn-signal fields for now (40+ fields).
// The decoder silently ignores fields not listed, so adding more later is safe.
const HealthSchema = {
    timestamp: { num: 1, type: 'message', schema: TimestampSchema },
    days_to_service: { num: 3, type: 'int64' },
    distance_to_service_km: { num: 4, type: 'int64' },
    service_warning: { num: 5, type: 'enum' },
    brake_fluid_level_warning: { num: 6, type: 'enum' },
    engine_coolant_level_warning: { num: 7, type: 'enum' },
    oil_level_warning: { num: 8, type: 'enum' },
    front_left_tyre_pressure_warning: { num: 9, type: 'enum' },
    front_right_tyre_pressure_warning: { num: 10, type: 'enum' },
    rear_left_tyre_pressure_warning: { num: 11, type: 'enum' },
    rear_right_tyre_pressure_warning: { num: 12, type: 'enum' },
    washer_fluid_level_warning: { num: 13, type: 'enum' },
    low_voltage_battery_warning: { num: 38, type: 'enum' },
    front_left_tyre_pressure_kpa: { num: 39, type: 'double' },
    front_right_tyre_pressure_kpa: { num: 40, type: 'double' },
    rear_left_tyre_pressure_kpa: { num: 41, type: 'double' },
    rear_right_tyre_pressure_kpa: { num: 42, type: 'double' },
};

const GetHealthResponseSchema = {
    id: { num: 1, type: 'string' },
    vin: { num: 2, type: 'string' },
    health: { num: 3, type: 'message', schema: HealthSchema },
};

const ServiceWarning = {
    0: 'UNSPECIFIED',
    1: 'NO_WARNING',
    2: 'UNKNOWN_WARNING',
    3: 'REGULAR_MAINTENANCE_ALMOST_TIME',
    4: 'ENGINE_HOURS_ALMOST_TIME',
    5: 'DISTANCE_DRIVEN_ALMOST_TIME',
    6: 'REGULAR_MAINTENANCE_TIME',
    7: 'ENGINE_HOURS_TIME',
    8: 'DISTANCE_DRIVEN_TIME',
};

const TyrePressureWarning = {
    0: 'UNSPECIFIED',
    1: 'NO_WARNING',
    2: 'VERY_LOW_PRESSURE',
    3: 'LOW_PRESSURE',
    4: 'HIGH_PRESSURE',
};

module.exports = {
    TimestampSchema,
    VehicleRequestSchema,
    BatterySchema,
    GetBatteryResponseSchema,
    OdometerStatusSchema,
    GetOdometerResponseSchema,
    HealthSchema,
    GetHealthResponseSchema,
    ChargingStatus,
    ChargerConnectionStatus,
    ChargingType,
    ServiceWarning,
    TyrePressureWarning,
};
