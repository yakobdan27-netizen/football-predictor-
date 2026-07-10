import type { Metadata, Viewport } from "next";
import { Nav } from "@/components/nav";
import { ManualDataBanner } from "@/components/manual-data-banner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Football Predictor",
  description:
    "Fully manual football prediction app — Dixon-Coles engine on user-entered data only",
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
              <ManualDataBanner />
            </div>
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
