"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { apiFetch } from "@/lib/api";
import { formatVND, formatNum, BCG_COLORS, PALETTE } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Cell, ZAxis,
} from "recharts";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false });

interface Hierarchy { group_name: string; line_name: string; product_code: string; product_name: string; revenue: number; quantity: number; }
interface BCG { group_name: string; total_rev: number; total_qty: number; revenue_share_pct: number; yoy_pct: number | null; quadrant: string; }
interface ColorData { color: string; line_name: string; total_qty: number; revenue: number; }
interface TopSku { product_code: string; product_name: string; color: string; line_name: string; revenue: number; total_qty: number; }

const BCG_QUADRANT_LABELS: Record<string, { label: string; desc: string }> = {
  Stars:           { label: "⭐ Stars",      desc: "Tăng trưởng cao + DT cao" },
  "Cash Cows":     { label: "🐄 Cash Cows", desc: "Tăng trưởng thấp + DT cao" },
  "Question Marks":{ label: "❓ Question Marks", desc: "Tăng trưởng cao + DT thấp" },
  Dogs:            { label: "🐕 Dogs",       desc: "Tăng trưởng thấp + DT thấp" },
};

export default function ProductsPage() {
  const [hierarchy, setHierarchy] = useState<Hierarchy[]>([]);
  const [bcg, setBcg] = useState<BCG[]>([]);
  const [colors, setColors] = useState<ColorData[]>([]);
  const [topSku, setTopSku] = useState<TopSku[]>([]);
  const [skuOrder, setSkuOrder] = useState<"top" | "bottom">("top");

  useEffect(() => {
    Promise.all([
      apiFetch<Hierarchy[]>("/api/products/hierarchy", []),
      apiFetch<BCG[]>("/api/products/bcg", []),
      apiFetch<ColorData[]>("/api/products/colors", []),
      apiFetch<TopSku[]>("/api/products/top_sku?limit=20&order=top", []),
    ]).then(([h, b, c, s]) => { setHierarchy(h); setBcg(b); setColors(c); setTopSku(s); });
  }, []);

  function loadSku(order: "top" | "bottom") {
    setSkuOrder(order);
    apiFetch<TopSku[]>(`/api/products/top_sku?limit=20&order=${order}`).then(setTopSku);
  }

  // Build Plotly sunburst data
  const sbIds: string[] = [], sbLabels: string[] = [], sbParents: string[] = [], sbValues: number[] = [];
  const groupMap = new Map<string, number>();
  const lineMap = new Map<string, number>();
  hierarchy.forEach(r => {
    // Group level
    if (!groupMap.has(r.group_name)) {
      groupMap.set(r.group_name, 0);
      sbIds.push(`g_${r.group_name}`);
      sbLabels.push(r.group_name);
      sbParents.push("");
      sbValues.push(0);
    }
    const gi = sbIds.indexOf(`g_${r.group_name}`);
    sbValues[gi] = (sbValues[gi] || 0) + r.revenue;

    // Line level
    const lineKey = `l_${r.line_name}`;
    if (!lineMap.has(lineKey)) {
      lineMap.set(lineKey, 0);
      sbIds.push(lineKey);
      sbLabels.push(r.line_name);
      sbParents.push(`g_${r.group_name}`);
      sbValues.push(0);
    }
    const li = sbIds.indexOf(lineKey);
    sbValues[li] = (sbValues[li] || 0) + r.revenue;

    // SKU level (limit top 200 by revenue to avoid too many points)
    if (sbIds.length < 500) {
      sbIds.push(`p_${r.product_code}`);
      sbLabels.push(r.product_name.slice(0, 30));
      sbParents.push(lineKey);
      sbValues.push(r.revenue);
    }
  });

  // Color heatmap pivot
  const allColors = [...new Set(colors.map(c => c.color))];
  const allLines = [...new Set(colors.map(c => c.line_name))];
  const heatZ = allColors.map(color =>
    allLines.map(line => {
      const cell = colors.find(c => c.color === color && c.line_name === line);
      return cell ? cell.total_qty : 0;
    })
  );

  // BCG scatter data
  const bcgScatter = bcg.map(b => ({
    x: b.total_rev / 1e6,
    y: b.yoy_pct ?? 0,
    z: Math.sqrt(b.total_qty) * 5,
    name: b.group_name,
    quadrant: b.quadrant,
    rev: b.total_rev,
    qty: b.total_qty,
  }));
  const medianRev = bcg.length > 0 ? bcg.map(b => b.total_rev / 1e6).sort((a, b) => a - b)[Math.floor(bcg.length / 2)] : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Phân tích sản phẩm</h1>
        <p className="text-sm text-muted-foreground">Drill-down 3 cấp · BCG Matrix · Heatmap màu sắc</p>
      </div>

      {/* Sunburst + BCG */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">Phân cấp doanh thu (Nhóm → Dòng → SKU)</CardTitle></CardHeader>
          <CardContent>
            {sbIds.length === 0 ? <Skeleton className="h-72" /> : (
              <Plot
                data={[{ type: "sunburst", ids: sbIds, labels: sbLabels, parents: sbParents, values: sbValues,
                  branchvalues: "total",
                  hovertemplate: "<b>%{label}</b><br>Doanh thu: %{value:,.0f}đ<extra></extra>",
                }]}
                layout={{ margin: { t: 0, b: 0, l: 0, r: 0 }, height: 290,
                  paper_bgcolor: "transparent", plot_bgcolor: "transparent",
                  font: { size: 10 } }}
                config={{ displayModeBar: false, responsive: true }}
                style={{ width: "100%" }}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">BCG Matrix — nhóm sản phẩm</CardTitle>
          </CardHeader>
          <CardContent>
            {bcgScatter.length === 0 ? <Skeleton className="h-72" /> : (
              <>
                <ResponsiveContainer width="100%" height={230}>
                  <ScatterChart margin={{ top: 10, right: 20, bottom: 20, left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="x" name="Doanh thu (tr.đ)" unit="tr" tick={{ fontSize: 9 }} label={{ value: "Doanh thu (triệu đ)", position: "insideBottom", offset: -10, fontSize: 9 }} />
                    <YAxis dataKey="y" name="Tăng trưởng YoY" unit="%" tick={{ fontSize: 9 }} label={{ value: "Tăng trưởng Q1 YoY %", angle: -90, position: "insideLeft", fontSize: 9 }} />
                    <ZAxis dataKey="z" range={[100, 2000]} />
                    <Tooltip cursor={{ strokeDasharray: "3 3" }}
                      content={({ active, payload }) => {
                        if (!active || !payload?.[0]) return null;
                        const d = payload[0].payload;
                        return (
                          <div className="rounded-lg bg-card border border-border p-2 text-xs shadow-lg">
                            <p className="font-medium">{d.name}</p>
                            <p>Doanh thu: {formatVND(d.rev)}</p>
                            <p>Tăng trưởng: {d.y?.toFixed(1)}%</p>
                            <Badge style={{ backgroundColor: BCG_COLORS[d.quadrant] }} className="mt-1 text-white text-[9px]">{d.quadrant}</Badge>
                          </div>
                        );
                      }}
                    />
                    <ReferenceLine x={medianRev} stroke="#6b7280" strokeDasharray="4 2" strokeWidth={1} />
                    <ReferenceLine y={10} stroke="#6b7280" strokeDasharray="4 2" strokeWidth={1} />
                    <Scatter data={bcgScatter}>
                      {bcgScatter.map((d, i) => <Cell key={i} fill={BCG_COLORS[d.quadrant] ?? "#6b7280"} />)}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
                <div className="grid grid-cols-2 gap-1 mt-1">
                  {Object.entries(BCG_QUADRANT_LABELS).map(([q, { label, desc }]) => (
                    <div key={q} className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: BCG_COLORS[q] }} />
                      <span><strong className="text-foreground">{label}</strong>: {desc}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Color heatmap + Top SKU */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-sm">Heatmap màu × dòng xe (sản lượng)</CardTitle></CardHeader>
          <CardContent>
            {heatZ.length === 0 ? <Skeleton className="h-72" /> : (
              <Plot
                data={[{
                  type: "heatmap",
                  x: allLines,
                  y: allColors,
                  z: heatZ,
                  colorscale: "Blues",
                  hovertemplate: "Màu: %{y}<br>Dòng: %{x}<br>SL: %{z}<extra></extra>",
                }]}
                layout={{
                  margin: { t: 10, b: 80, l: 80, r: 10 }, height: 280,
                  paper_bgcolor: "transparent", plot_bgcolor: "transparent",
                  font: { size: 9 },
                  xaxis: { tickangle: -40 },
                }}
                config={{ displayModeBar: false, responsive: true }}
                style={{ width: "100%" }}
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              Top / Bottom SKU
              <div className="ml-auto flex gap-1">
                {(["top", "bottom"] as const).map(o => (
                  <button key={o} onClick={() => loadSku(o)}
                    className={`text-[10px] px-2 py-0.5 rounded ${skuOrder === o ? "bg-primary text-primary-foreground" : "bg-accent text-muted-foreground"}`}>
                    {o === "top" ? "Top 20" : "Bottom 20"}
                  </button>
                ))}
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topSku.length === 0 ? <Skeleton className="h-64" /> : (
              <div className="overflow-auto max-h-64">
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-border">
                    <th className="text-left pb-1 text-muted-foreground font-medium">#</th>
                    <th className="text-left pb-1 text-muted-foreground font-medium">Sản phẩm</th>
                    <th className="text-right pb-1 text-muted-foreground font-medium">SL</th>
                    <th className="text-right pb-1 text-muted-foreground font-medium">DT</th>
                  </tr></thead>
                  <tbody>
                    {topSku.map((s, i) => (
                      <tr key={s.product_code} className="border-b border-border/50">
                        <td className="py-1 text-muted-foreground">{i + 1}</td>
                        <td className="py-1 max-w-[140px]">
                          <p className="truncate font-medium">{s.product_name}</p>
                          <p className="text-muted-foreground text-[9px]">{s.color} · {s.line_name}</p>
                        </td>
                        <td className="py-1 text-right">{formatNum(s.total_qty)}</td>
                        <td className="py-1 text-right">{formatVND(s.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Insights */}
      {bcg.length > 0 && topSku.length > 0 && (() => {
        const stars = bcg.filter(b => b.quadrant === "Stars");
        const dogs  = bcg.filter(b => b.quadrant === "Dogs");
        const top1  = topSku[0];
        return (
          <Card>
            <CardHeader><CardTitle className="text-sm">Key Insights — Sản phẩm</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-lg border border-border/60 p-3 space-y-2">
                <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-blue-500/20 text-blue-400">Phát hiện</span>
                <p className="text-xs leading-relaxed">
                  BCG Matrix xác định <b>{stars.length} nhóm Stars</b> ({stars.map(s => s.group_name).join(", ")}) và <b>{dogs.length} nhóm Dogs</b> ({dogs.map(d => d.group_name).join(", ")}). SKU bán chạy nhất: <b>{top1?.product_name}</b> ({formatNum(top1?.total_qty)} chiếc).
                </p>
                <div className="pl-2 border-l-2 border-amber-500/50 space-y-1">
                  <p className="text-[10px] font-medium text-amber-400">Ý nghĩa</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Nhóm Stars đang tăng trưởng mạnh và chiếm thị phần lớn — đây là động lực chính của doanh số. Nhóm Dogs cần đánh giá lại để tránh phân tán nguồn lực sản xuất.
                  </p>
                </div>
                <div className="pl-2 border-l-2 border-emerald-500/50 space-y-1">
                  <p className="text-[10px] font-medium text-emerald-400">Hành động</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Tăng cường đặt hàng các SKU Stars cho Q2/2026. Xem xét giảm SKU Dogs hoặc gộp danh mục để tối ưu chi phí quản lý tồn kho.
                  </p>
                </div>
              </div>
              <div className="rounded-lg border border-border/60 p-3 space-y-2">
                <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-blue-500/20 text-blue-400">Phát hiện</span>
                <p className="text-xs leading-relaxed">
                  Heatmap màu sắc cho thấy phân bổ nhu cầu không đều theo dòng xe — một số màu chiếm ưu thế tuyệt đối trong từng phân khúc.
                </p>
                <div className="pl-2 border-l-2 border-amber-500/50 space-y-1">
                  <p className="text-[10px] font-medium text-amber-400">Ý nghĩa</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Màu sắc là yếu tố quyết định lựa chọn của người tiêu dùng cuối — đại lý thường đặt theo xu hướng màu mùa hè/xuân.
                  </p>
                </div>
                <div className="pl-2 border-l-2 border-emerald-500/50 space-y-1">
                  <p className="text-[10px] font-medium text-emerald-400">Hành động</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Ưu tiên sản xuất các SKU màu bán chạy cho Q2/2026. Cảnh báo tồn kho cho các màu ít được đặt ở từng dòng xe.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })()}
    </div>
  );
}
