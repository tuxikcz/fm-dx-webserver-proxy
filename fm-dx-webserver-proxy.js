#!/usr/bin/env node
'use strict';

const WebSocket = require('ws');

function printHelp() {
    console.log(`Usage:
  node ws-relay.js --upstream ws://10.0.200.42:8080/audio [options]

Options:
  --upstream URL        Upstream WebSocket URL (required)
  --listen-host HOST    Local listen host (default: 0.0.0.0)
  --listen-port PORT    Local listen port (default: 8081)
  --listen-path PATH    Expected request path from clients, e.g. /audio (optional)
  --reconnect-ms MS     Upstream reconnect delay in ms (default: 5000)
  --debug               Enable verbose debug logging
  --help                Show this help

Examples:
  node ws-relay.js --upstream ws://10.0.200.42:8080/audio --listen-port 8081
  node ws-relay.js --upstream wss://example.com/audio --listen-host 127.0.0.1 --listen-port 9000 --listen-path /audio
`);
}

function parseArgs(argv) {
    const cfg = {
        upstreamUrl: process.env.UPSTREAM_URL || '',
        listenHost: process.env.LISTEN_HOST || '0.0.0.0',
        listenPort: Number(process.env.LISTEN_PORT || 8081),
        listenPath: process.env.LISTEN_PATH || '',
        reconnectMs: Number(process.env.RECONNECT_MS || 5000),
        debug: /^(1|true|yes|on)$/i.test(process.env.DEBUG || ''),
        help: false,
    };

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];

        if (a === '--upstream') cfg.upstreamUrl = argv[++i];
        else if (a === '--listen-host') cfg.listenHost = argv[++i];
        else if (a === '--listen-port') cfg.listenPort = Number(argv[++i]);
        else if (a === '--listen-path') cfg.listenPath = argv[++i];
        else if (a === '--reconnect-ms') cfg.reconnectMs = Number(argv[++i]);
        else if (a === '--debug') cfg.debug = true;
        else if (a === '--help' || a === '-h') cfg.help = true;
        else throw new Error(`Unknown argument: ${a}`);
    }

    if (cfg.listenPath && !cfg.listenPath.startsWith('/')) {
        cfg.listenPath = '/' + cfg.listenPath;
    }

    return cfg;
}

function now() {
    return new Date().toISOString();
}

function dataLength(data) {
    if (Buffer.isBuffer(data)) return data.length;
    if (typeof data === 'string') return Buffer.byteLength(data);
    return Buffer.byteLength(String(data));
}

function dataPreview(data, max = 120) {
    try {
        if (Buffer.isBuffer(data)) {
            return data.subarray(0, Math.min(max, data.length)).toString('hex');
        }
        const s = String(data);
        return s.length > max ? s.slice(0, max) + '…' : s;
    } catch (e) {
        return `<preview-error: ${e.message}>`;
    }
}

function createLogger(debugEnabled) {
    return {
        info(msg) {
            console.log(`[${now()}] ${msg}`);
        },
        debug(msg) {
            if (debugEnabled) {
                console.log(`[${now()}] DEBUG: ${msg}`);
            }
        },
        error(msg) {
            console.error(`[${now()}] ERROR: ${msg}`);
        },
    };
}

let cfg;
try {
    cfg = parseArgs(process.argv.slice(2));
} catch (err) {
    console.error(`Argument error: ${err.message}`);
    printHelp();
    process.exit(2);
}

if (cfg.help) {
    printHelp();
    process.exit(0);
}

if (!cfg.upstreamUrl) {
    console.error('Missing required --upstream URL');
    printHelp();
    process.exit(2);
}

if (!Number.isInteger(cfg.listenPort) || cfg.listenPort < 1 || cfg.listenPort > 65535) {
    console.error('Invalid --listen-port value');
    process.exit(2);
}

if (!Number.isFinite(cfg.reconnectMs) || cfg.reconnectMs < 0) {
    console.error('Invalid --reconnect-ms value');
    process.exit(2);
}

const log = createLogger(cfg.debug);

let clients = new Set();
let upstream = null;
let reconnectTimer = null;
let upstreamReady = false;

function broadcast(data, isBinary) {
    let delivered = 0;

    for (const client of clients) {
        if (client.readyState === WebSocket.OPEN) {
            try {
                client.send(data, { binary: isBinary });
                delivered++;
            } catch (err) {
                log.error(`Client send failed: ${err.message}`);
            }
        }
    }

    return delivered;
}

function scheduleReconnect() {
    if (reconnectTimer) return;

    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectUpstream();
    }, cfg.reconnectMs);

    log.info(`Upstream reconnect scheduled in ${cfg.reconnectMs} ms`);
}

function connectUpstream() {
    if (upstream && (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING)) {
        log.debug('Upstream already open/connecting, skipping reconnect');
        return;
    }

    log.info(`Connecting upstream: ${cfg.upstreamUrl}`);
    upstream = new WebSocket(cfg.upstreamUrl);

    upstream.on('open', () => {
        upstreamReady = true;
        log.info('Upstream connected');
    });

    upstream.on('message', (data, isBinary) => {
        const len = dataLength(data);
        const delivered = broadcast(data, isBinary);

        log.debug(`Upstream message: ${len} bytes, binary=${isBinary}, delivered=${delivered}, clients=${clients.size}`);
        log.debug(`Upstream preview: ${dataPreview(data)}`);
    });

    upstream.on('close', (code, reason) => {
        upstreamReady = false;
        log.info(`Upstream closed: code=${code} reason=${reason}`);
        scheduleReconnect();
    });

    upstream.on('error', (err) => {
        log.error(`Upstream error: ${err.message}`);
    });

    upstream.on('unexpected-response', (req, res) => {
        log.error(`Upstream unexpected response: HTTP ${res.statusCode}`);
    });
}

const wss = new WebSocket.Server({
    host: cfg.listenHost,
    port: cfg.listenPort,
});

wss.on('listening', () => {
    log.info(`Relay listening on ws://${cfg.listenHost}:${cfg.listenPort}`);
});

wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress;
    const url = req.url;

    if (cfg.listenPath && url !== cfg.listenPath) {
        log.info(`Rejected client ${ip} wrong path ${url}`);
        ws.close(1008, 'Invalid path');
        return;
    }

    clients.add(ws);
    log.info(`Client connected: ${ip}, total=${clients.size}`);

    ws.on('message', (data, isBinary) => {
        log.debug(`Client message: ${dataLength(data)} bytes`);

        if (upstream && upstream.readyState === WebSocket.OPEN) {
            upstream.send(data, { binary: isBinary });
        }
    });

    ws.on('close', (code) => {
        clients.delete(ws);
        log.info(`Client disconnected: ${ip}, code=${code}, total=${clients.size}`);
    });

    ws.on('error', (err) => {
        clients.delete(ws);
        log.error(`Client error: ${err.message}`);
    });
});

connectUpstream();

