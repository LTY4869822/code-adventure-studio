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

## GitHub Pages 发布

正式地址：[Code-Adventure 工作室](https://lty4869822.github.io/code-adventure-studio/)。

源码分支为 `codex/site-launch`，构建产物分支为 `codex/pages`。在源码分支运行 `npm ci`、`npm run build` 后，将 `dist/` 内容发布到 `codex/pages` 根目录，GitHub Pages 从该分支根目录提供静态网站。五页继续采用 hash 路由，例如 `/#/services`、`/#/works`、`/#/team` 和 `/#/contact`。

仓库中的 `vercel.json` 保留为备用配置，构建命令为 `npm run build`，输出目录为 `dist`；当前尚未部署到 Vercel。

## 个人网站链接

两站互链已配置。工作室可返回[个人站工作室介绍页](https://lty4869822.github.io/221b-mind-palace/#/studio)，个人站也会前往本工作室。`site/index.html` 已设置：

```html
<meta name="personal-site-url" content="https://lty4869822.github.io/221b-mind-palace/#/studio">
```

以后更换个人站域名时更新该 meta，再重新构建。桥接脚本不读取构建环境变量；个人站指向工作室的地址可通过个人站构建变量 `VITE_STUDIO_URL` 覆盖。

## 内容

作品保留原版 DEMO 标识，团队角色与联系方式保持原内容。表单使用 `mailto:` 准备邮件，由用户在自己的邮件客户端确认发送，没有后台发送接口。

所有原版媒体位于 `site/`，无需另一个个人站仓库即可独立构建。原素材及已有版权说明保持原样，此发布目录没有添加素材授权协议。
