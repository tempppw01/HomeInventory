// 浏览器启动的公共入口。
//
// 之前的几个测试脚本把 Chromium 路径写死成
// `%LOCALAPPDATA%\ms-playwright\chromium-1248\chrome-win64\chrome.exe` ——
// 只在开发机上成立。CI(Linux)既没有这个路径,也未必装了浏览器,
// 于是「渲染层检查」直接抛错把整个用例集判失败。
// 这里统一解析:显式环境变量 → 本机已知路径 → 交给 Playwright 自己找。
import { existsSync } from "node:fs";
import { chromium } from "playwright";

export function chromiumExecutable() {
  const fromEnv = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const local = process.env.LOCALAPPDATA;
  if (local) {
    const win = `${local}\\ms-playwright\\chromium-1248\\chrome-win64\\chrome.exe`;
    if (existsSync(win)) return win;
  }
  return undefined;
}

/** 起一个浏览器;环境里没有可用 Chromium 时返回 null,由调用方决定跳过还是失败。 */
export async function launchChromiumOrNull(options = {}) {
  try {
    return await chromium.launch({ executablePath: chromiumExecutable(), ...options });
  } catch (error) {
    console.log(`      跳过浏览器检查:${error instanceof Error ? error.message.split("\n")[0].slice(0, 120) : error}`);
    return null;
  }
}
/** 起一个浏览器;失败直接抛错(需要「失败即失败」的脚本用这个)。 */
export async function launchChromium(options = {}) {
  return chromium.launch({ executablePath: chromiumExecutable(), ...options });
}
