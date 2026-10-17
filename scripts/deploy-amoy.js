require("dotenv").config();

const fs = require("fs");
const path = require("path");
const solc = require("solc");
const { ethers } = require("ethers");
const readline = require("readline");

async function main() {
  if (!process.argv.includes("--confirm-amoy-testnet")) {
    throw new Error(
      "Safety stop: deployment requires --confirm-amoy-testnet"
    );
  }

  const rpcUrl = process.env.POLYGON_AMOY_RPC_URL;
  let privateKey = process.env.PRIVATE_KEY || "";

  if (!rpcUrl || !privateKey) {
    throw new Error(
      "Missing POLYGON_AMOY_RPC_URL or PRIVATE_KEY in local .env"
    );
  }

  privateKey = privateKey.trim();
  if (!privateKey.startsWith("0x")) {
    privateKey = "0x" + privateKey;
  }

  const contractPath = path.join(
    process.cwd(),
    "contracts",
    "HashLinkToken.sol"
  );

  const source = fs.readFileSync(contractPath, "utf8");

  const input = {
    language: "Solidity",
    sources: {
      "HashLinkToken.sol": { content: source }
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"]
        }
      }
    }
  };

  function findImports(importPath) {
    try {
      const resolved = require.resolve(importPath, {
        paths: [process.cwd()]
      });
      return { contents: fs.readFileSync(resolved, "utf8") };
    } catch (error) {
      return { error: "Import not found: " + importPath };
    }
  }

  console.log("1. Compiling HashLinkToken.sol...");
  const compiled = JSON.parse(
    solc.compile(JSON.stringify(input), { import: findImports })
  );

  const errors = (compiled.errors || []).filter(
    item => item.severity === "error"
  );

  if (errors.length) {
    errors.forEach(item => console.error(item.formattedMessage));
    throw new Error("Compilation failed.");
  }

  const artifact = compiled.contracts["HashLinkToken.sol"]["HashLinkToken"];
  if (!artifact.evm.bytecode.object) {
    throw new Error("Contract bytecode is empty.");
  }
  console.log("Compilation passed.");

  const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();

  if (network.chainId !== 80002) {
    throw new Error(
      "Wrong network. Expected Polygon Amoy chain ID 80002; received " +
      network.chainId
    );
  }

  const wallet = new ethers.Wallet(privateKey, provider);
  const address = await wallet.getAddress();
  const balance = await wallet.getBalance();

  console.log("\nNetwork: Polygon Amoy (chain ID 80002)");
  console.log("Deployer address:", address);
  console.log("Test POL balance:", ethers.utils.formatEther(balance));

  if (balance.isZero()) {
    throw new Error(
      "Wallet has no test POL for gas. Fund it with testnet tokens first."
    );
  }

  console.log("\nThis will deploy the HLT token contract to the testnet.");
  console.log("Supply: 1,000,000,000 HLT");
  console.log("This does not deploy the airdrop contract.");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const answer = await new Promise(resolve => {
    rl.question(
      '\nTo authorize this testnet transaction, type DEPLOY HLT TO AMOY: ',
      resolve
    );
  });
  rl.close();

  if (answer.trim() !== "DEPLOY HLT TO AMOY") {
    throw new Error("Cancelled. No deployment transaction was sent.");
  }

  console.log("\n2. Sending deployment transaction...");
  const factory = new ethers.ContractFactory(
    artifact.abi,
    "0x" + artifact.evm.bytecode.object,
    wallet
  );

  const feeOverrides = {
    maxPriorityFeePerGas: ethers.utils.parseUnits("30", "gwei"),
    maxFeePerGas: ethers.utils.parseUnits("60", "gwei")
  };
  console.log("Priority fee: 30 Gwei");
  console.log("Max fee: 60 Gwei");
  const contract = await factory.deploy(feeOverrides);
  console.log("Transaction hash:", contract.deployTransaction.hash);
  console.log("Waiting for confirmation...");

  await contract.deployed();

  const result = {
    network: "Polygon Amoy",
    chainId: 80002,
    tokenName: await contract.name(),
    tokenSymbol: await contract.symbol(),
    totalSupply: (await contract.totalSupply()).toString(),
    tokenAddress: contract.address,
    deployer: address,
    deploymentTransaction: contract.deployTransaction.hash,
    deployedAt: new Date().toISOString()
  };

  fs.mkdirSync(path.join(process.cwd(), "deployments"), {
    recursive: true
  });

  fs.writeFileSync(
    path.join(process.cwd(), "deployments", "amoy.json"),
    JSON.stringify(result, null, 2) + "\n"
  );

  console.log("\nDeployment confirmed.");
  console.log(JSON.stringify(result, null, 2));
  console.log("Saved to deployments/amoy.json");
  console.log("Verify the address on the Polygon Amoy block explorer.");
}

main().catch(error => {
  console.error("\nSTOP:", error.message);
  process.exitCode = 1;
});
