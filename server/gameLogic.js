// gameLogic.js
// Lógica de juego del Buraco Abierto

const CARD_VALUES = {
  'A': 15,
  '2': 20,
  '3': 5,
  '4': 5,
  '5': 5,
  '6': 5,
  '7': 5,
  '8': 10,
  '9': 10,
  '10': 10,
  'J': 10,
  'Q': 10,
  'K': 10,
  'Joker': 50
};

// Genera un mazo doble de 108 cartas
function createDeck() {
  const suits = ['H', 'D', 'C', 'S']; // Hearts, Diamonds, Clubs, Spades
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  let deck = [];

  // 2 mazos
  for (let d = 1; d <= 2; d++) {
    // Cartas estándar
    for (let suit of suits) {
      for (let rank of ranks) {
        deck.push({
          id: `${suit}-${rank}-d${d}`,
          suit,
          rank,
          value: CARD_VALUES[rank]
        });
      }
    }
    // 2 Jokers por mazo (total 4)
    for (let j = 1; j <= 2; j++) {
      deck.push({
        id: `Joker-${j}-d${d}`,
        suit: 'Joker',
        rank: 'Joker',
        value: CARD_VALUES['Joker']
      });
    }
  }
  return deck;
}

// Mezcla el mazo (Fisher-Yates)
function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// Valida si un arreglo de cartas forma una secuencia válida de Buraco
function validateSequence(cards) {
  if (cards.length < 3) {
    return { valid: false, error: 'Una secuencia debe tener al menos 3 cartas.' };
  }

  // Filtrar cartas que no son comodines (ni Joker ni "2")
  const naturalCards = cards.filter(c => c.rank !== 'Joker' && c.rank !== '2');

  if (naturalCards.length === 0) {
    return { valid: false, error: 'La secuencia debe contener cartas naturales.' };
  }

  // En Buraco todas las cartas naturales deben ser del mismo palo
  const suit = naturalCards[0].suit;
  if (naturalCards.some(c => c.suit !== suit)) {
    return { valid: false, error: 'Todas las cartas naturales deben ser del mismo palo.' };
  }

  const N = cards.length;
  if (N > 14) {
    return { valid: false, error: 'Una secuencia no puede tener más de 14 cartas.' };
  }

  const validLayouts = [];

  // Probamos todas las posiciones iniciales posibles de la secuencia (de 1 a 15-N)
  // Ace low = 1, Natural 2 = 2, 3..13 = 3..13, Ace high = 14
  for (let start = 1; start <= 15 - N; start++) {
    const slots = [];
    for (let i = 0; i < N; i++) {
      slots.push(start + i);
    }

    let tempCards = [...cards];
    const layout = new Array(N).fill(null);
    const wildcardSlots = [];

    // Primera pasada: intentar emparejar cartas naturales en sus posiciones naturales
    for (let i = 0; i < N; i++) {
      const slotVal = slots[i];
      let targetRank;
      if (slotVal === 1 || slotVal === 14) {
        targetRank = 'A';
      } else if (slotVal === 2) {
        targetRank = '2';
      } else {
        if (slotVal === 11) targetRank = 'J';
        else if (slotVal === 12) targetRank = 'Q';
        else if (slotVal === 13) targetRank = 'K';
        else targetRank = String(slotVal);
      }

      // Buscar carta que encaje perfectamente (mismo rango y palo correspondiente)
      const matchIdx = tempCards.findIndex(c => c.rank === targetRank && c.suit === suit);
      if (matchIdx !== -1) {
        const cardCopy = { ...tempCards[matchIdx] };
        delete cardCopy.isUsedAsWildcard;
        delete cardCopy.representedRank;
        layout[i] = cardCopy;
        tempCards.splice(matchIdx, 1);
      } else {
        wildcardSlots.push(i);
      }
    }

    // Segunda pasada: llenar los huecos restantes con comodines
    let canFill = true;
    let wildcardsUsed = 0;
    const filledLayout = [...layout];

    if (tempCards.length === wildcardSlots.length) {
      for (let i = 0; i < wildcardSlots.length; i++) {
        const slotIdx = wildcardSlots[i];
        const wc = tempCards[i];

        // Solo "Joker" o cualquier "2" pueden actuar como comodín
        if (wc.rank === 'Joker' || wc.rank === '2') {
          const representedVal = slots[slotIdx];
          const representedRank = representedVal === 1 || representedVal === 14 ? 'A' :
                                  representedVal === 11 ? 'J' :
                                  representedVal === 12 ? 'Q' :
                                  representedVal === 13 ? 'K' : String(representedVal);
          
          filledLayout[slotIdx] = {
            ...wc,
            representedRank,
            isUsedAsWildcard: true
          };
          wildcardsUsed++;
        } else {
          canFill = false;
          break;
        }
      }
    } else {
      canFill = false;
    }

    // En Buraco se permite un máximo de 1 comodín por secuencia
    if (canFill && wildcardsUsed <= 1) {
      validLayouts.push({
        start,
        clean: wildcardsUsed === 0,
        cards: filledLayout
      });
    }
  }

  if (validLayouts.length === 0) {
    return { valid: false, error: 'Las cartas no se pueden ordenar en una secuencia válida.' };
  }

  // Ordenar layouts: preferir limpios, luego los que empiezan más alto
  validLayouts.sort((a, b) => {
    if (a.clean && !b.clean) return -1;
    if (!a.clean && b.clean) return 1;
    return b.start - a.start;
  });

  const best = validLayouts[0];
  return {
    valid: true,
    clean: best.clean,
    cards: best.cards,
    isCanastra: N >= 7,
    canastraType: N >= 7 ? (best.clean ? 'limpa' : 'suja') : null
  };
}

// Valida si un arreglo de cartas forma un grupo/tercio válido de cartas del mismo número
function validateSet(cards) {
  if (cards.length < 3) {
    return { valid: false, error: 'Un grupo/tercio debe tener al menos 3 cartas.' };
  }

  // 1. Filtrar Jokers y 2s para identificar cartas naturales
  const noJokers = cards.filter(c => c.rank !== 'Joker');
  const naturalCards = noJokers.filter(c => c.rank !== '2');

  let naturalRank = null;
  let wildcardsCount = 0;
  let wildcardCards = [];
  let naturalCardsList = [];

  if (naturalCards.length > 0) {
    // Caso estándar: hay cartas naturales que definen el número del grupo
    naturalRank = naturalCards[0].rank;
    if (naturalCards.some(c => c.rank !== naturalRank)) {
      return { valid: false, error: 'Un grupo debe contener cartas del mismo número.' };
    }
    naturalCardsList = [...naturalCards];

    // Los Jokers y 2s actúan como comodines
    const jokers = cards.filter(c => c.rank === 'Joker');
    const twos = cards.filter(c => c.rank === '2');
    wildcardsCount = jokers.length + twos.length;
    wildcardCards = [...jokers, ...twos];
  } else {
    // Caso especial: solo hay 2s y Jokers -> Es un grupo de 2s
    naturalRank = '2';
    naturalCardsList = cards.filter(c => c.rank === '2');
    const jokers = cards.filter(c => c.rank === 'Joker');
    wildcardsCount = jokers.length;
    wildcardCards = [...jokers];
  }

  // En Buraco se permite un máximo de 1 comodín por juego
  if (wildcardsCount > 1) {
    return { valid: false, error: 'Un grupo no puede tener más de un comodín.' };
  }

  // Formatear las cartas: primero las naturales, luego el comodín al final
  const formattedCards = [];
  naturalCardsList.forEach(c => {
    formattedCards.push({
      ...c,
      representedRank: c.rank,
      isUsedAsWildcard: false
    });
  });

  wildcardCards.forEach(wc => {
    formattedCards.push({
      ...wc,
      representedRank: naturalRank,
      isUsedAsWildcard: true
    });
  });

  const N = cards.length;
  return {
    valid: true,
    clean: wildcardsCount === 0,
    cards: formattedCards,
    isCanastra: N >= 7,
    canastraType: N >= 7 ? (wildcardsCount === 0 ? 'limpa' : 'suja') : null
  };
}

// Valida si un juego es una secuencia (escalera) o un tercio (grupo del mismo número) válido
function validateMeld(cards) {
  // 1. Intentar validar como secuencia primero
  const seqRes = validateSequence(cards);
  if (seqRes.valid) return { ...seqRes, type: 'sequence' };

  // 2. Si no, intentar validar como grupo
  const setRes = validateSet(cards);
  if (setRes.valid) return { ...setRes, type: 'set' };

  // Retornar error combinado si falla todo
  return { 
    valid: false, 
    error: 'Las cartas no forman ni una secuencia (mismo palo) ni un grupo/tercio (mismo número).' 
  };
}

// Inicializa el estado del juego para una nueva ronda
function initGame(is4Player = false) {
  const deck = shuffle(createDeck());

  const hand0 = [];
  const hand1 = [];
  const hand2 = [];
  const hand3 = [];
  const morto0 = [];
  const morto1 = [];

  // Repartir 11 cartas a cada jugador según corresponda
  for (let i = 0; i < 11; i++) hand0.push(deck.pop());
  for (let i = 0; i < 11; i++) hand1.push(deck.pop());
  if (is4Player) {
    for (let i = 0; i < 11; i++) hand2.push(deck.pop());
    for (let i = 0; i < 11; i++) hand3.push(deck.pop());
  }

  // Crear Muerto 0 (11 cartas) y Muerto 1 (11 cartas)
  for (let i = 0; i < 11; i++) morto0.push(deck.pop());
  for (let i = 0; i < 11; i++) morto1.push(deck.pop());

  // Pozo de descarte vacío al iniciar
  const discardPile = [];

  const playersList = [
    { hand: hand0, melds: [], hasTakenMorto: false, name: '' },
    { hand: hand1, melds: [], hasTakenMorto: false, name: '' }
  ];

  if (is4Player) {
    playersList.push(
      { hand: hand2, melds: [], hasTakenMorto: false, name: '' },
      { hand: hand3, melds: [], hasTakenMorto: false, name: '' }
    );
  }

  return {
    drawPile: deck,
    discardPile,
    mortos: [morto0, morto1],
    mortosTaken: is4Player ? [null, null] : [false, false],
    is4Player,
    players: playersList,
    turn: 0,              // Índice del jugador activo
    turnState: 'draw',    // 'draw' o 'play'
    status: 'playing',    // 'waiting' | 'playing' | 'finished'
    winner: null,
    scores: [0, 0],       // Puntajes acumulados globales
    roundScores: [0, 0],  // Puntajes de la ronda actual
    requiredCanastras: 1, // Por defecto 1 canastra para batir
    roundHistory: [],     // Planilla de historial de rondas
    isFirstTurn: true,    // Habilita la regla del primer descarte/re-robo
    firstDrawnCardId: null, // Guarda la carta robada en el primer turno
    lastAction: 'Juego iniciado.',
    teamUndoCounts: [0, 0],
    lastUndoTeam: null
  };
}

// Calcula los puntajes al finalizar la ronda
function calculateRoundScores(gameState) {
  const roundScores = [0, 0];
  const is4P = gameState.is4Player;

  for (let t = 0; t < 2; t++) {
    let score = 0;

    // 1. Sumar puntos de cartas en los juegos bajados (melds) de la pareja (almacenado en el index t)
    const teamMelds = gameState.players[t].melds;
    teamMelds.forEach(meld => {
      const validation = validateMeld(meld);
      if (validation.valid) {
        // Sumar valor de cada carta individual
        meld.forEach(card => {
          score += CARD_VALUES[card.rank];
        });

        // Sumar canastras
        if (meld.length >= 7) {
          if (validation.clean) {
            score += 200; // Canastra Limpia
          } else {
            score += 100; // Canastra Sucia
          }
        }
      }
    });

    // 2. Penalizar cartas que quedaron en las manos de los integrantes del equipo
    const playersInTeam = is4P ? [t, t + 2] : [t];
    playersInTeam.forEach(pIdx => {
      const player = gameState.players[pIdx];
      if (player && player.hand) {
        player.hand.forEach(card => {
          score -= CARD_VALUES[card.rank];
        });
      }
    });

    // 3. Penalización por no haber tomado el Muerto de la pareja
    const tookMorto = is4P ? (gameState.mortosTaken[t] !== null) : gameState.mortosTaken[t];
    if (!tookMorto) {
      score -= 100;
    }

    // 4. Bono por batida (ir al final de la ronda)
    if (gameState.status === 'finished' && gameState.winner !== null) {
      const winnerTeam = is4P ? (gameState.winner === 0 || gameState.winner === 2 ? 0 : 1) : gameState.winner;
      if (winnerTeam === t) {
        score += 100;
      }
    }

    roundScores[t] = score;
  }

  return roundScores;
}

module.exports = {
  createDeck,
  shuffle,
  validateSequence,
  validateMeld,
  initGame,
  calculateRoundScores,
  CARD_VALUES
};
