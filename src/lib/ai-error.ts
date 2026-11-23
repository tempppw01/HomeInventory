// AI 上游报错的统一解读(纯函数,零依赖 —— 可以直接单测)。
//
// 为什么单独成模块:
//   · 同一条上游错误,批量识别 / AI 助手 / 单件分析三条路此前各写一份文案,其中两条
//     直接把上游的详情**丢掉**了,用户只看到「AI 接口请求失败(400)」,不知道该改什么;
//   · 想给这些文案加单测,却因为 ai-analyze 里带着 prisma 与 TS 参数属性(class 的
//     `constructor(readonly status)` 在 strip-only 模式下不被支持)而加载不了。
//     把它们放到这里,就能像 interactive-nesting / local-date 那样直接测。

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

/** 从上游响应体里抠出人能读的那句错误(JSON、纯文本、HTML 错误页都兜住)。 */
export function providerErrorDetail(raw: string) {
  try {
    const parsed = asRecord(JSON.parse(raw));
    const error = asRecord(parsed?.error);
    const detail = error?.message ?? parsed?.message ?? parsed?.error;
    if (typeof detail === "string") return detail.slice(0, 400);
  } catch {
    // Fall back to the raw provider response below.
  }
  return raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 400) || "上游接口未提供错误详情";
}

/**
 * 把「上游状态码 + 上游响应体」翻译成一条可操作的中文。
 *
 * 每一条都要回答「用户接下来该做什么」,而不是只说失败了。
 */
export function providerFailure(status: number, raw: string, context?: { remoteImages?: boolean }) {
  const detail = providerErrorDetail(raw);
  if (status === 401) return `API Key 无效或已过期,请在设置中重新填写后再试。上游返回:${detail}`;
  if (status === 403) return `API Key 没有访问当前模型的权限。上游返回:${detail}`;
  // 实测最容易踩的一个:图片给的是外链,而模型取不到它(有的渠道不接受远程 URL)。
  // 上游那句是英文、也不说该改成什么,这里直接给出可操作的中文说法。
  // 上游对「远程图片链接」的措辞各家不同(实测 deepseek 返回 unsupported_media:
  // "this model accepts text and inline (base64 data URL) images only"),靠猜措辞不可靠 ——
  // 路由本来就知道这次请求里有没有 http(s) 图片,直接把上下文传进来。
  const remoteImageRejected = /could not be fetched from its URL|error while downloading|invalid_image_url|unsupported_media|inline \(base64/i.test(detail);
  if ((context?.remoteImages || remoteImageRejected) && (status === 400 || status === 415)) {
    return `AI 取不到这个图片链接(上游 400)。请把图片下载下来作为文件上传,或换一个公开可访问的图片直链。上游返回:${detail}`;
  }
  if (status === 429) return `上游接口限流了,过一会儿再试。上游返回:${detail}`;
  if (status === 404) return `上游没有这个模型,请到设置里检查模型名。上游返回:${detail}`;
  return `AI 接口请求失败(${status}):${detail}`;
}