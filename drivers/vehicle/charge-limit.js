'use strict';

const DEFAULT_CHARGE_LIMIT_PROFILE = Object.freeze({ min: 50, max: 100, step: 5 });
const POLESTAR_3_CHARGE_LIMIT_PROFILE = Object.freeze({ min: 40, max: 100, step: 10 });

function chargeLimitProfileForModel(modelName) {
    return /^polestar\s*3\b/i.test(String(modelName || '').trim())
        ? { ...POLESTAR_3_CHARGE_LIMIT_PROFILE }
        : { ...DEFAULT_CHARGE_LIMIT_PROFILE };
}

function effectiveChargeLimitProfile(modelName, observedValue) {
    const profile = chargeLimitProfileForModel(modelName);
    if (!Number.isInteger(observedValue) || observedValue < 1 || observedValue > 100) {
        return profile;
    }

    const alignedWithModelStep = (observedValue - profile.min) % profile.step === 0;
    profile.min = Math.min(profile.min, observedValue);
    profile.max = Math.max(profile.max, observedValue);
    if (!alignedWithModelStep) profile.step = 1;
    return profile;
}

function isChargeLimitAllowed(value, profile) {
    return Number.isInteger(value)
        && value >= profile.min
        && value <= profile.max
        && (value - profile.min) % profile.step === 0;
}

module.exports = {
    DEFAULT_CHARGE_LIMIT_PROFILE,
    POLESTAR_3_CHARGE_LIMIT_PROFILE,
    chargeLimitProfileForModel,
    effectiveChargeLimitProfile,
    isChargeLimitAllowed,
};
