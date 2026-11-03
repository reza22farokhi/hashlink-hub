import assert from "node:assert/strict";
import { ChallengeStore } from "../src/index.js";

const address = "0x0000000000000000000000000000000000000001";

class FailingTransactionStorage {
  data = new Map();

  async get(key) {
    return this.data.get(key);
  }

  async put(key, value) {
    this.data.set(key, structuredClone(value));
  }

  async delete(key) {
    return this.data.delete(key);
  }

  async transaction(_callback) {
    throw new Error("simulated_consume_storage_failure");
  }
}

const storage = new FailingTransactionStorage();
const store = new ChallengeStore({ storage });

// Seed a valid, unexpired challenge without using a transaction.
await storage.put("challenge", {
  address,
  message: "test-only challenge",
  createdAt: Date.now()
});

const request = new Request("https://internal.invalid/", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    action: "consume",
    address
  })
});

await assert.rejects(
  () => store.fetch(request),
  /simulated_consume_storage_failure/
);

console.log("[PASS] consume storage transaction failure propagates");
console.log("[PASS] No successful consume response is returned on storage failure");
