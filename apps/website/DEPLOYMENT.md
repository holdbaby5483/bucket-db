# 文档站部署说明

线上地址：https://bucket-db.pages.dev（Cloudflare Pages，推送到 `main` 自动部署）

## Cloudflare Pages 部署配置

### 构建配置

```yaml
Framework preset: None
Build command: cd apps/website && bun install && bun run build
Build output directory: apps/website/.vitepress/dist
Root directory: /
```

`bun run build` 先执行 `sync`（`scripts/sync-api-docs.ts`），从仓库根目录的 `docs/API.md` 生成 `api/*.md`，并把 `packages/core/llms.txt` 复制到 `public/llms.txt`，然后执行 `vitepress build`。同步脚本以 `#!/usr/bin/env bun` 运行，所以构建环境必须有 Bun，不能只用 npm。

### 环境变量

```
BUN_VERSION=1.4.2
NODE_VERSION=22
```

`BUN_VERSION` 与 CI（`.github/workflows/test.yml`）保持一致；VitePress 本身在 Node 上运行。

### 常见问题

**Q1: 构建失败提示找不到 bun**
- 确认环境变量中有 `BUN_VERSION=1.4.2`。

**Q2: 构建成功但页面 404**
- 检查构建输出目录是否正确：`apps/website/.vitepress/dist`
- 确认根目录设置为 `/`

**Q3: 样式丢失**
- 检查 `.vitepress/config.ts` 中的 `base` 配置
- Cloudflare Pages 默认根路径部署，`base` 应为 `'/'`

**Q4: 构建后 `api/index.md` 出现改动**
- `api/*.md` 由 `sync` 生成，其中只有 `api/index.md` 被 git 跟踪；它首段的版本号写在 `scripts/sync-api-docs.ts` 里。改 API 文档请改 `docs/API.md`，改版本号请改生成器，再把重新生成的 `api/index.md` 一起提交。

### 自动部署

推送到 `main` 分支自动触发部署。

### 本地预览

```bash
cd apps/website
bun run build
bun run preview
```

访问 `http://localhost:4173` 查看构建结果

## 监控与维护

- Cloudflare Dashboard 查看部署历史和构建日志，可回滚到之前的部署
