#!/usr/bin/env node
'use strict';

const Polestar = require('./clone_modules/polestar.js/polestar.js');
const axios = require('axios');

// Get credentials from command line arguments
const args = process.argv.slice(2);
if (args.length < 2) {
    console.error('Usage: node debug-getvehicles.js <email> <password>');
    process.exit(1);
}

const email = args[0];
const password = args[1];

async function debugGetVehicles() {
    console.log('\n=== Debugging getVehicles() API Call ===\n');

    try {
        // Initialize and login
        console.log('Logging in...');
        const polestar = new Polestar(email, password);
        await polestar.login();
        console.log('✓ Login successful!\n');

        // Extract token using the new public method
        console.log('Extracting access token...');
        const token = polestar.getAccessToken();

        if (!token) {
            console.error('❌ Could not extract access token');
            process.exit(1);
        }

        console.log('✓ Access token obtained\n');

        // Make raw API call to getConsumerCarsV2
        console.log('Making raw API call to getConsumerCarsV2...\n');

        const query = `query getCars {
  getConsumerCarsV2 {
    vin
    internalVehicleIdentifier
    modelYear
    content {
      model {
        code
        name
        __typename
      }
      images {
        studio {
          url
          angles
          __typename
        }
        __typename
      }
      __typename
    }
    hasPerformancePackage
    registrationNo
    deliveryDate
    currentPlannedDeliveryDate
    __typename
  }
}`;

        try {
            const response = await axios.post(
                'https://pc-api.polestar.com/eu-north-1/mystar-v2/',
                {
                    query: query,
                    operationName: 'getCars',
                    variables: {}
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

            console.log('Raw API Response:');
            console.log(JSON.stringify(response.data, null, 2));

            // Check for errors
            if (response.data.errors) {
                console.log('\n❌ GraphQL Errors Found:');
                response.data.errors.forEach((err, idx) => {
                    console.log(`\nError ${idx + 1}:`);
                    console.log(`  Message: ${err.message}`);
                    if (err.path) {
                        console.log(`  Path: ${err.path.join('.')}`);
                    }
                    if (err.locations) {
                        console.log(`  Location: line ${err.locations[0].line}, column ${err.locations[0].column}`);
                    }
                });
            }

            // Check for data
            if (response.data.data) {
                console.log('\n✅ Data Found:');
                if (response.data.data.getConsumerCarsV2) {
                    console.log(`  Found ${response.data.data.getConsumerCarsV2.length} vehicle(s)`);
                    console.log('\nVehicle Details:');
                    response.data.data.getConsumerCarsV2.forEach((vehicle, idx) => {
                        console.log(`\nVehicle ${idx + 1}:`);
                        console.log(`  VIN: ${vehicle.vin}`);
                        console.log(`  Model: ${vehicle.content?.model?.name || 'N/A'}`);
                        console.log(`  Registration: ${vehicle.registrationNo || 'N/A'}`);
                        console.log(`  Model Year: ${vehicle.modelYear || 'N/A'}`);
                    });
                } else {
                    console.log('  getConsumerCarsV2 field is null or missing');
                }
            } else {
                console.log('\n⚠️  No data field in response');
            }

        } catch (error) {
            console.error('\n❌ API Request Failed:');
            console.error('  Error:', error.message);
            if (error.response) {
                console.error('  Status:', error.response.status);
                console.error('  Response:', JSON.stringify(error.response.data, null, 2));
            }
        }

        // Now test with the library method
        console.log('\n\n=== Testing library getVehicles() method ===\n');
        try {
            const vehicles = await polestar.getVehicles();
            console.log('✓ getVehicles() succeeded!');
            console.log(`  Found ${vehicles.length} vehicle(s)`);
        } catch (error) {
            console.error('❌ getVehicles() failed:');
            console.error('  ', error.message);
        }

    } catch (error) {
        console.error('\n\x1b[31mUnexpected Error:\x1b[0m', error.message);
        if (error.stack) {
            console.error(error.stack);
        }
        process.exit(1);
    }
}

debugGetVehicles();
