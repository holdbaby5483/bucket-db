import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'BucketDB',
  description: 'TypeScript document database built on cloud object storage',

  base: '/',

  themeConfig: {
    logo: '/logo.svg',

    nav: [
      { text: '指南', link: '/guide/' },
      { text: 'API', link: '/api/' },
      { text: '示例', link: '/examples/' },
      {
        text: 'v0.1.0',
        items: [
          { text: 'GitHub', link: 'https://github.com/hold-baby/bucket-db' },
          { text: 'Changelog', link: 'https://github.com/hold-baby/bucket-db/releases' },
        ]
      }
    ],

    sidebar: {
      '/guide/': [
        {
          text: '入门',
          items: [
            { text: '快速开始', link: '/guide/' },
            { text: '安装指南', link: '/guide/installation' },
          ]
        },
        {
          text: '核心概念',
          items: [
            { text: '概念介绍', link: '/guide/concepts' },
            { text: '查询语法', link: '/guide/queries' },
            { text: '错误处理', link: '/guide/error-handling' }
          ]
        }
      ],

      '/api/': [
        {
          text: 'API 参考',
          items: [
            { text: '概览', link: '/api/' },
            { text: 'BucketDB', link: '/api/bucketdb' },
            { text: 'Collection', link: '/api/collection' },
            { text: '存储适配器', link: '/api/adapters' },
            { text: '类型定义', link: '/api/types' },
            { text: '错误类', link: '/api/errors' }
          ]
        }
      ],

      '/examples/': [
        {
          text: '示例',
          items: [
            { text: '示例索引', link: '/examples/' },
            { text: '基础用法', link: '/examples/basic-usage' },
            { text: '本地存储', link: '/examples/local-storage' },
            { text: '生产部署', link: '/examples/production' },
            { text: '高级模式', link: '/examples/advanced' }
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/hold-baby/bucket-db' }
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026-present'
    },

    editLink: {
      pattern: 'https://github.com/hold-baby/bucket-db/edit/main/apps/website/:path',
      text: '在 GitHub 上编辑此页'
    },

    search: {
      provider: 'local'
    }
  },

  markdown: {
    theme: {
      light: 'github-light',
      dark: 'github-dark'
    },
    lineNumbers: true
  }
});
