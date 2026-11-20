// 注册 `@/` 别名解析钩子(见 alias-hooks.mjs 里的说明)。
// 通过 node --import ./scripts/lib/register-alias.mjs 生效。
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./alias-hooks.mjs", pathToFileURL(import.meta.filename));
