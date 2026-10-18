# MiniBoard 📋

Project học **Chương 1 — Scale From Zero To Millions Of Users** (System Design Interview, Alex Xu).

Một bảng tin nhỏ (đăng nhập → đăng tin → xem feed) mà ta **tiến hoá kiến trúc qua từng "mốc đau"**. App logic cố tình giữ nhỏ để spotlight dồn vào kiến trúc.

## Nhật ký tiến hoá

| Mốc | Nội dung | Bài học |
|---|---|---|
| **0** ← đang ở đây | 1 server, data + session trong RAM | Server là gì, request đi qua đâu |
| 1 | Tách PostgreSQL ra container riêng | Tách tầng DB, SQL vs NoSQL |
| 2 | Nhiều instance + nginx load balancer | Scale ngang vs dọc — và session sẽ vỡ! |
| 3 | Session ra Redis | Stateless web tier |
| 4 | Redis cache cho feed | Caching, cache-aside, TTL |
| 5 | Postgres primary + read replica | Database replication |
| 6 | Message queue + logging/metrics | Decoupling, observability, sharding |

## Chạy Mốc 0

```bash
npm install
npm run dev        # chạy ở http://localhost:8080
```

Thử bằng curl (giữ cookie để có session):

```bash
curl -s -XPOST localhost:8080/register -H 'content-type: application/json' -d '{"username":"alex","password":"123"}'
curl -s -XPOST localhost:8080/login    -H 'content-type: application/json' -d '{"username":"alex","password":"123"}' -c cookies.txt
curl -s -XPOST localhost:8080/messages -H 'content-type: application/json' -d '{"text":"Xin chao MiniBoard"}' -b cookies.txt
curl -s localhost:8080/feed
```
