'use strict';

/**
 * Encrypts secrets (Polestar ID password, refresh tokens, Data Portal client
 * secret) with a random key generated once per installation and kept in the
 * app's own settings.
 *
 * Replaces lib/homeycrypt.js, whose key was derived from a network interface
 * MAC address: when Homey reported a different MAC (Wi-Fi ↔ Ethernet, renamed
 * interfaces after a firmware update, Docker / self-hosted), the stored
 * password could no longer be decrypted and the device stopped starting.
 *
 * Format: "v2:<iv>:<tag>:<ciphertext>" (base64), AES-256-GCM.
 */

const crypto = require('crypto');

const KEY_SETTING = 'secret_key';
const PREFIX = 'v2:';

function getKey(homey) {
    let hex = homey.settings.get(KEY_SETTING);
    if (typeof hex !== 'string' || !/^[0-9a-f]{64}$/.test(hex)) {
        hex = crypto.randomBytes(32).toString('hex');
        homey.settings.set(KEY_SETTING, hex);
    }
    return Buffer.from(hex, 'hex');
}

function isEncrypted(value) {
    return typeof value === 'string' && value.startsWith(PREFIX);
}

function encrypt(homey, plaintext) {
    if (plaintext === null || plaintext === undefined) return null;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', getKey(homey), iv);
    const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return PREFIX + [iv, tag, ct].map((b) => b.toString('base64')).join(':');
}

function decrypt(homey, value) {
    if (!isEncrypted(value)) throw new Error('Value is not in v2 format');
    const [iv, tag, ct] = value.slice(PREFIX.length).split(':').map((s) => Buffer.from(s, 'base64'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(homey), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt, isEncrypted, KEY_SETTING };
