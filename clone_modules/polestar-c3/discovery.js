'use strict';

const axios = require('axios');
const { randomUUID } = require('crypto');

const C3_DISCOVERY_URL = 'https://cnepmob.volvocars.com/';
const C3_ACCEPT_HEADER = 'application/volvo.cloud.cnepmob.v1+json';

const APP_BACKEND_GRAPHQL_URL = 'https://pc-api.polestar.com/eu-north-1/app-backend/api/graphql';
const APP_BACKEND_ACCEPT = 'multipart/mixed;deferSpec=20220824, application/graphql-response+json, application/json';
const APP_USER_AGENT = 'PolestarApp/5.5.0b1102 Android/14';
const APP_FORCE_UPDATE_VERSION = '5.5.0';
const APP_LOCALE = 'SE';

const GET_VEHICLES_QUERY = `
query GetVDMSCars {
    vdms {
        getVehiclesInformation {
            vin
            internalVehicleIdentifier
            registrationNo
            modelYear
            content { model { name } }
        }
    }
}
`;

async function discoverC3Endpoint(accessToken) {
    const r = await axios.get(C3_DISCOVERY_URL, {
        headers: {
            authorization: `Bearer ${accessToken}`,
            accept: C3_ACCEPT_HEADER,
        },
        timeout: 30000,
        validateStatus: () => true,
    });
    if (r.status !== 200) throw new Error(`C3 discovery failed: ${r.status}`);
    const c3 = r.data.c3 || {};
    if (!c3.grpcHost) throw new Error('C3 discovery response missing grpcHost');
    return {
        host: c3.grpcHost,
        port: Number(c3.grpcPort || 443),
        keepAliveTime: c3.grpcKeepAliveTime || null,
    };
}

async function getVehicles(accessToken) {
    const r = await axios.post(APP_BACKEND_GRAPHQL_URL, {
        operationName: 'GetVDMSCars',
        variables: {},
        query: GET_VEHICLES_QUERY,
        extensions: { clientLibrary: { name: 'apollo-kotlin', version: '4.4.1' } },
    }, {
        headers: {
            'user-agent': APP_USER_AGENT,
            'x-polestar-force-update-version': APP_FORCE_UPDATE_VERSION,
            'x-polestar-locale': APP_LOCALE,
            'x-polestarid-authorization': `Bearer ${accessToken}`,
            'x-apollo-operation-name': 'GetVDMSCars',
            'x-apollo-request-uuid': randomUUID(),
            accept: APP_BACKEND_ACCEPT,
            'content-type': 'application/json',
        },
        timeout: 30000,
        validateStatus: () => true,
    });
    if (r.status !== 200) throw new Error(`Vehicle list failed: ${r.status} ${JSON.stringify(r.data)}`);
    const cars = (((r.data || {}).data || {}).vdms || {}).getVehiclesInformation || [];
    return cars;
}

module.exports = { discoverC3Endpoint, getVehicles };
