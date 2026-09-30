"use client";

import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtMoney, fmtNum } from "../lib/format";
import type { DailyPoint } from "../data/report";

/**
 * กราฟรายวัน — ค่าใช้จ่ายกับ conversions คนละหน่วยกันมาก จึงแยกเป็นสองกราฟ
 * (ไม่ใช้แกน y สองแกนในกราฟเดียว) แต่ละกราฟมีชุดข้อมูลเดียว ชื่อกราฟบอกแทน legend
 */
const COLOR = "#1A73E8";
const shortDate = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;

function ChartBox({ title, children }: { title: string; children: React.ReactElement }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1 text-xs font-medium text-(--ink-soft)">{title}</div>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

const axis = { fontSize: 11, fill: "var(--ink-soft)" };

export function DailyCharts({ data, currency }: { data: DailyPoint[]; currency: string | null }) {
  return (
    <div className="flex flex-col gap-4 md:flex-row">
      <ChartBox title="ค่าใช้จ่ายรายวัน">
        <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey="date" tickFormatter={shortDate} tick={axis} tickLine={false} axisLine={false} minTickGap={16} />
          <YAxis tick={axis} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => fmtNum(v)} />
          <Tooltip
            cursor={{ fill: "var(--bg-soft)" }}
            labelFormatter={(d) => String(d)}
            formatter={(v) => [fmtMoney(Number(v), currency), "ค่าใช้จ่าย"]}
          />
          <Bar dataKey="cost" fill={COLOR} radius={[4, 4, 0, 0]} maxBarSize={24} />
        </BarChart>
      </ChartBox>
      <ChartBox title="Conversions รายวัน">
        <LineChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--line)" />
          <XAxis dataKey="date" tickFormatter={shortDate} tick={axis} tickLine={false} axisLine={false} minTickGap={16} />
          <YAxis tick={axis} tickLine={false} axisLine={false} width={40} />
          <Tooltip labelFormatter={(d) => String(d)} formatter={(v) => [fmtNum(Number(v), 2), "Conversions"]} />
          <Line dataKey="conversions" stroke={COLOR} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        </LineChart>
      </ChartBox>
    </div>
  );
}
