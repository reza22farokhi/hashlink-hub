import assert from "node:assert/strict";
import { ChallengeStore } from "../src/index.js";

const address = "0x0000000000000000000000000000000000000001";
const message = "HashLink challenge cleanup test";

class AlarmStorage {
  data = new Map();
  alarmTime = null;

  async get(key) {
    return this.data.get(key);
  }

  async put(key, value) {
    this.data.set(key, structuredClone(value));
  }

  async delete(key) {
    return this.data.delete(key);
  }

  async setAlarm(timestamp) {
    this.alarmTime = timestamp;
  }

  async deleteAlarm() {
    this.alarmTime = null;
  }

  async getAlarm() {
    return this.alarmTime;
  }

  async transaction(callback) {
    return callback(this);
  }
}

function post(store, payload) {
  return store.fetch(new Request("https://internal.invalid/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  }));
}

const storage = new AlarmStorage();
const store = new ChallengeStore({ storage });

const originalNow = Date.now;
let now = originalNow();

try {
  Date.now = () => now;

  const putResponse = await post(store, {
    action: "put",
    value: { address, message }
  });

  assert.equal(putResponse.status, 200);

  const saved = await storage.get("challenge");

  assert.equal(saved.address, address);
  assert.equal(saved.expiresAt, now + 300000);
  assert.equal(await storage.getAlarm(), now + 300000);

  console.log("[PASS] Challenge stores its expiration timestamp");
  console.log("[PASS] Alarm is scheduled for the expiration time");

  now += 300001;

  await store.alarm();

  assert.equal(await storage.get("challenge"), undefined);

  console.log("[PASS] Alarm automatically removes an abandoned challenge");

  const secondNow = now;

  await post(store, {
    action: "put",
    value: { address, message }
  });

  now = secondNow + 300001;

  const getResponse = await post(store, { action: "get" });
  assert.deepEqual(await getResponse.json(), { value: null });
  assert.equal(await storage.get("challenge"), undefined);

  console.log("[PASS] GET removes an expired challenge");

  await post(store, {
    action: "put",
    value: { address, message }
  });

  now += 300001;

  const consumeResponse = await post(store, {
    action: "consume",
    address
  });

  assert.deepEqual(await consumeResponse.json(), { ok: false });
  assert.equal(await storage.get("challenge"), undefined);

  console.log("[PASS] CONSUME rejects and deletes an expired challenge");
} finally {
  Date.now = originalNow;
}

console.log("ALL CHALLENGE ALARM TESTS PASSED");
