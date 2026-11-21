// 家庭成员的删除接口。
//
// 为什么补:成员此前**只能加不能删** —— 界面里写错一个名字(比如「爸吧」),
// 那条 chip 就会永远留在设置页与家庭成员列表里,没有任何办法改掉。
// (动作名 MEMBER_DELETE 早就存在于标签表里,说明这件事本来就该有。)
//
// 只做删除:改名可以用「删掉重建」解决,不必为了一个小功能引入 PATCH 的幂等/冲突语义。

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { apiError, requireWritableUser } from "@/lib/api";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(_: NextRequest, { params }: Context) {
  try {
    const user = await requireWritableUser();
    const { id } = await params;

    const member = await prisma.householdMember.findUnique({ where: { id } });
    if (!member) return NextResponse.json({ error: "找不到这个家庭成员" }, { status: 404 });

    // 顺序很重要:先写日志、再删成员。
    // 反过来会让日志里的 memberId 指向一个刚被删掉的行 —— 外键冲突,接口返回 409(踩过)。
    await prisma.$transaction(async (tx) => {
      await tx.activityLog.create({
        data: { action: "MEMBER_DELETE", userId: user.id, memberId: id, detail: `移除家庭成员:${member.name}` },
      });
      await tx.householdMember.delete({ where: { id } });
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}