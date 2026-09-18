import * as fs from "fs";
import * as path from "path";
import { ethers, network } from "hardhat";
import { DETERMINISTIC_DEPLOYER, SUN_SALT, sunConstructorArgs, sunDeployTx, sunInitCodeHash, predictedSun } from "../../src/lib/sunDeploy";
import { deploymentsDir, type DeploymentRecord } from "./lib/exportAbi";

/**
 * Puts the Sun on the chain at its deterministic address — the same one
 * the site computes and the same one the /deploy page uses — through
 * Arachnid's deterministic-deployment proxy (CREATE2). Anyone can run it;
 * the deployer pays gas and gets nothing else: the contract has no owner.
 *
 *   npm run deploy:robinhood   (DEPLOYER_PRIVATE_KEY in contracts/.env)
 *
 * It does NOT launch $ORBIT: that is `launch()`, one call from any wallet,
 * offered on the site's /deploy page (or `LAUNCH=1 LOGO=… BUY_ETH=0.05`
 * here). If the code is already there, nothing is sent and the record is
 * written anyway. The init code comes from src/lib/abi/Sun.bytecode.json
 * (exported by `hardhat compile`) plus the constructor arguments, so the
 * address cannot drift from the site.
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error("No signer: set DEPLOYER_PRIVATE_KEY in contracts/.env");
  if (network.name === "hardhat") await network.provider.send("evm_mine", []);
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const [factory, pyth] = sunConstructorArgs();
  const expected = predictedSun();
  console.log(`network ${network.name} chainId ${chainId} deployer ${deployer.address}`);
  console.log(`pons factory ${factory} · pyth ${pyth}`);
  console.log(`deterministic deployer ${DETERMINISTIC_DEPLOYER} salt ${SUN_SALT}`);
  console.log(`init code hash ${sunInitCodeHash()} → sun ${expected}`);

  if ((await ethers.provider.getCode(factory)) === "0x") throw new Error(`no code at the Pons factory ${factory} on chain ${chainId}`);
  if ((await ethers.provider.getCode(pyth)) === "0x") throw new Error(`no code at Pyth ${pyth} on chain ${chainId}`);
  if ((await ethers.provider.getCode(DETERMINISTIC_DEPLOYER)) === "0x") {
    throw new Error(`no deterministic deployer at ${DETERMINISTIC_DEPLOYER} on chain ${chainId}`);
  }

  let txHash: string | null = null;
  let block: number | null = null;
  if ((await ethers.provider.getCode(expected)) !== "0x") {
    console.log(`already deployed at ${expected} — nothing to send`);
  } else {
    const tx = sunDeployTx();
    const sent = await deployer.sendTransaction({ to: tx.to, data: tx.data });
    console.log(`sent ${sent.hash}, waiting…`);
    const receipt = await sent.wait();
    if (!receipt || receipt.status !== 1) throw new Error("deployment reverted");
    txHash = sent.hash;
    block = receipt.blockNumber;
    console.log(`mined in block ${receipt.blockNumber}, gas ${receipt.gasUsed}`);
    if ((await ethers.provider.getCode(expected)) === "0x") throw new Error(`no code at ${expected} after the transaction`);
  }

  const sun = await ethers.getContractAt("Sun", expected);
  const onChainFactory: string = await sun.factory();
  if (onChainFactory.toLowerCase() !== factory.toLowerCase()) {
    throw new Error(`the contract at ${expected} points at another factory (${onChainFactory})`);
  }
  console.log(`Sun at ${expected}: factory matches, launched ${await sun.launched()}`);

  if (process.env.LAUNCH === "1" && !(await sun.launched())) {
    const fee: bigint = await (await ethers.getContractAt("IPonsFactoryV2", factory)).launchFee();
    const buy = ethers.parseEther(process.env.BUY_ETH ?? "0");
    const logo = process.env.LOGO ?? "";
    const website = process.env.WEBSITE ?? "";
    console.log(`launching $ORBIT: fee ${ethers.formatEther(fee)} ETH + buy ${ethers.formatEther(buy)} ETH, logo "${logo}"`);
    const sent = await sun.launch(logo, website, buy, 0, { value: fee + buy });
    const receipt = await sent.wait();
    console.log(`launched in block ${receipt?.blockNumber}: token ${await sun.orbit()} curve ${await sun.curve()}`);
  }

  const launched = await sun.launched();
  const record: DeploymentRecord = {
    network: network.name,
    chainId,
    deployer: deployer.address,
    ponsFactory: factory,
    pyth,
    sun: expected,
    token: launched ? await sun.orbit() : null,
    curve: launched ? await sun.curve() : null,
    deployedAt: new Date().toISOString(),
    txHash,
    block,
  };
  fs.mkdirSync(deploymentsDir, { recursive: true });
  const file = path.join(deploymentsDir, `${network.name === "hardhat" ? "local" : network.name}.json`);
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + "\n");
  console.log(`wrote ${file}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
