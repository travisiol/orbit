import { ethers, network } from "hardhat";
import { CATALOG, ETH_PRICE_ID } from "../../src/lib/planets";
import { DETERMINISTIC_DEPLOYER, sunDeployTx, sunInitCodeHash, predictedSun } from "../../src/lib/sunDeploy";

/**
 * Exercises the Sun against the REAL Pons V2 factory, the real Pyth and a
 * real Robinhood stock token on an in-process fork of Robinhood Chain.
 * Nothing is broadcast.
 *
 *   FORK_URL=https://rpc.mainnet.chain.robinhood.com npm run fork:check
 *
 * What it proves, in order (the public RPC forgets the fork block's state
 * within minutes, so what the mock cannot vouch for comes first):
 *   1. the Sun lands at its predicted address through the deterministic
 *      deployer that lives on the chain, reads Pons' forwarder and escrow
 *      from the factory, and a second deployment reverts;
 *   1b. planets are lit for the real NVDA and GLD tokens: names and symbols
 *      read off the tokens, orbit locks by index, a duplicate refused, a
 *      6-decimal or non-token asset refused, the fee in the corona;
 *   2. launch() with a first buy goes through Pons' forwarder in one
 *      transaction: the curve's deployer (creator-fee recipient) is the
 *      Sun, the creator tax is 100 bps, the token is ORBIT/ORBIT, the
 *      launcher holds the tokens and is exempt from the snipe tax;
 *   3. a stranger's buy accrues fees on the curve; collect() does not revert
 *      while the escrow holds nothing for the Sun;
 *   4. bodies work with the real $ORBIT: a satellite around NVDA, an orbit
 *      around GOLD; ETH sent to the Sun is allotted by mass;
 *   5. the real Pyth answers for ETH/USD but has no equity price on chain,
 *      so refuel() reverts from Pyth — the path to the oracle is live;
 *   6. with a second Sun built on a MockPyth (different address, same
 *      code), a REAL NVDA holder, impersonated, delivers real NVDA against
 *      the wind and the satellite harvests it: Robinhood's stock token
 *      moves to and from the contract without restriction.
 */
const PONS_FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
const PONS_ESCROW = "0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e";
const PYTH = "0x8250f4aF4B972684F7b336503E2D6dFeDeB1487a";
const RPC = process.env.FORK_URL ?? "https://rpc.mainnet.chain.robinhood.com";
const NVDA = 0;
const GOLD = 1;
const PLANET_FEE = ethers.parseEther("0.01");
const cat = (symbol: string) => CATALOG.find((c) => c.symbol === symbol)!;

const CURVE_ABI = [
  "function getReserves() view returns (uint256,uint256)",
  "function realQuoteReserve() view returns (uint256)",
  "function feeBps() view returns (uint256)",
  "function creatorTaxBps() view returns (uint256)",
  "function quoteFeeBalance() view returns (uint256)",
  "function deployer() view returns (address)",
  "function token() view returns (address)",
  "function currentSnipeTaxBps(address) view returns (uint256)",
  "function buy(uint256,uint256,address) payable returns (uint256)",
];
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];
const FACTORY_ABI = ["function launchFee() view returns (uint256)", "function feeEscrow() view returns (address)", "function launchForwarder() view returns (address)"];
const ESCROW_ABI = ["function balanceOf(address) view returns (uint256)"];
const PYTH_ABI = ["function getPriceUnsafe(bytes32) view returns (int64,uint64,int32,uint256)", "function priceFeedExists(bytes32) view returns (bool)"];

let step = 0;
function check(ok: boolean, what: string) {
  step++;
  console.log(`${ok ? "✓" : "✗"} ${step}. ${what}`);
  if (!ok) throw new Error(`check failed: ${what}`);
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await res.json()) as { result?: T; error?: { message: string } };
  if (j.error) throw new Error(j.error.message);
  return j.result as T;
}

/** A recent NVDA holder, found from the token's own Transfer logs on the live RPC (before the fork is touched). */
async function findHolder(token: string, minBalance: bigint): Promise<string> {
  const latest = Number(await rpc<string>("eth_blockNumber", []));
  const topic = ethers.id("Transfer(address,address,uint256)");
  const iface = new ethers.Interface(ERC20_ABI);
  for (let to = latest, i = 0; i < 12; i++) {
    const from = to - 9_000;
    const logs = await rpc<{ topics: string[]; data: string }[]>("eth_getLogs", [{ address: token, fromBlock: "0x" + from.toString(16), toBlock: "0x" + to.toString(16), topics: [topic] }]).catch(() => []);
    for (const log of logs.reverse()) {
      const parsed = iface.parseLog({ topics: log.topics, data: log.data });
      const who = parsed?.args[1] as string;
      if (!who || who === ethers.ZeroAddress) continue;
      const code = await rpc<string>("eth_getCode", [who, "latest"]);
      if (code !== "0x") continue; // an EOA, so impersonation is meaningful
      const bal = BigInt(await rpc<string>("eth_call", [{ to: token, data: iface.encodeFunctionData("balanceOf", [who]) }, "latest"]));
      if (bal >= minBalance) return who;
    }
    to = from - 1;
  }
  throw new Error("no NVDA holder found in the last ~100k blocks");
}

async function main() {
  if (!process.env.FORK_URL) throw new Error("set FORK_URL=https://rpc.mainnet.chain.robinhood.com");
  const nvdaToken = cat("NVDA").asset;
  console.log("looking for a real NVDA holder on the live chain…");
  const holder = await findHolder(nvdaToken, ethers.parseEther("0.05"));
  console.log(`holder ${holder}`);

  const [alice, bob, stranger] = await ethers.getSigners();
  await network.provider.send("evm_mine", []);
  const block = await ethers.provider.getBlockNumber();
  console.log(`fork of robinhood chain at block ${block}`);

  const factory = new ethers.Contract(PONS_FACTORY, FACTORY_ABI, ethers.provider);
  const fee: bigint = await factory.launchFee();
  const forwarderAddr: string = await factory.launchForwarder();
  const escrowAddr: string = await factory.feeEscrow();

  // 1. deterministic deployment
  const expected = predictedSun();
  console.log(`init code hash ${sunInitCodeHash()} → sun ${expected}`);
  check((await ethers.provider.getCode(DETERMINISTIC_DEPLOYER)) !== "0x", "the deterministic deployer has code on robinhood chain");
  const dtx = sunDeployTx();
  const rcDeploy = await (await alice.sendTransaction({ to: dtx.to, data: dtx.data })).wait();
  check((await ethers.provider.getCode(expected)) !== "0x", `the sun landed at its predicted address (gas ${rcDeploy?.gasUsed})`);
  const sun = await ethers.getContractAt("Sun", expected);
  check((await sun.forwarder()).toLowerCase() === forwarderAddr.toLowerCase(), `the sun read pons' forwarder from the factory: ${forwarderAddr}`);
  check((await sun.escrow()).toLowerCase() === escrowAddr.toLowerCase() && escrowAddr.toLowerCase() === PONS_ESCROW.toLowerCase(), `…and its fee escrow: ${escrowAddr}`);
  let dup = false;
  try {
    await bob.sendTransaction({ to: dtx.to, data: dtx.data });
  } catch {
    dup = true;
  }
  check(dup, "a second deployment with the same salt reverts");

  // 1b. light two planets for real Robinhood tokens
  await (await sun.connect(bob).deployPlanet(nvdaToken, cat("NVDA").pythId, { value: PLANET_FEE })).wait();
  await (await sun.connect(alice).deployPlanet(cat("GLD").asset, cat("GLD").pythId, { value: PLANET_FEE })).wait();
  const pNvda = await sun.planet(NVDA);
  const pGold = await sun.planet(GOLD);
  check(pNvda.symbol === "NVDA" && pNvda.name === "NVIDIA • Robinhood Token", `planet 0 lit for the real NVDA token: "${pNvda.name}" / ${pNvda.symbol}, lock ${Number(pNvda.period) / 86_400} d`);
  check(pGold.symbol === "GLD" && Number(pGold.period) === 14 * 86_400, `planet 1 lit for the real GLD token: "${pGold.name}", lock 14 d`);
  check((await sun.corona()) === PLANET_FEE * 2n, "both planet fees sit in the corona");
  let dupRevert = "";
  try {
    await sun.connect(bob).deployPlanet.staticCall(nvdaToken, cat("NVDA").pythId, { value: PLANET_FEE });
  } catch (e) {
    dupRevert = (e as Error).message;
  }
  check(/PlanetExists/.test(dupRevert), "a second planet for NVDA is refused (PlanetExists)");
  let eoaRevert = "";
  try {
    await sun.connect(bob).deployPlanet.staticCall(stranger.address, cat("NVDA").pythId, { value: PLANET_FEE });
  } catch (e) {
    eoaRevert = (e as Error).message;
  }
  check(/NotAToken/.test(eoaRevert), "an EOA is not a token (NotAToken)");

  // 2. launch through the real forwarder
  const buy = ethers.parseEther("0.02");
  const rcLaunch = await (await sun.connect(alice).launch("https://orbit.example/orbit-logo.png", "https://orbit.example", buy, 0, { value: fee + buy })).wait();
  const tokenAddr: string = await sun.orbit();
  const curveAddr: string = await sun.curve();
  const curve = new ethers.Contract(curveAddr, CURVE_ABI, ethers.provider);
  const token = new ethers.Contract(tokenAddr, ERC20_ABI, ethers.provider);
  check(tokenAddr !== ethers.ZeroAddress && curveAddr !== ethers.ZeroAddress, `launch() created token ${tokenAddr} and curve ${curveAddr} (gas ${rcLaunch?.gasUsed})`);
  check((await curve.deployer()).toLowerCase() === expected.toLowerCase(), "the curve's deployer — pons' creator-fee recipient — is the sun");
  check(Number(await curve.creatorTaxBps()) === 100, `creator tax ${await curve.creatorTaxBps()} bps, base fee ${await curve.feeBps()} bps`);
  check((await token.name()) === "ORBIT" && (await token.symbol()) === "ORBIT", `token ${await token.name()} / ${await token.symbol()}`);
  const aliceTokens: bigint = await token.balanceOf(alice.address);
  check(aliceTokens > 0n, `alice holds ${ethers.formatEther(aliceTokens)} ORBIT from the first buy`);
  check(Number(await curve.currentSnipeTaxBps(alice.address)) === 0, "alice is exempt from the launch snipe tax");
  console.log(`   snipe tax on a stranger right now: ${await curve.currentSnipeTaxBps(stranger.address)} bps`);

  // 3. fees accrue on the curve; collect() survives an empty escrow
  await network.provider.send("evm_increaseTime", [5]);
  await network.provider.send("evm_mine", []);
  const feesBefore: bigint = await curve.quoteFeeBalance();
  const strangerBuy = ethers.parseEther("0.05");
  await (await curve.connect(stranger).buy(strangerBuy, 0, stranger.address, { value: strangerBuy })).wait();
  const feesAfter: bigint = await curve.quoteFeeBalance();
  check(feesAfter > feesBefore, `a 0.05 ETH buy left ${ethers.formatEther(feesAfter - feesBefore)} ETH of fees on the curve (${((Number(feesAfter - feesBefore) / Number(strangerBuy)) * 100).toFixed(2)}%)`);
  const escrow = new ethers.Contract(escrowAddr, ESCROW_ABI, ethers.provider);
  console.log(`   escrow balance for the sun: ${ethers.formatEther(await escrow.balanceOf(expected))} ETH (pons sweeps later)`);
  await (await sun.connect(stranger).collect()).wait();
  check(true, "collect() did not revert with nothing to claim");

  // 4. bodies with the real token
  await (await token.connect(alice).approve(expected, ethers.MaxUint256)).wait();
  await (await token.connect(alice).transfer(bob.address, ethers.parseEther("600000"))).wait();
  await (await token.connect(bob).approve(expected, ethers.MaxUint256)).wait();
  await (await sun.connect(alice).enter(NVDA, ethers.parseEther("1000000"), false)).wait();
  await (await sun.connect(bob).enter(GOLD, ethers.parseEther("500000"), true)).wait();
  const nv = await sun.planet(NVDA);
  const gd = await sun.planet(GOLD);
  check(nv.mass === ethers.parseEther("1000000") && gd.mass === ethers.parseEther("1000000"), "a 1M satellite and a 500k orbit weigh the same: 1M gravity each");
  check(Number((await sun.bodyOf(bob.address, GOLD)).ring) === 1, "bob holds gold's first ring");
  await (await alice.sendTransaction({ to: expected, value: ethers.parseEther("0.1") })).wait();
  await (await sun.ignite()).wait();
  // bob's entry had already handed the two planet fees (0.02) to NVDA, the only planet with mass then
  check((await sun.planet(NVDA)).ethPending === ethers.parseEther("0.07") && (await sun.planet(GOLD)).ethPending === ethers.parseEther("0.05"), "0.1 ETH sent to the sun was allotted half and half (NVDA also holds the two planet fees)");

  // 5. the real pyth
  const pyth = new ethers.Contract(PYTH, PYTH_ABI, ethers.provider);
  const [ethPrice, , expo, publishTime] = await pyth.getPriceUnsafe(ETH_PRICE_ID);
  check(ethPrice > 0n, `pyth ETH/USD on chain: ${Number(ethPrice) * 10 ** Number(expo)} (published ${new Date(Number(publishTime) * 1000).toISOString()})`);
  const nvdaOnChain: boolean = await pyth.priceFeedExists(cat("NVDA").pythId);
  console.log(`   pyth NVDA feed on chain: ${nvdaOnChain}`);
  let pythRevert = "";
  try {
    await sun.connect(stranger).refuel.staticCall(NVDA, ethers.parseEther("1"), 0, []);
  } catch (e) {
    pythRevert = (e as Error).message.slice(0, 120);
  }
  check(pythRevert !== "", `refuel() without a price update reverts from pyth: ${pythRevert}`);

  // 6. the whole loop with real NVDA, on a sun that trusts a mock oracle
  const mockPyth = await (await ethers.getContractFactory("MockPyth")).deploy(0);
  await mockPyth.waitForDeployment();
  const mockPythAddr = (await mockPyth.getAddress()) as `0x${string}`;
  const sun2Addr = predictedSun({ factory: PONS_FACTORY, pyth: mockPythAddr });
  const dtx2 = sunDeployTx({ factory: PONS_FACTORY, pyth: mockPythAddr });
  await (await alice.sendTransaction({ to: dtx2.to, data: dtx2.data })).wait();
  const sun2 = await ethers.getContractAt("Sun", sun2Addr);
  await (await sun2.connect(alice).deployPlanet(nvdaToken, cat("NVDA").pythId, { value: PLANET_FEE })).wait();
  await (await sun2.connect(alice).launch("", "", buy, 0, { value: fee + buy })).wait();
  const token2 = new ethers.Contract(await sun2.orbit(), ERC20_ABI, ethers.provider);
  await (await token2.connect(alice).approve(sun2Addr, ethers.MaxUint256)).wait();
  await (await sun2.connect(alice).enter(NVDA, ethers.parseEther("1000000"), false)).wait();
  await (await alice.sendTransaction({ to: sun2Addr, value: ethers.parseEther("0.02") })).wait();
  await (await sun2.ignite()).wait();
  const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
  await (
    await mockPyth.updatePriceFeeds([
      await mockPyth.encode(cat("NVDA").pythId, 18_000_000_000n, 0n, -8, now, now - 1n), // $180
      await mockPyth.encode(ETH_PRICE_ID, 250_000_000_000n, 0n, -8, now, now - 1n), // $2,500
    ])
  ).wait();
  await network.provider.send("hardhat_impersonateAccount", [holder]);
  await network.provider.send("hardhat_setBalance", [holder, "0x8AC7230489E80000"]);
  const holderSigner = await ethers.getSigner(holder);
  const nvda = new ethers.Contract(nvdaToken, ERC20_ABI, ethers.provider);
  const holderBefore: bigint = await nvda.balanceOf(holder);
  await (await nvda.connect(holderSigner).approve(sun2Addr, ethers.MaxUint256)).wait();
  const quote = await sun2.quoteRefuel(NVDA, ethers.parseEther("0.05"));
  const ethBefore = await ethers.provider.getBalance(holder);
  const rcFill = await (await sun2.connect(holderSigner).refuel(NVDA, ethers.parseEther("0.05"), quote.ethOut, [])).wait();
  const ethAfter = await ethers.provider.getBalance(holder);
  const holderAfter: bigint = await nvda.balanceOf(holder);
  check(holderBefore - holderAfter === quote.assetTaken, `the real NVDA holder delivered ${ethers.formatEther(quote.assetTaken)} NVDA to the sun`);
  check(ethAfter - ethBefore + rcFill!.gasUsed * rcFill!.gasPrice === quote.ethOut, `…and was paid ${ethers.formatEther(quote.ethOut)} ETH, exactly the quote (0.05 NVDA × $180 / $2,500)`);
  const [owed] = await sun2.pendingOf(alice.address, NVDA);
  check(owed > 0n && owed <= quote.assetTaken, `alice, the only body, is owed ${ethers.formatEther(owed)} NVDA`);
  await (await sun2.connect(alice).harvest(NVDA)).wait();
  check((await nvda.balanceOf(alice.address)) === owed, `alice harvested ${ethers.formatEther(owed)} real NVDA — the stock token moves through the contract freely`);

  console.log(`\nall ${step} checks passed at fork block ${block}.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
