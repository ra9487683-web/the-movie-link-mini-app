require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const Database = require("better-sqlite3");
const TelegramBot = require("node-telegram-bot-api");

const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const BOT_USERNAME = process.env.BOT_USERNAME || "";
const WEB_APP_URL = process.env.WEB_APP_URL || `http://localhost:${PORT}`;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "change-this-password";
const DEMO_MODE = String(process.env.DEMO_MODE).toLowerCase() === "true";

if (!BOT_TOKEN) {
  console.warn("BOT_TOKEN is empty. Bot polling will not start.");
}

const db = new Database(path.join(__dirname, "database.sqlite"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  photo_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS content (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  poster_url TEXT DEFAULT '',
  watch_url TEXT DEFAULT '',
  category_id INTEGER,
  badge TEXT DEFAULT 'Movie',
  views INTEGER NOT NULL DEFAULT 0,
  unlock_required INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS favorites (
  user_id INTEGER NOT NULL,
  content_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id, content_id),
  FOREIGN KEY(content_id) REFERENCES content(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS unlocked (
  user_id INTEGER NOT NULL,
  content_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id, content_id),
  FOREIGN KEY(content_id) REFERENCES content(id) ON DELETE CASCADE
);
`);

const seedCategory = db.prepare(
  "INSERT OR IGNORE INTO categories(name, slug) VALUES (?, ?)"
);
seedCategory.run("Movie", "movie");
seedCategory.run("Natok", "natok");
seedCategory.run("বাংলা ডাবিং", "bangla-dubbing");

const count = db.prepare("SELECT COUNT(*) AS n FROM content").get().n;
if (count === 0) {
  const movie = db.prepare("SELECT id FROM categories WHERE slug='movie'").get().id;
  const natok = db.prepare("SELECT id FROM categories WHERE slug='natok'").get().id;
  const insert = db.prepare(`
    INSERT INTO content
      (title, description, poster_url, watch_url, category_id, badge, unlock_required)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run(
    "Your First Movie",
    "Replace this demo item with your own licensed content.",
    "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=900&q=80",
    "https://example.com/watch",
    movie,
    "🔥 Movie",
    1
  );
  insert.run(
    "Your First Natok",
    "A sample card for testing the Mini App.",
    "https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&w=900&q=80",
    "https://example.com/watch",
    natok,
    "🔥 Natok",
    0
  );
}

function verifyTelegramInitData(initData) {
  if (!initData) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  const authDate = Number(params.get("auth_date"));

  if (!hash || !authDate) return null;
  if (Math.floor(Date.now() / 1000) - authDate > 86400) return null;

  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = crypto
    .createHmac("sha256", "WebAppData")
    .update(BOT_TOKEN)
    .digest();

  const calculated = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  if (!crypto.timingSafeEqual(
    Buffer.from(calculated, "utf8"),
    Buffer.from(hash, "utf8")
  )) return null;

  const userRaw = params.get("user");
  if (!userRaw) return null;

  try {
    return JSON.parse(userRaw);
  } catch {
    return null;
  }
}

function getUser(req, res, next) {
  const initData = req.header("x-telegram-init-data") || "";
  let user = verifyTelegramInitData(initData);

  if (!user && DEMO_MODE) {
    user = { id: 999999999, first_name: "Demo", username: "demo_user" };
  }

  if (!user) return res.status(401).json({ error: "Telegram session validation failed." });

  db.prepare(`
    INSERT INTO users(id, username, first_name, last_name, photo_url, last_seen)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET
      username=excluded.username,
      first_name=excluded.first_name,
      last_name=excluded.last_name,
      photo_url=excluded.photo_url,
      last_seen=CURRENT_TIMESTAMP
  `).run(
    user.id,
    user.username || null,
    user.first_name || "",
    user.last_name || "",
    user.photo_url || null
  );

  req.tgUser = user;
  next();
}

function contentQuery(userId) {
  return db.prepare(`
    SELECT
      c.id, c.title, c.description, c.poster_url, c.watch_url,
      c.badge, c.views, c.unlock_required, c.created_at,
      cat.name AS category,
      EXISTS(
        SELECT 1 FROM favorites f
        WHERE f.user_id=? AND f.content_id=c.id
      ) AS is_favorite,
      EXISTS(
        SELECT 1 FROM unlocked u
        WHERE u.user_id=? AND u.content_id=c.id
      ) AS is_unlocked
    FROM content c
    LEFT JOIN categories cat ON cat.id=c.category_id
  `);
}

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/config", (req, res) => {
  res.json({ botUsername: BOT_USERNAME, appUrl: WEB_APP_URL });
});

app.get("/api/me", getUser, (req, res) => {
  res.json({ user: req.tgUser });
});

app.get("/api/categories", getUser, (req, res) => {
  res.json({
    categories: db.prepare("SELECT id, name, slug FROM categories ORDER BY id").all()
  });
});

app.get("/api/content", getUser, (req, res) => {
  const q = String(req.query.q || "").trim();
  const category = String(req.query.category || "").trim();
  const favorites = req.query.favorites === "1";
  const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 100);

  let sql = contentQuery(req.tgUser.id).source;
  const where = [];
  const args = [req.tgUser.id, req.tgUser.id];

  if (q) {
    where.push("(LOWER(c.title) LIKE LOWER(?) OR LOWER(c.description) LIKE LOWER(?))");
    args.push(`%${q}%`, `%${q}%`);
  }
  if (category) {
    where.push("cat.slug = ?");
    args.push(category);
  }
  if (favorites) {
    where.push(`EXISTS(
      SELECT 1 FROM favorites ff WHERE ff.user_id=? AND ff.content_id=c.id
    )`);
    args.push(req.tgUser.id);
  }

  if (where.length) sql += " WHERE " + where.join(" AND ");
  sql += " ORDER BY c.id DESC LIMIT ?";
  args.push(limit);

  res.json({ items: db.prepare(sql).all(...args) });
});

app.get("/api/content/:id", getUser, (req, res) => {
  const id = Number(req.params.id);
  const item = contentQuery(req.tgUser.id).get(req.tgUser.id, req.tgUser.id, id);
  if (!item) return res.status(404).json({ error: "Content not found." });
  res.json({ item });
});

app.post("/api/content/:id/view", getUser, (req, res) => {
  const id = Number(req.params.id);
  const result = db.prepare("UPDATE content SET views=views+1 WHERE id=?").run(id);
  if (!result.changes) return res.status(404).json({ error: "Content not found." });
  res.json({ ok: true });
});

app.post("/api/content/:id/favorite", getUser, (req, res) => {
  const id = Number(req.params.id);
  const exists = db.prepare(
    "SELECT 1 FROM favorites WHERE user_id=? AND content_id=?"
  ).get(req.tgUser.id, id);

  if (exists) {
    db.prepare("DELETE FROM favorites WHERE user_id=? AND content_id=?")
      .run(req.tgUser.id, id);
  } else {
    db.prepare("INSERT OR IGNORE INTO favorites(user_id, content_id) VALUES (?, ?)")
      .run(req.tgUser.id, id);
  }

  res.json({ favorite: !exists });
});

app.post("/api/content/:id/unlock", getUser, (req, res) => {
  const id = Number(req.params.id);
  const item = db.prepare(
    "SELECT id, unlock_required FROM content WHERE id=?"
  ).get(id);

  if (!item) return res.status(404).json({ error: "Content not found." });

  db.prepare(`
    INSERT OR IGNORE INTO unlocked(user_id, content_id) VALUES (?, ?)
  `).run(req.tgUser.id, id);

  res.json({ unlocked: true });
});

function adminAuth(req, res, next) {
  const key = req.header("x-admin-password") || "";
  if (!key || key !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Invalid admin password." });
  }
  next();
}

app.get("/api/admin/categories", adminAuth, (req, res) => {
  res.json({ categories: db.prepare("SELECT * FROM categories ORDER BY id").all() });
});

app.get("/api/admin/content", adminAuth, (req, res) => {
  res.json({
    items: db.prepare(`
      SELECT c.*, cat.name AS category
      FROM content c LEFT JOIN categories cat ON cat.id=c.category_id
      ORDER BY c.id DESC
    `).all()
  });
});

app.post("/api/admin/categories", adminAuth, (req, res) => {
  const name = String(req.body.name || "").trim();
  const slug = String(req.body.slug || "").trim().toLowerCase();
  if (!name || !/^[a-z0-9-]+$/.test(slug)) {
    return res.status(400).json({ error: "Valid name and slug are required." });
  }
  try {
    const info = db.prepare(
      "INSERT INTO categories(name, slug) VALUES (?, ?)"
    ).run(name, slug);
    res.json({ id: info.lastInsertRowid });
  } catch {
    res.status(409).json({ error: "Category already exists." });
  }
});

app.post("/api/admin/content", adminAuth, (req, res) => {
  const b = req.body;
  if (!String(b.title || "").trim()) {
    return res.status(400).json({ error: "Title is required." });
  }
  const info = db.prepare(`
    INSERT INTO content
      (title, description, poster_url, watch_url, category_id, badge, unlock_required)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(b.title).trim(),
    String(b.description || "").trim(),
    String(b.poster_url || "").trim(),
    String(b.watch_url || "").trim(),
    b.category_id ? Number(b.category_id) : null,
    String(b.badge || "Movie").trim(),
    b.unlock_required ? 1 : 0
  );
  res.json({ id: info.lastInsertRowid });
});

app.put("/api/admin/content/:id", adminAuth, (req, res) => {
  const b = req.body;
  const info = db.prepare(`
    UPDATE content SET
      title=?, description=?, poster_url=?, watch_url=?,
      category_id=?, badge=?, unlock_required=?
    WHERE id=?
  `).run(
    String(b.title || "").trim(),
    String(b.description || "").trim(),
    String(b.poster_url || "").trim(),
    String(b.watch_url || "").trim(),
    b.category_id ? Number(b.category_id) : null,
    String(b.badge || "Movie").trim(),
    b.unlock_required ? 1 : 0,
    Number(req.params.id)
  );
  if (!info.changes) return res.status(404).json({ error: "Content not found." });
  res.json({ ok: true });
});

app.delete("/api/admin/content/:id", adminAuth, (req, res) => {
  const info = db.prepare("DELETE FROM content WHERE id=?").run(Number(req.params.id));
  if (!info.changes) return res.status(404).json({ error: "Content not found." });
  res.json({ ok: true });
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

async function telegramApi(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  return r.json();
}

if (BOT_TOKEN) {
  const bot = new TelegramBot(BOT_TOKEN, { polling: true });

  bot.onText(/^\/start(?:\s+.*)?$/, async (msg) => {
    const name = msg.from?.first_name || "বন্ধু";
    await bot.sendMessage(
      msg.chat.id,
      `🎬 ${name}, The Movie Link Bot-এ স্বাগতম!\\n\\n🍿 Movie • 📺 Natok • 🇧🇩 বাংলা ডাবিং\\n🔎 Search করুন এবং আপনার পছন্দের কনটেন্ট দেখুন।`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: "🚀 Open Mini App", web_app: { url: WEB_APP_URL } }
          ]]
        }
      }
    );
  });

  bot.setMyCommands([
    { command: "start", description: "Open The Movie Link Mini App" },
    { command: "help", description: "Show help" }
  ]).catch(console.error);

  telegramApi("setChatMenuButton", {
    menu_button: { type: "web_app", text: "🎬 Open App", web_app: { url: WEB_APP_URL } }
  }).catch(console.error);

  bot.onText(/^\/help$/, async (msg) => {
    await bot.sendMessage(
      msg.chat.id,
      "🎬 Mini App খুলতে /start চাপুন।\\n🔎 Search, Category, Favorite ও Unlock ফিচার ব্যবহার করতে পারবেন।"
    );
  });

  console.log("Telegram bot polling started.");
}

app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/") || req.path === "/admin") return next();
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on ${WEB_APP_URL}`);
});
