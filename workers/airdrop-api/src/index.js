import {
  encodeAbiParameters,
  hexToBytes,
  isAddress,
  keccak256,
  recoverMessageAddress,
} from "viem";

const SITE_ORIGIN = "https://reza22farokhi.github.io";
const ROOT =
  "0x4d838f562710120ba590c815bc3962eb79c450dc8135cc502a2f0002fe870163";
const TOKEN = "0x473C3aEaa61266b03eC5F2Fea0dE683b83714EB2";
const AIRDROP = "0x3c2D98A0d1e6AcaA5Cc5B7A2066cdfD3A5337f0D";
const TTL = 300;
const MAX_BODY = 16384;

function response(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": SITE_ORIGIN,
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "vary": "Origin",
      "x-content-type-options": "nosniff"
    }
  });
}

async function readBody(request) {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY) {
    throw new Error("body_too_large");
  }
  return JSON.parse(raw);
}

function validHash(value) {
  return typeof value === "string" &&
    /^0x[0-9a-fA-F]{64}$/.test(value);
}

function validAmount(value) {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    return false;
  }
  try {
    return BigInt(value) < (1n << 256n);
  } catch {
    return false;
  }
}

function leafHash(address, amount) {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "uint256" }],
      [address, BigInt(amount)]
    )
  );
}

function verifyProof(address, amount, proof, root) {
  if (!Array.isArray(proof) || proof.length > 64 ||
      !proof.every(validHash) || !validHash(root)) {
    return false;
  }

  let hash = leafHash(address, amount);

  for (const sibling of proof) {
    const a = hash.toLowerCase();
    const b = sibling.toLowerCase();
    const pair = a < b ? a + b.slice(2) : b + a.slice(2);
    hash = keccak256(pair);
  }

  return hash.toLowerCase() === root.toLowerCase();
}

async function challenge(request, env) {
  if (request.method !== "POST") {
    return response({ error: "method_not_allowed" }, 405);
  }

  let body;
  try {
    body = await readBody(request);
  } catch {
    return response({ error: "invalid_json_or_body_too_large" }, 400);
  }

  if (!body || typeof body.address !== "string" ||
      !isAddress(body.address)) {
    return response({ error: "invalid_address" }, 400);
  }

  const nonce = crypto.randomUUID();
  const address = body.address.toLowerCase();
  const issuedAt = new Date().toISOString();
  const message = [
    "HashLink Hub airdrop claim",
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    "Purpose: prove wallet ownership; no transaction is authorized."
  ].join("\n");

  await env.AIRDROP_KV.put(
    `challenge:${nonce}`,
    JSON.stringify({ address, message }),
    { expirationTtl: TTL }
  );

  return response({ nonce, message, expiresIn: TTL });
}

async function proof(request, env) {
  if (request.method !== "POST") {
    return response({ error: "method_not_allowed" }, 405);
  }

  let body;
  try {
    body = await readBody(request);
  } catch {
    return response({ error: "invalid_json_or_body_too_large" }, 400);
  }

  const { address, nonce, signature } = body || {};

  if (typeof address !== "string" || !isAddress(address)) {
    return response({ error: "invalid_address" }, 400);
  }
  if (typeof nonce !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(nonce) ||
      typeof signature !== "string" ||
      !/^0x[0-9a-f]{130}$/i.test(signature)) {
    return response({ error: "invalid_nonce_or_signature" }, 400);
  }

  const key = `challenge:${nonce}`;
  const saved = await env.AIRDROP_KV.get(key, "json");

  if (!saved || saved.address !== address.toLowerCase()) {
    return response({ error: "challenge_expired_or_mismatched" }, 401);
  }

  let recovered;
  try {
    recovered = await recoverMessageAddress({
      message: saved.message,
      signature
    });
  } catch {
    return response({ error: "invalid_signature" }, 401);
  }

  if (recovered.toLowerCase() !== address.toLowerCase()) {
    return response({ error: "signature_address_mismatch" }, 401);
  }

  const data = await env.AIRDROP_KV.get("airdrop-data", "json");

  if (!data || !Array.isArray(data.recipients)) {
    return response({ error: "airdrop_data_not_configured" }, 503);
  }
  if (typeof data.merkleRoot !== "string" ||
      data.merkleRoot.toLowerCase() !== ROOT.toLowerCase()) {
    return response({ error: "airdrop_root_mismatch" }, 503);
  }

  const recipient = data.recipients.find(
    item => typeof item?.address === "string" &&
      item.address.toLowerCase() === address.toLowerCase()
  );

  if (!recipient) {
    return response({ error: "wallet_not_eligible" }, 404);
  }
  if (!validAmount(recipient.amount) ||
      !verifyProof(address, recipient.amount, recipient.proof, data.merkleRoot)) {
    return response({ error: "invalid_allocation_or_merkle_proof" }, 503);
  }

  await env.AIRDROP_KV.delete(key);

  return response({
    network: "polygon-amoy",
    chainId: 80002,
    tokenAddress: TOKEN,
    airdropAddress: AIRDROP,
    merkleRoot: data.merkleRoot,
    address: recipient.address,
    amount: recipient.amount,
    proof: recipient.proof
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.headers.get("Origin") &&
        request.headers.get("Origin") !== SITE_ORIGIN) {
      return response({ error: "origin_not_allowed" }, 403);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": SITE_ORIGIN,
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type",
          "access-control-max-age": "86400",
          "vary": "Origin"
        }
      });
    }

    try {
      if (url.pathname === "/health" && request.method === "GET") {
        return response({ ok: true, service: "hashlink-airdrop-api" });
      }
      if (url.pathname === "/challenge") {
        return await challenge(request, env);
      }
      if (url.pathname === "/proof") {
        return await proof(request, env);
      }
      return response({ error: "not_found" }, 404);
    } catch {
      return response({ error: "internal_error" }, 500);
    }
  }
};
