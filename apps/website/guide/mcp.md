# MCP 集成

BucketDB 提供 MCP（Model Context Protocol）服务器（`@hold-baby/bucket-db-mcp` 0.2.0），让 AI 工具（Claude Desktop、Cursor、Cline 等）能直接通过自然语言对任意 collection 进行增删改查。

## 安装

MCP 服务器包是私有的，**没有发布到 npm**，需要从仓库克隆后构建：

```bash
git clone https://github.com/holdbaby5483/bucket-db.git
cd bucket-db
bun install
bun run --cwd packages/core build
bun run --cwd apps/mcp build
```

构建后用 Node 运行（命令名为 `bucket-db-mcp`）：

```bash
BUCKET_DB_URL=file:///path/to/data node /path/to/bucket-db/apps/mcp/dist/index.js
```

## 配置

服务器只通过一个环境变量 `BUCKET_DB_URL` 配置，URL 格式与 `BucketDB.connect()` 相同（见[安装指南 - 连接字符串](/guide/installation#连接字符串)）。凭证来自标准环境变量，不能写在 URL 里：

| 后端 | URL | 凭证 |
|------|-----|------|
| 文件系统 | `file:///absolute/dir` | — |
| AWS S3（及 S3 兼容服务） | `s3://bucket/prefix?region=us-east-1` | `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` |
| 阿里云 OSS | `oss://bucket/prefix?region=cn-hangzhou` | `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` / `OSS_SESSION_TOKEN`，其次 `ALIBABA_CLOUD_ACCESS_KEY_ID` / `ALIBABA_CLOUD_ACCESS_KEY_SECRET` / `ALIBABA_CLOUD_SECURITY_TOKEN` |

- URL 的路径部分（`prefix`）就是 `dbPath`。
- 省略 `region` / `endpoint` 时回退到 `AWS_REGION`、`AWS_ENDPOINT_URL_S3` 或 `OSS_REGION` 等环境变量。
- 没有设置 `BUCKET_DB_URL` 时，服务器在 stderr 输出说明后退出。日志警告也写到 stderr。

### 文件系统（本地开发）

```bash
BUCKET_DB_URL=file:///path/to/data \
node /path/to/bucket-db/apps/mcp/dist/index.js
```

### AWS S3

```bash
BUCKET_DB_URL='s3://my-bucket/my-app?region=us-east-1' \
AWS_ACCESS_KEY_ID=AKIAxxx \
AWS_SECRET_ACCESS_KEY=xxx \
node /path/to/bucket-db/apps/mcp/dist/index.js
```

### 阿里云 OSS

```bash
BUCKET_DB_URL='oss://my-bucket/my-app?region=cn-hangzhou' \
OSS_ACCESS_KEY_ID=xxx \
OSS_ACCESS_KEY_SECRET=xxx \
node /path/to/bucket-db/apps/mcp/dist/index.js
```

## 配置 Claude Desktop

编辑 `~/Library/Application Support/Claude/claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "bucket-db": {
      "command": "node",
      "args": ["/path/to/bucket-db/apps/mcp/dist/index.js"],
      "env": {
        "BUCKET_DB_URL": "file:///path/to/data"
      }
    }
  }
}
```

重启 Claude Desktop 后即可使用。使用 S3/OSS 时，把 URL 换成 `s3://…` / `oss://…`，并在 `env` 中加入对应的凭证变量。

## 配置 Cursor

在项目根目录创建 `.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "bucket-db": {
      "command": "node",
      "args": ["/path/to/bucket-db/apps/mcp/dist/index.js"],
      "env": {
        "BUCKET_DB_URL": "file:///path/to/data"
      }
    }
  }
}
```

## 可用工具

MCP 服务器提供 7 个工具。出错时以工具错误（`isError`）返回错误信息。

### `db_insert`

向 collection 插入一条文档。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `collection` | string | ✅ | Collection 名称 |
| `data` | object | ✅ | 文档内容 |
| `id` | string | | 指定文档 ID；该 ID 已存在时返回错误 |

返回包含系统字段（`id`、`_etag`、`_createdAt`、`_updatedAt`）的完整文档。

### `db_put`

按 ID 创建或替换整个文档，重复调用结果相同（幂等）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `collection` | string | ✅ | Collection 名称 |
| `id` | string | ✅ | 文档 ID |
| `data` | object | ✅ | 完整的文档内容 |

### `db_find_by_id`

按 ID 查找单条文档，不存在时返回错误（`Document not found: <id>`）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `collection` | string | ✅ | Collection 名称 |
| `id` | string | ✅ | 文档 ID |

### `db_find`

查询 collection 中的文档列表，支持过滤、排序和分页。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `collection` | string | ✅ | Collection 名称 |
| `filter` | object | | 查询条件，留空返回所有文档 |
| `limit` | number | | 最多返回条数（≥ 0 的整数；0 返回空数组） |
| `offset` | number | | 跳过条数（≥ 0 的整数） |
| `sort` | object | | 字段 → `1`（升序）/ `-1`（降序）；默认按 `_createdAt`、再按 `id` 升序 |

### `db_count`

返回匹配的文档数（以文本形式）。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `collection` | string | ✅ | Collection 名称 |
| `filter` | object | | 查询条件，留空统计全部文档 |

### `db_update`

按 ID 更新文档，支持乐观锁。文档不存在或 `etag` 冲突时返回错误。

不传 `etag` 时，在 S3 和 FileSystem（单进程）上冲突会自动重新读取并重试；在 OSS 上后写覆盖。在 OSS 上传 `etag` 会返回 `UnsupportedError`。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `collection` | string | ✅ | Collection 名称 |
| `id` | string | ✅ | 文档 ID |
| `data` | object | ✅ | 要更新的字段 |
| `etag` | string | | ETag，用于乐观并发控制 |

### `db_delete`

按 ID 删除文档。删除不存在的文档同样返回成功。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `collection` | string | ✅ | Collection 名称 |
| `id` | string | ✅ | 文档 ID |

## 从 0.1 配置迁移

0.2.0 移除了 `BUCKET_DB_ADAPTER`、`BUCKET_DB_PATH`、`BUCKET_DB_FS_BASE_PATH`、`BUCKET_DB_S3_*`、`BUCKET_DB_OSS_*`，改为 `BUCKET_DB_URL`：

| 旧配置 | 新配置 |
|--------|--------|
| `BUCKET_DB_ADAPTER=fs BUCKET_DB_FS_BASE_PATH=/data BUCKET_DB_PATH=app` | `BUCKET_DB_URL=file:///data/app` |
| `BUCKET_DB_ADAPTER=s3 BUCKET_DB_S3_BUCKET=b BUCKET_DB_S3_REGION=r BUCKET_DB_PATH=app` | `BUCKET_DB_URL=s3://b/app?region=r`，密钥放在 `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` |
| `BUCKET_DB_ADAPTER=oss BUCKET_DB_OSS_BUCKET=b BUCKET_DB_OSS_REGION=cn-hangzhou BUCKET_DB_PATH=app` | `BUCKET_DB_URL=oss://b/app?region=cn-hangzhou`，密钥放在 `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET` |

::: warning 旧的默认 dbPath
0.1 中 `BUCKET_DB_PATH` 的默认值是 `default`。如果之前没有设置它，要继续读取原来的数据，请在 URL 中使用 `default` 作为前缀，例如 `s3://b/default?region=r`；文件系统上 0.1 把数据存在 `<basePath>/default/…`，因此 `BUCKET_DB_FS_BASE_PATH=/data` 对应 `file:///data/default`。
:::

## 并发与保证

MCP 服务器直接使用 BucketDB，保证与所选后端一致：

| | Memory | FileSystem | S3 | OSS |
|---|---|---|---|---|
| 单次写入原子 | 是 | 是 | 是 | 是 |
| 不存在才创建（`insert`） | 是 | 是（跨进程） | 是 | 是（仅限未开启版本控制的 bucket） |
| 条件更新（`etag`） | 是 | 仅单进程 | 是 | 否，抛 `UnsupportedError` |
| 并发局部更新全部生效 | 是 | 仅单进程 | 是 | 否（后写覆盖） |

多个进程（例如 MCP 服务器与你的应用）可以同时对同一集合执行 `insert` / `put` / `delete`；S3 上 `update` 也可以并发。不要让 0.3.x 客户端与 0.4 及以后的版本同时写同一集合，见[升级指南](/guide/migration)。

`db_find` 和带条件的 `db_count` 在 S3/OSS 上使用集合的查询快照（LIST + 1 次快照 GET + 变化的文档），在 FileSystem/Memory 上读取每个文件；不带条件的 `db_count` 只 LIST；`{ "id": "..." }` 过滤在所有后端上只读取一个文档。每个集合的容量范围为 10,000 个文档、10 MB 快照，见[保证与限制](/guide/guarantees)。

## 使用示例

配置完成后，你可以直接用自然语言操作数据库：

> "帮我在 users collection 里插入一条记录，name 是 Alice，age 是 30"

> "查询 orders collection 里 status 为 pending 的所有订单，按创建时间倒序"

> "统计 users collection 里有多少条记录"

> "把 id 为 abc123 的用户的 email 更新为 alice@example.com"

## 相关链接

- [安装指南 - 连接字符串](/guide/installation#连接字符串) - URL 格式与凭证
- [命令行](/guide/cli) - 在终端或 CI 中用同样的 URL 读写数据
- [存储适配器](/api/adapters) - 了解各适配器的配置细节
- [错误处理](/guide/error-handling) - 了解可能的错误类型
- [MCP 协议文档](https://modelcontextprotocol.io) - Model Context Protocol 官方文档
