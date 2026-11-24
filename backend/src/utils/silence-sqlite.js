'use strict';

// node:sqlite est stable dans son usage mais encore marqué « expérimental » par
// Node : on masque uniquement cet avertissement-là, pour une console lisible.
const emettre = process.emitWarning;
process.emitWarning = function filtre(avertissement, ...args) {
  const type = typeof args[0] === 'string' ? args[0] : args[0]?.type;
  if (type === 'ExperimentalWarning' && /SQLite/i.test(String(avertissement))) return;
  return emettre.call(process, avertissement, ...args);
};
