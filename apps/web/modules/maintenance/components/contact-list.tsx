"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Search,
  MapPin,
  Phone,
  Star,
  Building2,
  X,
  Wrench,
} from "lucide-react";
import { Card } from "@smartboss/ui/components/card";
import {
  facetsOf,
  matchesFacet,
  UNSET,
  type Facet,
} from "@/modules/maintenance/lib/contacts";
import { formatBaht } from "@/modules/maintenance/lib/expense";

export interface ContactRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  specialty: string | null;
  companyName: string | null;
  zone: string | null;
  category: string | null;
  rating: number | null;
  /** แปลงเป็น number มาจากฝั่ง server แล้ว (Prisma Decimal ข้ามมา client ไม่ได้) */
  price: number | null;
  isActive: boolean;
}

function Stars({ n }: { n: number | null }) {
  if (!n) return null;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-0.5 text-[#EAB308]"
      title={`${n} ดาว`}
    >
      {Array.from({ length: Math.min(5, n) }).map((_, i) => (
        <Star key={i} className="h-3.5 w-3.5 fill-current" />
      ))}
    </span>
  );
}

function Chip({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count?: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors"
      style={
        active
          ? {
              backgroundColor: "#CCFBF1",
              borderColor: "#0D9488",
              color: "#0F766E",
              fontWeight: 700,
            }
          : {
              backgroundColor: "var(--bg)",
              borderColor: "var(--line)",
              color: "var(--ink-soft)",
            }
      }
    >
      {children}
      {count != null && (
        <span
          className="rounded-full px-1.5 text-[11px] tabular-nums"
          style={
            active
              ? { backgroundColor: "#0D948826", color: "#0F766E" }
              : { backgroundColor: "var(--bg-soft)" }
          }
        >
          {count}
        </span>
      )}
    </button>
  );
}

/** แถวตัวกรองหนึ่งแถว — ป้ายกำกับซ้าย ชิปเลื่อนแนวนอนทางขวา */
function FilterRow({
  label,
  facets,
  selected,
  onSelect,
  allLabel,
  allCount,
}: {
  label: string;
  facets: Facet[];
  selected: string | null;
  onSelect: (v: string | null) => void;
  allLabel: string;
  allCount: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-xs text-(--ink-soft)">{label}</span>
      <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-0.5">
        <Chip
          active={selected === null}
          count={allCount}
          onClick={() => onSelect(null)}
        >
          {allLabel}
        </Chip>
        {facets.map((f) => (
          <Chip
            key={f.value}
            active={selected === f.value}
            count={f.count}
            onClick={() => onSelect(selected === f.value ? null : f.value)}
          >
            {f.label}
          </Chip>
        ))}
      </div>
    </div>
  );
}

function ContactCard({ c }: { c: ContactRow }) {
  return (
    <Card className="flex flex-col p-0">
      {/*
        ส่วนบนเป็นลิงก์ไปหน้ารายละเอียด แยกออกจากปุ่มโทรด้านล่าง —
        แท็ก a ซ้อน a เป็น HTML ที่ไม่ถูกต้อง เบราว์เซอร์จะตัดแท็กให้เอง
        แล้วการ์ดจะกดไม่ติดบางจุดโดยไม่มีอะไรฟ้อง
      */}
      <Link
        href={`/maintenance/contractors/${c.id}`}
        className="flex flex-1 items-start gap-3 rounded-t-(--radius) p-4 transition-colors hover:bg-(--bg-soft)"
      >
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: c.isActive ? "#CCFBF1" : "var(--bg-soft)" }}
        >
          <Wrench
            className="h-5 w-5"
            style={{ color: c.isActive ? "#0F766E" : "var(--ink-soft)" }}
          />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 truncate text-[15px] font-bold text-(--ink)">
              {c.name}
            </p>
            <Stars n={c.rating} />
          </div>

          {c.companyName && (
            <p className="mt-0.5 inline-flex min-w-0 max-w-full items-center gap-1 text-xs text-(--ink-soft)">
              <Building2 className="h-3 w-3 shrink-0" />
              <span className="truncate">{c.companyName}</span>
            </p>
          )}
          {c.specialty && (
            <p className="mt-0.5 line-clamp-2 text-xs text-(--ink-soft)">
              {c.specialty}
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {c.zone && (
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
                style={{ backgroundColor: "#EFF6FF", color: "#1D4ED8" }}
              >
                <MapPin className="h-3 w-3" /> {c.zone}
              </span>
            )}
            {c.price != null && (
              <span
                className="rounded-full px-2 py-0.5 text-[11px] tabular-nums"
                style={{
                  backgroundColor: "var(--bg-soft)",
                  color: "var(--ink-soft)",
                }}
              >
                {formatBaht(c.price)}
              </span>
            )}
            {!c.isActive && (
              <span
                className="rounded-full px-2 py-0.5 text-[11px]"
                style={{ backgroundColor: "#FEF2F2", color: "#B91C1C" }}
              >
                ปิดใช้งาน
              </span>
            )}
          </div>
        </div>
      </Link>

      {/* กดเบอร์แล้วโทรได้เลยจากมือถือ — เป็นสิ่งที่คนเปิดหน้านี้มาทำจริง ๆ */}
      {c.phone && (
        <a
          href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}
          className="flex items-center justify-center gap-1.5 border-t border-(--line) py-2.5 text-sm font-medium transition-colors hover:bg-(--bg-soft)"
          style={{ color: "#0F766E" }}
        >
          <Phone className="h-3.5 w-3.5" /> {c.phone}
        </a>
      )}
    </Card>
  );
}

export function ContactList({ contacts }: { contacts: ContactRow[] }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const [zone, setZone] = useState<string | null>(null);

  const catFacets = useMemo(
    () => facetsOf(contacts, (c) => c.category),
    [contacts]
  );
  const zoneFacets = useMemo(() => facetsOf(contacts, (c) => c.zone), [contacts]);

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return contacts.filter((c) => {
      if (!matchesFacet(c.category, cat)) return false;
      if (!matchesFacet(c.zone, zone)) return false;
      if (!needle) return true;
      return [c.name, c.phone, c.specialty, c.companyName, c.email].some((f) =>
        (f ?? "").toLowerCase().includes(needle)
      );
    });
  }, [contacts, q, cat, zone]);

  /**
   * เลือกหมวดแล้วไม่ต้องขึ้นหัวกลุ่มอีก — หัวข้อที่คลุมทั้งรายการไม่ได้บอกอะไรเพิ่ม
   * ไม่ได้เลือก = จัดกลุ่มตามหมวด โดยเรียงหมวดที่มีคนเยอะขึ้นก่อน (ลำดับเดียว
   * กับชิปบนแถบกรอง เพื่อให้ตากวาดหาหมวดเดิมเจอที่เดิม)
   */
  const groups = useMemo(() => {
    if (cat !== null) return [{ key: cat, label: "", rows: visible }];
    const byKey = new Map<string, ContactRow[]>(
      catFacets.map((f) => [f.value, [] as ContactRow[]])
    );
    for (const c of visible) {
      const key = (c.category ?? "").trim() || UNSET;
      const list = byKey.get(key);
      if (list) list.push(c);
      else byKey.set(key, [c]);
    }
    return Array.from(byKey, ([key, rows]) => ({
      key,
      label: key === UNSET ? "ยังไม่ระบุหมวดหมู่" : key,
      rows,
    })).filter((g) => g.rows.length > 0);
  }, [visible, cat, catFacets]);

  const filtered = q.trim() !== "" || cat !== null || zone !== null;

  return (
    <div className="flex flex-col gap-4">
      {/* ─── ค้นหา ─── */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--ink-soft)" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          type="search"
          placeholder="ค้นหาชื่อ เบอร์โทร บริษัท หรือคุณสมบัติ"
          aria-label="ค้นหา Contact"
          className="h-11 w-full rounded-(--radius) border border-(--line) bg-(--bg) pl-9 pr-3 text-sm text-(--ink) focus-visible:border-(--brand-green) focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-(--brand-green)/30"
        />
      </div>

      {/* ─── ตัวกรอง: แสดงเฉพาะแถวที่มีตัวเลือกให้เลือกจริงมากกว่าหนึ่ง ─── */}
      {(catFacets.length > 1 || zoneFacets.length > 1) && (
        <div className="flex flex-col gap-2 rounded-(--radius) border border-(--line) bg-(--bg-soft) p-3">
          {catFacets.length > 1 && (
            <FilterRow
              label="หมวดหมู่"
              facets={catFacets}
              selected={cat}
              onSelect={setCat}
              allLabel="ทุกหมวด"
              allCount={contacts.length}
            />
          )}
          {zoneFacets.length > 1 && (
            <FilterRow
              label="โซน"
              facets={zoneFacets}
              selected={zone}
              onSelect={setZone}
              allLabel="ทุกโซน"
              allCount={contacts.length}
            />
          )}
        </div>
      )}

      {filtered && (
        <div className="flex items-center gap-3 text-sm text-(--ink-soft)">
          <span>
            พบ <b className="tabular-nums text-(--ink)">{visible.length}</b> รายการ
          </span>
          <button
            type="button"
            onClick={() => {
              setQ("");
              setCat(null);
              setZone(null);
            }}
            className="inline-flex items-center gap-1 hover:text-(--ink)"
          >
            <X className="h-3.5 w-3.5" /> ล้างตัวกรอง
          </button>
        </div>
      )}

      {visible.length === 0 ? (
        <Card className="p-10 text-center text-sm text-(--ink-soft)">
          ไม่พบ Contact ที่ตรงกับที่ค้นหา
        </Card>
      ) : (
        groups.map((g) => (
          <section key={g.key} className="flex flex-col gap-2">
            {g.label && (
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-(--ink)">{g.label}</h2>
                <span className="text-xs tabular-nums text-(--ink-soft)">
                  {g.rows.length}
                </span>
                <span className="h-px flex-1 bg-(--line)" />
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {g.rows.map((c) => (
                <ContactCard key={c.id} c={c} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
