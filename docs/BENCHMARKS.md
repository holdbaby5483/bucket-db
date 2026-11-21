# Benchmarks

Produced by `packages/core/bench/run.ts` (`bun packages/core/bench/run.ts <fs|s3|oss> [sizes]`). Rerun it to check these numbers on your own bucket.

Setup (2026-11-21): BucketDB 0.4.0, Bun 1.4.2, macOS arm64 client. Documents of about 450 bytes. A query reads at most 16 documents in parallel. Every query is `find({ n: { $lt: 10 } })`; the filter does not change the cost, which is the same for any filter except `{ id }`.

Measured single-request latency from the client: OSS about 45 ms, S3 (`ap-southeast-2`) about 200 ms. Remote numbers are dominated by that round-trip time, so expect proportionally different numbers from a client closer to or further from the bucket.

Columns: `requests` is the number of storage requests per operation; `ms` the mean wall time.

- **find, no snapshot**: the first query after the snapshot is missing or unusable. It reads every document.
- **find, current snapshot**: the usual query. It lists the collection and reads the snapshot.
- **find after N updates**: N documents changed since the snapshot was written. Up to 16 changed documents are read individually and the snapshot is left alone ("next find" pays the same again). More than 16 make the query rewrite the snapshot, and the next query is back to the usual cost.
- **compact**: rebuilds the snapshot from every document.

## Alibaba Cloud OSS

| documents | operation | requests | ms | note |
|---:|---|---:|---:|---|
| 100 | insert | 1 | 47 |  |
| 100 | findById | 1 | 44 |  |
| 100 | find, no snapshot | 108 | 545 |  |
| 100 | find, current snapshot | 2 | 114 |  |
| 100 | find after 10 updates | 12 | 176 |  |
| 100 | next find | 12 | 192 |  |
| 100 | compact | 107 | 500 | snapshot 55 kB |
| 1000 | insert | 1 | 51 |  |
| 1000 | findById | 1 | 46 |  |
| 1000 | find, no snapshot | 1009 | 3506 |  |
| 1000 | find, current snapshot | 3 | 266 |  |
| 1000 | find after 10 updates | 13 | 391 |  |
| 1000 | next find | 13 | 372 |  |
| 1000 | find after 100 updates | 104 | 778 |  |
| 1000 | next find | 3 | 348 |  |
| 1000 | compact | 1008 | 3415 | snapshot 524 kB |
| 10000 | insert | 1 | 51 |  |
| 10000 | findById | 1 | 44 |  |
| 10000 | find, no snapshot | 10018 | 33668 |  |
| 10000 | find, current snapshot | 12 | 1353 |  |
| 10000 | find after 10 updates | 22 | 1515 |  |
| 10000 | next find | 22 | 1321 |  |
| 10000 | find after 100 updates | 113 | 2358 |  |
| 10000 | next find | 12 | 1504 |  |
| 10000 | compact | 10017 | 34788 | snapshot 5235 kB |

## AWS S3 (ap-southeast-2)

| documents | operation | requests | ms | note |
|---:|---|---:|---:|---|
| 100 | insert | 1 | 198 |  |
| 100 | findById | 1 | 197 |  |
| 100 | find, no snapshot | 108 | 2203 |  |
| 100 | find, current snapshot | 2 | 447 |  |
| 100 | find after 10 updates | 12 | 707 |  |
| 100 | next find | 12 | 692 |  |
| 100 | compact | 107 | 2019 | snapshot 55 kB |
| 1000 | insert | 1 | 196 |  |
| 1000 | findById | 1 | 196 |  |
| 1000 | find, no snapshot | 1009 | 14220 |  |
| 1000 | find, current snapshot | 3 | 992 |  |
| 1000 | find after 10 updates | 13 | 1284 |  |
| 1000 | next find | 13 | 1298 |  |
| 1000 | find after 100 updates | 104 | 3356 |  |
| 1000 | next find | 3 | 1178 |  |
| 1000 | compact | 1008 | 13720 | snapshot 524 kB |
| 10000 | insert | 1 | 195 |  |
| 10000 | findById | 1 | 210 |  |
| 10000 | find, no snapshot | 10018 | 133963 |  |
| 10000 | find, current snapshot | 12 | 3211 |  |
| 10000 | find after 10 updates | 22 | 3113 |  |
| 10000 | next find | 22 | 4091 |  |
| 10000 | find after 100 updates | 113 | 8695 |  |
| 10000 | next find | 12 | 3827 |  |
| 10000 | compact | 10017 | 134067 | snapshot 5235 kB |

## FileSystem (local SSD)

Local backends keep no snapshot; every query reads every file.

| documents | operation | requests | ms | note |
|---:|---|---:|---:|---|
| 100 | insert | 1 | 1 |  |
| 100 | findById | 1 | 0 |  |
| 100 | find, no snapshot | 106 | 5 |  |
| 100 | find, current snapshot | 106 | 5 |  |
| 100 | find after 10 updates | 106 | 5 |  |
| 100 | next find | 106 | 3 |  |
| 100 | compact | 0 | 0 | no snapshot on local backends |
| 1000 | insert | 1 | 1 |  |
| 1000 | findById | 1 | 0 |  |
| 1000 | find, no snapshot | 1007 | 49 |  |
| 1000 | find, current snapshot | 1007 | 40 |  |
| 1000 | find after 10 updates | 1007 | 34 |  |
| 1000 | next find | 1007 | 38 |  |
| 1000 | find after 100 updates | 1007 | 36 |  |
| 1000 | next find | 1007 | 37 |  |
| 1000 | compact | 0 | 0 | no snapshot on local backends |
| 10000 | insert | 1 | 1 |  |
| 10000 | findById | 1 | 0 |  |
| 10000 | find, no snapshot | 10016 | 511 |  |
| 10000 | find, current snapshot | 10016 | 438 |  |
| 10000 | find after 10 updates | 10016 | 502 |  |
| 10000 | next find | 10016 | 464 |  |
| 10000 | find after 100 updates | 10016 | 472 |  |
| 10000 | next find | 10016 | 513 |  |
| 10000 | compact | 0 | 0 | no snapshot on local backends |

## What this means

- **Envelope.** At 10,000 documents (a 5 MB snapshot) a usual query takes 1.3 s on OSS and 3.2 s on S3, and the rebuild after a lost snapshot takes 34 s and 134 s. BucketDB therefore documents at most 10,000 documents and 10 MB per collection, and logs a warning once when a collection goes past either.
- **Query latency** is about one round trip per 1,000 documents listed plus the snapshot download. Hundreds of milliseconds holds up to roughly 1,000 documents with a nearby bucket.
- **Rewrite threshold.** 16: changed documents up to that cost one extra parallel round of GETs per query; beyond it, one snapshot upload brings queries back to the usual cost.
- **Writes** (`insert`, `update`, `delete`) and `findById` are one request each (`update` two), so their latency is one or two round trips at any collection size.
