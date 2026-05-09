"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { formatVND, formatNum } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { CheckCircle2, XCircle, Clock, Mail } from "lucide-react";

interface Pipeline { stages: { status: string; count: number }[]; total: number; loaded: number; success_rate: number; }
interface Daily { order_date: string; order_count: number; revenue: number; }
interface ErrorRow { log_id: number; so_number: string; from_address: string; status: string; error_message: string; processed_at: string; }

const STATUS_COLORS: Record<string, string> = {
  LOADED:    "#10b981",
  SUCCESS:   "#10b981",
  VALIDATED: "#3b82f6",
  EXTRACTED: "#8b5cf6",
  PENDING:   "#f59e0b",
  FAILED:    "#ef4444",
  ERROR:     "#ef4444",
};

const FUNNEL_STAGES = ["EXTRACTED", "VALIDATED", "LOADED"];

export default function OperationsPage() {
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [daily, setDaily] = useState<Daily[]>([]);
  const [errors, setErrors] = useState<ErrorRow[]>([]);

  useEffect(() => {
    Promise.all([
      apiFetch<Pipeline>("/api/operations/pipeline"),
      apiFetch<Daily[]>("/api/operations/daily", []),
      apiFetch<ErrorRow[]>("/api/operations/errors", []),
    ]).then(([p, d, e]) => { setPipeline(p); setDaily(d); setErrors(e); });
  }, []);

  const loaded = pipeline?.stages.find(s => s.status === "LOADED")?.count ?? 0;
  const failed = pipeline?.stages.find(s => s.status === "FAILED")?.count ?? 0;
  const pieData = pipeline?.stages.map(s => ({
    name: s.status,
    value: s.count,
    fill: STATUS_COLORS[s.status] ?? "#6b7280",
  })) ?? [];

  const funnelData = FUNNEL_STAGES.map(s => ({
    stage: s,
    count: pipeline?.stages.find(x => x.status === s)?.count ?? 0,
    fill: STATUS_COLORS[s],
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Trạng thái vận hành</h1>
        <p className="text-sm text-muted-foreground">Pipeline T3/2026 · Email log · Xử lý tự động</p>
      </div>

      {/* KPI Cards */}
      {!pipeline ? (
        <div className="grid grid-cols-4 gap-4">{Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-5 flex items-center gap-3">
              <div className="rounded-lg bg-blue-500/10 p-2"><Mail className="h-5 w-5 text-blue-500" /></div>
              <div><p className="text-2xl font-bold">{pipeline.total}</p><p className="text-xs text-muted-foreground">Tổng email nhận</p></div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 flex items-center gap-3">
              <div className="rounded-lg bg-emerald-500/10 p-2"><CheckCircle2 className="h-5 w-5 text-emerald-500" /></div>
              <div><p className="text-2xl font-bold text-emerald-500">{loaded}</p><p className="text-xs text-muted-foreground">Nhập DB thành công</p></div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 flex items-center gap-3">
              <div className="rounded-lg bg-emerald-500/10 p-2"><CheckCircle2 className="h-5 w-5 text-emerald-500" /></div>
              <div><p className="text-2xl font-bold text-emerald-500">{pipeline.success_rate}%</p><p className="text-xs text-muted-foreground">Tỷ lệ thành công</p></div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 flex items-center gap-3">
              <div className="rounded-lg bg-red-500/10 p-2"><XCircle className="h-5 w-5 text-red-500" /></div>
              <div><p className="text-2xl font-bold text-red-500">{failed}</p><p className="text-xs text-muted-foreground">Thất bại / lỗi</p></div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Pipeline funnel + Pie + Daily bar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Funnel */}
        <Card>
          <CardHeader><CardTitle className="text-sm">Pipeline xử lý email</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {!pipeline ? <Skeleton className="h-52" /> : (
              <>
                {funnelData.map((f, i) => (
                  <div key={f.stage}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="font-medium">{f.stage}</span>
                      <span>{f.count} / {pipeline.total}</span>
                    </div>
                    <div className="bg-muted rounded-full h-6 overflow-hidden">
                      <div className="h-full rounded-full flex items-center justify-end pr-3"
                        style={{ width: `${pipeline.total > 0 ? (f.count / pipeline.total) * 100 : 0}%`, backgroundColor: f.fill }}>
                        <span className="text-[10px] text-white font-medium">{((f.count / pipeline.total) * 100).toFixed(1)}%</span>
                      </div>
                    </div>
                  </div>
                ))}
                {pipeline.stages.filter(s => !FUNNEL_STAGES.includes(s.status)).map(s => (
                  <div key={s.status} className="flex justify-between text-xs">
                    <span className="font-medium" style={{ color: STATUS_COLORS[s.status] }}>{s.status}</span>
                    <span>{s.count}</span>
                  </div>
                ))}
              </>
            )}
          </CardContent>
        </Card>

        {/* Status pie */}
        <Card>
          <CardHeader><CardTitle className="text-sm">Phân bổ trạng thái</CardTitle></CardHeader>
          <CardContent>
            {pieData.length === 0 ? <Skeleton className="h-52" /> : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="45%" outerRadius={75} paddingAngle={2}>
                    {pieData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                  </Pie>
                  <Tooltip formatter={(v, n) => [v, n]} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Daily bar */}
        <Card>
          <CardHeader><CardTitle className="text-sm">Đơn hàng theo ngày — T3/2026</CardTitle></CardHeader>
          <CardContent>
            {daily.length === 0 ? <Skeleton className="h-52" /> : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={daily} margin={{ top: 5, right: 5, left: 0, bottom: 25 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="order_date" tick={{ fontSize: 8 }} angle={-45} textAnchor="end"
                    tickFormatter={v => v.slice(5)} />
                  <YAxis tick={{ fontSize: 9 }} width={25} />
                  <Tooltip formatter={(v, n) => n === "order_count" ? [Number(v) + " đơn", "Số đơn"] : [formatVND(Number(v ?? 0)), "Doanh thu"]} />
                  <Bar dataKey="order_count" fill="#3b82f6" radius={[2,2,0,0]} name="order_count" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Error table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            Chi tiết lỗi xử lý
            <Badge variant="destructive" className="text-[10px]">{errors.length} bản ghi</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {errors.length === 0 ? (
            <div className="text-center py-8 text-sm text-emerald-500 flex items-center justify-center gap-2">
              <CheckCircle2 className="h-5 w-5" /> Không có lỗi — pipeline thành công 100%
            </div>
          ) : (
            <div className="overflow-auto max-h-56">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-border">
                  {["SO Number","Từ","Trạng thái","Lỗi","Xử lý lúc"].map(h => (
                    <th key={h} className="text-left pb-2 text-muted-foreground font-medium pr-3">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {errors.map(e => (
                    <tr key={e.log_id} className="border-b border-border/40">
                      <td className="py-1.5 pr-3 font-mono">{e.so_number ?? "—"}</td>
                      <td className="py-1.5 pr-3 max-w-[120px] truncate text-muted-foreground">{e.from_address}</td>
                      <td className="py-1.5 pr-3">
                        <Badge className="text-[9px]" style={{ backgroundColor: STATUS_COLORS[e.status] }}>{e.status}</Badge>
                      </td>
                      <td className="py-1.5 pr-3 max-w-[200px] truncate text-muted-foreground">{e.error_message}</td>
                      <td className="py-1.5 text-muted-foreground">{e.processed_at?.slice(0, 16)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Insights */}
      {pipeline && (() => {
        const successRate = pipeline.success_rate;
        const failCount = pipeline.stages.find(s => s.status === "FAILED")?.count ?? 0;
        return (
          <Card>
            <CardHeader><CardTitle className="text-sm">Key Insights — Vận hành</CardTitle></CardHeader>
            <CardContent className="rounded-lg border border-border/60 p-3 space-y-2">
              <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-blue-500/20 text-blue-400">Phát hiện</span>
              <p className="text-xs leading-relaxed">
                Pipeline T3/2026 xử lý <b>{pipeline.total} email</b>, nhập DB thành công <b>{pipeline.loaded} đơn hàng</b> (tỷ lệ {successRate}%).
                {failCount > 0
                  ? ` Có ${failCount} email thất bại cần xử lý thủ công.`
                  : " Không có lỗi nghiêm trọng — hệ thống hoạt động ổn định."}
              </p>
              <div className="pl-2 border-l-2 border-amber-500/50 space-y-1">
                <p className="text-[10px] font-medium text-amber-400">Ý nghĩa</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {successRate >= 98
                    ? "Tỷ lệ thành công trên 98% cho thấy pipeline đang ổn định và đáng tin cậy để xử lý dữ liệu tháng tiếp theo."
                    : "Tỷ lệ thất bại cần được điều tra — email bị lỗi có thể chứa đơn hàng thực tế chưa được ghi nhận vào doanh thu."}
                </p>
              </div>
              <div className="pl-2 border-l-2 border-emerald-500/50 space-y-1">
                <p className="text-[10px] font-medium text-emerald-400">Hành động</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {failCount > 0
                    ? `Xử lý thủ công ${failCount} email lỗi trong bảng bên dưới. Ưu tiên email có giá trị đơn hàng cao. Kiểm tra lại định dạng PDF đính kèm.`
                    : "Mở rộng pipeline sang tháng 4/2026. Lập kế hoạch backup định kỳ và monitor log hàng tuần để phát hiện lỗi sớm."}
                </p>
              </div>
            </CardContent>
          </Card>
        );
      })()}
    </div>
  );
}
