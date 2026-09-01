/**
 * Generic 3-way merge for the whole-blob shared stores behind ServerStoreSync.
 *
 * When two teammates save the same store at nearly the same time, the second
 * save comes back 409. Instead of one person's write clobbering the other's
 * (last-write-wins = data loss) or blocking with a popup, we merge: take the
 * other person's latest copy, then re-apply *only the things this client
 * actually changed* since it last saw the server (the common ancestor `base`).
 * Because it works per item id, two people editing different posts/topics in
 * the same board never collide.
 *
 *  - Arrays of objects that carry an `id`: merged by id. Items I added stay
 *    added; items I deleted (present in base, gone from mine) are removed;
 *    items I changed keep my version for that item, while every item I didn't
 *    touch keeps the other person's version.
 *  - Plain objects: merged key by key, recursively.
 *  - Anything else (scalars): if I moved it off the base value, mine wins;
 *    otherwise the other person's value is kept.
 *
 * Never throws — on any unexpected shape it falls back to "mine".
 */

type Id = string | number;
type WithId = { id: Id };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function isIdArray(v: unknown): v is WithId[] {
  return Array.isArray(v) && v.every((x) => isPlainObject(x) && "id" in x);
}

function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function mergeIdArrays(base: WithId[] | null, mine: WithId[], theirs: WithId[]): WithId[] {
  const baseById = new Map<Id, WithId>((base ?? []).map((x) => [x.id, x]));
  const mineById = new Map<Id, WithId>(mine.map((x) => [x.id, x]));

  const result: WithId[] = [];
  const seen = new Set<Id>();

  // Walk the other person's list first so their ordering and their untouched
  // items are the backbone of the result.
  for (const item of theirs) {
    const id = item.id;
    seen.add(id);

    if (!mineById.has(id)) {
      if (baseById.has(id)) continue; // I had it and deleted it → honor my delete
      result.push(item); // they added it, I never had it → keep theirs
      continue;
    }

    const mineItem = mineById.get(id)!;
    const baseItem = baseById.get(id);
    const iChanged = baseItem ? !eq(mineItem, baseItem) : true;
    const theyChanged = baseItem ? !eq(item, baseItem) : true;

    if (iChanged && !theyChanged) result.push(mineItem);        // only I touched it
    else if (!iChanged) result.push(item);                      // only they touched it (or nobody)
    else result.push(mergeThreeWay(baseItem, mineItem, item) as WithId); // both → merge fields
  }

  // Items I added that the other person doesn't have yet.
  for (const item of mine) {
    if (seen.has(item.id)) continue;
    if (baseById.has(item.id)) continue; // was in base and they removed it → honor their delete
    result.push(item);
  }

  return result;
}

export function mergeThreeWay(base: unknown, mine: unknown, theirs: unknown): unknown {
  try {
    if (theirs == null) return mine;
    if (mine == null) return theirs;

    if (isIdArray(mine) && isIdArray(theirs)) {
      return mergeIdArrays(isIdArray(base) ? base : null, mine, theirs);
    }

    if (isPlainObject(mine) && isPlainObject(theirs)) {
      const b = isPlainObject(base) ? base : {};
      const out: Record<string, unknown> = { ...theirs };
      const keys = new Set([...Object.keys(mine), ...Object.keys(theirs)]);
      for (const k of keys) {
        out[k] = mergeThreeWay(b[k], mine[k], theirs[k]);
      }
      return out;
    }

    // Scalars / mismatched shapes: my change wins only if I moved it off base.
    if (base !== undefined && !eq(mine, base)) return mine;
    return theirs;
  } catch {
    return mine;
  }
}
