import type { Metadata, Viewport } from "next";
import { Nav } from "@/components/nav";
import { DataSourceBanner } from "@/components/manual-data-banner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Football Predictor",
  description:
    "Football prediction app — Dixon-Coles engine with API-Football sync and manual Prediction Log entry",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Football Predictor",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0f1a",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <Nav />
          <main className="app-main">
            <div className="mx-auto max-w-6xl">
              <DataSourceBanner />
            </div>
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
