'use strict';

const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_LEN = 2;
const WIRE_START_GROUP = 3;
const WIRE_END_GROUP = 4;
const WIRE_FIXED32 = 5;

function encodeVarint(value) {
    if (typeof value === 'number') value = BigInt(Math.trunc(value));
    if (value < 0n) value = value & 0xFFFFFFFFFFFFFFFFn;
    const bytes = [];
    while (value > 0x7Fn) {
        bytes.push(Number((value & 0x7Fn) | 0x80n));
        value >>= 7n;
    }
    bytes.push(Number(value & 0x7Fn));
    return Buffer.from(bytes);
}

function decodeVarint(buf, pos) {
    let result = 0n;
    let shift = 0n;
    while (true) {
        const b = buf[pos++];
        result |= BigInt(b & 0x7F) << shift;
        if ((b & 0x80) === 0) break;
        shift += 7n;
    }
    return [result, pos];
}

function encodeTag(fieldNumber, wireType) {
    return encodeVarint((fieldNumber << 3) | wireType);
}

function encodeLenDelim(fieldNumber, payload) {
    return Buffer.concat([encodeTag(fieldNumber, WIRE_LEN), encodeVarint(payload.length), payload]);
}

function encodeField(fieldNumber, type, value) {
    switch (type) {
        case 'string': {
            const enc = Buffer.from(String(value), 'utf8');
            return encodeLenDelim(fieldNumber, enc);
        }
        case 'bytes':
            return encodeLenDelim(fieldNumber, Buffer.from(value));
        case 'int32':
        case 'int64':
        case 'uint32':
        case 'uint64':
        case 'enum':
            return Buffer.concat([encodeTag(fieldNumber, WIRE_VARINT), encodeVarint(value)]);
        case 'bool':
            return Buffer.concat([encodeTag(fieldNumber, WIRE_VARINT), encodeVarint(value ? 1 : 0)]);
        case 'double': {
            const b = Buffer.alloc(8);
            b.writeDoubleLE(Number(value), 0);
            return Buffer.concat([encodeTag(fieldNumber, WIRE_FIXED64), b]);
        }
        case 'float': {
            const b = Buffer.alloc(4);
            b.writeFloatLE(Number(value), 0);
            return Buffer.concat([encodeTag(fieldNumber, WIRE_FIXED32), b]);
        }
        case 'message':
            return encodeLenDelim(fieldNumber, Buffer.from(value));
        default:
            throw new Error(`Unknown field type: ${type}`);
    }
}

function encode(schema, obj) {
    const parts = [];
    for (const [name, spec] of Object.entries(schema)) {
        if (!(name in obj)) continue;
        const val = obj[name];
        if (val === null || val === undefined) continue;
        if (spec.type === 'message' && val && typeof val === 'object' && !Buffer.isBuffer(val)) {
            if (!spec.schema) throw new Error(`Nested schema missing for field ${name}`);
            const nested = encode(spec.schema, val);
            parts.push(encodeField(spec.num, 'message', nested));
        } else {
            parts.push(encodeField(spec.num, spec.type, val));
        }
    }
    return Buffer.concat(parts);
}

function skipGroup(buf, pos, fieldNumber) {
    while (pos < buf.length) {
        let tag;
        [tag, pos] = decodeVarint(buf, pos);
        const t = Number(tag);
        const wt = t & 0x07;
        const fn = t >> 3;
        if (wt === WIRE_END_GROUP && fn === fieldNumber) return pos;
        switch (wt) {
            case WIRE_VARINT: [, pos] = decodeVarint(buf, pos); break;
            case WIRE_FIXED64: pos += 8; break;
            case WIRE_LEN: {
                let len; [len, pos] = decodeVarint(buf, pos);
                pos += Number(len);
                break;
            }
            case WIRE_START_GROUP: pos = skipGroup(buf, pos, fn); break;
            case WIRE_FIXED32: pos += 4; break;
            default: throw new Error(`Unknown wire type ${wt}`);
        }
    }
    return pos;
}

function decode(schema, buf) {
    const byNum = {};
    for (const [name, spec] of Object.entries(schema)) {
        byNum[spec.num] = { name, ...spec };
    }

    const result = {};
    let pos = 0;
    while (pos < buf.length) {
        let tag;
        [tag, pos] = decodeVarint(buf, pos);
        const t = Number(tag);
        const fn = t >> 3;
        const wt = t & 0x07;
        let raw;

        switch (wt) {
            case WIRE_VARINT: [raw, pos] = decodeVarint(buf, pos); break;
            case WIRE_FIXED64: {
                raw = buf.readDoubleLE(pos);
                pos += 8;
                break;
            }
            case WIRE_LEN: {
                let len; [len, pos] = decodeVarint(buf, pos);
                const l = Number(len);
                raw = buf.slice(pos, pos + l);
                pos += l;
                break;
            }
            case WIRE_START_GROUP: pos = skipGroup(buf, pos, fn); continue;
            case WIRE_END_GROUP: continue;
            case WIRE_FIXED32: {
                raw = buf.readFloatLE(pos);
                pos += 4;
                break;
            }
            default: throw new Error(`Unknown wire type ${wt}`);
        }

        const spec = byNum[fn];
        if (!spec) continue; // unknown field, skip

        let value;
        switch (spec.type) {
            case 'string': value = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw); break;
            case 'bytes': value = raw; break;
            case 'bool': value = Boolean(Number(raw)); break;
            case 'int32':
            case 'uint32':
            case 'enum': value = Number(raw); break;
            case 'int64':
            case 'uint64': {
                const asBig = typeof raw === 'bigint' ? raw : BigInt(raw);
                value = asBig <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(asBig) : asBig;
                break;
            }
            case 'double':
            case 'float': value = Number(raw); break;
            case 'message': {
                if (!spec.schema) { value = raw; break; }
                value = decode(spec.schema, raw);
                break;
            }
            default: value = raw;
        }

        if (spec.name in result) {
            if (!Array.isArray(result[spec.name])) result[spec.name] = [result[spec.name]];
            result[spec.name].push(value);
        } else {
            result[spec.name] = value;
        }
    }
    return result;
}

/** Raw decoder that keeps every field keyed by number, ignoring any schema.
 *  Intended for debugging/introspection of responses whose layout we don't know yet. */
function decodeRaw(buf) {
    const result = {};
    let pos = 0;
    while (pos < buf.length) {
        let tag;
        [tag, pos] = decodeVarint(buf, pos);
        const t = Number(tag);
        const fn = t >> 3;
        const wt = t & 0x07;
        let raw;
        switch (wt) {
            case WIRE_VARINT: [raw, pos] = decodeVarint(buf, pos); break;
            case WIRE_FIXED64: raw = buf.readDoubleLE(pos); pos += 8; break;
            case WIRE_LEN: {
                let len; [len, pos] = decodeVarint(buf, pos);
                const l = Number(len);
                raw = buf.slice(pos, pos + l);
                pos += l;
                break;
            }
            case WIRE_FIXED32: raw = buf.readFloatLE(pos); pos += 4; break;
            default: return result; // unknown / group / end-group: stop parsing
        }
        if (typeof raw === 'bigint' && raw <= BigInt(Number.MAX_SAFE_INTEGER)) raw = Number(raw);
        const key = `field${fn}(wt=${wt})`;
        if (key in result) {
            if (!Array.isArray(result[key])) result[key] = [result[key]];
            result[key].push(raw);
        } else {
            result[key] = raw;
        }
    }
    return result;
}

module.exports = {
    encodeVarint, decodeVarint,
    encodeField, encodeLenDelim,
    encode, decode, decodeRaw,
    WIRE_VARINT, WIRE_FIXED64, WIRE_LEN, WIRE_FIXED32,
};
