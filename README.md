# Code-Adventure 工作室官网 · 原版互联版

工作室前端保留上传版本的五个页面、样式、无限环与粒子引擎、图腾、鼠标交互、标志及作品视频。只在桌面页头、手机菜单、页脚和团队主理人介绍增加个人站链接，样式和地址解析独立放在 `site/bridge.css` 与 `site/bridge.js`。

## 运行与构建

```bash
npm ci
npm run dev
npm run build
npm run preview
```

`npm run build` 将 `site/` 原样复制到 `dist/`，并逐文件验证复制字节。Vite 仅提供本地开发与预览服务器。原版静态前端没有 npm 运行依赖，原厂粒子脚本内已有单份 Three r180。

## Vercel

仓库根目录包含 `vercel.json`。安装命令为 `npm ci`，构建命令为 `npm run build`，静态输出目录为 `dist`。五页采用 hash 路由，例如 `/#/services`、`/#/works`、`/#/team` 和 `/#/contact`。

## 个人网站链接

独立部署到工作室域名之前，在 `site/index.html` 填入个人站的正式地址：

```html
<meta name="personal-site-url" content="https://你的个人站域名/#/studio">
```

留空时，内嵌于个人站的 `/studio-site/` 会返回同域 `/#/studio`；本地工作室预览端口 2220 或 2221 会返回个人站端口 2219。独立域名应明确填写正式地址。桥接脚本不读取任何构建环境变量。

## 内容

作品保留原版 DEMO 标识，团队角色与联系方式保持原内容。表单使用 `mailto:` 准备邮件，由用户在自己的邮件客户端确认发送，没有后台发送接口。

所有原版媒体位于 `site/`，无需另一个个人站仓库即可独立构建。原素材及已有版权说明保持原样，此发布目录没有添加素材授权协议。
