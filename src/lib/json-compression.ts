// 大 JSON 响应走 gzip —— 这里只做「怎么编码」这件事,**不依赖 Next**,
// 于是它能在纯函数单测里被钉死(和 ai-error.ts 一样的做法)。
// 把结果包成 NextResponse 的那一行留在各自的 route 里。
//
// 起因(实测,不是推测):应用启动时前端会拉一次 `/api/dashboard`,那里面带着**整份库存**。
// 1200 件物品时它是 **1111 KB**,而且**完全没有压缩**发出去 —— 浏览器明明发了
// `accept-encoding: gzip, deflate, br`,响应的 `content-encoding` 还是空的:
//
//     next start        /api/dashboard  encoding=(无)  1111 KB
//     node standalone   /api/dashboard  encoding=(无)  1111 KB   ← Docker 镜像走的就是这条
//     同一台机器的 HTML 文档  encoding=gzip   11 KB      ← 说明压缩本身是开着的
//
// 也就是说 Next 的 `compress` 只覆盖它自己产出的页面与静态资源,route handler 的响应不在内,
// 显式写 `compress: true` 也**没有**改变这一点(试过,重启后仍是 1111 KB)。
// 于是这份大响应只能由应用自己压:JSON 压得动,实测 1111 KB → 64 KB。

import { gzipSync } from "node:zlib";

/** 小于这个体积就不压(压了反而更亏) */
export const GZIP_THRESHOLD_BYTES = 4096;

export type EncodedJsonBody = {
  status: number;
  headers: Record<string, string>;
  /** 已经编码好的响应体:可能是原文,也可能是 gzip 字节 */
  body: string | Uint8Array<ArrayBuffer>;
  /** 是否真的压了(便于调用方与检查脚本观察) */
  compressed: boolean;
};

/**
 * 把数据编码成 JSON 响应体;客户端接受 gzip 且体积够大时压一下。
 *
 * 用同步 gzip:1 MB 的 JSON 大约 20ms,换来 17 倍的传输体积下降,
 * 对这些「一次拉整份数据」的接口是划算的;流式压缩的复杂度不值得。
 */
export function encodeJsonResponse(
  data: unknown,
  acceptEncoding: string | null | undefined,
  init?: { status?: number; headers?: Record<string, string> },
): EncodedJsonBody {
  const body = JSON.stringify(data);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    // 同一个 URL 对不同的 Accept-Encoding 会给出不同字节,必须声明,否则中间缓存会把压缩版喂给解不开的客户端
    vary: "accept-encoding",
    ...init?.headers,
  };
  const status = init?.status ?? 200;

  const acceptsGzip = /\bgzip\b/.test(acceptEncoding ?? "");
  if (!acceptsGzip || body.length < GZIP_THRESHOLD_BYTES) {
    return { status, headers, body, compressed: false };
  }

  const compressed = gzipSync(body);
  // 拷进一个显式的 Uint8Array<ArrayBuffer>:gzipSync 给的是 ArrayBufferLike 版本,
  // 直接当 BodyInit/BlobPart 用会卡在 SharedArrayBuffer 的方差检查上
  const bytes = new Uint8Array(compressed.length);
  bytes.set(compressed);
  return {
    status,
    headers: { ...headers, "content-encoding": "gzip", "content-length": String(bytes.length) },
    body: bytes,
    compressed: true,
  };
}
