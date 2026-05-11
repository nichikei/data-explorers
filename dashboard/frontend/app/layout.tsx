import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin", "vietnamese"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "TNBike Analytics — Data Explorers 2026",
  description: "Dashboard phân tích kinh doanh Thống Nhất Bike",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={`${inter.variable} ${jetbrainsMono.variable} h-full`}>
      <body suppressHydrationWarning className="h-full bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
