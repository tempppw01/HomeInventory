import sharp from "sharp";

const maxSourceBytes = 12 * 1024 * 1024;
const maxImageEdge = 1600;

export class AiImageError extends Error {}

function imageBufferFromDataUrl(dataUrl: string) {
  const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,([\s\S]+)$/i.exec(dataUrl);
  if (!match) throw new AiImageError("图片格式不受支持，请上传 JPG、PNG、WebP 或 GIF 图片");

  const source = Buffer.from(match[2], "base64");
  if (!source.length) throw new AiImageError("图片内容为空，请重新上传");
  if (source.length > maxSourceBytes) throw new AiImageError("图片原始文件不能超过 12MB，请换一张更小的图片后再试");
  return source;
}

/** 将聊天中的本地图片压缩为适合视觉模型传输的 JPEG data URL。 */
export async function compressAiImageDataUrl(dataUrl: string) {
  const source = imageBufferFromDataUrl(dataUrl);
  try {
    const output = await sharp(source, { failOn: "none", limitInputPixels: 40_000_000 })
      .rotate()
      .resize({ width: maxImageEdge, height: maxImageEdge, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80, progressive: true, mozjpeg: true })
      .toBuffer();

    if (!output.length) throw new Error("empty output");
    return `data:image/jpeg;base64,${output.toString("base64")}`;
  } catch (error) {
    if (error instanceof AiImageError) throw error;
    throw new AiImageError("图片无法处理，请换一张正常的 JPG、PNG、WebP 或 GIF 图片后再试");
  }
}
