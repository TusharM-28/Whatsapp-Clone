const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { startServer, stopServer } = require('../server');
const { connectAndJoin, cleanupSockets, waitForEvent } = require('./helpers');
const { io: ioClient } = require('socket.io-client');

describe('Tier 2: Boundary & Corner Cases (35 E2E Tests)', () => {
  let port;
  let serverInstance;

  beforeEach(async () => {
    serverInstance = await startServer(0);
    port = serverInstance.address().port;
  });

  afterEach(async () => {
    cleanupSockets();
    await stopServer();
  });

  // ==========================================
  // Feature 1: Access Control (Authentication)
  // ==========================================

  test('Feature 1 - Auth: 2.1 Access Code with Leading/Trailing Spaces', async () => {
    await assert.rejects(
      connectAndJoin(port, 'Alice', '  letmein  '),
      /Wrong access code\./
    );
  });

  test('Feature 1 - Auth: 2.2 Case Sensitivity in Access Code', async () => {
    await assert.rejects(
      connectAndJoin(port, 'Alice', 'LetMeIn'),
      /Wrong access code\./
    );
  });

  test('Feature 1 - Auth: 2.3 Extremely Long Access Code', async () => {
    const longCode = 'A'.repeat(500);
    await assert.rejects(
      connectAndJoin(port, 'Alice', longCode),
      /Wrong access code\./
    );
  });

  test('Feature 1 - Auth: 2.4 Missing Auth Payload Entirely', async () => {
    await assert.rejects(
      connectAndJoin(port, undefined, undefined),
      /Wrong access code\./
    );
  });

  test('Feature 1 - Auth: 2.5 Authentication Failure Priority when Room is Full', async () => {
    await connectAndJoin(port, 'Alice', 'letmein');
    await connectAndJoin(port, 'Bob', 'letmein');

    // Charlie connects with wrong access code.
    // The access code check must execute and fail before room occupancy check.
    // Therefore, Charlie must get "Wrong access code.", NOT "Chat is full...".
    await assert.rejects(
      connectAndJoin(port, 'Charlie', 'wrongcode'),
      /Wrong access code\./
    );
  });

  // ==========================================
  // Feature 2: Username Validation
  // ==========================================

  test('Feature 2 - Username: 2.6 Username Greater than 20 Characters Truncation', async () => {
    const client = await connectAndJoin(port, 'AliceVeryLongNameMoreThan20Chars', 'letmein');
    assert.strictEqual(client.data.username, 'AliceVeryLongNameMor');
    assert.strictEqual(client.data.username.length, 20);
  });

  test('Feature 2 - Username: 2.7 Username with Special Characters and Emojis', async () => {
    const client = await connectAndJoin(port, 'Alice 🦄 ✨', 'letmein');
    assert.strictEqual(client.data.username, 'Alice 🦄 ✨');
  });

  test('Feature 2 - Username: 2.8 HTML/Script Injection Payload Username', async () => {
    const client = await connectAndJoin(port, '<script>alert(1)</script>', 'letmein');
    assert.strictEqual(client.data.username, '<script>alert(1)</sc');
  });

  test('Feature 2 - Username: 2.9 Non-String Username Types', async () => {
    await assert.rejects(
      connectAndJoin(port, 12345, 'letmein'),
      /Username is required\./
    );
  });

  test('Feature 2 - Username: 2.10 Null or Undefined Username', async () => {
    await assert.rejects(
      connectAndJoin(port, null, 'letmein'),
      /Username is required\./
    );
  });

  // ==========================================
  // Feature 3: Room Capacity Control
  // ==========================================

  test('Feature 3 - Room Capacity: 3.6 Third Client Join Validation Failure Priority', async () => {
    await connectAndJoin(port, 'Alice', 'letmein');
    await connectAndJoin(port, 'Bob', 'letmein');

    // Charlie joins with empty username.
    // Input validation check must fail first, so he gets "Username is required."
    await assert.rejects(
      connectAndJoin(port, '', 'letmein'),
      /Username is required\./
    );
  });

  test('Feature 3 - Room Capacity: 3.7 Abrupt TCP Disconnect (Freed Slot)', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    await connectAndJoin(port, 'Bob', 'letmein');

    // Force destroy socket to simulate abrupt connection drop
    if (client1.socket.destroy) {
      client1.socket.destroy();
    } else {
      client1.socket.io.engine.close();
    }

    // Wait a brief moment for server to process disconnect
    await new Promise(resolve => setTimeout(resolve, 200));

    // Charlie should be able to join
    const client3 = await connectAndJoin(port, 'Charlie', 'letmein');
    assert.strictEqual(client3.socket.connected, true);
  });

  test('Feature 3 - Room Capacity: 3.8 Simultaneous Race Condition Joins', async () => {
    await connectAndJoin(port, 'Alice', 'letmein');

    // Bob and Charlie join at the same time
    const results = await Promise.allSettled([
      connectAndJoin(port, 'Bob', 'letmein'),
      connectAndJoin(port, 'Charlie', 'letmein')
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    assert.strictEqual(fulfilled.length, 1);
    assert.strictEqual(rejected.length, 1);
    assert.match(rejected[0].reason.message, /Chat is full/);
  });

  test('Feature 3 - Room Capacity: 3.9 Double-Join from Same Client Socket', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    await connectAndJoin(port, 'Bob', 'letmein');

    // Alice attempts another concurrent connection (no takeover)
    await assert.rejects(
      connectAndJoin(port, 'Alice', 'letmein'),
      /Chat is full/
    );
    assert.strictEqual(client1.socket.connected, true);
  });

  test('Feature 3 - Room Capacity: 3.10 Third User Rejection and First Two Intact', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    const client2 = await connectAndJoin(port, 'Bob', 'letmein');

    await assert.rejects(
      connectAndJoin(port, 'Charlie', 'letmein'),
      /Chat is full/
    );

    const msgPromise = waitForEvent(client2.socket, 'chat_message');
    client1.socket.emit('chat_message', 'Still here');
    const msg = await msgPromise;
    assert.strictEqual(msg.text, 'Still here');
  });

  // ==========================================
  // Feature 4: Presence Tracking
  // ==========================================

  test('Feature 4 - Presence: 4.6 Presence for Rejected Clients Check', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    const bobPresencePromise = waitForEvent(client1.socket, 'presence');
    await connectAndJoin(port, 'Bob', 'letmein');
    await bobPresencePromise;

    let presenceCount = 0;
    client1.socket.on('presence', () => {
      presenceCount++;
    });

    // Attempt invalid connection
    await assert.rejects(
      connectAndJoin(port, 'Charlie', 'wrongcode')
    );

    await new Promise(resolve => setTimeout(resolve, 150));
    assert.strictEqual(presenceCount, 0);
  });

  test('Feature 4 - Presence: 4.7 Disconnected Client Receives No Events', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    const client2 = await connectAndJoin(port, 'Bob', 'letmein');

    let messageReceived = false;
    client1.socket.on('chat_message', () => {
      messageReceived = true;
    });

    client1.socket.disconnect();
    // Wait for disconnect to register
    await new Promise(resolve => setTimeout(resolve, 100));

    client2.socket.emit('chat_message', 'Hello');
    await new Promise(resolve => setTimeout(resolve, 200));

    assert.strictEqual(messageReceived, false);
  });

  test('Feature 4 - Presence: 4.8 Presence with Identical Usernames', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');

    const client2 = await connectAndJoin(port, 'Alice', 'letmein');
    assert.strictEqual(client2.socket.connected, true);
    assert.strictEqual(client1.socket.connected, true);
  });

  test('Feature 4 - Presence: 4.9 Presence Cleanup after Server Instability', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    client1.socket.disconnect();
    await new Promise(resolve => setTimeout(resolve, 100));

    const client2 = await connectAndJoin(port, 'Bob', 'letmein');
    const presencePromise = waitForEvent(client2.socket, 'presence');
    client2.socket.emit('chat_message', 'ping'); // trigger event loop
    const presenceData = await presencePromise;

    assert.strictEqual(presenceData.online, 1);
    assert.deepStrictEqual(presenceData.users, ['Bob']);
  });

  test('Feature 4 - Presence: 4.10 Presence List Truncated Usernames', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    const presencePromise = waitForEvent(client1.socket, 'presence');

    await connectAndJoin(port, 'BobVeryLongNameMoreThan20Chars', 'letmein');
    const presenceData = await presencePromise;

    assert.strictEqual(presenceData.online, 2);
    assert.deepStrictEqual(presenceData.users, ['Alice', 'BobVeryLongNameMoreT']);
  });

  // ==========================================
  // Feature 5: Real-time Message Delivery
  // ==========================================

  test('Feature 5 - Messaging: 5.6 Empty Chat Message Server Rejection', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    const client2 = await connectAndJoin(port, 'Bob', 'letmein');

    let messageReceived = false;
    client2.socket.on('chat_message', () => {
      messageReceived = true;
    });

    client1.socket.emit('chat_message', '');
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.strictEqual(messageReceived, false);
  });

  test('Feature 5 - Messaging: 5.7 Whitespace-Only Message Rejection', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    const client2 = await connectAndJoin(port, 'Bob', 'letmein');

    let messageReceived = false;
    client2.socket.on('chat_message', () => {
      messageReceived = true;
    });

    client1.socket.emit('chat_message', '     ');
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.strictEqual(messageReceived, false);
  });

  test('Feature 5 - Messaging: 5.8 Non-String Message Payload Rejection', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    const client2 = await connectAndJoin(port, 'Bob', 'letmein');

    let messageReceived = false;
    client2.socket.on('chat_message', () => {
      messageReceived = true;
    });

    client1.socket.emit('chat_message', { text: 'hello' });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.strictEqual(messageReceived, false);
  });

  test('Feature 5 - Messaging: 5.9 Message Truncation at 1000 Characters', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    const client2 = await connectAndJoin(port, 'Bob', 'letmein');
    const msgPromise = waitForEvent(client2.socket, 'chat_message');

    const longMessage = 'A'.repeat(1200);
    client1.socket.emit('chat_message', longMessage);

    const msg = await msgPromise;
    assert.strictEqual(msg.text.length, 1000);
    assert.strictEqual(msg.text, 'A'.repeat(1000));
  });

  test('Feature 5 - Messaging: 5.10 Message Containing Script Injection', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    const client2 = await connectAndJoin(port, 'Bob', 'letmein');
    const msgPromise = waitForEvent(client2.socket, 'chat_message');

    const injectionPayload = '<img src=x onerror=alert(1)>';
    client1.socket.emit('chat_message', injectionPayload);

    const msg = await msgPromise;
    assert.strictEqual(msg.text, injectionPayload);
  });

  // ==========================================
  // Feature 6: Typing Status Relaying
  // ==========================================

  test('Feature 6 - Typing: 6.6 Typing Status from Unauthenticated Socket', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    
    let receivedTyping = false;
    client1.socket.on('typing', () => {
      receivedTyping = true;
    });

    // Connect raw socket client with wrong access code
    const rawSocket = ioClient(`http://localhost:${port}`, {
      auth: { username: 'Bob', accessCode: 'wrong_code' },
      transports: ['websocket'],
      forceNew: true
    });

    rawSocket.emit('typing');
    await new Promise(resolve => setTimeout(resolve, 200));

    assert.strictEqual(receivedTyping, false);
    rawSocket.disconnect();
  });

  test('Feature 6 - Typing: 6.7 Stop Typing without Typing First', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    const client2 = await connectAndJoin(port, 'Bob', 'letmein');

    const stopTypingPromise = waitForEvent(client2.socket, 'stop_typing');
    client1.socket.emit('stop_typing');

    const data = await stopTypingPromise;
    assert.strictEqual(data.username, 'Alice');
  });

  test('Feature 6 - Typing: 6.8 Rapid Interleaved Typing Toggles', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    const client2 = await connectAndJoin(port, 'Bob', 'letmein');

    const events = [];
    client2.socket.on('typing', (d) => events.push({ type: 'typing', username: d.username }));
    client2.socket.on('stop_typing', (d) => events.push({ type: 'stop_typing', username: d.username }));

    client1.socket.emit('typing');
    client1.socket.emit('stop_typing');
    client1.socket.emit('typing');
    client1.socket.emit('stop_typing');

    await new Promise(resolve => setTimeout(resolve, 300));
    assert.deepStrictEqual(events, [
      { type: 'typing', username: 'Alice' },
      { type: 'stop_typing', username: 'Alice' },
      { type: 'typing', username: 'Alice' },
      { type: 'stop_typing', username: 'Alice' }
    ]);
  });

  test('Feature 6 - Typing: 6.9 Typing Cleanup on Disconnect', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    const client2 = await connectAndJoin(port, 'Bob', 'letmein');

    const leftPromise = waitForEvent(client2.socket, 'user_left');
    client1.socket.emit('typing');
    client1.socket.disconnect();

    const leftData = await leftPromise;
    assert.strictEqual(leftData.username, 'Alice');
  });

  test('Feature 6 - Typing: 6.10 Malicious Username Payload in Typing Event', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    const client2 = await connectAndJoin(port, 'Bob', 'letmein');

    const typingPromise = waitForEvent(client2.socket, 'typing');
    client1.socket.emit('typing', { username: 'Hacker' });

    const data = await typingPromise;
    assert.strictEqual(data.username, 'Alice');
  });

  // ==========================================
  // Feature 7: Connection Status & Lifecycle
  // ==========================================

  test('Feature 7 - Lifecycle: 7.6 Reconnection under Different Username', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    client1.socket.disconnect();
    await new Promise(resolve => setTimeout(resolve, 100));

    const client2 = await connectAndJoin(port, 'Bob', 'letmein');
    const presencePromise = waitForEvent(client2.socket, 'presence');
    client2.socket.emit('chat_message', 'ping'); // trigger event loop
    const data = await presencePromise;

    assert.strictEqual(data.online, 1);
    assert.deepStrictEqual(data.users, ['Bob']);
  });

  test('Feature 7 - Lifecycle: 7.7 Auto-Reconnect State Verification', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    const client2 = await connectAndJoin(port, 'Bob', 'letmein');

    const disconnectPromise1 = waitForEvent(client1.socket, 'disconnect');
    const disconnectPromise2 = waitForEvent(client2.socket, 'disconnect');

    await stopServer();

    await disconnectPromise1;
    await disconnectPromise2;

    // Register connect and join_success promises before starting the server
    const connectPromise1 = waitForEvent(client1.socket, 'connect', 5000);
    const connectPromise2 = waitForEvent(client2.socket, 'connect', 5000);
    const joinSuccessPromise1 = waitForEvent(client1.socket, 'join_success', 5000);
    const joinSuccessPromise2 = waitForEvent(client2.socket, 'join_success', 5000);

    await startServer(port);

    await connectPromise1;
    await connectPromise2;
    await joinSuccessPromise1;
    await joinSuccessPromise2;

    assert.strictEqual(client1.socket.connected, true);
    assert.strictEqual(client2.socket.connected, true);
  });

  test('Feature 7 - Lifecycle: 7.8 Server-Side Disconnect Eviction', async () => {
    const { io: serverIo } = require('../server');
    const client = await connectAndJoin(port, 'Alice', 'letmein');

    const serverSockets = Array.from(serverIo.sockets.sockets.values());
    const serverSocket = serverSockets.find(s => s.id === client.socket.id);
    assert.ok(serverSocket);

    const clientDisconnectPromise = waitForEvent(client.socket, 'disconnect');
    serverSocket.disconnect(true);
    await clientDisconnectPromise;
    assert.strictEqual(client.socket.connected, false);
  });

  test('Feature 7 - Lifecycle: 7.9 Forced WebSocket Transport Enforcement', async () => {
    const rawSocket = ioClient(`http://localhost:${port}`, {
      auth: { username: 'Alice', accessCode: 'letmein' },
      transports: ['polling'],
      forceNew: true
    });

    await new Promise((resolve, reject) => {
      rawSocket.on('connect', () => {
        rawSocket.disconnect();
        resolve();
      });
      rawSocket.on('connect_error', (err) => {
        rawSocket.disconnect();
        reject(err);
      });
    });
  });

  test('Feature 7 - Lifecycle: 7.10 Graceful Error Handling of Malformed Socket Packets', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    
    // Emit invalid / malformed event
    client1.socket.emit('invalid_event_type_name_xyz', { malformed: true });

    // Verify server did not crash by successfully connecting Bob
    const client2 = await connectAndJoin(port, 'Bob', 'letmein');
    assert.strictEqual(client2.socket.connected, true);
  });
});
