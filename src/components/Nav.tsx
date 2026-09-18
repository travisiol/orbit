"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { site } from "@/lib/site";
import { useUi } from "@/lib/ui";
import { ConnectButton } from "./ConnectButton";

export function Nav() {
  const pathname = usePathname();
  const intro = useUi((s) => s.intro);
  const shown = intro >= 0.85 || pathname !== "/";
  return (
    <header className="nav" style={{ opacity: shown ? 1 : 0, transition: "opacity 900ms ease" }}>
      <Link href="/" className="wordmark" aria-label={`${site.name} — home`}>
        {site.wordmark}
        <small>{site.tagline}</small>
      </Link>
      <nav className="nav-links" aria-label="Site">
        <Link href="/docs" data-active={pathname.startsWith("/docs") ? "1" : undefined}>
          docs
        </Link>
        <Link href="/deploy" data-active={pathname.startsWith("/deploy") ? "1" : undefined}>
          deploy
        </Link>
        <ConnectButton />
      </nav>
    </header>
  );
}
