"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { formatVND, formatNum, RFM_COLORS, PALETTE } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ScatterChart, Scatter, XAxis, YAxis, ZAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, LineChart, Line, ReferenceLine, BarChart, Bar, Legend,
} from "recharts";

interface RFM { customer_code: string; customer_name: string; province_name: string; region: string;
  recency_days: number; frequency: number; monetary: number; r_score: number; f_score: number; m_score: number; segment: string; }
interface Churn { customer_code: string; customer_name: string; province_name: string;
  last_order_date: string; days_since_last_order: number; total_orders: number; total_revenue: number; }
interface TopDealer { customer_code: string; customer_name: string; province_name: string; region: string; revenue: number; orders: number; }
interface Pareto { rnk: number; customer_code: string; revenue: number; dealer_pct: number; cumulative_pct: number; }

const SEGMENT_ORDER = ["Champions", "Loyal", "Promising", "At Risk", "Lost"];

export default function CustomersPage() {
  const [rfm, setRfm] = useState<RFM[]>([]);
  const [churn, setChurn] = useState<Churn[]>([]);
  const [top, setTop] = useState<TopDealer[]>([]);
  const [pareto, setPareto] = useState<Pareto[]>([]);

  useEffect(() => {
    Promise.all([
      apiFetch<RFM[]>("/api/customers/rfm"),
      apiFetch<Churn[]>("/api/customers/churn"),
      apiFetch<TopDealer[]>("/api/customers/top?limit=10"),
      apiFetch<Pareto[]>("/api/customers/pareto"),
    ]).then(([r, c, t, p]) => { setRfm(r); setChurn(c); setTop(t); setPareto(p); });
  }, []);

  const segmentCounts = SEGMENT_ORDER.map(seg => ({
    seg,
    count: rfm.filter(r => r.segment === seg).length,
  }));

  const paretoLine = pareto.slice(0, 200).map(p => ({
    dealer_pct: p.dealer_pct,
    cumulative_pct: p.cumulative_pct,
  }));

  // Find where ~80% revenue is reached
  const pareto80 = pareto.find(p => p.cumulative_pct >= 80);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Phân tích đại lý</h1>
        <p className="text-sm text-muted-foreground">RFM segmentation · Churn risk · Pareto 80/20</p>
      </div>

      {/* RFM Scatter + Segment summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">RFM Scatter — Recency × Frequency (kích thước = Monetary)</CardTitle>
          </CardHeader>
          <CardContent>
            {rfm.length === 0 ? <Skeleton className="h-64" /> : (
              <ResponsiveContainer width="100%" height={260}>
                <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="recency_days" name="Recency" unit=" ngày" tick={{ fontSize: 9 }}
                    label={{ value: "Recency (ngày kể từ đơn cuối)", position: "insideBottom", offset: -10, fontSize: 9 }} />
                  <YAxis dataKey="frequency" name="Frequency" tick={{ fontSize: 9 }}
                    label={{ value: "Frequency (số đơn)", angle: -90, position: "insideLeft", fontSize: 9 }} />
                  <ZAxis dataKey="monetary" range={[20, 800]} name="Monetary" />
                  <Tooltip cursor={{ strokeDasharray: "3 3" }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.[0]) return null;
                      const d = payload[0].payload as RFM;
                      return (
                        <div className="rounded-lg bg-card border border-border p-2 text-xs shadow-lg max-w-48">
                          <p className="font-medium truncate">{d.customer_name}</p>
                          <p className="text-muted-foreground">{d.province_name}</p>
                          <p>Recency: {d.recency_days} ngày</p>
                          <p>Frequency: {d.frequency} đơn</p>
                          <p>Monetary: {formatVND(d.monetary)}</p>
                          <Badge className="mt-1 text-[9px]" style={{ backgroundColor: RFM_COLORS[d.segment] }}>{d.segment}</Badge>
                        </div>
                      );
                    }}
                  />
                  <Scatter data={rfm.slice(0, 500)}>
                    {rfm.slice(0, 500).map((d, i) => (
                      <Cell key={i} fill={RFM_COLORS[d.segment] ?? "#6b7280"} fillOpacity={0.7} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Phân bổ segment RFM</CardTitle></CardHeader>
          <CardContent>
            {rfm.length === 0 ? <Skeleton className="h-64" /> : (
              <div className="space-y-3">
                {segmentCounts.map(({ seg, count }) => (
                  <div key={seg}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-medium" style={{ color: RFM_COLORS[seg] }}>{seg}</span>
                      <span className="text-muted-foreground">{count} đại lý</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2">
                      <div className="h-2 rounded-full" style={{
                        width: `${rfm.length > 0 ? (count / rfm.length * 100) : 0}%`,
                        backgroundColor: RFM_COLORS[seg],
                      }} />
                    </div>
                  </div>
                ))}
                <p className="text-[10px] text-muted-foreground mt-2 pt-2 border-t border-border">
                  Tổng: {rfm.length} đại lý được phân tích
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Pareto + Top dealers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              Đường cong Pareto 80/20
              {pareto80 && (
                <Badge variant="secondary" className="text-[10px]">
                  Top {pareto80.dealer_pct?.toFixed(0)}% → {pareto80.cumulative_pct?.toFixed(0)}% DT
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {paretoLine.length === 0 ? <Skeleton className="h-52" /> : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={paretoLine} margin={{ top: 5, right: 20, bottom: 20, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="dealer_pct" unit="%" tick={{ fontSize: 9 }}
                    label={{ value: "% Đại lý (xếp theo DT)", position: "insideBottom", offset: -10, fontSize: 9 }} />
                  <YAxis unit="%" tick={{ fontSize: 9 }}
                    label={{ value: "% Doanh thu tích lũy", angle: -90, position: "insideLeft", fontSize: 9 }} />
                  <Tooltip formatter={(v) => `${Number(v ?? 0).toFixed(1)}%`} />
                  <ReferenceLine y={80} stroke="#f59e0b" strokeDasharray="4 2" />
                  <ReferenceLine x={pareto80?.dealer_pct} stroke="#f59e0b" strokeDasharray="4 2" />
                  <Line type="monotone" dataKey="cumulative_pct" stroke="#3b82f6" strokeWidth={2} dot={false} name="% DT tích lũy" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Top 10 đại lý theo doanh thu</CardTitle></CardHeader>
          <CardContent>
            {top.length === 0 ? <Skeleton className="h-52" /> : (
              <div className="space-y-2">
                {top.map((d, i) => (
                  <div key={d.customer_code} className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-5 text-right">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-baseline">
                        <p className="text-xs font-medium truncate">{d.customer_name}</p>
                        <p className="text-xs text-right shrink-0 ml-2">{formatVND(d.revenue)}</p>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="flex-1 bg-muted rounded-full h-1.5">
                          <div className="h-1.5 rounded-full bg-primary"
                            style={{ width: `${(d.revenue / top[0].revenue) * 100}%` }} />
                        </div>
                        <p className="text-[9px] text-muted-foreground shrink-0">{d.province_name}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Churn risk table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            Danh sách đại lý nguy cơ churn
            <Badge variant="destructive" className="text-[10px]">&gt; 45 ngày không đặt hàng</Badge>
            <span className="ml-auto text-xs text-muted-foreground">{churn.length} đại lý</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {churn.length === 0 ? <Skeleton className="h-40" /> : (
            <div className="overflow-auto max-h-56">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-border">
                  {["Đại lý","Tỉnh / Vùng","Đơn cuối","Cách (ngày)","Tổng đơn","Tổng DT"].map(h => (
                    <th key={h} className="text-left pb-2 text-muted-foreground font-medium pr-3">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {churn.slice(0, 30).map(c => (
                    <tr key={c.customer_code} className="border-b border-border/40">
                      <td className="py-1.5 pr-3 font-medium max-w-[150px] truncate">{c.customer_name}</td>
                      <td className="py-1.5 pr-3 text-muted-foreground">{c.province_name}</td>
                      <td className="py-1.5 pr-3">{c.last_order_date}</td>
                      <td className="py-1.5 pr-3">
                        <Badge variant="destructive" className="text-[9px]">{c.days_since_last_order}d</Badge>
                      </td>
                      <td className="py-1.5 pr-3">{c.total_orders}</td>
                      <td className="py-1.5">{formatVND(c.total_revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Insight */}
      <Card className="bg-accent/20">
        <CardContent className="pt-4">
          <p className="text-xs font-medium mb-2">Insight phân tích đại lý</p>
          <div className="grid grid-cols-3 gap-3 text-xs text-muted-foreground">
            <div className="rounded-lg bg-card p-3">
              <p className="font-medium text-foreground mb-1">Phát hiện</p>
              {churn.length} đại lý không đặt hàng hơn 45 ngày, tổng giá trị lịch sử{" "}
              {formatVND(churn.reduce((a, c) => a + (c.total_revenue ?? 0), 0))}.
            </div>
            <div className="rounded-lg bg-card p-3">
              <p className="font-medium text-foreground mb-1">Ý nghĩa</p>
              Mỗi đại lý churn trung bình mất {formatVND(churn.length > 0 ? churn.reduce((a, c) => a + (c.total_revenue ?? 0), 0) / churn.length : 0)} doanh thu tiềm năng mỗi kỳ.
            </div>
            <div className="rounded-lg bg-card p-3">
              <p className="font-medium text-foreground mb-1">Hành động</p>
              Triển khai chiến dịch tái kích hoạt — gọi điện / ưu đãi giá 5% cho {churn.slice(0, 10).length} đại lý có doanh thu lịch sử cao nhất.
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
