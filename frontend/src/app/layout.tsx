import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { AuthProvider } from "@/context/AuthContext";
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
            <div className="flex-1 flex flex-col">{children}</div>
            <SiteFooter />
          </ConfirmProvider>
          <Toaster richColors />
        </AuthProvider>
      </body>
    </html>
  );
}
