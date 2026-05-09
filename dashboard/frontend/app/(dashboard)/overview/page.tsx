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
  avg_per_dealer: number; avg_unit_price: number; lines_per_order: number;
  mom_revenue_pct: number; mom_orders_pct: number;
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
      apiFetch<GroupRevenue[]>("/api/overview/group_revenue", []),
      apiFetch<Sparkline[]>("/api/overview/sparkline", []),
      apiFetch<Pipeline>("/api/operations/pipeline"),
    ]).then(([k, g, s, p]) => { setKpi(k); setGroups(g); setSpark(s); setPipeline(p); });
  }, []);

  const funnelData = FUNNEL_ORDER
    .map(s => pipeline?.stages.find(x => x.status === s))
    .filter(Boolean)
    .map(x => ({ name: FUNNEL_LABELS[x!.status] ?? x!.status, value: x!.count, fill: FUNNEL_COLORS[x!.status] ?? "#6b7280" }));

  const topGroup = groups.length > 0 ? [...groups].sort((a, b) => b.revenue - a.revenue)[0] : null;

  const insights = kpi ? [
    {
      phat_hien: `Doanh thu T3/2026 đạt ${formatVND(kpi.revenue)} — tăng ${pct(kpi.mom_revenue_pct)} so với T2/2026 và ${pct(kpi.yoy_revenue_pct)} so với T3/2025.`,
      y_nghia: "Tháng 3 là cao điểm mùa xuân — nhu cầu xe đạp tăng mạnh trước mùa hè, phản ánh chu kỳ kinh doanh B2B của Thống Nhất Bike.",
      hanh_dong: `Đẩy mạnh dự trữ kho và đàm phán với đại lý trong tháng 4 để duy trì đà tăng trưởng sang Q2/2026.`,
    },
    {
      phat_hien: `${formatNum(kpi.active_dealers)}/${formatNum(kpi.dealers)} đại lý (${((kpi.active_dealers / kpi.dealers) * 100).toFixed(0)}%) có đơn hàng trong 45 ngày gần nhất. ${formatNum(kpi.dealers - kpi.active_dealers)} đại lý nguy cơ churn.`,
      y_nghia: "Gần một nửa mạng lưới đại lý đang im lặng — đây là dấu hiệu sớm của rủi ro doanh thu nếu không can thiệp kịp thời.",
      hanh_dong: "Triển khai chiến dịch tái kích hoạt: gọi điện trực tiếp cho top 50 đại lý chưa đặt hàng, kèm ưu đãi chiết khấu thêm 2–3% cho đơn đầu Q2.",
    },
    {
      phat_hien: `Top 20% đại lý (≈${formatNum(Math.round(kpi.dealers * 0.2))} đại lý) tạo ra ${kpi.pareto_top20_pct?.toFixed(1)}% tổng doanh thu — Pareto 80/20 đang hoạt động rõ rệt.`,
      y_nghia: "Mức độ tập trung doanh thu cao đồng nghĩa rủi ro lớn nếu mất bất kỳ đại lý trọng yếu nào — cần chương trình giữ chân chuyên biệt.",
      hanh_dong: `Lập danh sách VIP cho nhóm top 20% (${formatNum(Math.round(kpi.dealers * 0.2))} đại lý), phân công account manager và ưu tiên hạn mức tín dụng trong Q2/2026.`,
    },
    {
      phat_hien: topGroup
        ? `Nhóm "${topGroup.group_name}" chiếm ${topGroup.pct?.toFixed(1)}% tổng doanh thu T3/2026 (${formatVND(topGroup.revenue)}) — nhóm sản phẩm chi phối doanh số toàn danh mục.`
        : `Cơ cấu sản phẩm tập trung — 1 nhóm SP chiếm tỷ trọng vượt trội trong tổng doanh thu T3/2026.`,
      y_nghia: "Mức độ phụ thuộc cao vào một nhóm SP tạo rủi ro doanh thu nếu nhu cầu phân khúc đó sụt giảm hoặc xuất hiện đối thủ cạnh tranh mạnh.",
      hanh_dong: "Đẩy mạnh bán chéo (cross-sell) nhóm xe trẻ em và xe thể thao trong Q2/2026 để cân bằng cơ cấu danh mục và giảm rủi ro tập trung.",
    },
    {
      phat_hien: `Giá bán trung bình đạt ${formatVND(kpi.avg_unit_price)}/chiếc với ${kpi.lines_per_order?.toFixed(1)} dòng hàng/đơn. DT trung bình mỗi đại lý hoạt động: ${formatVND(kpi.avg_per_dealer)}.`,
      y_nghia: "Số dòng hàng/đơn phản ánh mức độ đa dạng hóa đặt hàng của đại lý — thấp hơn 10 dòng/đơn cho thấy còn dư địa tăng giá trị đơn hàng trung bình (AOV).",
      hanh_dong: "Triển khai chương trình bundle Q2: đại lý đặt ≥10 dòng/đơn nhận chiết khấu thêm 1–2%. Mục tiêu tăng AOV lên 15% mà không cần tăng số đơn hàng.",
    },
  ] : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Tổng quan KPI</h1>
        <p className="text-sm text-muted-foreground">Dữ liệu toàn bộ kỳ · nổi bật T3/2026</p>
      </div>

      {/* Metric cards — row 1 */}
      {!kpi ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard icon={Banknote}     label="Doanh thu T3/2026"   value={formatVND(kpi.revenue)}         delta={kpi.mom_revenue_pct} />
          <MetricCard icon={ShoppingCart} label="Đơn hàng T3/2026"    value={formatNum(kpi.orders)}          delta={kpi.mom_orders_pct} />
          <MetricCard icon={Package}      label="Sản lượng T3/2026"   value={formatNum(kpi.qty) + " chiếc"} />
          <MetricCard icon={Users}        label="Đại lý hoạt động"    value={formatNum(kpi.active_dealers)}  sub={`/ ${formatNum(kpi.dealers)} tổng`} />
        </div>
      )}
      {/* Metric cards — row 2 */}
      {kpi && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <MetricCard icon={Percent}  label="DT trung bình / đại lý"  value={formatVND(kpi.avg_per_dealer)}  sub="T3/2026" />
          <MetricCard icon={Banknote} label="Giá bán trung bình"       value={formatVND(kpi.avg_unit_price)}  sub="mỗi chiếc T3/2026" />
          <MetricCard icon={Package}  label="Dòng hàng TB / đơn"      value={kpi.lines_per_order?.toFixed(1) + " dòng"} sub="T3/2026" />
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
          <CardContent className="space-y-4">
            {insights.length === 0 ? <Skeleton className="h-52" /> : insights.map((ins, i) => (
              <div key={i} className="rounded-lg border border-border/60 p-3 space-y-2">
                <div className="flex gap-2">
                  <Badge className="text-[10px] bg-blue-500/20 text-blue-400 border-0">Phát hiện</Badge>
                </div>
                <p className="text-xs leading-relaxed">{ins.phat_hien}</p>
                <div className="pl-2 border-l-2 border-amber-500/50 space-y-1">
                  <p className="text-[10px] font-medium text-amber-400">Ý nghĩa</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{ins.y_nghia}</p>
                </div>
                <div className="pl-2 border-l-2 border-emerald-500/50 space-y-1">
                  <p className="text-[10px] font-medium text-emerald-400">Hành động</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{ins.hanh_dong}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
