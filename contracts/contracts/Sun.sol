// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPonsFactoryV2, IPonsLaunchForwarder, IPonsFeeEscrow} from "./interfaces/IPonsV2.sol";
import {IPyth, PythStructs} from "./interfaces/IPyth.sol";

/**
 * ORBIT — own the financial system.
 *
 * The market as a solar system. This contract is the Sun: the treasury at
 * the centre. Around it, planets — one per asset issued on Robinhood Chain
 * (NVDA, AAPL, GLD, TSLA, META… any 18-decimal token with a Pyth price),
 * and anyone may deploy one: the k-th planet lit takes the k-th orbit.
 * Holders of $ORBIT choose a planet and put their tokens in orbit around
 * it, either as a satellite (free to leave after a day) or as one of the
 * planet's twelve orbits (locked for one revolution of that planet, twice
 * the gravity).
 *
 * Gravity is the whole mechanic. Every trade of $ORBIT on its Pons V2
 * curve pays creator fees to the Sun, in ETH. The Sun splits that ETH
 * between the planets in proportion to their mass — the gravity-weighted
 * $ORBIT parked around each one. Each planet's ETH is then turned into the
 * planet's own asset by the solar wind: anyone may deliver the asset and
 * take the ETH at the Pyth price, with a discount that ramps from 0 to 5%
 * over six hours until somebody does. The asset delivered is owed to the
 * planet's bodies pro rata to their gravity, and harvested on demand.
 *
 * Because flow follows mass and payout follows mass, every planet yields
 * the same per unit of gravity. Choosing a planet is not a yield chase; it
 * is choosing the asset you are paid in.
 *
 * No owner, no admin, no pause, no upgrade. The oracle, the escrow and the
 * launch parameters are fixed at construction, planets are added by whoever
 * pays their fee, and the contract's address is deterministic (CREATE2
 * through Arachnid's proxy), so the site knows it before it exists and
 * anyone may put it on the chain.
 */
contract Sun is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ───────────────────────────────────────────── constants ──

    /// The sky holds at most this many planets — every interaction walks
    /// them all to allot the Sun's ETH, so the count is bounded.
    uint8 public constant MAX_PLANETS = 48;
    uint8 public constant ORBITS_PER_PLANET = 12;

    /// Lighting a planet costs this much, paid to the Sun (it joins the
    /// corona and is allotted to the planets already shining).
    uint256 public constant PLANET_FEE = 0.01 ether;

    /// The k-th planet lit sits on the k-th orbit and locks its orbits for
    /// (k + 1) × BASE_PERIOD, up to MAX_PERIOD: the farther out, the slower.
    uint32 public constant BASE_PERIOD = 7 days;
    uint32 public constant MAX_PERIOD = 91 days;

    /// Gravity multipliers: an orbit weighs twice a satellite.
    uint256 public constant SATELLITE_GRAVITY = 1;
    uint256 public constant ORBIT_GRAVITY = 2;

    /// Minimum $ORBIT to hold an orbit (0.05% of the launch supply) and to
    /// fly as a satellite.
    uint256 public constant ORBIT_MIN = 500_000 ether;
    uint256 public constant SATELLITE_MIN = 1_000 ether;

    /// A satellite cannot leave for a day after its last deposit.
    uint64 public constant SATELLITE_COOLDOWN = 1 days;

    /// Solar wind: the discount on the oracle price offered to whoever
    /// delivers a planet's asset for its pending ETH ramps linearly from 0
    /// to WIND_MAX_BPS over WIND_RAMP, and resets after every delivery.
    uint256 public constant WIND_MAX_BPS = 500;
    uint64 public constant WIND_RAMP = 6 hours;

    /// If nobody has delivered for this long, a planet's pending ETH can be
    /// vented to its bodies as ETH instead — the oracle is not a single
    /// point of failure for the money.
    uint64 public constant WIND_STALL = 30 days;

    /// Oldest Pyth price the wind accepts, in seconds.
    uint256 public constant PRICE_MAX_AGE = 120;

    /// Extra tax on every $ORBIT trade, paid by Pons to the Sun on top of
    /// its share of the base fee.
    uint16 public constant CREATOR_TAX_BPS = 100;

    string public constant TOKEN_NAME = "ORBIT";
    string public constant TOKEN_SYMBOL = "ORBIT";
    string public constant TOKEN_DESCRIPTION =
        "Own the financial system. The market as a solar system: the Sun is the treasury, six planets are six assets. Choose your planet. Every trade feeds the Sun; the Sun pays you in the asset you orbit.";

    uint256 private constant ACC = 1e24;
    uint256 private constant BPS = 10_000;

    // ───────────────────────────────────────────── types ──

    struct Planet {
        /// The asset the planet pays in — an 18-decimal ERC-20 on this chain.
        address asset;
        /// Pyth price id of the asset in USD, chosen by whoever lit the planet.
        bytes32 priceId;
        /// Orbital period in seconds — the lock of an orbit.
        uint32 period;
        /// Read from the token itself when the planet was lit.
        string symbol;
        string name;
        address deployedBy;
        uint64 deployedAt;
        /// Raw $ORBIT parked around the planet.
        uint256 staked;
        /// Gravity-weighted $ORBIT — what the Sun's flow follows.
        uint256 mass;
        /// Asset owed per unit of mass, scaled by ACC.
        uint256 accAsset;
        /// ETH owed per unit of mass (vented winds), scaled by ACC.
        uint256 accEth;
        /// ETH allotted by the Sun and not yet turned into the asset.
        uint256 ethPending;
        /// When the current wind started blowing (0 = no pending ETH).
        uint64 windStart;
        uint64 lastRefuel;
        /// Positions currently around the planet.
        uint32 bodies;
        uint8 orbitsClaimed;
        /// Lifetime asset delivered to the planet.
        uint256 assetDelivered;
    }

    struct Body {
        uint256 amount;
        /// Last deposit — the satellite cooldown counts from here.
        uint64 since;
        /// Orbits only: leaving is possible from this time on.
        uint64 lockedUntil;
        /// 0 = satellite, 1..ORBITS_PER_PLANET = the orbit ring held.
        uint8 ring;
        uint256 assetDebt;
        uint256 ethDebt;
        /// Settled and not yet harvested.
        uint256 owedAsset;
        uint256 owedEth;
    }

    // ───────────────────────────────────────────── state ──

    IPonsFactoryV2 public immutable factory;
    IPonsLaunchForwarder public immutable forwarder;
    IPonsFeeEscrow public immutable escrow;
    IPyth public immutable pyth;
    bytes32 public immutable ethPriceId;

    /// $ORBIT and its curve — set once by launch().
    IERC20 public orbit;
    address public curve;
    uint64 public launchedAt;

    Planet[] private _planets;
    /// asset → planet index + 1 (0 = no planet pays in this asset).
    mapping(address asset => uint256 idxPlusOne) private _planetOf;
    mapping(uint8 planet => address[ORBITS_PER_PLANET]) private _rings;
    mapping(address user => mapping(uint8 planet => Body)) private _bodies;

    /// Sum of every planet's ethPending.
    uint256 public totalPending;
    /// ETH vented to bodies and not yet harvested.
    uint256 public ventedReserve;

    // ───────────────────────────────────────────── events ──

    event Launched(address indexed token, address indexed curve, address indexed by, uint256 buyAmount);
    event Collected(uint256 eth);
    event Ignited(uint256 eth);
    event PlanetDeployed(uint8 indexed idx, address indexed asset, address indexed by, bytes32 priceId, uint32 period, string symbol, string name);
    event Entered(address indexed user, uint8 indexed planet, uint256 amount, uint8 ring, uint256 gravity, uint64 lockedUntil);
    event Left(address indexed user, uint8 indexed planet, uint256 amount, uint8 ringReleased);
    event Refueled(uint8 indexed planet, address indexed filler, uint256 assetIn, uint256 ethOut, uint256 discountBps);
    event Vented(uint8 indexed planet, uint256 eth);
    event Harvested(address indexed user, uint8 indexed planet, uint256 asset, uint256 eth);

    // ───────────────────────────────────────────── errors ──

    error ZeroAddress();
    error AlreadyLaunched();
    error NotLaunched();
    error WrongValue(uint256 expected, uint256 sent);
    error UnknownPlanet(uint8 planet);
    error SkyFull();
    error NotAToken(address asset);
    error NotEighteenDecimals(uint8 decimals);
    error PlanetExists(uint8 planet);
    error BelowMinimum(uint256 minimum);
    error NoFreeOrbit(uint8 planet);
    error AlreadyInOrbit(uint8 ring);
    error Locked(uint64 until);
    error Cooling(uint64 until);
    error NothingHere();
    error TooMuch(uint256 held);
    error NothingPending(uint8 planet);
    error NoMass(uint8 planet);
    error BadPrice();
    error Slippage(uint256 ethOut, uint256 minEthOut);
    error NotStalled(uint64 since);
    error EthTransferFailed();

    // ───────────────────────────────────────────── constructor ──

    constructor(IPonsFactoryV2 factory_, IPyth pyth_, bytes32 ethPriceId_) {
        if (address(factory_) == address(0) || address(pyth_) == address(0)) revert ZeroAddress();
        if (ethPriceId_ == bytes32(0)) revert BadPrice();
        factory = factory_;
        forwarder = IPonsLaunchForwarder(factory_.launchForwarder());
        escrow = IPonsFeeEscrow(factory_.feeEscrow());
        if (address(forwarder) == address(0) || address(escrow) == address(0)) revert ZeroAddress();
        pyth = pyth_;
        ethPriceId = ethPriceId_;
    }

    // ───────────────────────────────────────────── planets ──

    /**
     * Light a planet: from now on the Sun pays bodies around it in `asset`,
     * priced by Pyth feed `priceId`. Anyone, for PLANET_FEE. The asset must
     * be a contract with 18 decimals (the wind's arithmetic assumes it) that
     * no planet pays in yet, and cannot be $ORBIT itself. Its symbol and
     * name are read from the token, not typed in. The planet takes the next
     * orbit out: index k, period (k + 1) × 7 days, at most 91.
     *
     * The Sun cannot tell a Robinhood stock token from a copy with the same
     * name — nobody on chain can. The site marks the assets it has checked;
     * an unknown asset is shown as such. Whoever orbits a planet chooses to
     * be paid in its asset, whatever it is.
     */
    function deployPlanet(address asset, bytes32 priceId) external payable nonReentrant returns (uint8 idx) {
        if (_planets.length >= MAX_PLANETS) revert SkyFull();
        if (asset == address(0) || asset.code.length == 0 || asset == address(orbit)) revert NotAToken(asset);
        if (_planetOf[asset] != 0) revert PlanetExists(uint8(_planetOf[asset] - 1));
        if (priceId == bytes32(0)) revert BadPrice();
        if (msg.value != PLANET_FEE) revert WrongValue(PLANET_FEE, msg.value);
        uint8 decimals = IERC20Metadata(asset).decimals();
        if (decimals != 18) revert NotEighteenDecimals(decimals);

        idx = uint8(_planets.length);
        _planets.push();
        Planet storage p = _planets[idx];
        p.asset = asset;
        p.priceId = priceId;
        p.period = periodFor(idx);
        p.symbol = IERC20Metadata(asset).symbol();
        p.name = IERC20Metadata(asset).name();
        p.deployedBy = msg.sender;
        p.deployedAt = uint64(block.timestamp);
        _planetOf[asset] = idx + 1;
        emit PlanetDeployed(idx, asset, msg.sender, priceId, p.period, p.symbol, p.name);
        // The fee is treasury now; the planets already shining share it.
        _ignite();
    }

    /// The orbit lock of the planet at `idx`: (idx + 1) × 7 days, capped at 91.
    function periodFor(uint256 idx) public pure returns (uint32) {
        uint256 period = uint256(BASE_PERIOD) * (idx + 1);
        return uint32(period > MAX_PERIOD ? MAX_PERIOD : period);
    }

    /// Creator fees claimed from Pons' escrow, and anything else anyone
    /// wants to give the Sun.
    receive() external payable {}

    // ───────────────────────────────────────────── launch ──

    /**
     * Put $ORBIT on Pons V2 with the Sun as its creator-fee recipient. Once,
     * by anyone: send `factory.launchFee() + buyAmount`. With a first buy
     * the launch goes through Pons' forwarder (token, curve and buy in one
     * transaction, the tokens to the caller, who is exempt from the launch
     * snipe tax). `logo` and `website` are the only free parameters; name,
     * ticker, description and the tax are fixed here.
     */
    function launch(string calldata logo, string calldata website, uint256 buyAmount, uint256 minTokensOut)
        external
        payable
        nonReentrant
        returns (address token, address curve_)
    {
        if (address(orbit) != address(0)) revert AlreadyLaunched();
        uint256 expected = factory.launchFee() + buyAmount;
        if (msg.value != expected) revert WrongValue(expected, msg.value);

        IPonsFactoryV2.LaunchParams memory params = IPonsFactoryV2.LaunchParams({
            name: TOKEN_NAME,
            symbol: TOKEN_SYMBOL,
            logo: logo,
            description: TOKEN_DESCRIPTION,
            socials: IPonsFactoryV2.Socials({x: "", telegram: "", website: website, discord: "", extra: ""}),
            creatorFeeRecipient: address(this),
            creatorTaxBps: CREATOR_TAX_BPS,
            buybackEnabled: false,
            economicsHash: factory.previewLaunchEconomics(0, address(0)),
            salt: keccak256(abi.encode("ORBIT:sun:v1", block.chainid))
        });
        address[] memory exempt = new address[](0);

        if (buyAmount > 0) {
            (token, curve_) = forwarder.launchAndBuy{value: msg.value}(params, 0, address(0), buyAmount, minTokensOut, msg.sender, exempt);
        } else {
            (token, curve_) = factory.launchToken{value: msg.value}(params, 0, address(0), exempt);
        }
        orbit = IERC20(token);
        curve = curve_;
        launchedAt = uint64(block.timestamp);
        emit Launched(token, curve_, msg.sender, buyAmount);
    }

    // ───────────────────────────────────────────── the sun ──

    /// Pull the creator fees Pons has swept to the escrow, then allot.
    function collect() external nonReentrant {
        uint256 before = address(this).balance;
        try escrow.claim() {} catch {}
        emit Collected(address(this).balance - before);
        _ignite();
    }

    /// Allot the Sun's unallotted ETH to the planets by mass. Called on
    /// every interaction; callable by anyone.
    function ignite() external nonReentrant {
        _ignite();
    }

    function _ignite() internal {
        uint256 mass;
        uint256 count = _planets.length;
        // A planet everybody left gives its ETH back to the Sun.
        for (uint256 i = 0; i < count; i++) {
            Planet storage p = _planets[i];
            if (p.mass == 0 && p.ethPending > 0) {
                totalPending -= p.ethPending;
                p.ethPending = 0;
                p.windStart = 0;
            }
            mass += p.mass;
        }
        uint256 free = address(this).balance - totalPending - ventedReserve;
        if (free == 0 || mass == 0) return;
        uint256 allotted;
        for (uint256 i = 0; i < count; i++) {
            Planet storage p = _planets[i];
            if (p.mass == 0) continue;
            uint256 share = (free * p.mass) / mass;
            if (share == 0) continue;
            if (p.ethPending == 0) p.windStart = uint64(block.timestamp);
            p.ethPending += share;
            allotted += share;
        }
        totalPending += allotted;
        emit Ignited(allotted);
    }

    /// ETH the Sun holds that no planet has been allotted yet.
    function corona() external view returns (uint256) {
        return address(this).balance - totalPending - ventedReserve;
    }

    // ───────────────────────────────────────────── bodies ──

    /**
     * Park `amount` $ORBIT around planet `idx`. As a satellite: any amount
     * ≥ SATELLITE_MIN, gravity ×1, leave after a day. As an orbit: total
     * ≥ ORBIT_MIN, the lowest free ring of the planet's twelve, gravity ×2,
     * locked for one orbital period from this deposit. A satellite that
     * deposits again with `asOrbit` becomes an orbit; an orbit cannot take
     * satellite deposits — every deposit into it renews its lock.
     */
    function enter(uint8 idx, uint256 amount, bool asOrbit) external nonReentrant {
        if (address(orbit) == address(0)) revert NotLaunched();
        Planet storage p = _planet(idx);
        if (amount == 0) revert BelowMinimum(SATELLITE_MIN);

        _ignite();
        Body storage b = _bodies[msg.sender][idx];
        _settle(b, p);

        uint256 oldGravity = _gravity(b);
        if (b.amount == 0) p.bodies += 1;

        if (asOrbit) {
            if (b.amount + amount < ORBIT_MIN) revert BelowMinimum(ORBIT_MIN);
            if (b.ring == 0) {
                b.ring = _claimRing(idx, msg.sender);
                p.orbitsClaimed += 1;
            }
            b.lockedUntil = uint64(block.timestamp) + p.period;
        } else {
            if (b.ring != 0) revert AlreadyInOrbit(b.ring);
            if (b.amount + amount < SATELLITE_MIN) revert BelowMinimum(SATELLITE_MIN);
        }
        b.amount += amount;
        b.since = uint64(block.timestamp);

        uint256 newGravity = _gravity(b);
        p.staked += amount;
        p.mass = p.mass + newGravity - oldGravity;
        _resetDebt(b, p);

        orbit.safeTransferFrom(msg.sender, address(this), amount);
        emit Entered(msg.sender, idx, amount, b.ring, newGravity, b.lockedUntil);
    }

    /**
     * Take `amount` $ORBIT back. Satellites after their cooldown, orbits
     * after their lock. What stays must still meet the minimum; an orbit
     * that leaves entirely releases its ring.
     */
    function leave(uint8 idx, uint256 amount) external nonReentrant {
        Planet storage p = _planet(idx);
        Body storage b = _bodies[msg.sender][idx];
        if (b.amount == 0) revert NothingHere();
        if (amount == 0 || amount > b.amount) revert TooMuch(b.amount);

        _ignite();
        _settle(b, p);

        uint256 oldGravity = _gravity(b);
        uint256 remaining = b.amount - amount;
        uint8 released;
        if (b.ring != 0) {
            if (block.timestamp < b.lockedUntil) revert Locked(b.lockedUntil);
            if (remaining == 0) {
                released = b.ring;
                _rings[idx][b.ring - 1] = address(0);
                p.orbitsClaimed -= 1;
                b.ring = 0;
                b.lockedUntil = 0;
            } else if (remaining < ORBIT_MIN) {
                revert BelowMinimum(ORBIT_MIN);
            }
        } else {
            uint64 until = b.since + SATELLITE_COOLDOWN;
            if (block.timestamp < until) revert Cooling(until);
            if (remaining != 0 && remaining < SATELLITE_MIN) revert BelowMinimum(SATELLITE_MIN);
        }
        b.amount = remaining;
        if (remaining == 0) p.bodies -= 1;

        uint256 newGravity = _gravity(b);
        p.staked -= amount;
        p.mass = p.mass + newGravity - oldGravity;
        _resetDebt(b, p);

        orbit.safeTransfer(msg.sender, amount);
        emit Left(msg.sender, idx, amount, released);
    }

    /// Take what planet `idx` owes you: its asset, and ETH if a wind was vented.
    function harvest(uint8 idx) external nonReentrant {
        _ignite();
        _harvest(idx);
    }

    function harvestAll() external nonReentrant {
        _ignite();
        uint256 count = _planets.length;
        for (uint8 i = 0; i < count; i++) {
            _harvest(i);
        }
    }

    function _harvest(uint8 idx) internal {
        Planet storage p = _planets[idx];
        Body storage b = _bodies[msg.sender][idx];
        _settle(b, p);
        uint256 asset = b.owedAsset;
        uint256 eth = b.owedEth;
        if (asset == 0 && eth == 0) return;
        b.owedAsset = 0;
        b.owedEth = 0;
        if (asset > 0) IERC20(p.asset).safeTransfer(msg.sender, asset);
        if (eth > 0) {
            ventedReserve -= eth;
            _pay(msg.sender, eth);
        }
        emit Harvested(msg.sender, idx, asset, eth);
    }

    // ───────────────────────────────────────────── solar wind ──

    /**
     * Deliver `assetAmount` of planet `idx`'s asset and take its pending
     * ETH at the Pyth price plus the current wind discount. Fills are
     * capped at the pending ETH (the asset actually taken is returned).
     * `priceUpdate` is passed to Pyth first when given (the update fee is
     * msg.value); with none, the prices already on chain must be fresh.
     */
    function refuel(uint8 idx, uint256 assetAmount, uint256 minEthOut, bytes[] calldata priceUpdate)
        external
        payable
        nonReentrant
        returns (uint256 assetTaken, uint256 ethOut)
    {
        Planet storage p = _planet(idx);
        if (assetAmount == 0) revert BadPrice();

        // The update fee leaves before the Sun counts its balance, so the
        // filler's msg.value is never mistaken for treasury.
        if (priceUpdate.length > 0) {
            uint256 fee = pyth.getUpdateFee(priceUpdate);
            if (msg.value != fee) revert WrongValue(fee, msg.value);
            pyth.updatePriceFeeds{value: fee}(priceUpdate);
        } else if (msg.value != 0) {
            revert WrongValue(0, msg.value);
        }

        _ignite();
        if (p.ethPending == 0) revert NothingPending(idx);
        if (p.mass == 0) revert NoMass(idx);

        uint256 discount = windDiscountBps(idx);
        (assetTaken, ethOut) = _quote(p, assetAmount, discount, true);
        if (ethOut < minEthOut) revert Slippage(ethOut, minEthOut);

        p.ethPending -= ethOut;
        totalPending -= ethOut;
        p.accAsset += (assetTaken * ACC) / p.mass;
        p.assetDelivered += assetTaken;
        p.lastRefuel = uint64(block.timestamp);
        p.windStart = p.ethPending == 0 ? 0 : uint64(block.timestamp);

        IERC20(p.asset).safeTransferFrom(msg.sender, address(this), assetTaken);
        _pay(msg.sender, ethOut);
        emit Refueled(idx, msg.sender, assetTaken, ethOut, discount);
    }

    /// Nobody delivered for WIND_STALL: hand the planet's pending ETH to its
    /// bodies as ETH, pro rata to gravity.
    function vent(uint8 idx) external nonReentrant {
        Planet storage p = _planet(idx);
        _ignite();
        if (p.ethPending == 0) revert NothingPending(idx);
        if (p.mass == 0) revert NoMass(idx);
        if (block.timestamp < p.windStart + WIND_STALL) revert NotStalled(p.windStart);
        uint256 eth = p.ethPending;
        p.ethPending = 0;
        p.windStart = 0;
        totalPending -= eth;
        ventedReserve += eth;
        p.accEth += (eth * ACC) / p.mass;
        emit Vented(idx, eth);
    }

    /// The wind's current discount on planet `idx`, in basis points.
    function windDiscountBps(uint8 idx) public view returns (uint256) {
        Planet storage p = _planets[idx];
        if (p.ethPending == 0 || p.windStart == 0) return 0;
        uint256 elapsed = block.timestamp - p.windStart;
        if (elapsed >= WIND_RAMP) return WIND_MAX_BPS;
        return (WIND_MAX_BPS * elapsed) / WIND_RAMP;
    }

    /// What delivering `assetAmount` to planet `idx` would take and pay
    /// right now, from the prices already on chain (no freshness check —
    /// a quote for the screen, not the trade).
    function quoteRefuel(uint8 idx, uint256 assetAmount)
        external
        view
        returns (uint256 assetTaken, uint256 ethOut, uint256 discountBps)
    {
        Planet storage p = _planet(idx);
        if (p.ethPending == 0 || assetAmount == 0) return (0, 0, 0);
        discountBps = windDiscountBps(idx);
        (assetTaken, ethOut) = _quote(p, assetAmount, discountBps, false);
    }

    function _quote(Planet storage p, uint256 assetAmount, uint256 discount, bool fresh)
        internal
        view
        returns (uint256 assetTaken, uint256 ethOut)
    {
        uint256 assetUsd = _wad(fresh ? pyth.getPriceNoOlderThan(p.priceId, PRICE_MAX_AGE) : pyth.getPriceUnsafe(p.priceId));
        uint256 ethUsd = _wad(fresh ? pyth.getPriceNoOlderThan(ethPriceId, PRICE_MAX_AGE) : pyth.getPriceUnsafe(ethPriceId));
        // What the Sun pays per unit of asset, in USD: the oracle price plus
        // the discount — the longer the wind has blown, the more ETH per asset.
        uint256 paidUsd = (assetUsd * (BPS + discount)) / BPS;
        ethOut = (assetAmount * paidUsd) / ethUsd;
        assetTaken = assetAmount;
        if (ethOut > p.ethPending) {
            // Scale the delivery down to what the planet can pay.
            assetTaken = (p.ethPending * ethUsd) / paidUsd;
            ethOut = (assetTaken * paidUsd) / ethUsd;
        }
        if (assetTaken == 0 || ethOut == 0) revert BadPrice();
    }

    /// A Pyth price as USD with 18 decimals.
    function _wad(PythStructs.Price memory price) internal pure returns (uint256) {
        if (price.price <= 0) revert BadPrice();
        uint256 raw = uint256(uint64(price.price));
        int32 expo = price.expo;
        if (expo >= 0) {
            if (expo > 18) revert BadPrice();
            return raw * 10 ** (18 + uint32(expo));
        }
        uint32 neg = uint32(-expo);
        if (neg <= 18) return raw * 10 ** (18 - neg);
        if (neg > 36) revert BadPrice();
        return raw / 10 ** (neg - 18);
    }

    // ───────────────────────────────────────────── internals ──

    function _planet(uint8 idx) internal view returns (Planet storage) {
        if (idx >= _planets.length) revert UnknownPlanet(idx);
        return _planets[idx];
    }

    function _gravity(Body storage b) internal view returns (uint256) {
        return b.amount * (b.ring == 0 ? SATELLITE_GRAVITY : ORBIT_GRAVITY);
    }

    /// Move what the accumulators owe this body since its last touch into
    /// its owed buckets.
    function _settle(Body storage b, Planet storage p) internal {
        uint256 g = _gravity(b);
        if (g == 0) return;
        uint256 asset = (g * p.accAsset) / ACC;
        uint256 eth = (g * p.accEth) / ACC;
        if (asset > b.assetDebt) b.owedAsset += asset - b.assetDebt;
        if (eth > b.ethDebt) b.owedEth += eth - b.ethDebt;
        b.assetDebt = asset;
        b.ethDebt = eth;
    }

    function _resetDebt(Body storage b, Planet storage p) internal {
        uint256 g = _gravity(b);
        b.assetDebt = (g * p.accAsset) / ACC;
        b.ethDebt = (g * p.accEth) / ACC;
    }

    function _claimRing(uint8 idx, address who) internal returns (uint8) {
        address[ORBITS_PER_PLANET] storage held = _rings[idx];
        for (uint8 r = 0; r < ORBITS_PER_PLANET; r++) {
            if (held[r] == address(0)) {
                held[r] = who;
                return r + 1;
            }
        }
        revert NoFreeOrbit(idx);
    }

    function _pay(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert EthTransferFailed();
    }

    // ───────────────────────────────────────────── views ──

    function planet(uint8 idx) external view returns (Planet memory) {
        return _planet(idx);
    }

    /// Every planet at once — one call for the whole sky.
    function system() external view returns (Planet[] memory) {
        return _planets;
    }

    function planetCount() external view returns (uint256) {
        return _planets.length;
    }

    /// (true, idx) when a planet pays in `asset`.
    function planetOf(address asset) external view returns (bool exists, uint8 idx) {
        uint256 v = _planetOf[asset];
        return v == 0 ? (false, 0) : (true, uint8(v - 1));
    }

    function totalMass() external view returns (uint256 mass) {
        uint256 count = _planets.length;
        for (uint256 i = 0; i < count; i++) {
            mass += _planets[i].mass;
        }
    }

    /// Who holds each of the planet's twelve rings (address(0) = free).
    function rings(uint8 idx) external view returns (address[ORBITS_PER_PLANET] memory) {
        _planet(idx);
        return _rings[idx];
    }

    function bodyOf(address user, uint8 idx) external view returns (Body memory) {
        _planet(idx);
        return _bodies[user][idx];
    }

    /// What `user` could harvest from planet `idx` right now.
    function pendingOf(address user, uint8 idx) external view returns (uint256 asset, uint256 eth) {
        Planet storage p = _planet(idx);
        Body storage b = _bodies[user][idx];
        asset = b.owedAsset;
        eth = b.owedEth;
        uint256 g = _gravity(b);
        if (g == 0) return (asset, eth);
        uint256 a = (g * p.accAsset) / ACC;
        uint256 e = (g * p.accEth) / ACC;
        if (a > b.assetDebt) asset += a - b.assetDebt;
        if (e > b.ethDebt) eth += e - b.ethDebt;
    }

    function launched() external view returns (bool) {
        return address(orbit) != address(0);
    }
}
