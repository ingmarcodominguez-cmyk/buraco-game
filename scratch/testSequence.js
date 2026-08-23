const { validateSequence } = require('../server/gameLogic');

const cards = [
  { id: 'C-A-d1', suit: 'C', rank: 'A' },
  { id: 'C-2-d1', suit: 'C', rank: '2', isUsedAsWildcard: true, representedRank: '5' },
  { id: 'C-3-d1', suit: 'C', rank: '3' },
  { id: 'C-4-d1', suit: 'C', rank: '4' },
  { id: 'C-5-d1', suit: 'C', rank: '5' },
  { id: 'C-6-d1', suit: 'C', rank: '6' },
  { id: 'C-7-d1', suit: 'C', rank: '7' }
];

const res = validateSequence(cards);
console.log("RESULTADO:", JSON.stringify(res, null, 2));
