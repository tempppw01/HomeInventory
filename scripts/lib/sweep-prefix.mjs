// 套件收尾:把自己前缀造出来的数据清干净。
//
// 由来:多个套件「清理」时只删登记过 id 的记录,而任务删除还调了**不存在的**
// DELETE /api/tasks/{id}(404,且被 .catch 吞掉),于是每次跑完都留在库里 ——
// 实测本地积了 66 个 T- 任务、12 个 A-矩阵任务、3 个 B-换滤芯,还有 B-厨房/B-吊柜 等空间。
//
// 正确口子:任务走 PATCH /api/tasks { id, action: "delete" };物品要永久删除才算真的没留。

/**
 * @param {{ base: string, cookie: string, prefix: string }} options
 * @returns {Promise<{ tasks: number, items: number, shopping: number, locations: number, leftover: number }>}
 */
export async function sweepPrefix({ base, cookie, prefix }) {
  const call = async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { status: res.status, json };
  };
  const matches = (value) => String(value ?? "").startsWith(prefix);
  const list = (value, key) => (Array.isArray(value) ? value : value?.[key] ?? []);

  const counts = { tasks: 0, items: 0, shopping: 0, locations: 0, leftover: 0 };

  // 采购项
  const dash = (await call("GET", "/api/dashboard")).json ?? {};
  for (const row of list(dash.shopping, "shopping").filter((entry) => matches(entry.name))) {
    const res = await call("DELETE", `/api/shopping/${row.id}`);
    if (res.status < 300) counts.shopping += 1;
  }

  // 物品(永久删除:软删只会进回收站,仓库里仍然留着)
  const items = (await call("GET", "/api/items?includeDeleted=1")).json ?? [];
  for (const row of list(items, "items").filter((entry) => matches(entry.name))) {
    const res = await call("DELETE", `/api/items/${row.id}`, { permanent: true });
    if (res.status < 300) counts.items += 1;
  }

  // 任务(注意:没有 DELETE /api/tasks/{id} 这个路由)
  const tasks = (await call("GET", "/api/tasks")).json ?? [];
  for (const row of list(tasks, "tasks").filter((entry) => matches(entry.title))) {
    const res = await call("PATCH", "/api/tasks", { id: row.id, action: "delete" });
    if (res.status < 300) counts.tasks += 1;
  }

  // 空间:先深后浅,避免删父空间时子空间还挂着
  const spaces = list((await call("GET", "/api/dashboard")).json?.locations, "locations");
  const depthOf = (row) => {
    let depth = 0;
    let current = row;
    const byId = new Map(spaces.map((entry) => [entry.id, entry]));
    while (current?.parentId && depth < 10) {
      current = byId.get(current.parentId);
      depth += 1;
    }
    return depth;
  };
  for (const row of spaces.filter((entry) => matches(entry.name)).sort((a, b) => depthOf(b) - depthOf(a))) {
    const res = await call("DELETE", `/api/locations/${row.id}`);
    if (res.status < 300) counts.locations += 1;
  }

  // 复查:还剩几条同名前缀的东西
  const afterDash = (await call("GET", "/api/dashboard")).json ?? {};
  const afterItems = (await call("GET", "/api/items?includeDeleted=1")).json ?? [];
  const afterTasks = (await call("GET", "/api/tasks")).json ?? [];
  counts.leftover =
    list(afterDash.shopping, "shopping").filter((entry) => matches(entry.name)).length
    + list(afterItems, "items").filter((entry) => matches(entry.name)).length
    + list(afterTasks, "tasks").filter((entry) => matches(entry.title)).length
    + list(afterDash.locations, "locations").filter((entry) => matches(entry.name)).length;

  return counts;
}