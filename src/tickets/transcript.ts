/**
 * Transcript HTML d'un ticket : tous les messages du salon, lisibles dans un navigateur.
 * Nécessite l'intent privilégié MESSAGE CONTENT pour lire le texte des messages.
 */
import { AttachmentBuilder, type Collection, type Message, type TextChannel } from 'discord.js';
import type { Ticket, TicketType } from '../db/schema.js';
import { formatFrDateTime } from '../lib/dates.js';

const MAX_MESSAGES = 2000;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

async function fetchAll(channel: TextChannel): Promise<Message[]> {
  const out: Message[] = [];
  let before: string | undefined;
  while (out.length < MAX_MESSAGES) {
    const batch: Collection<string, Message> = await channel.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    out.push(...batch.values());
    before = batch.last()?.id;
  }
  return out.reverse();
}

function renderMessage(m: Message): string {
  const parts: string[] = [];
  if (m.cleanContent) parts.push(`<div class="txt">${esc(m.cleanContent).replace(/\n/g, '<br>')}</div>`);
  for (const e of m.embeds) {
    const fields = e.fields.map((f) => `<div class="f"><b>${esc(f.name)}</b><br>${esc(f.value).replace(/\n/g, '<br>')}</div>`).join('');
    parts.push(
      `<div class="embed">${e.title ? `<div class="et">${esc(e.title)}</div>` : ''}${e.description ? `<div>${esc(e.description).replace(/\n/g, '<br>')}</div>` : ''}${fields}</div>`,
    );
  }
  for (const a of m.attachments.values()) {
    parts.push(`<div class="att">📎 <a href="${esc(a.url)}">${esc(a.name)}</a></div>`);
  }
  const name = m.member?.displayName ?? m.author.displayName;
  return `<div class="msg"><img src="${esc(m.author.displayAvatarURL({ size: 64 }))}" alt=""><div><div class="h"><b>${esc(name)}</b>${m.author.bot ? ' <span class="bot">BOT</span>' : ''} <span class="d">${formatFrDateTime(m.createdAt)}</span></div>${parts.join('')}</div></div>`;
}

export async function buildTranscript(channel: TextChannel, ticket: Ticket, type: TicketType): Promise<{ file: AttachmentBuilder; count: number }> {
  const messages = await fetchAll(channel);
  const html = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ticket n°${ticket.id} — ${esc(type.name)}</title>
<style>
body{font-family:system-ui,sans-serif;background:#313338;color:#dbdee1;margin:0;padding:16px}
header{border-bottom:1px solid #4e5058;margin-bottom:16px;padding-bottom:8px}
h1{font-size:20px;margin:0 0 4px}.meta{color:#949ba4;font-size:14px}
.msg{display:flex;gap:12px;margin:12px 0}.msg img{width:40px;height:40px;border-radius:50%}
.h b{color:#f2f3f5}.d{color:#949ba4;font-size:12px}.bot{background:#5865f2;color:#fff;font-size:10px;padding:1px 4px;border-radius:3px}
.txt{white-space:normal;word-wrap:break-word}.embed{border-left:4px solid #0ea5e9;background:#2b2d31;padding:8px 12px;margin-top:4px;border-radius:4px;max-width:640px}
.et{font-weight:bold;margin-bottom:4px}.f{margin-top:6px}.att a{color:#00a8fc}
</style></head><body>
<header><h1>Ticket n°${ticket.id} — ${esc(type.name)}</h1>
<div class="meta">Salon #${esc(channel.name)} · ouvert le ${formatFrDateTime(ticket.openedAt)} · ${messages.length} message(s) · transcript généré le ${formatFrDateTime(new Date())}</div></header>
${messages.map(renderMessage).join('\n')}
</body></html>`;
  return { file: new AttachmentBuilder(Buffer.from(html, 'utf8'), { name: `ticket-${ticket.id}.html` }), count: messages.length };
}
