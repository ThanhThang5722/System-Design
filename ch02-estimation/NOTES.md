# Chương 2 — Back-of-the-Envelope Estimation
> Nguồn: System Design Interview – Alex Xu (Vol 1)

---

## Tư tưởng cốt lõi

> **Ước lượng nhanh không cần chính xác — cần đúng hướng.**
> Mục tiêu là biết hệ thống cần bao nhiêu server, bao nhiêu storage, RPS là bao nhiêu
> để chọn đúng kiến trúc. Sai 2x không sao, sai 100x mới thành vấn đề.

Back-of-the-envelope = "tính trên tờ giấy gói đồ" — ước lượng nhanh bằng các con số
tròn, không cần máy tính phức tạp. Đây là kỹ năng **bắt buộc** trong phỏng vấn system design.

---

## 1. Power of Two — Đơn vị dữ liệu

Mọi tính toán dữ liệu đều quy về lũy thừa của 2:

| 2^n | Giá trị xấp xỉ | Tên | Ký hiệu |
|---|---|---|---|
| 10 | 1 nghìn | Kilobyte | **KB** |
| 20 | 1 triệu | Megabyte | **MB** |
| 30 | 1 tỷ | Gigabyte | **GB** |
| 40 | 1 nghìn tỷ | Terabyte | **TB** |
| 50 | 1 triệu tỷ | Petabyte | **PB** |

**Mẹo nhớ nhanh:** Mỗi bước tăng 10 bit = nhân 1000 lần.
- 1 ảnh JPEG ~= **1 MB**
- 1 video 720p 1 phút ~= **50 MB**
- Toàn bộ Wikipedia text ~= **20 GB**
- Gmail lưu email của 1.5 tỷ user ~= **PB** scale

---

## 2. Latency Numbers — Tốc độ các thao tác

Đây là bảng số **bắt buộc phải thuộc lòng** (Dr. Jeff Dean, Google):

| Thao tác | Thời gian | Ghi chú |
|---|---|---|
| L1 cache reference | ~1 ns | Nhanh nhất |
| L2 cache reference | ~4 ns | |
| Main memory (RAM) | ~100 ns | |
| SSD random read | ~16 µs | Nhanh hơn disk 100x |
| Read 1MB from memory | ~3 µs | |
| Read 1MB from SSD | ~49 µs | |
| Read 1MB from disk | ~825 µs | Chậm, tránh dùng |
| Disk seek | ~2 ms | **Cực chậm** |
| Round trip trong cùng datacenter | ~500 µs | |
| Packet CA → Netherlands → CA | ~150 ms | Cross-continent |

**4 kết luận quan trọng từ bảng này:**

1. 🐇 **RAM nhanh, disk chậm** → tránh đọc/ghi disk trong hot path
2. ❌ **Tránh disk seek** → đây là lý do SSD ra đời và tại sao database cần index tốt
3. ✅ **Nén dữ liệu trước khi truyền qua mạng** → compression rất nhanh (~2µs), tiết kiệm bandwidth
4. 🌍 **Data center khác vùng = latency cao** → đây là lý do cần multi-region + CDN

**Quy tắc ngón tay cái:**
```
RAM       : ns  (nano, 10^-9)   → rất nhanh
SSD       : µs  (micro, 10^-6)  → nhanh
Network   : ms  (milli, 10^-3)  → chấp nhận được
Cross-DC  : 150ms               → đáng kể với real-time app
```

---

## 3. Availability Numbers — "The Nines"

**High Availability (HA)** = hệ thống hoạt động liên tục trong thời gian dài.
Đo bằng % uptime — càng nhiều số 9 thì càng tốt.

| Availability | Downtime/ngày | Downtime/năm | Gọi là |
|---|---|---|---|
| 99% | 14.4 phút | 3.65 ngày | "Two nines" |
| 99.9% | 1.44 phút | 8.77 giờ | "Three nines" |
| 99.99% | 8.6 giây | 52.6 phút | "Four nines" |
| 99.999% | 864 ms | 5.26 phút | "Five nines" |
| 99.9999% | 86 ms | 31.5 giây | "Six nines" |

**SLA (Service Level Agreement):** Hợp đồng giữa nhà cung cấp và khách hàng về mức uptime cam kết.
- AWS, Google Cloud, Azure: cam kết **99.9% → 99.99%** tùy service
- Uptime càng cao → kiến trúc càng phức tạp và đắt tiền

**Thực tế:** Hầu hết startup target **99.9%** (8.77 giờ downtime/năm) là đủ.
99.999% đòi hỏi redundancy cực cao, chi phí rất lớn — chỉ cần cho banking, healthcare.

---

## 4. Ví dụ: Ước lượng Twitter QPS và Storage

> Đây là dạng bài **hay gặp nhất** trong phỏng vấn system design.
> Cách làm: đặt giả thuyết → tính từng bước → làm tròn.

### Giả thuyết (Assumptions)
- 300 triệu Monthly Active Users (MAU)
- 50% user dùng Twitter hàng ngày → **DAU = 150 triệu**
- Mỗi user post **2 tweets/ngày**
- 10% tweets có media (ảnh/video)
- Data lưu **5 năm**

### Tính QPS (Queries Per Second)

```
Tweet QPS = DAU × tweets/ngày ÷ giây/ngày
          = 150,000,000 × 2 ÷ 86,400
          = 300,000,000 ÷ 86,400
          ≈ 3,500 QPS

Peak QPS  = 2 × QPS = ~7,000 QPS
```
> **Mẹo:** 1 ngày ≈ 86,400 giây ≈ **100,000 giây** (để tính nhanh trong đầu)
> 300M ÷ 100K = 3,000 → gần đúng!

### Tính Storage

```
Kích thước 1 tweet:
  - tweet_id  : 64 bytes
  - text      : 140 bytes
  - media     : 1 MB (nếu có)

Media storage/ngày:
  = DAU × tweets × tỷ lệ media × kích thước media
  = 150M × 2 × 10% × 1 MB
  = 30 TB/ngày

Storage 5 năm:
  = 30 TB × 365 × 5
  ≈ 55 PB
```

---

## 5. Công thức thường dùng

### Tính DAU → QPS
```
QPS = DAU × requests/user/ngày ÷ 86,400
Peak QPS ≈ 2 × QPS   (thông thường)
           5 × QPS   (nếu traffic rất spiky)
```

### Tính Storage
```
Storage/ngày = DAU × actions/ngày × size/action
Storage total = Storage/ngày × 365 × số năm lưu
```

### Số server cần thiết
```
Số server = Peak QPS ÷ QPS/server

(1 server thông thường xử lý được ~1,000 QPS cho web app,
 ~100 QPS cho DB query phức tạp)
```

### Bandwidth
```
Bandwidth = Peak QPS × kích thước response trung bình
```

---

## 6. 4 Tips khi làm back-of-envelope trong phỏng vấn

| Tip | Chi tiết |
|---|---|
| **Làm tròn & xấp xỉ** | 99,987 ÷ 9.1 → tính là 100,000 ÷ 10 = 10,000. Không cần chính xác |
| **Ghi rõ giả thuyết** | Viết assumption lên whiteboard, hỏi interviewer confirm trước khi tính |
| **Ghi đơn vị** | "5" là 5 KB hay 5 MB? Luôn viết đầy đủ đơn vị để tránh nhầm lẫn |
| **Luyện tập trước** | Các con số hay hỏi: QPS, peak QPS, storage, cache, số servers |

---

## Cheat Sheet — Số hay dùng trong phỏng vấn

```
1 ngày          = 86,400 giây  ≈ 100,000 giây (để tính nhanh)
1 tháng         = 30 ngày
1 năm           = 365 ngày

1 ảnh JPEG      ≈ 1 MB
1 video 720p/ph ≈ 50 MB
1 tweet text    ≈ 200 bytes
1 user record   ≈ 1 KB

Web server      ≈ 1,000 QPS
DB server       ≈ 1,000 QPS (read), ~500 QPS (write)
Cache server    ≈ 100,000+ QPS (Redis)

"Three nines"   = 99.9% = 8.77 giờ downtime/năm
"Four nines"    = 99.99% = 52.6 phút downtime/năm
```
