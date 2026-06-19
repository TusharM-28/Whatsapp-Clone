const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { startServer, stopServer } = require('../server');
const { connectAndJoin, cleanupSockets, waitForEvent } = require('./helpers');

describe('Tier 1: Feature Coverage (35 E2E Tests)', () => {
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

  test('Feature 1 - Auth: 1.1 Valid Access Code Connection', async () => {
    const client = await connectAndJoin(port, 'Alice', 'letmein');
    assert.strictEqual(client.socket.connected, true);
    assert.strictEqual(client.data.username, 'Alice');
  });

  test('Feature 1 - Auth: 1.2 Invalid Access Code Rejection', async () => {
    await assert.rejects(
      connectAndJoin(port, 'Alice', 'wrongcode'),
      /Wrong access code\./
    );
  });

  test('Feature 1 - Auth: 1.3 Empty Access Code Rejection', async () => {
    await assert.rejects(
      connectAndJoin(port, 'Alice', ''),
      /Wrong access code\./
    );
  });

  test('Feature 1 - Auth: 1.4 Sequential Valid Connections', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    assert.strictEqual(client1.socket.connected, true);

    const client2 = await connectAndJoin(port, 'Bob', 'letmein');
    assert.strictEqual(client2.socket.connected, true);
  });

  test('Feature 1 - Auth: 1.5 Recovery After Invalid Code Attempt', async () => {
    await assert.rejects(
      connectAndJoin(port, 'Alice', 'wrongcode'),
      /Wrong access code\./
    );

    const client = await connectAndJoin(port, 'Alice', 'letmein');
    assert.strictEqual(client.socket.connected, true);
  });

  // ==========================================
  // Feature 2: Username Validation
  // ==========================================

  test('Feature 2 - Username: 2.1 Standard Username Join', async () => {
    const client = await connectAndJoin(port, 'Alice', 'letmein');
    assert.strictEqual(client.data.username, 'Alice');
  });

  test('Feature 2 - Username: 2.2 Empty Username Rejection', async () => {
    await assert.rejects(
      connectAndJoin(port, '', 'letmein'),
      /Username is required\./
    );
  });

  test('Feature 2 - Username: 2.3 Whitespace-Only Username Rejection', async () => {
    await assert.rejects(
      connectAndJoin(port, '   ', 'letmein'),
      /Username is required\./
    );
  });

  test('Feature 2 - Username: 2.4 Username Trimming', async () => {
    const client = await connectAndJoin(port, '  Alice  ', 'letmein');
    assert.strictEqual(client.data.username, 'Alice');
  });

  test('Feature 2 - Username: 2.5 Username Maximum Length Match', async () => {
    const client = await connectAndJoin(port, '12345678901234567890', 'letmein');
    assert.strictEqual(client.data.username, '12345678901234567890');
    assert.strictEqual(client.data.username.length, 20);
  });

  // ==========================================
  // Feature 3: Room Capacity Control
  // ==========================================

  test('Feature 3 - Room Capacity: 3.1 Single User Join Room State', async () => {
    const client = await connectAndJoin(port, 'Alice', 'letmein');
    assert.strictEqual(client.socket.connected, true);
  });

  test('Feature 3 - Room Capacity: 3.2 Two User Join Room State', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    const client2 = await connectAndJoin(port, 'Bob', 'letmein');
    assert.strictEqual(client1.socket.connected, true);
    assert.strictEqual(client2.socket.connected, true);
  });

  test('Feature 3 - Room Capacity: 3.3 Third User Rejection', async () => {
    await connectAndJoin(port, 'Alice', 'letmein');
    await connectAndJoin(port, 'Bob', 'letmein');
    await assert.rejects(
      connectAndJoin(port, 'Charlie', 'letmein'),
      /Chat is full \(2\/2\)\. Try again later\./
    );
  });

  test('Feature 3 - Room Capacity: 3.4 Slot Re-opening on Normal Leave', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    await connectAndJoin(port, 'Bob', 'letmein');

    // Alice leaves
    client1.socket.disconnect();

    // Now Charlie should be able to join
    const client3 = await connectAndJoin(port, 'Charlie', 'letmein');
    assert.strictEqual(client3.socket.connected, true);
    assert.strictEqual(client3.data.username, 'Charlie');
  });

  test('Feature 3 - Room Capacity: 3.5 Full Re-opening on Both Leaving', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    const client2 = await connectAndJoin(port, 'Bob', 'letmein');

    client1.socket.disconnect();
    client2.socket.disconnect();

    const client3 = await connectAndJoin(port, 'Charlie', 'letmein');
    const client4 = await connectAndJoin(port, 'Dave', 'letmein');
    assert.strictEqual(client3.socket.connected, true);
    assert.strictEqual(client4.socket.connected, true);
  });

  // ==========================================
  // Feature 4: Presence Tracking
  // ==========================================

  test('Feature 4 - Presence: 4.1 Initial User Presence Update', async () => {
    const client = await connectAndJoin(port, 'Alice', 'letmein');
    const presenceData = await waitForEvent(client.socket, 'presence');
    assert.strictEqual(presenceData.online, 1);
    assert.deepStrictEqual(presenceData.users, ['Alice']);
  });

  test('Feature 4 - Presence: 4.2 Second User Join Presence Update', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    const presencePromise = waitForEvent(client1.socket, 'presence');

    await connectAndJoin(port, 'Bob', 'letmein');
    const presenceData = await presencePromise;
    assert.strictEqual(presenceData.online, 2);
    assert.deepStrictEqual(presenceData.users, ['Alice', 'Bob']);
  });

  test('Feature 4 - Presence: 4.3 User Joined Notification Relaying', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    const joinedPromise = waitForEvent(client1.socket, 'user_joined');

    await connectAndJoin(port, 'Bob', 'letmein');
    const joinedData = await joinedPromise;
    assert.strictEqual(joinedData.username, 'Bob');
  });

  test('Feature 4 - Presence: 4.4 User Left Notification Relaying', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    const client2 = await connectAndJoin(port, 'Bob', 'letmein');
    const leftPromise = waitForEvent(client2.socket, 'user_left');

    client1.socket.disconnect();
    const leftData = await leftPromise;
    assert.strictEqual(leftData.username, 'Alice');
  });

  test('Feature 4 - Presence: 4.5 Leave Presence Update', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    const client2 = await connectAndJoin(port, 'Bob', 'letmein');
    const presencePromise = waitForEvent(client2.socket, 'presence');

    client1.socket.disconnect();
    const presenceData = await presencePromise;
    assert.strictEqual(presenceData.online, 1);
    assert.deepStrictEqual(presenceData.users, ['Bob']);
  });

  // ==========================================
  // Feature 5: Real-time Message Delivery
  // ==========================================

  test('Feature 5 - Messaging: 5.1 Standard Message Relaying', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    const client2 = await connectAndJoin(port, 'Bob', 'letmein');
    const messagePromise = waitForEvent(client2.socket, 'chat_message');

    client1.socket.emit('chat_message', 'Hello');
    const msg = await messagePromise;
    assert.strictEqual(msg.username, 'Alice');
    assert.strictEqual(msg.text, 'Hello');
  });

  test('Feature 5 - Messaging: 5.2 Message Sender ID Verification', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    const client2 = await connectAndJoin(port, 'Bob', 'letmein');
    const messagePromise = waitForEvent(client2.socket, 'chat_message');

    client1.socket.emit('chat_message', 'Test');
    const msg = await messagePromise;
    assert.strictEqual(msg.id, client1.socket.id);
  });

  test('Feature 5 - Messaging: 5.3 Message Timestamp Verification', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    const client2 = await connectAndJoin(port, 'Bob', 'letmein');
    const messagePromise = waitForEvent(client2.socket, 'chat_message');

    client1.socket.emit('chat_message', 'Time');
    const msg = await messagePromise;
    assert.strictEqual(typeof msg.timestamp, 'number');
    assert.ok(msg.timestamp <= Date.now());
  });

  test('Feature 5 - Messaging: 5.4 Message Text Trimming', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    const client2 = await connectAndJoin(port, 'Bob', 'letmein');
    const messagePromise = waitForEvent(client2.socket, 'chat_message');

    client1.socket.emit('chat_message', '   Spaced message   ');
    const msg = await messagePromise;
    assert.strictEqual(msg.text, 'Spaced message');
  });

  test('Feature 5 - Messaging: 5.5 Self-Message Delivery', async () => {
    const client = await connectAndJoin(port, 'Alice', 'letmein');
    const messagePromise = waitForEvent(client.socket, 'chat_message');

    client.socket.emit('chat_message', 'Self');
    const msg = await messagePromise;
    assert.strictEqual(msg.username, 'Alice');
    assert.strictEqual(msg.text, 'Self');
  });

  // ==========================================
  // Feature 6: Typing Status Relaying
  // ==========================================

  test('Feature 6 - Typing: 6.1 Typing Notification Broadcast', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    const client2 = await connectAndJoin(port, 'Bob', 'letmein');
    const typingPromise = waitForEvent(client2.socket, 'typing');

    client1.socket.emit('typing');
    const data = await typingPromise;
    assert.strictEqual(data.username, 'Alice');
  });

  test('Feature 6 - Typing: 6.2 Stop Typing Notification Broadcast', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    const client2 = await connectAndJoin(port, 'Bob', 'letmein');
    const stopTypingPromise = waitForEvent(client2.socket, 'stop_typing');

    client1.socket.emit('stop_typing');
    const data = await stopTypingPromise;
    assert.strictEqual(data.username, 'Alice');
  });

  test('Feature 6 - Typing: 6.3 Typing Broadcast Exclusion', async () => {
    const client = await connectAndJoin(port, 'Alice', 'letmein');
    let receivedSelfTyping = false;

    client.socket.on('typing', () => {
      receivedSelfTyping = true;
    });

    client.socket.emit('typing');
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.strictEqual(receivedSelfTyping, false);
  });

  test('Feature 6 - Typing: 6.4 Stop Typing Broadcast Exclusion', async () => {
    const client = await connectAndJoin(port, 'Alice', 'letmein');
    let receivedSelfStopTyping = false;

    client.socket.on('stop_typing', () => {
      receivedSelfStopTyping = true;
    });

    client.socket.emit('stop_typing');
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.strictEqual(receivedSelfStopTyping, false);
  });

  test('Feature 6 - Typing: 6.5 Typing State Interleaving', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    const client2 = await connectAndJoin(port, 'Bob', 'letmein');

    const typingPromise1 = waitForEvent(client2.socket, 'typing');
    client1.socket.emit('typing');
    const data1 = await typingPromise1;
    assert.strictEqual(data1.username, 'Alice');

    const typingPromise2 = waitForEvent(client1.socket, 'typing');
    client2.socket.emit('typing');
    const data2 = await typingPromise2;
    assert.strictEqual(data2.username, 'Bob');
  });

  // ==========================================
  // Feature 7: Connection Status & Lifecycle
  // ==========================================

  test('Feature 7 - Lifecycle: 7.1 Deliberate Disconnect State', async () => {
    const client = await connectAndJoin(port, 'Alice', 'letmein');
    assert.strictEqual(client.socket.connected, true);
    client.socket.disconnect();
    assert.strictEqual(client.socket.connected, false);
  });

  test('Feature 7 - Lifecycle: 7.2 Clean Server Shutdown', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    const client2 = await connectAndJoin(port, 'Bob', 'letmein');

    const disconnectPromise1 = waitForEvent(client1.socket, 'disconnect');
    const disconnectPromise2 = waitForEvent(client2.socket, 'disconnect');

    await stopServer();

    await disconnectPromise1;
    await disconnectPromise2;

    assert.strictEqual(client1.socket.connected, false);
    assert.strictEqual(client2.socket.connected, false);
  });

  test('Feature 7 - Lifecycle: 7.3 Ping/Pong Heartbeat Retention', async () => {
    const client = await connectAndJoin(port, 'Alice', 'letmein');
    await new Promise(resolve => setTimeout(resolve, 1000));
    assert.strictEqual(client.socket.connected, true);
  });

  test('Feature 7 - Lifecycle: 7.4 Multiple Sequential Connections/Disconnects', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    client1.socket.disconnect();

    const client2 = await connectAndJoin(port, 'Alice', 'letmein');
    client2.socket.disconnect();
  });

  test('Feature 7 - Lifecycle: 7.5 Presence Sync on Reconnection', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    const client2 = await connectAndJoin(port, 'Bob', 'letmein');

    const leftPromise = waitForEvent(client2.socket, 'user_left');
    client1.socket.disconnect();
    await leftPromise;

    const presencePromise = waitForEvent(client2.socket, 'presence');
    const client1Rejoin = await connectAndJoin(port, 'Alice', 'letmein');
    const data = await presencePromise;

    assert.strictEqual(data.online, 2);
    assert.deepStrictEqual(data.users.sort(), ['Alice', 'Bob'].sort());
    assert.strictEqual(client1Rejoin.socket.connected, true);
  });
});
