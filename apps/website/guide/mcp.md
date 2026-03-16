# MCP 集成

BucketDB 提供官方 MCP（Model Context Protocol）服务器，让 AI 工具（Claude Desktop、Cursor、Cline 等）能直接通过自然语言对任意 collection 进行 CRUD 操作。

## 安装

```bash
bun add @hold-baby/bucket-db-mcp
```

或使用 npx 直接运行（无需安装）：

```bash
npx @hold-baby/bucket-db-mcp
```

## 快速上手

### 文件系统（本地开发）

```bash
BUCKET_DB_ADAPTER=fs \
BUCKET_DB_FS_BASE_PATH=./data \
npx @hold-baby/bucket-db-mcp
```

### AWS S3

```bash
BUCKET_DB_ADAPTER=s3 \
BUCKET_DB_S3_BUCKET=my-bucket \
BUCKET_DB_S3_REGION=us-east-1 \
BUCKET_DB_S3_ACCESS_KEY_ID=AKIAxxx \
BUCKET_DB_S3_SECRET_ACCESS_KEY=xxx \
npx @hold-baby/bucket-db-mcp
```

### 阿里云 OSS

```bash
BUCKET_DB_ADAPTER=oss \
BUCKET_DB_OSS_BUCKET=my-bucket \
BUCKET_DB_OSS_REGION=oss-cn-hangzhou \
BUCKET_DB_OSS_ACCESS_KEY_ID=xxx \
BUCKET_DB_OSS_SECRET_ACCESS_KEY=xxx \
npx @hold-baby/bucket-db-mcp
```

## 环境变量

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `BUCKET_DB_ADAPTER` | ✅ | — | 存储后端：`fs` / `s3` / `oss` |
| `BUCKET_DB_PATH` | | `default` | 数据库路径（类似数据库名） |
| `BUCKET_DB_FS_BASE_PATH` | fs 必填 | — | 本地目录路径 |
| `BUCKET_DB_S3_BUCKET` | s3 必填 | — | S3 Bucket 名称 |
| `BUCKET_DB_S3_REGION` | s3 必填 | — | S3 区域 |
| `BUCKET_DB_S3_ACCESS_KEY_ID` | s3 必填 | — | AWS Access Key ID |
| `BUCKET_DB_S3_SECRET_ACCESS_KEY` | s3 必填 | — | AWS Secret Access Key |
| `BUCKET_DB_OSS_BUCKET` | oss 必填 | — | OSS Bucket 名称 |
| `BUCKET_DB_OSS_REGION` | oss 必填 | — | OSS 区域 |
| `BUCKET_DB_OSS_ACCESS_KEY_ID` | oss 必填 | — | OSS Access Key ID |
| `BUCKET_DB_OSS_SECRET_ACCESS_KEY` | oss 必填 | — | OSS Secret Access Key |

## 配置 Claude Desktop

编辑 `~/Library/Application Support/Claude/claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "bucket-db": {
      "command": "npx",
      "args": ["@hold-baby/bucket-db-mcp"],
      "env": {
        "BUCKET_DB_ADAPTER": "fs",
        "BUCKET_DB_FS_BASE_PATH": "/path/to/your/data"
      }
    }
  }
}
```

重启 Claude Desktop 后即可使用。

## 配置 Cursor

在项目根目录创建 `.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "bucket-db": {
      "command": "npx",
      "args": ["@hold-baby/bucket-db-mcp"],
      "env": {
        "BUCKET_DB_ADAPTER": "fs",
        "BUCKET_DB_FS_BASE_PATH": "./data"
      }
    }
  }
}
```

## 可用工具

MCP 服务器提供 5 个工具，AI 可以直接调用：

### `db_insert`

向 collection 插入一条文档。

| 参数 | 类型 | 说明 |
|------|------|------|
| `collection` | string | Collection 名称 |
| `data` | object | 文档内容 |

返回包含系统字段（`id`、`_etag`、`_createdAt`、`_updatedAt`）的完整文档。

### `db_find_by_id`

按 ID 查找单条文档，不存在时返回错误。

| 参数 | 类型 | 说明 |
|------|------|------|
| `collection` | string | Collection 名称 |
| `id` | string | 文档 ID |

### `db_find`

查询 collection 中的文档列表，支持过滤和分页。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `collection` | string | ✅ | Collection 名称 |
| `filter` | object | | 查询条件，留空返回所有文档 |
| `limit` | number | | 最多返回条数 |
| `offset` | number | | 跳过条数（分页用） |

### `db_update`

按 ID 更新文档，支持乐观锁。

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `collection` | string | ✅ | Collection 名称 |
| `id` | string | ✅ | 文档 ID |
| `data` | object | ✅ | 要更新的字段 |
| `etag` | string | | ETag，用于乐观并发控制 |

### `db_delete`

按 ID 删除文档。

| 参数 | 类型 | 说明 |
|------|------|------|
| `collection` | string | Collection 名称 |
| `id` | string | 文档 ID |

## 使用示例

配置完成后，你可以直接用自然语言操作数据库：

> "帮我在 users collection 里插入一条记录，name 是 Alice，age 是 30"

> "查询 orders collection 里 status 为 pending 的所有订单"

> "把 id 为 abc123 的用户的 email 更新为 alice@example.com"

## 相关链接

- [存储适配器](/api/adapters) - 了解各适配器的配置细节
- [错误处理](/guide/error-handling) - 了解可能的错误类型
- [MCP 协议文档](https://modelcontextprotocol.io) - Model Context Protocol 官方文档
