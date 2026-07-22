'use strict';

const STATUS = Object.freeze({
    OFF: { key: 'off', label: 'Off' },
    PRECONDITIONING_FINISHED: { key: 'finished', label: 'Finished' },
    ON: { key: 'on', label: 'On' },
    BATTERY_TEMPERATURE_OPTIMAL: { key: 'optimal', label: 'Battery temperature optimal' },
});

const UNAVAILABLE = Object.freeze({
    STATUS_FAULT: { key: 'fault', label: 'Unavailable: fault' },
    CHARGING_IN_PROGRESS: { key: 'charging', label: 'Unavailable: charging' },
    LOW_ENERGY: { key: 'low_energy', label: 'Unavailable: low energy' },
    PRECONDITIONING_PLANNED: { key: 'planned', label: 'Planned' },
    PRECONDITIONING_IN_PROGRESS: { key: 'in_progress', label: 'In progress' },
});

function normalizeManualPreconditioning(manual) {
    if (!manual) {
        return { reported: false, key: null, label: 'Not reported' };
    }

    if (manual.status_label === 'UNAVAILABLE') {
        const unavailable = UNAVAILABLE[manual.unavailable_reason_label];
        if (unavailable) {
            return { reported: true, ...unavailable };
        }
        return {
            reported: true,
            key: 'unavailable',
            label: 'Unavailable',
        };
    }

    const status = STATUS[manual.status_label];
    if (status) return { reported: true, ...status };

    return { reported: true, key: 'unknown', label: 'Unknown' };
}

function transitionPreconditioningState(previousKey, reportedKey) {
    if (reportedKey == null) {
        return { key: previousKey ?? null, changed: false };
    }
    return {
        key: reportedKey,
        changed: previousKey != null && previousKey !== reportedKey,
    };
}

module.exports = {
    normalizeManualPreconditioning,
    transitionPreconditioningState,
};
