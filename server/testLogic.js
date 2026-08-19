// testLogic.js
// Prueba automatizada de la lógica de Buraco

const { createDeck, validateSequence, initGame, calculateRoundScores } = require('./gameLogic');

function runTests() {
  console.log("=== INICIANDO PRUEBAS DE LÓGICA DE BURACO ===");

  // Prueba 1: Estructura del Mazo
  const deck = createDeck();
  if (deck.length !== 108) {
    console.error(`❌ Falló Prueba 1: El mazo tiene ${deck.length} cartas en lugar de 108.`);
    process.exit(1);
  }
  const jokers = deck.filter(c => c.rank === 'Joker');
  if (jokers.length !== 4) {
    console.error(`❌ Falló Prueba 1: Hay ${jokers.length} Jokers en lugar de 4.`);
    process.exit(1);
  }
  console.log("✅ Prueba 1 aprobada: Mazo de 108 cartas y 4 Jokers creados correctamente.");

  // Prueba 2: Inicialización del juego
  const state = initGame();
  if (state.players[0].hand.length !== 11 || state.players[1].hand.length !== 11) {
    console.error(`❌ Falló Prueba 2: Las manos iniciales no tienen 11 cartas.`);
    process.exit(1);
  }
  if (state.mortos[0].length !== 11 || state.mortos[1].length !== 11) {
    console.error(`❌ Falló Prueba 2: Los muertos no tienen 11 cartas.`);
    process.exit(1);
  }
  console.log("✅ Prueba 2 aprobada: Reparto inicial y preparación de muertos correctos.");

  // Prueba 3: Validación de Secuencia Limpia (3-4-5-6-7-8-9 de Corazones)
  const cleanSeqCards = [
    { suit: 'H', rank: '3' },
    { suit: 'H', rank: '4' },
    { suit: 'H', rank: '5' },
    { suit: 'H', rank: '6' },
    { suit: 'H', rank: '7' },
    { suit: 'H', rank: '8' },
    { suit: 'H', rank: '9' }
  ];
  const cleanResult = validateSequence(cleanSeqCards);
  if (!cleanResult.valid || !cleanResult.clean || !cleanResult.isCanastra || cleanResult.canastraType !== 'limpa') {
    console.error("❌ Falló Prueba 3: Secuencia limpia válida no fue catalogada correctamente.", cleanResult);
    process.exit(1);
  }
  console.log("✅ Prueba 3 aprobada: Secuencia limpia y Canastra Limpia validadas correctamente.");

  // Prueba 4: Validación de Secuencia Sucia (3-4-2(comodín)-6 de Corazones)
  const dirtySeqCards = [
    { suit: 'H', rank: '3' },
    { suit: 'H', rank: '4' },
    { suit: 'S', rank: '2' }, // comodín (pica de otro palo)
    { suit: 'H', rank: '6' }
  ];
  const dirtyResult = validateSequence(dirtySeqCards);
  if (!dirtyResult.valid || dirtyResult.clean) {
    console.error("❌ Falló Prueba 4: Secuencia sucia válida no fue catalogada correctamente.", dirtyResult);
    process.exit(1);
  }
  console.log("✅ Prueba 4 aprobada: Secuencia sucia con comodín validada correctamente.");

  // Prueba 5: Secuencia Inválida (demasiados comodines o palos mezclados)
  const invalidCards = [
    { suit: 'H', rank: '3' },
    { suit: 'D', rank: '4' }, // Distinto palo
    { suit: 'H', rank: '5' }
  ];
  const invalidResult = validateSequence(invalidCards);
  if (invalidResult.valid) {
    console.error("❌ Falló Prueba 5: Se aprobó una secuencia con palos mezclados como válida.");
    process.exit(1);
  }
  console.log("✅ Prueba 5 aprobada: Secuencia con palos mezclados rechazada correctamente.");

  // Prueba 6: Valor de Joker igual a 50
  const { CARD_VALUES } = require('./gameLogic');
  if (CARD_VALUES['Joker'] !== 50) {
    console.error(`❌ Falló Prueba 6: El Joker vale ${CARD_VALUES['Joker']} puntos en lugar de 50.`);
    process.exit(1);
  }
  console.log("✅ Prueba 6 aprobada: Valor del Joker configurado en 50 puntos correctamente.");

  console.log("=== ¡TODAS LAS PRUEBAS DE LÓGICA PASARON CON ÉXITO! ===");
}

runTests();
