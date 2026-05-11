"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { formatVND, GROUP_COLORS, PALETTE } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, Cell, ReferenceLine,
} from "recharts";

interface Monthly { fiscal_year: number; fiscal_month: number; period: string; group_name: string; revenue: number; quantity: number; }
interface YoY { group_name: string; q1_2025: number; q1_2026: number; yoy_pct: number; }
interface Heatmap { fiscal_year: number; fiscal_month: number; revenue: number; }
interface Waterfall { label: string; revenue: number; mom_change: number; }

const MONTH_LABELS = ["","T1","T2","T3","T4","T5","T6","T7","T8","T9","T10","T11","T12"];

export default function TimePage() {
  const [monthly, setMonthly] = useState<Monthly[]>([]);
  const [yoy, setYoy] = useState<YoY[]>([]);
  const [heatmap, setHeatmap] = useState<Heatmap[]>([]);
  const [waterfall, setWaterfall] = useState<Waterfall[]>([]);

  useEffect(() => {
    Promise.all([
      apiFetch<Monthly[]>("/api/time/monthly", []),
      apiFetch<YoY[]>("/api/time/yoy_q1", []),
      apiFetch<Heatmap[]>("/api/time/heatmap", []),
      apiFetch<Waterfall[]>("/api/time/mom_waterfall", []),
    ]).then(([m, y, h, w]) => { setMonthly(m); setYoy(y); setHeatmap(h); setWaterfall(w); });
  }, []);

  // Pivot monthly data: [{period, "Xe phổ thông": 1000, ...}]
  const groups = [...new Set(monthly.map(r => r.group_name))];
  const periods = [...new Set(monthly.map(r => r.period))].sort();
  const areaData = periods.map(p => {
    const row: Record<string, unknown> = { period: p.slice(0, 7) };
    groups.forEach(g => {
      const found = monthly.find(r => r.period === p && r.group_name === g);
      row[g] = found?.revenue ?? 0;
    });
    return row;
  });

  // YoY bar — interleave 2025/2026
  const yoyData = yoy.map(r => ({
    name: r.group_name?.split(" ").slice(-1)[0] ?? r.group_name,
    "Q1/2025": Math.round((r.q1_2025 ?? 0) / 1e6),
    "Q1/2026": Math.round((r.q1_2026 ?? 0) / 1e6),
    yoy: r.yoy_pct,
  }));

  // Heatmap as colored cells (custom render in SVG)
  const heatYears = [...new Set(heatmap.map(r => r.fiscal_year))].sort();
  const maxRev = Math.max(...heatmap.map(r => r.revenue));

  // Seasonality index: average revenue per month / overall monthly average
  const seasonalityIndex = Array.from({ length: 12 }, (_, mi) => {
    const monthData = heatmap.filter(r => r.fiscal_month === mi + 1);
    const avg = monthData.length > 0 ? monthData.reduce((s, r) => s + r.revenue, 0) / monthData.length : 0;
    return { month: MONTH_LABELS[mi + 1], avg };
  });
  const overallAvg = seasonalityIndex.reduce((s, r) => s + r.avg, 0) / (seasonalityIndex.filter(r => r.avg > 0).length || 1);
  const seasonIdx = seasonalityIndex.map(r => ({
    month: r.month,
    index: r.avg > 0 ? Math.round((r.avg / overallAvg) * 100) : null,
  }));

  const totalYoy = yoy.reduce((acc, r) => acc + (r.q1_2026 ?? 0), 0);
  const totalYoy25 = yoy.reduce((acc, r) => acc + (r.q1_2025 ?? 0), 0);
  const overallGrowth = totalYoy25 > 0 ? ((totalYoy - totalYoy25) / totalYoy25 * 100).toFixed(1) : "—";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Phân tích thời gian</h1>
        <p className="text-sm text-muted-foreground">Xu hướng 01/2025 → 03/2026 · YoY Q1 · Mùa vụ</p>
      </div>

      {/* Stacked area chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            Doanh thu tháng theo nhóm sản phẩm
            <span className="text-[9px] font-normal text-amber-400 border border-amber-500/30 rounded px-1 py-0.5">⚠ 72 SKU chưa map nhóm</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {areaData.length === 0 ? <Skeleton className="h-64" /> : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={areaData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                <YAxis tickFormatter={v => `${(v / 1e9).toFixed(0)}tỷ`} tick={{ fontSize: 10 }} width={42} />
                <Tooltip formatter={(v, n) => [formatVND(Number(v ?? 0)), String(n)]} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                {groups.map((g, i) => (
                  <Area key={g} type="monotone" dataKey={g} stackId="1"
                    stroke={GROUP_COLORS[g] ?? PALETTE[i]} fill={GROUP_COLORS[g] ?? PALETTE[i]} fillOpacity={0.6} strokeWidth={1.5} />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* YoY + Heatmap */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              So sánh YoY Q1
              <Badge variant="secondary" className="text-[10px]">Tổng tăng {overallGrowth}%</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {yoyData.length === 0 ? <Skeleton className="h-52" /> : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={yoyData} margin={{ top: 5, right: 10, left: 0, bottom: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-20} textAnchor="end" />
                  <YAxis tickFormatter={v => `${v}tr`} tick={{ fontSize: 10 }} width={45} />
                  <Tooltip formatter={(v) => `${Number(v ?? 0).toLocaleString("vi-VN")} triệu đ`} />
                  <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="Q1/2025" fill="#6b7280" radius={[3,3,0,0]} />
                  <Bar dataKey="Q1/2026" fill="#3b82f6" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Heatmap — custom SVG grid */}
        <Card>
          <CardHeader><CardTitle className="text-sm">Heatmap doanh thu (Năm × Tháng)</CardTitle></CardHeader>
          <CardContent>
            {heatmap.length === 0 ? <Skeleton className="h-52" /> : (
              <div className="overflow-x-auto">
                <table className="text-[10px] border-collapse w-full">
                  <thead>
                    <tr>
                      <th className="pr-2 text-muted-foreground text-right">Năm</th>
                      {MONTH_LABELS.slice(1).map((m, i) => (
                        <th key={i} className="px-1 text-center text-muted-foreground font-normal">{m}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {heatYears.map(yr => (
                      <tr key={yr}>
                        <td className="pr-2 text-right text-muted-foreground font-medium">{yr}</td>
                        {Array.from({ length: 12 }, (_, mi) => {
                          const cell = heatmap.find(h => h.fiscal_year === yr && h.fiscal_month === mi + 1);
                          const intensity = cell ? cell.revenue / maxRev : 0;
                          return (
                            <td key={mi} title={cell ? formatVND(cell.revenue) : "—"}
                              className="px-0.5 py-0.5">
                              <div className="w-8 h-8 rounded flex items-center justify-center text-[9px]"
                                style={{ backgroundColor: cell ? `rgba(59,130,246,${0.15 + intensity * 0.85})` : "transparent", color: intensity > 0.5 ? "white" : "inherit" }}>
                                {cell ? `${(cell.revenue / 1e9).toFixed(0)}` : ""}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[9px] text-muted-foreground mt-2">Đơn vị: tỷ đồng · màu đậm = doanh thu cao</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Seasonality index */}
      {seasonIdx.some(r => r.index !== null) && (
        <Card>
          <CardHeader><CardTitle className="text-sm">Chỉ số mùa vụ theo tháng (Trung bình các năm = 100)</CardTitle></CardHeader>
          <CardContent>
            <div className="flex gap-1 items-end h-20 mb-2">
              {seasonIdx.map(({ month, index }) => (
                <div key={month} className="flex-1 flex flex-col items-center gap-0.5">
                  <div className="text-[8px] font-medium" style={{ color: index !== null && index > 110 ? "#10b981" : index !== null && index < 90 ? "#ef4444" : "#6b7280" }}>
                    {index ?? "—"}
                  </div>
                  <div className="w-full rounded-sm transition-all"
                    style={{
                      height: index ? `${Math.max(4, (index / 150) * 64)}px` : "4px",
                      backgroundColor: index !== null && index > 110 ? "#10b981" : index !== null && index < 90 ? "#ef4444" : "#6b7280",
                      opacity: index ? 0.8 : 0.2,
                    }}
                  />
                  <span className="text-[8px] text-muted-foreground">{month}</span>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">Index &gt; 100 = tháng cao hơn trung bình · &lt; 100 = thấp hơn · Dữ liệu từ {heatYears.length} năm quan sát</p>
          </CardContent>
        </Card>
      )}

      {/* MoM Waterfall */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Biến động doanh thu MoM (tỷ đồng)</CardTitle></CardHeader>
        <CardContent>
          {waterfall.length === 0 ? <Skeleton className="h-48" /> : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={waterfall.map(r => ({
                ...r,
                change: r.mom_change != null ? Math.round(r.mom_change / 1e6) : null,
              }))} margin={{ top: 5, right: 10, left: 0, bottom: 30 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis dataKey="label" tick={{ fontSize: 9 }} angle={-25} textAnchor="end" />
                <YAxis tickFormatter={v => `${v}tr`} tick={{ fontSize: 10 }} width={45} />
                <Tooltip formatter={(v) => { const n = Number(v ?? 0); return `${n > 0 ? "+" : ""}${n.toLocaleString("vi-VN")} triệu đ`; }} />
                <ReferenceLine y={0} stroke="currentColor" strokeOpacity={0.3} />
                <Bar dataKey="change" radius={[3,3,0,0]} name="Thay đổi MoM">
                  {waterfall.map((r, i) => (
                    <Cell key={i} fill={(r.mom_change ?? 0) >= 0 ? "#10b981" : "#ef4444"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Key Insights */}
      {yoy.length > 0 && (() => {
        const yoySorted = [...yoy].sort((a, b) => (b.yoy_pct ?? 0) - (a.yoy_pct ?? 0));
        const bestGroup = yoySorted[0];
        const worstGroup = yoySorted[yoySorted.length - 1];
        const topGroupByRev = [...yoy].sort((a, b) => (b.q1_2026 ?? 0) - (a.q1_2026 ?? 0))[0];
        const topGroupShare = totalYoy > 0 && topGroupByRev ? Math.round((topGroupByRev.q1_2026 ?? 0) / totalYoy * 100) : 0;
        const peakSeason = seasonIdx.reduce((a, b) => ((a.index ?? 0) >= (b.index ?? 0) ? a : b), { month: "—", index: 0 });
        const lowSeason = seasonIdx.filter(s => s.index != null).reduce((a, b) => ((a.index ?? 999) <= (b.index ?? 999) ? a : b), { month: "—", index: 999 });
        const biggestGain = waterfall.filter(w => (w.mom_change ?? 0) > 0).reduce((a, b) => ((a.mom_change ?? 0) > (b.mom_change ?? 0) ? a : b), { label: "—", mom_change: 0, revenue: 0 } as Waterfall);
        const biggestDrop = waterfall.filter(w => (w.mom_change ?? 0) < 0).reduce((a, b) => ((a.mom_change ?? 0) < (b.mom_change ?? 0) ? a : b), { label: "—", mom_change: 0, revenue: 0 } as Waterfall);
        const peakBias = (peakSeason.index ?? 0) - (lowSeason.index ?? 0);

        const insights = [
          {
            num: 1, title: "Tăng trưởng YoY Q1/2026",
            find: `Tổng doanh thu Q1/2026 tăng ${overallGrowth}% so với Q1/2025. Nhóm bứt phá nhất: ${bestGroup?.group_name} (+${bestGroup?.yoy_pct?.toFixed(1)}%). Nhóm chậm nhất: ${worstGroup?.group_name} (${(worstGroup?.yoy_pct ?? 0) >= 0 ? "+" : ""}${worstGroup?.yoy_pct?.toFixed(1)}%).`,
            meaning: "Mức tăng trưởng dương xác nhận đà phục hồi hậu Tết. Phân hóa giữa các nhóm phản ánh xu hướng tiêu dùng: đại lý đang chuyển dịch khẩu vị sang sản phẩm giá trị cao hơn.",
            action: `Tăng quota sản xuất nhóm ${bestGroup?.group_name} thêm 15-20% cho Q2/2026. Thiết kế chương trình kích cầu riêng (combo giảm giá + giao hàng ưu tiên) cho nhóm ${worstGroup?.group_name}.`,
          },
          {
            num: 2, title: "Đỉnh & đáy mùa vụ",
            find: `Chỉ số mùa vụ đạt đỉnh tháng ${peakSeason.month} (index ${peakSeason.index}) và thấp nhất tháng ${lowSeason.month} (index ${lowSeason.index}). Biên độ chênh lệch ${peakBias} điểm — nhu cầu co giãn mạnh theo mùa.`,
            meaning: "Biên độ mùa vụ lớn ảnh hưởng trực tiếp đến dòng tiền của đại lý: tháng thấp điểm khó thanh toán đúng hạn, tháng cao điểm có nguy cơ thiếu hàng và mất đơn.",
            action: `Tăng tồn kho 25-30% trước tháng ${peakSeason.month}. Triển khai chương trình đặt hàng sớm (early-order discount 3%) vào tháng ${lowSeason.month} để san phẳng nhu cầu và cải thiện dòng tiền nhà máy.`,
          },
          {
            num: 3, title: "Biến động MoM lớn nhất",
            find: biggestGain.label !== "—" && biggestDrop.label !== "—"
              ? `Tháng tăng đột biến nhất: ${biggestGain.label} (+${formatVND(biggestGain.mom_change ?? 0)} so với tháng trước). Tháng sụt giảm mạnh nhất: ${biggestDrop.label} (${formatVND(biggestDrop.mom_change ?? 0)}). Biên độ dao động phản ánh nhu cầu không ổn định.`
              : "Dữ liệu waterfall đang xử lý.",
            meaning: "Biến động MoM lớn gây khó dự báo ngắn hạn và buộc tăng chi phí tồn kho buffer. Tháng sụt giảm đột ngột cần điều tra nguyên nhân: thiếu hàng, mất đại lý chủ chốt, hay yếu tố thị trường.",
            action: "Thiết lập cảnh báo tự động khi doanh thu tháng giảm >15% so với tháng trước. Yêu cầu báo cáo nguyên nhân từ đội kinh doanh trong 5 ngày làm việc kể từ khi có dữ liệu tháng.",
          },
          {
            num: 4, title: "Tập trung doanh thu theo nhóm",
            find: topGroupByRev
              ? `Nhóm dẫn đầu "${topGroupByRev.group_name}" chiếm ${topGroupShare}% tổng DT Q1/2026. Với chỉ ${yoy.length} nhóm sản phẩm, cơ cấu tập trung cao tạo rủi ro: một sự cố chuỗi cung ứng ở nhóm chính ảnh hưởng toàn bộ doanh thu.`
              : "Đang tải dữ liệu.",
            meaning: "Danh mục phụ thuộc vào 1-2 nhóm lớn: khi nguồn nguyên liệu hoặc năng lực sản xuất nhóm đó bị giới hạn, đại lý sẽ chuyển sang nhà cung cấp thay thế và doanh nghiệp mất thị phần lâu dài.",
            action: "Đặt mục tiêu cân bằng danh mục: không nhóm nào chiếm quá 45% doanh thu. Phát triển kế hoạch đầu tư vào nhóm Question Marks để giảm thiểu rủi ro tập trung trong 12 tháng tới.",
          },
          {
            num: 5, title: "Tín hiệu xu hướng dài hạn",
            find: `Chuỗi dữ liệu liên tục từ ${heatYears[0]} đến ${heatYears[heatYears.length - 1]} (${periods.length} kỳ) cho thấy xu hướng tăng trưởng dài hạn rõ ràng. T3/2026 đã hoàn thành nhập liệu tự động qua pipeline email-PDF — cơ sở dữ liệu đủ sâu để xây dựng mô hình dự báo tin cậy.`,
            meaning: "Chuỗi 15+ tháng liên tục với đầy đủ dữ liệu là điều kiện tiên quyết để mô hình Prophet/SARIMA đạt độ chính xác cao. Xu hướng tăng dài hạn là luận điểm mạnh để thuyết phục đại lý tăng cam kết đặt hàng.",
            action: "Huấn luyện mô hình dự báo với toàn bộ lịch sử 2025-Q1/2026, mục tiêu MAPE <15%. Chia sẻ bản tóm tắt xu hướng tăng trưởng này với top 20 đại lý trong buổi họp Q2 để tăng niềm tin và size of order.",
          },
        ];

        return (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Key Insights — Phân tích thời gian
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
