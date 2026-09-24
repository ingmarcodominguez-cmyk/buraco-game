// testAdvancedAI.js
// Automated tests for the Advanced AI Engine in Buraco
process.env.NODE_ENV = 'test';

const {
  evaluateDiscardDangerAgainstOpponent,
  evaluatePilePotential,
  simulateBotMelding,
  performOneBotMeldActionInRoom,
  runBotDiscardPhaseInRoom,
  runBotTurnInRoom,
  isCardUsefulForFirstTurn,
  isCardCommittedToSuitRun,
  shouldHoldRunForExistingTableRun,
  validateMeld
} = require('./server');

function runAITests() {
  console.log("=== INICIANDO PRUEBAS DE INTELIGENCIA ARTIFICIAL AVANZADA ===");

  // PRUEBA 1: Regla de los 30 puntos para levantar el pozo
  console.log("\n--- Prueba 1: Regla de los 30 puntos para levantar el pozo ---");
  // Simular una sala con pozo lleno y botIdx = 1 (equipo 1)
  const roomWithUnder30 = {
    players: [],
    gameState: {
      status: 'playing',
      is4Player: false,
      players: [
        { id: 'player1', name: 'Humano', hand: [{ suit: 'H', rank: '7' }], melds: [] },
        { id: 'bot', name: 'Bot', isBot: true, hand: [{ suit: 'H', rank: '8', id: 'b1' }], melds: [
          // Solo 15 puntos en mesa: 4, 5, 6
          [{ suit: 'S', rank: '4', id: 'm1' }, { suit: 'S', rank: '5', id: 'm2' }, { suit: 'S', rank: '6', id: 'm3' }]
        ]}
      ],
      mortosTaken: [false, false],
      discardPile: [
        { suit: 'H', rank: '9', id: 'p1' },
        { suit: 'H', rank: '10', id: 'p2' },
        { suit: 'Joker', rank: 'Joker', id: 'p3' } // Pozo tentador con Joker
      ],
      drawPile: [{ suit: 'C', rank: 'A', id: 'd1' }],
      turnState: 'draw',
      lastAction: ''
    }
  };

  runBotTurnInRoom(roomWithUnder30, 1);
  // Con solo 15 puntos en mesa (< 30), el bot DEBE respetar la regla y robar del mazo (drawPile), no del pozo
  if (roomWithUnder30.gameState.discardPile.length !== 3) {
    console.error("❌ Falló Prueba 1.A: El bot tomó el pozo teniendo menos de 30 puntos en mesa!");
    process.exit(1);
  }
  console.log("✅ Prueba 1.A aprobada: Con 15 puntos (< 30 pts), el bot NO levanta el pozo (Regla de 30 puntos respetada al 100%).");

  // Ahora con 30 puntos en mesa (ej. 10, J, Q = 30 pts)
  const roomWith30 = {
    players: [],
    gameState: {
      status: 'playing',
      is4Player: false,
      players: [
        { id: 'player1', name: 'Humano', hand: [{ suit: 'H', rank: '7' }], melds: [] },
        { id: 'bot', name: 'Bot', isBot: true, hand: [{ suit: 'H', rank: '8', id: 'b1' }], melds: [
          // 30 puntos en mesa: 10, J, Q
          [{ suit: 'S', rank: '10', id: 'm1' }, { suit: 'S', rank: 'J', id: 'm2' }, { suit: 'S', rank: 'Q', id: 'm3' }]
        ]}
      ],
      mortosTaken: [false, false],
      discardPile: [
        { suit: 'H', rank: '9', id: 'p1' },
        { suit: 'H', rank: '10', id: 'p2' },
        { suit: 'Joker', rank: 'Joker', id: 'p3' } // Pozo tentador con Joker
      ],
      drawPile: [{ suit: 'C', rank: 'A', id: 'd1' }],
      turnState: 'draw',
      lastAction: ''
    }
  };

  runBotTurnInRoom(roomWith30, 1);
  if (roomWith30.gameState.discardPile.length !== 0) {
    console.error("❌ Falló Prueba 1.B: El bot no tomó el pozo a pesar de tener 30 puntos y haber un Joker!");
    process.exit(1);
  }
  console.log("✅ Prueba 1.B aprobada: Con 30 puntos (>= 30 pts), el bot levanta el pozo valioso con comodín.");


  // PRUEBA 2: Análisis de peligro en descartes (Cartas muertas y palos fríos)
  console.log("\n--- Prueba 2: Análisis de peligro en descartes (Cartas muertas y palos fríos) ---");
  const cardHot = { suit: 'H', rank: '7', id: 'c1' }; // Conector central de palo no tocado
  const cardCold = { suit: 'D', rank: '7', id: 'c2' }; // Conector del que el rival tiró 3 cartas
  const oppDiscardHist = [
    { suit: 'D', rank: '9', playerIdx: 0 },
    { suit: 'D', rank: '5', playerIdx: 0 },
    { suit: 'D', rank: 'J', playerIdx: 0 }
  ];

  const dangerHot = evaluateDiscardDangerAgainstOpponent(cardHot, [], [], null, 10, oppDiscardHist);
  const dangerCold = evaluateDiscardDangerAgainstOpponent(cardCold, [], [], null, 10, oppDiscardHist);

  console.log(`Peligro palo caliente (7 Corazón sin descartes rival): ${dangerHot.dangerScore}`);
  console.log(`Peligro palo frío (7 Diamante con 3 descartes rival): ${dangerCold.dangerScore}`);

  if (dangerCold.dangerScore >= dangerHot.dangerScore) {
    console.error("❌ Falló Prueba 2: La carta fría debería ser significativamente más segura que la caliente!");
    process.exit(1);
  }
  console.log("✅ Prueba 2 aprobada: La IA detecta correctamente el palo frío como mucho más seguro.");


  // PRUEBA 3: Protección de Canasta Limpia en construcción
  console.log("\n--- Prueba 3: Protección de Canasta Limpia en construcción ---");
  // Juego limpio de 5 cartas en mesa (4, 5, 6, 7, 8 de Picas)
  // Bot tiene un Joker en mano
  const roomCleanProtection = {
    players: [],
    gameState: {
      status: 'playing',
      is4Player: false,
      players: [
        { id: 'player1', name: 'Humano', hand: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], melds: [] },
        { 
          id: 'bot', 
          name: 'Bot', 
          isBot: true, 
          hand: [
            { suit: 'Joker', rank: 'Joker', id: 'jk1' },
            { suit: 'C', rank: 'A', id: 'other1' },
            { suit: 'C', rank: '4', id: 'other2' },
            { suit: 'C', rank: '7', id: 'other3' },
            { suit: 'C', rank: '9', id: 'other4' },
            { suit: 'C', rank: 'K', id: 'other5' }
          ], 
          melds: [
            [
              { suit: 'S', rank: '4', id: 's4' },
              { suit: 'S', rank: '5', id: 's5' },
              { suit: 'S', rank: '6', id: 's6' },
              { suit: 'S', rank: '7', id: 's7' },
              { suit: 'S', rank: '8', id: 's8' }
            ]
          ]
        }
      ],
      mortosTaken: [false, false],
      discardPile: [],
      drawPile: new Array(30).fill({ suit: 'H', rank: 'K' }),
      requiredCanastras: 1
    }
  };

  performOneBotMeldActionInRoom(roomCleanProtection, 1);
  const botMeld = roomCleanProtection.gameState.players[1].melds[0];
  const hasWildcardInClean = botMeld.some(c => c && (c.rank === 'Joker' || c.rank === '2'));
  if (hasWildcardInClean) {
    console.error("❌ Falló Prueba 3: La IA ensució una secuencia limpia de 5 cartas con un Joker en juego normal!");
    process.exit(1);
  }
  console.log("✅ Prueba 3 aprobada: La IA protege la canasta limpia (no inserta comodín para no perder 200 pts).");


  // PRUEBA 4: Conservación de Comodines (No quemar comodines en corridas de 3 cartas tempranas)
  console.log("\n--- Prueba 4: Conservación de comodines temprana ---");
  // Bot tiene 1 Joker y dos 5s en mano (trío sucio). Con 1 solo comodín, no debe quemarlo
  const roomWildcardCons = {
    players: [],
    gameState: {
      status: 'playing',
      is4Player: false,
      players: [
        { id: 'player1', name: 'Humano', hand: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], melds: [] },
        { 
          id: 'bot', 
          name: 'Bot', 
          isBot: true, 
          hand: [
            { suit: 'H', rank: '5', id: 'h5' },
            { suit: 'D', rank: '5', id: 'd5' },
            { suit: 'Joker', rank: 'Joker', id: 'jk1' },
            { suit: 'C', rank: 'A', id: 'other1' },
            { suit: 'C', rank: '4', id: 'other2' },
            { suit: 'C', rank: '7', id: 'other3' },
            { suit: 'C', rank: '9', id: 'other4' },
            { suit: 'C', rank: 'K', id: 'other5' }
          ], 
          melds: []
        }
      ],
      mortosTaken: [false, false],
      discardPile: [{ suit: 'H', rank: '4' }], // Pozo de 1 carta ordinaria sin valor
      drawPile: new Array(30).fill({ suit: 'H', rank: 'K' }),
      requiredCanastras: 1
    }
  };

  const didAction = performOneBotMeldActionInRoom(roomWildcardCons, 1);
  if (didAction) {
    console.error("❌ Falló Prueba 4: La IA quemó su único comodín en una combinación sucia temprana de < 30 pts!");
    process.exit(1);
  }
  console.log("✅ Prueba 4 aprobada: La IA conserva su único comodín en mano.");


  // PRUEBA 5: Habilitación de corte con 1 carta restante
  console.log("\n--- Prueba 5: Habilitación de corte con 1 carta en mano ---");
  // Bot tiene muerto tomado, 1 canasta de 7, y le quedan 4 cartas: 3 de un trío y 1 descarte
  const roomBatidaPrep = {
    players: [],
    gameState: {
      status: 'playing',
      is4Player: false,
      players: [
        { id: 'player1', name: 'Humano', hand: [1, 2, 3, 4, 5], melds: [] },
        { 
          id: 'bot', 
          name: 'Bot', 
          isBot: true, 
          hand: [
            { suit: 'H', rank: 'K', id: 'k1' },
            { suit: 'D', rank: 'K', id: 'k2' },
            { suit: 'S', rank: 'K', id: 'k3' },
            { suit: 'C', rank: '3', id: 'discardCard' } // Carta para el descarte final
          ], 
          melds: [
            // Canasta de 7
            [
              { suit: 'H', rank: '3' }, { suit: 'H', rank: '4' }, { suit: 'H', rank: '5' },
              { suit: 'H', rank: '6' }, { suit: 'H', rank: '7' }, { suit: 'H', rank: '8' }, { suit: 'H', rank: '9' }
            ]
          ]
        }
      ],
      mortosTaken: [true, true], // Ya tiene muerto
      discardPile: [],
      drawPile: new Array(20).fill({ suit: 'H', rank: 'A' }),
      requiredCanastras: 1
    }
  };

  performOneBotMeldActionInRoom(roomBatidaPrep, 1);
  if (roomBatidaPrep.gameState.players[1].hand.length !== 1) {
    console.error(`❌ Falló Prueba 5: Se esperaba que quedara con 1 carta para descartar, pero tiene ${roomBatidaPrep.gameState.players[1].hand.length}`);
    process.exit(1);
  }
  console.log("✅ Prueba 5.A aprobada: La IA baja sus cartas quedando con 1 carta lista para el corte.");

  runBotDiscardPhaseInRoom(roomBatidaPrep, 1);
  if (roomBatidaPrep.gameState.status !== 'finished-visual') {
    console.error("❌ Falló Prueba 5.B: La IA debería haber cerrado la mano al tener canasta y descartar su última carta!");
    process.exit(1);
  }
  console.log("✅ Prueba 5.B aprobada: La IA descarta su última carta al pozo y bate legalmente.");


  // PRUEBA 6: Sin canasta, la IA NUNCA baja quedándose con 1 carta ni pasa sin descartar
  console.log("\n--- Prueba 6: Sin canasta, prohibido bajar a 1 carta y descarte obligatorio ---");
  const roomNoCanasta = {
    players: [],
    gameState: {
      status: 'playing',
      is4Player: false,
      players: [
        { id: 'player1', name: 'Humano', hand: [1, 2, 3, 4, 5], melds: [] },
        { 
          id: 'bot', 
          name: 'Bot', 
          isBot: true, 
          hand: [
            { suit: 'H', rank: 'K', id: 'k1' },
            { suit: 'D', rank: 'K', id: 'k2' },
            { suit: 'S', rank: 'K', id: 'k3' },
            { suit: 'C', rank: '3', id: 'discardCard' }
          ], 
          melds: [
            // 0 canastas: solo un juego de 5 cartas
            [
              { suit: 'H', rank: '3' }, { suit: 'H', rank: '4' }, { suit: 'H', rank: '5' },
              { suit: 'H', rank: '6' }, { suit: 'H', rank: '7' }
            ]
          ]
        }
      ],
      mortosTaken: [true, true], // Tiene muerto pero 0 canastas
      discardPile: [],
      drawPile: new Array(20).fill({ suit: 'H', rank: 'A' }),
      requiredCanastras: 1
    }
  };

  // Intentar bajar: con 4 cartas (trío de K + 1 carta), si baja el trío quedaría con 1 carta sin canasta
  const didMeldWithoutCanasta = performOneBotMeldActionInRoom(roomNoCanasta, 1);
  if (didMeldWithoutCanasta) {
    console.error("❌ Falló Prueba 6.A: La IA bajó quedándose con 1 carta sin tener canastas!");
    process.exit(1);
  }
  console.log("✅ Prueba 6.A aprobada: La IA NO baja a 1 carta si no tiene canastas (retiene mínimo 2 cartas).");

  // Fase de descarte: DEBE descartar obligatoriamente al pozo
  runBotDiscardPhaseInRoom(roomNoCanasta, 1);
  if (roomNoCanasta.gameState.discardPile.length !== 1) {
    console.error("❌ Falló Prueba 6.B: La IA no descartó al pozo! (Quedó vacío)");
    process.exit(1);
  }
  if (roomNoCanasta.gameState.players[1].hand.length !== 3) {
    console.error("❌ Falló Prueba 6.B: La IA debería tener 3 cartas tras descartar 1!");
    process.exit(1);
  }
  console.log("✅ Prueba 6.B aprobada: La IA descartó obligatoriamente al pozo (el pozo nunca queda sin descarte).");

  // PRUEBA 7: Pozo pequeño (<= 2 cartas) sin comodines ni bajada inmediata
  // La IA NO debe levantarlo aunque tenga una carta conectora suelta en mano (ej. 3 de pique con 4 de pique)
  console.log("\n--- Prueba 7: Pozo pequeño (1-2 cartas) sin comodines ni bajada inmediata ---");
  const roomSmallPozo = {
    players: [],
    gameState: {
      status: 'playing',
      is4Player: false,
      players: [
        { id: 'player1', name: 'Humano', hand: [{ suit: 'H', rank: '7' }], melds: [] },
        { 
          id: 'bot', 
          name: 'Bot', 
          isBot: true, 
          hand: [
            { suit: 'S', rank: '4', id: 'bot_4s' },
            { suit: 'D', rank: '8', id: 'bot_8d' },
            { suit: 'H', rank: 'A', id: 'bot_ah' }
          ], 
          melds: [
            // Tiene más de 30 puntos en mesa (30 pts)
            [{ suit: 'S', rank: '10', id: 'm1' }, { suit: 'S', rank: 'J', id: 'm2' }, { suit: 'S', rank: 'Q', id: 'm3' }]
          ]
        }
      ],
      mortosTaken: [false, false],
      // Pozo de 2 cartas: Q de trébol y 3 de pique (como en el caso reportado por el usuario)
      discardPile: [
        { suit: 'C', rank: 'Q', id: 'pile_qc' },
        { suit: 'S', rank: '3', id: 'pile_3s' }
      ],
      drawPile: [{ suit: 'H', rank: '5', id: 'deck_5h' }],
      turnState: 'draw',
      lastAction: ''
    }
  };

  runBotTurnInRoom(roomSmallPozo, 1);
  if (roomSmallPozo.gameState.discardPile.length === 0) {
    console.error("❌ Falló Prueba 7: La IA levantó un pozo de 2 cartas sin comodines y sin bajada inmediata!");
    process.exit(1);
  }
  if (!roomSmallPozo.gameState.players[1].hand.some(c => c.id === 'deck_5h')) {
    console.error("❌ Falló Prueba 7: La IA no robó del mazo!");
    process.exit(1);
  }
  console.log("✅ Prueba 7 aprobada: La IA NO levanta pozos de 1-2 cartas por simples conexiones sueltas; roba del mazo.");

  // PRUEBA 8: Coherencia de descarte (Nunca tirar de vuelta una carta recién levantada del pozo)
  console.log("\n--- Prueba 8: Coherencia de descarte tras levantar pozo ---");
  const roomCoherence = {
    players: [],
    gameState: {
      status: 'playing',
      is4Player: false,
      players: [
        { id: 'player1', name: 'Humano', hand: [{ suit: 'H', rank: '7' }], melds: [] },
        { 
          id: 'bot', 
          name: 'Bot', 
          isBot: true, 
          hand: [
            { suit: 'D', rank: '9', id: 'hand_9d' },
            { suit: 'C', rank: '8', id: 'hand_8c' },
            { suit: 'S', rank: '3', id: 'picked_3s' } // Carta que vino del pozo
          ], 
          melds: []
        }
      ],
      mortosTaken: [false, false],
      discardPile: [],
      drawPile: [{ suit: 'H', rank: '5', id: 'deck_card' }],
      turnState: 'discard',
      lastAction: ''
    },
    lastPickedDiscardCardIds: new Set(['picked_3s'])
  };

  runBotDiscardPhaseInRoom(roomCoherence, 1);
  const discardedCard = roomCoherence.gameState.discardPile[roomCoherence.gameState.discardPile.length - 1];
  if (discardedCard.id === 'picked_3s') {
    console.error("❌ Falló Prueba 8: La IA descartó la misma carta que recién levantó del pozo!");
    process.exit(1);
  }
  console.log(`✅ Prueba 8 aprobada: La IA conservó la carta levantada del pozo (${discardedCard.rank} de ${discardedCard.suit} fue descartada en su lugar).`);

  // PRUEBA 9: Bajada de corrida limpia de 3 cartas (4-5-6 de pique) teniendo ya 30 puntos en mesa
  console.log("\n--- Prueba 9: Bajada de corrida limpia de 3 cartas (4-5-6 de pique) ---");
  const roomClean3 = {
    players: [],
    gameState: {
      status: 'playing',
      is4Player: false,
      players: [
        { id: 'player1', name: 'Humano', hand: [1, 2, 3], melds: [] },
        { 
          id: 'bot', 
          name: 'Bot', 
          isBot: true, 
          hand: [
            { suit: 'S', rank: '4', id: 's4' },
            { suit: 'S', rank: '5', id: 's5' },
            { suit: 'S', rank: '6', id: 's6' },
            { suit: 'D', rank: '3', id: 'd3' },
            { suit: 'D', rank: '10', id: 'd10' },
            { suit: 'H', rank: '6', id: 'h6' },
            { suit: 'H', rank: '10', id: 'h10' },
            { suit: 'H', rank: 'J', id: 'hj' }
          ], 
          melds: [
            // Ya tiene 30 puntos en mesa (Trío de Reinas)
            [{ suit: 'S', rank: 'Q' }, { suit: 'C', rank: 'Q' }, { suit: 'H', rank: 'Q' }]
          ]
        }
      ],
      mortosTaken: [false, false],
      discardPile: [{ suit: 'S', rank: '5', id: 'pozo_5s' }],
      drawPile: new Array(50).fill({ suit: 'C', rank: '2' }),
      turnState: 'play',
      lastAction: ''
    }
  };

  const meldSuccess = performOneBotMeldActionInRoom(roomClean3, 1);
  if (!meldSuccess) {
    console.error("❌ Falló Prueba 9: La IA no bajó la corrida limpia de 3 cartas (4-5-6 de pique)!");
    process.exit(1);
  }
  const has456Meld = roomClean3.gameState.players[1].melds.some(m => 
    m.length === 3 && m.some(c => c.rank === '4') && m.some(c => c.rank === '5') && m.some(c => c.rank === '6')
  );
  if (!has456Meld) {
    console.error("❌ Falló Prueba 9: No se encontró la corrida 4-5-6 en los juegos bajados de la IA!");
    process.exit(1);
  }
  console.log("✅ Prueba 9 aprobada: La IA bajó exitosamente la corrida limpia 4-5-6 de pique a la mesa.");

  // PRUEBA 10: Protección contra el descarte de conectores frente a cartas basura aisladas
  // Aunque el rival haya tirado 5 de pique antes (carta fría con dangerScore negativo),
  // la IA que tiene 4 de pique y 6 de pique en mano NUNCA debe descartar el 5 de pique
  // si tiene cartas basura aisladas (ej. 3 de diamante o 10 de diamante sin compañeros).
  console.log("\n--- Prueba 10: Protección de conector clave frente a cartas basura aisladas ---");
  const roomDiscardSafety = {
    players: [],
    gameState: {
      status: 'playing',
      is4Player: false,
      players: [
        { id: 'player1', name: 'Humano', hand: [1, 2, 3], melds: [] },
        { 
          id: 'bot', 
          name: 'Bot', 
          isBot: true, 
          hand: [
            { suit: 'S', rank: '4', id: 'hand_4s' },
            { suit: 'S', rank: '5', id: 'hand_5s' }, // Conecta 4 y 6
            { suit: 'S', rank: '6', id: 'hand_6s' },
            { suit: 'D', rank: '3', id: 'trash_3d' }, // Basura aislada total
            { suit: 'D', rank: '10', id: 'trash_10d' } // Basura aislada total
          ], 
          melds: [
            [{ suit: 'S', rank: 'Q' }, { suit: 'C', rank: 'Q' }, { suit: 'H', rank: 'Q' }]
          ]
        }
      ],
      mortosTaken: [false, false],
      discardPile: [],
      drawPile: new Array(50).fill({ suit: 'C', rank: '2' }),
      turnState: 'discard',
      lastAction: '',
      aiMemory: {
        discardHistory: [
          // El rival ya tiró 5 de pique (haciéndola parecer "fría / segura")
          { suit: 'S', rank: '5', playerIdx: 0 }
        ]
      }
    }
  };

  runBotDiscardPhaseInRoom(roomDiscardSafety, 1);
  const thrownCard = roomDiscardSafety.gameState.discardPile[roomDiscardSafety.gameState.discardPile.length - 1];
  if (thrownCard.rank === '5' && thrownCard.suit === 'S') {
    console.error("❌ Falló Prueba 10: La IA descartó el 5 de pique rompiendo su juego!");
    process.exit(1);
  }
  if (thrownCard.suit === 'S') {
    console.error(`❌ Falló Prueba 10: La IA descartó una carta de pique (${thrownCard.rank} de ${thrownCard.suit}) en lugar de la basura aislada!`);
    process.exit(1);
  }
  console.log(`✅ Prueba 10 aprobada: La IA descartó la carta basura (${thrownCard.rank} de ${thrownCard.suit}) y preservó intacto su juego de piques.`);

  // PRUEBA 11: Técnica del primer descarte de la mano (Truco de la primera carta)
  console.log("\n--- Prueba 11: Técnica de descarte de la primera carta que no sirve (Mano) ---");
  const handNoMelds = [
    { suit: 'H', rank: '4', id: 'h4' },
    { suit: 'H', rank: '8', id: 'h8' },
    { suit: 'S', rank: '3', id: 's3' },
    { suit: 'S', rank: '9', id: 's9' },
    { suit: 'D', rank: '6', id: 'd6' },
    { suit: 'C', rank: 'K', id: 'ck' }
  ];

  // 11.A: Si roba un conector con hueco (ej. 6 de corazón con 4 y 8) o una pareja suelta, NO sirve
  const gutshotCard = { suit: 'H', rank: '6', id: 'draw_h6' };
  const pairCard = { suit: 'C', rank: 'K', id: 'draw_ck' };
  const wildcardCard = { suit: 'D', rank: '2', id: 'draw_d2' };
  const jokerCard = { suit: 'Joker', rank: 'Joker', id: 'draw_joker' };
  const meldCard = { suit: 'H', rank: '5', id: 'draw_h5' }; // Si tuviéramos 4 y 6 formaría 4-5-6

  if (isCardUsefulForFirstTurn(gutshotCard, handNoMelds)) {
    console.error("❌ Falló Prueba 11.A: isCardUsefulForFirstTurn no debería considerar útil un simple conector con hueco en el turno 1!");
    process.exit(1);
  }
  if (isCardUsefulForFirstTurn(pairCard, handNoMelds)) {
    console.error("❌ Falló Prueba 11.A: isCardUsefulForFirstTurn no debería considerar útil una simple pareja en el turno 1!");
    process.exit(1);
  }
  if (!isCardUsefulForFirstTurn(wildcardCard, handNoMelds)) {
    console.error("❌ Falló Prueba 11.A: isCardUsefulForFirstTurn DEBE considerar útil un 2 comodín!");
    process.exit(1);
  }
  if (!isCardUsefulForFirstTurn(jokerCard, handNoMelds)) {
    console.error("❌ Falló Prueba 11.A: isCardUsefulForFirstTurn DEBE considerar útil un Joker!");
    process.exit(1);
  }
  console.log("✅ Prueba 11.A aprobada: isCardUsefulForFirstTurn rechaza correctamente cartas que no hacen juego y acepta comodines.");

  // 11.B: Verificación de ejecución del bot en sala cuando es mano (isFirstTurn === true)
  const roomFirstTurn = {
    players: [
      { id: 'player1', name: 'Humano', hand: [1, 2, 3], melds: [] },
      { 
        id: 'bot', 
        name: 'Bot', 
        isBot: true, 
        hand: [
          { suit: 'H', rank: '4', id: 'h4' },
          { suit: 'H', rank: '8', id: 'h8' },
          { suit: 'S', rank: 'K', id: 'sk' }
        ], 
        melds: []
      }
    ],
    gameState: {
      status: 'playing',
      is4Player: false,
      players: [
        { id: 'player1', name: 'Humano', hand: [1, 2, 3], melds: [] },
        { 
          id: 'bot', 
          name: 'Bot', 
          isBot: true, 
          hand: [
            { suit: 'H', rank: '4', id: 'h4' },
            { suit: 'H', rank: '8', id: 'h8' },
            { suit: 'S', rank: 'K', id: 'sk' }
          ], 
          melds: []
        }
      ],
      mortosTaken: [false, false],
      discardPile: [],
      // Primera carta en la cima del mazo: una carta inútil (ej. 10 de Diamante)
      // Segunda carta: un 7 de Diamante
      drawPile: [
        { suit: 'D', rank: '7', id: 'deck_d7' },
        { suit: 'D', rank: '10', id: 'first_d10' }
      ],
      turnState: 'draw',
      isFirstTurn: true,
      lastAction: ''
    }
  };

  runBotTurnInRoom(roomFirstTurn, 1);

  // La primera carta (10 de Diamante) debe haber sido descartada al pozo
  if (roomFirstTurn.gameState.discardPile.length === 0 || roomFirstTurn.gameState.discardPile[0].id !== 'first_d10') {
    console.error("❌ Falló Prueba 11.B: La IA no usó el truco de descartar la primera carta al pozo!");
    process.exit(1);
  }
  // La IA debe haber robado la segunda carta (7 de Diamante)
  if (!roomFirstTurn.gameState.players[1].hand.some(c => c.id === 'deck_d7')) {
    console.error("❌ Falló Prueba 11.B: La IA no robó la segunda carta del mazo!");
    process.exit(1);
  }
  // isFirstTurn debe haber quedado en false
  if (roomFirstTurn.gameState.isFirstTurn) {
    console.error("❌ Falló Prueba 11.B: isFirstTurn debería haber quedado en false tras usar el truco!");
    process.exit(1);
  }
  console.log("✅ Prueba 11.B aprobada: La IA ejecutó exitosamente el truco de la primera mano (descartó al pozo y robó otra).");

  // PRUEBA 12: Protección de cartas comprometidas con escalera contra canibalización por tríos
  // (Caso real: Bot tiene 6♣ y 8♣ en mano, y 5♣, 5♣, 5♠. Debe preservar los 5♣ y NO bajar el trío [5♣, 5♣, 5♠])
  console.log("\n--- Prueba 12: Protección de cartas de escalera frente a tríos (caso 5♣-5♣-5♠ con 6♣-8♣) ---");
  const roomStraightProtection = {
    players: [],
    gameState: {
      status: 'playing',
      is4Player: false,
      players: [
        { id: 'player1', name: 'Humano', hand: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], melds: [] },
        { 
          id: 'bot', 
          name: 'Bot', 
          isBot: true, 
          hand: [
            { suit: 'C', rank: '5', id: 'c5_1' },
            { suit: 'C', rank: '5', id: 'c5_2' },
            { suit: 'S', rank: '5', id: 's5_1' },
            { suit: 'C', rank: '6', id: 'c6' },
            { suit: 'C', rank: '8', id: 'c8' },
            { suit: 'S', rank: '7', id: 's7' },
            { suit: 'S', rank: '8', id: 's8' },
            { suit: 'H', rank: '2', id: 'h2' } // Comodín 2
          ], 
          melds: []
        }
      ],
      mortosTaken: [false, false],
      discardPile: [{ suit: 'D', rank: 'K' }],
      drawPile: new Array(30).fill({ suit: 'H', rank: 'A' }),
      requiredCanastras: 1
    }
  };

  // Verificar primero la función auxiliar isCardCommittedToSuitRun
  const testHand = roomStraightProtection.gameState.players[1].hand;
  const c5_1 = testHand[0];
  const s5_1 = testHand[2];
  if (!isCardCommittedToSuitRun(c5_1, testHand, [])) {
    console.error("❌ Falló Prueba 12: 5♣ debería detectarse como comprometido con la escalera de tréboles (6♣-8♣)!");
    process.exit(1);
  }
  if (!isCardCommittedToSuitRun(s5_1, testHand, [])) {
    console.error("❌ Falló Prueba 12: 5♠ debería detectarse como comprometido con la escalera de piques (7♠-8♠)!");
    process.exit(1);
  }

  // Ejecutar acción de bajada del bot: NO debe bajar el trío de 5s [5♣, 5♣, 5♠]
  performOneBotMeldActionInRoom(roomStraightProtection, 1);
  const botMeldsAfter = roomStraightProtection.gameState.players[1].melds;
  const loweredTrioOfFives = botMeldsAfter.some(m => m.every(c => c.rank === '5'));
  if (loweredTrioOfFives) {
    console.error("❌ Falló Prueba 12: La IA canibalizó sus 5♣ en un trío de 15 pts en vez de guardarlos para la escalera!");
    process.exit(1);
  }
  console.log("✅ Prueba 12 aprobada: La IA protege sus 5s para las escaleras de tréboles y piques y no baja el trío.");

  // PRUEBA 13: Acople del 2 natural a canasta con Joker para Morto Directo
  console.log("\n--- Prueba 13: Acople del 2 natural de la pinta a canasta con Joker para ir al Muerto ---");
  const roomMortoNatural2 = {
    players: [],
    gameState: {
      status: 'playing',
      is4Player: false,
      players: [
        { id: 'player1', name: 'Humano', hand: [1, 2, 3], melds: [] },
        { 
          id: 'bot', 
          name: 'Bot', 
          isBot: true, 
          hand: [
            { suit: 'S', rank: '2', id: '2s' } // Única carta en mano: 2 de Piques (natural)
          ], 
          melds: [
            // Canasta o escalera de piques con Joker: 3♠, Joker, 5♠, 6♠, 7♠, 4♠
            [
              { suit: 'S', rank: '3', id: 's3' },
              { suit: 'Joker', rank: 'Joker', id: 'jk', isUsedAsWildcard: true },
              { suit: 'S', rank: '5', id: 's5' },
              { suit: 'S', rank: '6', id: 's6' },
              { suit: 'S', rank: '7', id: 's7' },
              { suit: 'S', rank: '4', id: 's4' }
            ]
          ]
        }
      ],
      mortosTaken: [false, false],
      mortos: [
        [{ suit: 'H', rank: 'A' }, { suit: 'H', rank: 'K' }],
        [{ suit: 'D', rank: 'A' }, { suit: 'D', rank: 'K' }]
      ],
      discardPile: [],
      drawPile: new Array(30).fill({ suit: 'H', rank: 'A' }),
      requiredCanastras: 1
    }
  };

  const didMeldNatural2 = performOneBotMeldActionInRoom(roomMortoNatural2, 1);
  if (!didMeldNatural2) {
    console.error("❌ Falló Prueba 13: La IA NO acopló el 2 de Piques a la canasta de piques con Joker!");
    process.exit(1);
  }
  if (roomMortoNatural2.gameState.players[1].hand.length !== 2) { // 2 cartas del muerto tomado
    console.error(`❌ Falló Prueba 13: La IA debería haber vaciado su mano y tomado el muerto (esperadas 2 cartas del muerto, encontradas ${roomMortoNatural2.gameState.players[1].hand.length})`);
    process.exit(1);
  }
  console.log("✅ Prueba 13 aprobada: La IA acopló el 2 de Piques natural a la canasta con Joker y tomó el Muerto Directo.");

  // PRUEBA 14: Protección contra división de palo (No cortar canasta bajando segunda corrida del mismo palo)
  // Caso real del usuario: Mesa tiene [4♦, 5♦, 6♦, Joker (7♦), 8♦] (5 cartas, falta 9♦ para canasta).
  // Mano tiene [10♦, J♦, Q♦].
  // La IA DEBE retener [10♦, J♦, Q♦] en mano esperando el 9♦ para meter un canastón de 9 cartas,
  // y NO bajarla por separado cortando definitivamente la canasta.
  console.log("\n--- Prueba 14: Protección contra división de palo (caso 4♦-8♦ en mesa y 10♦-J♦-Q♦ en mano) ---");
  const roomCanastaSeverance = {
    players: [],
    gameState: {
      status: 'playing',
      is4Player: false,
      players: [
        { id: 'player1', name: 'Humano', hand: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], melds: [] },
        { 
          id: 'bot', 
          name: 'Bot', 
          isBot: true, 
          hand: [
            { suit: 'D', rank: '10', id: 'd10' },
            { suit: 'D', rank: 'J', id: 'dj' },
            { suit: 'D', rank: 'Q', id: 'dq' },
            { suit: 'S', rank: 'K', id: 'sk' },
            { suit: 'H', rank: '3', id: 'h3' }
          ], 
          melds: [
            // Corrida de tréboles
            [
              { suit: 'C', rank: '4', id: 'c4' },
              { suit: 'C', rank: '2', id: 'c2', isUsedAsWildcard: true, representedRank: '5' },
              { suit: 'C', rank: '6', id: 'c6' },
              { suit: 'C', rank: '7', id: 'c7' },
              { suit: 'C', rank: '8', id: 'c8' }
            ],
            // Corrida de diamantes a falta de 9♦ para canasta
            [
              { suit: 'D', rank: '4', id: 'd4' },
              { suit: 'D', rank: '5', id: 'd5' },
              { suit: 'D', rank: '6', id: 'd6' },
              { suit: 'Joker', rank: 'Joker', id: 'jk', isUsedAsWildcard: true, representedRank: '7' },
              { suit: 'D', rank: '8', id: 'd8' }
            ]
          ]
        }
      ],
      mortosTaken: [false, false],
      mortos: [
        [{ suit: 'H', rank: 'A' }, { suit: 'H', rank: 'K' }],
        [{ suit: 'D', rank: 'A' }, { suit: 'D', rank: 'K' }]
      ],
      discardPile: [{ suit: 'S', rank: '3' }],
      drawPile: new Array(30).fill({ suit: 'H', rank: 'A' }),
      requiredCanastras: 1
    }
  };

  const botMeldsInitial = roomCanastaSeverance.gameState.players[1].melds;
  const candidateDiamondRun = [
    { suit: 'D', rank: '10', id: 'd10' },
    { suit: 'D', rank: 'J', id: 'dj' },
    { suit: 'D', rank: 'Q', id: 'dq' }
  ];

  // 14.A: Verificar que shouldHoldRunForExistingTableRun detecta la corrida como retenida
  if (!shouldHoldRunForExistingTableRun(candidateDiamondRun, botMeldsInitial, false)) {
    console.error("❌ Falló Prueba 14.A: shouldHoldRunForExistingTableRun debería retener 10-J-Q de diamante por presencia de 4-8 de diamante en mesa!");
    process.exit(1);
  }
  console.log("✅ Prueba 14.A aprobada: shouldHoldRunForExistingTableRun identifica correctamente que se debe retener en mano.");

  // 14.B: Ejecutar la fase de bajada del bot: NO debe bajar 10♦-J♦-Q♦ por separado
  const didLowerSeparateMeld = performOneBotMeldActionInRoom(roomCanastaSeverance, 1);
  if (didLowerSeparateMeld) {
    console.error("❌ Falló Prueba 14.B: La IA bajó 10♦-J♦-Q♦ como juego separado cortando la canasta de diamantes!");
    process.exit(1);
  }
  if (roomCanastaSeverance.gameState.players[1].melds.length !== 2) {
    console.error("❌ Falló Prueba 14.B: Se esperaba que los melds continuaran siendo 2, pero hay " + roomCanastaSeverance.gameState.players[1].melds.length);
    process.exit(1);
  }
  console.log("✅ Prueba 14.B aprobada: La IA NO bajó 10♦-J♦-Q♦ por separado; esperó en mano.");

  // 14.C: Simular que el bot consigue el 9♦ (por robo o pozo). Al llegar el 9♦, acopla 9, 10, J, Q a la mesa logrando un Canastón
  roomCanastaSeverance.gameState.players[1].hand.push({ suit: 'D', rank: '9', id: 'd9' });
  
  // Paso 1: Acopla 9♦
  performOneBotMeldActionInRoom(roomCanastaSeverance, 1);
  // Paso 2: Acopla 10♦
  performOneBotMeldActionInRoom(roomCanastaSeverance, 1);
  // Paso 3: Acopla J♦
  performOneBotMeldActionInRoom(roomCanastaSeverance, 1);
  // Paso 4: Acopla Q♦
  performOneBotMeldActionInRoom(roomCanastaSeverance, 1);

  const diamondMeldAfter = roomCanastaSeverance.gameState.players[1].melds[1];
  if (diamondMeldAfter.length !== 9) {
    console.error(`❌ Falló Prueba 14.C: Se esperaba una canasta de 9 cartas, pero tiene ${diamondMeldAfter.length} cartas!`);
    process.exit(1);
  }
  console.log("✅ Prueba 14.C aprobada: Al conseguir el 9♦, la IA acopló exitosamente toda la secuencia formando un Canastón de 9 cartas!");

  console.log("\n=== ¡TODAS LAS PRUEBAS DE INTELIGENCIA ARTIFICIAL PASARON EXITOSAMENTE! ===");
  process.exit(0);
}

runAITests();
