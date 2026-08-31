import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/account-auth";
import { apiError } from "@/lib/api";
import { prisma } from "@/lib/prisma";

type Attachment = { kind: "image" | "text" | "file"; name: string; url?: string; text?: string };
type ItemDraft = { name: string; category: string; type: "DURABLE" | "CONSUMABLE"; quantity: number; unit: string; locationName?: string; expiryDate?: string | null; notes?: string };
type Message = { role: "user" | "assistant"; content: string; attachments?: Attachment[]; itemDraft?: ItemDraft };

function asMessages(value: unknown): Message[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-40).flatMap((entry): Message[] => {
    if (!entry || typeof entry !== "object") return [];
    const message = entry as Partial<Message>;
    if ((message.role !== "user" && message.role !== "assistant") || typeof message.content !== "string") return [];
    const attachments = Array.isArray(message.attachments) ? message.attachments.slice(0, 4).flatMap((attachment): Attachment[] => {
      if (!attachment || typeof attachment !== "object") return [];
      const value = attachment as Partial<Attachment>;
      if ((value.kind !== "image" && value.kind !== "text" && value.kind !== "file") || typeof value.name !== "string") return [];
      return [{ kind: value.kind, name: value.name.slice(0, 180), url: typeof value.url === "string" ? value.url.slice(0, 1000) : undefined, text: typeof value.text === "string" ? value.text.slice(0, 200000) : undefined }];
    }) : [];
    const itemDraft = message.itemDraft && typeof message.itemDraft === "object" ? message.itemDraft as ItemDraft : undefined;
    return [{ role: message.role, content: message.content.slice(0, 12000), attachments, itemDraft }];
  });
}

function parse<T>(value: string | null): T | undefined {
  if (!value) return undefined;
  try { return JSON.parse(value) as T; } catch { return undefined; }
}

export async function GET() {
  try {
    const user = await requireUser();
    const rows = await prisma.aiChatMessage.findMany({ where: { userId: user.id }, orderBy: { position: "asc" }, take: 40 });
    return NextResponse.json({ messages: rows.map((row) => ({ role: row.role, content: row.content, attachments: parse<Attachment[]>(row.attachments) || [], itemDraft: parse<ItemDraft>(row.itemDraft) })), updatedAt: rows.at(-1)?.updatedAt.toISOString() || null });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireUser();
    const messages = asMessages((await request.json().catch(() => ({}))).messages);
    await prisma.$transaction(async (tx) => {
      await tx.aiChatMessage.deleteMany({ where: { userId: user.id } });
      if (messages.length) await tx.aiChatMessage.createMany({ data: messages.map((message, position) => ({ userId: user.id, position, role: message.role, content: message.content, attachments: message.attachments?.length ? JSON.stringify(message.attachments) : null, itemDraft: message.itemDraft ? JSON.stringify(message.itemDraft) : null })) });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

