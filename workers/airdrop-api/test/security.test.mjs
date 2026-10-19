import assert from "node:assert/strict";
import { ChallengeStore } from "../src/index.js";

class MockStorage {
  constructor() {
    this.data = new Map();
    this.lock = Promise.resolve();
  }

  async get(key) {
    return this.data.get(key);
  }

  async put(key, value) {
    this.data.set(key, value);
  }

  async delete(key) {
    return this.data.delete(key);
  }

  async transaction(callback) {
    let release;
    const previous = this.lock;

    this.lock = new Promise(resolve => {
      release = resolve;
    });

    await previous;

    try {
      return await callback({
        get: async key => this.data.get(key),
        put: async (key, value) => this.data.set(key, value),
        delete: async key => this.data.delete(key)
      });
    } finally {
      release();
    }
  }
}

function createStore() {
  const storage = new MockStorage();
  return new ChallengeStore({ storage });
}

async function post(store, payload) {
  return store.fetch(new Request("https://internal.invalid/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  }));
}

async function read(response) {
  return response.json();
}

let passed = 0;
let failed = 0;

async function test(name, callback) {
  try {
    await callback();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (error) {
    console.error(`[FAIL] ${name}: ${error?.stack || error}`);
    failed++;
  }
}

const address = "0x495f9f90a0e8980c5b1f004963d806267395273c";
const message = "HashLink Hub security test; no transaction authorized.";

async function storeChallenge(store) {
  const response = await post(store, {
    action: "put",
    value: { address, message }
  });

  assert.equal(response.status, 200);
  assert.equal((await read(response)).ok, true);
}

await test("Store and retrieve a challenge", async () => {
  const store = createStore();
  await storeChallenge(store);

  const response = await post(store, { action: "get" });
  assert.equal(response.status, 200);

  const result = await read(response);
  assert.equal(result.value.address, address);
  assert.equal(result.value.message, message);
});

await test("Reject repeated challenge consumption", async () => {
  const store = createStore();
  await storeChallenge(store);

  const first = await read(await post(store, {
    action: "consume",
    address
  }));

  const second = await read(await post(store, {
    action: "consume",
    address
  }));

  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
});

await test("Only one concurrent consumer succeeds", async () => {
  const store = createStore();
  await storeChallenge(store);

  const results = await Promise.all([
    post(store, { action: "consume", address }),
    post(store, { action: "consume", address })
  ]);

  const values = await Promise.all(results.map(read));
  assert.equal(values.filter(value => value.ok === true).length, 1);
  assert.equal(values.filter(value => value.ok === false).length, 1);
});

await test("Reject an expired challenge", async () => {
  const store = createStore();
  const originalNow = Date.now;
  let fakeNow = originalNow();

  try {
    Date.now = () => fakeNow;
    await storeChallenge(store);

    fakeNow += 300001;

    const getResult = await read(await post(store, {
      action: "get"
    }));

    assert.equal(getResult.value, null);

    const consumeResult = await read(await post(store, {
      action: "consume",
      address
    }));

    assert.equal(consumeResult.ok, false);
  } finally {
    Date.now = originalNow;
  }
});

await test("Enforce the rate limit", async () => {
  const store = createStore();

  const first = await read(await post(store, {
    action: "rate",
    limit: 2,
    windowMs: 60000
  }));

  const second = await read(await post(store, {
    action: "rate",
    limit: 2,
    windowMs: 60000
  }));

  const third = await read(await post(store, {
    action: "rate",
    limit: 2,
    windowMs: 60000
  }));

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);
});

await test("Reject unsupported HTTP methods", async () => {
  const store = createStore();

  const response = await store.fetch(
    new Request("https://internal.invalid/", { method: "GET" })
  );

  assert.equal(response.status, 405);
});

console.log(`\nSecurity tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exitCode = 1;
