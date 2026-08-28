'use strict';

const HONK_FLASH_TYPE = Object.freeze({
    UNSPECIFIED: 0,
    NONE: 1,
    HONK_AND_FLASH: 2,
    HONK_AND_OR_FLASH: 3,
    FLASH: 4,
    HONK: 5,
});

const ACTION_CODE = Object.freeze({ both: 0, honk: 1, flash: 2 });
const ALL_ACTIONS = Object.freeze(['both', 'honk', 'flash']);

function supportedFindCarActions(honkFlashType) {
    switch (honkFlashType) {
        case HONK_FLASH_TYPE.NONE:
            return [];
        case HONK_FLASH_TYPE.HONK_AND_FLASH:
            return ['both'];
        case HONK_FLASH_TYPE.HONK_AND_OR_FLASH:
            return [...ALL_ACTIONS];
        case HONK_FLASH_TYPE.FLASH:
            return ['flash'];
        case HONK_FLASH_TYPE.HONK:
            return ['honk'];
        default:
            // UNSPECIFIED and legacy vehicle data do not prove lack of support.
            return [...ALL_ACTIONS];
    }
}

function supportsFindCar(honkFlashType) {
    return supportedFindCarActions(honkFlashType).length > 0;
}

function actionResult(action) {
    return { action, code: ACTION_CODE[action] };
}

function resolveFindCarButtonAction(preferredAction, honkFlashType) {
    const supported = supportedFindCarActions(honkFlashType);
    if (supported.length === 0) throw new Error('Find car is not supported by this vehicle');
    if (supported.length === 1) return actionResult(supported[0]);

    const action = supported.includes(preferredAction) ? preferredAction : 'flash';
    return actionResult(action);
}

function resolveFindCarFlowAction(requestedAction, honkFlashType) {
    const action = Object.hasOwn(ACTION_CODE, requestedAction) ? requestedAction : 'flash';
    const supported = supportedFindCarActions(honkFlashType);
    if (!supported.includes(action)) {
        throw new Error(`Find car action "${action}" is not supported by this vehicle`);
    }
    return actionResult(action);
}

module.exports = {
    HONK_FLASH_TYPE,
    supportedFindCarActions,
    supportsFindCar,
    resolveFindCarButtonAction,
    resolveFindCarFlowAction,
};
