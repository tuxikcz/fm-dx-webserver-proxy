# fm-dx-webserver-proxy

Simple Node.js WebSocket relay / fan-out server.

It opens a single upstream WebSocket connection and broadcasts received frames to multiple downstream clients. Useful when the source side has limited bandwidth and you want to avoid one upstream connection per client.

## Features

- one upstream WebSocket connection
- multiple downstream clients
- optional verbose debug logging
- configurable listen host, port and path
- automatic upstream reconnect
- simple CLI usage
- suitable for running under Supervisor

## Use case

Typical scenario:

- source machine has a weak internet link
- upstream provides audio or other data over WebSocket
- many clients need to consume the same stream

Instead of opening one upstream connection per client, `fm-dx-webserver-proxy` keeps a single upstream connection open and forwards received frames to all connected clients.

## Requirements

- Node.js 18 or newer recommended
- npm
- package `ws`

## Installation

```bash
git clone https://github.com/tuxikcz/fm-dx-webserver-proxy.git -b main
cd fm-dx-webserver-proxy
npm install
```

## Usage

```bash
Options:
  --upstream URL        Upstream WebSocket URL (required)
  --listen-host HOST    Local listen host (default: 0.0.0.0)
  --listen-port PORT    Local listen port (default: 8081)
  --listen-path PATH    Expected request path from clients, e.g. /audio (optional)
  --reconnect-ms MS     Upstream reconnect delay in ms (default: 5000)
  --debug               Enable verbose debug logging
  --help                Show this help

Examples:
  node ws-relay.js --upstream ws://10.0.0.2:8080/audio --listen-port 8081
  node ws-relay.js --upstream wss://example.com/audio --listen-host 127.0.0.1 --listen-port 9000 --listen-path /audio

