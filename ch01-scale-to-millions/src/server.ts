/**
 * ─────────────────────────────────────────────────────────────────────────────
 * src/server.ts — Mốc 1: Web tier dùng Postgres thay vì RAM
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * SO SÁNH VỚI MỐC 0 — 3 thay đổi chính:
 *
 *   MỐC 0                          MỐC 1
 *   ─────────────────────────────────────────────────────
 *   users    = Map (RAM)        →   bảng `users` (Postgres)
 *   messages = Array (RAM)      →   bảng `messages` (Postgres)
 *   sessions = Map (RAM)        →   ⚠️  VẪN TRONG RAM (cố tình!)
 *
 * [CONCEPT] Tại sao sessions vẫn trong RAM?
 *   Đây là "bẫy" có chủ ý để Mốc 2 minh hoạ vấn đề của stateful server.
 *   Khi ta chạy 2 instance app song song (scale ngang), mỗi instance có một
 *   Map sessions riêng → đăng nhập ở instance A, request tiếp theo rơi vào
 *   instance B → "Chưa đăng nhập". Mốc 3 sẽ vá lỗi này bằng Redis.
 */

import express, { type Request, type Response, type NextFunction } from "express";
import crypto from "node:crypto";
import { pool, initSchema } from "./db.js";

const app = express();
app.use(express.json());

// ── Session store: CỐ Ý giữ trong RAM ───────────────────────────────────────
// ⚠️  [CONCEPT] STATEFUL SERVER — trạng thái gắn với process cụ thể.
//     Hệ quả: nếu process này chết, toàn bộ session mất. Nếu scale ngang
//     thành nhiều process, mỗi process có sessions khác nhau → không nhất quán.
//     Đây là lý do "stateless web tier" là nguyên tắc vàng trong system design.
const sessions = new Map<string, string>(); // sid → userId

const INSTANCE_ID = process.env.INSTANCE_ID ?? "app-1";

// ── Middleware: đọc session từ cookie ────────────────────────────────────────
function withUser(req: Request, _res: Response, next: NextFunction): void {
  const cookie = req.headers.cookie ?? "";
  const sid = cookie
    .split(";")
    .map(c => c.trim())
    .find(c => c.startsWith("sid="))
    ?.slice(4);

  // [CONCEPT] Mỗi request HTTP là STATELESS — nó không tự biết caller là ai.
  //           Session cookie là cơ chế "nhớ" giữa các request: browser gửi kèm
  //           cookie mỗi lần, server tra cứu token → tìm ra user.
  (req as any).userId = sid ? sessions.get(sid) : undefined;
  next();
}
app.use(withUser);

// ── Routes ───────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ ok: true, instance: INSTANCE_ID });
});

// ── POST /register ───────────────────────────────────────────────────────────
app.post("/register", async (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    return res.status(400).json({ error: "Thiếu username/password" });
  }

  try {
    // [CONCEPT] Parameterized query ($1, $2): KHÔNG bao giờ nối string trực tiếp
    //           vào SQL. Nếu làm vậy, user nhập `'; DROP TABLE users; --` sẽ xoá
    //           toàn bộ data — đây gọi là SQL Injection, lỗ hổng #1 phổ biến nhất.
    //           Parameterized query = pg tự escape, không thể inject.
    const result = await pool.query<{ id: string; username: string }>(
      `INSERT INTO users (username, password)
       VALUES ($1, $2)
       RETURNING id, username`,
      [username, password]
      // [WHY] Lưu password plaintext ở đây vì ta đang học system design, không security.
      //       Production: dùng bcrypt.hash(password, 12) trước khi lưu.
    );
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    // [CONCEPT] Postgres error code "23505" = unique_violation.
    //           Khi username đã tồn tại (UNIQUE constraint), Postgres ném lỗi này
    //           thay vì ta phải SELECT trước rồi INSERT sau (tránh race condition).
    if (err.code === "23505") {
      return res.status(409).json({ error: "Username đã tồn tại" });
    }
    throw err; // các lỗi khác để Express error handler xử lý
  }
});

// ── POST /login ──────────────────────────────────────────────────────────────
app.post("/login", async (req, res) => {
  const { username, password } = req.body ?? {};

  const result = await pool.query<{ id: string; username: string; password: string }>(
    `SELECT id, username, password FROM users WHERE username = $1`,
    [username]
  );

  const user = result.rows[0];
  if (!user || user.password !== password) {
    return res.status(401).json({ error: "Sai thông tin đăng nhập" });
  }

  const sid = crypto.randomBytes(16).toString("hex");
  sessions.set(sid, user.id); // ⚠️ ghi vào RAM của riêng process này
  res.setHeader("Set-Cookie", `sid=${sid}; HttpOnly; Path=/`);
  res.json({ ok: true, loggedInAs: username, servedBy: INSTANCE_ID });
});

// ── GET /me ──────────────────────────────────────────────────────────────────
app.get("/me", async (req, res) => {
  const userId = (req as any).userId as string | undefined;
  if (!userId) {
    return res.status(401).json({ error: "Chưa đăng nhập", servedBy: INSTANCE_ID });
  }

  // [CONCEPT] Query bằng PRIMARY KEY (UUID) → Postgres dùng index B-tree có sẵn
  //           → O(log n) dù bảng có hàng triệu dòng. Đây là lý do PK quan trọng.
  const result = await pool.query<{ id: string; username: string }>(
    `SELECT id, username FROM users WHERE id = $1`,
    [userId]
  );
  res.json({ ...result.rows[0], servedBy: INSTANCE_ID });
});

// ── POST /messages ───────────────────────────────────────────────────────────
app.post("/messages", async (req, res) => {
  const userId = (req as any).userId as string | undefined;
  if (!userId) {
    return res.status(401).json({ error: "Chưa đăng nhập", servedBy: INSTANCE_ID });
  }

  const { text } = req.body ?? {};
  if (!text) return res.status(400).json({ error: "Thiếu text" });

  // Lấy username từ DB để lưu vào message (denormalization nhỏ để tránh JOIN khi đọc feed).
  // [CONCEPT] DENORMALIZATION: lưu dư thừa một chút (username trong messages)
  //           để đọc nhanh hơn (không cần JOIN). Đây là trade-off cơ bản:
  //           lưu trữ thêm ↔ tốc độ đọc. Mốc 4 (cache) sẽ nói kỹ hơn về trade-off này.
  const userResult = await pool.query<{ username: string }>(
    `SELECT username FROM users WHERE id = $1`,
    [userId]
  );

  const result = await pool.query<{ id: string; username: string; text: string; created_at: Date }>(
    `INSERT INTO messages (user_id, username, text)
     VALUES ($1, $2, $3)
     RETURNING id, username, text, created_at`,
    [userId, userResult.rows[0].username, text]
  );
  res.status(201).json(result.rows[0]);
});

// ── GET /feed ────────────────────────────────────────────────────────────────
app.get("/feed", async (_req, res) => {
  // [CONCEPT] LIMIT + ORDER BY = "pagination" đơn giản nhất.
  //           Không bao giờ SELECT * không có LIMIT trên bảng lớn —
  //           có thể trả về hàng triệu dòng, làm sập cả DB lẫn app.
  // [CONCEPT] Index idx_messages_created_at (tạo trong db.ts) giúp câu query
  //           này chạy nhanh ngay cả khi bảng có hàng triệu dòng.
  const result = await pool.query(
    `SELECT id, username, text, created_at
     FROM messages
     ORDER BY created_at DESC
     LIMIT 20`
  );
  res.json({ servedBy: INSTANCE_ID, count: result.rows.length, messages: result.rows });
});

// ── Khởi động server ─────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT ?? 8080);

// [CONCEPT] initSchema() được gọi TRƯỚC khi server bắt đầu nhận request.
//           Đảm bảo bảng tồn tại trước khi bất kỳ query nào chạy.
//           Đây là pattern "startup probe" — kiểm tra dependency trước khi phục vụ.
initSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`[${INSTANCE_ID}] MiniBoard (Mốc 1) chạy ở http://localhost:${PORT}`);
      console.log(`[${INSTANCE_ID}] Data bây giờ sống trong Postgres — không mất khi restart!`);
    });
  })
  .catch(err => {
    console.error("[FATAL] Không thể khởi tạo schema:", err);
    process.exit(1); // [WHY] Fail fast: nếu không kết nối được DB, không nên tiếp tục chạy.
  });
