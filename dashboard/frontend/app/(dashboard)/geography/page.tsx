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
interface ProvinceGrowth { province_name: string; region: string; rev_q1_2025: number; rev_q1_2026: number; yoy_pct: number; }

const REGION_COLORS: Record<string, string> = {
  "Miền Bắc": "#3b82f6",
  "Miền Trung": "#f97316",
  "Miền Nam": "#10b981",
  "Không xác định": "#6b7280",
};

export default function GeographyPage() {
  const [provinces, setProvinces] = useState<Province[]>([]);
  const [regions, setRegions] = useState<Region[]>([]);
  const [growth, setGrowth] = useState<ProvinceGrowth[]>([]);

  useEffect(() => {
    Promise.all([
      apiFetch<Province[]>("/api/geography/provinces", []),
      apiFetch<Region[]>("/api/geography/regions", []),
      apiFetch<ProvinceGrowth[]>("/api/geography/province_growth", []),
    ]).then(([p, r, g]) => { setProvinces(p); setRegions(r); setGrowth(g); });
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

      {/* YoY growth card */}
      {growth.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Tăng trưởng địa lý — YoY Q1/2025 → Q1/2026</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div>
                <p className="text-xs font-medium text-emerald-400 mb-2">Top 5 tỉnh tăng trưởng nhanh nhất</p>
                <div className="space-y-1.5">
                  {growth.filter(g => g.yoy_pct != null && g.yoy_pct > 0).slice(0, 5).map(g => (
                    <div key={g.province_name} className="flex items-center justify-between text-xs">
                      <div>
                        <span className="font-medium">{g.province_name}</span>
                        <span className="text-[9px] text-muted-foreground ml-1" style={{ color: REGION_COLORS[g.region] }}>{g.region}</span>
                      </div>
                      <Badge className="text-[10px] bg-emerald-500/20 text-emerald-400 border-0">
                        ↑ +{g.yoy_pct?.toFixed(1)}%
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-red-400 mb-2">Top 5 tỉnh sụt giảm mạnh nhất</p>
                <div className="space-y-1.5">
                  {[...growth].filter(g => g.yoy_pct != null && g.yoy_pct < 0).sort((a, b) => a.yoy_pct - b.yoy_pct).slice(0, 5).map(g => (
                    <div key={g.province_name} className="flex items-center justify-between text-xs">
                      <div>
                        <span className="font-medium">{g.province_name}</span>
                        <span className="text-[9px] text-muted-foreground ml-1" style={{ color: REGION_COLORS[g.region] }}>{g.region}</span>
                      </div>
                      <Badge className="text-[10px] bg-red-500/20 text-red-400 border-0">
                        ↓ {g.yoy_pct?.toFixed(1)}%
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Top/Bottom provinces table */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {[
          { title: "Top 10 tỉnh/thành doanh thu cao", data: top10 },
          { title: "Bottom 10 tỉnh/thành doanh thu thấp", data: bottom10 },
        ].map(({ title, data }) => {
          const growthMap = Object.fromEntries(growth.map(g => [g.province_name, g.yoy_pct]));
          return (
            <Card key={title}>
              <CardHeader><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
              <CardContent>
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-border">
                    <th className="text-left pb-1 text-muted-foreground font-medium">Tỉnh/TP</th>
                    <th className="text-right pb-1 text-muted-foreground font-medium">Doanh thu</th>
                    <th className="text-right pb-1 text-muted-foreground font-medium">YoY Q1</th>
                    <th className="text-right pb-1 text-muted-foreground font-medium">ĐL</th>
                  </tr></thead>
                  <tbody>
                    {data.map((p) => {
                      const yoy = growthMap[p.province_name];
                      return (
                        <tr key={p.province_name} className="border-b border-border/40">
                          <td className="py-1.5">
                            <p className="font-medium">{p.province_name}</p>
                            <p className="text-[9px]" style={{ color: REGION_COLORS[p.region] }}>{p.region}</p>
                          </td>
                          <td className="py-1.5 text-right">{formatVND(p.revenue)}</td>
                          <td className="py-1.5 text-right" style={{ color: yoy == null ? undefined : yoy >= 0 ? "#10b981" : "#ef4444" }}>
                            {yoy != null ? `${yoy >= 0 ? "+" : ""}${yoy.toFixed(1)}%` : "—"}
                          </td>
                          <td className="py-1.5 text-right">{p.dealer_count}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Key Insights */}
      {regions.length > 0 && provinces.length > 0 && (() => {
        const regionsSorted   = [...regions].filter(r => r.region !== "Không xác định").sort((a, b) => b.revenue - a.revenue);
        const topRegion       = regionsSorted[0];
        const botRegion       = regionsSorted[regionsSorted.length - 1];
        const topProv         = [...provinces].sort((a, b) => b.revenue - a.revenue)[0];
        const totalRev        = regions.reduce((s, r) => s + r.revenue, 0);
        const growthPos       = growth.filter(g => g.yoy_pct != null && g.yoy_pct > 0).sort((a, b) => (b.yoy_pct ?? 0) - (a.yoy_pct ?? 0));
        const growthNeg       = growth.filter(g => g.yoy_pct != null && g.yoy_pct < 0).sort((a, b) => (a.yoy_pct ?? 0) - (b.yoy_pct ?? 0));
        const regEfficiency   = regionsSorted.map(r => ({ region: r.region, avgPerDealer: r.dealer_count > 0 ? r.revenue / r.dealer_count : 0 }));
        const highEff         = [...regEfficiency].sort((a, b) => b.avgPerDealer - a.avgPerDealer)[0];
        const lowEff          = [...regEfficiency].sort((a, b) => a.avgPerDealer - b.avgPerDealer)[0];
        const topProvByDealer = [...provinces].filter(p => p.dealer_count >= 3).sort((a, b) => b.avg_revenue_per_dealer - a.avg_revenue_per_dealer)[0];

        const insights = [
          {
            num: 1, title: "Phân bổ doanh thu 3 vùng miền",
            find: `${topRegion?.region} dẫn đầu với ${formatVND(topRegion?.revenue)} (${topRegion?.pct?.toFixed(1)}% tổng doanh thu, ${topRegion?.dealer_count} đại lý). ${botRegion?.region} đóng góp thấp nhất (${botRegion?.pct?.toFixed(1)}%, ${botRegion?.dealer_count} đại lý). Tỉnh/TP mạnh nhất: ${topProv?.province_name} (${formatVND(topProv?.revenue)}).`,
            meaning: "Sự mất cân bằng vùng miền phản ánh mật độ mạng lưới đại lý và sức mua địa phương. Tập trung quá cao vào một vùng tạo rủi ro: thay đổi chính sách địa phương, thiên tai, hay cạnh tranh vùng có thể ảnh hưởng cả doanh nghiệp.",
            action: `Bảo vệ thị phần ${topRegion?.region} bằng chương trình loyalty đặc biệt. Đồng thời xây dựng kế hoạch 18 tháng để tăng số đại lý tại ${botRegion?.region} thêm 20% — đây là thị trường dư địa lớn nhất.`,
          },
          {
            num: 2, title: "Tỉnh tăng trưởng nhanh — Cơ hội mở rộng",
            find: growthPos.length > 0
              ? `Top 3 tỉnh tăng trưởng nhanh nhất (YoY Q1/2025→Q1/2026): ${growthPos.slice(0, 3).map(g => `${g.province_name} (+${g.yoy_pct?.toFixed(0)}%)`).join(", ")}. Tổng ${growthPos.length} tỉnh/TP ghi nhận tăng trưởng dương — tín hiệu thị trường mở rộng cục bộ rõ ràng.`
              : "Dữ liệu tăng trưởng đang xử lý.",
            meaning: "Tỉnh tăng trưởng cao thường phản ánh: (1) thị trường địa phương phát triển, (2) đại lý mới gia nhập hoặc đại lý cũ tăng tốc, (3) địa phương chưa bão hòa. Đây là 'cửa sổ cơ hội' 12-18 tháng trước khi cạnh tranh xuất hiện.",
            action: growthPos.length > 0
              ? `Cử đội phát triển thị trường khảo sát ${growthPos[0]?.province_name} và ${growthPos[1]?.province_name} trong Q2/2026. Mục tiêu: thêm 2-3 đại lý mới tại mỗi tỉnh, ưu tiên vị trí trung tâm thành phố.`
              : "Chờ dữ liệu growth.",
          },
          {
            num: 3, title: "Tỉnh sụt giảm — Cảnh báo đỏ",
            find: growthNeg.length > 0
              ? `${growthNeg.length} tỉnh/TP ghi nhận doanh thu sụt giảm YoY Q1. Nghiêm trọng nhất: ${growthNeg.slice(0, 3).map(g => `${g.province_name} (${g.yoy_pct?.toFixed(0)}%)`).join(", ")}. Cần điều tra nguyên nhân: mất đại lý, cạnh tranh mới, hay nhu cầu địa phương thay đổi.`
              : "Không có tỉnh nào sụt giảm đáng kể — tín hiệu tích cực.",
            meaning: "Sụt giảm YoY hai quý liên tiếp tại một tỉnh thường báo hiệu mất đại lý chủ lực hoặc đối thủ mới xuất hiện. Nếu không can thiệp, tỉnh sụt giảm có thể kéo theo chuyển đổi toàn bộ mạng lưới vùng.",
            action: growthNeg.length > 0
              ? `Yêu cầu báo cáo chi tiết từ đội sales về ${growthNeg[0]?.province_name} trong 1 tuần. Kiểm tra: số đại lý còn hoạt động, có đối thủ mới không, đại lý lớn nhất còn đặt hàng không. Quyết định giữ/rút trong vòng 30 ngày.`
              : "Tiếp tục monitoring.",
          },
          {
            num: 4, title: "Hiệu quả mạng lưới — Doanh thu trên đại lý",
            find: highEff && lowEff
              ? `${highEff.region} có doanh thu trung bình/đại lý cao nhất (${formatVND(highEff.avgPerDealer)}/ĐL). ${lowEff.region} thấp nhất (${formatVND(lowEff.avgPerDealer)}/ĐL) — chênh lệch ${(highEff.avgPerDealer / (lowEff.avgPerDealer || 1)).toFixed(1)}x. Tỉnh hiệu quả nhất (≥3 ĐL): ${topProvByDealer?.province_name} (${formatVND(topProvByDealer?.avg_revenue_per_dealer ?? 0)}/ĐL).`
              : "Đang tính toán hiệu quả mạng lưới.",
            meaning: "Doanh thu trung bình/đại lý là chỉ số chất lượng mạng lưới, không chỉ số lượng. Vùng có nhiều đại lý nhỏ với doanh thu thấp thực ra kém hiệu quả hơn vùng có ít đại lý lớn. Tối ưu số lượng đại lý quan trọng hơn tăng số lượng.",
            action: `Với ${lowEff?.region}: không nên thêm đại lý mới trước khi nâng doanh thu trung bình hiện tại lên 20%. Tổ chức training và co-marketing với top 10 đại lý để cải thiện năng suất. Đặt KPI doanh thu/ĐL tối thiểu cho Q3/2026.`,
          },
          {
            num: 5, title: "Vùng trắng — Dư địa thị trường chưa khai thác",
            find: (() => {
              const coveredProvinces = new Set(provinces.map(p => p.province_name));
              const totalProvinces   = 75;
              const covered          = coveredProvinces.size;
              const uncovered        = totalProvinces - covered;
              return `Dữ liệu ghi nhận doanh thu tại ${covered}/75 tỉnh/TP (${Math.round(covered/totalProvinces*100)}% độ phủ). ${uncovered} tỉnh/TP chưa có đại lý hoặc chưa phát sinh đơn hàng — đặc biệt tại ${botRegion?.region} (${botRegion?.dealer_count} đại lý/75 tỉnh toàn quốc).`;
            })(),
            meaning: "Vùng trắng (không có đại lý) là cơ hội thị trường rõ ràng nhưng cũng là chi phí: cần đầu tư phát triển đại lý mới, đào tạo, và marketing địa phương 6-12 tháng trước khi có doanh thu ổn định.",
            action: "Xác định top 5 tỉnh chưa có đại lý nhưng có tiềm năng (dân số > 1 triệu, GDP/người trung bình). Lập kế hoạch tuyển 1 đại lý thí điểm tại mỗi tỉnh trong Q3/2026 với chính sách hỗ trợ 6 tháng đầu (chiết khấu 10%, hỗ trợ trưng bày).",
          },
        ];

        return (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Key Insights — Địa lý
                <Badge variant="secondary" className="ml-2 text-[10px]">{insights.length} phát hiện</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {insights.map((ins) => (
                <div key={ins.num} className="rounded-lg border border-border/60 p-3 space-y-1.5">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-blue-500/20 text-blue-400">#{ins.num}</span>
                    <span className="text-xs font-semibold">{ins.title}</span>
                  </div>
                  <p className="text-xs leading-relaxed">{ins.find}</p>
                  <div className="pl-2 border-l-2 border-amber-500/50">
                    <p className="text-[10px] font-medium text-amber-400">Ý nghĩa</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{ins.meaning}</p>
                  </div>
                  <div className="pl-2 border-l-2 border-emerald-500/50">
                    <p className="text-[10px] font-medium text-emerald-400">Hành động</p>
                    <p className="text-xs text-muted-foreground leading-relaxed">{ins.action}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })()}
    </div>
  );
}
