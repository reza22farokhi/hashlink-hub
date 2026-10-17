const fs = require("fs");
const path = require("path");
const solc = require("solc");
const ganache = require("ganache");
const { ethers } = require("ethers");
const { MerkleTree } = require("merkletreejs");
const keccak256 = require("keccak256");

function findImports(importPath) {
  try {
    return {
      contents: fs.readFileSync(
        path.resolve("node_modules", importPath),
        "utf8"
      )
    };
  } catch (error) {
    return { error: `Import not found: ${importPath}` };
  }
}

async function main() {
  console.log("1. Compiling contracts...");

  const input = {
    language: "Solidity",
    sources: {
      "contracts/HashLinkToken.sol": {
        content: fs.readFileSync("contracts/HashLinkToken.sol", "utf8")
      },
      "contracts/HashLinkAirdrop.sol": {
        content: fs.readFileSync("contracts/HashLinkAirdrop.sol", "utf8")
      }
    },
    settings: {
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"]
        }
      }
    }
  };

  const result = JSON.parse(
    solc.compile(JSON.stringify(input), { import: findImports })
  );

  const errors = (result.errors || []).filter(
    e => e.severity === "error"
  );

  if (errors.length) {
    throw new Error(errors.map(e => e.formattedMessage).join("\n"));
  }

  const tokenArtifact =
    result.contracts["contracts/HashLinkToken.sol"].HashLinkToken;
  const airdropArtifact =
    result.contracts["contracts/HashLinkAirdrop.sol"].HashLinkAirdrop;

  console.log("   Compilation passed.");

  const rawProvider = ganache.provider({
    logging: { quiet: true },
    wallet: { totalAccounts: 5 }
  });

  const provider = new ethers.providers.Web3Provider(rawProvider);
  const owner = provider.getSigner(0);
  const user1 = provider.getSigner(1);
  const user2 = provider.getSigner(2);
  const stranger = provider.getSigner(3);

  const deploy = async (artifact, signer, args = []) => {
    const factory = new ethers.ContractFactory(
      artifact.abi,
      artifact.evm.bytecode.object,
      signer
    );
    const contract = await factory.deploy(...args);
    await contract.deployed();
    return contract;
  };

  console.log("2. Deploying token to local test chain...");

  const token = await deploy(tokenArtifact, owner);
  const expectedSupply = ethers.utils.parseUnits("1000000000", 18);
  const actualSupply = await token.totalSupply();

  if (!actualSupply.eq(expectedSupply)) {
    throw new Error("Fixed supply test failed");
  }
  console.log("   PASS: Fixed supply is 1,000,000,000 HLT.");

  const address1 = await user1.getAddress();
  const address2 = await user2.getAddress();
  const amount1 = ethers.utils.parseUnits("100", 18);
  const amount2 = ethers.utils.parseUnits("250", 18);

  const leafFor = (address, amount) =>
    Buffer.from(
      ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(
          ["address", "uint256"],
          [address, amount]
        )
      ).slice(2),
      "hex"
    );

  const leaves = [
    leafFor(address1, amount1),
    leafFor(address2, amount2)
  ];

  const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
  const root = tree.getHexRoot();

  console.log("3. Deploying airdrop contract...");
  const airdrop = await deploy(
    airdropArtifact,
    owner,
    [token.address, root, 0]
  );

  const funding = amount1.add(amount2);
  await (await token.transfer(airdrop.address, funding)).wait();

  console.log("4. Testing valid claims...");

  await (
    await airdrop.connect(user1).claim(
      amount1,
      tree.getHexProof(leaves[0])
    )
  ).wait();

  const balance1 = await token.balanceOf(address1);
  if (!balance1.eq(amount1)) {
    throw new Error("First claim amount incorrect");
  }
  console.log("   PASS: Valid claim pays the correct amount.");

  let duplicateBlocked = false;
  try {
    await airdrop.connect(user1).callStatic.claim(
      amount1,
      tree.getHexProof(leaves[0])
    );
  } catch (_) {
    duplicateBlocked = true;
  }

  if (!duplicateBlocked) {
    throw new Error("Duplicate claim was not blocked");
  }
  console.log("   PASS: Duplicate claim is rejected.");

  let invalidBlocked = false;
  try {
    await airdrop.connect(stranger).callStatic.claim(
      amount1,
      []
    );
  } catch (_) {
    invalidBlocked = true;
  }

  if (!invalidBlocked) {
    throw new Error("Invalid proof was not blocked");
  }
  console.log("   PASS: Invalid proof is rejected.");

  await (
    await airdrop.connect(user2).claim(
      amount2,
      tree.getHexProof(leaves[1])
    )
  ).wait();

  const balance2 = await token.balanceOf(address2);
  if (!balance2.eq(amount2)) {
    throw new Error("Second claim amount incorrect");
  }
  console.log("   PASS: Second valid claim succeeds.");

  console.log("\nALL RUNTIME TESTS PASSED.");
  console.log("Token address (local only):", token.address);
  console.log("Airdrop address (local only):", airdrop.address);
  console.log("These addresses are not Polygon deployments.");

  await rawProvider.disconnect();
}

main().catch(error => {
  console.error("\nTEST FAILED:", error.message || error);
  process.exitCode = 1;
});
