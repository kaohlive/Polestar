# Homey Widget/Dashboard API Guide

This skill documents how to work with the built-in Homey API from dashboard widgets in this project.

## Overview

The Homey framework provides an internal message-based API system for communication between HTML widgets and the Homey app. This is NOT a traditional REST server - it's Homey's built-in widget API framework.

## Architecture

```
Widget HTML (index.html)
    │
    ├─► Homey.api('GET', '/endpoint')    [Request]
    │
    ▼
Widget API Handler (api.js)
    │
    ├─► Access device capabilities
    │
    ▼
Response returned to Widget
    │
    ▼
Widget renders the data
```

## File Structure

```
widgets/<widget-name>/
├── public/
│   └── index.html          # Widget HTML with JavaScript
├── api.js                  # Backend API handler functions
└── widget.compose.json     # Widget configuration & API definition
```

## 1. Defining API Endpoints

API endpoints are defined in `widget.compose.json`:

```json
{
  "name": { "en": "Widget Name" },
  "height": 188,
  "transparent": true,
  "settings": [
    {
      "id": "device",
      "type": "autocomplete",
      "title": { "en": "Vehicle" }
    }
  ],
  "api": {
    "getVehicles": {
      "method": "GET",
      "path": "/"
    },
    "getVehicleStatus": {
      "method": "GET",
      "path": "/status"
    }
  }
}
```

The `api` object maps function names to HTTP-like endpoints:
- Keys (e.g., `getVehicleStatus`) must match exported function names in `api.js`
- `method`: HTTP method (`GET`, `POST`, etc.)
- `path`: Endpoint path (relative to widget)

## 2. Implementing API Handlers

Create `api.js` to implement the endpoint handlers:

```javascript
'use strict';

module.exports = {
  // Handler for GET /status
  async getVehicleStatus({ homey, query }) {
    const { registration } = query;  // Access query parameters

    // Get driver and find device
    const driver = await homey.drivers.getDriver('vehicle');
    const vehicle = driver.getDevices().find(
      device => device.getData().registration === registration
    );

    if (!vehicle) {
      throw new Error('Vehicle Not Found');
    }

    // Return capability values
    return {
      battery: vehicle.getCapabilityValue('measure_polestarBattery'),
      connected: vehicle.getCapabilityValue('measure_vehicleConnected'),
      charging: vehicle.getCapabilityValue('measure_vehicleChargeState'),
      current: vehicle.getCapabilityValue('measure_current'),
      power: vehicle.getCapabilityValue('measure_power'),
      time_remaining: vehicle.getCapabilityValue('measure_vehicleChargeTimeRemaining'),
      odometer: vehicle.getCapabilityValue('measure_vehicleOdometer'),
      range: vehicle.getCapabilityValue('measure_vehicleRange'),
      service: vehicle.getCapabilityValue('alarm_generic'),
    };
  },

  // Handler for GET /
  async getVehicles({ homey, body }) {
    const driver = await homey.drivers.getDriver('vehicle');
    return driver.getDevices();
  }
};
```

### Handler Function Parameters

| Parameter | Description |
|-----------|-------------|
| `homey`   | The Homey instance for accessing drivers, settings, etc. |
| `query`   | Query string parameters (for GET requests) |
| `body`    | Request body (for POST requests) |

## 3. Calling the API from Widget HTML

### Basic API Call

```javascript
Homey.api('GET', '/status?registration=ABC123')
  .then(response => {
    console.log(response);
  })
  .catch(err => {
    console.error(err);
  });
```

### Full Widget Example

```html
<script type="text/javascript">
  let status;

  // Called when Homey is ready
  function onHomeyReady(Homey) {
    Homey.ready();  // Signal widget is ready
    syncStatus();   // Initial data fetch

    // Listen for real-time updates
    Homey.on('updatevehicle', () => {
      syncStatus();
    });
  }

  function syncStatus() {
    // Get selected device from widget settings
    const { device } = Homey.getSettings();
    if (!device) {
      showError('Please select a device');
      return;
    }

    // Call the API
    Homey.api('GET', `/status?registration=${device.registration}`)
      .then(response => {
        status = response;
        renderStatus();
      })
      .catch(err => {
        showError(err.message);
      });
  }

  function renderStatus() {
    document.getElementById('battery').innerText = status.battery + '%';
    document.getElementById('range').innerText = status.range + ' km';
  }
</script>
```

## 4. Homey API Methods Reference

### `Homey.api(method, path, [body])`
Make an API call to the widget backend.

```javascript
// GET request with query params
Homey.api('GET', '/status?id=123')

// POST request with body
Homey.api('POST', '/action', { command: 'start' })
```

### `Homey.ready()`
Signal that the widget is ready to receive data. **Must be called** in `onHomeyReady`.

```javascript
function onHomeyReady(Homey) {
  Homey.ready();
}
```

### `Homey.getSettings()`
Get widget settings configured by the user.

```javascript
const { device } = Homey.getSettings();
```

### `Homey.on(event, callback)`
Listen for real-time events from the app.

```javascript
Homey.on('updatevehicle', () => {
  syncStatus();
});
```

### `Homey.emit(event, data)` (for pair/repair pages)
Emit events to the driver. Used in pairing flows.

```javascript
Homey.emit('testlogin', { username, password })
  .then(result => {
    // Handle success
  });
```

## 5. Real-Time Updates

### Broadcasting from Device/App

From `device.js` or `app.js`, broadcast updates to widgets:

```javascript
// In device.js
this.homey.api.realtime('updatevehicle');

// In app.js
this.homey.api.realtime('debugLog', { message: 'Something happened' });
```

### Listening in Widget

```javascript
Homey.on('updatevehicle', () => {
  // Refresh widget data
  syncStatus();
});
```

## 6. Widget Settings Autocomplete

Register autocomplete handlers in `app.js`:

```javascript
class MyApp extends Homey.App {
  async onInit() {
    this.homey.dashboards
      .getWidget('dashboard')
      .registerSettingAutocompleteListener('device', async (query, settings) => {
        const driver = await this.homey.drivers.getDriver('vehicle');
        const devices = await driver.getDevices();

        return devices
          .map(device => ({
            name: device.getName(),
            registration: device.getData().registration,
          }))
          .filter(v => v.name.toLowerCase().includes(query.toLowerCase()));
      });
  }
}
```

## 7. Available Device Capabilities

Access these via `vehicle.getCapabilityValue()`:

| Capability | Type | Description |
|-----------|------|-------------|
| `measure_polestarBattery` | number (0-100) | Battery percentage |
| `measure_vehicleConnected` | boolean | Charger connected |
| `measure_vehicleChargeState` | boolean | Currently charging |
| `measure_current` | number | Charging current (A) |
| `measure_power` | number | Charging power (W) |
| `measure_vehicleChargeTimeRemaining` | number | Minutes to full |
| `measure_vehicleOdometer` | number | Odometer (km) |
| `measure_vehicleRange` | number | Estimated range (km) |
| `alarm_generic` | boolean | Service warning |

## 8. Error Handling

Always handle errors in API calls:

```javascript
Homey.api('GET', '/status?registration=ABC')
  .then(status => {
    renderStatus(status);
  })
  .catch(err => {
    // Show user-friendly error
    document.getElementById('error').innerText = err.message;
  });
```

In API handlers, throw errors to return them to the widget:

```javascript
async getVehicleStatus({ homey, query }) {
  if (!query.registration) {
    throw new Error('Missing registration parameter');
  }
  // ...
}
```

## 9. Complete Example: Adding a New Endpoint

### Step 1: Define in widget.compose.json

```json
{
  "api": {
    "setChargeLimit": {
      "method": "POST",
      "path": "/charge-limit"
    }
  }
}
```

### Step 2: Implement in api.js

```javascript
module.exports = {
  async setChargeLimit({ homey, body }) {
    const { registration, limit } = body;
    const vehicle = await getVehicle({ homey, registration });

    // Perform action
    await vehicle.setCapabilityValue('target_charge_level', limit);

    return { success: true, newLimit: limit };
  }
};
```

### Step 3: Call from widget HTML

```javascript
Homey.api('POST', '/charge-limit', {
  registration: device.registration,
  limit: 80
})
  .then(result => {
    console.log('Charge limit set to', result.newLimit);
  });
```

## Key Files in This Project

- [widgets/dashboard/widget.compose.json](widgets/dashboard/widget.compose.json) - Widget configuration
- [widgets/dashboard/api.js](widgets/dashboard/api.js) - API handlers
- [widgets/dashboard/public/index.html](widgets/dashboard/public/index.html) - Widget HTML
- [app.js](app.js) - App initialization & autocomplete registration
- [drivers/vehicle/device.js](drivers/vehicle/device.js) - Device capabilities & realtime broadcasts
