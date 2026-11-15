import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addDays, daysBetween, formatFr, parseFrDate, todayParis } from '../src/lib/dates.ts';
import { buildNickname, validateRpName } from '../src/lib/names.ts';

test('noms RP : mise en forme', () => {
  const r = validateRpName('  jEAN-marc ', "o’brien");
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.full, "Jean-Marc O'Brien");
  const e = validateRpName('élodie', 'de la tour');
  assert.ok(e.ok && e.full === 'Élodie De La Tour');
});

test('noms RP : refus', () => {
  assert.equal(validateRpName('Jean2', 'Dupont').ok, false);
  assert.equal(validateRpName('Jean', 'Dup😀nt').ok, false);
  assert.equal(validateRpName('J', 'Dupont').ok, false);
  assert.equal(validateRpName('Jean', 'Dupont!').ok, false);
  assert.equal(validateRpName('Maximilienne', 'Vandenberghe-Lo').ok, false); // 28 caractères > 25
});

test('pseudo final ≤ 32 caractères avec le préfixe le plus long', () => {
  const r = validateRpName('Maximilienne', 'Vandenbergh'); // 24 caractères
  assert.ok(r.ok);
  if (r.ok) {
    const nick = buildNickname('[Méd.]', r.prenom, r.nom);
    assert.equal(nick, '[Méd.] Maximilienne Vandenbergh');
    assert.ok(nick.length <= 32);
  }
});

test('dates : saisie JJ/MM/AAAA', () => {
  assert.equal(parseFrDate('05/03/2027'), '2027-03-05');
  assert.equal(parseFrDate('5/3/2027'), '2027-03-05');
  assert.equal(parseFrDate('29/02/2028'), '2028-02-29');
  assert.equal(parseFrDate('29/02/2027'), null);
  assert.equal(parseFrDate('31/04/2027'), null);
  assert.equal(parseFrDate('2027-03-05'), null);
  assert.equal(formatFr('2027-03-05'), '05/03/2027');
});

test('dates : calculs', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(daysBetween('2027-03-27', '2027-03-29'), 2); // passage à l'heure d'été
});

test('date du jour à Paris', () => {
  // 23:30 UTC le 31/12 = 00:30 à Paris le 01/01
  assert.equal(todayParis(new Date('2026-12-31T23:30:00Z')), '2027-01-01');
});
