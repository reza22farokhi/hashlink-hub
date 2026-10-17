require("dotenv").config();

const fs = require("fs");
const path = require("path");
const solc = require("solc");
const { ethers } = require("ethers");
const { MerkleTree } = require("merkletreejs");
const keccak256 = require("keccak256");
const readline = require("readline");

const TOKEN_FILE = "deployments/amoy.json";
const PROOF_FILE = "airdrop-proofs.json";
const OUTPUT_FILE = "deployments/airdrop-amoy.json";

function compileAirdrop() {
  const source = fs.readFileSync("contracts/HashLinkAirdrop.sol", "utf8");

  const input = {
    language: "Solidity",
    sources: {
      "contracts/HashLinkAirdrop.sol": { content: source }
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: {
        "*": { "*": ["abi", "evm.bytecode.object"] }
      }
    }
  };

  function findImports(importPath) {
    const fullPath = path.resolve("node_modules", importPath);
    if (fs.existsSync(fullPath)) {
      return { contents: fs.readFileSync(fullPath, "utf8") };
    }
    return { error: "Import not found: " + importPath };
  }

  const output = JSON.parse(
    solc.compile(JSON.stringify(input), { import: findImports })
  );

  const errors = (output.errors || []).filter(
    e => e.severity === "error"
  );

  if (errors.length) {
    throw new Error(errors.map(e => e.formattedMessage).join("\n"));
  }

  return output.contracts[
    "contracts/HashLinkAirdrop.sol"
  ]["HashLinkAirdrop"];
}

async function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve =>
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    })
  );
}

async function main() {
  if (!process.env.POLYGON_AMOY_RPC_URL || !process.env.PRIVATE_KEY) {
    throw new Error("RPC URL or private key is missing from .env");
  }

  if (fs.existsSync(OUTPUT_FILE)) {
    throw new Error(
      OUTPUT_FILE + " already exists. Refusing to deploy a duplicate."
    );
  }

  const deployment = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
  const proofData = JSON.parse(fs.readFileSync(PROOF_FILE, "utf8"));

  if (deployment.chainId !== 80002) {
    throw new Error("Token deployment record is not for Polygon Amoy.");
  }

  if (!ethers.utils.isAddress(deployment.tokenAddress)) {
    throw new Error("Invalid token contract address.");
  }

  if (!Array.isArray(proofData.recipients) ||
      proofData.recipients.length === 0) {
    throw new Error("Recipient list is empty.");
  }

  const seen = new Set();
  const leaves = [];
  let totalAllocation = 0n;

  for (const recipient of proofData.recipients) {
    if (!ethers.utils.isAddress(recipient.address)) {
      throw new Error("Invalid recipient address.");
    }

    const address = ethers.utils.getAddress(recipient.address);
    const key = address.toLowerCase();

    if (seen.has(key)) throw new Error("Duplicate recipient: " + address);
    seen.add(key);

    if (!/^[0-9]+$/.test(recipient.amount) ||
        BigInt(recipient.amount) <= 0n) {
      throw new Error("Invalid allocation amount.");
    }

    const leaf = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ["address", "uint256"],
        [address, recipient.amount]
      )
    );

    leaves.push(leaf);
    totalAllocation += BigInt(recipient.amount);
  }

  const tree = new MerkleTree(leaves, keccak256, { sortPairs: true });
  const calculatedRoot = tree.getHexRoot();

  if (calculatedRoot.toLowerCase() !== proofData.merkleRoot.toLowerCase()) {
    throw new Error("Merkle root mismatch. Regenerate the proof file.");
  }

  for (let i = 0; i < proofData.recipients.length; i++) {
    const recipient = proofData.recipients[i];
    if (!tree.verify(recipient.proof, leaves[i], calculatedRoot)) {
      throw new Error("Invalid Merkle proof for " + recipient.address);
    }
  }

  console.log("1. Compiling airdrop contract...");
  const artifact = compileAirdrop();
  console.log("Compilation passed.");

  const provider = new ethers.providers.JsonRpcProvider(
    process.env.POLYGON_AMOY_RPC_URL
  );
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const network = await provider.getNetwork();

  if (network.chainId !== 80002) {
    throw new Error("Wrong network. Expected Polygon Amoy chain ID 80002.");
  }

  if (wallet.address.toLowerCase() !== deployment.deployer.toLowerCase()) {
    throw new Error("Wallet does not match the token deployer.");
  }

  const token = new ethers.Contract(
    deployment.tokenAddress,
    [
      "function name() view returns (string)",
      "function symbol() view returns (string)",
      "function balanceOf(address) view returns (uint256)"
    ],
    provider
  );

  const [tokenName, tokenSymbol, tokenBalance, polBalance] =
    await Promise.all([
      token.name(),
      token.symbol(),
      token.balanceOf(wallet.address),
      wallet.getBalance()
    ]);

  if (tokenName !== "HashLink Token" || tokenSymbol !== "HLT") {
    throw new Error("Unexpected token contract name or symbol.");
  }

  if (tokenBalance.lt(ethers.BigNumber.from(totalAllocation.toString()))) {
    throw new Error("Deployer has insufficient HLT for the planned airdrop.");
  }

  const root = calculatedRoot;
  const deadline = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;

  const factory = new ethers.ContractFactory(
    artifact.abi,
    "0x" + artifact.evm.bytecode.object,
    wallet
  );

  const deployTx = factory.getDeployTransaction(
    deployment.tokenAddress,
    root,
    deadline
  );
  deployTx.from = wallet.address;

  console.log("\n2. Checking deployment cost...");
  const gas = await provider.estimateGas(deployTx);
  const priorityFee = ethers.utils.parseUnits("30", "gwei");
  const maxFee = ethers.utils.parseUnits("60", "gwei");
  const maxCost = gas.mul(maxFee);

  console.log("Network: Polygon Amoy (80002)");
  console.log("Wallet:", wallet.address);
  console.log("Token:", deployment.tokenAddress);
  console.log("Recipients:", proofData.recipients.length);
  console.log(
    "Total allocation:",
    ethers.utils.formatUnits(totalAllocation.toString(), 18),
    "HLT"
  );
  console.log("Merkle root:", root);
  console.log("Claim deadline: 30 days from deployment");
  console.log("Estimated gas:", gas.toString());
  console.log("Maximum estimated gas cost:", ethers.utils.formatEther(maxCost), "POL");
  console.log("POL balance:", ethers.utils.formatEther(polBalance), "POL");

  if (polBalance.lt(maxCost)) {
    throw new Error("Insufficient POL for estimated maximum deployment cost.");
  }

  console.log("\nIMPORTANT: This deploys the airdrop contract only.");
  console.log("It does NOT fund the airdrop contract with HLT.");
  console.log("No transaction has been sent yet.");

  const answer = await ask(
    '\nTo authorize deployment on Polygon Amoy, type DEPLOY HLT AIRDROP TO AMOY: '
  );

  if (answer !== "DEPLOY HLT AIRDROP TO AMOY") {
    console.log("Cancelled. No transaction sent.");
    return;
  }

  console.log("\n3. Sending airdrop deployment transaction...");
  const contract = await factory.deploy(deployment.tokenAddress, root, deadline, {
    gasLimit: gas,
    maxPriorityFeePerGas: priorityFee,
    maxFeePerGas: maxFee
  });

  console.log("Transaction hash:", contract.deployTransaction.hash);
  console.log("Waiting for confirmation...");
  await contract.deployed();

  const record = {
    network: "Polygon Amoy",
    chainId: 80002,
    tokenAddress: deployment.tokenAddress,
    airdropAddress: contract.address,
    deployer: wallet.address,
    merkleRoot: root,
    recipientCount: proofData.recipients.length,
    totalAllocation: totalAllocation.toString(),
    deadline,
    deploymentTransaction: contract.deployTransaction.hash,
    deployedAt: new Date().toISOString(),
    funded: false
  };

  fs.mkdirSync("deployments", { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(record, null, 2), {
    mode: 0o600,
    flag: "wx"
  });

  console.log("\nAirdrop deployment confirmed.");
  console.log(JSON.stringify(record, null, 2));
  console.log("Saved to", OUTPUT_FILE);
  console.log("Next step: fund the airdrop contract with HLT.");
}

main().catch(error => {
  console.error("\nSTOP:", error.message);
  process.exitCode = 1;
});
