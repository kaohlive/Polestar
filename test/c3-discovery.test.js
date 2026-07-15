'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { PolestarC3 } = require('../clone_modules/polestar-c3/client');

// GetMyCarsResponse with one synthetic linked, non-owner Polestar 3.
const GET_MY_CARS_RESPONSE = Buffer.from(
    '0a300a2a0a1159534d30303030303030303030303030312a03333539320a506f6c657374617220333a043230323510011800',
    'hex',
);

test('listVehicles uses C3 GetMyCars for a linked non-owner car', async () => {
    const client = new PolestarC3('test@example.com', 'unused');
    client._call = async (method, request) => {
        assert.equal(method, '/car_information.CarInformation/GetMyCars');
        assert.equal(request.length, 0);
        return GET_MY_CARS_RESPONSE;
    };

    assert.deepEqual(await client.listVehicles(), [{
        vin: 'YSM00000000000001',
        registrationNo: null,
        modelYear: '2025',
        userIsLinked: true,
        userIsOwner: false,
        content: { model: { name: 'Polestar 3' } },
    }]);
});
