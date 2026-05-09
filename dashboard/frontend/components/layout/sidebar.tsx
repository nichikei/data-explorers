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
    <aside className="w-60 shrink-0 border-r border-border bg-card flex flex-col">
      {/* Brand */}
      <div className="px-5 py-5 border-b border-border">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-6 w-6 text-primary" />
          <div>
            <p className="font-bold text-sm leading-tight">TNBike Analytics</p>
            <p className="text-[10px] text-muted-foreground">Data Explorers 2026</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                active
                  ? "bg-primary text-primary-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-3 border-t border-border">
        <p className="text-[10px] text-muted-foreground">Deadline: 28/05/2026</p>
        <p className="text-[10px] text-muted-foreground">Thống Nhất Bike — B2B</p>
      </div>
    </aside>
  );
}
