// server.js
// Servidor de Socket.io para el juego de Buraco

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { initGame, validateSequence, validateMeld, calculateRoundScores, CARD_VALUES, createDeck, shuffle } = require('./gameLogic');

const app = express();
app.use(cors());

// Servir archivos estáticos del cliente en producción si existen
const distPath = path.join(__dirname, '../client/dist');

app.get('/debug-files', (req, res) => {
  try {
    const cwd = process.cwd();
    const serverDirname = __dirname;
    const exists = fs.existsSync(distPath);
    let files = [];
    let assets = [];
    if (exists) {
      files = fs.readdirSync(distPath);
      const assetsPath = path.join(distPath, 'assets');
      if (fs.existsSync(assetsPath)) {
        assets = fs.readdirSync(assetsPath);
      }
    }
    res.json({
      cwd,
      serverDirname,
      distPath,
      exists,
      files,
      assets
    });
  } catch (err) {
    res.json({ error: err.message });
  }
});

if (fs.existsSync(distPath)) {
  console.log(`Servidor configurado para servir frontend desde: ${distPath}`);
  app.use(express.static(distPath));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.includes('.')) {
      res.sendFile(path.join(distPath, 'index.html'));
    } else {
      next();
    }
  });
} else {
  console.log('Advertencia: No se encontró la carpeta client/dist. El frontend no se servirá desde este puerto.');
}

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Obtener la dirección IP local para facilitar la conexión de la otra notebook
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (let interfaceName in interfaces) {
    for (let iface of interfaces[interfaceName]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const LOCAL_IP = getLocalIP();
const PORT = process.env.PORT || 3001;

// Estado del lobby y del juego
let players = []; // { socketId, name, isBot }
let gameState = null; // Estado actual de la partida de Buraco
let globalScores = [0, 0]; // Puntajes globales acumulados
let requiredCanastrasSetting = 1; // Canastras configuradas desde el lobby (1 o 2)
let targetScoreSetting = 3000; // Puntos para ganar la partida (modificable desde el lobby)
let isAgainstBotSetting = false;
let is4PlayerSetting = false;
let cleanupTimeout = null; // Temporizador para limpieza diferida tras desconexión

// Retorna el índice del líder del equipo (0 para Pareja 1, 1 para Pareja 2)
function getTeamOwnerIndex(playerIdx, is4Player) {
  if (!is4Player) return playerIdx;
  return playerIdx === 0 || playerIdx === 2 ? 0 : 1;
}

function startPlayerTurn(playerIdx) {
  gameState.turn = playerIdx;
  gameState.turnState = 'draw';
  
  // Guardar snapshot de inicio de turno para humanos para permitir deshacer
  if (gameState.players[playerIdx] && !gameState.players[playerIdx].isBot) {
    const { turnStartSnapshot, ...snapshotData } = gameState;
    gameState.turnStartSnapshot = JSON.parse(JSON.stringify(snapshotData));
  }
}

function applyUndo(requesterIdx, teamIdx) {
  if (!gameState.turnStartSnapshot) return;
  
  const savedSnapshot = gameState.turnStartSnapshot;
  const newTeamUndoCounts = [...gameState.teamUndoCounts];
  newTeamUndoCounts[teamIdx]++;
  const lastUndoTeam = teamIdx;
  
  // Restaurar estado de juego completo
  gameState = JSON.parse(JSON.stringify(savedSnapshot));
  gameState.teamUndoCounts = newTeamUndoCounts;
  gameState.lastUndoTeam = lastUndoTeam;
  gameState.undoRequestedBy = null;
  gameState.lastAction = `Jugada deshecha por ${players[requesterIdx].name} con el permiso del rival.`;
  
  sendStateToAll();
}

function getCardDrawValue(card) {
  const drawRankValues = { '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14, '2': 15, 'Joker': 16 };
  const drawSuitValues = { 'S': 4, 'H': 3, 'D': 2, 'C': 1, 'Joker': 0 };
  const rankVal = drawRankValues[card.rank] || 0;
  const suitVal = drawSuitValues[card.suit] || 0;
  return rankVal * 10 + suitVal;
}

function getSuitName(suit) {
  const names = { 'H': 'Copas 🏆', 'D': 'Oros 🪙', 'C': 'Tréboles ♣', 'S': 'Espadas ⚔️', 'Joker': 'Joker 🃏' };
  return names[suit] || suit;
}

function performSorteo(is4Player) {
  const tempDeck = shuffle(createDeck());
  const drawnCards = [];
  const N = is4Player ? 4 : 2;
  
  for (let i = 0; i < N; i++) {
    drawnCards.push(tempDeck.pop());
  }

  const values = drawnCards.map(c => getCardDrawValue(c));
  
  // Encontrar el ganador (el valor de carta más alto)
  let w = 0;
  for (let i = 1; i < N; i++) {
    if (values[i] > values[w]) {
      w = i;
    }
  }

  let actionText = 'Sorteo inicial: ';
  const cardStrings = players.map((p, idx) => {
    return `${p.name} sacó el ${drawnCards[idx].rank} de ${getSuitName(drawnCards[idx].suit)}`;
  });
  actionText += cardStrings.join(', ') + `. Gana ${players[w].name} y sale de mano.`;

  if (is4Player) {
    const seats = new Array(4);
    const team1 = [0, 2];
    const team2 = [1, 3];
    const winnerTeam = team1.includes(w) ? team1 : team2;
    const loserTeam = team1.includes(w) ? team2 : team1;

    seats[0] = players[w]; // Ganador
    seats[2] = players[winnerTeam.find(idx => idx !== w)]; // Su compañero

    // De la pareja perdedora, el de mayor carta va a la posición 1 y el menor a la 3
    const loserA = loserTeam[0];
    const loserB = loserTeam[1];
    if (values[loserA] > values[loserB]) {
      seats[1] = players[loserA];
      seats[3] = players[loserB];
    } else {
      seats[1] = players[loserB];
      seats[3] = players[loserA];
    }

    players = [...seats];
  } else {
    // 2 jugadores
    const seats = new Array(2);
    seats[0] = players[w];
    seats[1] = players[1 - w];
    players = [...seats];
  }

  return actionText;
}

// Envía el estado de juego sanitizado a cada jugador para evitar trampas
function sendStateToAll() {
  if (!gameState) return;

  players.forEach((player, index) => {
    if (player.socketId && player.socketId !== 'bot-socket') {
      const sanitized = getSanitizedState(gameState, index);
      io.to(player.socketId).emit('game-state', {
        gameState: sanitized,
        playerIndex: index,
        lobbyPlayers: players.map(p => p.name)
      });
    }
  });

  // Chequear si es el turno del bot
  checkAndTriggerBotTurn();
}

function getSanitizedState(state, playerIndex) {
  if (!state) return null;
  
  // Sanitizar jugadores: ocultar las cartas en mano y mapear melds compartidos
  const sanitizedPlayers = state.players.map((p, idx) => {
    const teamOwner = getTeamOwnerIndex(idx, state.is4Player);
    const teamMelds = state.players[teamOwner].melds;

    if (idx === playerIndex || state.status === 'finished') {
      return { ...p, melds: teamMelds };
    }

    // Ocultar cartas de la mano del rival o compañero durante el transcurso del juego
    return {
      ...p,
      hand: new Array(p.hand.length).fill({ id: 'hidden', isHidden: true }),
      melds: teamMelds
    };
  });

  // Ocultar mazo de robo (solo mandar el contador)
  const drawPileCount = state.drawPile.length;

  return {
    ...state,
    drawPile: new Array(drawPileCount).fill({ id: 'hidden', isHidden: true }),
    // Ocultar cartas de los muertos si no han sido tomados
    mortos: state.mortos.map((m, idx) => {
      if (!m) return null;
      return new Array(m.length).fill({ id: 'hidden', isHidden: true });
    }),
    players: sanitizedPlayers,
    scores: globalScores
  };
}

io.on('connection', (socket) => {
  console.log(`Cliente conectado: ${socket.id}`);

  // Enviar información de lobby al conectarse
  socket.emit('lobby-info', {
    localIp: LOCAL_IP,
    players: players.map(p => p.name)
  });

  // Unirse al lobby y configurar partida
  socket.on('join-lobby', ({ name, requiredCanastras, isAgainstBot, targetScore, is4Player }) => {
    // Si hay una limpieza programada en curso, cancelarla ya que el jugador regresó
    if (cleanupTimeout) {
      console.log(`Jugador regresó (${name}). Cancelando limpieza diferida del juego.`);
      clearTimeout(cleanupTimeout);
      cleanupTimeout = null;
    }

    if (requiredCanastras) {
      requiredCanastrasSetting = requiredCanastras === 2 ? 2 : 1;
    }
    if (targetScore) {
      targetScoreSetting = Number(targetScore) || 3000;
    }
    if (is4Player !== undefined) {
      is4PlayerSetting = !!is4Player;
    }
    if (isAgainstBot !== undefined) {
      isAgainstBotSetting = !!isAgainstBot;
    }

    const maxPlayers = is4PlayerSetting ? 4 : 2;

    if (isAgainstBotSetting) {
      if (is4PlayerSetting) {
        // Modo 4 jugadores con PC: Necesitamos 2 humanos.
        // El líder es players[0] (Humano 1) y players[1] (Humano 2).
        // Las computadoras ocupan players[2] y players[3].
        const existingIndex = players.findIndex(p => p.name === name);
        if (existingIndex !== -1) {
          players[existingIndex].socketId = socket.id;
          console.log(`Humano se reconectó a partida 4P contra PC: ${name}`);
        } else {
          const humanCount = players.filter(p => !p.isBot).length;
          if (humanCount < 2) {
            // Eliminar bots temporales si había, para agregar en orden
            players = players.filter(p => !p.isBot);
            players.push({ socketId: socket.id, name });
            console.log(`Humano ${players.length} unido al lobby 4P contra PC: ${name}`);
          } else {
            socket.emit('error-message', 'La partida contra la PC está llena (ya hay 2 humanos jugando).');
            return;
          }
        }
        
        // Si ya hay 2 humanos, rellenar los otros 2 slots con bots y arrancar
        const activeHumans = players.filter(p => !p.isBot);
        if (activeHumans.length === 2) {
          players = [
            activeHumans[0],
            activeHumans[1],
            { socketId: 'bot-socket-1', name: 'Compu A (IA)', isBot: true },
            { socketId: 'bot-socket-2', name: 'Compu B (IA)', isBot: true }
          ];
        }
      } else {
        // Modo 2 jugadores con PC (Humano vs Bot)
        const isReconnecting = gameState && players[0] && players[0].name === name && players[1] && players[1].isBot;

        if (isReconnecting) {
          players[0].socketId = socket.id;
          console.log(`Jugador se reconectó a su partida contra la PC: ${name}`);
        } else {
          players = [
            { socketId: socket.id, name },
            { socketId: 'bot-socket', name: 'Computadora (IA)', isBot: true }
          ];
          gameState = null; // Forzar reinicio del juego
          globalScores = [0, 0];
          isBotThinking = false;
          console.log(`Partida contra la PC iniciada para ${name}`);
        }
      }
    } else {
      // Modo multijugador humano completo
      const existingIndex = players.findIndex(p => p.socketId === socket.id);
      
      if (existingIndex !== -1) {
        players[existingIndex].name = name;
      } else {
        const sameNameIndex = players.findIndex(p => p.name === name);
        if (sameNameIndex !== -1) {
          players[sameNameIndex].socketId = socket.id;
          console.log(`Jugador reconectado por nombre: ${name} (${socket.id})`);
        } else {
          const disconnectedIndex = players.findIndex(p => !p.socketId && !p.isBot);
          if (disconnectedIndex !== -1) {
            players[disconnectedIndex] = { socketId: socket.id, name };
            console.log(`Jugador ocupó slot desconectado: ${name} (${socket.id})`);
          } else if (players.length < maxPlayers) {
            players.push({ socketId: socket.id, name });
            console.log(`Jugador nuevo unido: ${name} (${socket.id})`);
          } else {
            socket.emit('error-message', `El juego está lleno (ya hay ${maxPlayers} jugadores activos).`);
            return;
          }
        }
      }
    }

    // Emitir lista de jugadores a todos
    io.emit('lobby-update', players.map(p => p.name));

    // Iniciar el juego si ya se llenaron los slots correspondientes
    const activeHumansCount = players.filter(p => !p.isBot).length;
    const requiredHumans = (isAgainstBotSetting && is4PlayerSetting) ? 2 : (isAgainstBotSetting ? 1 : maxPlayers);
    const allSocketsReady = players.filter(p => !p.isBot).every(p => p.socketId);

    if (players.length === maxPlayers && activeHumansCount === requiredHumans && allSocketsReady) {
      if (!gameState) {
        // Crear estado inicial
        gameState = initGame(is4PlayerSetting);
        
        // Sorteo inicial con cartas físicas y asignación de asientos
        const sorteoActionText = performSorteo(is4PlayerSetting);
        
        // El ganador del sorteo (index 0 tras performSorteo) sale de mano
        gameState.starterIndex = 0;
        gameState.turn = 0;

        // Asignar nombres en gameState a partir de players ordenados por el sorteo
        for (let i = 0; i < maxPlayers; i++) {
          gameState.players[i].name = players[i].name;
          if (players[i].isBot) {
            gameState.players[i].isBot = true;
          }
        }

        gameState.requiredCanastras = requiredCanastrasSetting;
        gameState.targetScore = targetScoreSetting;
        globalScores = [0, 0];
        gameState.scores = globalScores;
        gameState.lastAction = `¡Comienza el juego! ${sorteoActionText}`;

        // Snapshot inicial del primer turno
        const { turnStartSnapshot, ...snapshotData } = gameState;
        gameState.turnStartSnapshot = JSON.parse(JSON.stringify(snapshotData));

      } else {
        // En caso de reconexión, sincronizar nombres de sockets activos
        for (let i = 0; i < maxPlayers; i++) {
          if (players[i]) {
            gameState.players[i].name = players[i].name;
          }
        }
      }
      sendStateToAll();
    } else {
      io.emit('lobby-update', players.map(p => p.name));
    }
  });
  // Robar carta del mazo
  socket.on('draw-card', () => {
    const pIdx = players.findIndex(p => p.socketId === socket.id);
    if (pIdx === -1 || !gameState || gameState.status !== 'playing') return;

    if (gameState.turn !== pIdx) {
      socket.emit('error-message', 'No es tu turno.');
      return;
    }

    if (gameState.turnState !== 'draw') {
      socket.emit('error-message', 'Ya robaste carta en este turno.');
      return;
    }

    if (gameState.drawPile.length === 0) {
      // Si se acaba el mazo de robo, termina la ronda y se calculan puntos
      gameState.status = 'finished';
      gameState.turnState = 'confirm-scores';
      gameState.lastAction = 'El mazo de robo se ha agotado. Fin de la ronda. Esperando confirmación de puntos.';
      gameState.roundScores = calculateRoundScores(gameState);
      sendStateToAll();
      return;
    }

    const card = gameState.drawPile.pop();
    gameState.players[pIdx].hand.push(card);
    gameState.turnState = 'play';
    
    if (gameState.isFirstTurn) {
      gameState.firstDrawnCardId = card.id;
      gameState.lastAction = `${gameState.players[pIdx].name} robó la primera carta de la partida. Debe decidir si conservarla o descartarla y robar otra.`;
    } else {
      gameState.lastAction = `${gameState.players[pIdx].name} robó del mazo.`;
    }
    
    sendStateToAll();
  });

  // Robar todo el pozo de descarte
  socket.on('draw-discard', () => {
    const pIdx = players.findIndex(p => p.socketId === socket.id);
    if (pIdx === -1 || !gameState || gameState.status !== 'playing') return;

    if (gameState.turn !== pIdx) {
      socket.emit('error-message', 'No es tu turno.');
      return;
    }

    if (gameState.turnState !== 'draw') {
      socket.emit('error-message', 'Ya robaste carta en este turno.');
      return;
    }

    const teamIdx = getTeamOwnerIndex(pIdx, gameState.is4Player);
    
    // Regla del Muerto en Parejas: El que levantó el muerto no puede robar del pozo.
    if (gameState.is4Player && gameState.mortosTaken[teamIdx] === pIdx) {
      socket.emit('error-message', 'Como levantaste el Muerto, estás bloqueado de robar del pozo de descartes. Debes robar del mazo.');
      return;
    }

    const teamMelds = gameState.players[teamIdx].melds;
    let totalMeldPoints = 0;
    teamMelds.forEach(meld => {
      meld.forEach(c => {
        totalMeldPoints += CARD_VALUES[c.rank] || 0;
      });
    });

    if (totalMeldPoints < 30) {
      socket.emit('error-message', `No puedes levantar del pozo hasta haber sumado al menos 30 puntos en tus juegos bajados (actualmente tienes ${totalMeldPoints} pts en mesa).`);
      return;
    }

    if (gameState.discardPile.length === 0) {
      socket.emit('error-message', 'El pozo de descarte está vacío.');
      return;
    }

    // Agregar todas las cartas del pozo a la mano del jugador
    const count = gameState.discardPile.length;
    gameState.players[pIdx].hand.push(...gameState.discardPile);
    gameState.discardPile = [];
    
    gameState.turnState = 'play';
    gameState.lastAction = `${gameState.players[pIdx].name} recogió el pozo entero (${count} cartas).`;
    
    if (gameState.isFirstTurn) {
      gameState.isFirstTurn = false;
      gameState.firstDrawnCardId = null;
    }
    
    sendStateToAll();
  });

  // Bajar un juego nuevo (secuencia)
  socket.on('meld-sequence', ({ cards }) => {
    const pIdx = players.findIndex(p => p.socketId === socket.id);
    if (pIdx === -1 || !gameState || gameState.status !== 'playing') return;

    if (gameState.turn !== pIdx) {
      socket.emit('error-message', 'No es tu turno.');
      return;
    }

    if (gameState.turnState !== 'play') {
      socket.emit('error-message', 'Debes robar una carta antes de bajar juegos.');
      return;
    }

    // Verificar que el jugador tenga estas cartas en su mano
    const hand = gameState.players[pIdx].hand;
    const hasAllCards = cards.every(cardToFind => 
      hand.some(handCard => handCard.id === cardToFind.id)
    );

    if (!hasAllCards) {
      socket.emit('error-message', 'No tienes esas cartas en tu mano.');
      return;
    }

    // Validar juego con las reglas (secuencia o grupo)
    const result = validateMeld(cards);
    if (!result.valid) {
      socket.emit('error-message', `Juego inválido: ${result.error}`);
      return;
    }

    const teamIdx = getTeamOwnerIndex(pIdx, gameState.is4Player);
    const player = gameState.players[pIdx];
    const teamPlayer = gameState.players[teamIdx];

    // Restricción de cartas en mano al bajar juego
    const hasTakenMorto = gameState.is4Player ? (gameState.mortosTaken[teamIdx] !== null) : gameState.mortosTaken[pIdx];
    const existingCanastras = teamPlayer.melds.filter(m => m.length >= 7).length;
    // Si el juego que estamos bajando ahora tiene 7 o más cartas, se considera una nueva canastra completada
    const newCanastraCreated = result.cards && result.cards.length >= 7 ? 1 : 0;
    const totalCanastrasAfter = existingCanastras + newCanastraCreated;
    const requiredCanastras = gameState.requiredCanastras || 1;
    const canBat = hasTakenMorto && (totalCanastrasAfter >= requiredCanastras);
    const minCardsHand = !hasTakenMorto ? 0 : (canBat ? 0 : 2);

    if (hand.length - cards.length < minCardsHand) {
      if (minCardsHand === 2) {
        socket.emit('error-message', 'No puedes quedarte con menos de 2 cartas en la mano. Necesitas canastras para batir y debes conservar al menos una para tu descarte.');
      } else {
        socket.emit('error-message', 'No puedes quedarte sin cartas en la mano. Debes conservar al menos una para tu descarte.');
      }
      return;
    }

    // Quitar cartas de la mano
    cards.forEach(cardToRem => {
      const idx = hand.findIndex(hc => hc.id === cardToRem.id);
      if (idx !== -1) hand.splice(idx, 1);
    });

    // Añadir meld ordenado al paño compartido del equipo
    gameState.players[teamIdx].melds.push(result.cards);
    gameState.lastAction = `${player.name} bajó juego: ${result.clean ? 'Limpio' : 'Sucio'} (${cards.length} cartas).`;

    // Comprobar si toma muerto indirecto
    const tookMortoIndirect = checkMortoIndirect(pIdx);
    if (!tookMortoIndirect) {
      checkDirectBatida(pIdx);
    }

    sendStateToAll();
  });

  // Acoplar cartas a un juego ya existente
  socket.on('append-to-meld', ({ meldIndex, cards }) => {
    const pIdx = players.findIndex(p => p.socketId === socket.id);
    if (pIdx === -1 || !gameState || gameState.status !== 'playing') return;

    if (gameState.turn !== pIdx) {
      socket.emit('error-message', 'No es tu turno.');
      return;
    }

    if (gameState.turnState !== 'play') {
      socket.emit('error-message', 'Debes robar una carta antes de bajar juegos.');
      return;
    }

    const teamIdx = getTeamOwnerIndex(pIdx, gameState.is4Player);
    const player = gameState.players[pIdx];
    const teamPlayer = gameState.players[teamIdx];
    
    if (!teamPlayer.melds[meldIndex]) {
      socket.emit('error-message', 'Juego seleccionado inválido.');
      return;
    }

    // Verificar que el jugador tenga estas cartas
    const hand = player.hand;
    const hasAllCards = cards.every(cardToFind => 
      hand.some(handCard => handCard.id === cardToFind.id)
    );

    if (!hasAllCards) {
      socket.emit('error-message', 'No tienes esas cartas en tu mano.');
      return;
    }

    // Combinar juego existente con nuevas cartas
    const currentMeld = teamPlayer.melds[meldIndex];
    if (!currentMeld) return;
    const combined = [...currentMeld, ...cards];

    const result = validateMeld(combined);
    if (!result.valid) {
      socket.emit('error-message', `Movimiento inválido: ${result.error}`);
      return;
    }

    // Restricción de cartas en mano al acoplar
    const hasTakenMorto = gameState.is4Player ? (gameState.mortosTaken[teamIdx] !== null) : gameState.mortosTaken[pIdx];
    const existingCanastras = teamPlayer.melds.filter(m => m.length >= 7).length;
    const wasCanastra = currentMeld.length >= 7;
    const willBeCanastra = combined.length >= 7;
    const netCanastraCreated = (willBeCanastra && !wasCanastra) ? 1 : 0;
    const totalCanastrasAfter = existingCanastras + netCanastraCreated;
    const requiredCanastras = gameState.requiredCanastras || 1;
    const canBat = hasTakenMorto && (totalCanastrasAfter >= requiredCanastras);
    const minCardsHand = !hasTakenMorto ? 0 : (canBat ? 0 : 2);

    if (hand.length - cards.length < minCardsHand) {
      if (minCardsHand === 2) {
        socket.emit('error-message', 'No puedes quedarte con menos de 2 cartas en la mano. Necesitas canastras para batir y debes conservar al menos una para tu descarte.');
      } else {
        socket.emit('error-message', 'No puedes quedarte sin cartas en la mano. Debes conservar al menos una para tu descarte.');
      }
      return;
    }

    // Quitar cartas de la mano
    cards.forEach(cardToRem => {
      const idx = hand.findIndex(hc => hc.id === cardToRem.id);
      if (idx !== -1) hand.splice(idx, 1);
    });

    // Reemplazar meld con la secuencia combinada y ordenada al paño compartido
    teamPlayer.melds[meldIndex] = result.cards;
    gameState.lastAction = `${player.name} acopló cartas a su juego.`;

    // Comprobar si toma muerto indirecto
    const tookMortoIndirect = checkMortoIndirect(pIdx);
    if (!tookMortoIndirect) {
      checkDirectBatida(pIdx);
    }

    sendStateToAll();
  });

  // Descartar carta (termina el turno)
  socket.on('discard-card', ({ card }) => {
    const pIdx = players.findIndex(p => p.socketId === socket.id);
    if (pIdx === -1 || !gameState || gameState.status !== 'playing') return;

    if (gameState.turn !== pIdx) {
      socket.emit('error-message', 'No es tu turno.');
      return;
    }

    if (gameState.turnState !== 'play') {
      socket.emit('error-message', 'Debes robar antes de descartar.');
      return;
    }

    if (gameState.isFirstTurn) {
      gameState.isFirstTurn = false;
      gameState.firstDrawnCardId = null;
    }

    const hand = gameState.players[pIdx].hand;
    const cardIdx = hand.findIndex(hc => hc.id === card.id);

    if (cardIdx === -1) {
      socket.emit('error-message', 'No tienes esa carta en tu mano.');
      return;
    }

    // Validación para BATER (ganar la ronda)
    const teamIdx = getTeamOwnerIndex(pIdx, gameState.is4Player);
    const hasTakenMorto = gameState.is4Player ? (gameState.mortosTaken[teamIdx] !== null) : gameState.mortosTaken[pIdx];
    const teamMelds = gameState.players[teamIdx].melds;
    const canastrasCount = teamMelds.filter(m => m.length >= 7).length;
    const requiredCanastras = gameState.requiredCanastras || 1;

    if (hand.length === 1) {
      if (hasTakenMorto && canastrasCount < requiredCanastras) {
        socket.emit('error-message', `No puedes terminar (bater) sin tener al menos ${requiredCanastras} ${requiredCanastras === 1 ? 'canastra' : 'canastras'}. (Tenés ${canastrasCount}).`);
        return;
      }

      if (hasTakenMorto && canastrasCount >= requiredCanastras) {
        // Bate y finaliza la ronda!
        hand.splice(cardIdx, 1);
        gameState.discardPile.push(card);
        gameState.status = 'finished';
        gameState.winner = pIdx;
        gameState.turnState = 'confirm-scores';
        gameState.lastAction = `¡${gameState.players[pIdx].name} ha batido! Fin de la ronda. Esperando confirmación de puntos.`;
        
        // Calcular puntuaciones
        gameState.roundScores = calculateRoundScores(gameState);
        
        sendStateToAll();
        return;
      }
    }

    // Quitar de la mano y poner en el pozo
    hand.splice(cardIdx, 1);
    gameState.discardPile.push(card);
    gameState.lastAction = `${gameState.players[pIdx].name} descartó ${card.rank} de ${card.suit}.`;

    // Manejo de Muerto Indirecto (se quedó sin cartas tras el descarte)
    const tookMortoIndirect = checkMortoIndirect(pIdx);

    // Cambiar de turno
    const nextTurn = gameState.is4Player ? (gameState.turn + 1) % 4 : (gameState.turn === 0 ? 1 : 0);
    startPlayerTurn(nextTurn);

    sendStateToAll();
  });

  // Conservar la primera carta robada
  socket.on('keep-first-card', () => {
    const pIdx = players.findIndex(p => p.socketId === socket.id);
    if (pIdx === -1 || !gameState || !gameState.isFirstTurn || gameState.turn !== pIdx) return;

    gameState.isFirstTurn = false;
    gameState.firstDrawnCardId = null;
    gameState.lastAction = `${gameState.players[pIdx].name} conservó la carta robada en su primer turno.`;
    
    sendStateToAll();
  });

  // Rechazar la primera carta robada y habilitar volver a robar
  socket.on('reject-first-card', () => {
    const pIdx = players.findIndex(p => p.socketId === socket.id);
    if (pIdx === -1 || !gameState || !gameState.isFirstTurn || gameState.turn !== pIdx) return;

    const hand = gameState.players[pIdx].hand;
    const cardId = gameState.firstDrawnCardId;
    const cardIdx = hand.findIndex(c => c.id === cardId);
    
    if (cardIdx !== -1) {
      const rejectedCard = hand[cardIdx];
      
      // Quitar de la mano
      hand.splice(cardIdx, 1);
      
      // Poner en el pozo de descarte
      gameState.discardPile.push(rejectedCard);
      
      gameState.lastAction = `${gameState.players[pIdx].name} rechazó la carta robada, la tiró al pozo y debe volver a robar del mazo.`;
    }

    gameState.isFirstTurn = false;
    gameState.firstDrawnCardId = null;
    gameState.turnState = 'draw'; // Habilitar volver a robar manualmente del mazo
    
    sendStateToAll();
  });

  // Reiniciar ronda (manteniendo puntajes globales acumulados)
  socket.on('restart-round', () => {
    if (!gameState) return;
    
    isBotThinking = false; // Resetear IA
    const currentRequiredCanastras = gameState.requiredCanastras || 1;
    const currentTargetScore = gameState.targetScore || 3000;
    const previousStarter = gameState.starterIndex !== undefined ? gameState.starterIndex : 0;
    const maxPlayers = is4PlayerSetting ? 4 : 2;
    const nextStarter = (previousStarter + 1) % maxPlayers;

    // Inicializar nueva ronda
    const newGame = initGame(is4PlayerSetting);
    newGame.starterIndex = nextStarter;
    
    for (let i = 0; i < maxPlayers; i++) {
      newGame.players[i].name = players[i] ? players[i].name : `Jugador ${i + 1}`;
      if (players[i] && players[i].isBot) {
        newGame.players[i].isBot = true;
      }
    }
    newGame.requiredCanastras = currentRequiredCanastras;
    newGame.targetScore = currentTargetScore;
    
    gameState = newGame;
    gameState.scores = globalScores;
    gameState.lastAction = `Nueva ronda iniciada. Turno de ${gameState.players[nextStarter]?.name || 'Jugador'}`;
    startPlayerTurn(nextStarter);
    
    sendStateToAll();
  });

  // Reiniciar partida por completo (resetea puntajes)
  socket.on('reset-game', () => {
    globalScores = [0, 0];
    isBotThinking = false; // Resetear IA
    const currentRequiredCanastras = gameState ? gameState.requiredCanastras : requiredCanastrasSetting;
    const currentTargetScore = gameState ? gameState.targetScore : targetScoreSetting;
    const maxPlayers = is4PlayerSetting ? 4 : 2;
    
    gameState = initGame(is4PlayerSetting);
    
    // Sorteo inicial con cartas físicas y asignación de asientos
    const sorteoActionText = performSorteo(is4PlayerSetting);
    gameState.starterIndex = 0;

    for (let i = 0; i < maxPlayers; i++) {
      gameState.players[i].name = players[i].name;
      if (players[i].isBot) {
        gameState.players[i].isBot = true;
      }
    }
    gameState.requiredCanastras = currentRequiredCanastras;
    gameState.targetScore = currentTargetScore;
    gameState.scores = globalScores;
    gameState.lastAction = `Partida reiniciada. ${sorteoActionText}`;
    startPlayerTurn(0);
    
    sendStateToAll();
  });

  // Cambiar meta de puntos en medio de la partida
  socket.on('change-target-score', ({ newTargetScore }) => {
    if (!gameState) return;
    const scoreVal = parseInt(newTargetScore, 10);
    if (isNaN(scoreVal) || scoreVal <= 0) {
      socket.emit('error-message', 'La meta de puntos debe ser un número válido mayor a 0.');
      return;
    }

    const previousTarget = gameState.targetScore || 3000;
    gameState.targetScore = scoreVal;
    
    // Obtener el jugador que realizó la acción
    const pIdx = players.findIndex(p => p.socketId === socket.id);
    const changerName = pIdx !== -1 ? players[pIdx].name : 'Un jugador';
    
    gameState.lastAction = `${changerName} cambió la meta de puntos de ${previousTarget} a ${scoreVal} pts.`;
    sendStateToAll();
  });

  // Solicitar deshacer la jugada
  socket.on('request-undo', () => {
    const pIdx = players.findIndex(p => p.socketId === socket.id);
    if (pIdx === -1 || !gameState || gameState.status !== 'playing') return;
    
    if (gameState.turn !== pIdx) {
      socket.emit('error-message', 'No es tu turno.');
      return;
    }
    
    if (gameState.turnState === 'draw') {
      socket.emit('error-message', 'No puedes volver atrás un turno que aún no ha comenzado (debes robar primero).');
      return;
    }

    const teamIdx = getTeamOwnerIndex(pIdx, gameState.is4Player);
    const opponentTeamIdx = teamIdx === 0 ? 1 : 0;
    
    // Validar límites de deshacer
    const uses = gameState.teamUndoCounts[teamIdx];
    if (uses >= 2) {
      socket.emit('error-message', 'Ya has alcanzado el límite máximo de 2 retrocesos de jugada por partida.');
      return;
    }

    // Regla de alternancia
    if (uses === 1) {
      const oppUses = gameState.teamUndoCounts[opponentTeamIdx];
      if (oppUses === 0) {
        socket.emit('error-message', 'No puedes volver a solicitar deshacer hasta que la pareja rival haya solicitado y usado al menos un retroceso.');
        return;
      }
    }

    // Obtener oponentes
    const opponentIndices = gameState.is4Player
      ? (teamIdx === 0 ? [1, 3] : [0, 2])
      : [1 - pIdx];
    
    const opponentHumans = opponentIndices.map(idx => players[idx]).filter(p => p && !p.isBot && p.socketId);
    
    // Si no hay rivales humanos (ej. modo bot) se auto-aprueba de inmediato
    if (opponentHumans.length === 0) {
      applyUndo(pIdx, teamIdx);
      return;
    }

    // Si hay rivales humanos, enviar evento de confirmación
    gameState.undoRequestedBy = pIdx;
    opponentHumans.forEach(opp => {
      io.to(opp.socketId).emit('undo-requested', { requesterName: players[pIdx].name });
    });

    // Cambiar estado a esperando respuesta del rival
    socket.emit('waiting-undo-response');
  });

  // Responder a la solicitud de deshacer jugada
  socket.on('respond-undo', ({ accept }) => {
    const pIdx = players.findIndex(p => p.socketId === socket.id);
    if (pIdx === -1 || !gameState || gameState.status !== 'playing') return;

    const requesterIdx = gameState.undoRequestedBy;
    if (requesterIdx === undefined || requesterIdx === null) return;

    const requesterTeam = getTeamOwnerIndex(requesterIdx, gameState.is4Player);
    const responderTeam = getTeamOwnerIndex(pIdx, gameState.is4Player);

    if (requesterTeam === responderTeam) return;

    if (accept) {
      applyUndo(requesterIdx, requesterTeam);
    } else {
      gameState.undoRequestedBy = null;
      const requesterSocket = players[requesterIdx] ? players[requesterIdx].socketId : null;
      if (requesterSocket) {
        io.to(requesterSocket).emit('error-message', 'El rival ha rechazado tu solicitud de volver atrás.');
      }
      sendStateToAll();
    }
  });

  // Desconexión
  socket.on('disconnect', () => {
    console.log(`Cliente desconectado: ${socket.id}`);
    const index = players.findIndex(p => p.socketId === socket.id);
    if (index !== -1) {
      if (!gameState) {
        // Si el juego no ha empezado, sacarlo del lobby por completo
        players.splice(index, 1);
        console.log(`Jugador removido del lobby por desconexión antes de iniciar.`);
      } else {
        // Mantener al jugador en el lobby pero sin socketId activo (permitir reconexión)
        players[index].socketId = null;
      }
      io.emit('lobby-update', players.map(p => p.name));
    }

    // Si no quedan jugadores humanos conectados, programar limpieza diferida (gracia de 15 segundos en caso de F5 o desconexión)
    const activeHumans = players.filter(p => p.socketId && p.socketId !== 'bot-socket' && !p.isBot);
    if (activeHumans.length === 0) {
      console.log('Lobby vacío de humanos. Programando limpieza diferida en 15 segundos.');
      if (cleanupTimeout) clearTimeout(cleanupTimeout);
      cleanupTimeout = setTimeout(() => {
        // Volver a verificar si sigue vacío antes de borrar
        const stillNoHumans = players.filter(p => p.socketId && p.socketId !== 'bot-socket' && !p.isBot).length === 0;
        if (stillNoHumans) {
          console.log('Expiró el tiempo de espera (15 segundos). Limpiando estado de Buraco.');
          players = [];
          gameState = null;
          globalScores = [0, 0];
          isBotThinking = false;
        }
        cleanupTimeout = null;
      }, 15000); // 15 segundos de gracia
    }
  });

  // Confirmar y registrar los puntajes de la ronda
  socket.on('confirm-round-scores', ({ roundBreakdown }) => {
    if (!gameState || gameState.status !== 'finished') return;

    const p0Total = Number(roundBreakdown.p0.roundTotal);
    const p1Total = Number(roundBreakdown.p1.roundTotal);

    globalScores[0] += p0Total;
    globalScores[1] += p1Total;

    // Guardar en la planilla
    const roundNum = gameState.roundHistory.length + 1;
    gameState.roundHistory.push({
      round: roundNum,
      breakdown: roundBreakdown,
      totals: [p0Total, p1Total],
      accumulated: [...globalScores]
    });

    // Verificar si alguien alcanzó el objetivo de puntos
    const targetScore = gameState.targetScore || targetScoreSetting || 3000;
    if (globalScores[0] >= targetScore || globalScores[1] >= targetScore) {
      gameState.status = 'finished';
      gameState.turnState = 'match-over';
      gameState.scores = [...globalScores];
      gameState.winner = globalScores[0] >= targetScore 
        ? (globalScores[1] >= targetScore ? (globalScores[0] >= globalScores[1] ? 0 : 1) : 0) 
        : 1;
      gameState.lastAction = `¡Partida finalizada! Ganador: ${gameState.players[gameState.winner].name} con ${globalScores[gameState.winner]} puntos totales.`;
      
      sendStateToAll();
      return;
    }

    // Iniciar siguiente ronda inmediatamente
    const currentRequiredCanastras = gameState.requiredCanastras || 1;
    const currentHistory = [...gameState.roundHistory];
    const previousStarter = gameState.starterIndex !== undefined ? gameState.starterIndex : 0;
    const maxPlayers = is4PlayerSetting ? 4 : 2;
    const nextStarter = (previousStarter + 1) % maxPlayers;

    const newGame = initGame(is4PlayerSetting);
    newGame.starterIndex = nextStarter;
    
    for (let i = 0; i < maxPlayers; i++) {
      newGame.players[i].name = players[i] ? players[i].name : `Jugador ${i + 1}`;
      if (players[i] && players[i].isBot) {
        newGame.players[i].isBot = true;
      }
    }
    newGame.requiredCanastras = currentRequiredCanastras;
    newGame.roundHistory = currentHistory;
    newGame.scores = [...globalScores];
    newGame.lastAction = `Ronda ${roundNum} registrada. ¡Comienza la ronda ${roundNum + 1}! Mano alternada: sale de mano ${newGame.players[nextStarter]?.name || 'Jugador'}.`;

    gameState = newGame;
    isBotThinking = false; // Resetear IA
    startPlayerTurn(nextStarter);
    sendStateToAll();
  });
});

// Comprueba si el jugador batió directamente sin descarte (al quedarse con 0 cartas y tener canastra)
function checkDirectBatida(pIdx) {
  const player = gameState.players[pIdx];
  const hand = player.hand;
  const teamIdx = getTeamOwnerIndex(pIdx, gameState.is4Player);
  const hasTakenMorto = gameState.is4Player ? (gameState.mortosTaken[teamIdx] !== null) : gameState.mortosTaken[pIdx];
  const teamMelds = gameState.players[teamIdx].melds;
  const canastrasCount = teamMelds.filter(m => m.length >= 7).length;
  const requiredCanastras = gameState.requiredCanastras || 1;

  if (hand.length === 0 && hasTakenMorto && canastrasCount >= requiredCanastras) {
    gameState.status = 'finished';
    gameState.winner = pIdx;
    gameState.turnState = 'confirm-scores';
    gameState.lastAction = `¡${gameState.players[pIdx].name} ha batido directamente sin descarte! Fin de la ronda. Esperando confirmación de puntos.`;
    gameState.roundScores = calculateRoundScores(gameState);
    return true;
  }
  return false;
}

// Comprueba si el jugador se quedó sin cartas y debe recibir el Muerto Directo (sigue su turno)
function checkMortoDirect(playerIdx) {
  const player = gameState.players[playerIdx];
  const teamIdx = getTeamOwnerIndex(playerIdx, gameState.is4Player);
  const hasTaken = gameState.is4Player ? (gameState.mortosTaken[teamIdx] !== null) : gameState.mortosTaken[teamIdx];

  if (player.hand.length === 0 && !hasTaken) {
    // Si quedan muertos disponibles
    let mortoIdx = -1;
    if (gameState.mortos[0]) mortoIdx = 0;
    else if (gameState.mortos[1]) mortoIdx = 1;

    if (mortoIdx !== -1) {
      player.hand = gameState.mortos[mortoIdx];
      gameState.mortos[mortoIdx] = null;
      if (gameState.is4Player) {
        gameState.mortosTaken[teamIdx] = playerIdx;
      } else {
        gameState.mortosTaken[playerIdx] = true;
      }
      player.hasTakenMorto = true;
      gameState.lastAction += ` ¡${player.name} tomó el MUERTO DIRECTO!`;
    }
  }
}

// Comprueba si el jugador se quedó sin cartas tras el descarte y recibe el Muerto Indirecto (pasa turno)
function checkMortoIndirect(playerIdx) {
  const player = gameState.players[playerIdx];
  const teamIdx = getTeamOwnerIndex(playerIdx, gameState.is4Player);
  const hasTaken = gameState.is4Player ? (gameState.mortosTaken[teamIdx] !== null) : gameState.mortosTaken[teamIdx];

  if (player.hand.length === 0 && !hasTaken) {
    let mortoIdx = -1;
    if (gameState.mortos[0]) mortoIdx = 0;
    else if (gameState.mortos[1]) mortoIdx = 1;

    if (mortoIdx !== -1) {
      player.hand = gameState.mortos[mortoIdx];
      gameState.mortos[mortoIdx] = null;
      if (gameState.is4Player) {
        gameState.mortosTaken[teamIdx] = playerIdx;
      } else {
        gameState.mortosTaken[playerIdx] = true;
      }
      player.hasTakenMorto = true;
      gameState.lastAction += ` ¡${player.name} tomó el MUERTO INDIRECTO! Su turno termina.`;
      return true;
    }
  }
  return false;
}

// LÓGICA DE CONTROL DEL BOT DE IA
let isBotThinking = false;

function checkAndTriggerBotTurn() {
  if (!gameState || gameState.status !== 'playing' || isBotThinking) return;

  const botIdx = gameState.turn;
  const activePlayer = players[botIdx];

  if (activePlayer && activePlayer.isBot) {
    isBotThinking = true;
    setTimeout(() => {
      runBotTurn(botIdx);
    }, 1500); // Demora simulando pensar
  }
}



function runBotTurn(botIdx) {
  if (!gameState || gameState.status !== 'playing') {
    isBotThinking = false;
    return;
  }

  const botPlayer = gameState.players[botIdx];
  const botHand = botPlayer.hand;
  const topDiscard = gameState.discardPile.length > 0 ? gameState.discardPile[gameState.discardPile.length - 1] : null;
  const teamIdx = getTeamOwnerIndex(botIdx, gameState.is4Player);

  // FASE 1: ROBAR
  let drewFromDiscard = false;
  
  // Regla del Muerto en Parejas para Bots: El que tomó el muerto no puede robar del pozo
  const isBlockedFromDiscard = gameState.is4Player && gameState.mortosTaken[teamIdx] === botIdx;

  if (topDiscard && gameState.discardPile.length > 0 && !isBlockedFromDiscard) {
    // Regla: no se puede levantar del pozo si no ha sumado al menos 30 puntos en mesa
    let botMeldPoints = 0;
    const teamMelds = gameState.players[teamIdx].melds;
    teamMelds.forEach(meld => {
      meld.forEach(c => {
        botMeldPoints += CARD_VALUES[c.rank] || 0;
      });
    });
    const hasMelded = botMeldPoints >= 30;
    if (hasMelded) {
      const hasSameSuit = botHand.some(c => c.suit === topDiscard.suit);
      const isWildcard = topDiscard.rank === '2' || topDiscard.rank === 'Joker';
      
      if (gameState.discardPile.length >= 3 || isWildcard || hasSameSuit) {
        drewFromDiscard = true;
      }
    }
  }

  if (drewFromDiscard) {
    const count = gameState.discardPile.length;
    botHand.push(...gameState.discardPile);
    gameState.discardPile = [];
    gameState.turnState = 'play';
    gameState.lastAction = `${botPlayer.name} recogió el pozo entero (${count} cartas).`;
    
    if (gameState.isFirstTurn) {
      gameState.isFirstTurn = false;
      gameState.firstDrawnCardId = null;
    }
  } else {
    if (gameState.drawPile.length > 0) {
      const card = gameState.drawPile.pop();
      botHand.push(card);
      gameState.turnState = 'play';
      gameState.lastAction = `${botPlayer.name} robó del mazo.`;
      
      if (gameState.isFirstTurn) {
        gameState.isFirstTurn = false;
        gameState.firstDrawnCardId = null;
      }
      } else {
        // Fin de ronda por mazo vacío
        gameState.status = 'finished';
        gameState.turnState = 'confirm-scores';
        gameState.lastAction = 'El mazo de robo se ha agotado. Fin de la ronda. Esperando confirmación de puntos.';
        gameState.roundScores = calculateRoundScores(gameState);
        isBotThinking = false;
        sendStateToAll();
        return;
      }
  }

  sendStateToAll();

  // Esperar 1.5s antes de Bajar / Acoplar
  setTimeout(() => {
    if (!gameState || gameState.status !== 'playing') {
      isBotThinking = false;
      return;
    }

    let botPlayer = gameState.players[botIdx];
    let botHand = botPlayer.hand;
    const teamIdx = getTeamOwnerIndex(botIdx, gameState.is4Player);
    let botMelds = gameState.players[teamIdx].melds;

    const opponentTeamIdx = teamIdx === 0 ? 1 : 0;
    const opponentHasMorto = gameState.is4Player ? (gameState.mortosTaken[opponentTeamIdx] !== null) : gameState.mortosTaken[opponentTeamIdx];
    const botHasMorto = gameState.is4Player ? (gameState.mortosTaken[teamIdx] !== null) : gameState.mortosTaken[botIdx];
    const deckCount = gameState.drawPile.length;
    let botMeldPoints = 0;
    botMelds.forEach(meld => {
      meld.forEach(c => {
        botMeldPoints += CARD_VALUES[c.rank] || 0;
      });
    });
    const isAlreadyMelded = botMeldPoints >= 30;

    // A. Simular jugadas posibles para ver cuántas cartas puede descartar la IA en este turno
    let tempHand = [...botHand];
    let tempMelds = botMelds.map(m => [...m]);
    let cardsPlayedCount = 0;

    // 1. Simular acoples
    let tempAppended = false;
    do {
      tempAppended = false;
      for (let mIdx = 0; mIdx < tempMelds.length; mIdx++) {
        const currentMeld = tempMelds[mIdx];
        const isCurrentCleanCanastra = currentMeld.length >= 7 && !currentMeld.some(c => c && c.isUsedAsWildcard);

        for (let cIdx = 0; cIdx < tempHand.length; cIdx++) {
          const card = tempHand[cIdx];
          const combined = [...currentMeld, card];
          const result = validateMeld(combined);
          if (result.valid) {
            const isNewClean = !result.cards.some(c => c && c.isUsedAsWildcard);
            if (isCurrentCleanCanastra && !isNewClean) {
              continue; // No ensuciar una canastra limpia existente en la simulación
            }

            tempMelds[mIdx] = result.cards;
            tempHand.splice(cIdx, 1);
            cardsPlayedCount++;
            tempAppended = true;
            break;
          }
        }
        if (tempAppended) break;
      }
    } while (tempAppended);

    // 2. Simular nuevos juegos (secuencias consecutivas)
    const suitsList = ['H', 'D', 'C', 'S'];
    const rankOrderVals = { 'A': 1, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13 };
    suitsList.forEach(suit => {
      let suitCards = tempHand.filter(c => c.suit === suit && c.rank !== '2' && c.rank !== 'Joker');
      suitCards.sort((a, b) => (rankOrderVals[a.rank] || 0) - (rankOrderVals[b.rank] || 0));
      let run = [];
      for (let i = 0; i < suitCards.length; i++) {
        const card = suitCards[i];
        if (run.length === 0) run.push(card);
        else {
          const lastVal = rankOrderVals[run[run.length - 1].rank];
          const curVal = rankOrderVals[card.rank];
          if (curVal === lastVal + 1) run.push(card);
          else if (curVal > lastVal + 1) {
            if (run.length >= 3) {
              cardsPlayedCount += run.length;
              run.forEach(rc => {
                const idx = tempHand.findIndex(c => c.id === rc.id);
                if (idx !== -1) tempHand.splice(idx, 1);
              });
            }
            run = [card];
          }
        }
      }
      if (run.length >= 3) {
        cardsPlayedCount += run.length;
        run.forEach(rc => {
          const idx = tempHand.findIndex(c => c.id === rc.id);
          if (idx !== -1) tempHand.splice(idx, 1);
        });
      }
    });

    // Simular grupos
    const grps = {};
    tempHand.forEach(c => {
      if (c.rank !== '2' && c.rank !== 'Joker') {
        if (!grps[c.rank]) grps[c.rank] = [];
        grps[c.rank].push(c);
      }
    });
    Object.keys(grps).forEach(rank => {
      if (grps[rank].length >= 3) {
        cardsPlayedCount += grps[rank].length;
        grps[rank].forEach(rc => {
          const idx = tempHand.findIndex(c => c.id === rc.id);
          if (idx !== -1) tempHand.splice(idx, 1);
        });
      }
    });

    const canTakeMortoThisTurn = !botHasMorto && (botHand.length - cardsPlayedCount <= 1);
    
    // Ver si puede batir/ganar la partida
    const canastrasCount = botMelds.filter(m => m.length >= 7).length;
    const requiredCanastras = gameState.requiredCanastras || 1;
    const canWinThisTurn = botHasMorto && (botHand.length - cardsPlayedCount <= 1) && (canastrasCount >= requiredCanastras);

    // ESTRATEGIA DE BURACO:
    // - Si NO se ha bajado aún (isAlreadyMelded === false), la IA se baja obligatoriamente ASAP (necesario para habilitar pozo).
    // - Si ya está bajada (isAlreadyMelded === true), la IA guarda el resto de sus juegos e intenta no bajar más cosas
    //   salvo que ocurra una condición táctica: el rival tiene muerto, quedan pocas cartas en mazo, o la IA puede tomar el muerto/ganar en este turno.
    const allowPlay = !isAlreadyMelded || opponentHasMorto || deckCount < 10 || canTakeMortoThisTurn || canWinThisTurn;

    if (allowPlay) {
      // 1. Acoplar a juegos existentes (Greedy)
      let appendedAny = false;
      do {
        appendedAny = false;

        const teamIdx = getTeamOwnerIndex(botIdx, gameState.is4Player);
        const hasTakenMorto = gameState.is4Player ? (gameState.mortosTaken[teamIdx] !== null) : gameState.mortosTaken[botIdx];
        const canastrasCount = botMelds.filter(m => m.length >= 7).length;
        const requiredCanastras = gameState.requiredCanastras || 1;
        const canBat = hasTakenMorto && (canastrasCount >= requiredCanastras);
        const minCardsHand = !hasTakenMorto ? 0 : (canBat ? 0 : 2);

        for (let mIdx = 0; mIdx < botMelds.length; mIdx++) {
          const currentMeld = botMelds[mIdx];
          const isCurrentCleanCanastra = currentMeld.length >= 7 && !currentMeld.some(c => c && c.isUsedAsWildcard);

          for (let cIdx = 0; cIdx < botHand.length; cIdx++) {
            const card = botHand[cIdx];

            // Si nos dejaría con menos del mínimo permitido, no acoplar
            if (botHand.length <= minCardsHand) {
              continue;
            }

            const combined = [...currentMeld, card];
            const result = validateMeld(combined);
            if (result.valid) {
              const isNewClean = !result.cards.some(c => c && c.isUsedAsWildcard);
              if (isCurrentCleanCanastra && !isNewClean) {
                continue; // Evitar ensuciar una canastra limpia convirtiéndola en sucia
              }

              botMelds[mIdx] = result.cards;
              botHand.splice(cIdx, 1);
              appendedAny = true;
              gameState.lastAction = `${botPlayer.name} acopló cartas a sus juegos en mesa.`;
              
              const tookMortoIndirect = checkMortoIndirect(botIdx);
              if (!tookMortoIndirect) {
                checkDirectBatida(botIdx);
              }
              break;
            }
          }
          if (appendedAny) break;
        }
      } while (appendedAny);

      // 2. Bajar nuevos juegos (secuencias y grupos)
      const hasMelded = botMelds.length > 0;
      if (!hasMelded) {
        // Simular la búsqueda de todos los posibles juegos válidos para ver si suman >= 30
        let tempHand = [...botHand];
        let simMelds = [];
        let totalSum = 0;

        // A. Simular búsqueda de secuencias limpias (sin comodines)
        const suits = ['H', 'D', 'C', 'S'];
        const rankOrder = { 'A': 1, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13 };

        for (let suit of suits) {
          let suitCards = tempHand.filter(c => c.suit === suit && c.rank !== '2' && c.rank !== 'Joker');
          suitCards.sort((a, b) => (rankOrder[a.rank] || 0) - (rankOrder[b.rank] || 0));

          let currentRun = [];
          for (let i = 0; i < suitCards.length; i++) {
            const card = suitCards[i];
            if (currentRun.length === 0) {
              currentRun.push(card);
            } else {
              const lastCard = currentRun[currentRun.length - 1];
              const lastVal = rankOrder[lastCard.rank];
              const curVal = rankOrder[card.rank];
              if (curVal === lastVal + 1) {
                currentRun.push(card);
              } else if (curVal > lastVal + 1) {
                if (currentRun.length >= 3) {
                  simMelds.push([...currentRun]);
                  currentRun.forEach(rc => {
                    const idx = tempHand.findIndex(c => c.id === rc.id);
                    if (idx !== -1) tempHand.splice(idx, 1);
                  });
                }
                currentRun = [card];
              }
            }
          }
          if (currentRun.length >= 3) {
            simMelds.push([...currentRun]);
            currentRun.forEach(rc => {
              const idx = tempHand.findIndex(c => c.id === rc.id);
              if (idx !== -1) tempHand.splice(idx, 1);
            });
          }
        }

        // B. Simular secuencias de 3 usando comodines sobre tempHand restante
        for (let suit of suits) {
          let suitCards = tempHand.filter(c => c.suit === suit && c.rank !== '2' && c.rank !== 'Joker');
          suitCards.sort((a, b) => (rankOrder[a.rank] || 0) - (rankOrder[b.rank] || 0));

          const freshWildcards = tempHand.filter(c => c.rank === '2' || c.rank === 'Joker');
          if (freshWildcards.length > 0) {
            for (let i = 0; i < suitCards.length - 1; i++) {
              const c1 = suitCards[i];
              const c2 = suitCards[i+1];
              const v1 = rankOrder[c1.rank];
              const v2 = rankOrder[c2.rank];
              
              if (v2 === v1 + 1 || v2 === v1 + 2) {
                const wc = freshWildcards[0];
                const candidate = [c1, c2, wc];
                const res = validateMeld(candidate);
                if (res.valid) {
                  simMelds.push(candidate);
                  candidate.forEach(rc => {
                    const idx = tempHand.findIndex(c => c.id === rc.id);
                    if (idx !== -1) tempHand.splice(idx, 1);
                  });
                  break;
                }
              }
            }
          }
        }

        // C. Simular tercios (grupos) de 3 o más sobre tempHand restante
        const rankGroups = {};
        tempHand.forEach(card => {
          if (card.rank !== '2' && card.rank !== 'Joker') {
            if (!rankGroups[card.rank]) rankGroups[card.rank] = [];
            rankGroups[card.rank].push(card);
          }
        });

        Object.keys(rankGroups).forEach(rank => {
          const groupCards = rankGroups[rank];
          if (groupCards.length >= 3) {
            simMelds.push([...groupCards]);
            groupCards.forEach(rc => {
              const idx = tempHand.findIndex(c => c.id === rc.id);
              if (idx !== -1) tempHand.splice(idx, 1);
            });
          }
        });

        // D. Simular tercios de 2 + comodín sobre tempHand restante
        const remainingWildcards = tempHand.filter(c => c.rank === '2' || c.rank === 'Joker');
        if (remainingWildcards.length > 0) {
          const tempGroups = {};
          tempHand.forEach(card => {
            if (card.rank !== '2' && card.rank !== 'Joker') {
              if (!tempGroups[card.rank]) tempGroups[card.rank] = [];
              tempGroups[card.rank].push(card);
            }
          });

          for (let rank of Object.keys(tempGroups)) {
            const groupCards = tempGroups[rank];
            if (groupCards.length === 2 && remainingWildcards.length > 0) {
              const wc = remainingWildcards.shift();
              const candidate = [...groupCards, wc];
              simMelds.push(candidate);
              candidate.forEach(rc => {
                const idx = tempHand.findIndex(c => c.id === rc.id);
                if (idx !== -1) tempHand.splice(idx, 1);
              });
            }
          }
        }

        // Calcular valor de todas las simMelds encontradas
        simMelds.forEach(meld => {
          meld.forEach(c => {
            totalSum += CARD_VALUES[c.rank] || 0;
          });
        });

        // Si el total combinado es >= 30, bajarlo de inmediato (obligatorio para activar mesa)
        if (totalSum >= 30) {
          console.log(`IA realiza bajada inicial obligatoria ASAP: totalSum=${totalSum}`);
          simMelds.forEach(meld => {
            tryMeldBotRun(meld, botIdx, true); // Bypassear la validación de 30 puntos individuales
          });
        }
      } else {
        // Si ya bajamos juego antes, bajar cualquier secuencia o tercio válido inmediatamente
        // A. Secuencias
        const suits = ['H', 'D', 'C', 'S'];
        suits.forEach(suit => {
          let suitCards = botHand.filter(c => c.suit === suit && c.rank !== '2');
          const rankOrder = { 'A': 1, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13 };
          suitCards.sort((a, b) => (rankOrder[a.rank] || 0) - (rankOrder[b.rank] || 0));

          let currentRun = [];
          for (let i = 0; i < suitCards.length; i++) {
            const card = suitCards[i];
            if (currentRun.length === 0) {
              currentRun.push(card);
            } else {
              const lastCard = currentRun[currentRun.length - 1];
              const lastVal = rankOrder[lastCard.rank];
              const curVal = rankOrder[card.rank];
              if (curVal === lastVal + 1) {
                currentRun.push(card);
              } else if (curVal > lastVal + 1) {
                if (currentRun.length >= 3) {
                  tryMeldBotRun(currentRun, botIdx, true);
                }
                currentRun = [card];
              }
            }
          }
          if (currentRun.length >= 3) {
            tryMeldBotRun(currentRun, botIdx, true);
          }

          // B. Secuencia de 3 usando comodín
          botPlayer = gameState.players[botIdx];
          botHand = botPlayer.hand;
          suitCards = botHand.filter(c => c.suit === suit && c.rank !== '2');
          suitCards.sort((a, b) => (rankOrder[a.rank] || 0) - (rankOrder[b.rank] || 0));

          const freshWildcards = botHand.filter(c => c.rank === '2' || c.rank === 'Joker');
          if (freshWildcards.length > 0) {
            for (let i = 0; i < suitCards.length - 1; i++) {
              const c1 = suitCards[i];
              const c2 = suitCards[i+1];
              const v1 = rankOrder[c1.rank];
              const v2 = rankOrder[c2.rank];
              
              if (v2 === v1 + 1 || v2 === v1 + 2) {
                const wc = freshWildcards[0];
                const candidate = [c1, c2, wc];
                const res = validateMeld(candidate);
                if (res.valid) {
                  tryMeldBotRun(candidate, botIdx, true);
                  break;
                }
              }
            }
          }
        });

        // B. Grupos (Tercios)
        botPlayer = gameState.players[botIdx];
        botHand = botPlayer.hand;
        const rankGroups = {};
        botHand.forEach(card => {
          if (card.rank !== '2' && card.rank !== 'Joker') {
            if (!rankGroups[card.rank]) rankGroups[card.rank] = [];
            rankGroups[card.rank].push(card);
          }
        });

        Object.keys(rankGroups).forEach(rank => {
          const groupCards = rankGroups[rank];
          if (groupCards.length >= 3) {
            tryMeldBotRun(groupCards, botIdx, true);
          } else if (groupCards.length === 2) {
            botPlayer = gameState.players[botIdx];
            botHand = botPlayer.hand;
            const freshWildcards = botHand.filter(c => c.rank === '2' || c.rank === 'Joker');
            if (freshWildcards.length > 0) {
              const candidate = [...groupCards, freshWildcards[0]];
              tryMeldBotRun(candidate, botIdx, true);
            }
          }
        });
      }
    }

    checkMortoDirect(botIdx);
    sendStateToAll();

    // Esperar 1.5s antes de Descartar
    setTimeout(() => {
      if (!gameState || gameState.status !== 'playing') {
        isBotThinking = false;
        return;
      }

      botPlayer = gameState.players[botIdx];
      botHand = botPlayer.hand;

      if (botHand.length === 0) {
        isBotThinking = false;
        return;
      }

      // Heurística de descarte
      let discardIdx = 0;
      let minScore = Infinity;

      for (let i = 0; i < botHand.length; i++) {
        const card = botHand[i];
        let score = 0;

        if (card.rank === 'Joker') score += 1000;
        else if (card.rank === '2') score += 500;
        else {
          const sameSuitCount = botHand.filter(c => c.suit === card.suit).length;
          score += sameSuitCount * 10;
          score += (CARD_VALUES[card.rank] || 5);
        }

        // Evitar descartar cartas que le sirvan al oponente en sus juegos bajados
        const opponentTeamOwnerIdx = teamIdx === 0 ? 1 : 0;
        const opponentPlayer = gameState.players[opponentTeamOwnerIdx];
        let servesOpponent = false;
        
        if (opponentPlayer && opponentPlayer.melds) {
          for (const meld of opponentPlayer.melds) {
            // Probar si la carta se puede acoplar a este juego del rival
            const testMeld = [...meld, card];
            if (validateMeld(testMeld).valid) {
              servesOpponent = true;
              break;
            }
          }
        }
        
        if (servesOpponent) {
          score += 300; // Gran penalización para evitar descartar cartas útiles para el rival
        }

        if (score < minScore) {
          minScore = score;
          discardIdx = i;
        }
      }

      const cardToDiscard = botHand[discardIdx];

      // Verificación de batida
      if (botHand.length === 1) {
        const hasTakenMorto = gameState.is4Player ? (gameState.mortosTaken[teamIdx] !== null) : gameState.mortosTaken[botIdx];
        const canastrasCount = botMelds.filter(m => m.length >= 7).length;
        const requiredCanastras = gameState.requiredCanastras || 1;

        if (hasTakenMorto && canastrasCount >= requiredCanastras) {
          botHand.splice(discardIdx, 1);
          gameState.discardPile.push(cardToDiscard);
          gameState.status = 'finished';
          gameState.winner = botIdx;
          gameState.turnState = 'confirm-scores';
          gameState.lastAction = `¡${botPlayer.name} ha batido! Fin de la ronda. Esperando confirmación de puntos.`;
          
          gameState.roundScores = calculateRoundScores(gameState);
          
          isBotThinking = false;
          sendStateToAll();
          return;
        } else {
          if (!hasTakenMorto) {
            botHand.splice(discardIdx, 1);
            gameState.discardPile.push(cardToDiscard);
            gameState.lastAction = `${botPlayer.name} descartó ${cardToDiscard.rank} de ${cardToDiscard.suit}.`;
            checkMortoIndirect(botIdx);
          } else {
            gameState.lastAction = `${botPlayer.name} pasa sin descartar por falta de canastras.`;
          }
        }
      } else {
        botHand.splice(discardIdx, 1);
        gameState.discardPile.push(cardToDiscard);
        gameState.lastAction = `${botPlayer.name} descartó ${cardToDiscard.rank} de ${cardToDiscard.suit}.`;
        checkMortoIndirect(botIdx);
      }

      // Pasar turno al siguiente jugador
      const nextTurn = gameState.is4Player ? (botIdx + 1) % 4 : 0;
      isBotThinking = false;
      startPlayerTurn(nextTurn);

      sendStateToAll();
    }, 1500);

  }, 1500);
}

function tryMeldBotRun(cardsToMeld, botIdx, hasMelded) {
  const botPlayer = gameState.players[botIdx];
  const botHand = botPlayer.hand;
  const teamIdx = getTeamOwnerIndex(botIdx, gameState.is4Player);
  const botMelds = gameState.players[teamIdx].melds;

  const result = validateMeld(cardsToMeld);
  if (!result.valid) return false;

  const hasTakenMorto = gameState.is4Player ? (gameState.mortosTaken[teamIdx] !== null) : gameState.mortosTaken[botIdx];
  const canastrasCount = botMelds.filter(m => m.length >= 7).length;
  const requiredCanastras = gameState.requiredCanastras || 1;
  const newCanastraCreated = result.cards.length >= 7 ? 1 : 0;
  const totalCanastrasAfter = canastrasCount + newCanastraCreated;
  const canBat = hasTakenMorto && (totalCanastrasAfter >= requiredCanastras);
  const minCardsHand = !hasTakenMorto ? 0 : (canBat ? 0 : 2);

  if (botHand.length - cardsToMeld.length < minCardsHand) {
    return false; // Evitar bajar si nos deja con menos cartas de las permitidas
  }

  if (result.valid) {

    cardsToMeld.forEach(cardToRem => {
      const idx = botHand.findIndex(hc => hc.id === cardToRem.id);
      if (idx !== -1) botHand.splice(idx, 1);
    });

    gameState.players[teamIdx].melds.push(result.cards);
    gameState.lastAction = `${botPlayer.name} bajó juego: ${result.clean ? 'Limpio' : 'Sucio'} (${cardsToMeld.length} cartas).`;
    
    const tookMortoIndirect = checkMortoIndirect(botIdx);
    if (!tookMortoIndirect) {
      checkDirectBatida(botIdx);
    }
    return true;
  }
  return false;
}

server.listen(PORT, () => {
  console.log(`-----------------------------------------------------`);
  console.log(`Servidor de Buraco ejecutándose en:`);
  console.log(`- Local: http://localhost:${PORT}`);
  console.log(`- Red Local: http://${LOCAL_IP}:${PORT}`);
  console.log(`-----------------------------------------------------`);
});
