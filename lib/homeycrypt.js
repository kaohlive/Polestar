'use strict'
const os = require('os');
const crypto = require('crypto');

async function getsalts() {
    var networkint = await os.networkInterfaces();
    var mac = null;

    // Preferred order — keeps existing salts stable on systems where the
    // original Homey OS exposed these names. Existing encrypted passwords
    // were derived from one of these MACs.
    if (networkint.wlan0 && networkint.wlan0[0] && networkint.wlan0[0].mac)
        mac = networkint.wlan0[0].mac.split(':');
    else if (networkint.eth0 && networkint.eth0[0] && networkint.eth0[0].mac)
        mac = networkint.eth0[0].mac.split(':');
    else if (networkint.eth1 && networkint.eth1[0] && networkint.eth1[0].mac)
        mac = networkint.eth1[0].mac.split(':');

    // Fallback for newer Homey OS / Pro 2023 where interfaces have names like
    // 'end0', 'enp*' etc. Pick the first non-loopback, non-zero MAC. Sorted
    // so the same interface keeps being chosen across reboots.
    if (mac === null) {
        for (const name of Object.keys(networkint).sort()) {
            for (const iface of networkint[name] || []) {
                if (iface && !iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
                    mac = iface.mac.split(':');
                    break;
                }
            }
            if (mac !== null) break;
        }
    }

    if (mac === null) {
        throw new Error('Cannot derive encryption salt: no usable network interface MAC found');
    }

    var macbuffer = Buffer.from(mac.join(''), 'hex');
    //console.log(mac);
    let salt = {
        prepend: macbuffer.subarray(3, 6),
        append: macbuffer.subarray(0, 3),
        iv: Buffer.concat([macbuffer, Buffer.from('00000000000000000000', 'hex')])
    }
    return salt;
}

module.exports.crypt = async function (str, key) {
    //console.log('creating device specifick salts');
    var salt = await getsalts();
    //console.log('check on max key length: ' + key.length)
    if (key.length >= 17)
        key = key.substr(0, 17);
    //console.log('creating salted encryption key using key with length: ' + key.length)
    var saltedKey = Buffer.concat([salt.prepend, Buffer.from(key), salt.append]);
    //console.log('salted key length in total ' + saltedKey.length)
    var paddinglength = 24 - saltedKey.length;
    var key = Buffer.concat([saltedKey, Buffer.alloc(paddinglength, paddinglength)]);
    var cipher = crypto.createCipheriv('aes-192-cbc', key, salt.iv).setAutoPadding(true);
    var crypteddata = cipher.update(str, null, 'hex');
    crypteddata += cipher.final('hex');
    return crypteddata.toString('hex');
}

module.exports.decrypt = async function (cryptedstr, key) {
    var salt = await getsalts();
    if (key.length >= 17)
        key = key.substr(0, 17);
    var saltedKey = Buffer.concat([salt.prepend, Buffer.from(key), salt.append]);
    var paddinglength = 24 - saltedKey.length;
    var key = Buffer.concat([saltedKey, Buffer.alloc(paddinglength, paddinglength)]);
    var decipher = crypto.createDecipheriv('aes-192-cbc', key, salt.iv).setAutoPadding(true);
    var decrypteddata = decipher.update(cryptedstr, 'hex', 'ascii');
    decrypteddata += decipher.final('ascii');
    return decrypteddata;
}