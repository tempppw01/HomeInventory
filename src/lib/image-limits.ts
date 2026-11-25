// 图片解码失败时,给用户一句能照做的话。
//
// 由来(实测):损坏内容 / 零字节 / 像素超上限,三种情况都落成
// **500「服务器暂时开小差了,请稍后重试」** —— 用户只会反复重试。
// 尤其像素超上限这一条:应用把上限设在 4000 万像素,而**很多手机的 4800 万像素模式**一拍就超,
// 于是"上传一张原图"看起来像服务坏了。

/** 与 upload 路由共用的上限(路由与文案从此只认这一处)。 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 40_000_000;

/**
 * 把 sharp 解码/编码的失败翻译成中文。
 * 未知错误返回 null,让调用方走通用的 apiError(不要假装认识所有错误)。
 */
export function sharpFailureMessage(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/pixel limit|too large|exceeds pixel/i.test(message)) {
    return `这张图片的像素太多(上限 ${Math.round(MAX_IMAGE_PIXELS / 10000)} 万像素),请先缩小或裁剪后再上传 —— 手机相机的高像素模式(例如 4800 万)常见这一条`;
  }
  if (/unsupported image format|input buffer|corrupt|invalid|premature end|End of file/i.test(message)) {
    return "这个文件不是有效的图片(可能已损坏或格式不对),请换一张 JPG、PNG、WebP 或 GIF";
  }
  if (/unsupported colour|unsupported color|channels/i.test(message)) {
    return "这张图片的颜色格式不支持,请另存为普通的 JPG 或 PNG 后再上传";
  }
  return null;
}