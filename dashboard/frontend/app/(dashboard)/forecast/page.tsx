"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { formatVND, formatNum, GROUP_COLORS } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AreaChart, Area, BarChart, Bar, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Legend, Cell, ZAxis, ReferenceLine, ReferenceArea, ComposedChart, ErrorBar,
} from "recharts";
import { TrendingUp, TrendingDown, AlertTriangle, Users, Package, Minus } from "lucide-react";

/* ── Types ── */
interface SkuQ2 { product_code: string; product_name: string; color: string; line_name: string; group_name: string; total_qty_q1: number; total_revenue_q1: number; q2_revenue_proj: number; }
interface RevenueForecast {
  historical: { group: string; ds: string; revenue: number }[];
  forecast:   { group: string; ds: string; yhat: number; lower: number; upper: number }[];
  total_q2:   Record<string, number>;
  backtest:   Record<string, { actual: number; predicted: number; mape_pct: number }>;
  top_skus_q2: SkuQ2[];
}
interface ColorTrend {
  color: string; qty_q1_2025: number; qty_q1_2026: number;
  yoy_pct: number | null; pct_of_total_q1_2026: number;
}
interface ColorForecast {
  color_trends: ColorTrend[];
  q2_color_mix: { color: string; q2_qty_projected: number; q2_pct: number; trend: string; yoy_pct: number | null; qty_q1_2026: number }[];
  growing_colors: string[];
  declining_colors: string[];
  slow_moving_skus: { product_code: string; product_name: string; color: string; line_name: string; group_name: string; total_qty: number; days_no_sale: number }[];
  top_skus_q1_2026: { product_code: string; product_name: string; color: string; line_name: string; group_name: string; total_qty: number; total_revenue: number }[];
}
interface ChurnDealer {
  customer_code: string; customer_name: string; province_name: string; region: string;
  recency_days: number; frequency: number; monetary: number;
  freq_90d: number; churn_proba: number; churn_segment: string;
  prob_order_30d: number; priority_score: number;
}
interface ChurnForecast {
  dealers: ChurnDealer[];
  metrics: { roc_auc_mean: number; roc_auc_std: number; churn_count: number; total_dealers: number };
}

/* ── Colors ── */
const TREND_COLORS: Record<string, string> = { tăng: "#10b981", giảm: "#ef4444", "ổn định": "#6b7280" };
const SEGMENT_COLORS: Record<string, string> = {
  "Ổn định": "#10b981", "Theo dõi": "#3b82f6",
  "Cảnh báo": "#f59e0b", "Nguy hiểm": "#ef4444",
};
const Q2_MONTHS = ["2026-04", "2026-05", "2026-06"];
const Q2_LABELS: Record<string, string> = { "2026-04": "Tháng 4", "2026-05": "Tháng 5", "2026-06": "Tháng 6" };

/* ── Helpers ── */
function InsightBox({ phat_hien, y_nghia, hanh_dong }: { phat_hien: string; y_nghia: string; hanh_dong: string }) {
  return (
    <div className="rounded-lg border border-border/60 p-3 space-y-2">
      <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-blue-500/20 text-blue-400">Phát hiện</span>
      <p className="text-xs leading-relaxed">{phat_hien}</p>
      <div className="pl-2 border-l-2 border-amber-500/50 space-y-1">
        <p className="text-[10px] font-medium text-amber-400">Ý nghĩa</p>
        <p className="text-xs text-muted-foreground leading-relaxed">{y_nghia}</p>
      </div>
      <div className="pl-2 border-l-2 border-emerald-500/50 space-y-1">
        <p className="text-[10px] font-medium text-emerald-400">Hành động</p>
        <p className="text-xs text-muted-foreground leading-relaxed">{hanh_dong}</p>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   TAB 1 — REVENUE FORECAST
══════════════════════════════════════════════════════════════ */
function RevenueTab({ data }: { data: RevenueForecast | null }) {
  if (!data) return <Skeleton className="h-96" />;

  // Merge historical + forecast into one timeline per group
  const groups = [...new Set(data.historical.map(r => r.group))];
  const allDates = [
    ...new Set([
      ...data.historical.map(r => r.ds),
      ...data.forecast.map(r => r.ds),
    ]),
  ].sort();

  const areaData = allDates.map(ds => {
    const row: Record<string, unknown> = {
      ds,
      label: ds.slice(0, 7),
      isForecast: Q2_MONTHS.includes(ds),
    };
    groups.forEach(g => {
      const h = data.historical.find(r => r.ds === ds && r.group === g);
      const f = data.forecast.find(r => r.ds === ds && r.group === g);
      row[g] = h ? h.revenue : f ? f.yhat : null;
      if (f) row[`${g}_lower`] = f.lower;
      if (f) row[`${g}_upper`] = f.upper;
    });
    return row;
  });

  const totalQ2 = Object.values(data.total_q2).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="col-span-2">
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Tổng DT dự báo Q2/2026</p>
            <p className="text-3xl font-bold text-primary">{formatVND(totalQ2 * 1e9)}</p>
            <p className="text-xs text-muted-foreground mt-1">Tháng 4 + 5 + 6/2026</p>
          </CardContent>
        </Card>
        {Object.entries(data.total_q2).slice(0, 2).map(([grp, val]) => (
          <Card key={grp}>
            <CardContent className="pt-4">
              <p className="text-[10px] text-muted-foreground truncate">{grp}</p>
              <p className="text-xl font-bold">{val.toFixed(1)}tỷ</p>
              <p className="text-[10px] text-muted-foreground">Dự báo Q2</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Timeline chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            Xu hướng & Dự báo doanh thu (Jan/2025 → Jun/2026)
            <span className="text-[10px] text-muted-foreground font-normal">Vùng cam = dự báo Q2 (khoảng tin cậy ±20%)</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={areaData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="label" tick={{ fontSize: 9 }} interval={1} />
              <YAxis tickFormatter={v => `${(Number(v) / 1e9).toFixed(0)}tỷ`} tick={{ fontSize: 10 }} width={40} />
              <Tooltip formatter={(v) => formatVND(Number(v ?? 0))} />
              <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10 }} />
              {/* Forecast confidence zone */}
              <ReferenceArea x1="2026-04" x2="2026-06" fill="#f59e0b" fillOpacity={0.08} strokeOpacity={0} />
              <ReferenceLine x="2026-04" stroke="#f59e0b" strokeDasharray="4 4" label={{ value: "Dự báo →", fontSize: 9, fill: "#f59e0b" }} />
              {groups.map(g => (
                <Area key={g} type="monotone" dataKey={g}
                  stroke={GROUP_COLORS[g] ?? "#6b7280"}
                  fill={GROUP_COLORS[g] ?? "#6b7280"}
                  fillOpacity={0.12} strokeWidth={2} name={g}
                  connectNulls />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Q2 confidence interval chart */}
      {(() => {
        const q2CI = Q2_MONTHS.map(month => {
          const rows = data.forecast.filter(r => r.ds === month);
          const yhat = rows.reduce((s, r) => s + r.yhat, 0);
          const lower = rows.reduce((s, r) => s + r.lower, 0);
          const upper = rows.reduce((s, r) => s + r.upper, 0);
          return { month: Q2_LABELS[month], yhat: Math.round(yhat / 1e9 * 10) / 10, lower: Math.round(lower / 1e9 * 10) / 10, upper: Math.round(upper / 1e9 * 10) / 10 };
        });
        return (
          <Card>
            <CardHeader><CardTitle className="text-sm">Khoảng tin cậy dự báo Q2/2026 (khoảng ±20%)</CardTitle></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={160}>
                <ComposedChart data={q2CI} margin={{ top: 10, right: 30, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                  <YAxis tickFormatter={v => `${v}tỷ`} tick={{ fontSize: 10 }} width={40} />
                  <Tooltip formatter={(v, n) => [`${v}tỷ`, String(n)]} />
                  <Bar dataKey="yhat" name="Dự báo (tỷ)" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={48}>
                    <ErrorBar dataKey={(d: { yhat: number; lower: number; upper: number }) => [d.yhat - d.lower, d.upper - d.yhat] as unknown as number} width={8} strokeWidth={2} stroke="#f59e0b" />
                  </Bar>
                </ComposedChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        );
      })()}

      {/* Q2 breakdown by month with CI range */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {Q2_MONTHS.map(month => {
          const rows = data.forecast.filter(r => r.ds === month);
          const total = rows.reduce((s, r) => s + r.yhat, 0);
          const lower = rows.reduce((s, r) => s + r.lower, 0);
          const upper = rows.reduce((s, r) => s + r.upper, 0);
          return (
            <Card key={month}>
              <CardHeader><CardTitle className="text-sm">{Q2_LABELS[month]}</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xl font-bold">{formatVND(total)}</p>
                <p className="text-[10px] text-muted-foreground">
                  Khoảng tin cậy: [{formatVND(lower)} – {formatVND(upper)}]
                </p>
                <div className="space-y-1">
                  {rows.sort((a, b) => b.yhat - a.yhat).map(r => (
                    <div key={r.group} className="flex justify-between text-xs">
                      <span className="truncate text-muted-foreground">{r.group}</span>
                      <span className="font-medium ml-2 shrink-0">{(r.yhat / 1e9).toFixed(1)}tỷ</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Backtest accuracy */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Kiểm định mô hình — Backtest T3/2026</CardTitle></CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">Train đến T2/2026, dự báo T3/2026 và so sánh với thực tế.</p>
          <div className="overflow-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border">
                {["Nhóm SP", "Thực tế (tỷ)", "Dự báo (tỷ)", "MAPE %"].map(h => (
                  <th key={h} className="text-left pb-2 text-muted-foreground font-medium pr-4">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {Object.entries(data.backtest).map(([grp, bt]) => (
                  <tr key={grp} className="border-b border-border/40">
                    <td className="py-1.5 pr-4 font-medium">{grp}</td>
                    <td className="py-1.5 pr-4">{bt.actual}tỷ</td>
                    <td className="py-1.5 pr-4">{bt.predicted}tỷ</td>
                    <td className="py-1.5">
                      <Badge className={`text-[10px] ${bt.mape_pct < 20 ? "bg-emerald-500/20 text-emerald-400" : bt.mape_pct < 40 ? "bg-amber-500/20 text-amber-400" : "bg-red-500/20 text-red-400"}`}>
                        {bt.mape_pct < 900 ? `${bt.mape_pct}%` : "N/A"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Top 20 SKU Q2 projection */}
      {data.top_skus_q2 && data.top_skus_q2.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Top 20 SKU dự kiến bán chạy Q2/2026 (chiếu từ tỷ trọng Q1/2026)</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-auto max-h-64">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-border">
                  {["#", "Sản phẩm", "Màu", "Nhóm SP", "SL Q1/2026", "DT Q1/2026", "Dự báo Q2 (tỷ)"].map(h => (
                    <th key={h} className="text-left pb-2 text-muted-foreground font-medium pr-3">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {data.top_skus_q2.map((s, i) => (
                    <tr key={s.product_code} className="border-b border-border/40">
                      <td className="py-1.5 pr-3 text-muted-foreground">{i + 1}</td>
                      <td className="py-1.5 pr-3 max-w-40 truncate font-medium">{s.product_name}</td>
                      <td className="py-1.5 pr-3"><Badge className="text-[9px] bg-accent">{s.color}</Badge></td>
                      <td className="py-1.5 pr-3 text-muted-foreground truncate max-w-25">{s.group_name}</td>
                      <td className="py-1.5 pr-3">{formatNum(s.total_qty_q1)}</td>
                      <td className="py-1.5 pr-3">{formatVND(s.total_revenue_q1)}</td>
                      <td className="py-1.5 font-bold text-primary">{s.q2_revenue_proj}tỷ</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Insight */}
      <InsightBox
        phat_hien={`Dự báo tổng doanh thu Q2/2026 đạt ${formatVND(totalQ2 * 1e9)} — phân bổ đều qua 3 tháng (${Q2_MONTHS.map(m => `${Q2_LABELS[m]}: ${formatVND(data.forecast.filter(r => r.ds === m).reduce((s, r) => s + r.yhat, 0))}`).join(", ")}).`}
        y_nghia="Mô hình YoY-adjusted (dampened 50%) được train trên 6 tháng lịch sử (Q1/2025 và Q1/2026), áp dụng tốc độ tăng trưởng YoY trung vị và phân phối mùa vụ Q2 (T4: 95%, T5: 105%, T6: 100% so với baseline)."
        hanh_dong="Sử dụng dự báo này để lập kế hoạch sản xuất và đặt hàng Q2: ưu tiên tăng tồn kho nhóm có dự báo cao, thương lượng chiết khấu với đại lý lớn trong tháng 4."
      />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   TAB 2 — COLOR & SEASONALITY
══════════════════════════════════════════════════════════════ */
function ColorTab({ data }: { data: ColorForecast | null }) {
  if (!data) return <Skeleton className="h-96" />;

  function exportSlowMovingCSV() {
    const rows = [
      ["Mã SP", "Tên sản phẩm", "Màu", "Nhóm SP", "Tổng SL", "Ngày không có đơn"],
      ...data.slow_moving_skus.map(s => [
        s.product_code, s.product_name, s.color, s.group_name, s.total_qty, s.days_no_sale,
      ]),
    ];
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "slow_moving_skus.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  const top12Mix = data.q2_color_mix.slice(0, 12);
  const top12Trends = data.color_trends.slice(0, 12);

  return (
    <div className="space-y-5">
      {/* Summary badges */}
      <div className="flex flex-wrap gap-2">
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
          <p className="text-[10px] text-emerald-400 font-medium">Màu tăng mạnh Q2</p>
          <p className="text-xs font-bold">{data.growing_colors.join(" · ") || "—"}</p>
        </div>
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
          <p className="text-[10px] text-red-400 font-medium">Màu giảm Q2</p>
          <p className="text-xs font-bold">{data.declining_colors.join(" · ") || "—"}</p>
        </div>
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          <p className="text-[10px] text-amber-400 font-medium">SKU tồn kho rủi ro</p>
          <p className="text-xs font-bold">{data.slow_moving_skus.length} SKU</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Q2 Color Mix */}
        <Card>
          <CardHeader><CardTitle className="text-sm">Cơ cấu màu dự báo Q2/2026 (% SL)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={top12Mix} layout="vertical" margin={{ top: 0, right: 60, left: 80, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-border" />
                <XAxis type="number" tick={{ fontSize: 9 }} tickFormatter={v => `${v}%`} />
                <YAxis type="category" dataKey="color" tick={{ fontSize: 9 }} width={78} />
                <Tooltip formatter={(v) => `${Number(v ?? 0).toFixed(1)}%`} />
                <Bar dataKey="q2_pct" name="% SL dự kiến" radius={[0, 3, 3, 0]}>
                  {top12Mix.map(entry => (
                    <Cell key={entry.color} fill={TREND_COLORS[entry.trend] ?? "#6b7280"} fillOpacity={0.8} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* YoY color growth */}
        <Card>
          <CardHeader><CardTitle className="text-sm">Tăng trưởng YoY theo màu sắc (Q1/2025 → Q1/2026)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={top12Trends} layout="vertical" margin={{ top: 0, right: 50, left: 80, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} className="stroke-border" />
                <XAxis type="number" tick={{ fontSize: 9 }} tickFormatter={v => `${v}%`} />
                <YAxis type="category" dataKey="color" tick={{ fontSize: 9 }} width={78} />
                <Tooltip formatter={(v) => `${Number(v ?? 0).toFixed(1)}%`} />
                <ReferenceLine x={0} stroke="#6b7280" strokeDasharray="3 3" />
                <Bar dataKey="yoy_pct" name="YoY %" radius={[0, 3, 3, 0]}>
                  {top12Trends.map(entry => (
                    <Cell key={entry.color}
                      fill={(entry.yoy_pct ?? 0) >= 0 ? "#10b981" : "#ef4444"}
                      fillOpacity={0.8} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Top 20 SKUs Q1/2026 */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Top 20 SKU bán chạy Q1/2026 — Dự kiến dẫn đầu Q2</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-auto max-h-64">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border">
                {["#", "Sản phẩm", "Màu", "Dòng xe", "SL Q1/2026", "DT Q1/2026"].map(h => (
                  <th key={h} className="text-left pb-2 text-muted-foreground font-medium pr-3">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {data.top_skus_q1_2026.map((s, i) => (
                  <tr key={s.product_code} className="border-b border-border/40">
                    <td className="py-1.5 pr-3 text-muted-foreground">{i + 1}</td>
                    <td className="py-1.5 pr-3 max-w-[160px] truncate font-medium">{s.product_name}</td>
                    <td className="py-1.5 pr-3"><Badge className="text-[9px] bg-accent">{s.color}</Badge></td>
                    <td className="py-1.5 pr-3 text-muted-foreground truncate max-w-[100px]">{s.line_name}</td>
                    <td className="py-1.5 pr-3">{formatNum(s.total_qty)}</td>
                    <td className="py-1.5">{formatVND(s.total_revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Slow-moving SKUs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            SKU tồn kho rủi ro — Ít bán hoặc không có đơn gần đây
            <button onClick={exportSlowMovingCSV}
              className="ml-auto text-[10px] px-2 py-1 rounded bg-primary/20 text-primary hover:bg-primary/30 transition-colors">
              Tải CSV
            </button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto max-h-52">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border">
                {["Sản phẩm", "Màu", "Nhóm", "Tổng SL", "Ngày không có đơn"].map(h => (
                  <th key={h} className="text-left pb-2 text-muted-foreground font-medium pr-3">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {data.slow_moving_skus.map(s => (
                  <tr key={s.product_code} className="border-b border-border/40">
                    <td className="py-1.5 pr-3 max-w-[150px] truncate font-medium">{s.product_name}</td>
                    <td className="py-1.5 pr-3 text-muted-foreground">{s.color}</td>
                    <td className="py-1.5 pr-3 text-muted-foreground truncate max-w-[80px]">{s.group_name}</td>
                    <td className="py-1.5 pr-3">{formatNum(s.total_qty)}</td>
                    <td className="py-1.5">
                      <Badge className={`text-[9px] ${Number(s.days_no_sale) > 90 ? "bg-red-500/20 text-red-400" : "bg-amber-500/20 text-amber-400"}`}>
                        {s.days_no_sale} ngày
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Insight */}
      <InsightBox
        phat_hien={`Màu tăng mạnh Q2: ${data.growing_colors.slice(0, 3).join(", ")}. Màu có nguy cơ dư tồn: ${data.declining_colors.slice(0, 3).join(", ")}. ${data.slow_moving_skus.length} SKU không có đơn hàng mới trong vòng 90+ ngày.`}
        y_nghia="Xu hướng màu sắc phản ánh thị hiếu người tiêu dùng cuối — đại lý điều chỉnh đặt hàng theo màu bán chạy của mùa. Q2 thường thấy nhu cầu tăng với các màu sáng (xuân-hè)."
        hanh_dong={`Tăng lô hàng màu ${data.growing_colors[0] ?? "bán chạy"} cho Q2. Xem xét giảm giá hoặc đóng gói combo cho ${data.slow_moving_skus.length} SKU slow-moving để giải phóng tồn kho trước mùa hè.`}
      />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   TAB 3 — CHURN PREDICTION
══════════════════════════════════════════════════════════════ */
function ChurnTab({ data }: { data: ChurnForecast | null }) {
  if (!data) return <Skeleton className="h-96" />;

  const highRisk = data.dealers.filter(d => d.churn_proba > 70);
  const scatterData = data.dealers.map(d => ({
    x: d.recency_days,
    y: d.churn_proba,
    z: Math.min(d.monetary / 1e6, 500),
    name: d.customer_name,
    seg: d.churn_segment,
  }));

  const segCounts = Object.entries(
    data.dealers.reduce((acc, d) => {
      acc[d.churn_segment] = (acc[d.churn_segment] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>)
  ).sort((a, b) => b[1] - a[1]);

  function exportCSV() {
    const rows = [
      ["Mã KH", "Tên đại lý", "Tỉnh/TP", "Vùng", "Ngày không đặt", "Tần suất", "Churn %", "XS đặt hàng 30d %", "Điểm ưu tiên", "Phân loại"],
      ...highRisk.map(d => [
        d.customer_code, d.customer_name, d.province_name, d.region,
        d.recency_days, d.frequency, d.churn_proba, d.prob_order_30d, d.priority_score, d.churn_segment,
      ]),
    ];
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "churn_risk_dealers.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      {/* Model metrics + summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card><CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">ROC-AUC (5-fold CV)</p>
          <p className="text-2xl font-bold text-primary">{data.metrics.roc_auc_mean.toFixed(3)}</p>
          <p className="text-[10px] text-muted-foreground">±{data.metrics.roc_auc_std.toFixed(3)}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Nguy hiểm (&gt;70%)</p>
          <p className="text-2xl font-bold text-red-400">{highRisk.length}</p>
          <p className="text-[10px] text-muted-foreground">đại lý</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Tổng đại lý</p>
          <p className="text-2xl font-bold">{data.metrics.total_dealers}</p>
          <p className="text-[10px] text-muted-foreground">trong hệ thống</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4">
          <p className="text-xs text-muted-foreground">Hiện đang churn</p>
          <p className="text-2xl font-bold text-amber-400">{data.metrics.churn_count}</p>
          <p className="text-[10px] text-muted-foreground">(&gt;45 ngày không đặt)</p>
        </CardContent></Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Scatter */}
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-sm">Scatter: Recency × Churn Probability (size = doanh thu)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <ScatterChart margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis type="number" dataKey="x" name="Ngày không đặt" tick={{ fontSize: 9 }} label={{ value: "Ngày không đặt", position: "insideBottom", offset: -3, fontSize: 10 }} />
                <YAxis type="number" dataKey="y" name="Churn %" tick={{ fontSize: 9 }} domain={[0, 100]}
                  label={{ value: "Churn %", angle: -90, position: "insideLeft", fontSize: 10 }} />
                <ZAxis type="number" dataKey="z" range={[20, 300]} />
                <Tooltip cursor={{ strokeDasharray: "3 3" }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload;
                    return (
                      <div className="bg-card border border-border rounded p-2 text-xs">
                        <p className="font-medium truncate max-w-[180px]">{d.name}</p>
                        <p>Recency: {d.x} ngày</p>
                        <p>Churn: {d.y}%</p>
                        <Badge className="text-[9px] mt-1" style={{ backgroundColor: SEGMENT_COLORS[d.seg] + "33", color: SEGMENT_COLORS[d.seg] }}>{d.seg}</Badge>
                      </div>
                    );
                  }}
                />
                <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="4 4" label={{ value: "70% threshold", fontSize: 9, fill: "#ef4444" }} />
                <ReferenceLine x={45} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: "45 ngày", fontSize: 9, fill: "#f59e0b" }} />
                {Object.entries(SEGMENT_COLORS).map(([seg, color]) => (
                  <Scatter key={seg} data={scatterData.filter(d => d.seg === seg)}
                    fill={color} fillOpacity={0.7} name={seg} />
                ))}
              </ScatterChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Segment distribution */}
        <Card>
          <CardHeader><CardTitle className="text-sm">Phân bổ theo mức độ rủi ro</CardTitle></CardHeader>
          <CardContent className="space-y-3 pt-2">
            {segCounts.map(([seg, cnt]) => (
              <div key={seg}>
                <div className="flex justify-between text-xs mb-1">
                  <span style={{ color: SEGMENT_COLORS[seg] }} className="font-medium">{seg}</span>
                  <span className="text-muted-foreground">{cnt} đại lý ({((cnt / data.dealers.length) * 100).toFixed(0)}%)</span>
                </div>
                <div className="bg-muted rounded-full h-2">
                  <div className="h-2 rounded-full" style={{
                    width: `${(cnt / data.dealers.length) * 100}%`,
                    backgroundColor: SEGMENT_COLORS[seg],
                  }} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* High-risk table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-400" />
            Top đại lý nguy cơ churn cao (&gt;70%) — {highRisk.length} đại lý
            <button onClick={exportCSV}
              className="ml-auto text-[10px] px-2 py-1 rounded bg-primary/20 text-primary hover:bg-primary/30 transition-colors">
              Tải CSV
            </button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-auto max-h-64">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border">
                {["Đại lý", "Tỉnh/TP", "Ngày không đặt", "Churn %", "XS đặt hàng 30d", "Ưu tiên", "Phân loại"].map(h => (
                  <th key={h} className="text-left pb-2 text-muted-foreground font-medium pr-3">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {highRisk.slice(0, 50).map(d => (
                  <tr key={d.customer_code} className="border-b border-border/40">
                    <td className="py-1.5 pr-3 max-w-40">
                      <p className="font-medium truncate">{d.customer_name}</p>
                      <p className="text-[9px] text-muted-foreground">{d.customer_code}</p>
                    </td>
                    <td className="py-1.5 pr-3 text-muted-foreground">{d.province_name}</td>
                    <td className="py-1.5 pr-3">
                      <Badge className={`text-[9px] ${d.recency_days > 90 ? "bg-red-500/20 text-red-400" : "bg-amber-500/20 text-amber-400"}`}>
                        {d.recency_days}d
                      </Badge>
                    </td>
                    <td className="py-1.5 pr-3 font-bold" style={{ color: "#ef4444" }}>{d.churn_proba}%</td>
                    <td className="py-1.5 pr-3 text-emerald-400 font-medium">{d.prob_order_30d}%</td>
                    <td className="py-1.5 pr-3">
                      <span className="text-xs font-bold text-amber-400">{d.priority_score?.toFixed(0)}</span>
                    </td>
                    <td className="py-1.5">
                      <Badge className="text-[9px]" style={{ backgroundColor: SEGMENT_COLORS[d.churn_segment] + "33", color: SEGMENT_COLORS[d.churn_segment] }}>
                        {d.churn_segment}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Insight */}
      <InsightBox
        phat_hien={`Mô hình GradientBoosting (ROC-AUC ${data.metrics.roc_auc_mean.toFixed(2)}) xác định ${highRisk.length} đại lý có xác suất churn >70% trong 30 ngày tới — chiếm ${((highRisk.length / data.dealers.length) * 100).toFixed(0)}% tổng mạng lưới.`}
        y_nghia="Các đại lý nguy cơ cao có đặc điểm chung: thời gian không đặt hàng dài, tần suất mua thấp trong 90 ngày gần nhất, và doanh số Q1/2026 giảm so với cùng kỳ. Đây là nhóm ưu tiên can thiệp nhất."
        hanh_dong={`Liên hệ trực tiếp ${Math.min(highRisk.length, 30)} đại lý nguy cơ cao nhất trong tuần đầu tháng 4. Cung cấp ưu đãi chiết khấu 3-5% hoặc chương trình consignment để giảm rào cản đặt hàng. Tải danh sách CSV để phân công account manager.`}
      />
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN PAGE
══════════════════════════════════════════════════════════════ */
export default function ForecastPage() {
  const [status, setStatus] = useState({ revenue_ready: false, color_ready: false, churn_ready: false });
  const [revenue, setRevenue] = useState<RevenueForecast | null>(null);
  const [colors, setColors] = useState<ColorForecast | null>(null);
  const [churn, setChurn] = useState<ChurnForecast | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Poll status until all caches are ready
    const checkStatus = async () => {
      try {
        const s = await apiFetch<typeof status>("/api/forecast/status");
        setStatus(s);
        if (s.revenue_ready && s.color_ready && s.churn_ready) {
          setLoading(false);
          const [r, c, ch] = await Promise.all([
            apiFetch<RevenueForecast>("/api/forecast/revenue"),
            apiFetch<ColorForecast>("/api/forecast/colors"),
            apiFetch<ChurnForecast>("/api/forecast/churn"),
          ]);
          setRevenue(r); setColors(c); setChurn(ch);
        } else {
          setTimeout(checkStatus, 3000);
        }
      } catch { setTimeout(checkStatus, 5000); }
    };
    checkStatus();
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dự báo nhu cầu Q2/2026</h1>
        <p className="text-sm text-muted-foreground">Prophet time-series · GradientBoosting churn · Phân tích màu sắc</p>
      </div>

      {loading && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
          <p className="font-medium text-amber-400">Đang huấn luyện mô hình dự báo...</p>
          <p className="text-xs text-muted-foreground mt-1">
            Revenue: {status.revenue_ready ? "✅" : "⏳"} ·
            Màu sắc: {status.color_ready ? "✅" : "⏳"} ·
            Churn: {status.churn_ready ? "✅" : "⏳"}
          </p>
        </div>
      )}

      <Tabs defaultValue="revenue">
        <TabsList className="grid grid-cols-3 w-full max-w-lg">
          <TabsTrigger value="revenue">Doanh số Q2</TabsTrigger>
          <TabsTrigger value="colors">Màu sắc & SKU</TabsTrigger>
          <TabsTrigger value="churn">Churn Prediction</TabsTrigger>
        </TabsList>

        <TabsContent value="revenue" className="mt-4">
          <RevenueTab data={revenue} />
        </TabsContent>
        <TabsContent value="colors" className="mt-4">
          <ColorTab data={colors} />
        </TabsContent>
        <TabsContent value="churn" className="mt-4">
          <ChurnTab data={churn} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
