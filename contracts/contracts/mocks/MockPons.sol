// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPonsFactoryV2, IPonsLaunchForwarder} from "../interfaces/IPonsV2.sol";

/**
 * Just enough Pons to unit-test the Sun: a factory that mints a token
 * and a constant-product curve, a forwarder that launches then buys, and
 * a fee escrow that pays whoever claims. The real thing is exercised on a
 * fork (scripts/fork-check.ts); this mock only checks the Sun's own logic.
 */
contract MockEscrow {
    mapping(address => uint256) public balanceOf;

    /// Credit `who` — what Pons' sweeps do on the real chain.
    function credit(address who) external payable {
        balanceOf[who] += msg.value;
    }

    function claim() external {
        uint256 amount = balanceOf[msg.sender];
        require(amount > 0, "escrow: nothing");
        balanceOf[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "escrow: pay");
    }

    function claimToken(address) external pure {
        revert("escrow: native only");
    }

    function balanceOfToken(address, address) external pure returns (uint256) {
        return 0;
    }
}

contract MockLaunchedToken is ERC20 {
    constructor(string memory name_, string memory symbol_, address to, uint256 supply) ERC20(name_, symbol_) {
        _mint(to, supply);
    }
}

contract MockCurve {
    using SafeERC20 for IERC20;

    uint256 public constant FEE_BPS = 100;
    uint256 public constant VIRTUAL_QUOTE = 1.68 ether;

    address public immutable token;
    address public immutable pairToken;
    address public immutable deployer;
    uint256 public immutable launchSupply;
    uint256 public immutable graduationThreshold;
    uint16 public immutable creatorTaxBps;

    uint256 public realQuoteReserve;
    uint256 public quoteFeeBalance;
    bool public graduated;
    mapping(address => bool) public snipeTaxExempt;

    event CurveBuy(address indexed sender, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 snipeTax);
    event CurveSell(address indexed sender, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 snipeTax);

    constructor(address token_, address pairToken_, address deployer_, uint256 launchSupply_, uint256 threshold_, uint16 creatorTaxBps_) {
        token = token_;
        pairToken = pairToken_;
        deployer = deployer_;
        launchSupply = launchSupply_;
        graduationThreshold = threshold_;
        creatorTaxBps = creatorTaxBps_;
    }

    function feeBps() external pure returns (uint256) {
        return FEE_BPS;
    }

    function protocolFeeShareBps() external pure returns (uint256) {
        return 3000;
    }

    function currentSnipeTaxBps(address) external pure returns (uint256) {
        return 0;
    }

    function exemptFromSnipeTax(address who) external {
        snipeTaxExempt[who] = true;
    }

    function getReserves() external view returns (uint256 quote, uint256 tokens) {
        return (realQuoteReserve + VIRTUAL_QUOTE, IERC20(token).balanceOf(address(this)));
    }

    /// Constant product on (virtual + real quote, token balance), 1% fee on
    /// the way in. Native curve: quoteAmount == msg.value.
    function buy(uint256 quoteAmount, uint256 minTokensOut, address recipient) external payable returns (uint256 tokensOut) {
        require(!graduated, "curve: closed");
        if (pairToken == address(0)) {
            require(quoteAmount == msg.value, "curve: value mismatch");
        } else {
            require(msg.value == 0, "curve: no native");
            IERC20(pairToken).safeTransferFrom(msg.sender, address(this), quoteAmount);
        }
        uint256 fee = (quoteAmount * (FEE_BPS + creatorTaxBps)) / 10_000;
        uint256 spend = quoteAmount - fee;
        uint256 quote = realQuoteReserve + VIRTUAL_QUOTE;
        uint256 tokens = IERC20(token).balanceOf(address(this));
        tokensOut = (tokens * spend) / (quote + spend);
        require(tokensOut >= minTokensOut, "curve: slippage");
        realQuoteReserve += spend;
        quoteFeeBalance += fee;
        IERC20(token).transfer(recipient, tokensOut);
        emit CurveBuy(msg.sender, recipient, quoteAmount, tokensOut, fee, 0);
        if (realQuoteReserve >= graduationThreshold) graduated = true;
    }

    function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) external returns (uint256 quoteOut) {
        require(!graduated, "curve: closed");
        IERC20(token).safeTransferFrom(msg.sender, address(this), tokensIn);
        uint256 quote = realQuoteReserve + VIRTUAL_QUOTE;
        uint256 tokens = IERC20(token).balanceOf(address(this)) - tokensIn;
        uint256 gross = (quote * tokensIn) / (tokens + tokensIn);
        uint256 fee = (gross * FEE_BPS) / 10_000;
        quoteOut = gross - fee;
        require(quoteOut >= minQuoteOut, "curve: slippage");
        realQuoteReserve -= gross;
        quoteFeeBalance += fee;
        if (pairToken == address(0)) {
            (bool ok, ) = recipient.call{value: quoteOut}("");
            require(ok, "curve: pay");
        } else {
            IERC20(pairToken).safeTransfer(recipient, quoteOut);
        }
        emit CurveSell(msg.sender, recipient, tokensIn, quoteOut, fee, 0);
    }
}

contract MockPonsFactory is IPonsFactoryV2 {
    uint256 public override launchFee = 0.0005 ether;
    bool public override launchEnabled = true;
    uint256 public override maxCreatorTaxBps = 1000;
    address public override launchForwarder;
    address public feeSink;
    MockEscrow public escrowMock;
    mapping(address => bool) public approvedPair;
    uint256 public launches;

    LaunchParams public lastParams;
    uint256 public lastConfigId;
    address public lastPairToken;
    address public lastLauncher;
    /// salt → token, to model CREATE2 determinism per (deployer, salt).
    mapping(bytes32 => address) public tokenBySalt;

    event TokenLaunched(address indexed token, address indexed curve, address indexed deployer, address pairToken, uint256 configId, uint256 graduationThreshold);

    constructor(address feeSink_) {
        feeSink = feeSink_;
        launchForwarder = address(new MockLaunchForwarder(this));
        escrowMock = new MockEscrow();
    }

    function feeEscrow() external view override returns (address) {
        return address(escrowMock);
    }

    function setLaunchFee(uint256 v) external {
        launchFee = v;
    }

    function approvePair(address token, bool v) external {
        approvedPair[token] = v;
    }

    function canLaunch(address) external pure override returns (bool) {
        return true;
    }

    function previewLaunchEconomics(uint256 launchConfigId, address pairToken) public pure override returns (bytes32) {
        return keccak256(abi.encode("econ", launchConfigId, pairToken));
    }

    error PairTokenNotApproved();
    error StaleEconomics();

    function launchToken(
        LaunchParams calldata params,
        uint256 launchConfigId,
        address pairToken,
        address[] calldata snipeTaxExempt
    ) external payable override returns (address token, address curve) {
        require(launchEnabled, "factory: disabled");
        require(msg.value == launchFee, "factory: bad fee");
        if (pairToken != address(0) && !approvedPair[pairToken]) revert PairTokenNotApproved();
        if (params.economicsHash != previewLaunchEconomics(launchConfigId, pairToken)) revert StaleEconomics();
        require(params.creatorTaxBps <= maxCreatorTaxBps, "factory: tax");
        require(params.creatorFeeRecipient != address(0), "factory: recipient");

        uint256 supply = 1_000_000_000 ether;
        bytes32 salt = keccak256(abi.encode(msg.sender, params.salt));
        MockLaunchedToken t = new MockLaunchedToken{salt: salt}(params.name, params.symbol, address(this), supply);
        MockCurve c = new MockCurve(address(t), pairToken, params.creatorFeeRecipient, supply, 4.2 ether, params.creatorTaxBps);
        t.transfer(address(c), supply);
        c.exemptFromSnipeTax(msg.sender);
        c.exemptFromSnipeTax(params.creatorFeeRecipient);
        for (uint256 i = 0; i < snipeTaxExempt.length; i++) c.exemptFromSnipeTax(snipeTaxExempt[i]);

        lastParams = params;
        lastConfigId = launchConfigId;
        lastPairToken = pairToken;
        lastLauncher = msg.sender;
        tokenBySalt[params.salt] = address(t);
        launches++;

        (bool ok, ) = feeSink.call{value: msg.value}("");
        require(ok, "factory: sink");
        emit TokenLaunched(address(t), address(c), params.creatorFeeRecipient, pairToken, launchConfigId, 4.2 ether);
        return (address(t), address(c));
    }
}

contract MockLaunchForwarder is IPonsLaunchForwarder {
    using SafeERC20 for IERC20;

    MockPonsFactory public immutable factory;
    address public lastBuyRecipient;

    error ZeroAmount();
    error NotApprovedLauncher();

    constructor(MockPonsFactory factory_) {
        factory = factory_;
    }

    function launchAndBuy(
        IPonsFactoryV2.LaunchParams calldata params,
        uint256 launchConfigId,
        address pairToken,
        uint256 buyAmount,
        uint256 minTokensOut,
        address buyRecipient,
        address[] calldata snipeTaxExempt
    ) external payable override returns (address token, address curve) {
        if (buyAmount == 0) revert ZeroAmount();
        if (!factory.canLaunch(msg.sender)) revert NotApprovedLauncher();
        uint256 fee = factory.launchFee();
        (token, curve) = factory.launchToken{value: fee}(params, launchConfigId, pairToken, snipeTaxExempt);
        MockCurve(curve).exemptFromSnipeTax(buyRecipient);
        if (pairToken == address(0)) {
            require(msg.value == fee + buyAmount, "forwarder: value");
            MockCurve(curve).buy{value: buyAmount}(buyAmount, minTokensOut, buyRecipient);
        } else {
            require(msg.value == fee, "forwarder: value");
            IERC20(pairToken).safeTransferFrom(msg.sender, address(this), buyAmount);
            IERC20(pairToken).forceApprove(curve, buyAmount);
            MockCurve(curve).buy(buyAmount, minTokensOut, buyRecipient);
        }
        lastBuyRecipient = buyRecipient;
    }
}
