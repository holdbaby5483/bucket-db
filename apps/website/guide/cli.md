# 命令行（CLI）

`@hold-baby/bucket-db` 自带命令行工具 `bucket-db`，可以在 shell、脚本和 CI 中直接读写集合，输出 JSON，方便配合 `jq` 使用。

英文参考：[docs/CLI.md](https://github.com/holdbaby5483/bucket-db/blob/main/docs/CLI.md)。

## 安装与运行

需要 Node.js >= 22 或 Bun。

```bash
# 不安装，直接运行
npx @hold-baby/bucket-db <command>

# CI 中加 -y，跳过安装确认
npx -y @hold-baby/bucket-db <command>

# 全局安装后使用 bucket-db 命令
npm i -g @hold-baby/bucket-db
bucket-db <command>
```

## 连接

连接 URL 来自 `--url <url>`，未提供时读取环境变量 `BUCKET_DB_URL`。URL 形式与 `BucketDB.connect()` 相同：

| URL | 后端 |
|---|---|
| `s3://bucket/prefix?region=…&endpoint=…&forcePathStyle=true&timeoutMs=…` | S3 及兼容服务 |
| `oss://bucket/prefix?region=…&endpoint=…&timeoutMs=…` | 阿里云 OSS |
| `file:///absolute/dir` 或 `file://./relative/dir` | 本地文件系统 |

凭证只从环境变量读取，**不能写在 URL 中**（含凭证的 URL 会被拒绝，错误信息也不会回显 URL）：

- S3：`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`，region 缺省时读 `AWS_REGION` / `AWS_DEFAULT_REGION`
- OSS：`OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` / `OSS_SESSION_TOKEN`，否则读 `ALIBABA_CLOUD_ACCESS_KEY_ID` / `ALIBABA_CLOUD_ACCESS_KEY_SECRET` / `ALIBABA_CLOUD_SECURITY_TOKEN`

```bash
export BUCKET_DB_URL='s3://my-bucket/app?region=us-east-1'
bucket-db count users

bucket-db count users --url 'oss://my-bucket/app?region=cn-hangzhou'
```

`endpoint` 参数的值需要 URL 编码，例如 `endpoint=http%3A%2F%2Flocalhost%3A9000`。

### 代理

命令行通过运行时内置的 `fetch` 访问 S3 / OSS，是否走代理取决于运行时。以下结果是通过一个 CONNECT 代理访问真实 S3 实测的：

- **Bun**（1.4.2）默认遵循 `HTTPS_PROXY`。
- **Node**（22.23.5、24.22.3）默认**忽略** `HTTP_PROXY` / `HTTPS_PROXY`，直接连接（即使配置的代理不可达，请求也会成功）。设置 `NODE_USE_ENV_PROXY=1`（Node 22.21.0+ / 24.0.0+）或使用参数 `--use-env-proxy`（Node 22.21.0+ / 24.5.0+）后请求经过代理。Node 将该功能标记为 "Stability 1.1 – Active development"。

```bash
NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://proxy:3128 npx -y @hold-baby/bucket-db count items
```

Bun 以及设置了 `NODE_USE_ENV_PROXY=1` 的 Node 都遵循 `NO_PROXY`（在 Bun 1.4.2 和 Node 24.22.3 上实测）：完整主机名、带或不带前导点的域名后缀（`.amazonaws.com`、`amazonaws.com`）以及 `*` 都会绕过代理。

## 命令

```
Usage: bucket-db <command> [arguments] [--url <url>]

  get <collection> <id>            print a document (exit 2 if it does not exist)
  put <collection> <id> [json]     create or replace a document; JSON from the argument or stdin
  find <collection> [filter]       print matching documents as a JSON array
       [--sort field[:desc]]... [--limit n] [--offset n]
  count <collection> [filter]      print the number of (matching) documents
  delete <collection> <id>         delete a document (no error if it does not exist)
  export <collection>              print every document as JSON Lines
  import <collection> [file]       write JSON Lines from a file or stdin; documents keep id and timestamps
  compact <collection>             rebuild the query snapshot
  doctor                           check what the storage service guarantees
  ui [--port n] [--no-open]        browse the database in a local web page (default port 7340)
```

### get

```bash
bucket-db get users user-1
```

输出文档（含 `_etag`）。文档不存在时 stdout 为空，stderr 输出 `bucket-db: not found: <id>`，退出码 2。

### put

创建或整体替换 `id` 对应的文档。JSON 来自参数，省略时从 stdin 读取，必须是 JSON 对象。输出写入后的文档。

```bash
bucket-db put users user-1 '{"name":"Alice","age":30}'
echo '{"name":"Bob"}' | bucket-db put users user-2
```

### find

过滤条件是一个 JSON 对象，作为单个参数传入（注意 shell 引号）。输出一个 JSON 数组。

```bash
bucket-db find users '{"status":"active"}' --sort age:desc --limit 10
bucket-db find runs '{"ms":{"$lt":100}}'
```

不传 `--sort` 时默认按 `_createdAt` 升序、再按 `id` 升序。

### count

```bash
bucket-db count users                       # 只列举集合，不读取文档
bucket-db count users '{"status":"active"}' # 与 find 成本相同
```

输出一个数字。

### delete

```bash
bucket-db delete users user-1
```

无输出；文档不存在也视为成功（退出码 0）。

### export

```bash
bucket-db export users > users.jsonl
```

每行输出一个文档（JSON Lines），**不含 `_etag`**，按默认顺序（`_createdAt`，然后 `id`）。

### import

```bash
bucket-db import users users.jsonl
cat users.jsonl | bucket-db import users
```

从文件或 stdin 读取 JSON Lines，输出导入的行数。详见下文 [导出与导入](#导出与导入)。

### compact

```bash
bucket-db compact users
```

重建集合的查询快照，无输出。

### doctor（检查存储服务）

```bash
bucket-db doctor
```

检查存储服务提供的保证，详见下文 [doctor](#doctor)。

### ui（查询界面）

```bash
bucket-db ui
```

在本机启动一个只读的网页并用浏览器打开，用来浏览数据库中的集合和文档（默认端口 7340），选项 `--port n`、`--no-open` 及安全说明详见[查询界面](./ui)。

## 选项

| 选项 | 说明 |
|---|---|
| `--url <url>` | 连接 URL；省略时读 `BUCKET_DB_URL` |
| `--sort field[:asc\|:desc]` | 排序字段，可重复，先出现的优先；默认升序 |
| `--limit n` | 最多返回 n 条 |
| `--offset n` | 跳过前 n 条 |
| `-h`, `--help` | 显示用法，退出码 0 |

选项可以出现在任意位置。不带命令运行时打印用法，退出码 1。

## 输出约定

- stdout 每行一个 JSON 值，便于 `jq` 处理：
  - `get` → 文档（含 `_etag`）；`put` → 写入后的文档
  - `find` → 一个 JSON 数组；`count` → 一个数字
  - `delete`、`compact` → 无输出
  - `export` → 每行一个文档（JSON Lines，不含 `_etag`）
  - `import` → 导入的行数
  - `doctor` → 纯文本行（不是 JSON）
- 错误输出到 stderr，前缀 `bucket-db: `，例如 `bucket-db: document is not valid JSON`。缺少 URL 时错误信息会提示 `BUCKET_DB_URL`。日志警告同样以 `bucket-db: ` 前缀输出到 stderr。

## 退出码

| 退出码 | 含义 |
|---|---|
| `0` | 成功 |
| `1` | 错误（无效 JSON、未知命令、无效名称、缺少 URL、doctor 检查失败等） |
| `2` | 未找到（`get` 的文档不存在） |

## 配合 jq

```bash
# 最近 5 次成功运行中最慢的 id
bucket-db find runs '{"ok":true}' --sort ms:desc --limit 5 | jq -r '.[].id'

# 文档总数
bucket-db count runs

# 在脚本中断言数量
test "$(bucket-db count runs '{"ok":true}')" -eq 3

# 判断文档是否存在
if bucket-db get users user-1 > /dev/null 2>&1; then echo exists; fi
```

## 导出与导入

`export` 与 `import` 组合即可备份、恢复，或在 bucket 之间复制集合：

```bash
# 备份与恢复
bucket-db export users > users.jsonl
bucket-db import users users.jsonl

# 在两个 bucket 之间复制
bucket-db export users --url 's3://bucket-a/app?region=us-east-1' \
  | bucket-db import users --url 'oss://bucket-b/app?region=cn-hangzhou'
```

`import` 的行为：

- 先解析全部行（跳过空行），任何一行不是有效 JSON 都会报错，且**不写入任何内容**
- 带字符串 `id` 的行按存储格式直接写入（`docs/<id>.json`，无条件 PUT），保留 `id`、`_createdAt`、`_updatedAt`，丢弃 `_etag`；**同 id 的已有文档会被覆盖**
- 不带 `id` 的行作为新文档插入，生成新 id
- 16 个并发写入，**不是原子操作**：中途失败时，已写入的文档会保留

## doctor

`doctor` 检查存储服务实际提供的保证。它只写入 `<prefix>/_doctor-<unix 毫秒>/`（URL 没有前缀时为 bucket 根目录下的 `_doctor-<time>/`，`file://` 为 `<dir>/_doctor-<time>/`），结束时删除自己写入的所有内容（文件系统上可能留下空目录）。

每项检查输出一行：

1. `write, read and delete an object`：写入、读取、删除往返，etag 一致
2. `list reflects writes, overwrites and deletes immediately, with matching etags`：列举立即反映写入、覆盖与删除
3. `create-if-absent (declared: <atomic|single-process|none>)`：同一个 key 并发创建 10 次，必须恰好一次成功（后端声明 `none` 时跳过）。失败信息会提到开启了版本控制的 OSS bucket
4. `compare-and-swap (declared: …)`：用同一个 etag 并发条件更新 10 次，必须恰好一次成功，之后过期 etag 必须失败（声明 `none` 时跳过，例如 OSS）

行前缀为 `ok    `、`skip  `（名称: 原因）、`FAIL  `（名称: 原因）。最后一行为 `all checks passed` 或 `<n> check(s) failed`。任何检查失败时退出码为 1；跳过不算失败。

OSS 上的输出示例：

```
ok    write, read and delete an object
ok    list reflects writes, overwrites and deletes immediately, with matching etags
ok    create-if-absent (declared: atomic)
skip  compare-and-swap (declared: none): not supported by this backend; etag updates are refused
all checks passed
```

S3 上四项都是 `ok`，compare-and-swap 显示 `(declared: atomic)`。

## CI 用法

在 CI 中跨运行保存测试耗时、基准结果等数据，参见 [CI 中使用](/guide/ci)。
