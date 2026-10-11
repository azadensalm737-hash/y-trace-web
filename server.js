import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";

dotenv.config();
const app = express();
const port = process.env.PORT || 3000;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "20kb" }));
app.use(express.static("."));
app.use("/api/", rateLimit({ windowMs: 60_000, limit: 15, standardHeaders: "draft-7", legacyHeaders: false }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, apiKeyConfigured: Boolean(process.env.EXA_API_KEY) });
});

app.post("/api/search", async (req, res) => {
  try {
    if (!process.env.EXA_API_KEY) {
      return res.status(503).json({ error: "مفتاح Exa غير مضبوط في إعدادات الخادم." });
    }
    const phone = String(req.body?.phone || "").trim().slice(0, 80);
    const region = String(req.body?.region || "YE").slice(0, 3);
    const variants = Array.isArray(req.body?.variants)
      ? req.body.variants.map(x => String(x).slice(0, 80)).slice(0, 8)
      : [];
    if (!phone || !/\d/.test(phone)) {
      return res.status(400).json({ error: "أدخل رقم هاتف صحيحًا للبحث." });
    }

    const digits = phone.replace(/\D/g, "");
    // Search only publicly indexed web pages. Do not attempt private database access.
    const query = `public web pages mentioning phone number "${phone}" OR "${digits}" ${variants.slice(0,4).map(x => `"${x}"`).join(" OR ")}`;
    const upstream = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: {
        "x-api-key": process.env.EXA_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        query,
        type: "auto",
        numResults: 10,
        contents: { highlights: true }
      }),
      signal: AbortSignal.timeout(30000)
    });
    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      console.error("Exa API error:", upstream.status, payload?.tag || "unknown");
      return res.status(upstream.status === 401 ? 502 : 502).json({
        error: upstream.status === 401
          ? "رفضت Exa المفتاح. تأكد من صحة المفتاح في إعدادات الخادم."
          : "خدمة البحث لم تستجب بنجاح. تحقق من إعدادات Exa وحدود الاستخدام."
      });
    }

    const seen = new Set();
    const results = [];
    for (const item of (payload.results || [])) {
      if (!item.url) continue;
      let normalized;
      try {
        const u = new URL(item.url);
        u.hash = "";
        normalized = u.toString().replace(/\/+$/, "").toLowerCase();
      } catch { continue; }
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      results.push({
        title: String(item.title || item.url).slice(0, 300),
        url: item.url,
        text: String(item.highlights?.join(" ") || item.text || "").slice(0, 1200),
        publishedDate: item.publishedDate || null
      });
    }
    res.json({ query, count: results.length, results });
  } catch (err) {
    console.error("Search route error:", err?.message || err);
    res.status(500).json({ error: "حدث خطأ أثناء البحث. حاول مرة أخرى لاحقًا." });
  }
});

app.listen(port, () => console.log(`Y-Trace running on port ${port}`));
