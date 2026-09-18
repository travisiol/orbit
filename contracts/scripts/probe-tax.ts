import { ethers, network } from "hardhat";
import { sunDeployTx, predictedSun } from "../../src/lib/sunDeploy";

/** Where does Pons send the creator tax? Launch through the Sun, buy, and look everywhere. */
const CURVE_ABI = [
  "function quoteFeeBalance() view returns (uint256)",
  "function buy(uint256,uint256,address) payable returns (uint256)",
  "function currentSnipeTaxBps(address) view returns (uint256)",
  "function getReserves() view returns (uint256,uint256)",
  "function realQuoteReserve() view returns (uint256)",
];
const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];
async function main() {
  const [alice, stranger] = await ethers.getSigners();
  await network.provider.send("evm_mine", []);
  const factory = await ethers.getContractAt("IPonsFactoryV2", "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e");
  const fee: bigint = await factory.launchFee();
  const escrowAddr = await factory.feeEscrow();
  const dtx = sunDeployTx();
  await (await alice.sendTransaction({ to: dtx.to, data: dtx.data })).wait();
  const sun = await ethers.getContractAt("Sun", predictedSun());
  await (await sun.connect(alice).launch("", "", ethers.parseEther("0.01"), 0, { value: fee + ethers.parseEther("0.01") })).wait();
  const curveAddr = await sun.curve();
  const curve = new ethers.Contract(curveAddr, CURVE_ABI, ethers.provider);
  const token = new ethers.Contract(await sun.orbit(), ERC20_ABI, ethers.provider);
  const escrow = new ethers.Contract(escrowAddr, ["function balanceOf(address) view returns (uint256)"], ethers.provider);
  await network.provider.send("evm_increaseTime", [10]);
  await network.provider.send("evm_mine", []);
  const snap = async (label: string) => {
    console.log(label, {
      sunEth: ethers.formatEther(await ethers.provider.getBalance(await sun.getAddress())),
      sunOrbit: ethers.formatEther(await token.balanceOf(await sun.getAddress())),
      escrowSun: ethers.formatEther(await escrow.balanceOf(await sun.getAddress())),
      curveEth: ethers.formatEther(await ethers.provider.getBalance(curveAddr)),
      curveFees: ethers.formatEther(await curve.quoteFeeBalance()),
      real: ethers.formatEther(await curve.realQuoteReserve()),
      snipe: (await curve.currentSnipeTaxBps(stranger.address)).toString(),
    });
  };
  await snap("after launch");
  const v = ethers.parseEther("0.1");
  const before = await token.balanceOf(stranger.address);
  const rc = await (await curve.connect(stranger).buy(v, 0, stranger.address, { value: v })).wait();
  console.log("stranger got", ethers.formatEther((await token.balanceOf(stranger.address)) - before), "ORBIT; logs:", rc!.logs.length);
  for (const l of rc!.logs) console.log("  log", l.address, l.topics[0].slice(0, 10), l.data.length > 2 ? l.data.slice(0, 130) : "");
  await snap("after 0.1 ETH buy");
}
main().catch((e) => { console.error(e); process.exit(1); });
