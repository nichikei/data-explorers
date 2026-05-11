"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard, TrendingUp, Bike, Users, Map, Settings2, BarChart3, BrainCircuit,
} from "lucide-react";

const NAV = [
  { href: "/overview",   label: "Tổng quan KPI",       icon: LayoutDashboard },
  { href: "/time",       label: "Phân tích thời gian",  icon: TrendingUp },
  { href: "/products",   label: "Sản phẩm",             icon: Bike },
  { href: "/customers",  label: "Đại lý",               icon: Users },
  { href: "/geography",  label: "Địa lý",               icon: Map },
  { href: "/operations", label: "Vận hành",             icon: Settings2 },
  { href: "/forecast",   label: "Dự báo Q2/2026",       icon: BrainCircuit },
];

export default function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="w-60 shrink-0 flex flex-col" style={{ backgroundColor: "var(--sidebar)", color: "var(--sidebar-foreground)" }}>
      {/* Brand */}
      <div className="px-5 py-5" style={{ borderBottom: "1px solid var(--sidebar-border)" }}>
        <div className="flex items-center gap-2.5">
          <div className="rounded-lg p-1.5" style={{ backgroundColor: "var(--sidebar-primary)", color: "#fff" }}>
            <BarChart3 className="h-4 w-4" />
          </div>
          <div>
            <p className="font-semibold text-sm leading-tight tracking-tight" style={{ color: "var(--sidebar-foreground)" }}>TNBike Analytics</p>
            <p className="text-[10px] mt-0.5" style={{ color: "oklch(0.700 0.010 248)" }}>Data Explorers 2026</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2.5 py-4 space-y-0.5">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150",
                active
                  ? "text-white"
                  : "hover:text-white",
              )}
              style={active
                ? { backgroundColor: "var(--sidebar-primary)", color: "#fff" }
                : { color: "oklch(0.750 0.012 248)" }
              }
              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.backgroundColor = "var(--sidebar-accent)"; }}
              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.backgroundColor = "transparent"; }}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4" style={{ borderTop: "1px solid var(--sidebar-border)" }}>
        <p className="text-[11px] font-medium" style={{ color: "oklch(0.650 0.010 248)" }}>Thống Nhất Bicycle</p>
        <p className="text-[10px] mt-0.5" style={{ color: "oklch(0.500 0.010 248)" }}>Deadline: 28/05/2026</p>
      </div>
    </aside>
  );
}
