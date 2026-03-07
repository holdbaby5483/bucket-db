# 文档站部署说明

## Cloudflare Pages 部署配置

### 构建配置

```yaml
Framework preset: None
Build command: cd apps/website && bun install && bun run build
Build output directory: apps/website/.vitepress/dist
Root directory: /
```

### 环境变量

```
NODE_VERSION=20
```

### 常见问题

**Q1: 构建失败提示找不到 bun**
- 在环境变量中添加 `BUN_VERSION=latest`
- 或修改构建命令为：`cd apps/website && npm install && npm run build`

**Q2: 构建成功但页面 404**
- 检查构建输出目录是否正确：`apps/website/.vitepress/dist`
- 确认根目录设置为 `/`

**Q3: 样式丢失**
- 检查 `.vitepress/config.ts` 中的 `base` 配置
- Cloudflare Pages 默认根路径部署，`base` 应为 `'/'`

**Q4: 首次构建超时**
- Cloudflare Pages 构建限制 20 分钟
- 当前项目构建时间约 2-3 分钟，正常范围内

### 自动部署

推送到 `main` 分支自动触发部署：
```bash
git add .
git commit -m "docs: update documentation"
git push origin main
```

### 本地预览

```bash
cd apps/website
bun run build
bun run preview
```

访问 http://localhost:4173 查看构建结果

### Vercel 备选方案

如果需要切换到 Vercel，已有配置文件 `vercel.json`：
```bash
npm i -g vercel
cd apps/website
vercel --prod
```

## 监控与维护

- Cloudflare Dashboard 查看部署历史
- 每次部署保留历史版本，可回滚
- 构建日志保存 30 天
