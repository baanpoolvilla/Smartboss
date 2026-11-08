import { describe, expect, it } from "vitest";

import { applyDelta, deepEqual, diffSlice } from "./store-delta";

type Post = { id: string; text: string; replies: { id: string; t: string }[]; extra?: number };
type Feed = { posts: Post[]; topics: { id: string; name: string }[]; albums: unknown[]; note?: string };

function rnd(seed: number) {
  let x = seed;
  return () => ((x = (x * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

function mutate(f: Feed, r: () => number): Feed {
  const posts = [...f.posts];
  const ops = 1 + Math.floor(r() * 4);
  for (let i = 0; i < ops; i++) {
    const k = r();
    if (k < 0.3) posts.unshift({ id: `p${Math.floor(r() * 1e9)}`, text: "ใหม่", replies: [] });
    else if (k < 0.5 && posts.length) posts.splice(Math.floor(r() * posts.length), 1);
    else if (k < 0.8 && posts.length) {
      const j = Math.floor(r() * posts.length);
      const p = posts[j]!;
      posts[j] = { ...p, replies: [...p.replies, { id: `r${i}${Math.floor(r() * 1e6)}`, t: "ตอบ" }] };
    } else if (posts.length > 1) posts.reverse();
  }
  const out: Feed = { ...f, posts };
  if (r() < 0.2) out.topics = [...f.topics, { id: `t${Math.floor(r() * 1e6)}`, name: "ห้อง" }];
  if (r() < 0.1) out.note = r() < 0.5 ? "x" : undefined;
  return out;
}

describe("store-delta", () => {
  it("diff แล้ว apply ได้ก้อนเดียวกับของจริงทุกครั้ง (สุ่ม 2,000 รอบ)", () => {
    const r = rnd(42);
    let base: Feed = { posts: [{ id: "a", text: "1", replies: [] }], topics: [{ id: "t1", name: "x" }], albums: [] };
    for (let i = 0; i < 2000; i++) {
      const next = mutate(base, r);
      const d = diffSlice(base, next)!;
      const rebuilt = applyDelta(base, JSON.parse(JSON.stringify(d)));
      expect(deepEqual(rebuilt, JSON.parse(JSON.stringify(next)))).toBe(true);
      expect(rebuilt.posts.map((p) => p.id)).toEqual(next.posts.map((p) => p.id));
      base = next;
    }
  });

  it("ไม่สนลำดับคีย์ (ข้อมูลจาก jsonb) — ไม่มีอะไรเปลี่ยน = delta ว่าง", () => {
    const a = { posts: [{ id: "a", text: "1", extra: 2 }] };
    const b = { posts: [{ extra: 2, text: "1", id: "a" }] };
    expect(diffSlice(a, b)).toEqual({ arrays: {}, set: {}, unset: [] });
  });

  it("ส่งเฉพาะโพสต์ที่เปลี่ยน", () => {
    const posts = Array.from({ length: 500 }, (_, i) => ({ id: `p${i}`, text: "x".repeat(200) }));
    const next = { posts: posts.map((p, i) => (i === 7 ? { ...p, text: "แก้" } : p)) };
    const d = diffSlice({ posts }, next)!;
    expect(d.arrays.posts?.upsert).toHaveLength(1);
    expect(d.arrays.posts?.order).toBeUndefined();
    expect(JSON.stringify(d).length).toBeLessThan(200);
  });

  it("อาร์เรย์ id ซ้ำ / ไม่มี id → ส่งทั้งช่อง", () => {
    const d = diffSlice({ albums: [1, 2] }, { albums: [1, 2, 3] })!;
    expect(d.set.albums).toEqual([1, 2, 3]);
  });

  it("delta ผิดรูป → throw (ผู้เรียกโหลดเต็มแทน)", () => {
    expect(() => applyDelta({ posts: [] }, { arrays: { posts: { upsert: [{}], remove: [] } }, set: {}, unset: [] })).toThrow();
    expect(() => applyDelta({ posts: "x" }, { arrays: { posts: { upsert: [], remove: [] } }, set: {}, unset: [] })).toThrow();
  });
});
