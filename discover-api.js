#!/usr/bin/env node
'use strict';

const Polestar = require('./clone_modules/polestar.js/polestar.js');
const fs = require('fs');

// Get credentials from command line arguments
const args = process.argv.slice(2);
if (args.length < 2) {
    console.error('Usage: node discover-api.js <email> <password> [output-file.json]');
    process.exit(1);
}

const email = args[0];
const password = args[1];
const outputFile = args[2] || null;

async function discoverAPI() {
    console.log('\n=== Polestar API Discovery Tool ===\n');

    try {
        // Initialize and login
        console.log('Logging in...');
        const polestar = new Polestar(email, password);
        await polestar.login();
        console.log('✓ Login successful!\n');

        // Get full schema
        console.log('Retrieving GraphQL schema...');
        const schema = await polestar.getGraphQLSchema();
        console.log('✓ Schema retrieved!\n');

        // Debug: Check what we got
        console.log('Debug - Schema structure:', JSON.stringify(schema, null, 2).substring(0, 500));
        console.log('\nDebug - Has data?', !!schema.data);
        console.log('Debug - Has __schema?', schema.data && !!schema.data.__schema);

        if (!schema.data || !schema.data.__schema) {
            console.log('\nFull schema response:');
            console.log(JSON.stringify(schema, null, 2));
            throw new Error('Schema introspection is not supported or disabled on this API');
        }

        // Get available queries
        console.log('\n=== AVAILABLE QUERIES ===\n');
        const queries = await polestar.getAvailableQueries();

        queries.forEach(query => {
            console.log(`\x1b[33m${query.name}\x1b[0m: ${query.returnType}`);
            if (query.description) {
                console.log(`  Description: ${query.description}`);
            }
            if (query.args && query.args.length > 0) {
                console.log(`  Arguments:`);
                query.args.forEach(arg => {
                    console.log(`    - ${arg.name}: ${arg.type}`);
                    if (arg.description) {
                        console.log(`      ${arg.description}`);
                    }
                });
            }
            console.log('');
        });

        // Get available mutations
        console.log('\n=== AVAILABLE MUTATIONS ===\n');
        const mutations = await polestar.getAvailableMutations();

        if (mutations && mutations.length > 0) {
            mutations.forEach(mutation => {
                console.log(`\x1b[33m${mutation.name}\x1b[0m: ${mutation.returnType}`);
                if (mutation.description) {
                    console.log(`  Description: ${mutation.description}`);
                }
                if (mutation.args && mutation.args.length > 0) {
                    console.log(`  Arguments:`);
                    mutation.args.forEach(arg => {
                        console.log(`    - ${arg.name}: ${arg.type}`);
                        if (arg.description) {
                            console.log(`      ${arg.description}`);
                        }
                    });
                }
                console.log('');
            });
        } else {
            console.log('No mutations available\n');
        }

        // Get details for specific types of interest
        console.log('\n=== DETAILED TYPE INFORMATION ===\n');

        // Get all custom types (exclude built-in GraphQL types)
        const customTypes = schema.data.__schema.types.filter(type =>
            !type.name.startsWith('__') &&
            !['String', 'Int', 'Float', 'Boolean', 'ID'].includes(type.name) &&
            type.kind === 'OBJECT'
        );

        console.log(`\nFound ${customTypes.length} custom types. Showing types with "Car", "Battery", "Telematic", or "Health" in the name:\n`);

        const relevantTypes = customTypes.filter(type =>
            type.name.toLowerCase().includes('car') ||
            type.name.toLowerCase().includes('battery') ||
            type.name.toLowerCase().includes('telematic') ||
            type.name.toLowerCase().includes('health') ||
            type.name.toLowerCase().includes('odometer')
        );

        for (const type of relevantTypes) {
            const details = await polestar.getTypeDetails(type.name);
            console.log(`\x1b[36m${details.name}\x1b[0m (${details.kind})`);
            if (details.description) {
                console.log(`  ${details.description}`);
            }
            if (details.fields && details.fields.length > 0) {
                console.log('  Fields:');
                details.fields.forEach(field => {
                    console.log(`    - ${field.name}: ${field.type}`);
                    if (field.description) {
                        console.log(`      ${field.description}`);
                    }
                });
            }
            console.log('');
        }

        // Save to file if requested
        if (outputFile) {
            console.log(`\n\nSaving full schema to ${outputFile}...`);
            fs.writeFileSync(outputFile, JSON.stringify(schema, null, 2), 'utf8');
            console.log('✓ Schema saved successfully!\n');
        }

        // Summary
        console.log('\n=== SUMMARY ===');
        console.log(`Total Queries: ${queries.length}`);
        console.log(`Total Mutations: ${mutations.length}`);
        console.log(`Total Types: ${schema.data.__schema.types.length}`);
        console.log(`Custom Types: ${customTypes.length}`);
        console.log(`Relevant Vehicle Types: ${relevantTypes.length}\n`);

    } catch (error) {
        console.error('\n\x1b[31mError:\x1b[0m', error.message);
        if (error.stack) {
            console.error(error.stack);
        }
        process.exit(1);
    }
}

discoverAPI();
