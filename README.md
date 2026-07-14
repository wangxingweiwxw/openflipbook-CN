# 中文化openflipbook

> **开源中文化的 [flipbook.page](https://flipbook.page) ，绘本就是用户界面。** 每一页都是AI生成的图示。点击图片的任何地方由视觉推理模型识别点击区域，生成进一步下一页的交互。以一个提问或者上传的图片为种子，带你用绘本探索人文历史。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/eren23/openflipbook?style=social)](https://github.com/eren23/openflipbook/stargazers)
[![Node](https://img.shields.io/badge/node-%3E%3D20-green.svg)](package.json)
[![Next.js](https://img.shields.io/badge/Next.js-15-black.svg)](https://nextjs.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-Modal-009688.svg)](https://modal.com)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

## 项目的起源

[flipbook.page](https://flipbook.page) 非常有意思，但是中文化不完美。建造真正中国风绘本探索网站是项目的起源。


```
   ┌────────────────────────┐                  ┌─────────────────────────┐
   │   输入指令/上传图片     │                  │        案例展示          │
   └─────────┬──────────────┘                  └─────────┬───────────────┘
             │                                           │ 点击交互
             ▼                                           ▼
    ┌───────────────────┐   规划页面      ┌──────────────────────────┐
    │  大语言推理模型    │ ─────────────▶ │     fal 文生图模型        │
    │   (+ 网络搜索)     │                │        渲染标注           │
    └───────────────────┘                └──────────────┬───────────┘
             ▲                                          │
             │  主题词                          │
             │                                          ▼
    ┌────────┴──────────┐    点击       ┌──────────────────────────┐
    │ 大语言模型         │     ◀──      │        进一步页面交互      │
    │  (VLM推理模型)     │               └──────────────────────────┘
    └───────────────────┘                              │
                                                       ▼
                               ┌────────────────────────────────────┐
                               │  下一步工作: 动画展示                │
                               │  │                                 │
                               │  └─ 流式视频: Modal LTX-2 via WS    │
                               │     with custom LTXF fMP4 framing  │
                               └────────────────────────────────────┘

                            支持组件: Cloudflare R2 + MongoDB
```


## 快速开始

最快的途径是通过Docker部署, 配置大语言模型和图片生成模型API，然后打开网页开始体验:

```bash
git clone https://github.com/eren23/openflipbook
cd openflipbook

cp .env.example .env          # fill FAL_KEY + OPENROUTER_API_KEY
dockers compose up --build    # → http://localhost:3000/play
```

## 许可证

[MIT](LICENSE) © 2026 
