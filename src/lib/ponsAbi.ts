import { parseAbi } from "viem";

/**
 * Pons V2 on Robinhood Chain, the parts the site reads and calls. Verified
 * on a fork (contracts/scripts/fork-check.ts): every buy and sell quoted
 * locally matched the chain to the wei, on an ETH curve and on a GLD one.
 */
export const curveAbi = parseAbi([
  "function getReserves() view returns (uint256 quote, uint256 tokens)",
  "function realQuoteReserve() view returns (uint256)",
  "function graduationThreshold() view returns (uint256)",
  "function graduated() view returns (bool)",
  "function launchSupply() view returns (uint256)",
  "function feeBps() view returns (uint256)",
  "function creatorTaxBps() view returns (uint256)",
  "function quoteFeeBalance() view returns (uint256)",
  "function protocolFeeShareBps() view returns (uint256)",
  "function deployer() view returns (address)",
  "function token() view returns (address)",
  "function pairToken() view returns (address)",
  "function currentSnipeTaxBps(address account) view returns (uint256)",
  "function buy(uint256 quoteAmount, uint256 minTokensOut, address recipient) payable returns (uint256 tokensOut)",
  "function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient) returns (uint256 quoteOut)",
  "event CurveBuy(address indexed sender, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 snipeTax)",
  "event CurveSell(address indexed sender, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 snipeTax)",
  "error NativeValueMismatch(uint256 value, uint256 amount)",
]);

export const erc20Abi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

export const escrowAbi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function balanceOfToken(address token, address account) view returns (uint256)",
  "function claim()",
  "function claimToken(address token)",
]);

export const factoryAbi = parseAbi([
  "function launchFee() view returns (uint256)",
  "function launchForwarder() view returns (address)",
  "function feeEscrow() view returns (address)",
  "function previewLaunchEconomics(uint256 configId, address pairToken) view returns (bytes32)",
]);

/** Pyth on Robinhood Chain — the reads the screen needs and the update the wind takes. */
export const pythAbi = parseAbi([
  "function getPriceUnsafe(bytes32 id) view returns ((int64 price, uint64 conf, int32 expo, uint256 publishTime))",
  "function getPriceNoOlderThan(bytes32 id, uint256 age) view returns ((int64 price, uint64 conf, int32 expo, uint256 publishTime))",
  "function getUpdateFee(bytes[] updateData) view returns (uint256)",
  "function priceFeedExists(bytes32 id) view returns (bool)",
]);
