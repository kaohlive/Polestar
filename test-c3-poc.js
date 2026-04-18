'use strict';

/**
 * Fase 0 PoC runner — tests OIDC login + C3 endpoint discovery + GetLatestBattery
 * outside of Homey to validate the raw-HTTP2 gRPC stack.
 *
 *   POLESTAR_EMAIL=you@example.com POLESTAR_PASSWORD='...' node test-c3-poc.js
 *
 * Optional: POLESTAR_VIN=... to pick a specific vehicle; otherwise the last one
 * returned by the app-backend is used (newest on the account).
 * Optional: POLESTAR_DEBUG=1 to print gRPC headers/trailers.
 */

const { PolestarC3 } = require('./clone_modules/polestar-c3/client');

async function main() {
    const email = process.env.POLESTAR_EMAIL;
    const password = process.env.POLESTAR_PASSWORD;
    if (!email || !password) {
        console.error('Set POLESTAR_EMAIL and POLESTAR_PASSWORD env vars.');
        process.exit(2);
    }
    const forcedVin = process.env.POLESTAR_VIN || null;

    const client = new PolestarC3(email, password);

    console.log('[1/4] Logging in via OIDC/PKCE (client_id=lp8dyrd_10)…');
    await client.login();
    console.log('      OK — got access token (length', client._auth.accessToken.length, ').');
    console.log('      C3 endpoint:', client._endpoint);

    console.log('[2/4] Listing vehicles via app-backend GraphQL…');
    const vehicles = await client.listVehicles();
    if (!vehicles.length) {
        console.error('No vehicles found on account.');
        process.exit(1);
    }
    for (const v of vehicles) {
        console.log('      -', v.vin, v.registrationNo, v.content && v.content.model && v.content.model.name);
    }

    const vin = forcedVin || vehicles[vehicles.length - 1].vin;
    await client.setVehicle(vin);
    console.log('[3/4] Using VIN:', vin);

    const debug = process.env.POLESTAR_DEBUG === '1';
    const replacer = (_k, v) => (typeof v === 'bigint' ? v.toString() : v);

    const step = async (label, fn) => {
        console.log(label);
        try {
            const resp = await fn();
            console.log('      OK. Response:');
            console.log(JSON.stringify(resp, replacer, 2));
            return true;
        } catch (err) {
            console.error('      FAILED:', err.message);
            process.exitCode = 1;
            return false;
        }
    };

    try {
        await step('[4/10] BatteryService/GetLatestBattery (unary)…',
            () => client.getLatestBattery({ debug }));
        await step('[5/10] OdometerService/GetOdometer (server-stream, first frame)…',
            () => client.getLatestOdometer({ debug }));
        await step('[6/10] HealthService/GetHealth (server-stream, first frame)…',
            () => client.getLatestHealth({ debug }));
        await step('[7/10] ExteriorService/GetLatestExterior (unary)…',
            () => client.getLatestExterior({ debug }));
        await step('[8/10] ParkingClimatizationService/GetLatestParkingClimatization (unary)…',
            () => client.getLatestClimate({ debug }));
        await step('[9/10] TargetSocService/GetTargetSoc (chronos read)…',
            async () => ({ target_level_pct: await client.getTargetSoc({ debug }) }));
        await step('[10/10] AmpLimitService/GetAmpLimit (chronos read)…',
            async () => ({ amperage_limit: await client.getAmpLimit({ debug }) }));
    } finally {
        client.close();
    }
}

main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
});
