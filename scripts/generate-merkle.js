const fs = require("fs");
const { ethers } = require("ethers");
const { MerkleTree } = require("merkletreejs");
const keccak256 = require("keccak256");

const recipients = JSON.parse(
  fs.readFileSync("airdrop-recipients.json", "utf8")
);

if (!Array.isArray(recipients) || recipients.length === 0) {
  throw new Error("Recipient list is empty");
}

const seen = new Set();

const leaves = recipients.map((r) => {
  if (!ethers.utils.isAddress(r.address)) {
    throw new Error(`Invalid address: ${r.address}`);
  }

  const address = ethers.utils.getAddress(r.address);
  const key = address.toLowerCase();

  if (seen.has(key)) {
    throw new Error(`Duplicate address: ${address}`);
  }
  seen.add(key);

  if (!/^[0-9]+$/.test(r.amount) || BigInt(r.amount) <= 0n) {
    throw new Error(`Invalid amount for ${address}`);
  }

  const amountWei = ethers.utils.parseUnits(r.amount, 18);

  return {
    address,
    amount: amountWei.toString(),
    leaf: ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256"],
        [address, amountWei]
      )
    )
  };
});

const tree = new MerkleTree(
  leaves.map((x) => x.leaf),
  keccak256,
  { sortPairs: true }
);

const output = {
  merkleRoot: tree.getHexRoot(),
  recipients: leaves.map((x) => ({
    address: x.address,
    amount: x.amount,
    proof: tree.getHexProof(x.leaf)
  }))
};

fs.writeFileSync(
  "airdrop-proofs.json",
  JSON.stringify(output, null, 2)
);

console.log("Merkle root:", output.merkleRoot);
console.log("Recipients:", output.recipients.length);
console.log("Proof file: airdrop-proofs.json");
