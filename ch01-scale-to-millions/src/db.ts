/**
 * ─────────────────────────────────────────────────────────────────────────────
 * src/db.ts — Database connection pool + schema initialization
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * [CONCEPT] File này có 2 trách nhiệm:
 *   1. Tạo và export một CONNECTION POOL để toàn bộ app dùng chung.
 *   2. Khi app khởi động, tạo các bảng nếu chưa có (schema init).
 *
 * [CONCEPT] CONNECTION POOL là gì?
 *   Tưởng tượng mỗi database query cần một "đường dây điện thoại" riêng tới DB.
 *   Nếu mỗi request HTTP mở một đường dây mới rồi cúp máy → rất chậm:
 *     TCP handshake → TLS (nếu có) → Postgres auth → query → đóng kết nối
 *   Connection pool giữ sẵn N "đường dây" luôn mở. Request đến thì mượn,
 *   xong trả về pool. Không cần handshake lại = nhanh hơn rất nhiều.
 *
 * [WHY] Tại sao dùng thư viện `pg` (node-postgres)?
 *   → Mature nhất cho Node/TS, battle-tested hàng triệu production deployment
 *   → Pool built-in, không cần thư viện thứ ba
 *   → Nếu sau này dùng ORM (Prisma, Drizzle), chúng cũng chạy trên top của `pg`
 */

import pg from "pg";

const { Pool } = pg;

// ── Tạo pool dùng chung cho toàn bộ app ─────────────────────────────────────

// [CONCEPT] Đây là SINGLETON pattern: một Pool duy nhất được tạo khi app khởi động,
//           rồi được reuse suốt vòng đời app. Không tạo Pool mới trong mỗi request.
export const pool = new Pool({
  host: process.env.DB_HOST ?? "localhost",
  port: Number(process.env.DB_PORT ?? 5432),
  database: process.env.DB_NAME ?? "miniboard",
  user: process.env.DB_USER ?? "miniboard",
  password: process.env.DB_PASSWORD ?? "miniboard_secret",

  // [CONCEPT] max = số connection tối đa pool được phép mở tới Postgres.
  //           Postgres mặc định cho phép 100 connection đồng thời.
  //           Nếu ta có 4 server instances × 10 connection = 40 — vẫn trong giới hạn.
  // [WHY] Đặt quá cao (ví dụ 100) → Postgres quá tải context switching giữa connections.
  //       Đặt quá thấp → request bị xếp hàng chờ connection rảnh.
  //       10 là điểm cân bằng tốt cho app nhỏ-vừa.
  max: 10,

  // [CONCEPT] idleTimeoutMillis: connection đã rảnh bao lâu thì đóng lại.
  //           Giữ connection idle mãi = lãng phí tài nguyên phía Postgres.
  idleTimeoutMillis: 30_000,

  // [CONCEPT] connectionTimeoutMillis: nếu pool đã đầy và không có connection
  //           rảnh sau 2 giây, throw lỗi thay vì chờ vô hạn.
  //           Fail fast = dễ debug hơn là hệ thống "đứng hình" không rõ lý do.
  connectionTimeoutMillis: 2_000,
});

// ── Schema initialization ────────────────────────────────────────────────────

/**
 * Tạo bảng nếu chưa có. Được gọi MỘT LẦN khi app khởi động.
 *
 * [CONCEPT] "IF NOT EXISTS" = idempotent operation: chạy bao nhiêu lần cũng
 *           ra kết quả như nhau, không bao giờ fail vì bảng đã tồn tại.
 *           Đây là pattern chuẩn cho schema migration đơn giản.
 *
 * [WHY] Production thật sẽ dùng migration tool (Flyway, Liquibase, Drizzle migrate)
 *       thay vì IF NOT EXISTS. Nhưng với project học, cách này đủ rõ ràng.
 */
export async function initSchema(): Promise<void> {
  // [CONCEPT] client.query() vs pool.query():
  //           pool.query() = tự động mượn connection, chạy query, trả về pool.
  //           Dùng cho các query đơn lẻ, không cần transaction.
  //           client = mượn connection thủ công, giữ cho nhiều query liên tiếp
  //           (bắt buộc cho TRANSACTION). Ở đây ta dùng pool.query vì đơn giản.

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      username    VARCHAR(50) UNIQUE NOT NULL,
      password    TEXT        NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  // [CONCEPT] gen_random_uuid() = hàm built-in của Postgres 13+ tạo UUID v4.
  //           UUID thay vì SERIAL integer vì UUID an toàn hơn cho distributed
  //           system sau này (không cần coordinator để tăng số thứ tự).

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username    VARCHAR(50) NOT NULL,
      text        TEXT        NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  // [CONCEPT] REFERENCES users(id) = FOREIGN KEY constraint.
  //           Đảm bảo mỗi message phải thuộc về một user thật, không thể có
  //           message "mồ côi". Đây là "Referential Integrity" — sức mạnh của SQL.
  //
  // [CONCEPT] ON DELETE CASCADE: khi user bị xoá, toàn bộ message của họ
  //           tự động bị xoá theo. Không cần app tự dọn dẹp.

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_messages_created_at
    ON messages(created_at DESC);
  `);
  // [CONCEPT] INDEX là gì?
  //           Không có index, câu query "SELECT ... ORDER BY created_at DESC LIMIT 20"
  //           phải duyệt TOÀN BỘ bảng (full table scan) → chậm khi có triệu dòng.
  //           Index như mục lục cuốn sách: Postgres nhảy thẳng đến trang cần đọc.
  //
  // [WHY] Index DESC vì ta luôn query tin mới nhất trước. Index hướng DESC giúp
  //       tránh bước "sort ngược" tốn kém sau khi đọc.

  console.log("[db] Schema khởi tạo xong.");
}
