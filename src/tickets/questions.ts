/**
 * Questions des formulaires d'ouverture, saisies en texte (une par ligne) depuis Discord :
 *
 *   Membre du personnel concerné
 *   ?Date et heure des faits        ← « ? » au début : facultative
 *   *Description des faits          ← « * » au début : texte long
 *
 * Les deux préfixes peuvent se combiner (« *? » ou « ?* »). Discord limite un formulaire à 5 champs
 * et chaque intitulé à 45 caractères.
 */
import type { TicketQuestion } from '../db/schema.js';

export const MAX_QUESTIONS = 5;
export const MAX_LABEL = 45;

export function parseQuestions(text: string): { ok: true; questions: TicketQuestion[] } | { ok: false; error: string } {
  const questions: TicketQuestion[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line) continue;
    let long = false;
    let required = true;
    while (line.startsWith('*') || line.startsWith('?')) {
      if (line[0] === '*') long = true;
      else required = false;
      line = line.slice(1).trim();
    }
    if (!line) continue;
    if (line.length > MAX_LABEL) {
      return { ok: false, error: `La question « ${line} » dépasse ${MAX_LABEL} caractères (limite Discord).` };
    }
    questions.push({ label: line, long, required });
  }
  if (questions.length > MAX_QUESTIONS) {
    return { ok: false, error: `${questions.length} questions : Discord limite un formulaire à ${MAX_QUESTIONS} champs.` };
  }
  return { ok: true, questions };
}

export function formatQuestions(questions: TicketQuestion[]): string {
  return questions.map((q) => `${q.long ? '*' : ''}${q.required ? '' : '?'}${q.label}`).join('\n');
}

/** Préfixe de nom de salon : minuscules, sans accents ni symboles, 20 caractères max. */
export function slugify(text: string, max = 20): string {
  return (
    text
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, max)
      .replace(/-+$/g, '') || 'ticket'
  );
}
