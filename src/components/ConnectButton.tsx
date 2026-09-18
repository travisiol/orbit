"use client";

import { ConnectButton as RainbowConnect } from "@rainbow-me/rainbowkit";
import { shortAddress } from "@/lib/format";

/** RainbowKit's modal behind the site's own button. */
export function ConnectButton({ size = "sm", full = false, primary = false }: { size?: "sm" | "md" | "lg"; full?: boolean; primary?: boolean }) {
  const cls = `btn ${size === "sm" ? "btn-sm" : size === "lg" ? "btn-lg" : ""} ${full ? "w-full" : ""} ${primary ? "btn-primary" : ""}`;
  return (
    <RainbowConnect.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        const connected = mounted && account && chain;
        if (!mounted) {
          return (
            <button type="button" className={cls} disabled aria-hidden>
              connect
            </button>
          );
        }
        if (!connected) {
          return (
            <button type="button" className={cls} onClick={openConnectModal} data-connect>
              connect
            </button>
          );
        }
        if (chain.unsupported) {
          return (
            <button type="button" className={`${cls} warn`} onClick={openChainModal}>
              switch to robinhood chain
            </button>
          );
        }
        return (
          <button type="button" className={`${cls} mono`} onClick={openAccountModal} data-account>
            {shortAddress(account.address)}
          </button>
        );
      }}
    </RainbowConnect.Custom>
  );
}
