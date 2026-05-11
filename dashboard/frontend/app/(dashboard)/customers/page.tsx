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
interface Basket { group_a: string; group_b: string; co_count: number; }

const SEGMENT_ORDER = ["Champions", "Loyal", "Promising", "At Risk", "Lost"];

export default function CustomersPage() {
  const [rfm, setRfm] = useState<RFM[]>([]);
  const [churn, setChurn] = useState<Churn[]>([]);
  const [top, setTop] = useState<TopDealer[]>([]);
  const [pareto, setPareto] = useState<Pareto[]>([]);
  const [basket, setBasket] = useState<Basket[]>([]);

  useEffect(() => {
    Promise.all([
      apiFetch<RFM[]>("/api/customers/rfm", []),
      apiFetch<Churn[]>("/api/customers/churn", []),
      apiFetch<TopDealer[]>("/api/customers/top?limit=10", []),
      apiFetch<Pareto[]>("/api/customers/pareto", []),
      apiFetch<Basket[]>("/api/customers/basket", []),
    ]).then(([r, c, t, p, b]) => { setRfm(r); setChurn(c); setTop(t); setPareto(p); setBasket(b); });
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
                  <Scatter data={rfm}>
                    {rfm.map((d, i) => (
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

      {/* Basket analysis */}
      {basket.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Phân tích giỏ hàng — Nhóm xe thường đặt cùng nhau</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left pb-1 text-muted-foreground font-medium">Nhóm A</th>
                  <th className="text-left pb-1 text-muted-foreground font-medium">Nhóm B</th>
                  <th className="text-right pb-1 text-muted-foreground font-medium">Số đơn chứa cả 2</th>
                  <th className="text-right pb-1 text-muted-foreground font-medium">Mức độ</th>
                </tr>
              </thead>
              <tbody>
                {basket.map((b, i) => {
                  const maxCount = basket[0]?.co_count ?? 1;
                  const level = b.co_count / maxCount;
                  return (
                    <tr key={i} className="border-b border-border/40">
                      <td className="py-1.5 font-medium">{b.group_a}</td>
                      <td className="py-1.5 font-medium">{b.group_b}</td>
                      <td className="py-1.5 text-right">{formatNum(b.co_count)} đơn</td>
                      <td className="py-1.5 text-right">
                        <Badge className={`text-[9px] border-0 ${level > 0.6 ? "bg-emerald-500/20 text-emerald-400" : level > 0.3 ? "bg-amber-500/20 text-amber-400" : "bg-muted text-muted-foreground"}`}>
                          {level > 0.6 ? "Cao" : level > 0.3 ? "Trung bình" : "Thấp"}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {basket.length > 0 && (
              <p className="text-[10px] text-muted-foreground mt-3">
                Cặp phổ biến nhất: <strong>{basket[0]?.group_a}</strong> + <strong>{basket[0]?.group_b}</strong> ({formatNum(basket[0]?.co_count)} đơn hàng)
                → Cơ hội bundle: ưu đãi khi đặt kết hợp 2 nhóm trong cùng đơn.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Key Insights */}
      {rfm.length > 0 && (() => {
        const champions   = rfm.filter(r => r.segment === "Champions");
        const loyal       = rfm.filter(r => r.segment === "Loyal");
        const atRisk      = rfm.filter(r => r.segment === "At Risk");
        const lost        = rfm.filter(r => r.segment === "Lost");
        const churnRev    = churn.reduce((a, c) => a + (c.total_revenue ?? 0), 0);
        const churnAvg    = churn.length > 0 ? churnRev / churn.length : 0;
        const topChurn    = [...churn].sort((a, b) => b.total_revenue - a.total_revenue).slice(0, 10);
        const topChurnRev = topChurn.reduce((a, c) => a + (c.total_revenue ?? 0), 0);
        const topPair     = basket[0];
        const atRiskPct   = rfm.length > 0 ? Math.round(atRisk.length / rfm.length * 100) : 0;
        const champPct    = rfm.length > 0 ? Math.round(champions.length / rfm.length * 100) : 0;

        const insights = [
          {
            num: 1, title: "Champions & Loyal — Lõi doanh thu",
            find: `${champions.length} đại lý Champions (${champPct}% tổng) là khách hàng trung thành nhất: mua gần đây, thường xuyên và giá trị cao. Cộng thêm ${loyal.length} đại lý Loyal, nhóm lõi này chiếm ~${Math.round((champions.length + loyal.length) / rfm.length * 100)}% tổng đại lý.`,
            meaning: "Champions và Loyal tạo ra phần lớn doanh thu ổn định. Mất một đại lý Champion tương đương mất nhiều đại lý nhỏ — chi phí thay thế rất cao (6-12 tháng để đại lý mới đạt mức mua tương đương).",
            action: `Xây dựng chương trình VIP cho ${champions.length + loyal.length} đại lý Champions + Loyal: ưu tiên giao hàng, chiết khấu đặc biệt 5-8%, account manager riêng. Mục tiêu: giữ tỷ lệ churn Champions < 5%/năm.`,
          },
          {
            num: 2, title: "Churn Risk — Giá trị doanh thu bị đe dọa",
            find: `${churn.length} đại lý không đặt hàng hơn 45 ngày, tổng giá trị lịch sử ${formatVND(churnRev)}. Trung bình mỗi đại lý này mang ${formatVND(churnAvg)}/kỳ. Top 10 đại lý churn có giá trị lịch sử cao nhất: ${formatVND(topChurnRev)}.`,
            meaning: "Mỗi đại lý churn là khoản doanh thu tiềm năng bị mất vĩnh viễn nếu không có biện pháp kịp thời. Chi phí tái kích hoạt đại lý cũ thấp hơn 5-7x so với tìm đại lý mới.",
            action: `Ngay lập tức: gọi điện cá nhân cho top ${topChurn.length} đại lý churn có doanh thu lịch sử cao nhất (tổng ${formatVND(topChurnRev)}). Ưu đãi tái kích hoạt: giảm giá 5% đơn đầu tiên + miễn phí vận chuyển. Deadline: trong 2 tuần.`,
          },
          {
            num: 3, title: "Pareto 80/20 — Tập trung đại lý then chốt",
            find: pareto80
              ? `Top ${pareto80.dealer_pct?.toFixed(0)}% đại lý (theo doanh thu) tạo ra ${pareto80.cumulative_pct?.toFixed(0)}% tổng doanh thu — quy luật Pareto được xác nhận. Với ${pareto.length} đại lý tổng, chỉ ~${Math.round((pareto80.dealer_pct ?? 0) / 100 * pareto.length)} đại lý tạo ra phần lớn giá trị kinh doanh.`
              : "Đang tải dữ liệu Pareto.",
            meaning: "Phân bổ không đều này đồng nghĩa nguồn lực chăm sóc đại lý cần tập trung vào nhóm nhỏ có giá trị cao. Phân tán đều nguồn lực sang 702 đại lý sẽ làm loãng tác động và giảm ROI của đội sales.",
            action: `Phân loại đội sales theo Pareto: 70% thời gian cho top ${pareto80 ? pareto80.dealer_pct?.toFixed(0) : 20}% đại lý trọng điểm, 30% còn lại cho 80% đại lý nhỏ. Sử dụng kênh digital/call center cho nhóm đại lý nhỏ để tối ưu chi phí.`,
          },
          {
            num: 4, title: "Basket Analysis — Cơ hội Bundle",
            find: topPair
              ? `Cặp nhóm xe cùng đặt trong một đơn hàng phổ biến nhất: "${topPair.group_a}" + "${topPair.group_b}" (${formatNum(topPair.co_count)} đơn hàng có cả 2 nhóm). ${basket.length} cặp co-occurrence được phát hiện — bằng chứng rõ ràng về hành vi mua kết hợp của đại lý.`
              : "Dữ liệu basket analysis đang tải.",
            meaning: "Đại lý đặt hàng kết hợp nhiều nhóm xe thường là đại lý đa năng, phục vụ nhiều phân khúc người tiêu dùng — đây là nhóm có giá trị cao và ít biến động hơn đại lý chuyên một dòng.",
            action: topPair
              ? `Thiết kế gói bundle "${topPair.group_a} + ${topPair.group_b}": giảm giá 3-5% khi đặt cùng 1 đơn hàng. Test với 30 đại lý trong 1 tháng, đo tác động lên average order value. Mở rộng nếu AOV tăng >10%.`
              : "Chờ dữ liệu basket analysis.",
          },
          {
            num: 5, title: "At Risk & Lost — Chiến lược phục hồi",
            find: `${atRisk.length} đại lý "At Risk" (${atRiskPct}% tổng) đang có dấu hiệu giảm tần suất hoặc giá trị mua. Thêm ${lost.length} đại lý đã vào nhóm "Lost". Tổng cộng ${atRisk.length + lost.length} đại lý cần can thiệp — nguy cơ mất thêm doanh thu nếu không hành động.`,
            meaning: "At Risk là cảnh báo sớm 60-90 ngày trước khi đại lý ngừng hẳn. Đây là thời điểm vàng để can thiệp với chi phí thấp nhất. Khi đã vào Lost, tỷ lệ phục hồi chỉ còn 10-20%.",
            action: `Phân công đội CS gọi điện khảo sát ${atRisk.length} đại lý At Risk trong tuần tới: nguyên nhân giảm đặt hàng (giá cả, cạnh tranh, nhu cầu thị trường). Tặng voucher giảm giá 5% có thời hạn 30 ngày để tạo cảm giác cấp bách khi quay lại.`,
          },
        ];

        return (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Key Insights — Phân tích đại lý
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
