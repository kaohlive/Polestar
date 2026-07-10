'use strict';

const axios = require('axios');

const C3_DISCOVERY_URL = 'https://cnepmob.volvocars.com/';
const C3_ACCEPT_HEADER = 'application/volvo.cloud.cnepmob.v1+json';

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

module.exports = { discoverC3Endpoint };
