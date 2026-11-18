// 剪贴板写入 —— 浏览器环境专用。
//
// 详情页的复制按钮之前内联实现过一次;现在盘点行、任务行也要「复制编号 / 复制名称」,
// 再复制第三份就该收敛了。非 HTTPS 或权限被拒时退化到选中文本,至少让用户能手动复制。

export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 继续走兜底方案
    }
  }
  if (typeof document === "undefined") return false;
  try {
    const field = document.createElement("textarea");
    field.value = text;
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(field);
    return ok;
  } catch {
    return false;
  }
}