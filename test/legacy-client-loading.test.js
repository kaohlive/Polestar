'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('vehicle driver and device load the declared legacy client package', () => {
    const root = path.resolve(__dirname, '..');
    const packageJson = require(path.join(root, 'package.json'));
    const dependency = '@andysmithfal/polestar.js';

    assert.ok(packageJson.dependencies[dependency]);
    assert.doesNotThrow(() => require.resolve(dependency));

    for (const relativePath of ['drivers/vehicle/driver.js', 'drivers/vehicle/device.js']) {
        const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
        assert.match(source, /require\('@andysmithfal\/polestar\.js'\)/);
        assert.doesNotMatch(source, /require\('\.\.\/\.\.\/clone_modules\/polestar\.js'\)/);
    }
});
