'use strict';

const CONTACT_CAPABILITIES = [
    'alarm_contact.door_front_left',
    'alarm_contact.door_front_right',
    'alarm_contact.door_rear_left',
    'alarm_contact.door_rear_right',
    'alarm_contact.window_front_left',
    'alarm_contact.window_front_right',
    'alarm_contact.window_rear_left',
    'alarm_contact.window_rear_right',
    'alarm_contact.tailgate',
    'alarm_contact.hood',
    'alarm_contact.sunroof',
    'alarm_contact.tank_lid',
];

function contactStatesFromExterior(exterior) {
    return {
        'alarm_contact.door_front_left': exterior?.doors?.frontLeftOpen,
        'alarm_contact.door_front_right': exterior?.doors?.frontRightOpen,
        'alarm_contact.door_rear_left': exterior?.doors?.rearLeftOpen,
        'alarm_contact.door_rear_right': exterior?.doors?.rearRightOpen,
        'alarm_contact.window_front_left': exterior?.windows?.frontLeftOpen,
        'alarm_contact.window_front_right': exterior?.windows?.frontRightOpen,
        'alarm_contact.window_rear_left': exterior?.windows?.rearLeftOpen,
        'alarm_contact.window_rear_right': exterior?.windows?.rearRightOpen,
        'alarm_contact.tailgate': exterior?.tailgateOpen,
        'alarm_contact.hood': exterior?.hoodOpen,
        'alarm_contact.sunroof': exterior?.sunroofOpen,
        'alarm_contact.tank_lid': exterior?.tankLidOpen,
    };
}

function observedContactCapabilities(states) {
    // Field presence establishes that the backend exposes this contact. Only
    // undefined means the protobuf field was absent.
    return CONTACT_CAPABILITIES.filter((capability) => states[capability] !== undefined);
}

function mergeSupportedContactCapabilities(stored, states) {
    const observed = observedContactCapabilities(states);
    if (observed.length === 0) return Array.isArray(stored) ? stored : null;

    const supported = new Set(Array.isArray(stored) ? stored : []);
    for (const capability of observed) supported.add(capability);
    return CONTACT_CAPABILITIES.filter((capability) => supported.has(capability));
}

function isRealContactTransition(previous, next) {
    return typeof previous === 'boolean' && previous !== next;
}

function aggregateWindowState(exterior) {
    const states = [
        exterior?.windows?.frontLeftOpen,
        exterior?.windows?.frontRightOpen,
        exterior?.windows?.rearLeftOpen,
        exterior?.windows?.rearRightOpen,
    ];
    if (states.some((state) => state === true)) return true;
    return states.every((state) => typeof state === 'boolean') ? false : null;
}

module.exports = {
    CONTACT_CAPABILITIES,
    contactStatesFromExterior,
    observedContactCapabilities,
    mergeSupportedContactCapabilities,
    isRealContactTransition,
    aggregateWindowState,
};
