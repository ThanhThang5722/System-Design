# Chương 1 — Scale From Zero To Millions Of Users
> Nguồn: System Design Interview – Alex Xu (Vol 1)
> Project minh hoạ: MiniBoard (`src/server.ts`)

---

## Tư tưởng cốt lõi

> **Mỗi quyết định scale là phản ứng với một bottleneck cụ thể.**
> Không ai thêm component vì "nghe nói hay" — có vấn đề → mới có giải pháp.

Scale là hành trình **liên tục, từng bước**: bắt đầu từ thứ đơn giản nhất chạy được,
rồi để hệ thống "kêu đau" chỉ ra chỗ cần sửa.

---

## 1. Single Server Setup

Mọi thứ (web app, database, cache) chạy trên **một máy duy nhất**.

**Luồng request:**
```
User gõ api.mysite.com
  → DNS trả về IP (ví dụ: 15.125.23.214)
  → Browser gửi HTTP request đến IP đó
  → Server xử lý → trả HTML / JSON
```

**Vấn đề:** Web app và Database **giành tài nguyên** (CPU, RAM, disk I/O) của nhau.
→ Giải pháp: tách ra 2 server riêng.

---

## 2. Tách tầng Database

```
Web Server  ←→  Database Server
(xử lý logic)   (lưu trữ data)
```

Lợi ích: **mỗi tầng scale độc lập** — web cần thêm CPU thì nâng web,
data cần thêm RAM/disk thì nâng DB, không ảnh hưởng nhau.

### SQL vs NoSQL

| | SQL (Relational) | NoSQL |
|---|---|---|
| Ví dụ | MySQL, PostgreSQL, Oracle | Cassandra, MongoDB, DynamoDB, Redis |
| Lưu trữ | Bảng + hàng, có quan hệ | Key-value / document / graph / column |
| Mạnh ở | Giao dịch ACID, JOIN phức tạp | Latency thấp, scale ngang dễ, data lớn |

**Chọn NoSQL khi:**
- Cần độ trễ cực thấp
- Data phi cấu trúc, không có quan hệ
- Chỉ cần serialize/deserialize (JSON, XML, YAML)
- Lưu lượng data cực lớn

**Mặc định:** cứ dùng SQL (PostgreSQL) — đủ tốt cho 99% trường hợp ban đầu.

---

## 3. Vertical Scaling vs Horizontal Scaling

| | Vertical (Scale Up) | Horizontal (Scale Out) |
|---|---|---|
| Cách làm | Nâng cấu hình máy (CPU, RAM) | Thêm nhiều máy song song |
| Giới hạn | ❌ Có trần phần cứng | ✅ Không giới hạn lý thuyết |
| Fault tolerance | ❌ 1 server chết = sập hết | ✅ Server chết → cái khác thay |
| Chi phí | Đắt phi tuyến | Rẻ hơn với commodity hardware |

→ **Horizontal scaling là hướng đúng cho large-scale system.**

---

## 4. Load Balancer

Khi có nhiều server, cần "bộ điều phối" phân phối traffic đều.

```
User → Load Balancer (Public IP) → Server 1 (Private IP)
                                 → Server 2 (Private IP)
```

**2 vấn đề LB giải quyết:**
- **No failover:** Server 1 chết → LB tự chuyển traffic sang Server 2
- **Overload:** Traffic tăng → thêm Server 3, LB tự phân phối

**Bảo mật:** Server không expose IP public nữa — chỉ LB mới có.

---

## 5. Database Replication (Master - Slave)

Một DB server duy nhất vẫn là **Single Point of Failure (SPOF)**.

```
Writes → Master DB ──replicate──→ Slave DB 1  ← Reads
                   ──replicate──→ Slave DB 2  ← Reads
                   ──replicate──→ Slave DB 3  ← Reads
```

- **Master:** chỉ nhận write (INSERT, UPDATE, DELETE)
- **Slave:** nhận bản copy từ Master, chỉ phục vụ read

**3 lợi ích:**
- 🚀 **Performance:** Read phân tán ra nhiều Slave → xử lý song song
- 🛡️ **Reliability:** Data lưu nhiều nơi → không mất dù 1 máy vật lý hỏng
- ⬆️ **Availability:** Một DB chết → vẫn còn DB khác phục vụ

**Failover:**
- Slave chết → đọc chuyển sang Master tạm, dựng Slave mới
- Master chết → promote một Slave lên làm Master mới
  ⚠️ Slave có thể chưa sync đầy đủ → cần data recovery script

---

## 6. Cache

Mỗi lần load trang → nhiều DB query → chậm và tốn tài nguyên.
Cache lưu kết quả query vào **RAM** để phục vụ lần sau nhanh hơn.

### Cache-aside strategy (phổ biến nhất)
```
Request đến → Kiểm tra cache
  ├── HIT  → Trả về từ cache (ms)
  └── MISS → Query DB → Lưu cache → Trả về
```

### 5 điều cần cân nhắc

| Điểm | Chi tiết |
|---|---|
| **Khi nào dùng** | Data đọc nhiều, thay đổi ít. Không cache data quan trọng cần persistent |
| **TTL (Expiration)** | Không quá ngắn (load DB liên tục) cũng không quá dài (data stale) |
| **Consistency** | DB và cache có thể lệch nhau khi scale multi-region |
| **SPOF** | Một cache server = SPOF → cần nhiều cache server |
| **Eviction policy** | Cache đầy → xóa bớt: **LRU** (phổ biến nhất), LFU, FIFO |

---

## 7. CDN (Content Delivery Network)

**Vấn đề:** User ở VN request ảnh từ server Mỹ → 150ms+.

CDN là mạng lưới server **phân tán toàn cầu**, cache static content (ảnh, video, CSS, JS)
ở node gần user nhất.

### Luồng hoạt động
```
User A (request ảnh)
  → CDN node gần nhất
    ├── Cache HIT  → Trả về ngay (~20-40ms)
    └── Cache MISS → Lấy từ Origin → Cache lại (theo TTL) → Trả về
User B (cùng ảnh) → CDN trả từ cache
```

### Cân nhắc
- **Chi phí:** CDN tính tiền theo data transfer — chỉ cache file dùng nhiều
- **Cache expiry:** Quá dài → content cũ; quá ngắn → load Origin liên tục
- **CDN fallback:** CDN outage → app fallback về Origin server
- **Invalidation:** Deploy file mới → phải invalidate cache (dùng versioning: `style.css?v=2`)

---

## 8. Stateless Web Tier ⭐ (Nguyên tắc vàng)

### Stateful — ❌ Vấn đề

```
User A → Server 1 (có session của A) ✅
User A → Server 2 (không có session!) ❌
```

Mỗi server "nhớ" client → phải dùng **sticky session** (request của A phải vào đúng Server 1).
Hệ quả: thêm/bớt server khó, server chết thì session mất.

### Stateless — ✅ Giải pháp

```
User A → Server 1 ──→ Shared Storage (Redis) → lấy session ✅
User A → Server 2 ──→ Shared Storage          → lấy session ✅
User A → Server 3 ──→ Shared Storage          → lấy session ✅
```

**Chuyển state ra ngoài** (Redis, DB) → mọi server phục vụ được mọi user
→ **Auto-scaling** dễ dàng: thêm/bớt server tự động theo traffic.

> 💡 Đây chính là lý do `sessions Map` trong MiniBoard Mốc 0 và 1 bị cố tình
> giữ trong RAM — Mốc 2 sẽ demo bug này, Mốc 3 sẽ vá bằng Redis.

---

## 9. Data Centers (Đa trung tâm dữ liệu)

**GeoDNS routing:** DNS phân giải domain → IP của DC gần user nhất.

```
User ở Asia   → DC Singapore  (x% traffic)
User ở Europe → DC Frankfurt  ((100-x)% traffic)
```

**Failover:** DC Singapore sập → GeoDNS tự chuyển 100% traffic sang DC Frankfurt.

**3 thách thức kỹ thuật:**

| Thách thức | Giải pháp |
|---|---|
| Traffic redirection | GeoDNS cần biết health của từng DC |
| Data synchronization | Async multi-DC replication (như Netflix) |
| Test & deployment | CI/CD pipeline deploy đồng bộ tất cả DC |

---

## 10. Message Queue

Khi hệ thống lớn, các component cần **tách rời (decouple)** để scale độc lập.

```
Producer (Web Server) → [Message Queue] → Consumer (Worker)
     gửi message             buffer            xử lý bất đồng bộ
     không chờ                                 theo tốc độ riêng
```

**Ví dụ:** Upload ảnh → crop/resize → Web server đẩy job vào queue
→ Photo Worker xử lý async → User không cần chờ.

**Lợi ích:**
- Producer và Consumer **scale độc lập**
- Queue đầy → thêm Worker; Queue rỗng → giảm Worker
- Một bên down không ảnh hưởng bên kia

---

## 11. Logging, Metrics, Automation

Hệ thống lớn không thể vận hành thủ công.

| Công cụ | Mục đích |
|---|---|
| **Logging** | Tập trung error log từ tất cả server vào một chỗ (ELK, Datadog) |
| **Metrics** | Đo sức khỏe: CPU/RAM (host), DB/Cache perf (aggregated), DAU/Revenue (business) |
| **Automation** | CI/CD: mỗi commit → tự động test + build + deploy |

---

## 12. Database Scaling

### Vertical Scaling
Nâng cấu hình máy DB (Amazon RDS có thể lên 24TB RAM).
Giới hạn: có trần phần cứng, đắt, vẫn là SPOF.

### Horizontal Scaling — Sharding

Chia database thành nhiều **shard** nhỏ, mỗi shard là một DB riêng.

```
user_id % 4 = 0 → Shard 0  (user: 0, 4, 8, 12...)
user_id % 4 = 1 → Shard 1  (user: 1, 5, 9, 13...)
user_id % 4 = 2 → Shard 2  (user: 2, 6, 10, 14...)
user_id % 4 = 3 → Shard 3  (user: 3, 7, 11, 15...)
```

**Sharding key (partition key):** cột dùng để quyết định data vào shard nào.
Phải chọn sao cho data phân phối **đều** giữa các shard.

**3 vấn đề của Sharding:**

| Vấn đề | Mô tả | Giải pháp |
|---|---|---|
| **Resharding** | Shard đầy quá → cần chia lại, phức tạp | Consistent Hashing (Chương 5) |
| **Celebrity problem** | Hotspot key: nhiều celeb cùng 1 shard → quá tải | Shard riêng cho celebrity |
| **JOIN & de-normalization** | Không thể JOIN across shard | De-normalize data, chấp nhận dư thừa |

---

## 🎯 7 Nguyên tắc Scale Lên Triệu User (Checklist)

> Đây là checklist của Alex Xu ở cuối chương — kim chỉ nam cho cả cuốn sách.

| # | Nguyên tắc | Tại sao |
|---|---|---|
| 1 | **Keep web tier stateless** | Session ra ngoài → auto-scale dễ |
| 2 | **Build redundancy at every tier** | Không có SPOF nào |
| 3 | **Cache data as much as you can** | Giảm tải DB, tăng tốc phản hồi |
| 4 | **Support multiple data centers** | Geo-routing, failover tự động |
| 5 | **Host static assets in CDN** | Content gần user → load nhanh |
| 6 | **Scale data tier by sharding** | DB không vertical scale mãi được |
| 7 | **Split tiers into individual services** | Microservices → scale độc lập |
| + | **Monitor & automate everything** | Không vận hành thủ công khi lớn |

---

## 🗺️ Kiến trúc Cuối Chương (Full Picture)

```
                         ┌─────────────┐
User ──────────────────→ │     CDN     │ (static: JS/CSS/images)
                         └─────────────┘
                                │
                         ┌──────▼──────┐
                         │Load Balancer│
                         └──────┬──────┘
               ┌────────────────┼────────────────┐
         ┌─────▼────┐     ┌─────▼────┐     ┌─────▼────┐
         │ Server 1 │     │ Server 2 │     │ Server 3 │  ← Auto-scale
         └────┬─────┘     └────┬─────┘     └────┬─────┘
              │                │                │
         ┌────▼────────────────▼────────────────▼────┐
         │              Message Queue                 │
         └───────────────────┬────────────────────────┘
                             │
                      ┌──────▼──────┐
                      │   Workers   │
                      └─────────────┘
              │                               │
   ┌──────────▼──────┐             ┌──────────▼──────┐
   │  Cache (Redis)  │             │  NoSQL (session) │
   └─────────────────┘             └─────────────────┘
              │
   ┌──────────▼──────────────────────────────────────┐
   │                   Data Tier                      │
   │   Master DB ──replicate──→ Slave DB 1 (reads)   │
   │               ──replicate──→ Slave DB 2 (reads)  │
   │   Shard 0 │ Shard 1 │ Shard 2 │ Shard 3         │
   └──────────────────────────────────────────────────┘
              │
   ┌──────────▼─────────────────────────┐
   │  Logging  │  Metrics  │  CI/CD     │
   └────────────────────────────────────┘
```

---

## Liên kết với Project MiniBoard

| Mốc | Khái niệm trong Notes này |
|---|---|
| Mốc 0 | Single server, stateful session (RAM) |
| Mốc 1 | Tách DB tầng riêng, SQL vs NoSQL |
| Mốc 2 | Load Balancer, horizontal scaling → bug stateful session |
| Mốc 3 | Stateless web tier (session → Redis) |
| Mốc 4 | Cache (Redis cache-aside cho feed) |
| Mốc 5 | Database Replication (master + read replica) |
| Mốc 6 | Message Queue, Logging/Metrics |
