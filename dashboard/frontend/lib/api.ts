const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function apiFetch<T>(path: string, fallback?: T): Promise<T> {
  try {
    const res = await fetch(`${BASE}${path}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
    return res.json() as Promise<T>;
  } catch (err) {
    if (fallback !== undefined) return fallback;
    throw err;
  }
}
