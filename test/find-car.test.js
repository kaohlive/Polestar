'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
    HONK_FLASH_TYPE,
    supportedFindCarActions,
    supportsFindCar,
    resolveFindCarButtonAction,
    resolveFindCarFlowAction,
} = require('../drivers/vehicle/find-car');

test('advertised honk/flash modes map to supported actions', () => {
    assert.deepEqual(supportedFindCarActions(HONK_FLASH_TYPE.HONK_AND_OR_FLASH), ['both', 'honk', 'flash']);
    assert.deepEqual(supportedFindCarActions(HONK_FLASH_TYPE.HONK_AND_FLASH), ['both']);
    assert.deepEqual(supportedFindCarActions(HONK_FLASH_TYPE.FLASH), ['flash']);
    assert.deepEqual(supportedFindCarActions(HONK_FLASH_TYPE.HONK), ['honk']);
    assert.deepEqual(supportedFindCarActions(HONK_FLASH_TYPE.NONE), []);
});

test('unspecified and legacy capability data preserve the existing button', () => {
    assert.equal(supportsFindCar(HONK_FLASH_TYPE.UNSPECIFIED), true);
    assert.equal(supportsFindCar(undefined), true);
    assert.equal(supportsFindCar(HONK_FLASH_TYPE.NONE), false);
});

test('button preference uses the invocation wire mapping', () => {
    assert.deepEqual(resolveFindCarButtonAction('both', HONK_FLASH_TYPE.HONK_AND_OR_FLASH), { action: 'both', code: 0 });
    assert.deepEqual(resolveFindCarButtonAction('honk', HONK_FLASH_TYPE.HONK_AND_OR_FLASH), { action: 'honk', code: 1 });
    assert.deepEqual(resolveFindCarButtonAction('flash', HONK_FLASH_TYPE.HONK_AND_OR_FLASH), { action: 'flash', code: 2 });
});

test('single-mode vehicles force the button to their sole supported action', () => {
    assert.deepEqual(resolveFindCarButtonAction('flash', HONK_FLASH_TYPE.HONK_AND_FLASH), { action: 'both', code: 0 });
    assert.deepEqual(resolveFindCarButtonAction('both', HONK_FLASH_TYPE.FLASH), { action: 'flash', code: 2 });
    assert.deepEqual(resolveFindCarButtonAction('flash', HONK_FLASH_TYPE.HONK), { action: 'honk', code: 1 });
});

test('Flow keeps its explicit action and rejects an unsupported selection', () => {
    assert.deepEqual(resolveFindCarFlowAction('both', HONK_FLASH_TYPE.HONK_AND_OR_FLASH), { action: 'both', code: 0 });
    assert.deepEqual(resolveFindCarFlowAction('honk', HONK_FLASH_TYPE.HONK_AND_OR_FLASH), { action: 'honk', code: 1 });
    assert.deepEqual(resolveFindCarFlowAction('flash', HONK_FLASH_TYPE.HONK_AND_OR_FLASH), { action: 'flash', code: 2 });
    assert.throws(
        () => resolveFindCarFlowAction('honk', HONK_FLASH_TYPE.FLASH),
        /not supported/,
    );
});

test('missing Flow action retains the existing safe flash default', () => {
    assert.deepEqual(resolveFindCarFlowAction(undefined, undefined), { action: 'flash', code: 2 });
});

test('explicitly unsupported vehicles reject button and Flow commands', () => {
    assert.throws(
        () => resolveFindCarButtonAction('flash', HONK_FLASH_TYPE.NONE),
        /not supported/,
    );
    assert.throws(
        () => resolveFindCarFlowAction('flash', HONK_FLASH_TYPE.NONE),
        /not supported/,
    );
});
