import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import Script from "next/script";
import { Nav } from "@/components/Nav";
import { Providers } from "@/components/Providers";
import { Sky } from "@/components/sky/Sky";
import { Status } from "@/components/Status";
import { SystemFeed } from "@/components/SystemFeed";
import { site } from "@/lib/site";
import "@rainbow-me/rainbowkit/styles.css";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], weight: ["300", "400", "500"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono-jb", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: { default: `${site.name} — ${site.tagline}`, template: `%s · ${site.name}` },
  description: site.description,
  openGraph: { title: `${site.name} — ${site.hook}`, description: site.description, siteName: site.name, type: "website", url: site.url },
  twitter: { card: "summary_large_image", title: `${site.name} — ${site.hook}`, description: site.description },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = { themeColor: "#000000", width: "device-width", initialScale: 1 };

/**
 * The sky is mounted here, once, under every page: navigating from the
 * home to a planet keeps the same canvas and the camera simply flies —
 * pages only set the focus.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body>
        {process.env.NEXT_PUBLIC_DEV_WALLET === "1" && <Script src="/dev-wallet.js" strategy="beforeInteractive" />}
        <Providers>
          <SystemFeed />
          <Sky />
          <Nav />
          {children}
          <Status />
        </Providers>
      </body>
    </html>
  );
}
