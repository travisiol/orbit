import { HardhatUserConfig, task } from "hardhat/config";
import { TASK_COMPILE } from "hardhat/builtin-tasks/task-names";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
import { exportAbis } from "./scripts/lib/exportAbi";

dotenv.config();

const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY?.trim();
const accounts = DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [];

/** Robinhood Chain (Arbitrum Orbit). Chain id 4663 (0x1237). */
const ROBINHOOD_RPC_URL =
  process.env.ROBINHOOD_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";
const ROBINHOOD_CHAIN_ID = Number(process.env.ROBINHOOD_CHAIN_ID ?? 4663);

/**
 * Every successful `hardhat compile` re-exports the Sun's ABI and
 * creation bytecode into ../src/lib/abi so the front end can never drift
 * from the contract — the bytecode is what fixes the Sun's address.
 * SKIP_ABI_EXPORT=true opts out.
 */
task(TASK_COMPILE, async (args, hre, runSuper) => {
  const result = await runSuper(args);
  if (process.env.SKIP_ABI_EXPORT !== "true") {
    await exportAbis(hre);
  }
  return result;
});

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      // Planet structs carry strings and a dozen fields; the IR pipeline
      // keeps the views and the constructor under the stack limit.
      viaIR: true,
      ...(process.env.SOLIDITY_EVM_VERSION
        ? { evmVersion: process.env.SOLIDITY_EVM_VERSION }
        : {}),
    },
  },
  networks: {
    hardhat: {
      // HARDHAT_CHAIN_ID=4663 makes a seeded fork answer like Robinhood Chain
      // (scripts/serve-fork.ts); tests keep the default.
      chainId: Number(process.env.HARDHAT_CHAIN_ID ?? 31337),
      // Robinhood Chain is unknown to EDR; tell it which rules apply to
      // calls made at the fork block itself.
      chains: { 4663: { hardforkHistory: { cancun: 0 } } },
      // FORK_URL=https://rpc.mainnet.chain.robinhood.com turns the in-process
      // network into a fork of Robinhood Chain (optionally pinned with
      // FORK_BLOCK). The public RPC only keeps very recent state, so the
      // in-process fork (one pass, everything cached) is the one that works;
      // a long-lived `hardhat node --fork` dies after a couple of minutes.
      ...(process.env.FORK_URL
        ? {
            forking: {
              url: process.env.FORK_URL,
              ...(process.env.FORK_BLOCK ? { blockNumber: Number(process.env.FORK_BLOCK) } : {}),
            },
          }
        : {}),
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      timeout: 600_000,
    },
    robinhood: {
      url: ROBINHOOD_RPC_URL,
      chainId: ROBINHOOD_CHAIN_ID,
      accounts,
    },
  },
  etherscan: {
    apiKey: {
      robinhood: process.env.ROBINHOOD_EXPLORER_API_KEY ?? "no-key-required",
    },
    customChains: [
      {
        network: "robinhood",
        chainId: ROBINHOOD_CHAIN_ID,
        urls: {
          apiURL:
            process.env.ROBINHOOD_EXPLORER_API_URL ??
            "https://robinhoodchain.blockscout.com/api",
          browserURL:
            process.env.ROBINHOOD_EXPLORER_URL ??
            "https://robinhoodchain.blockscout.com",
        },
      },
    ],
  },
  sourcify: { enabled: false },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  mocha: {
    timeout: 600_000,
  },
};

export default config;
