import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "TNBike Analytics — Data Explorers 2026",
  description: "Dashboard phân tích kinh doanh Thống Nhất Bike",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={`${geistSans.variable} ${geistMono.variable} dark h-full`}>
      <body suppressHydrationWarning className="h-full bg-background text-foreground antialiased">{children}</body>
    </html>
  );
}
