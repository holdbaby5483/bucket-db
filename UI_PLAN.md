# 查询界面设计（`@hold-baby/bucket-db-ui`）

状态：**待审阅，未开工。** 2026-11-22。
标注：**你定的** = 用户在对话中确认；**我定的** = 我替用户做的选择，可以改；**待验证** = 开工后先验证。

## 1. 要解决的问题

用户想用界面查看库里的数据，而不是在命令行里拼 `find` 和 `jq`。目标用户是开发者本人，在自己的电脑上看自己有凭证的 bucket 或目录。

**你定的：** 本地运行一条命令，浏览器打开页面；左侧集合列表，右侧表格；筛选、排序、翻页，点开看完整 JSON；只看不改。

## 2. 调研：成熟产品怎么做

来源均为官方文档、官方仓库或官方安全公告（2026-11-22 查阅）。

| 维度 | 做法 | 来源 |
|---|---|---|
| 启动方式 | Prisma Studio：`prisma studio` 启动本地 Web 服务，默认端口 5555，`--port`、`--browser none`、`--url` | [Prisma CLI reference](https://www.prisma.io/docs/orm/v7/reference/prisma-cli-reference#studio) |
| | Datasette：默认只监听 `127.0.0.1:8001`，`-o` 打开浏览器，`-p 0` 自动选空闲端口 | [Datasette CLI reference](https://docs.datasette.io/en/stable/cli-reference.html) |
| | Drizzle Studio：本地服务在 `127.0.0.1:4983`，页面托管在 `local.drizzle.studio`，闭源，“not meant to be used on remote” | [drizzle-kit studio](https://orm.drizzle.team/docs/drizzle-kit-studio) |
| 放在哪个包 | 界面都在工具包里，不在运行时库里：`prisma` 对 `@prisma/client`，`drizzle-kit` 对 ORM，Firebase CLI 对客户端 SDK | [Drizzle Kit overview](https://orm.drizzle.team/docs/kit-overview)、[Firebase Emulator Suite](https://firebase.google.com/docs/emulator-suite/install_and_configure) |
| 浏览文档 | MongoDB Compass：List / JSON / Table 三种视图，每页 25 条（可选 25/50/75/100） | [Compass: View Documents](https://www.mongodb.com/docs/compass/documents/view) |
| | Compass 的筛选框直接写数据库自己的查询语法；保留最近 30 条查询 | [Compass: Query](https://www.mongodb.com/docs/compass/query/filter)、[Recent queries](https://www.mongodb.com/docs/compass/query/recent) |
| 列出集合 | S3 `ListObjectsV2` 带 `delimiter` 时，同一“目录”下的 key 合并成一条 `CommonPrefixes`，不必列出每个 key | [S3 ListObjectsV2](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html) |
| | Firestore 的 `listCollections()` 只在服务端库里有，Web / 移动端 SDK 没有 | [Firestore: list subcollections](https://firebase.google.com/docs/firestore/query-data/get-data#list_subcollections_of_a_document) |
| 读取成本 | DynamoDB Scan 不管有没有过滤条件都消耗同样的读取量，文档里明说 | [DynamoDB Scan](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Scan.html) |
| 只读 | Datasette 默认只读。Compass 的 `readOnly` 和 mongo-express 的只读选项只是隐藏写入按钮，真正的限制要靠数据库权限 | [Datasette SQL queries](https://docs.datasette.io/en/stable/sql_queries.html)、[Compass read-only](https://www.mongodb.com/docs/compass/settings/read-only) |
| | Prisma Studio 没有只读模式，维护者建议用只读数据库账号 | [prisma/studio#626](https://github.com/prisma/studio/issues/626) |
| 本地服务的安全 | Jupyter Server：默认启用令牌，令牌在启动 URL 里；`Host` 不是本机时返回 403（防 DNS rebinding）；校验 `Origin` | [Jupyter Server security](https://jupyter-server.readthedocs.io/en/latest/operators/security.html)、[config](https://jupyter-server.readthedocs.io/en/latest/other/full-config.html) |
| | Vite CVE-2025-24010：只在本机运行的开发服务器，响应也能被任意网站读到（CORS `*`、不校验 `Host`）。修复后默认只应答 localhost 和 IP | [GHSA-vg6x-rcgg-rjx6](https://github.com/vitejs/vite/security/advisories/GHSA-vg6x-rcgg-rjx6) |
| | MCP 规范：本地 HTTP 服务“MUST validate the Origin header”，“SHOULD bind only to localhost” | [MCP transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports#security-warning) |
| | mongo-express：CVE-2019-10758 远程代码执行，已被实际利用；README 写明只应在开发环境私下使用 | [GHSA-h47j-hc6x-h3qq](https://github.com/advisories/GHSA-h47j-hc6x-h3qq) |
| | GitHub Security Lab：敏感接口都要认证；DNS rebinding 带不了 cookie；校验 `Host` 和 `Origin` | [Localhost dangers](https://github.blog/security/application-security/localhost-dangers-cors-and-dns-rebinding/) |
| 状态在 URL 里 | Datasette：每个查询、筛选、排序、翻页都反映在 URL 里，可以收藏、分享、用浏览器后退 | [Datasette SQL queries](https://docs.datasette.io/en/stable/sql_queries.html) |

未能在官方来源确认的：Prisma Studio 和 Drizzle Studio 的本地服务是否校验 `Host` / `Origin`。

## 3. 对第一版方案的审查

第一版方案是 2026-11-22 在对话里提出的。对照调研和代码，问题如下：

| # | 问题 | 依据 | 修正 |
|---|---|---|---|
| 1 | **没有任何安全设计。** 只写了“只监听本机”。这个进程持有云凭证，任何网页都可能通过 DNS rebinding 读到它返回的数据 | Vite CVE-2025-24010、GitHub Security Lab | 见 §5.4：启动令牌 + `Host` 校验 + `Origin` 校验 |
| 2 | **“只读”说得不准确。** 界面不改文档，但在 S3 / OSS 上，一次 `find` 需要单独读取的文档超过 16 条时会重写查询快照，这是一次对 bucket 的写入 | `packages/core/src/collection.ts`：判断在第 288–289 行（仅 `adapter.remote` 为真时），写入在 `writeSnapshot`（第 211 行起） | 文档和界面写明“不修改文档”；要 bucket 级别的只读，用只读凭证（快照写入遇到 401 / 403 后，该集合实例不再尝试）。这与 Compass、Prisma 的做法一致：只读靠权限保证 |
| 3 | **集合列表的成本说轻了。** S3 的翻页游标是不透明令牌，不能跳着扫；全量扫描的请求数等于 ⌈全库 key 数 / 1000⌉，且只能串行 | `storage/s3/client.ts` 第 158 行用的是 `continuation-token` | 见 §5.3：渐进显示、会话内缓存、随时可以手动输入集合名。正确的长期做法是给存储接口加 `delimiter`，记为 1.0 之后的候选 |
| 4 | **导出 `openUrl` 不是最小的改动。** 它给 1.0 的公开 API 多加一个函数名 | — | 改为把 `BucketDB` 上已有的 `adapter` 和 `dbPath` 从 `private readonly` 改成 `readonly`：核心包源码行数不变（见 §6） |
| 5 | **每次翻页、排序都重新查询。** 核心库的 `find` 每次都列出整个集合；1 万条时在 S3 上约 3.2 秒，翻一页等 3 秒不可用 | `docs/BENCHMARKS.md` | 服务端缓存最近一次查询的完整结果，翻页从缓存取；界面显示数据的读取时间，并提供刷新 |
| 6 | **状态不在 URL 里。** 刷新页面会丢失当前的集合和筛选条件，后退键不起作用 | Datasette | 集合、筛选、排序、页码写进 URL 的 hash |
| 7 | **没有查询历史。** 手写 JSON 条件，写错了要重打 | Compass 保留最近 30 条 | 每个集合在浏览器本地保留最近 20 条筛选条件 |
| 8 | **没说怎么验证、怎么发布、文档改哪些。** | — | 见 §7、§8 |
| 9 | **直接推到 `main` 会影响 Dogfood 计数。** Dogfood 在推送到 `main`、定时和手动触发时运行；今天已经因为一次锁文件问题重置过计数 | `.github/workflows/dogfood.yml` | 在分支上开发，通过 PR 合并。Test 工作流会先在 PR 上跑一遍（包括冻结锁文件安装），合并时那一次 Dogfood 才有保障 |
| 10 | **库在 bucket 根目录时，扫描会列出整个 bucket。** `s3://bucket` 不带前缀时 `dbPath` 为空，扫描范围包括与 BucketDB 无关的对象 | `packages/core/src/url.ts` | 见 §5.3：扫描设上限，超过后停下并提示 |

第一版里保留不变的：独立的包、Node 内置 HTTP 服务加静态页面、筛选语法沿用命令行的 JSON、每页固定条数、不做编辑。这些都与调研到的通行做法一致。

## 4. 选定的参照

没有一款产品可以整体照搬，按维度取：

- **整体形态照 Datasette：** 本地命令启动、只监听回环地址、默认只读、状态在 URL 里。它和本项目的定位最接近（把一份现成的数据变成可浏览的页面，不做管理后台）。
- **文档浏览照 Compass：** 筛选框写数据库自己的查询语法，固定页大小，保留最近的查询。
- **安全照 Jupyter Server：** 启动令牌、`Host` 校验、`Origin` 校验三层都要。
- **分包照 Prisma / Drizzle：** 界面放在工具包里，运行时库保持小。

不照搬的：Drizzle Studio 把页面托管在自己的域名上（多一个外部依赖，且闭源）；mongo-express 的默认口令和“可执行任意命令”的高级搜索。

## 5. 方案

### 5.1 使用方式

```bash
export BUCKET_DB_URL='s3://my-bucket/ci-data?region=us-east-1'   # 凭证照常来自 AWS_* / OSS_* 环境变量
npx @hold-baby/bucket-db-ui
# bucket-db-ui: http://127.0.0.1:7340/?token=…  (Ctrl+C to stop)
```

| 选项 | 默认 | 说明 |
|---|---|---|
| `--url <url>` | `BUCKET_DB_URL` | 与核心库、CLI 相同的连接串 |
| `--port <n>` | `7340` | 端口被占用时报错并提示换端口；`0` 表示自动选空闲端口 |
| `--no-open` | 自动打开浏览器 | 只打印地址 |

没有 `--host`：只监听 `127.0.0.1`，这是设计，不是遗漏。

### 5.2 页面

三栏：左侧集合，中间筛选框和表格，右侧文档详情。

```
+----------------------------------------------------------------------------+
| bucket-db   s3://my-bucket/ci-data                    不修改文档   [刷新]   |
+-------------+-----------------------------------------+--------------------+
| 集合         | [ {"ok":true,"ms":{"$lt":2000}}  ] [查询] | run-4412    [复制] |
| > runs 1,284| 匹配 318 条 · 用时 1.2 s · 读取于 12:39:05 | {                  |
|   deploys 37| id        sha      ms v  ok   _createdAt |   "id": "run-4412",|
|   flaky  212| run-4412  be91ab3  1987  true 11-22 04:15|   "sha": "be91ab3",|
|             | run-4398  8601606  1820  true 11-22 04:09|   "ms": 1987,      |
| [输入集合名] | ...                                     |   "ok": true,      |
|             | 第 1–50 条，共 318 条     [上一页] [下一页] | }                  |
+-------------+-----------------------------------------+--------------------+
```

- **集合栏：** 集合名和文档数，按名称排序；一个输入框可以直接输入集合名打开（扫描未完成或集合为空时也能用）。
- **筛选框：** 与 `bucket-db find` 相同的 JSON 条件，例如 `{"ok":true,"ms":{"$lt":2000}}`。留空表示全部。条件不合法时在框下显示错误信息，不发起存储请求：不是合法 JSON 或不是 JSON 对象的，由界面的服务端自己检查（核心库里做这件事的是 CLI 的私有函数，没有导出）；操作符、字段名等其余问题由 `find` 开头的校验抛出 `ValidationError`。下拉可选该集合最近 20 条条件（存在浏览器 `localStorage`）。
- **表格：**
  - 列取自当前页文档顶层字段的并集；`id` 在最前，`_createdAt`、`_updatedAt` 在最后，`_etag` 不进表格。
  - 嵌套对象和数组显示为单行 JSON，过长截断。缺失的字段留空，与 `null` 区分显示。
  - 点表头排序，再点切换升降序，第三次取消；默认顺序与核心库一致（`_createdAt`，再 `id`）。
  - 每页 50 条，上一页 / 下一页，显示“第 1–50 条，共 318 条”。
- **详情栏：** 点一行显示完整 JSON（含 `_etag`），带缩进，有复制按钮。
- **状态行：** 匹配条数、本次查询用时、数据读取时间、刷新按钮。核心库通过 `logger` 报告的警告（超出 1 万条、快照写入失败）也显示在这里。
- **状态写进 URL hash：** 集合、筛选、排序、页码、选中的文档 ID。刷新、后退、粘贴链接都能回到同一视图。
- **外观：** 跟随系统的明暗主题。界面文字按浏览器语言显示中文或英文（**我定的**）。

### 5.3 列出集合

服务端调用 `db.adapter.list(prefix)` 翻完整个库前缀下的 key，按 `<集合>/docs/<id>.json` 统计出集合名和文档数。只列 key，不读文档内容。

- 成本：⌈全库 key 数 / 1000⌉ 次 LIST，串行。2 万个 key 约 20 次请求。
- 页面打开后立即开始扫描，每拿到一页就更新集合栏，不等扫完。
- **上限：** 扫描到 100 页（10 万个 key）时停下，集合栏标明“列表可能不完整”，提供“继续扫描”按钮。连接串不带前缀（库在 bucket 根目录）时，扫描范围是整个 bucket，这个上限防止在大 bucket 上无休止地列举（**我定的**）。
- 不符合 `<集合>/docs/<id>.json` 形状的 key 一律忽略。
- 结果在本次进程内缓存；“刷新”重新扫描。
- 扫描期间和扫描失败后，手动输入集合名始终可用。
- `_snapshot.v1.json`、0.3 遗留的 `index/` `wal/` 等不计入。

这是折中。正确的做法是存储接口支持 `delimiter`（S3 原生支持），成本会降到“集合数 / 1000”次请求。它需要改四个后端、约 20 行核心代码，而行数余量只有 21 行，所以不在这次做，记入路线图“1.0 之后再议”。

### 5.4 安全

进程持有云凭证，按 Jupyter Server 的做法三层都做：

1. **只监听 `127.0.0.1`。**
2. **启动令牌。** 每次启动生成随机令牌，放在打印和打开的 URL 里。首次访问校验令牌后写入 `HttpOnly`、`SameSite=Strict` 的 cookie 并跳转到不带令牌的地址；之后所有接口都要求这个 cookie。没有 cookie 的请求返回 403。
3. **校验 `Host`：** 必须是 `127.0.0.1:<端口>` 或 `localhost:<端口>`，否则 403。
4. **校验 `Origin`：** 请求带 `Origin` 且不是本服务自己的源时 403。不发送任何 CORS 响应头。
5. **接口只有 GET，没有任何写入文档的接口。** 界面不能改数据不是靠隐藏按钮，而是服务端没有这个能力。

页面不加载任何外部资源（字体、脚本、统计），文档内容一律按文本渲染，不当作 HTML。

连接串本身不含凭证（核心库拒绝带凭证的 URL），可以显示在页面上。

### 5.5 查询与缓存

- 一次查询 = 服务端调用 `collection.find(filter, { sort })`，不带 `limit`，拿到全部匹配结果后自己切页。这样匹配总数和当前页来自同一次读取。
- 服务端只缓存**最近一次**查询（集合 + 筛选 + 排序）的完整结果。翻页、选中文档从缓存取；换集合、换条件、换排序或点刷新时重新查询。
- 页面始终显示这份数据是什么时候读取的。
- 内存占用以包络为界：一个集合最多 1 万条、10 MB。

### 5.6 技术

- 位置：`packages/ui`（要发布到 npm 的包放在 `packages/`；**我定的**）。
- 服务端：TypeScript，`node:http`，`tsc` 编译。Node 22+ 和 Bun 都能运行。
- 页面：一个静态 `index.html`，内联 CSS 和原生 JavaScript。不用前端框架，没有构建步骤。
- 运行时依赖：只有 `@hold-baby/bucket-db`。
- `bin`：`bucket-db-ui`。

## 6. 对核心包的改动

只有一处：`BucketDB` 的构造参数 `adapter` 和 `dbPath` 从 `private readonly` 改为 `readonly`。

```typescript
const db = BucketDB.connect();
db.adapter;   // StorageAdapter
db.dbPath;    // string
```

- 源码行数不变（2,049）。
- 属于新增公开 API，发 **0.7.0**；在 `tests/types/public-api.ts` 里固定这两个属性的类型，`docs/API.md` 补说明。
- 1.0 冻结时这两个只读属性一并冻结。
- 路线图里“核心库不提供列举集合”的决定不变：扫描在界面包里做。

## 7. 不做，以及什么算做坏了

**不做：**
- 新建、编辑、删除文档。继续用代码或 CLI。
- 登录、多用户、部署到服务器、`--host`。
- 导出（已有 `bucket-db export`）、图表、聚合、schema 分析。
- 点单元格把值加入筛选条件、可选页大小、List / JSON 多视图。
- 新的查询语法。筛选只有核心库那一套。

**做坏了的标志（即使功能都在）：**
- 核心包因此多了依赖或超了行数。
- 局域网里的其他机器，或者用户正在浏览的某个网页，能读到数据。
- 界面显示的结果与 `bucket-db find` 用同样条件得到的不一致。
- 扫描集合时页面卡住，无法输入集合名。

## 8. 验证、文档与发布

**测试（`packages/ui/tests`，`bun test`）：**
- 接口：对 `memory://` 和 `file://` 库，集合扫描的名称和数量正确；筛选、排序、翻页的结果与直接调用核心库一致；不合法的条件返回错误信息且不读存储。
- 安全：没有 cookie、`Host` 不对、`Origin` 不对的请求都是 403；令牌换 cookie 的流程；除 GET 外的方法被拒绝。
- CI：`bun test` 自动包含；Node 22 / 24 冒烟里加一步，启动服务、请求一次接口。`biome.json` 的检查范围加上 `packages/ui`。

**人工验证：** 用浏览器打开真实页面，对 `file://` 库和真实 S3 测试桶（只在 `test/` 前缀下）各走一遍：扫描、筛选、排序、翻页、详情、刷新、明暗主题，截图留证。

**文档：** `docs/UI.md`（英文）；文档站 `guide/ui.md`（中文）并加入侧边栏；两个 README 和 `docs/CLI.md` 加链接；`docs/COMPATIBILITY.md` 写明界面包不在 1.0 的兼容承诺内；CHANGELOG；CONTRIBUTING 的目录结构；ROADMAP 的进度和“1.0 之后再议”（加 `delimiter`）。

**发布：**
- 界面包独立版本，从 `0.1.0` 起，tag 形如 `ui-v0.1.0`，单独的发布工作流。
- 首次发布需要用户在浏览器里完成 npm 两步验证；之后配置 trusted publisher（**待验证**：npm 是否允许在包存在之前配置）。
- 顺序：分支上完成核心包改动和界面包 → PR，CI 通过 → 合并 → 发布核心包 0.7.0 → 发布界面包 0.1.0（依赖 `@hold-baby/bucket-db@^0.7.0`）。
- 同一个 PR 里就要把核心包版本号改成 0.7.0：界面包声明依赖 `^0.7.0`，工作区里的核心包版本不匹配时，冻结锁文件安装会失败。

**谁做什么：** 实施、测试、人工验证（用仓库根目录 `.env` 里的测试桶凭证，只写 `test/` 前缀并清理）、合并、打 tag、发布，都由实施者完成。只有 npm 的浏览器两步验证需要用户本人操作。完成的标准是两个包都已发布到 npm，文档站已更新。

## 9. 留给实施者决定的

页面的具体布局和样式、服务端的文件拆分、接口的路径和 JSON 形状、cookie 名、令牌长度、中英文文案。

## 10. 需要用户确认的

1. 核心包公开 `db.adapter` 和 `db.dbPath`，并发布 0.7.0（§6）。
2. 界面包发布到 npm，包名 `@hold-baby/bucket-db-ui`（需要你做一到两次浏览器两步验证）。
3. 集合列表采用全量扫描的折中，上限 10 万个 key（§5.3）；`delimiter` 留到 1.0 之后。
