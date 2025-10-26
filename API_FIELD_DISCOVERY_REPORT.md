# Polestar API Field Discovery Report

**Date:** January 2025
**API Endpoint:** `https://pc-api.polestar.com/eu-north-1/mystar-v2/`
**Test Vehicle:** Polestar 4 (2026 Model Year)

## Executive Summary

The Polestar GraphQL API has been significantly simplified and locked down. Many fields that were previously available (or referenced in older implementations) have been removed. GraphQL introspection is disabled, preventing automatic schema discovery.

## ✅ Currently Available Fields

### Vehicle Information (`getConsumerCarsV2`)
```graphql
query getCars {
  getConsumerCarsV2 {
    vin
    internalVehicleIdentifier
    modelYear
    content {
      model {
        code
        name
      }
    }
    hasPerformancePackage
    registrationNo
    deliveryDate
    currentPlannedDeliveryDate
  }
}
```

**Note:** The `images` field has been removed from the API (previously contained `studio.url` and `studio.angles`).

### Telematics Data (`carTelematicsV2`)

#### Battery Information
```graphql
battery {
  vin
  batteryChargeLevelPercentage
  chargingStatus
  estimatedChargingTimeToFullMinutes
  estimatedDistanceToEmptyKm
  estimatedDistanceToEmptyMiles
  timestamp {
    seconds
    nanos
  }
}
```

**Available Charging Statuses:**
- `CHARGING_STATUS_IDLE`
- `CHARGING_STATUS_CHARGING`
- `CHARGING_STATUS_DONE`
- `CHARGING_STATUS_SCHEDULED`
- `CHARGING_STATUS_SMART_CHARGING`
- `CHARGING_STATUS_ERROR`
- `CHARGING_STATUS_FAULT`

#### Odometer Information
```graphql
odometer {
  vin
  odometerMeters
  timestamp {
    seconds
    nanos
  }
}
```

#### Health Information
```graphql
health {
  vin
  brakeFluidLevelWarning
  daysToService
  distanceToServiceKm
  engineCoolantLevelWarning
  oilLevelWarning
  serviceWarning
  timestamp {
    seconds
    nanos
  }
}
```

## ❌ Unavailable Fields (Tested & Confirmed)

### Battery Fields (No Longer Available)
- `chargingCurrentAmps` - Charging current in amperes
- `chargingPowerWatts` - Charging power in watts
- `averageEnergyConsumptionKwhPer100Km` - Energy consumption average
- `chargerConnectionStatus` - Whether charger is physically connected
- `estimatedChargingTimeMinutesToTargetDistance` - Time to target range

### Odometer Fields (No Longer Available)
- `averageSpeedKmPerHour` - Average vehicle speed
- `tripMeterAutomaticKm` - Automatic trip meter
- `tripMeterManualKm` - Manual trip meter

### Health Fields (No Longer Available)
- `washerFluidLevelWarning` - Washer fluid level warning

### Telematics Categories (Not Available)
- **Location Data** - No GPS coordinates, latitude, longitude, or heading
  - Tested: `location`, `vehicleLocation`, `getCarLocation`, `getConsumerCarByVin` with location fields
- **Climate Data** - No HVAC or temperature information
  - Tested: `climate` with `climateStatus`, `targetTemperature`, `interiorTemperature`
- **Lock Status** - No door lock information
  - Tested: `locks` with various door lock fields
- **Window Status** - No window open/close status
  - Tested: `windows` with window status fields

### Old API Queries (Deprecated)
These queries worked in older implementations but no longer function:
- `getBatteryData` - Old battery data query
- `getOdometerData` - Old odometer query with trip meters
- `carTelematics` (non-V2) - Original telematics query
- `getChargingConnectionStatus` - Charging connection details

## 📊 API Changes Timeline

Based on research of other projects:

- **Pre-January 2024:** Old API (`/my-star`) with extensive fields including:
  - Charging power and current
  - Trip meters
  - Average speed
  - Energy consumption

- **January 2024:** API migration to `/mystar-v2`
  - Many fields removed
  - `getBatteryData` and `getOdometerData` deprecated
  - Switch to `carTelematicsV2` with limited fields

- **Current (January 2025):** Further restrictions
  - Images removed from vehicle data
  - No location data available via API
  - No charging power/amperage data
  - Introspection disabled

## 🔍 Research Sources

Investigation included:
1. **pypolestar/polestar_api** - Python Home Assistant integration
2. **evcc-io/evcc** - EV charging control system
3. **Direct API testing** - 15+ different query combinations tested
4. **GraphQL introspection** - Attempted but disabled by Polestar

## 💡 Workarounds for Missing Data

### Location Data
**Problem:** No GPS coordinates available via API
**Workaround:** Install Home Assistant app in Android Automotive (vehicle's built-in system) and use device_tracker entity. This requires:
- Home Assistant installation
- Nabu Casa account (optional but recommended)
- Permission to share location from vehicle

### Charging Power/Current
**Problem:** No charging watts or amps available
**Workaround:** None found. This data was previously available but has been removed from the API.

### Trip Meters & Average Speed
**Problem:** Not available in current API
**Workaround:** Calculate manually using odometer readings over time (less accurate).

## 🎯 Recommendations

### For Your Homey App

1. **Remove commented-out code** in `device.js` lines 136-149:
   - `chargingCurrentAmps` will never return data
   - `chargingPowerWatts` will never return data
   - `chargerConnectionStatus` is not available

2. **Current implementation is optimal** - You're already using all available fields:
   ```javascript
   // Battery
   batteryChargeLevelPercentage
   chargingStatus
   estimatedChargingTimeToFullMinutes
   estimatedDistanceToEmptyKm

   // Odometer
   odometerMeters

   // Health
   brakeFluidLevelWarning
   daysToService
   distanceToServiceKm
   engineCoolantLevelWarning
   oilLevelWarning
   serviceWarning
   ```

3. **Connection detection workaround** - Your current logic (lines 155-171) correctly uses `chargingStatus` to infer connection:
   ```javascript
   const connectedStatuses = new Set([
       'CHARGING_STATUS_CHARGING',
       'CHARGING_STATUS_DONE',
       'CHARGING_STATUS_SCHEDULED',
       'CHARGING_STATUS_SMART_CHARGING',
       'CHARGING_STATUS_ERROR',
       'CHARGING_STATUS_FAULT'
   ]);
   ```
   This is the best available approach since `chargerConnectionStatus` is gone.

### For Future Development

1. **Monitor for API changes** - Polestar has been changing the API periodically
2. **No additional fields can be added** - The API currently provides minimal data
3. **Location tracking requires alternative solution** - Consider Home Assistant integration if needed
4. **Energy monitoring limitations** - Without power/current data, detailed energy monitoring is not possible

## 📝 Conclusion

The Polestar API has evolved from a feature-rich interface to a minimal read-only API providing only basic telematics:
- ✅ Battery level and charging status
- ✅ Range estimates
- ✅ Odometer reading
- ✅ Basic service warnings
- ❌ No location data
- ❌ No charging power/current
- ❌ No trip meters or speed data
- ❌ No climate, lock, or window status

**Your current implementation is using all available API fields.** The commented-out code in your device.js file represents features that were likely planned but are no longer possible due to API restrictions.

## 🔗 References

- GitHub: pypolestar/polestar_api (Python implementation)
- GitHub: evcc-io/evcc (Go implementation for EV charging)
- Polestar Forum discussions on API access
- Direct GraphQL API testing results (January 2025)

---

*Report generated through systematic API field discovery and community research.*
