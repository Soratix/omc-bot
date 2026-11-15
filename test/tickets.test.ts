import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatQuestions, parseQuestions, slugify } from '../src/tickets/questions.ts';

test('questions : préfixes * (long) et ? (facultative)', () => {
  const r = parseQuestions('Membre du personnel concerné\n?Date et heure des faits\n*Description des faits\n\n*?Pièces jointes');
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.questions, [
    { label: 'Membre du personnel concerné', long: false, required: true },
    { label: 'Date et heure des faits', long: false, required: false },
    { label: 'Description des faits', long: true, required: true },
    { label: 'Pièces jointes', long: true, required: false },
  ]);
  assert.equal(formatQuestions(r.questions), 'Membre du personnel concerné\n?Date et heure des faits\n*Description des faits\n*?Pièces jointes');
});

test('questions : limites Discord', () => {
  assert.equal(parseQuestions('a\nb\nc\nd\ne\nf').ok, false); // 6 questions
  assert.equal(parseQuestions('x'.repeat(46)).ok, false); // intitulé > 45
  const empty = parseQuestions('   \n  ');
  assert.ok(empty.ok && empty.questions.length === 0);
});

test('slug des salons', () => {
  assert.equal(slugify('Réclamation / Plainte'), 'reclamation-plainte');
  assert.equal(slugify('Demande de grade'), 'demande-de-grade');
  assert.equal(slugify('Jean-Marc Dupont', 40), 'jean-marc-dupont');
  assert.equal(slugify('😀'), 'ticket');
});
