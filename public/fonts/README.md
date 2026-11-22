# 自托管字体

## Geist Mono

- 文件:`GeistMono-Regular.woff2`(400)、`GeistMono-SemiBold.woff2`(600–700)。
- 用途:物品编号、数量、日期这类需要等宽对齐的数字(`--font-mono`)。
- 来源:Vercel 的 [Geist](https://github.com/vercel/geist-font),npm 包 `geist@1.3.1` 的
  `dist/fonts/geist-mono/`。
- 授权:SIL Open Font License 1.1(可随项目分发)。

放在 `public/fonts/` 下同源加载:跨域字体必须带 `Access-Control-Allow-Origin`,
之前挂在第三方 OSS 上时浏览器直接拦截,字体永远加载不出来。

## MiSans(没有随仓库分发)

界面正文优先用 MiSans,但它只在设备本地存在时才会被用上(`@font-face` 只写了 `local()`):
MiSans 是小米的免费字体,但不便随仓库分发。此前挂的第三方 OSS 链接已经全部失效
(curl -I 实测:两个字体族共 7 个 URL 全部 404),每次打开页面都白发一次跨域请求、
控制台留下 2 条报错。没装 MiSans 时按 `--font-sans` 回退到
PingFang SC / Microsoft YaHei,这是绝大多数中文设备都有的字体。
