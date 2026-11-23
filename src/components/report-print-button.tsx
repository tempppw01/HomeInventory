"use client";

/**
 * 打印按钮:直接调 window.print(),不额外开路由。
 * 打印样式里把按钮和导航都隐藏掉,只留正文。
 */
export function ReportPrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="btn-primary inline-flex min-h-11 items-center gap-2 px-4 text-sm print:hidden"
    >
      打印 / 存成 PDF
    </button>
  );
}