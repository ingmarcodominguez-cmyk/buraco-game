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
  app.use(express.static(distPath, {
    setHeaders: (res, filePath) => {
      if (path.basename(filePath) === 'index.html') {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
      }
    }
  }));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.includes('.')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
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
  actionText += cardStrings.join(', ') + `. Gana ${players[w].name} y sale de mano (Sur).`;

  if (is4Player) {
    const seats = new Array(4);
    const team1 = [0, 2];
    const team2 = [1, 3];
    const winnerTeam = team1.includes(w) ? team1 : team2;
    const loserTeam = team1.includes(w) ? team2 : team1;

    seats[0] = players[w]; // Sur
    seats[2] = players[winnerTeam.find(idx => idx !== w)]; // Norte

    // De la pareja perdedora, el de mayor carta va a Este (1) y el menor a Oeste (3)
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
    actionText += ` Mesa de juego: Sur: ${players[0].name} (inicia), Este: ${players[1].name}, Norte: ${players[2].name}, Oeste: ${players[3].name}.`;
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
    // (Para la IA incluimos devHand con las cartas reales para habilitar el Modo Desarrollo en el cliente)
    return {
      ...p,
      hand: new Array(p.hand.length).fill({ id: 'hidden', isHidden: true }),
      devHand: p.isBot ? p.hand : undefined,
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
    // Si la partida anterior ya finalizó, limpiar el estado para empezar una nueva
    if (gameState && gameState.status === 'finished') {
      console.log('La partida anterior ya finalizó. Limpiando estado para iniciar una nueva sala.');
      players = [];
      gameState = null;
      globalScores = [0, 0];
    }

    // Si no hay otros humanos conectados, y cambian la configuración (2P vs 4P o Bots), reiniciar el lobby
    const otherActiveHumans = players.filter(p => p.socketId && p.socketId !== socket.id && !p.isBot);
    if (otherActiveHumans.length === 0) {
      const is4PVal = is4Player !== undefined ? !!is4Player : is4PlayerSetting;
      const isBotVal = isAgainstBot !== undefined ? !!isAgainstBot : isAgainstBotSetting;
      if (is4PlayerSetting !== is4PVal || isAgainstBotSetting !== isBotVal) {
        console.log('Las configuraciones del lobby cambiaron y no hay otros humanos conectados. Reseteando lobby.');
        players = [];
        gameState = null;
        globalScores = [0, 0];
      }
    }

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

    // Guardar snapshot de inicio de turno para permitir deshacer
    if (gameState.players[pIdx] && !gameState.players[pIdx].isBot) {
      const { turnStartSnapshot, ...snapshotData } = gameState;
      gameState.turnStartSnapshot = JSON.parse(JSON.stringify(snapshotData));
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

    // Guardar snapshot de inicio de turno para permitir deshacer
    if (gameState.players[pIdx] && !gameState.players[pIdx].isBot) {
      const { turnStartSnapshot, ...snapshotData } = gameState;
      gameState.turnStartSnapshot = JSON.parse(JSON.stringify(snapshotData));
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
        socket.emit('error-message', 'No puedes quedarte con menos de 2 cartas en la mano. Necesitas canastas para batir y debes conservar al menos una para tu descarte.');
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

    // Comprobar si toma muerto directo
    const tookMortoDirect = checkMortoDirect(pIdx);
    if (!tookMortoDirect) {
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
        socket.emit('error-message', 'No puedes quedarte con menos de 2 cartas en la mano. Necesitas canastas para batir y debes conservar al menos una para tu descarte.');
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

    // Comprobar si toma muerto directo
    const tookMortoDirect = checkMortoDirect(pIdx);
    if (!tookMortoDirect) {
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
        socket.emit('error-message', `No puedes terminar (bater) sin tener al menos ${requiredCanastras} ${requiredCanastras === 1 ? 'canasta' : 'canastas'}. (Tenés ${canastrasCount}).`);
        return;
      }

      if (hasTakenMorto && canastrasCount >= requiredCanastras) {
        // Bate y finaliza la ronda visualmente!
        hand.splice(cardIdx, 1);
        gameState.discardPile.push(card);
        gameState.status = 'finished-visual';
        gameState.winner = pIdx;
        gameState.turnState = 'match-over-visual';
        gameState.lastAction = `¡${gameState.players[pIdx].name} ha batido la mano!`;
        gameState.cutterIndex = pIdx;
        
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

  // Mostrar la planilla de puntajes al hacer clic en "Ver Puntaje" tras el corte
  socket.on('show-scores-sheet', () => {
    if (!gameState || gameState.status !== 'finished-visual') return;
    
    gameState.status = 'finished';
    gameState.turnState = 'confirm-scores';
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
    
    const maxPlayers = gameState.is4Player ? 4 : 2;
    const isPrevPlayer = pIdx === (gameState.is4Player 
      ? (gameState.turn - 1 + 4) % 4 
      : (gameState.turn === 0 ? 1 : 0)
    );

    const isValidUndoRequest = (
      // Caso 1: Es su turno y ya robó (está jugando)
      (gameState.turn === pIdx && gameState.turnState !== 'draw') ||
      // Caso 2: Es el jugador anterior y el actual no ha robado aún
      (isPrevPlayer && gameState.turnState === 'draw')
    );

    if (!isValidUndoRequest) {
      if (gameState.turn === pIdx && gameState.turnState === 'draw') {
        socket.emit('error-message', 'No puedes volver atrás un turno que aún no ha comenzado (debes robar primero).');
      } else {
        socket.emit('error-message', 'No puedes solicitar deshacer en este momento.');
      }
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

    // Si hay rivales humanos, cambiar estado a esperando confirmación del rival y avisar a todos
    gameState.undoRequestedBy = pIdx;
    sendStateToAll();
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

  // Simular corte/batida instantáneo (para pruebas/depuración)
  socket.on('debug-simulate-batida', () => {
    if (!gameState || gameState.status !== 'playing') return;

    const pIdx = gameState.turn;
    const hand = gameState.players[pIdx].hand;

    // Obtener la última carta de la mano para descartarla, o usar una dummy si no tiene
    const cardToDiscard = hand.length > 0 ? hand[hand.length - 1] : { id: 'dummy', rank: 'A', suit: 'H' };

    if (hand.length > 0) {
      hand.splice(hand.length - 1, 1);
    }
    
    gameState.discardPile.push(cardToDiscard);
    gameState.status = 'finished-visual';
    gameState.winner = pIdx;
    gameState.turnState = 'match-over-visual';
    gameState.lastAction = `¡${gameState.players[pIdx].name} ha batido la mano (Simulación de depuración)!`;
    gameState.cutterIndex = pIdx;

    // Calcular puntuaciones
    gameState.roundScores = calculateRoundScores(gameState);

    sendStateToAll();
  });

  // Abandonar la partida explícitamente (abortar juego y limpiar lobby)
  socket.on('leave-game', () => {
    console.log(`Un jugador solicitó abandonar la partida: ${socket.id}`);
    
    // Si la partida está activa, notificar a los demás y resetear todo
    if (gameState) {
      io.emit('game-aborted', 'La partida fue cancelada porque un jugador la abandonó.');
    }
    
    // Resetear lobby
    players = [];
    gameState = null;
    globalScores = [0, 0];
    isBotThinking = false;
    if (cleanupTimeout) {
      clearTimeout(cleanupTimeout);
      cleanupTimeout = null;
    }
    
    io.emit('lobby-update', []);
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
    gameState.status = 'finished-visual';
    gameState.winner = pIdx;
    gameState.cutterIndex = pIdx;
    gameState.turnState = 'match-over-visual';
    gameState.lastAction = `¡${gameState.players[pIdx].name} ha batido la mano!`;
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
      gameState.mortoAlert = {
        playerName: player.name,
        isDirect: true,
        playerIdx,
        timestamp: Date.now()
      };
      return true;
    }
  }
  return false;
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
      gameState.mortoAlert = {
        playerName: player.name,
        isDirect: false,
        playerIdx,
        timestamp: Date.now()
      };
      return true;
    }
  }
  return false;
}

// HELPER: Rastrear cartas visibles e invisibles en la partida
function getCardTracker(state, botIdx) {
  // Inicializar mapa de conteo visible
  const visible = {};
  const suits = ['H', 'D', 'C', 'S', 'Joker'];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'Joker'];
  
  suits.forEach(s => {
    ranks.forEach(r => {
      visible[`${s}-${r}`] = 0;
    });
  });

  const countCard = (c) => {
    if (c && c.rank !== 'hidden') {
      const key = `${c.suit}-${c.rank}`;
      if (visible[key] !== undefined) {
        visible[key]++;
      }
    }
  };

  // 1. Mano propia del bot
  if (state.players[botIdx] && state.players[botIdx].hand) {
    state.players[botIdx].hand.forEach(countCard);
  }

  // 2. Juegos en la mesa (de todos los equipos)
  state.players.forEach(p => {
    if (p.melds) {
      p.melds.forEach(meld => {
        if (meld) {
          meld.forEach(countCard);
        }
      });
    }
  });

  // 3. Pozo de descartes
  if (state.discardPile) {
    state.discardPile.forEach(countCard);
  }

  // Mapear conteo total de cartas invisibles y sus probabilidades
  const totalVisible = Object.values(visible).reduce((a, b) => a + b, 0);
  const totalInvisible = 108 - totalVisible;

  return {
    visible,
    totalVisible,
    totalInvisible,
    getRemainingCount: (suit, rank) => {
      const maxCount = (suit === 'Joker') ? 4 : 2;
      const seen = visible[`${suit}-${rank}`] || 0;
      return Math.max(0, maxCount - seen);
    }
  };
}

// HELPER: Calcular la probabilidad de robar una carta específica del mazo
function getProbabilityOfCard(suit, rank, tracker) {
  if (tracker.totalInvisible <= 0) return 0;
  const remaining = tracker.getRemainingCount(suit, rank);
  return remaining / tracker.totalInvisible;
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
  const opponentTeamIdx = teamIdx === 0 ? 1 : 0;

  // Rastrear cartas
  const tracker = getCardTracker(gameState, botIdx);

  // FASE 1: ROBAR
  let drewFromDiscard = false;
  const isBlockedFromDiscard = gameState.is4Player && gameState.mortosTaken[teamIdx] === botIdx;

  if (topDiscard && gameState.discardPile.length > 0 && !isBlockedFromDiscard) {
    const teamMelds = gameState.players[teamIdx].melds;

    // REGLA ESTRICTA: Para tomar el pozo SI O SI debe haber bajado al menos 30 puntos
    let totalMeldPoints = 0;
    teamMelds.forEach(meld => {
      meld.forEach(c => {
        totalMeldPoints += CARD_VALUES[c.rank] || 0;
      });
    });
    const hasMelded = totalMeldPoints >= 30;

    if (hasMelded) {
      const botHasMorto = gameState.is4Player 
        ? (gameState.mortosTaken[teamIdx] !== null) 
        : Boolean(gameState.mortosTaken[botIdx]);
      const opponentHasMorto = gameState.is4Player 
        ? (gameState.mortosTaken[opponentTeamIdx] !== null) 
        : Boolean(gameState.mortosTaken[opponentTeamIdx]);

      const opponentPlayer = gameState.players[opponentTeamIdx];
      const opponentHandSize = opponentPlayer?.hand?.length || 0;
      const opponentMelds = opponentPlayer?.melds || [];
      const oppCleanCount = opponentMelds.filter(m => m.length >= 7 && !m.some(c => c && c.isUsedAsWildcard)).length;
      const oppDirtyCount = opponentMelds.filter(m => m.length >= 7 && m.some(c => c && c.isUsedAsWildcard)).length;
      const opponentHasCanasta = oppCleanCount + oppDirtyCount > 0;
      const opponentNearCanasta = opponentMelds.some(m => m.length >= 6);
      const opponentCanWinSoon = opponentHasCanasta || opponentNearCanasta;

      // MODO DE EMERGENCIA DEFENSIVA (Peligro REAL de corte del rival):
      // Para que haya peligro real de corte, el rival OBLIGATORIAMENTE debe:
      // 1. Haber tomado el muerto (opponentHasMorto === true).
      // 2. Tener al menos 1 canasta ya hecha O un juego de 6 cartas a tiro de canasta (opponentCanWinSoon).
      // 3. Tener pocas cartas en mano (opponentHandSize <= 5).
      // Si el rival NO tiene canasta ni juego de 6 cartas, ¡NO PUEDE CORTAR! No hay peligro inminente.
      const isDefensiveSurvivalMode = !gameState.is4Player && opponentHasMorto && !botHasMorto && opponentCanWinSoon && (opponentHandSize <= 5);
      const opponentImminentWin = opponentHasMorto && opponentHasCanasta && opponentHandSize <= 3;

      // 1. Evaluar si la carta superior sirve directamente para acoplar o armar un juego ya
      let servesForAppend = false;
      for (const meld of teamMelds) {
        if (validateMeld([...meld, topDiscard]).valid) {
          servesForAppend = true;
          break;
        }
      }

      const simCurrent = simulateBotMelding(botHand, teamMelds);
      const simWithTop = simulateBotMelding([...botHand, topDiscard], teamMelds);
      const servesForNewMeld = simWithTop.cardsPlayed > simCurrent.cardsPlayed;
      const isWildcard = topDiscard.rank === '2' || topDiscard.rank === 'Joker';
      const topCardServes = servesForAppend || servesForNewMeld || isWildcard;

      // 2. Simular qué ocurre si recogemos TODO el pozo
      const simWithDiscard = simulateBotMelding([...botHand, ...gameState.discardPile], teamMelds);
      const remainingWithDiscard = (botHand.length + gameState.discardPile.length) - simWithDiscard.cardsPlayed;
      const cardsGainedFromPile = simWithDiscard.cardsPlayed - simCurrent.cardsPlayed;
      const unplayableAdded = gameState.discardPile.length - cardsGainedFromPile;

      // 3. Evaluar si permite ir al muerto o batir de inmediato
      const canTakeMortoWithDiscard = !botHasMorto && (remainingWithDiscard <= 1);
      const canWinWithDiscard = botHasMorto && (remainingWithDiscard <= 1) && ((teamMelds.filter(m => m.length >= 7).length) >= (gameState.requiredCanastras || 1));

      if (canTakeMortoWithDiscard || canWinWithDiscard) {
        // Prioridad máxima: ir al muerto o batir en este mismo turno
        drewFromDiscard = true;
      } else if (isDefensiveSurvivalMode || opponentImminentWin) {
        // =========================================================================
        // RECIÉN CUANDO EL RIVAL SE VA AL MUERTO Y TIENE CANASTA (PELIGRO REAL DE CORTE):
        // =========================================================================
        // Tratar de no acumular puntos levantando posibles juegos futuros.
        // Solo levantar si la carta superior sirve Y todas las cartas del pozo se bajan
        // de inmediato (unplayableAdded === 0).
        if (topCardServes && unplayableAdded === 0) {
          drewFromDiscard = true;
        }
      } else {
        // =========================================================================
        // SI EL RIVAL NO TIENE MUERTO, O TIENE MUERTO PERO ESTÁ LEJOS DE CERRAR (0 CANASTAS):
        // =========================================================================
        // La IA analiza que el rival está lejos de cortar. Si la carta superior sirve
        // para acoplar a sus juegos (ej. K de trébol) o hay comodines, ¡LEVANTAR!
        const pileEval = evaluatePilePotential(gameState.discardPile, botHand, tracker);

        // 1. Si la carta superior sirve de inmediato (acople, nueva combinación o comodín):
        if (topCardServes) {
          // Si el rival tiene muerto (pero 0 canastas), levantar si el pozo no satura en exceso (<= 3 cartas no bajables)
          if (!opponentHasMorto || unplayableAdded <= 3) {
            drewFromDiscard = true;
          }
        }
        // 2. Si hay algún comodín en el pozo (2 o Joker):
        else if (pileEval.hasWildcard || isWildcard) {
          drewFromDiscard = true;
        }
        // 3. Si la carta superior conecta con la mano (para futura escalera o triada):
        else if (pileEval.topConn > 0) {
          if (!opponentHasMorto || unplayableAdded <= 2) {
            drewFromDiscard = true;
          }
        }
        // 4. Si el pozo contiene cartas útiles que conectan con la mano:
        else if (pileEval.usefulCards >= 1 && pileEval.connectionScore >= 2) {
          if (!opponentHasMorto || unplayableAdded <= 2) {
            drewFromDiscard = true;
          }
        }
        // 5. Si al recoger el pozo puede bajar al menos un juego de inmediato:
        else if (cardsGainedFromPile >= 3) {
          drewFromDiscard = true;
        }
        // 6. Si el pozo tiene 3 o más cartas y al menos 2 cartas con potencial/conexión:
        else if (gameState.discardPile.length >= 3 && pileEval.usefulCards >= 2) {
          if (!opponentHasMorto) {
            drewFromDiscard = true;
          }
        }
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

    function executeBotMeldStep() {
      if (!gameState || gameState.status !== 'playing') {
        isBotThinking = false;
        return;
      }

      const didSomething = performOneBotMeldAction(botIdx);
      if (didSomething) {
        sendStateToAll();
        setTimeout(executeBotMeldStep, 1200);
      } else {
        setTimeout(() => {
          runBotDiscardPhase(botIdx);
        }, 1200);
      }
    }

    executeBotMeldStep();
  }, 1500);
}

// SIMULADOR DE BAJADA DE LA IA PARA CÁLCULO DE PUNTOS Y CARTAS JUGADAS
function simulateBotMelding(hand, existingMelds) {
  let tempHand = [...hand];
  let tempMelds = existingMelds.map(m => [...m]);
  let cardsPlayed = 0;

  // 1. Simular acoples a juegos existentes
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
          if (isCurrentCleanCanastra && !isNewClean) continue;
          tempMelds[mIdx] = result.cards;
          tempHand.splice(cIdx, 1);
          cardsPlayed++;
          tempAppended = true;
          break;
        }
      }
      if (tempAppended) break;
    }
  } while (tempAppended);

  // 2. Simular nuevas secuencias limpias
  const suits = ['H', 'D', 'C', 'S'];
  const rankOrder = { 'A': 1, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13 };
  
  for (let suit of suits) {
    let suitCards = tempHand.filter(c => c.suit === suit && c.rank !== '2' && c.rank !== 'Joker');
    suitCards.sort((a, b) => (rankOrder[a.rank] || 0) - (rankOrder[b.rank] || 0));
    let run = [];
    for (let i = 0; i < suitCards.length; i++) {
      const card = suitCards[i];
      if (run.length === 0) run.push(card);
      else {
        const lastVal = rankOrder[run[run.length - 1].rank];
        const curVal = rankOrder[card.rank];
        if (curVal === lastVal + 1) run.push(card);
        else if (curVal > lastVal + 1) {
          if (run.length >= 3) {
            const result = validateMeld(run);
            if (result.valid) {
              tempMelds.push(result.cards);
              cardsPlayed += run.length;
              run.forEach(rc => {
                const idx = tempHand.findIndex(c => c.id === rc.id);
                if (idx !== -1) tempHand.splice(idx, 1);
              });
            }
          }
          run = [card];
        }
      }
    }
    if (run.length >= 3) {
      const result = validateMeld(run);
      if (result.valid) {
        tempMelds.push(result.cards);
        cardsPlayed += run.length;
        run.forEach(rc => {
          const idx = tempHand.findIndex(c => c.id === rc.id);
          if (idx !== -1) tempHand.splice(idx, 1);
        });
      }
    }
  }

  // 3. Simular nuevas secuencias sucias usando comodines
  let wildcards = tempHand.filter(c => c.rank === '2' || c.rank === 'Joker');
  if (wildcards.length > 0) {
    for (let suit of suits) {
      let suitCards = tempHand.filter(c => c.suit === suit && c.rank !== '2');
      suitCards.sort((a, b) => (rankOrder[a.rank] || 0) - (rankOrder[b.rank] || 0));
      for (let i = 0; i < suitCards.length - 1; i++) {
        if (wildcards.length === 0) break;
        const c1 = suitCards[i];
        const c2 = suitCards[i+1];
        const v1 = rankOrder[c1.rank];
        const v2 = rankOrder[c2.rank];
        if (v2 === v1 + 1 || v2 === v1 + 2) {
          const wc = wildcards[0];
          const candidate = [c1, c2, wc];
          const result = validateMeld(candidate);
          if (result.valid) {
            tempMelds.push(result.cards);
            wildcards.shift();
            cardsPlayed += 3;
            [c1, c2, wc].forEach(rc => {
              const idx = tempHand.findIndex(c => c.id === rc.id);
              if (idx !== -1) tempHand.splice(idx, 1);
            });
            suitCards = tempHand.filter(c => c.suit === suit && c.rank !== '2');
            suitCards.sort((a, b) => (rankOrder[a.rank] || 0) - (rankOrder[b.rank] || 0));
            i = -1;
          }
        }
      }
    }
  }

  // 4. Simular nuevos grupos limpios
  const rankGroups = {};
  tempHand.forEach(card => {
    if (card.rank !== '2' && card.rank !== 'Joker') {
      if (!rankGroups[card.rank]) rankGroups[card.rank] = [];
      rankGroups[card.rank].push(card);
    }
  });
  for (const rank of Object.keys(rankGroups)) {
    const groupCards = rankGroups[rank];
    if (groupCards.length >= 3) {
      const result = validateMeld(groupCards);
      if (result.valid) {
        tempMelds.push(result.cards);
        cardsPlayed += groupCards.length;
        groupCards.forEach(rc => {
          const idx = tempHand.findIndex(c => c.id === rc.id);
          if (idx !== -1) tempHand.splice(idx, 1);
        });
      }
    }
  }

  // 5. Simular nuevos grupos sucios usando comodines
  wildcards = tempHand.filter(c => c.rank === '2' || c.rank === 'Joker');
  if (wildcards.length > 0) {
    const remainingGroups = {};
    tempHand.forEach(card => {
      if (card.rank !== '2' && card.rank !== 'Joker') {
        if (!remainingGroups[card.rank]) remainingGroups[card.rank] = [];
        remainingGroups[card.rank].push(card);
      }
    });
    for (const rank of Object.keys(remainingGroups)) {
      if (wildcards.length === 0) break;
      const groupCards = remainingGroups[rank];
      if (groupCards.length === 2) {
        const wc = wildcards[0];
        const candidate = [...groupCards, wc];
        const result = validateMeld(candidate);
        if (result.valid) {
          tempMelds.push(result.cards);
          wildcards.shift();
          cardsPlayed += 3;
          candidate.forEach(rc => {
            const idx = tempHand.findIndex(c => c.id === rc.id);
            if (idx !== -1) tempHand.splice(idx, 1);
          });
        }
      }
    }
  }

  // Calcular puntos totales de los melds
  let points = 0;
  tempMelds.forEach(meld => {
    meld.forEach(c => {
      points += CARD_VALUES[c.rank] || 0;
    });
  });

  return { cardsPlayed, points };
}

// REALIZA EXACTAMENTE UNA ACCIÓN DE ACOPLE O BAJAR UN JUEGO NUEVO
function performOneBotMeldAction(botIdx) {
  let botPlayer = gameState.players[botIdx];
  let botHand = botPlayer.hand;
  const teamIdx = getTeamOwnerIndex(botIdx, gameState.is4Player);
  let botMelds = gameState.players[teamIdx].melds;

  const opponentTeamIdx = teamIdx === 0 ? 1 : 0;
  const opponentPlayer = gameState.players[opponentTeamIdx];
  const opponentHandSize = opponentPlayer?.hand?.length || 0;
  const opponentMelds = opponentPlayer?.melds || [];
  const oppCleanCount = opponentMelds.filter(m => m.length >= 7 && !m.some(c => c && c.isUsedAsWildcard)).length;
  const oppDirtyCount = opponentMelds.filter(m => m.length >= 7 && m.some(c => c && c.isUsedAsWildcard)).length;
  const opponentHasCanasta = oppCleanCount + oppDirtyCount > 0;
  const opponentNearCanasta = opponentMelds.some(m => m.length >= 6);
  const opponentCanWinSoon = opponentHasCanasta || opponentNearCanasta;
  const opponentHasMorto = gameState.is4Player ? (gameState.mortosTaken[opponentTeamIdx] !== null) : gameState.mortosTaken[opponentTeamIdx];
  const botHasMorto = gameState.is4Player ? (gameState.mortosTaken[teamIdx] !== null) : gameState.mortosTaken[botIdx];
  const isDefensiveSurvivalMode = !gameState.is4Player && opponentHasMorto && !botHasMorto && opponentCanWinSoon && (opponentHandSize <= 5);
  const opponentImminentWin = opponentHasMorto && opponentHasCanasta && opponentHandSize <= 3;
  const deckCount = gameState.drawPile.length;

  let botMeldPoints = 0;
  botMelds.forEach(meld => {
    meld.forEach(c => {
      botMeldPoints += CARD_VALUES[c.rank] || 0;
    });
  });
  const isAlreadyMelded = botMeldPoints >= 30;

  // Comprobar apertura inicial de 30 puntos si no está bajado
  if (!isAlreadyMelded) {
    const openingSim = simulateBotMelding(botHand, []);
    if (openingSim.points < 30) {
      return false; // No podemos bajar nada aún porque no sumamos 30
    }
  }

  // Simular jugadas usando el simulador unificado para estimar cartas jugadas
  const sim = simulateBotMelding(botHand, botMelds);
  const cardsPlayedCount = sim.cardsPlayed;

  // PRIORIDAD 1: Ganar la mano (si ya tiene muerto y canasta requerida)
  const canastrasCount = botMelds.filter(m => m.length >= 7).length;
  const requiredCanastras = gameState.requiredCanastras || 1;
  const canWinThisTurn = botHasMorto && (botHand.length - cardsPlayedCount <= 1) && (canastrasCount >= requiredCanastras);

  // PRIORIDAD 2: Ir al muerto (vaciar la mano si no tiene muerto)
  const canTakeMortoThisTurn = !botHasMorto && (botHand.length - cardsPlayedCount <= 1);
  const isCloseToMorto = !botHasMorto && botHand.length <= 4;

  // 1. Intentar realizar exactamente UN acople
  for (let mIdx = 0; mIdx < botMelds.length; mIdx++) {
    const currentMeld = botMelds[mIdx];
    const isCurrentCleanCanastra = currentMeld.length >= 7 && !currentMeld.some(c => c && c.isUsedAsWildcard);
    const createsCanastra = currentMeld.length >= 6;
    const canBatAfterThis = botHasMorto && (canastrasCount >= requiredCanastras || createsCanastra);
    const minCardsHand = !botHasMorto ? 0 : (canBatAfterThis ? 0 : 2);

    for (let cIdx = 0; cIdx < botHand.length; cIdx++) {
      const card = botHand[cIdx];
      if (botHand.length <= minCardsHand) continue;

      const isWildcard = card.rank === '2' || card.rank === 'Joker';
      
      // REGLAS PARA ACOMODAR COMODINES (MONOS):
      // Priorizar los monos: si se pueden acomodar en mesa, debe hacerlo sin dudar.
      // Solo evitar:
      // 1. Ensuciar una canasta que ya es limpia (7+ cartas naturales)
      // 2. Poner más de un comodín en el mismo juego (regla de máximo 1 comodín)
      if (isWildcard) {
        if (isCurrentCleanCanastra) continue;
        if (currentMeld.some(c => c && c.isUsedAsWildcard)) continue;
      }

      const combined = [...currentMeld, card];
      const result = validateMeld(combined);
      if (result.valid) {
        const isNewClean = !result.cards.some(c => c && c.isUsedAsWildcard);
        if (isCurrentCleanCanastra && !isNewClean) continue;

        botMelds[mIdx] = result.cards;
        botHand.splice(cIdx, 1);
        gameState.lastAction = `${botPlayer.name} acopló ${card.rank} de ${card.suit} en mesa.`;
        
        const tookMortoDirect = checkMortoDirect(botIdx);
        if (!tookMortoDirect) {
          checkDirectBatida(botIdx);
        }
        return true;
      }
    }
  }

  // 2. Intentar bajar exactamente un juego nuevo
  const suits = ['H', 'D', 'C', 'S'];
  const rankOrder = { 'A': 1, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13 };

  // Bajar secuencias limpias de 3 o más
  for (let suit of suits) {
    let suitCards = botHand.filter(c => c.suit === suit && c.rank !== '2' && c.rank !== 'Joker');
    suitCards.sort((a, b) => (rankOrder[a.rank] || 0) - (rankOrder[b.rank] || 0));
    let run = [];
    for (let i = 0; i < suitCards.length; i++) {
      const card = suitCards[i];
      if (run.length === 0) run.push(card);
      else {
        const lastVal = rankOrder[run[run.length - 1].rank];
        const curVal = rankOrder[card.rank];
        if (curVal === lastVal + 1) run.push(card);
        else if (curVal > lastVal + 1) {
          if (run.length >= 3) {
            if (tryMeldBotRun(run, botIdx, true)) return true;
          }
          run = [card];
        }
      }
    }
    if (run.length >= 3) {
      if (tryMeldBotRun(run, botIdx, true)) return true;
    }
  }

  // Secuencia usando comodín
  const freshWildcards = botHand.filter(c => c.rank === '2' || c.rank === 'Joker');
  if (freshWildcards.length > 0) {
    for (let suit of suits) {
      let suitCards = botHand.filter(c => c.suit === suit && c.rank !== '2' && c.rank !== 'Joker');
      suitCards.sort((a, b) => (rankOrder[a.rank] || 0) - (rankOrder[b.rank] || 0));
      for (let i = 0; i < suitCards.length - 1; i++) {
        const c1 = suitCards[i];
        const c2 = suitCards[i+1];
        const v1 = rankOrder[c1.rank];
        const v2 = rankOrder[c2.rank];
        if (v2 === v1 + 1 || v2 === v1 + 2) {
          const wc = freshWildcards[0];
          const candidate = [c1, c2, wc];
          if (tryMeldBotRun(candidate, botIdx, true)) return true;
        }
      }
    }
  }

  // Grupos
  const rankGroups = {};
  botHand.forEach(card => {
    if (card.rank !== '2' && card.rank !== 'Joker') {
      if (!rankGroups[card.rank]) rankGroups[card.rank] = [];
      rankGroups[card.rank].push(card);
    }
  });
  for (const rank of Object.keys(rankGroups)) {
    let groupCards = rankGroups[rank];

    // MODO VACIADO DEFENSIVO DE MANO:
    // Si el rival ya tiene canasta y pocas cartas (<= 6), el peligro de corte es inminente.
    // En esta situación de emergencia, ¡DESCARGA TOTAL! No se retiene nada: se bajan todos los grupos posibles
    // para sumar puntos en mesa y evitar penalizaciones de decenas o cientos de puntos en mano.
    const isRivalClosing = opponentHasMorto && opponentHasCanasta && opponentHandSize <= 6;

    if (!isRivalClosing && isAlreadyMelded && !canTakeMortoThisTurn && !isCloseToMorto) {
      // Solo en juego tranquilo: si una carta tiene vecino directo (distancia 1) del mismo palo en mano
      // Y ese palo conecta directamente con una escalera ya bajada en mesa, preservarla para la escalera
      // (siempre y cuando no esté repetida).
      groupCards = groupCards.filter(card => {
        const duplicateCount = botHand.filter(c => c.id !== card.id && c.suit === card.suit && c.rank === card.rank).length;
        if (duplicateCount > 0) return true; // Si está repetida, se puede usar sin problema

        const cardVal = rankOrder[card.rank] || 0;
        // Vecino directo a distancia 1 (ej. 7 y 8 de trébol)
        const hasDirectNeighborInHand = botHand.some(c => 
          c.id !== card.id && 
          c.suit === card.suit && 
          c.rank !== '2' && 
          c.rank !== 'Joker' && 
          Math.abs((rankOrder[c.rank] || 0) - cardVal) === 1
        );

        // Conecta directamente con una escalera propia ya bajada en mesa de ese mismo palo
        const connectsToTableRun = botMelds.some(m => {
          if (m.length > 0 && m[0].suit === card.suit) {
            const rankVals = m.map(mc => rankOrder[mc.representedRank || mc.rank]).filter(Boolean);
            if (rankVals.length > 0) {
              const minVal = Math.min(...rankVals);
              const maxVal = Math.max(...rankVals);
              return Math.abs(cardVal - minVal) <= 2 || Math.abs(cardVal - maxVal) <= 2;
            }
          }
          return false;
        });

        // Solo proteger si tiene vecino directo Y conecta con escalera en mesa
        if (hasDirectNeighborInHand && connectsToTableRun) {
          return false;
        }
        return true;
      });
    }

    if (groupCards.length >= 3) {
      if (tryMeldBotRun(groupCards, botIdx, true)) return true;
    } else if (groupCards.length === 2 && freshWildcards.length > 0) {
      const candidate = [...groupCards, freshWildcards[0]];
      if (tryMeldBotRun(candidate, botIdx, true)) return true;
    }
  }

  return false;
}

// FASE DE DESCARTE DE LA IA
function runBotDiscardPhase(botIdx) {
  if (!gameState || gameState.status !== 'playing') {
    isBotThinking = false;
    return;
  }

  let botPlayer = gameState.players[botIdx];
  let botHand = botPlayer.hand;
  const teamIdx = getTeamOwnerIndex(botIdx, gameState.is4Player);
  const opponentTeamIdx = teamIdx === 0 ? 1 : 0;
  const botMelds = gameState.players[teamIdx].melds;
  const deckCount = gameState.drawPile.length;

  if (botHand.length === 0) {
    isBotThinking = false;
    return;
  }

  // FASE 3: DESCARTAR UTILIZANDO EL MOTOR DE UTILIDAD HEURÍSTICA
  const hasNonWildcards = botHand.some(c => c.rank !== '2' && c.rank !== 'Joker');
  let discardIdx = hasNonWildcards ? botHand.findIndex(c => c.rank !== '2' && c.rank !== 'Joker') : 0;
  let minScore = Infinity;

  const nextPlayerIdx = gameState.is4Player ? (botIdx + 1) % 4 : (botIdx === 0 ? 1 : 0);
  const nextPlayerTeamIdx = getTeamOwnerIndex(nextPlayerIdx, gameState.is4Player);
  const nextPlayerBlocked = gameState.is4Player && gameState.mortosTaken[nextPlayerTeamIdx] === nextPlayerIdx;

  const opponentPlayer = gameState.players[opponentTeamIdx];
  const rankOrderVals = { 'A': 1, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13 };

  const opponentHandSize = opponentPlayer?.hand?.length || 0;
  const opponentMelds = opponentPlayer?.melds || [];
  const oppCleanCount = opponentMelds.filter(m => m.length >= 7 && !m.some(c => c && c.isUsedAsWildcard)).length;
  const oppDirtyCount = opponentMelds.filter(m => m.length >= 7 && m.some(c => c && c.isUsedAsWildcard)).length;
  const opponentHasCanasta = oppCleanCount + oppDirtyCount > 0;
  const opponentNearCanasta = opponentMelds.some(m => m.length >= 6);
  const opponentCanWinSoon = opponentHasCanasta || opponentNearCanasta;
  const opponentHasMorto = gameState.is4Player ? (gameState.mortosTaken[opponentTeamIdx] !== null) : gameState.mortosTaken[opponentTeamIdx];
  const botHasMorto = gameState.is4Player ? (gameState.mortosTaken[teamIdx] !== null) : gameState.mortosTaken[botIdx];

  const isDefensiveSurvivalMode = !gameState.is4Player && opponentHasMorto && !botHasMorto && opponentCanWinSoon && (opponentHandSize <= 5);
  const opponentImminentWin = opponentHasMorto && opponentHasCanasta && opponentHandSize <= 3;

  for (let i = 0; i < botHand.length; i++) {
    const card = botHand[i];
    const isWildcard = card.rank === '2' || card.rank === 'Joker';

    // REGLA FUNDAMENTAL DE BURACO:
    // Bajo NINGÚN concepto descartar un mono (2 o Joker) salvo que no quede otra posibilidad
    // (es decir, que la mano esté compuesta 100% exclusivamente de comodines).
    if (isWildcard && hasNonWildcards) {
      continue;
    }

    let score = 0;

    // Filtro de peligro contra oponentes: ¿Le sirve al rival para acoplar o agrandar sus juegos?
    let servesOpponent = false;
    if (opponentPlayer && opponentPlayer.melds) {
      for (const meld of opponentPlayer.melds) {
        if (validateMeld([...meld, card]).valid) {
          servesOpponent = true;
          break;
        }
      }
    }

    let adjacentToOpponentMeld = false;
    if (opponentPlayer && opponentPlayer.melds) {
      for (const meld of opponentPlayer.melds) {
        if (meld.length > 0 && meld[0].suit === card.suit) {
          const rankVals = meld.map(c => rankOrderVals[c.rank]).filter(Boolean);
          if (rankVals.length > 0) {
            const minVal = Math.min(...rankVals);
            const maxVal = Math.max(...rankVals);
            const cardVal = rankOrderVals[card.rank];
            if (cardVal === minVal - 1 || cardVal === maxVal + 1) {
              adjacentToOpponentMeld = true;
              break;
            }
          }
        }
      }
    }

    let dangerPenalty = 0;
    if (isDefensiveSurvivalMode || opponentImminentWin) {
      // EN MODO SUPERVIVENCIA DEFENSIVA:
      // NUNCA tirarle cartas al rival que le permitan cerrar o acoplar.
      // Retenerlas para lograr la supervivencia.
      if (servesOpponent) dangerPenalty += 5000;
      else if (adjacentToOpponentMeld) dangerPenalty += 2000;
      if (opponentHandSize <= 3 && servesOpponent) dangerPenalty += 10000;

      // No descartar comodines si el rival está cerca de cerrar
      if (card.rank === 'Joker' || card.rank === '2') dangerPenalty += 3000;

      // Entre las cartas SEGURAS (donde dangerPenalty === 0), descartar la de mayor puntaje para minimizar penalización en mano
      score = -CARD_VALUES[card.rank] + dangerPenalty;
    } else {
      // EN JUEGO NORMAL:
      // Valor de comodines (muy alto para retenerlos)
      if (card.rank === 'Joker') score += 1000;
      else if (card.rank === '2') score += 500;
      else {
        // Valor por conexiones y palo
        const sameSuitCount = botHand.filter(c => c.suit === card.suit).length;
        score += sameSuitCount * 10;
        score += (CARD_VALUES[card.rank] || 5);
        
        const connects = getConnectionsCount(card, botHand);
        score += connects * 100;

        // Conexión directa con juegos propios en la mesa:
        let connectsToMyMelds = 0;
        botMelds.forEach(m => {
          if (m.length > 0 && m[0].suit === card.suit) {
            const rankVals = m.map(mc => rankOrderVals[mc.representedRank || mc.rank]).filter(Boolean);
            if (rankVals.length > 0) {
              const minVal = Math.min(...rankVals);
              const maxVal = Math.max(...rankVals);
              const cardVal = rankOrderVals[card.rank] || 0;
              if (Math.abs(cardVal - minVal) <= 2 || Math.abs(cardVal - maxVal) <= 2) {
                connectsToMyMelds++;
              }
            }
          }
        });
        score += connectsToMyMelds * 150; // ¡Gran retención para no tirar cartas que agrandan nuestros juegos en mesa!
      }

      // Penalización por duplicados (hace que sea preferible descartarla)
      const duplicates = botHand.filter(c => c.rank === card.rank && c.suit === card.suit && c.id !== card.id).length;
      if (duplicates > 0) {
        score -= 80;
      }

      if (servesOpponent) dangerPenalty += 500;
      else if (adjacentToOpponentMeld) dangerPenalty += 250;

      // Defensa: Bloqueo de salida si al rival le quedan pocas cartas
      if (opponentHandSize <= 3 && servesOpponent) {
        dangerPenalty += 500;
      }

      // APLICACIÓN DE LA REGLA DE BLOQUEO DEL MUERTO EN 4 JUGADORES:
      if (nextPlayerBlocked) {
        dangerPenalty = 0;
        const partnerIdx = (botIdx + 2) % 4;
        const partnerMelds = gameState.players[teamIdx]?.melds || [];
        let servesPartner = false;
        for (const meld of partnerMelds) {
          if (validateMeld([...meld, card]).valid) {
            servesPartner = true;
            break;
          }
        }
        if (servesPartner) {
          score -= 600;
        }
      }

      score += dangerPenalty;
    }

    if (score < minScore) {
      minScore = score;
      discardIdx = i;
    }
  }

  const cardToDiscard = botHand[discardIdx];

  // AUDITORÍA PRE-CORTE (CIERRE)
  let shouldWin = true;
  if (botHand.length === 1) {
    const canastrasCount = botMelds.filter(m => m.length >= 7).length;
    const requiredCanastras = gameState.requiredCanastras || 1;
    const hasTakenMorto = gameState.is4Player ? (gameState.mortosTaken[teamIdx] !== null) : gameState.mortosTaken[botIdx];

    if (hasTakenMorto && canastrasCount >= requiredCanastras) {
      let myMeldPoints = 0;
      botMelds.forEach(m => m.forEach(c => myMeldPoints += CARD_VALUES[c.rank] || 0));
      const myCleanCount = botMelds.filter(m => m.length >= 7 && !m.some(c => c && c.isUsedAsWildcard)).length;
      const myDirtyCount = botMelds.filter(m => m.length >= 7 && m.some(c => c && c.isUsedAsWildcard)).length;

      let oppMeldPoints = 0;
      const oppMelds = gameState.players[opponentTeamIdx]?.melds || [];
      oppMelds.forEach(m => m.forEach(c => oppMeldPoints += CARD_VALUES[c.rank] || 0));
      const oppCleanCount = oppMelds.filter(m => m.length >= 7 && !m.some(c => c && c.isUsedAsWildcard)).length;
      const oppDirtyCount = oppMelds.filter(m => m.length >= 7 && m.some(c => c && c.isUsedAsWildcard)).length;

      const myEstTotal = myMeldPoints + myCleanCount * 200 + myDirtyCount * 100 + 100;
      const oppEstTotal = oppMeldPoints + oppCleanCount * 200 + oppDirtyCount * 100;
      const netDiff = myEstTotal - oppEstTotal;

      if (netDiff < 0 && deckCount > 8) {
        shouldWin = false;
      }
    }
  }

  if (botHand.length === 1 && shouldWin) {
    const hasTakenMorto = gameState.is4Player ? (gameState.mortosTaken[teamIdx] !== null) : gameState.mortosTaken[botIdx];
    const canastrasCount = botMelds.filter(m => m.length >= 7).length;
    const requiredCanastras = gameState.requiredCanastras || 1;

    if (hasTakenMorto && canastrasCount >= requiredCanastras) {
      botHand.splice(discardIdx, 1);
      gameState.discardPile.push(cardToDiscard);
      gameState.status = 'finished-visual';
      gameState.winner = botIdx;
      gameState.turnState = 'match-over-visual';
      gameState.lastAction = `¡${botPlayer.name} ha batido la mano!`;
      gameState.cutterIndex = botIdx;
      
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
        gameState.lastAction = `${botPlayer.name} pasa sin descartar por falta de canastas o decisión estratégica.`;
      }
    }
  } else {
    botHand.splice(discardIdx, 1);
    gameState.discardPile.push(cardToDiscard);
    gameState.lastAction = `${botPlayer.name} descartó ${cardToDiscard.rank} de ${cardToDiscard.suit}.`;
    checkMortoIndirect(botIdx);
  }

  // Pasar turno al siguiente jugador (respetando sentido antihorario)
  const nextTurn = gameState.is4Player ? (botIdx + 1) % 4 : (botIdx === 0 ? 1 : 0);
  isBotThinking = false;
  startPlayerTurn(nextTurn);

  sendStateToAll();
}

// HELPER: Conexiones de cartas en la mano para la IA (escaleras y triadas)
function getConnectionsCount(card, hand) {
  if (!card || card.rank === 'Joker' || card.rank === '2') return 0;
  const rankOrderVals = { 'A': 1, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13 };
  const cardVal = rankOrderVals[card.rank] || 0;
  
  let connects = 0;
  hand.forEach(c => {
    if (c.id !== card.id && c.rank !== 'Joker' && c.rank !== '2') {
      // 1. Conexión de escalera (mismo palo, distancia <= 2)
      if (c.suit === card.suit) {
        const otherVal = rankOrderVals[c.rank] || 0;
        if (Math.abs(cardVal - otherVal) <= 2) {
          connects++;
        }
      }
      // 2. Conexión de grupo/triada (mismo número/rango)
      if (c.rank === card.rank) {
        connects += 2; // Gran valor porque forma par o trío para bajar
      }
    }
  });
  return connects;
}

// HELPER: Evalúa el potencial del pozo y conexiones con la mano de la IA
function evaluatePilePotential(pile, hand, tracker) {
  let usefulCards = 0;
  let hasWildcard = false;
  let connectionScore = 0;

  const topCard = pile && pile.length > 0 ? pile[pile.length - 1] : null;

  if (pile && Array.isArray(pile)) {
    for (const c of pile) {
      if (c.rank === 'Joker' || c.rank === '2') {
        hasWildcard = true;
        usefulCards += 2;
        continue;
      }

      const conn = getConnectionsCount(c, hand);
      if (conn > 0) {
        usefulCards++;
        connectionScore += conn;
      }
    }
  }

  const topConn = topCard ? getConnectionsCount(topCard, hand) : 0;
  const topIsWildcard = topCard && (topCard.rank === 'Joker' || topCard.rank === '2');

  return {
    usefulCards,
    hasWildcard,
    connectionScore,
    topConn,
    topIsWildcard
  };
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
    
    const tookMortoDirect = checkMortoDirect(botIdx);
    if (!tookMortoDirect) {
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
