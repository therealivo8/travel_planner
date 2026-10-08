import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { AuthProvider } from "@/context/AuthContext";
import { CollabEvents } from "@/components/common/CollabEvents";
import { OfflineBanner } from "@/components/common/OfflineBanner";
import { ConfirmProvider } from "@/components/common/ConfirmProvider";
import { SiteFooter } from "@/components/layout/SiteFooter";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Road Trip Planner", template: "%s · Road Trip Planner" },
  description: "Plan your next road trip with two powerful planning modes.",
  applicationName: "Road Trip Planner",
  appleWebApp: { capable: true, title: "Road Trip", statusBarStyle: "default" },
  icons: { apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#3B82F6",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <AuthProvider>
          <ConfirmProvider>
            <OfflineBanner />
            <CollabEvents />
            <div className="flex-1 flex flex-col">{children}</div>
            <SiteFooter />
          </ConfirmProvider>
          <Toaster richColors />
        </AuthProvider>
      </body>
    </html>
  );
}
