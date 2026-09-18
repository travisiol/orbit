import { expect } from "chai";
import { ethers, network } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import type { Sun, MockPonsFactory, MockPyth, MockERC20, MockCurve, MockEscrow } from "../typechain-types";
import { CATALOG, ETH_PRICE_ID, ZERO_ADDRESS } from "../../src/lib/planets";

const DAY = 86_400n;
const ONE = ethers.parseEther("1");
const ORBIT_MIN = ethers.parseEther("500000");
const SAT_MIN = ethers.parseEther("1000");
const PLANET_FEE = ethers.parseEther("0.01");

/** Planets lit by the fixture, in this order — so idx 0 is TSLA (7-day lock), idx 4 is GLD (35 days). */
const LIT = ["TSLA", "META", "AAPL", "NVDA", "GLD"] as const;
const TSLA = 0;
const META = 1;
const NVDA = 3;
const GOLD = 4;
const NONE = 5;

const spec = (symbol: string) => CATALOG.find((c) => c.symbol === symbol)!;

/** Pyth prices with expo -8, the way the equity and ETH feeds publish. */
const usd = (n: number) => BigInt(Math.round(n * 1e8));

async function deployAll() {
  const [deployer, alice, bob, carol, filler, sink] = await ethers.getSigners();

  const Factory = await ethers.getContractFactory("MockPonsFactory");
  const factory = (await Factory.deploy(sink.address)) as unknown as MockPonsFactory;
  const escrow = (await ethers.getContractAt("MockEscrow", await factory.feeEscrow())) as unknown as MockEscrow;

  const Pyth = await ethers.getContractFactory("MockPyth");
  const pyth = (await Pyth.deploy(0)) as unknown as MockPyth;

  const Token = await ethers.getContractFactory("MockERC20");
  const assets: Record<number, MockERC20> = {};
  const pythIds: Record<number, string> = {};

  const Sun = await ethers.getContractFactory("Sun");
  const sun = (await Sun.deploy(await factory.getAddress(), await pyth.getAddress(), ETH_PRICE_ID)) as unknown as Sun;

  // anyone lights the planets — here the deployer, one fee each
  for (let i = 0; i < LIT.length; i++) {
    const c = spec(LIT[i]);
    const t = (await Token.deploy(`${c.name} • Robinhood Token`, c.symbol)) as unknown as MockERC20;
    assets[i] = t;
    pythIds[i] = c.pythId;
    await sun.connect(deployer).deployPlanet(await t.getAddress(), c.pythId, { value: PLANET_FEE });
  }

  return { deployer, alice, bob, carol, filler, sink, factory, escrow, pyth, assets, pythIds, sun, Token };
}

/** Deployed, planets lit, and launched by alice with a 1 ETH first buy, then bob and carol buy too. */
async function launched() {
  const ctx = await deployAll();
  const { sun, alice, bob, carol, factory } = ctx;
  const fee = await factory.launchFee();
  await sun.connect(alice).launch("https://orbit.example/orbit-logo.png", "https://orbit.example", ONE, 0, { value: fee + ONE });
  const orbit = (await ethers.getContractAt("MockERC20", await sun.orbit())) as unknown as MockERC20;
  const curve = (await ethers.getContractAt("MockCurve", await sun.curve())) as unknown as MockCurve;
  await curve.connect(bob).buy(ONE, 0, bob.address, { value: ONE });
  await curve.connect(carol).buy(ONE, 0, carol.address, { value: ONE });
  const sunAddr = await sun.getAddress();
  for (const who of [alice, bob, carol]) await orbit.connect(who).approve(sunAddr, ethers.MaxUint256);
  // the planet fees sat in the corona with nobody to allot to; drain them so the wind tests start clean
  return { ...ctx, orbit, curve, sunAddr };
}

async function setPrices(pyth: MockPyth, prices: Record<string, number>) {
  const now = BigInt(await time.latest());
  const updates: string[] = [];
  for (const [id, price] of Object.entries(prices)) {
    updates.push(await pyth.encode(id, usd(price), 0n, -8, now, now - 1n));
  }
  await pyth.updatePriceFeeds(updates);
}

describe("Sun", () => {
  describe("planets", () => {
    it("are lit by anyone for the fee, take the next orbit, and read their names from the token", async () => {
      const { sun, deployer } = await loadFixture(deployAll);
      expect(await sun.planetCount()).to.equal(5);
      const tsla = await sun.planet(TSLA);
      expect(tsla.symbol).to.equal("TSLA");
      expect(tsla.name).to.equal("Tesla • Robinhood Token");
      expect(tsla.period).to.equal(7n * DAY);
      expect(tsla.deployedBy).to.equal(deployer.address);
      expect((await sun.planet(GOLD)).period).to.equal(35n * DAY);
      expect(await sun.periodFor(12)).to.equal(91n * DAY);
      expect(await sun.periodFor(40)).to.equal(91n * DAY);
      const [exists, idx] = await sun.planetOf(tsla.asset);
      expect(exists).to.equal(true);
      expect(idx).to.equal(TSLA);
      expect((await sun.planetOf(deployer.address))[0]).to.equal(false);
      expect((await sun.system()).length).to.equal(5);
    });

    it("refuses wrong fees, non-tokens, duplicates, odd decimals, a zero feed and $ORBIT itself", async () => {
      const { sun, alice, assets, factory, Token } = await loadFixture(deployAll);
      const fresh = (await Token.deploy("Fresh • Robinhood Token", "FRSH")) as unknown as MockERC20;
      const freshAddr = await fresh.getAddress();
      const feed = spec("SPY").pythId;
      await expect(sun.connect(alice).deployPlanet(freshAddr, feed, { value: PLANET_FEE - 1n })).to.be.revertedWithCustomError(sun, "WrongValue");
      await expect(sun.connect(alice).deployPlanet(alice.address, feed, { value: PLANET_FEE })).to.be.revertedWithCustomError(sun, "NotAToken");
      await expect(sun.connect(alice).deployPlanet(ZERO_ADDRESS, feed, { value: PLANET_FEE })).to.be.revertedWithCustomError(sun, "NotAToken");
      await expect(sun.connect(alice).deployPlanet(await assets[NVDA].getAddress(), feed, { value: PLANET_FEE })).to.be.revertedWithCustomError(sun, "PlanetExists").withArgs(NVDA);
      await expect(sun.connect(alice).deployPlanet(freshAddr, ethers.ZeroHash, { value: PLANET_FEE })).to.be.revertedWithCustomError(sun, "BadPrice");
      const six = await (await ethers.getContractFactory("MockERC20Decimals")).deploy("Six", "SIX", 6);
      await expect(sun.connect(alice).deployPlanet(await six.getAddress(), feed, { value: PLANET_FEE })).to.be.revertedWithCustomError(sun, "NotEighteenDecimals").withArgs(6);

      const fee = await factory.launchFee();
      await sun.connect(alice).launch("", "", 0, 0, { value: fee });
      await expect(sun.connect(alice).deployPlanet(await sun.orbit(), feed, { value: PLANET_FEE })).to.be.revertedWithCustomError(sun, "NotAToken");

      await expect(sun.connect(alice).deployPlanet(freshAddr, feed, { value: PLANET_FEE })).to.emit(sun, "PlanetDeployed").withArgs(5, freshAddr, alice.address, feed, 42n * DAY, "FRSH", "Fresh • Robinhood Token");
    });

    it("pays its fee to the Sun, which allots it to the planets already shining", async () => {
      const { sun, alice, bob, Token } = await loadFixture(launched);
      // nothing orbits yet: the five fees wait in the corona
      expect(await sun.corona()).to.equal(PLANET_FEE * 5n);
      await sun.connect(alice).enter(NVDA, SAT_MIN, false);
      await sun.ignite();
      expect((await sun.planet(NVDA)).ethPending).to.equal(PLANET_FEE * 5n);
      const t = (await Token.deploy("Sixth", "SIX6")) as unknown as MockERC20;
      await sun.connect(bob).deployPlanet(await t.getAddress(), spec("SPY").pythId, { value: PLANET_FEE });
      // the sixth planet's fee went straight to NVDA, the only planet with mass
      expect((await sun.planet(NVDA)).ethPending).to.equal(PLANET_FEE * 6n);
      expect((await sun.planet(5)).ethPending).to.equal(0n);
    });

    it("holds forty-eight planets, not forty-nine", async () => {
      const { sun, alice, Token } = await loadFixture(deployAll);
      for (let i = 5; i < 48; i++) {
        const t = await Token.deploy(`Planet ${i}`, `P${i}`);
        await sun.connect(alice).deployPlanet(await t.getAddress(), spec("SPY").pythId, { value: PLANET_FEE });
      }
      expect(await sun.planetCount()).to.equal(48);
      expect((await sun.planet(47)).period).to.equal(91n * DAY);
      const t = await Token.deploy("Too many", "P48");
      await expect(sun.connect(alice).deployPlanet(await t.getAddress(), spec("SPY").pythId, { value: PLANET_FEE })).to.be.revertedWithCustomError(sun, "SkyFull");
    });
  });

  describe("launch", () => {
    it("puts $ORBIT on Pons with the Sun as fee recipient, once", async () => {
      const { sun, alice, factory } = await loadFixture(deployAll);
      const fee = await factory.launchFee();
      expect(await sun.launched()).to.equal(false);

      await expect(sun.connect(alice).launch("logo", "site", ONE, 0, { value: fee })).to.be.revertedWithCustomError(sun, "WrongValue");

      await expect(sun.connect(alice).launch("logo", "site", ONE, 0, { value: fee + ONE })).to.emit(sun, "Launched");
      expect(await sun.launched()).to.equal(true);

      const params = await factory.lastParams();
      expect(params.name).to.equal("ORBIT");
      expect(params.symbol).to.equal("ORBIT");
      expect(params.creatorFeeRecipient).to.equal(await sun.getAddress());
      expect(params.creatorTaxBps).to.equal(100);
      expect(params.buybackEnabled).to.equal(false);
      expect(params.logo).to.equal("logo");
      expect(params.socials.website).to.equal("site");
      expect(await factory.lastLauncher()).to.equal(await factory.launchForwarder());

      const orbit = await ethers.getContractAt("MockERC20", await sun.orbit());
      expect(await orbit.balanceOf(alice.address)).to.be.gt(0n);

      await expect(sun.connect(alice).launch("logo", "site", ONE, 0, { value: fee + ONE })).to.be.revertedWithCustomError(sun, "AlreadyLaunched");
    });

    it("can launch without a first buy, straight through the factory", async () => {
      const { sun, alice, factory } = await loadFixture(deployAll);
      const fee = await factory.launchFee();
      await sun.connect(alice).launch("logo", "", 0, 0, { value: fee });
      expect(await factory.lastLauncher()).to.equal(await sun.getAddress());
    });

    it("refuses bodies before the launch", async () => {
      const { sun, alice } = await loadFixture(deployAll);
      await expect(sun.connect(alice).enter(NVDA, SAT_MIN, false)).to.be.revertedWithCustomError(sun, "NotLaunched");
    });
  });

  describe("bodies", () => {
    it("launches a satellite: mass ×1, a day's cooldown, minimum size", async () => {
      const { sun, alice, orbit } = await loadFixture(launched);
      await expect(sun.connect(alice).enter(NVDA, SAT_MIN - 1n, false)).to.be.revertedWithCustomError(sun, "BelowMinimum");
      await expect(sun.connect(alice).enter(NVDA, SAT_MIN, false)).to.emit(sun, "Entered");
      const p = await sun.planet(NVDA);
      expect(p.staked).to.equal(SAT_MIN);
      expect(p.mass).to.equal(SAT_MIN);
      expect(p.bodies).to.equal(1);
      const b = await sun.bodyOf(alice.address, NVDA);
      expect(b.ring).to.equal(0);
      expect(b.amount).to.equal(SAT_MIN);
      expect(await orbit.balanceOf(await sun.getAddress())).to.equal(SAT_MIN);

      await expect(sun.connect(alice).leave(NVDA, SAT_MIN)).to.be.revertedWithCustomError(sun, "Cooling");
      await time.increase(DAY);
      // What stays must still be a satellite.
      await expect(sun.connect(alice).leave(NVDA, 1n)).to.be.revertedWithCustomError(sun, "BelowMinimum");
      await expect(sun.connect(alice).leave(NVDA, SAT_MIN)).to.emit(sun, "Left");
      expect((await sun.planet(NVDA)).bodies).to.equal(0);
      expect((await sun.planet(NVDA)).mass).to.equal(0);
    });

    it("knows no planet beyond the ones lit", async () => {
      const { sun, alice } = await loadFixture(launched);
      await expect(sun.connect(alice).enter(NONE, SAT_MIN, false)).to.be.revertedWithCustomError(sun, "UnknownPlanet");
      await expect(sun.planet(NONE)).to.be.revertedWithCustomError(sun, "UnknownPlanet");
      await expect(sun.rings(NONE)).to.be.revertedWithCustomError(sun, "UnknownPlanet");
    });

    it("claims orbits: ring by ring, ×2 gravity, locked one period", async () => {
      const { sun, alice, bob } = await loadFixture(launched);
      const period = (await sun.planet(TSLA)).period;
      await expect(sun.connect(alice).enter(TSLA, ORBIT_MIN - 1n, true)).to.be.revertedWithCustomError(sun, "BelowMinimum");
      const tx = await sun.connect(alice).enter(TSLA, ORBIT_MIN, true);
      const at = BigInt((await tx.getBlock())!.timestamp);
      const a = await sun.bodyOf(alice.address, TSLA);
      expect(a.ring).to.equal(1);
      expect(a.lockedUntil).to.equal(at + period);
      await sun.connect(bob).enter(TSLA, ORBIT_MIN, true);
      expect((await sun.bodyOf(bob.address, TSLA)).ring).to.equal(2);
      const p = await sun.planet(TSLA);
      expect(p.mass).to.equal(ORBIT_MIN * 4n);
      expect(p.staked).to.equal(ORBIT_MIN * 2n);
      expect(p.orbitsClaimed).to.equal(2);
      const rings = await sun.rings(TSLA);
      expect(rings[0]).to.equal(alice.address);
      expect(rings[1]).to.equal(bob.address);
      expect(rings[2]).to.equal(ZERO_ADDRESS);

      // An orbit takes no satellite deposits, and cannot leave while locked.
      await expect(sun.connect(alice).enter(TSLA, SAT_MIN, false)).to.be.revertedWithCustomError(sun, "AlreadyInOrbit");
      await expect(sun.connect(alice).leave(TSLA, ORBIT_MIN)).to.be.revertedWithCustomError(sun, "Locked");

      await time.increase(period);
      // Partial leave must keep the orbit above its minimum…
      await expect(sun.connect(alice).leave(TSLA, 1n)).to.be.revertedWithCustomError(sun, "BelowMinimum");
      // …a full leave releases the ring.
      await expect(sun.connect(alice).leave(TSLA, ORBIT_MIN)).to.emit(sun, "Left").withArgs(alice.address, TSLA, ORBIT_MIN, 1);
      expect((await sun.rings(TSLA))[0]).to.equal(ZERO_ADDRESS);
      expect((await sun.planet(TSLA)).orbitsClaimed).to.equal(1);
      expect((await sun.planet(TSLA)).mass).to.equal(ORBIT_MIN * 2n);
      // The freed ring is the next one handed out.
      await sun.connect(alice).enter(TSLA, ORBIT_MIN, true);
      expect((await sun.bodyOf(alice.address, TSLA)).ring).to.equal(1);
    });

    it("renews an orbit's lock on every deposit, and turns a satellite into an orbit", async () => {
      const { sun, alice } = await loadFixture(launched);
      const period = (await sun.planet(META)).period;
      expect(period).to.equal(14n * DAY);
      await sun.connect(alice).enter(META, SAT_MIN, false);
      const tx = await sun.connect(alice).enter(META, ORBIT_MIN, true);
      const at = BigInt((await tx.getBlock())!.timestamp);
      const b = await sun.bodyOf(alice.address, META);
      expect(b.ring).to.equal(1);
      expect(b.amount).to.equal(ORBIT_MIN + SAT_MIN);
      expect(b.lockedUntil).to.equal(at + period);
      expect((await sun.planet(META)).mass).to.equal((ORBIT_MIN + SAT_MIN) * 2n);
      expect((await sun.planet(META)).bodies).to.equal(1);

      await time.increase(10n * DAY);
      const tx2 = await sun.connect(alice).enter(META, SAT_MIN, true);
      const at2 = BigInt((await tx2.getBlock())!.timestamp);
      expect((await sun.bodyOf(alice.address, META)).lockedUntil).to.equal(at2 + period);
    });

    it("has twelve orbits per planet, not thirteen", async () => {
      const { sun, alice, orbit } = await loadFixture(launched);
      const signers = (await ethers.getSigners()).slice(6, 19);
      for (const s of signers) {
        await orbit.connect(alice).transfer(s.address, ORBIT_MIN);
        await orbit.connect(s).approve(await sun.getAddress(), ethers.MaxUint256);
      }
      for (let i = 0; i < 12; i++) {
        await sun.connect(signers[i]).enter(GOLD, ORBIT_MIN, true);
      }
      expect((await sun.planet(GOLD)).orbitsClaimed).to.equal(12);
      await expect(sun.connect(signers[12]).enter(GOLD, ORBIT_MIN, true)).to.be.revertedWithCustomError(sun, "NoFreeOrbit");
      // Satellites are unlimited.
      await sun.connect(alice).enter(GOLD, SAT_MIN, false);
      expect((await sun.planet(GOLD)).bodies).to.equal(13);
    });
  });

  describe("the sun", () => {
    it("collects from the escrow and allots by mass", async () => {
      const { sun, alice, bob, escrow, sunAddr } = await loadFixture(launched);
      // the five planet fees are still in the corona: they go out with the first allotment
      const fees = PLANET_FEE * 5n;
      // alice: 1,000 as a satellite around NVDA (mass 1,000)
      // bob: 500,000 in orbit around TSLA (mass 1,000,000)
      await sun.connect(alice).enter(NVDA, SAT_MIN, false);
      await sun.connect(bob).enter(TSLA, ORBIT_MIN, true);
      // entering allots what waited to planets with mass BEFORE the deposit: alice's entry found none,
      // bob's entry found NVDA alone — so NVDA already holds the fees
      expect((await sun.planet(NVDA)).ethPending).to.equal(fees);

      await escrow.credit(sunAddr, { value: ethers.parseEther("1.001") });
      await expect(sun.collect()).to.emit(sun, "Collected").withArgs(ethers.parseEther("1.001"));

      const nvda = await sun.planet(NVDA);
      const tsla = await sun.planet(TSLA);
      expect(nvda.ethPending).to.equal(ethers.parseEther("0.001") + fees);
      expect(tsla.ethPending).to.equal(ethers.parseEther("1"));
      expect(await sun.totalPending()).to.equal(ethers.parseEther("1.001") + fees);
      expect(await sun.corona()).to.equal(0n);
      expect(nvda.windStart).to.be.gt(0n);
      expect((await sun.planet(META)).ethPending).to.equal(0n);
    });

    it("keeps ETH in the corona while nobody orbits, and takes back a deserted planet's ETH", async () => {
      const { sun, alice, sunAddr } = await loadFixture(launched);
      const fees = PLANET_FEE * 5n;
      await alice.sendTransaction({ to: sunAddr, value: ONE });
      await sun.ignite();
      expect(await sun.corona()).to.equal(ONE + fees);
      expect(await sun.totalPending()).to.equal(0n);

      await sun.connect(alice).enter(NVDA, SAT_MIN, false);
      // Entering allots what was waiting — to the planets with mass before the deposit: none.
      expect(await sun.corona()).to.equal(ONE + fees);
      await sun.ignite();
      expect((await sun.planet(NVDA)).ethPending).to.equal(ONE + fees);
      expect(await sun.corona()).to.equal(0n);

      await time.increase(DAY);
      await sun.connect(alice).leave(NVDA, SAT_MIN);
      await sun.ignite();
      expect((await sun.planet(NVDA)).ethPending).to.equal(0n);
      expect(await sun.corona()).to.equal(ONE + fees);
    });
  });

  describe("solar wind", () => {
    async function windy() {
      const ctx = await launched();
      const { sun, alice, bob, escrow, sunAddr, pyth, assets, filler, pythIds } = ctx;
      await sun.connect(alice).enter(NVDA, SAT_MIN, false);
      await sun.connect(bob).enter(NVDA, SAT_MIN * 3n, false);
      // 0.45 from fees + 0.05 of planet fees already in the corona = 0.5 ETH pending on NVDA
      await escrow.credit(sunAddr, { value: ethers.parseEther("0.45") });
      await sun.collect();
      expect((await sun.planet(NVDA)).ethPending).to.equal(ethers.parseEther("0.5"));
      await setPrices(pyth, { [pythIds[NVDA]]: 180, [ETH_PRICE_ID]: 2500 });
      await assets[NVDA].mint(filler.address, ethers.parseEther("100"));
      await assets[NVDA].connect(filler).approve(sunAddr, ethers.MaxUint256);
      return ctx;
    }

    it("pays the filler the oracle price plus the ramping discount, capped at the pending ETH", async () => {
      const { sun, filler, assets, alice, bob, pyth, pythIds } = await loadFixture(windy);
      expect(await sun.windDiscountBps(NVDA)).to.equal(0n);

      // 1 NVDA at $180 / $2,500 = 0.072 ETH, no discount yet.
      const q0 = await sun.quoteRefuel(NVDA, ONE);
      expect(q0.ethOut).to.equal(ethers.parseEther("0.072"));
      expect(q0.assetTaken).to.equal(ONE);

      await time.increase(3n * 3600n);
      expect(await sun.windDiscountBps(NVDA)).to.equal(250n);
      const q1 = await sun.quoteRefuel(NVDA, ONE);
      expect(q1.ethOut).to.equal(ethers.parseEther("0.0738")); // 0.072 × 1.025

      // 10 NVDA would be 0.738 ETH; only 0.5 ETH is pending, so the fill is scaled down.
      const q2 = await sun.quoteRefuel(NVDA, ethers.parseEther("10"));
      expect(q2.ethOut).to.be.lte(ethers.parseEther("0.5"));
      expect(q2.ethOut).to.be.gt(ethers.parseEther("0.4999"));
      expect(q2.assetTaken).to.be.lt(ethers.parseEther("10"));

      await setPrices(pyth, { [pythIds[NVDA]]: 180, [ETH_PRICE_ID]: 2500 });
      const before = await ethers.provider.getBalance(filler.address);
      const tx = await sun.connect(filler).refuel(NVDA, ethers.parseEther("10"), q2.ethOut, []);
      const rc = (await tx.wait())!;
      const after = await ethers.provider.getBalance(filler.address);
      expect(after - before + rc.gasUsed * rc.gasPrice).to.equal(q2.ethOut);
      expect(await assets[NVDA].balanceOf(await sun.getAddress())).to.equal(q2.assetTaken);

      const p = await sun.planet(NVDA);
      expect(p.assetDelivered).to.equal(q2.assetTaken);
      expect(p.ethPending).to.equal(ethers.parseEther("0.5") - q2.ethOut);
      expect(await sun.windDiscountBps(NVDA)).to.equal(0n); // the wind restarted
      // alice holds 1/4 of the mass, bob 3/4.
      const [aliceAsset] = await sun.pendingOf(alice.address, NVDA);
      const [bobAsset] = await sun.pendingOf(bob.address, NVDA);
      expect(aliceAsset + bobAsset).to.be.closeTo(q2.assetTaken, 10n);
      expect(bobAsset).to.be.closeTo(aliceAsset * 3n, 10n);

      await expect(sun.connect(alice).harvest(NVDA)).to.emit(sun, "Harvested").withArgs(alice.address, NVDA, aliceAsset, 0n);
      expect(await assets[NVDA].balanceOf(alice.address)).to.equal(aliceAsset);
      expect((await sun.pendingOf(alice.address, NVDA))[0]).to.equal(0n);
    });

    it("saturates the discount at 5% after six hours", async () => {
      const { sun } = await loadFixture(windy);
      await time.increase(6n * 3600n + 1n);
      expect(await sun.windDiscountBps(NVDA)).to.equal(500n);
      await time.increase(30n * 3600n);
      expect(await sun.windDiscountBps(NVDA)).to.equal(500n);
    });

    it("refuses stale prices, slippage, unknown planets and mistaken value", async () => {
      const { sun, filler, pyth, pythIds } = await loadFixture(windy);
      await time.increase(200n);
      await expect(sun.connect(filler).refuel(NVDA, ONE, 0, [])).to.be.revertedWithCustomError(pyth, "StalePrice");

      await setPrices(pyth, { [pythIds[NVDA]]: 180, [ETH_PRICE_ID]: 2500 });
      await expect(sun.connect(filler).refuel(NVDA, ONE, ethers.parseEther("1"), [])).to.be.revertedWithCustomError(sun, "Slippage");
      await expect(sun.connect(filler).refuel(NONE, ONE, 0, [])).to.be.revertedWithCustomError(sun, "UnknownPlanet");
      await expect(sun.connect(filler).refuel(META, ONE, 0, [])).to.be.revertedWithCustomError(sun, "NothingPending");
      await expect(sun.connect(filler).refuel(NVDA, ONE, 0, [], { value: 1n })).to.be.revertedWithCustomError(sun, "WrongValue");
    });

    it("takes a Pyth update along with the fill, and never mistakes its fee for treasury", async () => {
      const { sun, filler, pyth, pythIds } = await loadFixture(windy);
      await pyth.setFee(1000n);
      await time.increase(300n);
      const now = BigInt(await time.latest()) + 1n;
      const updates = [
        await pyth.encode(pythIds[NVDA], usd(200), 0n, -8, now, now - 1n),
        await pyth.encode(ETH_PRICE_ID, usd(2000), 0n, -8, now, now - 1n),
      ];
      await expect(sun.connect(filler).refuel(NVDA, ONE, 0, updates, { value: 1999n })).to.be.revertedWithCustomError(sun, "WrongValue");
      const pendingBefore = (await sun.planet(NVDA)).ethPending;
      await sun.connect(filler).refuel(NVDA, ONE, 0, updates, { value: 2000n });
      const p = await sun.planet(NVDA);
      // The fee left before the Sun counted its balance, so pending moved by the payout only.
      expect(pendingBefore - p.ethPending).to.be.gte(ethers.parseEther("0.1"));
      expect(await sun.corona()).to.equal(0n);
    });

    it("vents a stalled wind as ETH to the bodies", async () => {
      const { sun, alice, bob } = await loadFixture(windy);
      await expect(sun.vent(NVDA)).to.be.revertedWithCustomError(sun, "NotStalled");
      await time.increase(30n * DAY);
      await expect(sun.vent(NVDA)).to.emit(sun, "Vented").withArgs(NVDA, ethers.parseEther("0.5"));
      expect((await sun.planet(NVDA)).ethPending).to.equal(0n);
      expect(await sun.ventedReserve()).to.equal(ethers.parseEther("0.5"));
      const [, aliceEth] = await sun.pendingOf(alice.address, NVDA);
      const [, bobEth] = await sun.pendingOf(bob.address, NVDA);
      expect(aliceEth).to.equal(ethers.parseEther("0.125"));
      expect(bobEth).to.equal(ethers.parseEther("0.375"));

      const before = await ethers.provider.getBalance(alice.address);
      const tx = await sun.connect(alice).harvest(NVDA);
      const rc = (await tx.wait())!;
      const after = await ethers.provider.getBalance(alice.address);
      expect(after - before + rc.gasUsed * rc.gasPrice).to.equal(ethers.parseEther("0.125"));
      expect(await sun.ventedReserve()).to.equal(ethers.parseEther("0.375"));
      expect(await sun.corona()).to.equal(0n);
      // Leaving afterwards still pays bob what he is owed.
      await time.increase(DAY);
      await sun.connect(bob).leave(NVDA, SAT_MIN * 3n);
      await sun.connect(bob).harvestAll();
      expect(await sun.ventedReserve()).to.equal(0n);
    });

    it("yields the same per unit of gravity on every planet", async () => {
      const { sun, alice, bob, escrow, sunAddr, pyth, assets, filler, pythIds } = await loadFixture(launched);
      // alice: 4,000 satellite around NVDA (mass 4,000). bob: 500,000 in orbit around GOLD (mass 1,000,000).
      await sun.connect(alice).enter(NVDA, SAT_MIN * 4n, false);
      // alice's entry found no planet with mass; bob's entry hands the waiting planet fees to NVDA first
      await sun.connect(bob).enter(GOLD, ORBIT_MIN, true);
      const fees = PLANET_FEE * 5n;
      expect((await sun.planet(NVDA)).ethPending).to.equal(fees);
      await escrow.credit(sunAddr, { value: ethers.parseEther("1.004") });
      await sun.collect();
      expect((await sun.planet(NVDA)).ethPending).to.equal(ethers.parseEther("0.004") + fees);
      expect((await sun.planet(GOLD)).ethPending).to.equal(ethers.parseEther("1"));

      await setPrices(pyth, { [pythIds[NVDA]]: 200, [pythIds[GOLD]]: 400, [ETH_PRICE_ID]: 2000 });
      for (const idx of [NVDA, GOLD]) {
        await assets[idx].mint(filler.address, ethers.parseEther("1000"));
        await assets[idx].connect(filler).approve(sunAddr, ethers.MaxUint256);
        await sun.connect(filler).refuel(idx, ethers.parseEther("1000"), 0, []);
        expect((await sun.planet(idx)).ethPending).to.be.lte(1000n);
      }
      const [aliceNvda] = await sun.pendingOf(alice.address, NVDA);
      const [bobGold] = await sun.pendingOf(bob.address, GOLD);
      // Of the 1.004 ETH of fees, alice's gravity share is 0.004 ETH × $2,000 = $8 → 0.04 NVDA (plus the planet fees she alone got);
      // bob: 1 ETH → $2,000 → 5 GLD.
      const aliceFromFees = aliceNvda - (fees * 2000n) / 200n; // planet fees → NVDA at $200, ETH at $2,000
      expect(aliceFromFees).to.be.closeTo(ethers.parseEther("0.04"), 10n ** 12n);
      expect(bobGold).to.be.closeTo(ethers.parseEther("5"), 10n ** 12n);
      // Per unit of gravity, both are worth $8 / 4,000 = $2 / 1,000 = 1 ETH-cent per 1,000 gravity.
      const aliceUsdPerGravity = (aliceFromFees * 200n * 10n ** 18n) / (SAT_MIN * 4n);
      const bobUsdPerGravity = (bobGold * 400n * 10n ** 18n) / (ORBIT_MIN * 2n);
      expect(aliceUsdPerGravity).to.be.closeTo(bobUsdPerGravity, aliceUsdPerGravity / 10_000n);
    });
  });

  describe("deterministic deployment", () => {
    const PROXY = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
    const PROXY_CODE =
      "0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3";

    it("lands on the CREATE2 address the site predicts, from any wallet, once", async () => {
      const { factory, pyth, alice, bob } = await loadFixture(deployAll);
      await network.provider.send("hardhat_setCode", [PROXY, PROXY_CODE]);
      const Sun = await ethers.getContractFactory("Sun");
      const initCode = ethers.concat([Sun.bytecode, Sun.interface.encodeDeploy([await factory.getAddress(), await pyth.getAddress(), ETH_PRICE_ID])]);
      const salt = ethers.keccak256(ethers.toUtf8Bytes("orbit:sun:v1"));
      const predicted = ethers.getCreate2Address(PROXY, salt, ethers.keccak256(initCode));
      expect(await ethers.provider.getCode(predicted)).to.equal("0x");

      await alice.sendTransaction({ to: PROXY, data: ethers.concat([salt, initCode]) });
      expect((await ethers.provider.getCode(predicted)).length).to.be.gt(2);
      const sun = (await ethers.getContractAt("Sun", predicted)) as unknown as Sun;
      expect(await sun.factory()).to.equal(await factory.getAddress());
      expect(await sun.planetCount()).to.equal(0);
      // The proxy refuses the same salt twice.
      await expect(bob.sendTransaction({ to: PROXY, data: ethers.concat([salt, initCode]) })).to.be.reverted;
    });
  });
});
