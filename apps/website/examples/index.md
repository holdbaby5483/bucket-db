# 示例

通过实际示例学习 BucketDB 的各种用法。

## 基础示例

- [基础用法](./basic-usage) - 完整的 CRUD 操作示例
- [本地存储](./local-storage) - 使用 FileSystemAdapter 进行本地开发

## 生产部署

- [生产部署](./production) - S3 和 OSS 配置示例

## 高级用法

- [高级模式](./advanced) - 分页、乐观锁、多租户等高级特性

## 运行示例

所有示例代码都可以在项目的 `examples/` 目录中找到：

```bash
# 克隆仓库
git clone https://github.com/[username]/bucket-db.git
cd bucket-db

# 安装依赖
bun install

# 运行基础示例
bun run examples/basic-usage/index.ts

# 运行本地存储示例
bun run examples/local-storage/index.ts

# 运行多数据库示例
bun run examples/dbpath-demo/index.ts
```

## 下一步

- [快速开始](/guide/) - 5 分钟上手教程
- [API 参考](/api/) - 完整的 API 文档
