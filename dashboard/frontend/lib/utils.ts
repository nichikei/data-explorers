import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatVND(amount: number | null | undefined): string {
  if (amount == null) return "—";
  if (Math.abs(amount) >= 1e9) return `${(amount / 1e9).toFixed(1)} tỷ`;
  if (Math.abs(amount) >= 1e6) return `${(amount / 1e6).toFixed(0)} tr`;
  return amount.toLocaleString("vi-VN") + "đ";
}

export function formatNum(n: number | null | undefined, dec = 0): string {
  if (n == null) return "—";
  return n.toLocaleString("vi-VN", { maximumFractionDigits: dec });
}

export function pct(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}

/** Recharts-friendly palette for 5 product groups */
export const GROUP_COLORS: Record<string, string> = {
  "Xe phổ thông":      "#3b82f6",
  "Xe trẻ em nhóm 1":  "#10b981",
  "Xe trẻ em nhóm 2":  "#14b8a6",
  "Xe thể thao S":     "#f97316",
  "Xe thể thao A":     "#8b5cf6",
  "Chưa phân loại":    "#6b7280",
};

export const PALETTE = [
  "#3b82f6","#10b981","#f97316","#8b5cf6","#f59e0b",
  "#ef4444","#14b8a6","#ec4899","#84cc16","#06b6d4",
];

export const BCG_COLORS: Record<string, string> = {
  Stars:           "#3b82f6",
  "Cash Cows":     "#10b981",
  "Question Marks":"#f59e0b",
  Dogs:            "#ef4444",
};

export const RFM_COLORS: Record<string, string> = {
  Champions: "#8b5cf6",
  Loyal:     "#3b82f6",
  Promising: "#10b981",
  "At Risk": "#f59e0b",
  Lost:      "#ef4444",
};
