const test = require('node:test');
const assert = require('node:assert/strict');

const BASE = 'http://127.0.0.1:3098';

test('API health endpoint works', async () => {
  const res = await fetch(`${BASE}/api/health`);
  assert.equal(res.status, 200);

  const data = await res.json();
  assert.equal(data.success, true);
});

test('API registration creates a real user', async () => {
  const email = `test_${Date.now()}@suriana.test`;

  const res = await fetch(`${BASE}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'API Test User',
      email,
      password: 'test123456',
      birth_date: '1995-01-01',
      city: 'Test City',
      gender: 'ذكر'
    })
  });

  const data = await res.json();

  assert.equal(res.status, 201);
  assert.equal(data.success, true);
  assert.ok(data.token);
  assert.ok(data.user);
  assert.equal(data.user.email, email);
  assert.equal(data.user.points, 50);
  assert.equal(data.user.role, 'user');
});

test('paid message transaction updates balances and financial logs', async () => {
  const db = require('./db');
  await new Promise((resolve, reject) => {
    db.run('UPDATE users SET points=50 WHERE id=1', err => err ? reject(err) : resolve());
  });

  const tokenRes = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'test_1789920616792@suriana.test',
      password: 'test123456'
    })
  });

  const tokenData = await tokenRes.json();
  assert.equal(tokenRes.status, 200);
  assert.ok(tokenData.token);

  const res = await fetch(`${BASE}/api/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenData.token}`
    },
    body: JSON.stringify({
      receiver_id: 2,
      content: 'Automated finance test'
    })
  });

  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.success, true);
  assert.equal(data.paid, true);
  assert.equal(data.cost, 5);
  assert.equal(data.admin_profit, 4);
});

test('call creation calculates the real maximum duration from balance', async () => {
  const db = require('./db');
  await new Promise((resolve, reject) => {
    db.run('UPDATE users SET points=50 WHERE id=6', err => err ? reject(err) : resolve());
  });

  const tokenRes = await fetch(`${BASE}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'test_1789920616792@suriana.test',
      password: 'test123456'
    })
  });

  const tokenData = await tokenRes.json();
  assert.equal(tokenRes.status, 200);
  assert.ok(tokenData.token);

  const res = await fetch(`${BASE}/api/calls`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenData.token}`
    },
    body: JSON.stringify({ receiver_id: 2 })
  });

  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.success, true);
  assert.equal(data.status, 'ringing');
  assert.ok(data.call_id);
  assert.equal(data.points, 50);
  assert.equal(data.max_seconds, 120);
});

test('call end settles the real financial transaction', async () => {
  const register = async (name, email, gender) => {
    const res = await fetch(`${BASE}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        email,
        password: 'test123456',
        birth_date: '1995-01-01',
        city: 'Test City',
        gender
      })
    });
    const data = await res.json();
    assert.equal(res.status, 201);
    assert.ok(data.token);
    return { id: data.user.id, token: data.token };
  };

  const caller = await register(
    'Call End Caller',
    `call_end_caller_${Date.now()}@suriana.test`,
    'ذكر'
  );

  const receiver = await register(
    'Call End Receiver',
    `call_end_receiver_${Date.now()}@suriana.test`,
    'أنثى'
  );

  const callRes = await fetch(`${BASE}/api/calls`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${caller.token}`
    },
    body: JSON.stringify({ receiver_id: receiver.id })
  });

  const callData = await callRes.json();

  assert.equal(callRes.status, 200);
  assert.equal(callData.success, true);
  assert.equal(callData.status, 'ringing');
  assert.equal(callData.points, 50);
  assert.equal(callData.max_seconds, 120);

  const acceptRes = await fetch(`${BASE}/api/calls/${callData.call_id}/accept`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${receiver.token}`
    }
  });

  const acceptData = await acceptRes.json();

  assert.equal(acceptRes.status, 200);
  assert.equal(acceptData.success, true);
  assert.equal(acceptData.status, 'started');

  const endRes = await fetch(`${BASE}/api/calls/end`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${caller.token}`
    },
    body: JSON.stringify({ call_id: callData.call_id })
  });

  const endData = await endRes.json();

  assert.equal(endRes.status, 200);
  assert.equal(endData.success, true);
  assert.ok(endData.seconds >= 1);
  assert.ok(endData.total >= 25);
  assert.equal(endData.remaining_points, 50 - endData.total);
});
