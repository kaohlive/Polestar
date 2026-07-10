'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const codec = require('../clone_modules/polestar-c3/codec');

const CarSchema = {
    vin: { num: 1, type: 'string' },
    vehicleTypeCode: { num: 5, type: 'string' },
    vehicleTypeName: { num: 6, type: 'string' },
    modelYear: { num: 7, type: 'string' },
    market: { num: 10, type: 'string' },
};

const MyCarSchema = {
    car: { num: 1, type: 'message', schema: CarSchema },
    userIsLinked: { num: 2, type: 'bool' },
    userIsOwner: { num: 3, type: 'bool' },
    registrationPlate: { num: 4, type: 'string' },
};

function encodeMyCar(value) {
    return codec.encodeField(1, 'message', codec.encode(MyCarSchema, value));
}

function loadClientWithoutGraphqlDiscovery() {
    const discoveryPath = require.resolve('../clone_modules/polestar-c3/discovery');
    const clientPath = require.resolve('../clone_modules/polestar-c3/client');
    const originalDiscovery = require.cache[discoveryPath];
    const originalClient = require.cache[clientPath];

    require.cache[discoveryPath] = {
        id: discoveryPath,
        filename: discoveryPath,
        loaded: true,
        exports: {
            discoverC3Endpoint: async () => ({ host: 'example.test', port: 443 }),
            getVehicles: async () => {
                throw new Error('GraphQL discovery must not be called');
            },
        },
    };
    delete require.cache[clientPath];
    const loaded = require(clientPath);

    return {
        PolestarC3: loaded.PolestarC3,
        restore() {
            if (originalDiscovery) require.cache[discoveryPath] = originalDiscovery;
            else delete require.cache[discoveryPath];
            if (originalClient) require.cache[clientPath] = originalClient;
            else delete require.cache[clientPath];
        },
    };
}

test('listVehicles uses GetMyCars and includes linked non-owner Polestar 3 cars', async () => {
    const { PolestarC3, restore } = loadClientWithoutGraphqlDiscovery();
    try {
        const response = encodeMyCar({
            car: {
                vin: 'YSMET3KA0SL000707',
                vehicleTypeCode: '359',
                vehicleTypeName: 'Polestar 3',
                modelYear: '2025',
                market: 'NO',
            },
            userIsLinked: true,
            userIsOwner: false,
            registrationPlate: '',
        });
        const client = new PolestarC3('test@example.com', 'secret');
        client._auth.ensureValidToken = async () => 'test-token';
        let call;
        client._call = async (method, requestBytes) => {
            call = { method, requestBytes };
            return response;
        };

        const vehicles = await client.listVehicles();

        assert.equal(call.method, '/car_information.CarInformation/GetMyCars');
        assert.equal(call.requestBytes.length, 0);
        assert.deepEqual(vehicles, [{
            vin: 'YSMET3KA0SL000707',
            internalVehicleIdentifier: undefined,
            registrationNo: null,
            modelYear: '2025',
            market: 'NO',
            userIsLinked: true,
            userIsOwner: false,
            content: { model: { name: 'Polestar 3' } },
        }]);
    } finally {
        restore();
    }
});

test('listVehicles decodes repeated cars and ignores unknown protobuf fields', async () => {
    const { PolestarC3, restore } = loadClientWithoutGraphqlDiscovery();
    try {
        const first = encodeMyCar({
            car: { vin: 'YSMET3KA0SL000707', vehicleTypeCode: '359', vehicleTypeName: 'Polestar 3' },
            userIsLinked: true,
        });
        const unknown = codec.encodeField(99, 'string', 'ignored');
        const second = encodeMyCar({
            car: { vin: 'LPSVSECE0RL000001', vehicleTypeCode: '814', vehicleTypeName: 'Polestar 4' },
            userIsLinked: true,
            userIsOwner: true,
            registrationPlate: 'EV12345',
        });
        const client = new PolestarC3('test@example.com', 'secret');
        client._auth.ensureValidToken = async () => 'test-token';
        client._call = async () => Buffer.concat([first, unknown, second]);

        const vehicles = await client.listVehicles();

        assert.equal(vehicles.length, 2);
        assert.deepEqual(vehicles.map((vehicle) => vehicle.content.model.name), ['Polestar 3', 'Polestar 4']);
        assert.equal(vehicles[1].registrationNo, 'EV12345');
    } finally {
        restore();
    }
});

test('setVehicle accepts a stored VIN even when discovery returned no cars', async () => {
    const PolestarCompat = require('../clone_modules/polestar-c3/compat');
    const compat = new PolestarCompat('test@example.com', 'secret');
    let selectedVin;
    compat._vehicles = [];
    compat._client = {
        setVehicle: async (vin) => { selectedVin = vin; },
    };

    const selected = await compat.setVehicle('YSMET3KA0SL000707');

    assert.equal(selectedVin, 'YSMET3KA0SL000707');
    assert.deepEqual(selected, { vin: 'YSMET3KA0SL000707', id: undefined });
});

test('paired-device login does not depend on vehicle discovery', async () => {
    const PolestarCompat = require('../clone_modules/polestar-c3/compat');
    const compat = new PolestarCompat('test@example.com', 'secret');
    let loginCalled = false;
    let selectedVin;
    compat._client = {
        login: async () => { loginCalled = true; },
        listVehicles: async () => { throw new Error('discovery unavailable'); },
        setVehicle: async (vin) => { selectedVin = vin; },
    };

    await compat.login();
    await compat.setVehicle('YSMET3KA0SL000707');

    assert.equal(loginCalled, true);
    assert.equal(selectedVin, 'YSMET3KA0SL000707');
});
