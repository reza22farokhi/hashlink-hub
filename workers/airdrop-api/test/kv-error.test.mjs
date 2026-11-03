import assert from "node:assert/strict";
import worker from "../src/index.js";
import { ChallengeStore } from "../src/index.js";
import { privateKeyToAccount } from "viem/accounts";

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

function makeEnv() {
  const stores = new Map();

  const namespace = {
    idFromName(name) {
      return name;
    },

    get(id) {
      if (!stores.has(id)) {
        stores.set(
          id,
          new ChallengeStore({ storage: new MockStorage() })
        );
      }

      const instance = stores.get(id);

      return {
        async fetch(_url, init = {}) {
          return instance.fetch(
            new Request("https://internal.invalid/", init)
          );
        }
      };
    }
  };

  return {
    AIRDROP_CHALLENGES: namespace,
    AIRDROP_KV: {
      async get() {
        throw new Error("simulated_kv_failure");
      }
    }
  };
}

function request(path, body, ip) {
  return new Request(`https://api.example.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "CF-Connecting-IP": ip
    },
    body: JSON.stringify(body)
  });
}

const account = privateKeyToAccount(
  "0x" + "00".repeat(31) + "01"
);

const env = makeEnv();

const challengeResponse = await worker.fetch(
  request("/challenge", { address: account.address }, "192.0.2.30"),
  env
);

assert.equal(challengeResponse.status, 200);

const challenge = await challengeResponse.json();

const signature = await account.signMessage({
  message: challenge.message
});

const proofResponse = await worker.fetch(
  request("/proof", {
    address: account.address,
    nonce: challenge.nonce,
    signature
  }, "192.0.2.31"),
  env
);

const proofBody = await proofResponse.json();

assert.equal(proofResponse.status, 503);
assert.equal(proofBody.error, "airdrop_data_unavailable");

console.log("[PASS] Valid signature reaches KV");
console.log("[PASS] KV failure returns controlled HTTP 503");
