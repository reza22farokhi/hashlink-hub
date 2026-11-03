import assert from "node:assert/strict";
import worker, { ChallengeStore } from "../src/index.js";

const MAX_BODY = 16384;

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
    AIRDROP_KV: { async get() { return null; } }
  };
}

function makeRequest(body, headers = {}) {
  return new Request("https://api.example.test/challenge", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers
    },
    body
  });
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`[PASS] ${name}`);
  } catch (error) {
    console.error(`[FAIL] ${name}`);
    console.error(error?.stack || error);
    process.exitCode = 1;
  }
}

await test("Accepts valid small JSON", async () => {
  const body = JSON.stringify({
    address: "0x0000000000000000000000000000000000000001"
  });

  const response = await worker.fetch(
    makeRequest(body),
    makeEnv()
  );

  assert.equal(response.status, 200);
});

await test("Rejects oversized Content-Length before reading", async () => {
  let pullCount = 0;

  const stream = new ReadableStream({
    pull() {
      pullCount++;
      // Deliberately do not enqueue any bytes.
    }
  }, { highWaterMark: 0 });

  const request = new Request(
    "https://api.example.test/challenge",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(MAX_BODY + 1)
      },
      body: stream,
      duplex: "half"
    }
  );

  const response = await worker.fetch(request, makeEnv());

  assert.equal(response.status, 400);
  assert.equal(
    (await response.json()).error,
    "invalid_json_or_body_too_large"
  );
  assert.equal(pullCount, 0, "body stream should not be read");
});

await test("Stops and rejects oversized streamed body", async () => {
  let cancelCalled = false;
  let pullCount = 0;

  const stream = new ReadableStream({
    pull(controller) {
      pullCount++;
      controller.enqueue(new Uint8Array(MAX_BODY + 1));
    },
    cancel() {
      cancelCalled = true;
    }
  }, { highWaterMark: 0 });

  const request = new Request(
    "https://api.example.test/challenge",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half"
    }
  );

  const response = await worker.fetch(request, makeEnv());

  assert.equal(response.status, 400);
  assert.equal(
    (await response.json()).error,
    "invalid_json_or_body_too_large"
  );
  assert.equal(cancelCalled, true);
});

await test("Rejects malformed JSON", async () => {
  const response = await worker.fetch(
    makeRequest("{invalid"),
    makeEnv()
  );

  assert.equal(response.status, 400);
});

await test("Accepts body at or below size limit for parsing", async () => {
  const prefix = JSON.stringify({
    address: "0x0000000000000000000000000000000000000001",
    extra: ""
  });

  const suffix = "}";
  const fixedPrefix = prefix.slice(0, -1);
  const body = fixedPrefix +
    " ".repeat(MAX_BODY - fixedPrefix.length - suffix.length) +
    suffix;

  assert.equal(new TextEncoder().encode(body).byteLength, MAX_BODY);

  const response = await worker.fetch(
    makeRequest(body),
    makeEnv()
  );

  // The JSON is valid and has a valid address.
  assert.equal(response.status, 200);
});

console.log("Streaming body-limit tests finished.");
