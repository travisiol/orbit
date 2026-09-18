import { concatHex, encodeDeployData, getContractAddress, keccak256, stringToHex, type Address, type Hex } from "viem";
import { sunAbi } from "./abi/sunAbi";
import bytecodeRecord from "./abi/Sun.bytecode.json";
import { DETERMINISTIC_DEPLOYER, PONS_FACTORY, PYTH, SUN_OVERRIDE } from "./contracts";
import { ETH_PRICE_ID } from "./planets";

/**
 * The Sun's address is known before it exists.
 *
 * It is created with CREATE2 through Arachnid's deterministic-deployment
 * proxy (0x4e59…956C, present on Robinhood Chain), from the exact creation
 * bytecode hardhat exported next to the ABI plus its constructor arguments
 * (Pons factory, Pyth, the ETH/USD feed). Same inputs, same address,
 * whoever sends the transaction — so anyone with a wallet can put it on the
 * chain, the site reads it there, and nobody holds a key for it. A
 * recompiled contract is a different address, never a silent swap. Planets
 * are not part of the address: they are lit afterwards, by anyone.
 */
export { DETERMINISTIC_DEPLOYER };

/** Runtime code of the proxy, as read from Robinhood Chain (69 bytes). */
export const DETERMINISTIC_DEPLOYER_CODE: Hex =
  "0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe03601600081602082378035828234f58015156039578182fd5b8082525050506014600cf3";

/** Salt for the CREATE2; bump the suffix to get a fresh address on purpose. */
export const SUN_SALT: Hex = keccak256(stringToHex("orbit:sun:v1"));

export const SUN_BYTECODE = bytecodeRecord.bytecode as Hex;

export type SunArgs = { factory: Address; pyth: Address };

const DEFAULT_ARGS: SunArgs = { factory: PONS_FACTORY, pyth: PYTH };

/** `factory` / `pyth` are only ever overridden by rehearsals against mocks. */
export function sunConstructorArgs(args: SunArgs = DEFAULT_ARGS) {
  return [args.factory, args.pyth, ETH_PRICE_ID] as const;
}

/** Creation bytecode with the constructor arguments appended. */
export function sunInitCode(args: SunArgs = DEFAULT_ARGS): Hex {
  const [factory, pyth, ethId] = sunConstructorArgs(args);
  return encodeDeployData({ abi: sunAbi, bytecode: SUN_BYTECODE, args: [factory, pyth, ethId] });
}

export function sunInitCodeHash(args: SunArgs = DEFAULT_ARGS): Hex {
  return keccak256(sunInitCode(args));
}

/** Where the Sun lives (or will live) on any chain that has the proxy. */
export function predictedSun(args: SunArgs = DEFAULT_ARGS): Address {
  return getContractAddress({ opcode: "CREATE2", from: DETERMINISTIC_DEPLOYER, salt: SUN_SALT, bytecode: sunInitCode(args) });
}

/** The Sun the site reads: the override when set, otherwise the predicted address. */
export const SUN: Address = SUN_OVERRIDE ?? predictedSun();

/** The one transaction that deploys it: `to` the proxy, `data` = salt ‖ init code. */
export function sunDeployTx(args: SunArgs = DEFAULT_ARGS): { to: Address; data: Hex } {
  return { to: DETERMINISTIC_DEPLOYER, data: concatHex([SUN_SALT, sunInitCode(args)]) };
}
