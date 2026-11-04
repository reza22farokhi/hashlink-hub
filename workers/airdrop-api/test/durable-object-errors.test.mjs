import assert from "node:assert/strict";
import worker from "../src/index.js";
import { ChallengeStore } from "../src/index.js";

class MockStorage {
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

  async transaction(callback) {
    return callback(this);
  }
}

function makeEnv(failWhen = () => false) {
  const stores = new Map();

  return {
    AIRDROP_CHALLENGES: {
      idFromName(name) {
        return name;
      },

      get(id) {
        if (!stores.has(id)) {
          stores.set(id, new ChallengeStore({
            storage: new MockStorage()
          }));
        }

        const instance = stores.get(id);

        return {
          async fetch(url, init = {}) {
            const payload = JSON.parse(init.body);

            if (failWhen({ id, payload })) {
              throw new Error("simulated_durable_object_failure");
            }

            return instance.fetch(new Request(url, init));
          }
        };
      }
    },

    AIRDROP_KV: {
      async get() {
        return null;
      }
    }
  };
}

function req(path, body) {
  return new Request(`https://api.example.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
}

async function assertUnavailable(response) {
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "challenge_store_unavailable"
  });
}

const address = "0x0000000000000000000000000000000000000001";
const nonce = "12345678-1234-4234-8234-123456789abc";
const signature = "0x" + "11".repeat(65);

const cases = [
  {
    name: "challenge rate-limit storage failure",
    path: "/challenge",
    body: { address },
    fail: ({ payload }) => payload.action === "rate"
  },
  {
    name: "challenge persistence failure",
    path: "/challenge",
    body: { address },
    fail: ({ payload }) => payload.action === "put"
  },
  {
    name: "proof rate-limit storage failure",
    path: "/proof",
    body: { address, nonce, signature },
    fail: ({ payload }) => payload.action === "rate"
  },
  {
    name: "proof challenge lookup failure",
    path: "/proof",
    body: { address, nonce, signature },
    fail: ({ payload }) => payload.action === "get"
  }
];

let failed = 0;

for (const item of cases) {
  try {
    const response = await worker.fetch(
      req(item.path, item.body),
      makeEnv(item.fail)
    );

    await assertUnavailable(response);
    console.log(`[PASS] ${item.name}`);
  } catch (error) {
    failed++;
    console.error(`[FAIL] ${item.name}`);
    console.error(error?.stack || error);
  }
}

console.log(`\nDurable Object failure tests: ${cases.length - failed} passed, ${failed} failed.`);
if (failed) process.exitCode = 1;
