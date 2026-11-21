// 应用版本号。
//
// 唯一来源是 package.json:构建时由 next.config.ts 注入成 NEXT_PUBLIC_APP_VERSION。
// 别再手写字符串 —— 此前这里写死了 "0.0.8",而 package.json 早就 0.1.x 了,
// 于是「关于」页、设置页、顶栏显示的版本一直是错的。
export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || "0.0.0";
/** 项目仓库的 Releases 页 —— 各版本的完整改动说明都在那里维护,界面里不要另抄一份。 */
export const PROJECT_RELEASES_URL = "https://github.com/tempppw01/HomeInventory/releases";
