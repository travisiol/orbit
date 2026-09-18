import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";

/** Pons' own custom errors, by selector (named via openchain, checked on a fork). */
const PONS_ERRORS: Record<string, string> = {
  "0x1f2a2005": "pons refused a zero first buy (ZeroAmount).",
  "0x49285dfb": "pons does not accept this pair token (PairTokenNotApproved).",
  "0x8d42130c": "only pons can sweep fees.",
  "0xfb8f41b2": "the curve needs an approval first.",
};

/** The Sun's errors, in words. */
const OURS: Record<string, string> = {
  AlreadyLaunched: "$orbit is already launched.",
  NotLaunched: "$orbit is not launched yet — nothing can orbit before it is.",
  WrongValue: "wrong eth amount — reload and try again.",
  UnknownPlanet: "no such planet.",
  DarkPlanet: "this planet is dark: no native token of that stock exists yet.",
  BelowMinimum: "below the minimum — 1,000 ORBIT for a satellite, 500,000 for an orbit (what stays must too).",
  NoFreeOrbit: "all twelve orbits of this planet are held. fly as a satellite, or wait for one to open.",
  AlreadyInOrbit: "you hold an orbit here — add to it as an orbit, not as a satellite.",
  Locked: "your orbit is locked until the end of its revolution.",
  Cooling: "satellites can leave a day after their last deposit.",
  NothingHere: "you have nothing around this planet.",
  TooMuch: "that is more than you have here.",
  NothingPending: "no eth is pending on this planet.",
  NoMass: "nobody orbits this planet.",
  BadPrice: "the oracle price is missing or unusable.",
  Slippage: "the eth out fell under your minimum.",
  NotStalled: "the wind has not stalled for thirty days yet.",
  EthTransferFailed: "the eth transfer failed.",
  StalePrice: "pyth's price is older than two minutes — pass a fresh update with the fill.",
  PriceFeedNotFound: "pyth has no price on chain for this feed yet — pass an update with the fill.",
  ERC20InsufficientAllowance: "approve $orbit to the sun first.",
  ERC20InsufficientBalance: "not enough tokens.",
};

/** One short, lowercase sentence for whatever the wallet or the chain threw. */
export function explainError(e: unknown): string {
  if (e instanceof BaseError) {
    if (e.walk((x) => x instanceof UserRejectedRequestError)) return "you cancelled in your wallet.";
    const reverted = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (reverted) {
      const name = reverted.data?.errorName;
      if (name && OURS[name]) return OURS[name];
      const sig = reverted.signature ?? (reverted.raw ? reverted.raw.slice(0, 10) : undefined);
      if (sig && PONS_ERRORS[sig]) return PONS_ERRORS[sig];
      if (name) return `reverted: ${name}.`;
      if (sig) return `reverted with ${sig}.`;
    }
    const msg = e.shortMessage || e.message;
    for (const [sel, text] of Object.entries(PONS_ERRORS)) if (msg.includes(sel)) return text;
    for (const [name, text] of Object.entries(OURS)) if (msg.includes(name)) return text;
    if (/insufficient funds/i.test(msg)) return "not enough eth for this, gas included.";
    return msg.split("\n")[0].toLowerCase();
  }
  if (e instanceof Error) return e.message.split("\n")[0].toLowerCase();
  return "something went wrong.";
}
