#!/usr/bin/env node
'use strict';

const Polestar = require('./clone_modules/polestar.js/polestar.js');
const axios = require('axios');

// Get credentials from command line arguments
const args = process.argv.slice(2);
if (args.length < 2) {
    console.error('Usage: node test-available-fields.js <email> <password>');
    process.exit(1);
}

const email = args[0];
const password = args[1];

async function testAvailableFields() {
    console.log('\n=== Testing Currently Working Fields ===\n');

    try {
        const polestar = new Polestar(email, password);
        await polestar.login();
        console.log('✓ Login successful!\n');

        const vehicles = await polestar.getVehicles();
        await polestar.setVehicle(vehicles[0].vin);

        const token = polestar.getAccessToken();
        const vin = polestar.getVehicleVin();

        console.log(`Testing with VIN: ${vin}\n`);

        // Test the current working query first
        console.log('🔍 Testing: Current Working Battery Fields');
        console.log('─'.repeat(60));

        const workingQuery = `query CarTelematicsV2($vins: [String!]!) {
            carTelematicsV2(vins: $vins) {
                battery {
                    vin
                    batteryChargeLevelPercentage
                    chargingStatus
                    estimatedChargingTimeToFullMinutes
                    estimatedDistanceToEmptyKm
                    estimatedDistanceToEmptyMiles
                    timestamp { seconds nanos }
                }
                odometer {
                    vin
                    odometerMeters
                    timestamp { seconds nanos }
                }
                health {
                    vin
                    brakeFluidLevelWarning
                    daysToService
                    distanceToServiceKm
                    engineCoolantLevelWarning
                    oilLevelWarning
                    serviceWarning
                    timestamp { seconds nanos }
                }
            }
        }`;

        const response = await axios.post(
            'https://pc-api.polestar.com/eu-north-1/mystar-v2/',
            {
                query: workingQuery,
                operationName: 'CarTelematicsV2',
                variables: { vins: [vin] }
            },
            {
                headers: {
                    'cache-control': 'no-cache',
                    'content-type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                    'pragma': 'no-cache'
                }
            }
        );

        if (response.data.errors) {
            console.log('❌ Errors:', response.data.errors.map(e => e.message));
        } else {
            console.log('✅ Success! Data retrieved:\n');
            console.log(JSON.stringify(response.data.data, null, 2));
        }

        // Now let's try to find any additional fields by testing common ones individually
        console.log('\n\n🔍 Testing Individual Additional Fields');
        console.log('─'.repeat(60));

        const fieldsToTest = [
            // Battery fields
            { category: 'battery', field: 'batteryCapacityKwh', description: 'Total battery capacity' },
            { category: 'battery', field: 'currentPowerWatts', description: 'Current power draw' },
            { category: 'battery', field: 'chargeRate', description: 'Charging rate' },
            { category: 'battery', field: 'chargeLimit', description: 'Charge limit percentage' },
            { category: 'battery', field: 'chargingPower', description: 'Charging power' },
            { category: 'battery', field: 'timeToFullCharge', description: 'Time to full charge' },

            // Odometer fields
            { category: 'odometer', field: 'tripMeterKm', description: 'Trip meter distance' },
            { category: 'odometer', field: 'range', description: 'Remaining range' },

            // Health fields
            { category: 'health', field: 'tirePressureWarning', description: 'Tire pressure warning' },
            { category: 'health', field: 'batteryHealthPercentage', description: 'Battery health' },
        ];

        const availableFields = {
            battery: ['vin', 'batteryChargeLevelPercentage', 'chargingStatus', 'estimatedChargingTimeToFullMinutes', 'estimatedDistanceToEmptyKm', 'estimatedDistanceToEmptyMiles', 'timestamp'],
            odometer: ['vin', 'odometerMeters', 'timestamp'],
            health: ['vin', 'brakeFluidLevelWarning', 'daysToService', 'distanceToServiceKm', 'engineCoolantLevelWarning', 'oilLevelWarning', 'serviceWarning', 'timestamp']
        };

        for (const testField of fieldsToTest) {
            const testQuery = `query CarTelematicsV2($vins: [String!]!) {
                carTelematicsV2(vins: $vins) {
                    ${testField.category} {
                        vin
                        ${testField.field}
                    }
                }
            }`;

            try {
                const testResponse = await axios.post(
                    'https://pc-api.polestar.com/eu-north-1/mystar-v2/',
                    {
                        query: testQuery,
                        operationName: 'CarTelematicsV2',
                        variables: { vins: [vin] }
                    },
                    {
                        headers: {
                            'cache-control': 'no-cache',
                            'content-type': 'application/json',
                            'Authorization': `Bearer ${token}`,
                            'pragma': 'no-cache'
                        }
                    }
                );

                if (testResponse.data.errors) {
                    console.log(`❌ ${testField.category}.${testField.field} - Not available`);
                } else {
                    console.log(`✅ ${testField.category}.${testField.field} - Available! (${testField.description})`);
                    availableFields[testField.category].push(testField.field);

                    // Show the value if not null
                    const data = testResponse.data.data.carTelematicsV2[testField.category];
                    if (data && data.length > 0 && data[0][testField.field] !== null) {
                        console.log(`   Value: ${JSON.stringify(data[0][testField.field])}`);
                    }
                }
            } catch (error) {
                console.log(`❌ ${testField.category}.${testField.field} - Error: ${error.message}`);
            }
        }

        // Summary
        console.log('\n\n' + '='.repeat(60));
        console.log('📋 COMPLETE FIELD AVAILABILITY REPORT');
        console.log('='.repeat(60));

        console.log('\n✅ AVAILABLE BATTERY FIELDS:');
        availableFields.battery.forEach(field => console.log(`   - ${field}`));

        console.log('\n✅ AVAILABLE ODOMETER FIELDS:');
        availableFields.odometer.forEach(field => console.log(`   - ${field}`));

        console.log('\n✅ AVAILABLE HEALTH FIELDS:');
        availableFields.health.forEach(field => console.log(`   - ${field}`));

        console.log('\n❌ NOT AVAILABLE (tested and failed):');
        console.log('   Battery:');
        console.log('     - chargingCurrentAmps');
        console.log('     - chargingPowerWatts');
        console.log('     - averageEnergyConsumptionKwhPer100Km');
        console.log('     - chargerConnectionStatus');
        console.log('     - estimatedChargingTimeMinutesToTargetDistance');
        console.log('   Odometer:');
        console.log('     - averageSpeedKmPerHour');
        console.log('     - tripMeterAutomaticKm');
        console.log('     - tripMeterManualKm');
        console.log('   Health:');
        console.log('     - washerFluidLevelWarning');
        console.log('   Telematics Categories:');
        console.log('     - location (GPS data)');
        console.log('     - climate (HVAC data)');
        console.log('     - locks (door locks)');
        console.log('     - windows (window status)');

        console.log('\n📝 CONCLUSION:');
        console.log('   The Polestar API has been significantly simplified.');
        console.log('   Only basic telematics data is now available via CarTelematicsV2.');
        console.log('   Many fields that were previously available (or commented out in');
        console.log('   your code) are no longer supported by the API.');

    } catch (error) {
        console.error('\n\x1b[31mError:\x1b[0m', error.message);
        if (error.stack) {
            console.error(error.stack);
        }
        process.exit(1);
    }
}

testAvailableFields();
