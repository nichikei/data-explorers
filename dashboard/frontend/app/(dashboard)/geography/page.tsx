"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { apiFetch } from "@/lib/api";
import { formatVND, formatNum, PALETTE } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ScatterChart, Scatter, ZAxis, Cell, Legend,
} from "recharts";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

interface Province { region: string; province_name: string; revenue: number; order_count: number; dealer_count: number; quantity: number; avg_revenue_per_dealer: number; }
interface Region { region: string; revenue: number; order_count: number; dealer_count: number; quantity: number; pct: number; }

const REGION_COLORS: Record<string, string> = {
  "Miền Bắc": "#3b82f6",
  "Miền Trung": "#f97316",
  "Miền Nam": "#10b981",
  "Không xác định": "#6b7280",
};

export default function GeographyPage() {
  const [provinces, setProvinces] = useState<Province[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);

  useEffect(() => {
    Promise.all([
      apiFetch<Province[]>("/api/geography/provinces"),
      apiFetch<Region[]>("/api/geography/regions"),
    ]).then(([p, r]) => { setProvinces(p); setRegions(r); });
  }, []);

  // Build Plotly treemap
  const tmIds: string[] = [], tmLabels: string[] = [], tmParents: string[] = [], tmValues: number[] = [], tmColors: string[] = [];
  regions.forEach(r => {
    tmIds.push(`r_${r.region}`);
    tmLabels.push(`${r.region}\n${(r.revenue / 1e9).toFixed(1)}tỷ`);
    tmParents.push("");
    tmValues.push(r.revenue);
    tmColors.push(REGION_COLORS[r.region] ?? "#6b7280");
  });
  provinces.forEach(p => {
    tmIds.push(`p_${p.province_name}`);
    tmLabels.push(`${p.province_name}\n${(p.revenue / 1e9).toFixed(1)}tỷ`);
    tmParents.push(`r_${p.region}`);
    tmValues.push(p.revenue);
    tmColors.push(REGION_COLORS[p.region] ?? "#6b7280");
  });

  const top10 = provinces.slice(0, 10);
  const bottom10 = [...provinces].sort((a, b) => a.revenue - b.revenue).slice(0, 10);

  // Scatter for province comparison
  const scatterData = provinces.map(p => ({
    x: p.order_count,
    y: Math.round(p.avg_revenue_per_dealer / 1e6),
    z: Math.sqrt(p.revenue) / 1e3,
    name: p.province_name,
    region: p.region,
    rev: p.revenue,
    dealers: p.dealer_count,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Phân tích địa lý</h1>
        <p className="text-sm text-muted-foreground">Treemap 3 vùng miền · So sánh tỉnh/thành</p>
      </div>

      {/* Treemap */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Doanh thu theo Vùng → Tỉnh/Thành phố</CardTitle></CardHeader>
        <CardContent>
          {tmIds.length === 0 ? <Skeleton className="h-72" /> : (
            <Plot
              data={[{
                type: "treemap",
                ids: tmIds, labels: tmLabels, parents: tmParents, values: tmValues,
                marker: { colors: tmColors, colorscale: undefined, line: { width: 1, color: "rgba(0,0,0,0.2)" } },
                branchvalues: "total",
                hovertemplate: "<b>%{label}</b><br>Doanh thu: %{value:,.0f}đ<extra></extra>",
                textinfo: "label+value",
              }]}
              layout={{
                margin: { t: 0, b: 0, l: 0, r: 0 }, height: 300,
                paper_bgcolor: "transparent", plot_bgcolor: "transparent",
                font: { size: 10 },
              }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: "100%" }}
            />
          )}
        </CardContent>
      </Card>

      {/* Region bars + Scatter */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">So sánh 3 vùng miền</CardTitle></CardHeader>
          <CardContent>
            {regions.length === 0 ? <Skeleton className="h-52" /> : (
              <>
                <div className="grid grid-cols-3 gap-2 mb-4">
                  {regions.filter(r => r.region !== "Không xác định").map(r => (
                    <div key={r.region} className="text-center rounded-lg p-2 bg-accent/40">
                      <div className="h-2 w-full rounded-full mb-2" style={{ backgroundColor: REGION_COLORS[r.region] }} />
                      <p className="text-xs font-bold">{r.region}</p>
                      <p className="text-sm font-bold">{formatVND(r.revenue)}</p>
                      <p className="text-[10px] text-muted-foreground">{r.pct?.toFixed(1)}% tổng DT</p>
                      <p className="text-[10px] text-muted-foreground">{r.dealer_count} đại lý</p>
                    </div>
                  ))}
                </div>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={regions.filter(r => r.region !== "Không xác định")} layout="vertical" margin={{ left: 10, right: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis type="number" tickFormatter={v => `${(v / 1e9).toFixed(0)}tỷ`} tick={{ fontSize: 9 }} />
                    <YAxis type="category" dataKey="region" tick={{ fontSize: 9 }} width={65} />
                    <Tooltip formatter={(v) => formatVND(Number(v ?? 0))} />
                    <Bar dataKey="revenue" radius={[0,3,3,0]} name="Doanh thu">
                      {regions.filter(r => r.region !== "Không xác định").map(r => (
                        <Cell key={r.region} fill={REGION_COLORS[r.region]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Province scatter — Số đơn × DT TB/đại lý</CardTitle></CardHeader>
          <CardContent>
            {scatterData.length === 0 ? <Skeleton className="h-52" /> : (
              <ResponsiveContainer width="100%" height={220}>
                <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="x" name="Số đơn" tick={{ fontSize: 9 }} label={{ value: "Số đơn", position: "insideBottom", offset: -10, fontSize: 9 }} />
                  <YAxis dataKey="y" name="DT TB/đại lý (tr)" unit="tr" tick={{ fontSize: 9 }} label={{ value: "DT TB/ĐL (tr)", angle: -90, position: "insideLeft", fontSize: 9 }} />
                  <ZAxis dataKey="z" range={[30, 600]} />
                  <Tooltip cursor={{ strokeDasharray: "3 3" }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.[0]) return null;
                      const d = payload[0].payload;
                      return (
                        <div className="rounded-lg bg-card border border-border p-2 text-xs shadow-lg">
                          <p className="font-medium">{d.name}</p>
                          <p style={{ color: REGION_COLORS[d.region] }}>{d.region}</p>
                          <p>Tổng DT: {formatVND(d.rev)}</p>
                          <p>Số đại lý: {d.dealers}</p>
                        </div>
                      );
                    }}
                  />
                  <Scatter data={scatterData}>
                    {scatterData.map((d, i) => (
                      <Cell key={i} fill={REGION_COLORS[d.region] ?? "#6b7280"} fillOpacity={0.75} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top/Bottom provinces table */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[
          { title: "Top 10 tỉnh/thành doanh thu cao", data: top10 },
          { title: "Bottom 10 tỉnh/thành doanh thu thấp", data: bottom10 },
        ].map(({ title, data }) => (
          <Card key={title}>
            <CardHeader><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
            <CardContent>
              <table className="w-full text-xs">
                <thead><tr className="border-b border-border">
                  <th className="text-left pb-1 text-muted-foreground font-medium">Tỉnh/TP</th>
                  <th className="text-right pb-1 text-muted-foreground font-medium">Doanh thu</th>
                  <th className="text-right pb-1 text-muted-foreground font-medium">ĐL</th>
                  <th className="text-right pb-1 text-muted-foreground font-medium">Đơn</th>
                </tr></thead>
                <tbody>
                  {data.map((p, i) => (
                    <tr key={p.province_name} className="border-b border-border/40">
                      <td className="py-1.5">
                        <p className="font-medium">{p.province_name}</p>
                        <p className="text-[9px] text-muted-foreground" style={{ color: REGION_COLORS[p.region] }}>{p.region}</p>
                      </td>
                      <td className="py-1.5 text-right">{formatVND(p.revenue)}</td>
                      <td className="py-1.5 text-right">{p.dealer_count}</td>
                      <td className="py-1.5 text-right">{p.order_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
