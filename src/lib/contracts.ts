import { isAddress, type Address } from "viem";

/** Pons V2 on Robinhood Chain — verified on a fork, see README. */
export const PONS_FACTORY: Address = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
export const PONS_FORWARDER: Address = "0xe33e9e479df8802cb0866d5d05258bec4cf62948";
export const PONS_FEE_ESCROW: Address = "0xd3AFEB2a57f70eF218Aa82451c51B2fb0416Ac9e";

/** Pyth on Robinhood Chain (the same address as on Base / Optimism), v1.4.5. */
export const PYTH: Address = "0x8250f4aF4B972684F7b336503E2D6dFeDeB1487a";

/** Arachnid's deterministic-deployment proxy, present on Robinhood Chain. */
export const DETERMINISTIC_DEPLOYER: Address = "0x4e59b44847b379578588920cA78FbF26c0B4956C";

const raw = process.env.NEXT_PUBLIC_SUN?.trim() ?? "";

/**
 * Optional override of the Sun's address. Normally unset: the address is
 * deterministic (see sunDeploy.ts) and the site reads whether the contract
 * exists at it. Set it only to point the site at another deployment on
 * purpose — a rehearsal against the Pons mock, say.
 */
export const SUN_OVERRIDE: Address | undefined = isAddress(raw) ? (raw as Address) : undefined;

/** Pons launch fee, display only; the Sun reads the live value. */
export const LAUNCH_FEE_ETH_DISPLAY = process.env.NEXT_PUBLIC_LAUNCH_FEE_ETH ?? "0.0005";

/** Mirrors of the Sun's constants, for copy and validation on the client. */
export const SUN_CONSTANTS = {
  orbitsPerPlanet: 12,
  orbitMin: 500_000n * 10n ** 18n,
  satelliteMin: 1_000n * 10n ** 18n,
  orbitGravity: 2,
  satelliteGravity: 1,
  satelliteCooldownSeconds: 86_400,
  windMaxBps: 500,
  windRampSeconds: 6 * 3600,
  windStallSeconds: 30 * 86_400,
  priceMaxAgeSeconds: 120,
  creatorTaxBps: 100,
  planetFee: 10n ** 16n,
  maxPlanets: 48,
  ponsFeeBps: 100,
  ponsCreatorShareBps: 7_000,
  launchSupply: 1_000_000_000n * 10n ** 18n,
} as const;
