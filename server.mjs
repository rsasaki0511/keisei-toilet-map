// トイレマップの配信と、情報提供の受け付け。
// DATABASE_URL があれば PostgreSQL に、無ければ ./data/reports.jsonl に保存する（ローカル確認用）。
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const INDEX = fs.readFileSync(path.join(DIR, "index.html"));

// 駅IDの一覧は index.html の const S = {...} から取る（検証用）
const STATIONS = new Set();
{
  const html = INDEX.toString("utf8");
  const block = html.slice(html.indexOf("const S = {"), html.indexOf("const ALL ="));
  for (const m of block.matchAll(/^\s*"([^"]+)":\s*\{/gm)) STATIONS.add(m[1]);
}

// 保存先
let save;
if (process.env.DATABASE_URL) {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  await pool.query(`CREATE TABLE IF NOT EXISTS reports (
    id serial PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    station text NOT NULL,
    gender text NOT NULL,
    place text NOT NULL,
    detail text NOT NULL DEFAULT '',
    w smallint, y smallint, u smallint, bf smallint,
    seen date,
    note text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'new'
  )`);
  save = r => pool.query(
    `INSERT INTO reports (station, gender, place, detail, w, y, u, bf, seen, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [r.station, r.gender, r.place, r.detail, r.w, r.y, r.u, r.bf, r.seen, r.note]);
} else {
  const file = path.join(DIR, "data", "reports.jsonl");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  save = async r => fs.appendFileSync(file, JSON.stringify({ created_at: new Date().toISOString(), ...r }) + "\n");
}

// 連投よけ：同じIPから1時間に10件まで（IPはメモリ上だけで、保存しない）
const HITS = new Map();
function limited(ip) {
  const now = Date.now(), hour = 3600_000;
  const arr = (HITS.get(ip) || []).filter(t => now - t < hour);
  if (arr.length >= 10) { HITS.set(ip, arr); return true; }
  arr.push(now); HITS.set(ip, arr);
  return false;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of HITS) if (v.every(t => now - t > 3600_000)) HITS.delete(k); }, 600_000).unref();

const str = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, max) : "");
const cnt = v => (v === null || v === undefined || v === "" ? null : Number.isInteger(v) && v >= 0 && v <= 30 ? v : NaN);

function validate(b) {
  if (!b || typeof b !== "object") return "内容が読めませんでした。";
  if (!STATIONS.has(b.station)) return "駅をえらんでください。";
  if (!["men", "women", "multi"].includes(b.gender)) return "トイレの種類をえらんでください。";
  if (!["inside", "outside", "unknown"].includes(b.place)) return "場所をえらんでください。";
  const r = {
    station: b.station, gender: b.gender, place: b.place,
    detail: str(b.detail, 80), note: str(b.note, 400),
    w: cnt(b.w), y: cnt(b.y), u: b.gender === "men" ? cnt(b.u) : null, bf: cnt(b.bf),
    seen: typeof b.seen === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.seen) ? b.seen : null
  };
  if ([r.w, r.y, r.u, r.bf].some(Number.isNaN)) return "数は0〜30で入れてください。";
  if (!r.detail && !r.note && r.place === "unknown" && [r.w, r.y, r.u, r.bf].every(v => v == null)) return "場所・数・説明のどれかを入れてください。";
  return r;
}

const HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY"
};
function json(res, code, obj) {
  res.writeHead(code, { ...HEADERS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
    res.writeHead(200, { ...HEADERS, "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
    return res.end(INDEX);
  }
  if (req.method === "HEAD" && url.pathname === "/") { res.writeHead(200, HEADERS); return res.end(); }
  if (req.method === "GET" && url.pathname === "/healthz") { res.writeHead(200, { "Content-Type": "text/plain" }); return res.end("ok"); }
  if (url.pathname === "/api/reports") {
    if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
    if (!/^application\/json\b/.test(req.headers["content-type"] || "")) return json(res, 415, { error: "JSONで送ってください。" });
    const ip = String(req.headers["x-real-ip"] || req.socket.remoteAddress || "");
    let size = 0; const chunks = [];
    req.on("data", c => { size += c.length; if (size > 8192) { json(res, 413, { error: "内容が長すぎます。" }); req.destroy(); } else chunks.push(c); });
    req.on("end", async () => {
      if (res.writableEnded) return;
      let body; try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return json(res, 400, { error: "内容が読めませんでした。" }); }
      // 見えない入力欄に何か入っていたら機械とみなし、受け付けたふりをして捨てる
      if (body && body.website) return json(res, 200, { ok: true });
      if (limited(ip)) return json(res, 429, { error: "少し時間をおいてください。" });
      const r = validate(body);
      if (typeof r === "string") return json(res, 400, { error: r });
      try { await save(r); json(res, 200, { ok: true }); }
      catch (e) { console.error("save failed:", e.message); json(res, 500, { error: "保存できませんでした。時間をおいて送ってください。" }); }
    });
    return;
  }
  res.writeHead(404, { ...HEADERS, "Content-Type": "text/plain; charset=utf-8" });
  res.end("not found");
});
server.listen(PORT, () => console.log(`listening on ${PORT} (stations: ${STATIONS.size}, store: ${process.env.DATABASE_URL ? "postgres" : "jsonl"})`));
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => server.close(() => process.exit(0)));
