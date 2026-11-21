// 盘点流程回归:点第一件物品后,进度必须从 0 推进到 1。
// 这一条来自真实走查:脚本点击了「确认」,但页面仍显示 0/9 ——
// 需要把「确认」按钮/行点击与进度变化钉住,而不是只测页面能打开。
import { launchChromium } from "./lib/browser.mjs";
import { dismissBlockingDialogs, loginAndConfirm } from "./lib/probe-auth.mjs";
const BASE=process.env.BASE_URL||"http://127.0.0.1:3001";
const browser=await launchChromium(); const context=await browser.newContext({viewport:{width:390,height:844}}); const page=await context.newPage();
const results=[]; const check=(n,o,d="")=>{results.push({n,o,d});console.log(`${o?"PASS":"FAIL"}  ${n}${o?"":" → "+d}`)};
const auth=await loginAndConfirm(page,BASE,process.env.PROBE_USER||"bgs",process.env.PROBE_PASS||"GuiWu-2026-Home"); check("已登录",auth.ok,auth.detail); if(!auth.ok) process.exit(1);
await dismissBlockingDialogs(page); await page.goto(`${BASE}/audit`); await page.waitForTimeout(2600); await dismissBlockingDialogs(page);
const read=()=>page.evaluate(()=>{const t=(document.querySelector("main")?.innerText||"").replace(/\n+/g," | "); const m=t.match(/进度\s*(\d+)\s*\/\s*(\d+)/); return {text:t,confirmed:m?Number(m[1]):null,total:m?Number(m[2]):null}});
const before=await read(); check("盘点页有可识别的进度",before.confirmed!==null, before.text.slice(0,150));
const row=page.locator('main button').filter({hasText:/INV-|·/}).first(); const rowCount=await row.count(); check("找到第一件盘点物品的可点行",rowCount>0,`count=${rowCount}`);
if(rowCount){await row.click(); await page.waitForTimeout(1200); const after=await read(); check("确认第一件后进度推进 1",after.confirmed===before.confirmed+1,`前=${before.confirmed} 后=${after.confirmed}`);}
const failed=results.filter(x=>!x.o); console.log(`\n${results.length-failed.length}/${results.length} 通过`); await context.close(); await browser.close(); process.exit(failed.length?1:0);