# E2E Test Infrastructure & Runner Documentation

This document describes the design, layout, and execution of the automated End-to-End (E2E) testing infrastructure for the two-person chat application.

---

## 1. Directory Layout

All E2E test-related code and utilities are located under the `chat-app/tests/` directory:

```
chat-app/
├── package.json         # Modified with devDependencies & test scripts
├── server.js            # Modified to wrap server startup/shutdown and export instances
├── tests/
│   ├── helpers.js       # Socket connection helpers, event synchronization, & cleanup
│   ├── runner.js        # Programmatic test runner utilizing node:test
│   └── infra.test.js    # Comprehensive E2E test suite
```

---

## 2. Test Runner Execution

The testing infrastructure uses Node.js's native `node:test` API, which requires zero heavy external testing packages.

### package.json Integration
The `package.json` file is configured with the dependencies and test scripts:
```json
{
  "scripts": {
    "start": "node server.js",
    "test": "node tests/runner.js"
  },
  "dependencies": {
    "express": "^5.2.1",
    "socket.io": "^4.8.3"
  },
  "devDependencies": {
    "socket.io-client": "^4.8.3"
  }
}
```

### Execution Commands
You can run the tests using either of the following commands in the `chat-app` directory:
- Run via NPM:
  ```powershell
  npm test
  ```
- Run runner directly:
  ```powershell
  node tests/runner.js
  ```

---

## 3. Programmatic Server Control Mechanism

To avoid port conflicts and resource leaks during tests, `server.js` exports programmatic startup and shutdown control wrappers:

- **`startServer(port)`**: Binds the HTTP/Socket.IO server instance to the specified port and returns a Promise that resolves when the server is fully listening.
- **`stopServer()`**: Closes all Socket.IO client connections, terminates the Socket.IO server, and shuts down the underlying HTTP server. Returns a Promise that resolves when the server has completely stopped.

When `server.js` is run directly from the command line (e.g. `node server.js`), it detects that it is the main module (`require.main === module`) and starts automatically on the port specified by the `PORT` environment variable (defaulting to 3000).

---

## 4. Socket Client Connection & Event Sync

E2E tests require multiple simulated participants connecting to the server concurrently and verifying event transmissions. The file `tests/helpers.js` provides robust helper methods:

1. **`connectAndJoin(port, username, accessCode)`**:
   - Spawns a socket connection to `http://localhost:${port}` with the auth payload `{ username, accessCode }`.
   - Forces the clean `'websocket'` transport to prevent polling/CORS issues during tests.
   - Registers the connection in a tracking list.
   - Returns a Promise that resolves with the socket client if the server sends `join_success`.
   - Rejects the Promise if the server emits `join_error` or a connection error.

2. **`waitForEvent(socket, event, timeoutMs)`**:
   - Registers a one-time listener for the target event.
   - Returns a Promise that resolves when the event is emitted by the server.
   - Protects against hanging tests by rejecting the Promise with a timeout error if the event does not fire within `timeoutMs` (defaults to 2000ms).

3. **`cleanupSockets()`**:
   - Loops through all tracked socket connections created during the test run and disconnects them.
   - Automatically invoked in the `afterEach` hook to ensure clean test state.

---

## 5. Feature Coverage Plan

The suite `tests/infra.test.js` exercises all Phase 1 Acceptance Criteria:

| Test Case | Description | Verified Event Flow |
| --- | --- | --- |
| **Wrong Access Code** | Verifies connection is rejected if access code is wrong. | Emits `join_error`, disconnects. |
| **Empty Username** | Verifies connection is rejected if username is empty. | Emits `join_error`, disconnects. |
| **Two-User Join** | Verifies two users can join concurrently. | Emits `join_success`, broadcasts `user_joined` and `presence`. |
| **Message Delivery** | Verifies message is delivered with username and timestamp. | Emits `chat_message` with text, name, and time. |
| **Typing Relaying** | Verifies typing indicator is relayed to other client. | Relays `typing` event broadcast. |
| **Stop Typing Relaying** | Verifies typing indicator clears when typing stops. | Relays `stop_typing` event broadcast. |
| **Room Limit (2/2)** | Verifies a third client connection is rejected when full. | Emits `join_error` (Full), leaves first two users intact. |
| **Leave & Presence Update** | Verifies client disconnect triggers cleanup. | Broadcasts `user_left` and decreases presence count. |
