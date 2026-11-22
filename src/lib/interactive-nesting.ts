// 判断一段 React 节点里有没有「自己就是控件」的东西。
//
// 为什么值得单独成模块:这是一次真事故的根因,而且判定逻辑是纯函数,必须能单测。
// 提醒中心那一行既是按钮(onClick 进编辑),右侧又放了「处理掉」按钮,
// 渲染出来就是 <button> 里套 <button> —— HTML 不允许,React 报 hydration 错误;
// 更糟的是点「处理掉」会冒泡触发整行的 onClick,「移入回收站」的二次确认
// 和「编辑物品」两个弹窗会一起弹出来。
//
// 所以这只函数要回答的问题是:把 trailing 放进一个 <button> 里安全吗?
import { isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";

/** 这些标签自身就是控件,放进按钮里必然无效。 */
export const INTERACTIVE_TAGS = new Set(["button", "a", "select", "input", "textarea", "label", "audio", "video", "details"]);

type InspectableProps = { children?: ReactNode; onClick?: unknown; onMouseDown?: unknown };

export function hasInteractiveNode(node: ReactNode): boolean {
  if (node === null || node === undefined || typeof node === "boolean" || typeof node === "string" || typeof node === "number") return false;
  if (Array.isArray(node)) return node.some(hasInteractiveNode);
  if (!isValidElement(node)) return false;
  const element = node as ReactElement<InspectableProps>;
  const props = (element.props ?? {}) as InspectableProps;
  // 自定义组件(Button / Chip 这类)看不透实现,只看它有没有接点击:接了就当它是控件。
  if (typeof props.onClick === "function" || typeof props.onMouseDown === "function") return true;
  if (typeof element.type === "string" && INTERACTIVE_TAGS.has(element.type)) return true;
  // 剩下的一律往 children 里找:<span> 里也可能塞着一个按钮。
  return Array.isArray(props.children) ? props.children.some(hasInteractiveNode) : hasInteractiveNode(props.children);
}
