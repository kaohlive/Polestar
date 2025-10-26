#!/usr/bin/env node
'use strict';

const Polestar = require('./clone_modules/polestar.js/polestar.js');
const axios = require('axios');

// Get credentials from command line arguments
const args = process.argv.slice(2);
if (args.length < 2) {
    console.error('Usage: node test-queries.js <email> <password>');
    process.exit(1);
}

const email = args[0];
const password = args[1];

async function testQueries() {
    console.log('\n=== Polestar API Field Discovery ===\n');

    let polestar;
    let token;
    let vin;

    try {
        // Initialize and login
        console.log('Logging in...');
        polestar = new Polestar(email, password);
        await polestar.login();
        console.log('✓ Login successful!\n');

        // Set a vehicle with better error handling
        console.log('Getting vehicles...');
        let vehicles;
        try {
            vehicles = await polestar.getVehicles();
            console.log(`✓ Found ${vehicles.length} vehicle(s)\n`);

            if (vehicles.length > 0) {
                console.log('Vehicle details:', JSON.stringify(vehicles[0], null, 2));
                await polestar.setVehicle(vehicles[0].vin);
                console.log(`✓ Set vehicle: ${vehicles[0].vin}\n`);
            } else {
                console.error('No vehicles found in account');
                process.exit(1);
            }
        } catch (error) {
            console.error('❌ Failed to get vehicles:', error.message);
            console.error('This might be due to API changes. Trying to extract token anyway...\n');
            // Continue anyway - we can still test if we can get the token
        }

        // Get the access token and VIN using public methods
        console.log('Extracting access token and VIN...');

        token = polestar.getAccessToken();
        vin = polestar.getVehicleVin() || (vehicles && vehicles.length > 0 ? vehicles[0].vin : null);

        if (!token) {
            console.error('❌ Could not extract access token');
            console.error('Make sure the Polestar library has been updated with getAccessToken() method');
            process.exit(1);
        }

        if (!vin) {
            console.error('❌ Could not extract VIN');
            console.error('Please make sure you have at least one vehicle in your account');
            process.exit(1);
        }

        console.log('✓ Access token obtained');
        console.log(`✓ Using VIN: ${vin}\n`);
        console.log('Starting field discovery tests...\n');

        // Test queries with different field combinations
        const testCases = [
            {
                name: 'Battery Data - Extended Fields',
                query: `query CarTelematicsV2($vins: [String!]!) {
                    carTelematicsV2(vins: $vins) {
                        battery {
                            vin
                            batteryChargeLevelPercentage
                            chargingStatus
                            chargingCurrentAmps
                            chargingPowerWatts
                            estimatedChargingTimeToFullMinutes
                            estimatedDistanceToEmptyKm
                            estimatedDistanceToEmptyMiles
                            averageEnergyConsumptionKwhPer100Km
                            chargerConnectionStatus
                            estimatedChargingTimeMinutesToTargetDistance
                            timestamp { seconds nanos }
                        }
                    }
                }`,
                variables: { vins: [vin] }
            },
            {
                name: 'Odometer - Extended Fields',
                query: `query CarTelematicsV2($vins: [String!]!) {
                    carTelematicsV2(vins: $vins) {
                        odometer {
                            vin
                            odometerMeters
                            averageSpeedKmPerHour
                            tripMeterAutomaticKm
                            tripMeterManualKm
                            timestamp { seconds nanos }
                        }
                    }
                }`,
                variables: { vins: [vin] }
            },
            {
                name: 'Health - Extended Fields',
                query: `query CarTelematicsV2($vins: [String!]!) {
                    carTelematicsV2(vins: $vins) {
                        health {
                            vin
                            brakeFluidLevelWarning
                            daysToService
                            distanceToServiceKm
                            engineCoolantLevelWarning
                            oilLevelWarning
                            serviceWarning
                            washerFluidLevelWarning
                            timestamp { seconds nanos }
                        }
                    }
                }`,
                variables: { vins: [vin] }
            },
            {
                name: 'Location Data',
                query: `query CarTelematicsV2($vins: [String!]!) {
                    carTelematicsV2(vins: $vins) {
                        location {
                            vin
                            latitude
                            longitude
                            heading
                            timestamp { seconds nanos }
                        }
                    }
                }`,
                variables: { vins: [vin] }
            },
            {
                name: 'Climate Data',
                query: `query CarTelematicsV2($vins: [String!]!) {
                    carTelematicsV2(vins: $vins) {
                        climate {
                            vin
                            climateStatus
                            targetTemperatureCelsius
                            interiorTemperatureCelsius
                            timestamp { seconds nanos }
                        }
                    }
                }`,
                variables: { vins: [vin] }
            },
            {
                name: 'Door Lock Status',
                query: `query CarTelematicsV2($vins: [String!]!) {
                    carTelematicsV2(vins: $vins) {
                        locks {
                            vin
                            lockStatus
                            engineHoodLockStatus
                            frontLeftDoorLockStatus
                            frontRightDoorLockStatus
                            rearLeftDoorLockStatus
                            rearRightDoorLockStatus
                            tailgateLockStatus
                            timestamp { seconds nanos }
                        }
                    }
                }`,
                variables: { vins: [vin] }
            },
            {
                name: 'Windows Status',
                query: `query CarTelematicsV2($vins: [String!]!) {
                    carTelematicsV2(vins: $vins) {
                        windows {
                            vin
                            frontLeftWindowOpen
                            frontRightWindowOpen
                            rearLeftWindowOpen
                            rearRightWindowOpen
                            sunroofOpen
                            timestamp { seconds nanos }
                        }
                    }
                }`,
                variables: { vins: [vin] }
            },
            {
                name: 'All Telematics Fields',
                query: `query CarTelematicsV2($vins: [String!]!) {
                    carTelematicsV2(vins: $vins) {
                        battery {
                            vin
                            batteryChargeLevelPercentage
                            chargingStatus
                            estimatedChargingTimeToFullMinutes
                            estimatedDistanceToEmptyKm
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
                        location {
                            vin
                            latitude
                            longitude
                            timestamp { seconds nanos }
                        }
                        climate {
                            vin
                            climateStatus
                            timestamp { seconds nanos }
                        }
                        locks {
                            vin
                            lockStatus
                            timestamp { seconds nanos }
                        }
                        windows {
                            vin
                            timestamp { seconds nanos }
                        }
                    }
                }`,
                variables: { vins: [vin] }
            }
        ];

        const results = {
            successful: [],
            failed: [],
            partiallySuccessful: []
        };

        for (const testCase of testCases) {
            console.log(`\n🔍 Testing: ${testCase.name}`);
            console.log('─'.repeat(60));

            try {
                const response = await axios.post(
                    'https://pc-api.polestar.com/eu-north-1/mystar-v2/',
                    {
                        query: testCase.query,
                        operationName: 'CarTelematicsV2',
                        variables: testCase.variables
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
                    console.log('❌ Query failed with errors:');
                    response.data.errors.forEach(err => {
                        console.log(`   - ${err.message}`);
                    });
                    results.failed.push({
                        name: testCase.name,
                        errors: response.data.errors
                    });
                } else if (response.data.data) {
                    console.log('✅ Query successful!');
                    console.log('Response:');
                    console.log(JSON.stringify(response.data.data, null, 2));
                    results.successful.push({
                        name: testCase.name,
                        data: response.data.data
                    });
                }
            } catch (error) {
                console.log('❌ Request failed:', error.message);
                results.failed.push({
                    name: testCase.name,
                    error: error.message
                });
            }
        }

        // Summary
        console.log('\n\n' + '='.repeat(60));
        console.log('📊 SUMMARY');
        console.log('='.repeat(60));
        console.log(`✅ Successful queries: ${results.successful.length}`);
        console.log(`❌ Failed queries: ${results.failed.length}`);

        if (results.successful.length > 0) {
            console.log('\n✅ Working fields found:');
            results.successful.forEach(result => {
                console.log(`   - ${result.name}`);
            });
        }

        if (results.failed.length > 0) {
            console.log('\n❌ Failed queries:');
            results.failed.forEach(result => {
                console.log(`   - ${result.name}`);
            });
        }

    } catch (error) {
        console.error('\n\x1b[31mError:\x1b[0m', error.message);
        if (error.stack) {
            console.error(error.stack);
        }
        process.exit(1);
    }
}

testQueries();
