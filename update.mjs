// Ambil ringkasan perdagangan BEI saat jeda siang (akhir sesi 1) lalu tulis foreign-flow.json.
// Dijalankan GitHub Actions. FF_FORCE=1 = paksa ambil di luar jam jeda (untuk tes).
import { writeFileSync } from "node:fs";

const HOSTS = ["https://www.idx.co.id", "https://www.idx.id"];
const HDR = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
  "Referer": "https://www.idx.co.id/id/data-pasar/ringkasan-perdagangan/ringkasan-saham/",
};
const wib = () => new Date(Date.now() + 7 * 3600e3);
const ymd = (d) => d.getUTCFullYear() * 1e4 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();

// Sen-Kam jeda 12:00-13:30, Jumat 11:30-14:00 (WIB)
function inBreak(d) {
  const w = d.getUTCDay(), m = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (w === 0 || w === 6) return false;
  return w === 5 ? m >= 690 && m < 840 : m >= 720 && m < 810;
}

async function idx(date) {
  for (const h of HOSTS) {
    try {
      const r = await fetch(`${h}/primary/TradingSummary/GetStockSummary?length=9999&start=0&date=${date}`, { headers: HDR });
      if (!r.ok) { console.log("IDX", h, "status", r.status); continue; }
      const j = await r.json();
      if (j && Array.isArray(j.data)) return j;
    } catch (e) { console.log("IDX", h, "error", String(e)); }
  }
  return null;
}

// ForeignBuy/ForeignSell bisa berupa lembar saham atau rupiah; dideteksi otomatis
function build(j, d) {
  const rows = []; let sv = 0, sf = 0, sval = 0;
  for (const x of j.data) {
    const c = String(x.StockCode || "").trim(); if (!c) continue;
    const fb = +x.ForeignBuy || 0, fs = +x.ForeignSell || 0, p = +x.Close || +x.Previous || 0;
    sv += +x.Volume || 0; sf += fb + fs; sval += +x.Value || 0;
    rows.push({ c, fb, fs, p });
  }
  if (!rows.length || !sval) return null;
  const vol = sf <= sv * 1.05;
  let B = 0, S = 0, net = 0, nb = 0, ns = 0;
  for (const r of rows) {
    const b = vol ? r.fb * r.p : r.fb, s = vol ? r.fs * r.p : r.fs;
    r.n = b - s; B += b; S += s; net += r.n;
    if (r.n > 0) nb++; else if (r.n < 0) ns++;
  }
  if (!B && !S) return null;
  const G = 1e9, top = (a) => a.slice(0, 20).map((r) => [r.c, Math.round(r.p), +(Math.abs(r.n) / G).toFixed(2)]);
  const sorted = rows.slice().sort((a, b) => b.n - a.n);
  return {
    d, net: +(net / G).toFixed(1), B: +(B / G).toFixed(1), S: +(S / G).toFixed(1), nb, ns,
    buy: top(sorted.filter((r) => r.n > 0)),
    sell: top(sorted.filter((r) => r.n < 0).reverse()),
  };
}

const now = wib(), force = process.env.FF_FORCE === "1";
if (!force && !inBreak(now)) { console.log("Bukan jam jeda siang, lewati."); process.exit(0); }
let c = new Date(now.getTime());
for (let i = 0; i < (force ? 5 : 1); i++, c = new Date(c.getTime() - 864e5)) {
  const w = c.getUTCDay(); if (!w || w > 5) continue;
  const d = ymd(c), j = await idx(d), out = j && build(j, d);
  if (out) { writeFileSync("foreign-flow.json", JSON.stringify(out)); console.log("Tersimpan", d, "net", out.net); process.exit(0); }
}
console.log("Tidak ada data BEI yang bisa diambil.");
