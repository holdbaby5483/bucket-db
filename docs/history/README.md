# History

Planning and review documents that shaped BucketDB, kept for the record. They describe the project at the time they were written and are not maintained; the current documentation is in [docs/](..) and on https://bucket-db.pages.dev.

| Document | Written for | Outcome |
|---|---|---|
| [REPOSITORY_EVALUATION.md](REPOSITORY_EVALUATION.md) | An outside review of 0.3.1 | Input to the synthesis below |
| [REPOSITORY_EVALUATION_SYNTHESIS.md](REPOSITORY_EVALUATION_SYNTHESIS.md) | Checked findings on 0.3.1, with fault and concurrency probes | Became [ROADMAP.md](../../ROADMAP.md) |
| [M1A_PLAN.md](M1A_PLAN.md) | The storage-core rewrite | Shipped in 0.4 (published as 0.5.0); its test case IDs (A1–D18) are still the test name prefixes |
| [API_REVIEW_1.0.md](API_REVIEW_1.0.md) | Public API review before the 1.0 freeze | A1–A4 shipped in 0.6.0 |
| [UI_PLAN.md](UI_PLAN.md) | The query UI: prior art (Datasette, Compass, Jupyter, Prisma / Drizzle Studio), a review of the first proposal, and the design | Shipped in 0.7.0 as `bucket-db ui`, inside the core package rather than as a separate one |

The documents are in Chinese.
