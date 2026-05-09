"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { formatVND, formatNum, pct, GROUP_COLORS, PALETTE } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Package, Users, ShoppingCart, Banknote, Percent } from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, FunnelChart, Funnel, LabelList,
} from "recharts";

interface KPI {
  revenue: number; orders: number; qty: number; dealers: number;
  avg_per_dealer: number; mom_revenue_pct: number; mom_orders_pct: number;
  yoy_revenue_pct: number; active_dealers: number; pareto_top20_pct: number;
}
interface GroupRevenue { group_name: string; revenue: number; pct: number; }
interface Sparkline { fiscal_year: number; fiscal_month: number; label: string; revenue: number; }
interface Pipeline { stages: { status: string; count: number }[]; total: number; loaded: number; success_rate: number; }

function MetricCard({ icon: Icon, label, value, delta, sub }: {
  icon: React.ElementType; label: string; value: string; delta?: number | null; sub?: string;
}) {
  const isPos = delta != null && delta > 0;
  const isNeg = delta != null && delta < 0;
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold">{value}</p>
            {delta != null && (
              <p className={`text-xs flex items-center gap-1 ${isPos ? "text-emerald-500" : isNeg ? "text-red-500" : "text-muted-foreground"}`}>
                {isPos ? <TrendingUp className="h-3 w-3" /> : isNeg ? <TrendingDown className="h-3 w-3" /> : null}
                {pct(delta)} so với tháng trước
              </p>
            )}
            {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
          </div>
          <div className="rounded-lg bg-primary/10 p-2">
            <Icon className="h-5 w-5 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const FUNNEL_ORDER = ["LOADED", "VALIDATED", "EXTRACTED", "PENDING", "FAILED"];
const FUNNEL_LABELS: Record<string, string> = {
  LOADED: "Nhập DB thành công", VALIDATED: "Đã kiểm tra",
  EXTRACTED: "Đã trích xuất PDF", PENDING: "Chờ xử lý", FAILED: "Thất bại",
};
const FUNNEL_COLORS: Record<string, string> = {
  LOADED: "#10b981", VALIDATED: "#3b82f6", EXTRACTED: "#8b5cf6",
  PENDING: "#f59e0b", FAILED: "#ef4444",
};

export default function OverviewPage() {
  const [kpi, setKpi] = useState<KPI | null>(null);
  const [groups, setGroups] = useState<GroupRevenue[]>([]);
  const [spark, setSpark] = useState<Sparkline[]>([]);
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);

  useEffect(() => {
    Promise.all([
      apiFetch<KPI>("/api/overview/kpi"),
      apiFetch<GroupRevenue[]>("/api/overview/group_revenue"),
      apiFetch<Sparkline[]>("/api/overview/sparkline"),
      apiFetch<Pipeline>("/api/operations/pipeline"),
    ]).then(([k, g, s, p]) => { setKpi(k); setGroups(g); setSpark(s); setPipeline(p); });
  }, []);

  const funnelData = FUNNEL_ORDER
    .map(s => pipeline?.stages.find(x => x.status === s))
    .filter(Boolean)
    .map(x => ({ name: FUNNEL_LABELS[x!.status] ?? x!.status, value: x!.count, fill: FUNNEL_COLORS[x!.status] ?? "#6b7280" }));

  const insights = kpi ? [
    {
      title: "Phát hiện",
      text: `Doanh thu T3/2026 đạt ${formatVND(kpi.revenue)} (${pct(kpi.mom_revenue_pct)} MoM, ${pct(kpi.yoy_revenue_pct)} YoY).`,
    },
    {
      title: "Đại lý hoạt động",
      text: `${formatNum(kpi.active_dealers)}/${formatNum(kpi.dealers)} đại lý có đơn hàng trong 45 ngày gần nhất.`,
    },
    {
      title: "Pareto 80/20",
      text: `Top 20% đại lý đóng góp ${kpi.pareto_top20_pct?.toFixed(1)}% tổng doanh thu — tập trung chăm sóc nhóm này.`,
    },
  ] : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Tổng quan KPI</h1>
        <p className="text-sm text-muted-foreground">Dữ liệu toàn bộ kỳ · nổi bật T3/2026</p>
      </div>

      {/* Metric cards */}
      {!kpi ? (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <MetricCard icon={Banknote}   label="Doanh thu T3/2026"    value={formatVND(kpi.revenue)}     delta={kpi.mom_revenue_pct} />
          <MetricCard icon={ShoppingCart} label="Đơn hàng T3/2026"  value={formatNum(kpi.orders)}      delta={kpi.mom_orders_pct} />
          <MetricCard icon={Package}    label="Sản lượng T3/2026"    value={formatNum(kpi.qty) + " chiếc"} />
          <MetricCard icon={Users}      label="Đại lý hoạt động"     value={formatNum(kpi.active_dealers)} sub={`/ ${formatNum(kpi.dealers)} tổng`} />
          <MetricCard icon={Percent}    label="DT TB / đại lý"       value={formatVND(kpi.avg_per_dealer)} sub="T3/2026" />
        </div>
      )}

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Sparkline */}
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-sm">Xu hướng doanh thu theo tháng</CardTitle></CardHeader>
          <CardContent>
            {spark.length === 0 ? <Skeleton className="h-48" /> : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={spark} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                  <YAxis tickFormatter={v => `${(v / 1e9).toFixed(0)}tỷ`} tick={{ fontSize: 10 }} width={40} />
                  <Tooltip formatter={(v) => formatVND(Number(v ?? 0))} />
                  <Area type="monotone" dataKey="revenue" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.15} strokeWidth={2} name="Doanh thu" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Group donut */}
        <Card>
          <CardHeader><CardTitle className="text-sm">Cơ cấu nhóm SP — T3/2026</CardTitle></CardHeader>
          <CardContent>
            {groups.length === 0 ? <Skeleton className="h-48" /> : (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={groups} dataKey="revenue" nameKey="group_name" cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2}>
                    {groups.map(g => <Cell key={g.group_name} fill={GROUP_COLORS[g.group_name] ?? "#6b7280"} />)}
                  </Pie>
                  <Tooltip formatter={(v, n) => [formatVND(Number(v ?? 0)), String(n)]} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Pipeline funnel + Insights */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">Pipeline email T3/2026</CardTitle></CardHeader>
          <CardContent>
            {!pipeline ? <Skeleton className="h-52" /> : (
              <>
                <div className="flex gap-4 mb-3">
                  <div className="text-center"><p className="text-xl font-bold">{pipeline.total}</p><p className="text-xs text-muted-foreground">Tổng email</p></div>
                  <div className="text-center"><p className="text-xl font-bold text-emerald-500">{pipeline.loaded}</p><p className="text-xs text-muted-foreground">Nhập DB</p></div>
                  <div className="text-center"><p className="text-xl font-bold text-emerald-500">{pipeline.success_rate}%</p><p className="text-xs text-muted-foreground">Tỷ lệ thành công</p></div>
                </div>
                <div className="space-y-2">
                  {funnelData.map(f => (
                    <div key={f.name} className="flex items-center gap-2">
                      <div className="w-28 text-xs text-right text-muted-foreground truncate">{f.name}</div>
                      <div className="flex-1 bg-muted rounded-full h-5 overflow-hidden">
                        <div className="h-full rounded-full flex items-center justify-end pr-2 transition-all"
                          style={{ width: `${(f.value / pipeline.total) * 100}%`, backgroundColor: f.fill }}>
                          <span className="text-[10px] text-white font-medium">{f.value}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Key Insights</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {insights.length === 0 ? <Skeleton className="h-52" /> : insights.map((ins, i) => (
              <div key={i} className="rounded-lg bg-accent/40 p-3">
                <Badge variant="outline" className="mb-1 text-[10px]">{ins.title}</Badge>
                <p className="text-xs leading-relaxed">{ins.text}</p>
              </div>
            ))}
            {kpi && (
              <div className="rounded-lg bg-accent/40 p-3">
                <Badge variant="outline" className="mb-1 text-[10px]">Hành động</Badge>
                <p className="text-xs leading-relaxed">
                  Tập trung top 20% đại lý ({formatNum(Math.round(kpi.dealers * 0.2))} đại lý) đang tạo ra {kpi.pareto_top20_pct?.toFixed(0)}% doanh thu. Triển khai chương trình ưu đãi Q2/2026 cho nhóm này.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
