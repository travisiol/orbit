import * as http from "http";
import { ethers, network } from "hardhat";
import { BRIEF, ETH_PRICE_ID, ZERO_ADDRESS } from "../../src/lib/planets";
import { DETERMINISTIC_DEPLOYER, DETERMINISTIC_DEPLOYER_CODE, predictedSun, sunDeployTx } from "../../src/lib/sunDeploy";

/**
 * Front-end rehearsal without a live deployment: a network the site can be
 * pointed at (NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8571) with a Sun on it,
 * the brief's five planets lit (HOOD has no token, so it stays a ghost),
 * $ORBIT launched, bodies around the planets, a wind half blown.
 *
 *   HARDHAT_CHAIN_ID=4663 npm run serve:fork
 *     — no FORK_URL: the Pons and Pyth MOCKS from the unit tests on a plain
 *       hardhat network. MockERC20 code (and the real names) is written at
 *       the five real stock token addresses so planets can be lit for them
 *       and harvests pay out; Multicall3's real bytecode is
 *       copied in so wagmi's batched reads work. The mocks have their own
 *       addresses, so the Sun's address differs from the deterministic one:
 *       the script prints the NEXT_PUBLIC_SUN override to set.
 *
 *   FORK_URL=https://rpc.mainnet.chain.robinhood.com HARDHAT_CHAIN_ID=4663 npm run serve:fork
 *     — a fork of Robinhood Chain, in-process, against the REAL Pons
 *       factory and the real Pyth. The Sun lands at its deterministic
 *       address. Equity prices are not on chain, so no wind blows here;
 *       the public RPC keeps only recent state and a fork dies after a few
 *       minutes: seed, look, done.
 *
 * SEED=none serves an empty network (the browser gets to deploy and launch).
 * Test wallet: hardhat account #1 (alice) — unlocked, so the browser stub
 * (public/dev-wallet.js) can send from it without a key.
 */
const PONS_FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
const PYTH = "0x8250f4aF4B972684F7b336503E2D6dFeDeB1487a";
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const PORT = Number(process.env.PORT ?? 8571);
const RPC = "https://rpc.mainnet.chain.robinhood.com";

const CURVE_ABI = [
  "function getReserves() view returns (uint256,uint256)",
  "function realQuoteReserve() view returns (uint256)",
  "function graduationThreshold() view returns (uint256)",
  "function graduated() view returns (bool)",
  "function quoteFeeBalance() view returns (uint256)",
  "function creatorTaxBps() view returns (uint256)",
  "function deployer() view returns (address)",
  "function buy(uint256,uint256,address) payable returns (uint256)",
];
const ERC20_ABI = ["function balanceOf(address) view returns (uint256)", "function approve(address,uint256) returns (bool)", "function mint(address,uint256)", "function symbol() view returns (string)"];
const PLANET_FEE = ethers.parseEther("0.01");
const LIT = BRIEF.filter((c) => c.asset !== ZERO_ADDRESS);

/** OZ ERC20 keeps `_name` at slot 3 and `_symbol` at slot 4; short strings fit in one word. */
async function setShortString(addr: string, slot: number, value: string) {
  const bytes = ethers.toUtf8Bytes(value);
  if (bytes.length > 31) throw new Error(`string too long for a short slot: ${value}`);
  const word = new Uint8Array(32);
  word.set(bytes, 0);
  word[31] = bytes.length * 2;
  await network.provider.send("hardhat_setStorageAt", [addr, ethers.toBeHex(slot, 32), ethers.hexlify(word)]);
}
const FACTORY_ABI = ["function launchFee() view returns (uint256)", "function feeEscrow() view returns (address)"];

const usd = (n: number) => BigInt(Math.round(n * 1e8));

function serve() {
  const server = http.createServer((req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      let payload: unknown;
      try {
        payload = JSON.parse(body);
      } catch {
        res.writeHead(400);
        res.end("bad json");
        return;
      }
      const handle = async (call: { id?: unknown; method: string; params?: unknown[] }) => {
        try {
          const result = await network.provider.request({ method: call.method, params: call.params ?? [] });
          return { jsonrpc: "2.0", id: call.id ?? null, result };
        } catch (e) {
          const err = e as { code?: number; message?: string; data?: unknown };
          return { jsonrpc: "2.0", id: call.id ?? null, error: { code: typeof err.code === "number" ? err.code : -32000, message: err.message ?? "error", data: err.data } };
        }
      };
      const out = Array.isArray(payload) ? await Promise.all(payload.map(handle)) : await handle(payload as { method: string });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(out));
    });
  });
  server.listen(PORT, () => console.log(`serving on http://127.0.0.1:${PORT} — Ctrl+C to stop`));
}

async function copyCode(from: string, to: string, label: string) {
  try {
    const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [from, "latest"] }) });
    const j = (await res.json()) as { result?: string };
    if (j.result && j.result !== "0x") {
      await network.provider.send("hardhat_setCode", [to, j.result]);
      console.log(`${label} bytecode copied from robinhood chain`);
    }
  } catch {
    console.log(`warning: could not fetch ${label} bytecode`);
  }
}

async function main() {
  const signers = await ethers.getSigners();
  const [deployer, alice, bob, carol, dave, erin, filler] = signers;
  await network.provider.send("evm_mine", []);
  const forked = (await ethers.provider.getCode(PONS_FACTORY)) !== "0x";
  const chainId = Number((await ethers.provider.getNetwork()).chainId);

  let factoryAddr = PONS_FACTORY;
  let pythAddr = PYTH;
  if (!forked) {
    if (process.env.FORK_URL) throw new Error("FORK_URL is set but there is no factory code — not a Robinhood Chain fork");
    const mock = await (await ethers.getContractFactory("MockPonsFactory")).deploy(deployer.address);
    await mock.waitForDeployment();
    factoryAddr = await mock.getAddress();
    const pyth = await (await ethers.getContractFactory("MockPyth")).deploy(0);
    await pyth.waitForDeployment();
    pythAddr = await pyth.getAddress();
    console.log(`mock pons factory ${factoryAddr}, mock pyth ${pythAddr} (no FORK_URL: rehearsal on the mocks)`);
    await network.provider.send("hardhat_setCode", [DETERMINISTIC_DEPLOYER, DETERMINISTIC_DEPLOYER_CODE]);
    await copyCode(MULTICALL3, MULTICALL3, "multicall3");
    // The planets' real asset addresses get mock ERC-20 code so harvests can pay.
    const erc20 = await ethers.getContractFactory("MockERC20");
    const probe = await erc20.deploy("probe", "PRB");
    await probe.waitForDeployment();
    const code = await ethers.provider.getCode(await probe.getAddress());
    for (const c of LIT) {
      await network.provider.send("hardhat_setCode", [c.asset, code]);
      await setShortString(c.asset, 3, `${c.name} • RH Token`);
      await setShortString(c.asset, 4, c.symbol);
    }
    console.log("mock erc-20 code written at the five stock token addresses");
  }

  const sunAddr = predictedSun({ factory: factoryAddr as `0x${string}`, pyth: pythAddr as `0x${string}` });

  if (process.env.SEED === "none") {
    console.log(`chainId ${chainId} block ${await ethers.provider.getBlockNumber()} — nothing deployed; the sun would live at ${sunAddr}`);
    console.log(`NEXT_PUBLIC_RPC_URL=http://127.0.0.1:${PORT}`);
    if (!forked) console.log(`NEXT_PUBLIC_SUN=${sunAddr}`);
    console.log(`test wallet (unlocked): ${alice.address}`);
    serve();
    await new Promise(() => {});
    return;
  }

  const factory = new ethers.Contract(factoryAddr, FACTORY_ABI, ethers.provider);
  const fee: bigint = await factory.launchFee();

  // The way the site deploys it: one transaction to the deterministic deployer.
  const dtx = sunDeployTx({ factory: factoryAddr as `0x${string}`, pyth: pythAddr as `0x${string}` });
  await (await alice.sendTransaction({ to: dtx.to, data: dtx.data })).wait();
  const sun = await ethers.getContractAt("Sun", sunAddr);
  console.log(`chainId ${chainId} block ${await ethers.provider.getBlockNumber()} sun ${sunAddr} (deterministic, deployed by ${alice.address})`);

  // the brief's five planets, lit by three different wallets in the brief's order
  const lighters = [alice, bob, carol, dave, erin];
  for (let i = 0; i < LIT.length; i++) {
    const c = LIT[i];
    await (await sun.connect(lighters[i]).deployPlanet(c.asset, c.pythId, { value: PLANET_FEE })).wait();
    const p = await sun.planet(i);
    console.log(`  planet ${i} ${p.symbol} (${p.name}) lit by ${lighters[i].address.slice(0, 8)} — lock ${Number(p.period) / 86_400} d`);
  }

  // launch() with a 1 ETH first buy to alice, then the others buy on the curve
  await (await sun.connect(alice).launch("https://orbit.example/orbit-logo.png", "https://orbit.example", ethers.parseEther("1"), 0, { value: fee + ethers.parseEther("1") })).wait();
  const tokenAddr = await sun.orbit();
  const curveAddr = await sun.curve();
  const curve = new ethers.Contract(curveAddr, CURVE_ABI, ethers.provider);
  const token = new ethers.Contract(tokenAddr, ERC20_ABI, ethers.provider);
  console.log(`$ORBIT ${tokenAddr} curve ${curveAddr} creatorTax ${await curve.creatorTaxBps()} bps deployer(fee recipient) ${await curve.deployer()}`);
  for (const [who, amt] of [
    [bob, "0.6"],
    [carol, "0.4"],
    [dave, "0.25"],
    [erin, "0.15"],
  ] as const) {
    const v = ethers.parseEther(amt);
    await (await curve.connect(who).buy(v, 0, who.address, { value: v })).wait();
  }
  for (const who of [alice, bob, carol, dave, erin]) await (await token.connect(who).approve(sunAddr, ethers.MaxUint256)).wait();

  // bodies: two orbits, four satellites, spread over four planets (indices = brief order)
  const NVDA = 0,
    AAPL = 1,
    GOLD = 2,
    TSLA = 3;
  const bal = async (s: typeof alice) => (await token.balanceOf(s.address)) as bigint;
  await (await sun.connect(bob).enter(GOLD, ethers.parseEther("2000000"), true)).wait();
  await (await sun.connect(alice).enter(NVDA, ethers.parseEther("3000000"), true)).wait();
  await (await sun.connect(carol).enter(NVDA, ((await bal(carol)) * 6n) / 10n, false)).wait();
  await (await sun.connect(dave).enter(TSLA, ((await bal(dave)) * 8n) / 10n, false)).wait();
  await (await sun.connect(erin).enter(AAPL, ((await bal(erin)) * 5n) / 10n, false)).wait();
  await (await sun.connect(alice).enter(TSLA, ethers.parseEther("400000"), false)).wait();

  // fees arrive: on the mock, credit the escrow the way Pons' sweeps do; then collect + ignite
  if (!forked) {
    const escrow = await ethers.getContractAt("MockEscrow", await factory.feeEscrow());
    await (await escrow.connect(deployer).credit(sunAddr, { value: ethers.parseEther("0.9") })).wait();
    await (await sun.connect(deployer).collect()).wait();
    // prices: NVDA $181, ETH $2,452 — the wind blows on NVDA, a filler takes part of it
    const pyth = await ethers.getContractAt("MockPyth", pythAddr);
    const now = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
    await (
      await pyth.updatePriceFeeds([
        await pyth.encode(LIT[NVDA].pythId, usd(181), 0n, -8, now, now - 1n),
        await pyth.encode(LIT[GOLD].pythId, usd(372), 0n, -8, now, now - 1n),
        await pyth.encode(LIT[TSLA].pythId, usd(412), 0n, -8, now, now - 1n),
        await pyth.encode(LIT[AAPL].pythId, usd(254), 0n, -8, now, now - 1n),
        await pyth.encode(ETH_PRICE_ID, usd(2452), 0n, -8, now, now - 1n),
      ])
    ).wait();
    const nvda = new ethers.Contract(LIT[NVDA].asset, ERC20_ABI, ethers.provider);
    await (await nvda.connect(filler).mint(filler.address, ethers.parseEther("50"))).wait();
    await (await nvda.connect(filler).approve(sunAddr, ethers.MaxUint256)).wait();
    await network.provider.send("evm_increaseTime", [2 * 3600]);
    await network.provider.send("evm_mine", []);
    const now2 = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
    await (
      await pyth.updatePriceFeeds([
        await pyth.encode(LIT[NVDA].pythId, usd(181), 0n, -8, now2, now2 - 1n),
        await pyth.encode(ETH_PRICE_ID, usd(2452), 0n, -8, now2, now2 - 1n),
      ])
    ).wait();
    await (await sun.connect(filler).refuel(NVDA, ethers.parseEther("1.5"), 0, [])).wait();
    // a day passes so the satellites may leave; more fees land
    await network.provider.send("evm_increaseTime", [86_400 + 600]);
    await network.provider.send("evm_mine", []);
    await (await escrow.connect(deployer).credit(sunAddr, { value: ethers.parseEther("0.35") })).wait();
    await (await sun.connect(deployer).collect()).wait();
  } else {
    await (await sun.connect(deployer).collect()).wait();
  }

  const planets = await sun.system();
  console.log("planets:");
  for (const p of planets as unknown as { symbol: string; staked: bigint; mass: bigint; bodies: bigint; orbitsClaimed: bigint; ethPending: bigint; assetDelivered: bigint }[]) {
    console.log(`  ${p.symbol.padEnd(5)} staked ${ethers.formatEther(p.staked).padStart(14)} mass ${ethers.formatEther(p.mass).padStart(14)} bodies ${p.bodies} orbits ${p.orbitsClaimed} pending ${ethers.formatEther(p.ethPending)} ETH delivered ${ethers.formatEther(p.assetDelivered)}`);
  }
  console.log(`corona ${ethers.formatEther(await sun.corona())} ETH · pending ${ethers.formatEther(await sun.totalPending())} ETH`);
  console.log(`alice pending on NVDA: ${(await sun.pendingOf(alice.address, NVDA)).map((v: bigint) => ethers.formatEther(v)).join(" / ")}`);

  console.log(`\nNEXT_PUBLIC_RPC_URL=http://127.0.0.1:${PORT}`);
  if (!forked) console.log(`NEXT_PUBLIC_SUN=${sunAddr}`);
  console.log(`NEXT_PUBLIC_DEV_WALLET=1`);
  console.log(`test wallet (unlocked): ${alice.address} — ${ethers.formatEther(await token.balanceOf(alice.address))} ORBIT free`);
  serve();
  await new Promise(() => {});
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
