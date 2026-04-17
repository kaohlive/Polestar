'use strict';

const http2 = require('http2');

const USER_AGENT = 'grpc-java-okhttp/1.68.2';

function frameMessage(payload) {
    const frame = Buffer.alloc(5 + payload.length);
    frame[0] = 0; // compression flag: none
    frame.writeUInt32BE(payload.length, 1);
    payload.copy(frame, 5);
    return frame;
}

function parseFrames(buf) {
    const messages = [];
    let pos = 0;
    while (pos + 5 <= buf.length) {
        const compressed = buf[pos];
        const len = buf.readUInt32BE(pos + 1);
        if (pos + 5 + len > buf.length) break;
        if (compressed !== 0) throw new Error('Compressed gRPC frames not supported');
        messages.push(buf.slice(pos + 5, pos + 5 + len));
        pos += 5 + len;
    }
    return messages;
}

function connect(host, port) {
    return http2.connect(`https://${host}:${port || 443}`, {
        settings: { enablePush: false },
        ALPNProtocols: ['h2'],
    });
}

const GRPC_STATUS_NAMES = {
    0: 'OK', 1: 'CANCELLED', 2: 'UNKNOWN', 3: 'INVALID_ARGUMENT', 4: 'DEADLINE_EXCEEDED',
    5: 'NOT_FOUND', 6: 'ALREADY_EXISTS', 7: 'PERMISSION_DENIED', 8: 'RESOURCE_EXHAUSTED',
    9: 'FAILED_PRECONDITION', 10: 'ABORTED', 11: 'OUT_OF_RANGE', 12: 'UNIMPLEMENTED',
    13: 'INTERNAL', 14: 'UNAVAILABLE', 15: 'DATA_LOSS', 16: 'UNAUTHENTICATED',
};

function sanitizeHeaders(h) {
    const out = {};
    for (const [k, v] of Object.entries(h || {})) {
        if (k === 'authorization') { out[k] = '[redacted]'; continue; }
        out[k] = v;
    }
    return out;
}

function unaryUnary(session, method, requestBytes, metadata = {}, { timeoutMs = 30000, debug = false } = {}) {
    return new Promise((resolve, reject) => {
        const headers = {
            ':method': 'POST',
            ':path': method,
            'content-type': 'application/grpc',
            te: 'trailers',
            'grpc-accept-encoding': 'identity,gzip',
            'grpc-encoding': 'identity',
            'user-agent': USER_AGENT,
            ...metadata,
        };

        const req = session.request(headers, { endStream: false });
        const chunks = [];
        let respHeaders = null;
        let trailers = null;
        let timedOut = false;
        let settled = false;

        const finish = (fn, arg) => { if (!settled) { settled = true; clearTimeout(timer); fn(arg); } };

        const timer = setTimeout(() => {
            timedOut = true;
            try { req.close(http2.constants.NGHTTP2_CANCEL); } catch (_) {}
            finish(reject, new Error(`gRPC ${method} timeout after ${timeoutMs}ms`));
        }, timeoutMs);

        req.on('response', (h) => {
            respHeaders = h;
            if (debug) console.error('[grpc response headers]', sanitizeHeaders(h));
            const httpStatus = Number(h[':status']);
            // Trailers-only response: grpc-status is in the response HEADERS frame
            // (server sent END_STREAM on HEADERS, so 'trailers' event won't fire).
            if (h['grpc-status'] !== undefined) {
                const s = Number(h['grpc-status']);
                if (s !== 0) {
                    const msg = h['grpc-message'] || GRPC_STATUS_NAMES[s] || 'unknown';
                    finish(reject, new Error(`gRPC ${method} trailers-only: status=${s} (${GRPC_STATUS_NAMES[s] || '?'}) message="${msg}" http=${httpStatus}`));
                }
                // s===0 is unusual for trailers-only but let 'end' handle it
            } else if (httpStatus !== 200) {
                finish(reject, new Error(`gRPC ${method} HTTP ${httpStatus}; headers=${JSON.stringify(sanitizeHeaders(h))}`));
            }
        });

        req.on('trailers', (t) => { trailers = t; if (debug) console.error('[grpc trailers]', t); });
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => {
            if (timedOut || settled) return;
            const body = Buffer.concat(chunks);
            const effective = trailers || respHeaders || {};
            const s = effective['grpc-status'];
            if (s !== undefined && Number(s) !== 0) {
                const msg = effective['grpc-message'] || GRPC_STATUS_NAMES[Number(s)] || 'unknown';
                finish(reject, new Error(`gRPC ${method} status=${s} (${GRPC_STATUS_NAMES[Number(s)] || '?'}) message="${msg}"`));
                return;
            }
            if (body.length === 0) {
                const dump = JSON.stringify({
                    respHeaders: sanitizeHeaders(respHeaders),
                    trailers,
                });
                finish(reject, new Error(`gRPC ${method} returned empty body; ${dump}`));
                return;
            }
            const frames = parseFrames(body);
            if (frames.length === 0) {
                finish(reject, new Error(`gRPC ${method} body (${body.length}B) not parseable as gRPC frames; hex=${body.toString('hex').slice(0, 80)}…`));
                return;
            }
            finish(resolve, frames[0]);
        });
        req.on('error', (err) => finish(reject, err));

        req.end(frameMessage(requestBytes));
    });
}

function serverStreamFirst(session, method, requestBytes, metadata = {}, { timeoutMs = 20000, debug = false } = {}) {
    return new Promise((resolve, reject) => {
        const headers = {
            ':method': 'POST',
            ':path': method,
            'content-type': 'application/grpc',
            te: 'trailers',
            'grpc-accept-encoding': 'identity,gzip',
            'grpc-encoding': 'identity',
            'user-agent': USER_AGENT,
            ...metadata,
        };

        const req = session.request(headers, { endStream: false });
        let respHeaders = null;
        let buffered = Buffer.alloc(0);
        let settled = false;
        let timedOut = false;

        const finish = (fn, arg) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { req.close(http2.constants.NGHTTP2_CANCEL); } catch (_) {}
            fn(arg);
        };

        const timer = setTimeout(() => {
            timedOut = true;
            finish(reject, new Error(`gRPC ${method} timeout after ${timeoutMs}ms`));
        }, timeoutMs);

        req.on('response', (h) => {
            respHeaders = h;
            if (debug) console.error('[grpc response headers]', sanitizeHeaders(h));
            if (h['grpc-status'] !== undefined) {
                const s = Number(h['grpc-status']);
                if (s !== 0) {
                    const msg = h['grpc-message'] || GRPC_STATUS_NAMES[s] || 'unknown';
                    finish(reject, new Error(`gRPC ${method} trailers-only: status=${s} (${GRPC_STATUS_NAMES[s] || '?'}) message="${msg}"`));
                }
            } else if (Number(h[':status']) !== 200) {
                finish(reject, new Error(`gRPC ${method} HTTP ${h[':status']}`));
            }
        });

        req.on('data', (chunk) => {
            if (settled) return;
            buffered = Buffer.concat([buffered, chunk]);
            // Try to parse the first complete frame.
            if (buffered.length < 5) return;
            const len = buffered.readUInt32BE(1);
            if (buffered.length < 5 + len) return;
            const frame = buffered.slice(5, 5 + len);
            finish(resolve, frame);
        });

        req.on('trailers', (t) => {
            if (settled) return;
            if (debug) console.error('[grpc trailers]', t);
            const s = t['grpc-status'];
            if (s !== undefined && Number(s) !== 0) {
                const msg = t['grpc-message'] || GRPC_STATUS_NAMES[Number(s)] || 'unknown';
                finish(reject, new Error(`gRPC ${method} status=${s} (${GRPC_STATUS_NAMES[Number(s)] || '?'}) message="${msg}"`));
            }
        });

        req.on('end', () => {
            if (settled || timedOut) return;
            finish(reject, new Error(`gRPC ${method} stream ended without any message frames`));
        });

        req.on('error', (err) => finish(reject, err));

        req.end(frameMessage(requestBytes));
    });
}

module.exports = { connect, unaryUnary, serverStreamFirst, frameMessage, parseFrames };
