#!/usr/bin/env node
'use strict';

const Polestar = require('./clone_modules/polestar.js/polestar.js');
const axios = require('axios');

// Get credentials from command line arguments
const args = process.argv.slice(2);
if (args.length < 2) {
    console.error('Usage: node test-alternative-queries.js <email> <password>');
    process.exit(1);
}

const email = args[0];
const password = args[1];

async function testAlternativeQueries() {
    console.log('\n=== Testing Alternative Polestar API Queries ===\n');
    console.log('Based on research from pypolestar/polestar_api and evcc-io/evcc projects\n');

    try {
        const polestar = new Polestar(email, password);
        await polestar.login();
        console.log('✓ Login successful!\n');

        const vehicles = await polestar.getVehicles();
        await polestar.setVehicle(vehicles[0].vin);

        const token = polestar.getAccessToken();
        const vin = polestar.getVehicleVin();

        console.log(`Testing with VIN: ${vin}\n`);

        const testQueries = [
            {
                name: 'getOdometerData (OLD API)',
                description: 'Old API query that might have more fields',
                query: `query GetOdometerData($vin: String!) {
                    getOdometerData(vin: $vin) {
                        averageSpeedKmPerHour
                        eventUpdatedTimestamp {
                            iso
                            unix
                        }
                        odometerMeters
                        tripMeterAutomaticKm
                        tripMeterManualKm
                    }
                }`,
                variables: { vin }
            },
            {
                name: 'getBatteryData (OLD API)',
                description: 'Old API query for battery with possibly more fields',
                query: `query GetBatteryData($vin: String!) {
                    getBatteryData(vin: $vin) {
                        averageEnergyConsumptionKwhPer100Km
                        batteryChargeLevelPercentage
                        chargerConnectionStatus
                        chargingCurrentAmps
                        chargingPowerWatts
                        chargingStatus
                        estimatedChargingTimeMinutesToTargetDistance
                        estimatedChargingTimeToFullMinutes
                        estimatedDistanceToEmptyKm
                        estimatedDistanceToEmptyMiles
                        eventUpdatedTimestamp {
                            iso
                            unix
                        }
                    }
                }`,
                variables: { vin }
            },
            {
                name: 'getChargingConnectionStatus (OLD API)',
                description: 'Specific query for charging connection',
                query: `query GetChargingConnectionStatus($vin: String!) {
                    getChargingConnectionStatus(vin: $vin) {
                        chargerConnectionStatus
                        chargingPowerWatts
                        chargingCurrentAmps
                        chargingStatus
                    }
                }`,
                variables: { vin }
            },
            {
                name: 'carTelematics (OLD API)',
                description: 'Original carTelematics query (non-V2)',
                query: `query CarTelematics($vin: String!) {
                    carTelematics(vin: $vin) {
                        battery {
                            averageEnergyConsumptionKwhPer100Km
                            batteryChargeLevelPercentage
                            chargerConnectionStatus
                            chargingCurrentAmps
                            chargingPowerWatts
                            chargingStatus
                            estimatedChargingTimeToFullMinutes
                            estimatedDistanceToEmptyKm
                        }
                        odometer {
                            averageSpeedKmPerHour
                            odometerMeters
                            tripMeterAutomaticKm
                            tripMeterManualKm
                        }
                    }
                }`,
                variables: { vin }
            },
            {
                name: 'getConsumerCarByVin',
                description: 'Get car details by VIN - might have location',
                query: `query GetConsumerCarByVin($vin: String!) {
                    getConsumerCarByVin(vin: $vin) {
                        vin
                        internalVehicleIdentifier
                        location {
                            latitude
                            longitude
                            heading
                        }
                        position {
                            latitude
                            longitude
                        }
                    }
                }`,
                variables: { vin }
            },
            {
                name: 'vehicleLocation',
                description: 'Direct location query',
                query: `query VehicleLocation($vin: String!) {
                    vehicleLocation(vin: $vin) {
                        latitude
                        longitude
                        heading
                        timestamp
                    }
                }`,
                variables: { vin }
            },
            {
                name: 'getCarLocation',
                description: 'Alternative location query',
                query: `query GetCarLocation($vin: String!) {
                    getCarLocation(vin: $vin) {
                        latitude
                        longitude
                        heading
                    }
                }`,
                variables: { vin }
            }
        ];

        const results = {
            successful: [],
            failed: []
        };

        for (const testQuery of testQueries) {
            console.log(`\n🔍 Testing: ${testQuery.name}`);
            console.log(`   ${testQuery.description}`);
            console.log('─'.repeat(60));

            try {
                const response = await axios.post(
                    'https://pc-api.polestar.com/eu-north-1/mystar-v2/',
                    {
                        query: testQuery.query,
                        operationName: testQuery.name.split(' ')[0],
                        variables: testQuery.variables
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
                    console.log('❌ Query failed');
                    const errorMessages = response.data.errors.map(e => e.message);
                    errorMessages.forEach(msg => {
                        if (msg.includes('FieldUndefined')) {
                            // Extract field name from error
                            const match = msg.match(/Field '(\w+)'/);
                            if (match) {
                                console.log(`   - Field not available: ${match[1]}`);
                            } else {
                                console.log(`   - ${msg}`);
                            }
                        } else {
                            console.log(`   - ${msg}`);
                        }
                    });
                    results.failed.push({
                        name: testQuery.name,
                        errors: errorMessages
                    });
                } else if (response.data.data) {
                    console.log('✅ SUCCESS! Data retrieved:');
                    console.log(JSON.stringify(response.data.data, null, 2));
                    results.successful.push({
                        name: testQuery.name,
                        data: response.data.data
                    });
                }
            } catch (error) {
                console.log(`❌ Request failed: ${error.message}`);
                results.failed.push({
                    name: testQuery.name,
                    error: error.message
                });
            }
        }

        // Summary
        console.log('\n\n' + '='.repeat(60));
        console.log('📊 RESEARCH SUMMARY');
        console.log('='.repeat(60));
        console.log(`✅ Successful queries: ${results.successful.length}`);
        console.log(`❌ Failed queries: ${results.failed.length}`);

        if (results.successful.length > 0) {
            console.log('\n🎉 WORKING ALTERNATIVE QUERIES FOUND:');
            results.successful.forEach(result => {
                console.log(`\n   ✅ ${result.name}`);
                console.log(`      Data: ${JSON.stringify(result.data, null, 2).substring(0, 200)}...`);
            });

            console.log('\n\n💡 RECOMMENDATION:');
            console.log('   Update polestar.js to use these working queries!');
        } else {
            console.log('\n😞 NO ALTERNATIVE QUERIES WORK');
            console.log('   The Polestar API appears to have removed these endpoints.');
            console.log('   Only carTelematicsV2 with limited fields is available.');
        }

        console.log('\n📝 FINDINGS:');
        console.log('   - Location data: ' + (results.successful.some(r => r.name.toLowerCase().includes('location')) ? '✅ AVAILABLE' : '❌ NOT AVAILABLE'));
        console.log('   - Charging Power/Amps: ' + (results.successful.some(r => JSON.stringify(r.data).includes('chargingPower') || JSON.stringify(r.data).includes('chargingCurrent')) ? '✅ AVAILABLE' : '❌ NOT AVAILABLE'));
        console.log('   - Trip Meters: ' + (results.successful.some(r => JSON.stringify(r.data).includes('tripMeter')) ? '✅ AVAILABLE' : '❌ NOT AVAILABLE'));
        console.log('   - Average Speed: ' + (results.successful.some(r => JSON.stringify(r.data).includes('averageSpeed')) ? '✅ AVAILABLE' : '❌ NOT AVAILABLE'));

    } catch (error) {
        console.error('\n\x1b[31mError:\x1b[0m', error.message);
        if (error.stack) {
            console.error(error.stack);
        }
        process.exit(1);
    }
}

testAlternativeQueries();
