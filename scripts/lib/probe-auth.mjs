// 探针脚本的登录守卫。
//
// 为什么需要:清理脚本会裁剪会话数据库,如果登录没成功,后面的断言其实都量在登录页上——
// 结果「全部通过」却什么都没测(这个问题在窄屏检查里真实发生过一次)。
// 登录成功后确认「登录表单已消失」,否则抛错让整个脚本失败。

/**
 * 登录并确认已进入应用。
 * @returns {{ ok: boolean, detail: string }}
 */
export async function loginAndConfirm(page, base, user, pass) {
  await page.goto(base);
  await page.waitForTimeout(1800);

  const needsLogin = (await page.locator("#auth-username").count()) > 0;
  if (needsLogin) {
    // 登录接口限速 12 次/分钟/IP:连续跑多个套件时很容易撞上(实测过一次),
    // 这时页面会停在登录页、看起来像「账号失效」。这里识别出限速就等一等再试。
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.fill("#auth-username", user);
      await page.fill("#auth-password", pass);
      await page.click('button[type="submit"]');
      // 登录成功后应用会跳到概览并可能弹出欢迎引导,给足时间
      await page.waitForTimeout(3200);
      const stillLogin = (await page.locator("#auth-username").count()) > 0;
      if (!stillLogin) break;
      const limited = await page.evaluate(() => /频繁|稍后再试|too many/i.test(document.body.innerText || ""));
      if (!limited) break;
      console.log("      登录被限速,等待 20 秒后重试");
      await page.waitForTimeout(20000);
    }
  }

  const state = await page.evaluate(() => ({
    loginForm: Boolean(document.querySelector("#auth-username")),
    head: (document.querySelector("main")?.innerText || "").slice(0, 40).replace(/\s+/g, " "),
  }));

  if (state.loginForm) {
    return { ok: false, detail: `仍停在登录页(${state.head || "无内容"})——账号或密码可能已失效` };
  }
  return { ok: true, detail: "已进入应用" };
}

/** 关掉欢迎引导等阻塞性弹层(最多试几次)。 */
// 关掉「会自动出现」的弹层。目前有两个:
//   · 欢迎引导(首次进入应用时弹)
//   · 提醒中心(库里有到期物品时每天自动弹一次)
// 只针对这两类,不会误关测试自己打开的对话框。
export async function dismissBlockingDialogs(page) {
  for (let i = 0; i < 6; i += 1) {
    const welcome = page.locator('[role="dialog"][aria-label="欢迎使用"]:visible');
    if ((await welcome.count()) > 0) {
      const skip = page.locator('[aria-label="暂时跳过欢迎引导"]:visible');
      if (await skip.count()) await skip.first().click({ timeout: 3000 }).catch(() => {});
      else await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(400);
      continue;
    }
    const reminders = page.locator('[role="dialog"][aria-label="提醒中心"]:visible');
    if ((await reminders.count()) > 0) {
      const close = page.locator('[role="dialog"]:visible button[aria-label="关闭提醒中心"]');
      if (await close.count()) await close.first().click({ timeout: 3000 }).catch(() => {});
      else await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(400);
      continue;
    }
    // 连续两次确认「确实没有弹层了」再返回:这两个弹层是异步出现的,
    // 清完就立刻返回的话,正好落在「清完 → 它又弹出来」的缝里,
    // 下一个动作就会被遮罩挡住(实测让多套检查在不同轮次假失败过)。
    await page.waitForTimeout(400);
    const stillClear = (await page.locator('[role="dialog"]:visible').count()) === 0;
    if (stillClear) {
      await page.waitForTimeout(150);
      if ((await page.locator('[role="dialog"]:visible').count()) === 0) return [];
    }
    continue;
  }
  // 清不掉也要**说出来**:否则失败会落在下游某个无辜的点击上,只报「点了没反应」
  const leftover = await page.evaluate(() => Array.from(document.querySelectorAll('[role="dialog"]'))
    .filter((node) => node.getBoundingClientRect().height > 0)
    .map((node) => node.getAttribute("aria-label") || "(无名弹层)"));
  if (leftover.length) console.log(`      ⚠ 仍然有浮层没清掉:${leftover.join("、")} —— 后面的点击可能被它们挡住`);
  return leftover;
}