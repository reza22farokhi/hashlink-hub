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

function makeEnv(options = {}) {
  const stores = new Map();

  const namespace = {
    idFromName(name) {
      return name;
    },

    get(id) {
      if (!stores.has(id)) {
        const storage = new MockStorage();
        stores.set(id, new ChallengeStore({ storage }));
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
      async get(key, type) {
        if (options.kvThrows) {
          throw new Error("simulated_kv_failure");
        }

        if (options.kvData !== undefined) {
          return options.kvData;
        }

        return null;
      }
    }
  };
}

function req(path, options = {}) {
  return new Request(`https://api.example.test${path}`, options);
}

async function check(name, fn) {
  try {
    await fn();
    console.log(`[PASS] ${name}`);
    return true;
  } catch (error) {
    console.error(`[FAIL] ${name}`);
    console.error(error?.stack || error);
    return false;
  }
}

let passed = 0;
let failed = 0;

async function test(name, fn) {
  if (await check(name, fn)) passed++;
  else failed++;
}

await test("GET /health returns 200", async () => {
  const response = await worker.fetch(
    req("/health"),
    makeEnv()
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
});

await test("Unknown route returns 404", async () => {
  const response = await worker.fetch(
    req("/does-not-exist"),
    makeEnv()
  );

  assert.equal(response.status, 404);
});

await test("Rejects an unapproved Origin", async () => {
  const response = await worker.fetch(
    req("/health", {
      headers: { Origin: "https://evil.example" }
    }),
    makeEnv()
  );

  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "origin_not_allowed");
});

await test("OPTIONS returns 204", async () => {
  const response = await worker.fetch(
    req("/challenge", { method: "OPTIONS" }),
    makeEnv()
  );

  assert.equal(response.status, 204);
});

await test("Rejects malformed JSON", async () => {
  const response = await worker.fetch(
    req("/challenge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{invalid"
    }),
    makeEnv()
  );

  assert.equal(response.status, 400);
});

await test("Rejects an invalid wallet address", async () => {
  const response = await worker.fetch(
    req("/challenge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: "not-an-address" })
    }),
    makeEnv()
  );

  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "invalid_address");
});

await test("Rejects a request body over 16 KiB", async () => {
  const response = await worker.fetch(
    req("/challenge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        address: "0x0000000000000000000000000000000000000001",
        extra: "x".repeat(17000)
      })
    }),
    makeEnv()
  );

  assert.equal(response.status, 400);
  assert.equal(
    (await response.json()).error,
    "invalid_json_or_body_too_large"
  );
});

await test("Rejects malformed proof input", async () => {
  const response = await worker.fetch(
    req("/proof", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        address: "0x0000000000000000000000000000000000000001",
        nonce: "bad",
        signature: "bad"
      })
    }),
    makeEnv()
  );

  assert.equal(response.status, 400);
  assert.equal(
    (await response.json()).error,
    "invalid_nonce_or_signature"
  );
});

await test("Rejects a syntactically valid but invalid signature", async () => {
  const env = makeEnv();

  const challengeResponse = await worker.fetch(
    req("/challenge", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "CF-Connecting-IP": "192.0.2.10"
      },
      body: JSON.stringify({
        address: "0x0000000000000000000000000000000000000001"
      })
    }),
    env
  );

  assert.equal(challengeResponse.status, 200);
  const challenge = await challengeResponse.json();

  const proofResponse = await worker.fetch(
    req("/proof", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "CF-Connecting-IP": "192.0.2.11"
      },
      body: JSON.stringify({
        address: "0x0000000000000000000000000000000000000001",
        nonce: challenge.nonce,
        signature: "0x" + "00".repeat(65)
      })
    }),
    env
  );

  assert.equal(proofResponse.status, 401);
});

await test("Rejects invalid signature before KV access", async () => {
  const env = makeEnv({ kvThrows: true });

  const challengeResponse = await worker.fetch(
    req("/challenge", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "CF-Connecting-IP": "192.0.2.20"
      },
      body: JSON.stringify({
        address: "0x0000000000000000000000000000000000000002"
      })
    }),
    env
  );

  assert.equal(challengeResponse.status, 200);
  const challenge = await challengeResponse.json();

  const proofResponse = await worker.fetch(
    req("/proof", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "CF-Connecting-IP": "192.0.2.21"
      },
      body: JSON.stringify({
        address: "0x0000000000000000000000000000000000000002",
        nonce: challenge.nonce,
        signature: "0x" + "00".repeat(65)
      })
    }),
    env
  );

  // Confirm the fake signature is rejected before KV is accessed.
  assert.equal(proofResponse.status, 401);
});

console.log(`\nPublic API tests: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exitCode = 1;
