"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

/**
 * 物品编号的复制按钮。
 * 详情页是服务端组件,之前这里放的是一个 `<a href>` 冒充按钮 —— 点它会跳回本页,
 * 并不会复制。复制必须发生在客户端,所以抽成一个小客户端组件。
 */
export function CopyCodeButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // 非 HTTPS 或权限被拒时退化到选中文本,至少让用户能手动复制。
      const field = document.createElement("textarea");
      field.value = code;
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      document.execCommand("copy");
      document.body.removeChild(field);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <button type="button" onClick={copy} className="btn-ghost inline-flex min-h-11 items-center gap-2 px-4 text-sm" aria-label={copied ? "已复制物品编号" : "复制物品编号"}>
      {copied ? <Check size={16} /> : <Copy size={16} />}
      {copied ? "已复制" : "复制"}
    </button>
  );
}