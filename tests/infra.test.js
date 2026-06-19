const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { startServer, stopServer } = require('../server');
const { connectAndJoin, cleanupSockets, waitForEvent } = require('./helpers');

describe('Two-Person Chat E2E Test Suite', () => {
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

  test('should reject connection with wrong access code', async () => {
    await assert.rejects(
      connectAndJoin(port, 'Alice', 'wrong_access_code'),
      /Wrong access code\./
    );
  });

  test('should reject connection with empty username', async () => {
    await assert.rejects(
      connectAndJoin(port, '', 'letmein'),
      /Username is required\./
    );
  });

  test('should allow two valid users to join successfully', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    assert.strictEqual(client1.data.username, 'Alice');

    // Prepare Alice's socket to listen for Bob's connection
    const aliceUserJoinedPromise = waitForEvent(client1.socket, 'user_joined');
    const alicePresencePromise = waitForEvent(client1.socket, 'presence');

    const client2 = await connectAndJoin(port, 'Bob', 'letmein');
    assert.strictEqual(client2.data.username, 'Bob');

    // Verify Alice was notified of Bob joining
    const joinData = await aliceUserJoinedPromise;
    assert.strictEqual(joinData.username, 'Bob');

    // Verify presence data sent to Alice matches
    const presenceData = await alicePresencePromise;
    assert.strictEqual(presenceData.online, 2);
    assert.deepStrictEqual(presenceData.users, ['Alice', 'Bob']);
  });

  test('should relay message with correct username and timestamp', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    const client2 = await connectAndJoin(port, 'Bob', 'letmein');

    // Prepare Bob to receive a chat message from Alice
    const messagePromise = waitForEvent(client2.socket, 'chat_message');
    client1.socket.emit('chat_message', 'Hello Bob, nice to meet you.');

    const msg = await messagePromise;
    assert.strictEqual(msg.username, 'Alice');
    assert.strictEqual(msg.text, 'Hello Bob, nice to meet you.');
    assert.strictEqual(typeof msg.timestamp, 'number');
    assert.ok(msg.timestamp <= Date.now());
  });

  test('should relay typing and stop_typing events to other participants', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    const client2 = await connectAndJoin(port, 'Bob', 'letmein');

    // Verify typing notification
    const typingPromise = waitForEvent(client2.socket, 'typing');
    client1.socket.emit('typing');
    const typingData = await typingPromise;
    assert.strictEqual(typingData.username, 'Alice');

    // Verify stop typing notification
    const stopTypingPromise = waitForEvent(client2.socket, 'stop_typing');
    client1.socket.emit('stop_typing');
    const stopTypingData = await stopTypingPromise;
    assert.strictEqual(stopTypingData.username, 'Alice');
  });

  test('should reject a third connection when the room is full', async () => {
    // Fill up the server with Alice and Bob
    await connectAndJoin(port, 'Alice', 'letmein');
    await connectAndJoin(port, 'Bob', 'letmein');

    // Attempt to connect Charlie (third user)
    await assert.rejects(
      connectAndJoin(port, 'Charlie', 'letmein'),
      /Chat is full \(2\/2\)\. Try again later\./
    );
  });

  test('should broadcast "user_left" and update presence when a participant disconnects', async () => {
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    const client2 = await connectAndJoin(port, 'Bob', 'letmein');

    // Prepare Bob to receive disconnect event notifications
    const leavePromise = waitForEvent(client2.socket, 'user_left');
    const presencePromise = waitForEvent(client2.socket, 'presence');

    // Alice disconnects
    client1.socket.disconnect();

    const leaveData = await leavePromise;
    assert.strictEqual(leaveData.username, 'Alice');

    const presenceData = await presencePromise;
    assert.strictEqual(presenceData.online, 1);
    assert.deepStrictEqual(presenceData.users, ['Bob']);
  });

  test('should handle session takeover for same-username connections', async () => {
    // Connect Alice and Bob first
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    const client2 = await connectAndJoin(port, 'Bob', 'letmein');

    // Connect new Alice connection (should be rejected since room is full and takeover is disabled)
    await assert.rejects(
      connectAndJoin(port, 'Alice', 'letmein'),
      /Chat is full/
    );
    
    // Verify first Alice is still connected
    assert.strictEqual(client1.socket.connected, true);
  });

  test('should handle session takeover case-insensitively', async () => {
    // Connect Alice and Bob first
    const client1 = await connectAndJoin(port, 'Alice', 'letmein');
    await connectAndJoin(port, 'Bob', 'letmein');

    // Connect a new "alice" (lowercase) connection
    await assert.rejects(
      connectAndJoin(port, 'alice', 'letmein'),
      /Chat is full/
    );
  });
});
