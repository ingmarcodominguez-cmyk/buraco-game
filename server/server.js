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

// ============================================================================
// ARQUITECTURA MULTI-SALA: CLASE Y REGISTRO DE SALAS / MESAS INDEPENDIENTES
// ============================================================================

class BuracoRoom {
  constructor(id) {
    this.id = id; // e.g. "mesa-1", "mesa-2", o código personalizado
    this.players = []; // { socketId, name, isBot }
    this.gameState = null; // Estado de la partida de Buraco en esta mesa
    this.globalScores = [0, 0]; // Puntajes acumulados en esta mesa
    this.requiredCanastrasSetting = 1;
    this.targetScoreSetting = 3000;
    this.isAgainstBotSetting = false;
    this.is4PlayerSetting = false;
    this.cleanupTimeout = null;
    this.isBotThinking = false;
    this.botTurnTimeout = null;
    this.createdAt = Date.now();
  }
}

// Registro global de salas activas
const rooms = new Map();

function getOrCreateRoom(roomId) {
  const cleanId = (roomId || 'mesa-1').trim().toLowerCase();
  if (!rooms.has(cleanId)) {
    rooms.set(cleanId, new BuracoRoom(cleanId));
  }
  return rooms.get(cleanId);
}

function findRoomBySocketId(socketId) {
  for (const room of rooms.values()) {
    if (room.players.some(p => p.socketId === socketId)) {
      return room;
    }
  }
  return null;
}

// Retorna el índice del líder del equipo (0 para Pareja 1, 1 para Pareja 2)
function getTeamOwnerIndex(playerIdx, is4Player) {
  if (!is4Player) return playerIdx;
  return playerIdx === 0 || playerIdx === 2 ? 0 : 1;
}

function startPlayerTurnInRoom(room, playerIdx) {
  if (!room || !room.gameState) return;
  room.gameState.turn = playerIdx;
  room.gameState.turnState = 'draw';
}

function applyUndoInRoom(room, requesterIdx, teamIdx) {
  if (!room || !room.gameState || !room.gameState.turnStartSnapshot) return;
  
  const savedSnapshot = room.gameState.turnStartSnapshot;
  const newTeamUndoCounts = [...room.gameState.teamUndoCounts];
  newTeamUndoCounts[teamIdx]++;
  const lastUndoTeam = teamIdx;
  
  // Restaurar estado de juego completo en la sala
  room.gameState = JSON.parse(JSON.stringify(savedSnapshot));
  room.gameState.teamUndoCounts = newTeamUndoCounts;
  room.gameState.lastUndoTeam = lastUndoTeam;
  room.gameState.undoRequestedBy = null;
  room.gameState.lastAction = `Jugada deshecha por ${room.players[requesterIdx].name} con el permiso del rival.`;
  
  sendStateToRoom(room);
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

function performSorteoInRoom(room, is4Player) {
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
  const cardStrings = room.players.map((p, idx) => {
    return `${p.name} sacó el ${drawnCards[idx].rank} de ${getSuitName(drawnCards[idx].suit)}`;
  });
  actionText += cardStrings.join(', ') + `. Gana ${room.players[w].name} y sale de mano (Sur).`;

  if (is4Player) {
    const seats = new Array(4);
    const team1 = [0, 2];
    const team2 = [1, 3];
    const winnerTeam = team1.includes(w) ? team1 : team2;
    const loserTeam = team1.includes(w) ? team2 : team1;

    seats[0] = room.players[w]; // Sur
    seats[2] = room.players[winnerTeam.find(idx => idx !== w)]; // Norte

    const loserA = loserTeam[0];
    const loserB = loserTeam[1];
    if (values[loserA] > values[loserB]) {
      seats[1] = room.players[loserA];
      seats[3] = room.players[loserB];
    } else {
      seats[1] = room.players[loserB];
      seats[3] = room.players[loserA];
    }

    room.players = [...seats];
    actionText += ` Mesa de juego: Sur: ${room.players[0].name} (inicia), Este: ${room.players[1].name}, Norte: ${room.players[2].name}, Oeste: ${room.players[3].name}.`;
  } else {
    // 2 jugadores
    const seats = new Array(2);
    seats[0] = room.players[w];
    seats[1] = room.players[1 - w];
    room.players = [...seats];
  }

  return actionText;
}

// Envía el estado sanitizado solo a los jugadores de esta sala específica
function sendStateToRoom(room) {
  if (!room || !room.gameState) return;

  room.players.forEach((player, index) => {
    if (player.socketId && player.socketId !== 'bot-socket' && !player.socketId.startsWith('bot-socket-')) {
      const sanitized = getSanitizedStateForRoom(room, index);
      io.to(player.socketId).emit('game-state', {
        gameState: sanitized,
        playerIndex: index,
        lobbyPlayers: room.players.map(p => p.name),
        roomId: room.id
      });
    }
  });

  // Chequear si es el turno del bot en esta sala
  checkAndTriggerBotTurnInRoom(room);
}

function getSanitizedStateForRoom(room, playerIndex) {
  const state = room.gameState;
  if (!state) return null;
  
  const sanitizedPlayers = state.players.map((p, idx) => {
    const teamOwner = getTeamOwnerIndex(idx, state.is4Player);
    const teamMelds = state.players[teamOwner].melds;

    if (idx === playerIndex || state.status === 'finished') {
      return { ...p, melds: teamMelds };
    }

    return {
      ...p,
      hand: new Array(p.hand.length).fill({ id: 'hidden', isHidden: true }),
      devHand: p.isBot ? p.hand : undefined,
      melds: teamMelds
    };
  });

  const drawPileCount = state.drawPile.length;

  return {
    ...state,
    drawPile: new Array(drawPileCount).fill({ id: 'hidden', isHidden: true }),
    mortos: state.mortos.map((m) => {
      if (!m) return null;
      return new Array(m.length).fill({ id: 'hidden', isHidden: true });
    }),
    players: sanitizedPlayers,
    scores: room.globalScores,
    roomId: room.id
  };
}

function checkDirectBatidaInRoom(room, pIdx) {
  const gameState = room.gameState;
  if (!gameState) return false;
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

function checkMortoDirectInRoom(room, playerIdx) {
  const gameState = room.gameState;
  if (!gameState) return false;
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

function checkMortoIndirectInRoom(room, playerIdx) {
  const gameState = room.gameState;
  if (!gameState) return false;
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

function checkAndTriggerBotTurnInRoom(room) {
  if (!room || !room.gameState || room.gameState.status !== 'playing') return;

  // Timeout de seguridad: Si la IA lleva pensando más de 10 segundos, liberar semáforo
  if (room.isBotThinking && room.botThinkingTimestamp && (Date.now() - room.botThinkingTimestamp > 10000)) {
    console.warn(`Reseteando semáforo isBotThinking de IA en sala ${room.id} por timeout de seguridad.`);
    room.isBotThinking = false;
  }

  if (room.isBotThinking) return;

  const botIdx = room.gameState.turn;
  const activePlayer = room.players[botIdx];

  if (activePlayer && activePlayer.isBot) {
    room.isBotThinking = true;
    room.botThinkingTimestamp = Date.now();
    if (room.botTurnTimeout) clearTimeout(room.botTurnTimeout);
    room.botTurnTimeout = setTimeout(() => {
      try {
        runBotTurnInRoom(room, botIdx);
      } catch (err) {
        console.error(`Error en ejecución de IA en sala ${room.id}:`, err);
        room.isBotThinking = false;
        sendStateToRoom(room);
      }
    }, 1500); // Demora simulando pensar
  }
}

function getRoomsSummary() {
  const defaultList = ['mesa-1', 'mesa-2', 'mesa-3', 'mesa-4'];
  const summary = {};
  defaultList.forEach(id => {
    const r = rooms.get(id);
    if (!r) {
      summary[id] = { isOccupied: false, playersCount: 0, players: [] };
    } else {
      const activeHumans = r.players.filter(p => p.socketId && !p.isBot);
      const isGamePlaying = !!(r.gameState && (r.gameState.status === 'playing' || r.gameState.status === 'finished-visual'));
      const isBotBusy = r.isAgainstBotSetting && activeHumans.length >= 1;
      const isFull = activeHumans.length >= (r.is4PlayerSetting ? 4 : 2);
      const isOccupied = activeHumans.length > 0 && (isGamePlaying || isBotBusy || isFull);
      summary[id] = { isOccupied, playersCount: activeHumans.length, players: activeHumans.map(p => p.name) };
    }
  });
  return summary;
}

// ============================================================================
// GESTIÓN DE EVENTOS DE SOCKET CON AISLAMIENTO POR SALA
// ============================================================================

io.on('connection', (socket) => {
  console.log(`Cliente conectado: ${socket.id}`);

  // Enviar información inicial del lobby y estado de salas
  socket.emit('lobby-info', {
    localIp: LOCAL_IP,
    players: [],
    roomId: 'mesa-1'
  });
  socket.emit('rooms-summary', getRoomsSummary());

  // Consultar estado de una sala específica desde el lobby
  socket.on('get-lobby-info', ({ roomId }) => {
    const cleanId = (roomId || 'mesa-1').trim().toLowerCase();
    const room = rooms.get(cleanId);
    const activeHumans = room ? room.players.filter(p => p.socketId && !p.isBot) : [];
    const isGamePlaying = !!(room && room.gameState && (room.gameState.status === 'playing' || room.gameState.status === 'finished-visual'));
    const isBotBusy = room ? (room.isAgainstBotSetting && activeHumans.length >= 1) : false;
    const isFull = room ? (activeHumans.length >= (room.is4PlayerSetting ? 4 : 2)) : false;
    const isOccupied = activeHumans.length > 0 && (isGamePlaying || isBotBusy || isFull);

    socket.emit('lobby-update', {
      roomId: cleanId,
      players: activeHumans.map(p => p.name),
      isOccupied
    });
    socket.emit('rooms-summary', getRoomsSummary());
  });

  // Unirse al lobby de una sala y configurar partida
  socket.on('join-lobby', ({ name, requiredCanastras, isAgainstBot, targetScore, is4Player, roomId }) => {
    const cleanRoomId = (roomId || 'mesa-1').trim().toLowerCase();
    const cleanName = (name || '').trim();
    if (!cleanName) return;

    const room = getOrCreateRoom(cleanRoomId);

    // Humanos activos en esta sala (distintos de este socket)
    const activeHumans = room.players.filter(p => p.socketId && p.socketId !== socket.id && !p.isBot);
    const hasActiveGame = room.gameState && (room.gameState.status === 'playing' || room.gameState.status === 'finished-visual');
    const isPlayerReconnecting = room.players.some(p => p.name.toLowerCase() === cleanName.toLowerCase() && (!p.socketId || p.socketId === socket.id));

    // Si la partida anterior ya finalizó en esta sala y no hay humanos activos, limpiar
    if (room.gameState && room.gameState.status === 'finished' && activeHumans.length === 0) {
      console.log(`La partida anterior en sala ${cleanRoomId} ya finalizó. Limpiando sala.`);
      room.players = [];
      room.gameState = null;
      room.globalScores = [0, 0];
      room.isBotThinking = false;
    }

    // Regla de sala ocupada: Si hay un juego activo y no es el mismo jugador reconectando
    if (hasActiveGame && !isPlayerReconnecting) {
      socket.emit('error-message', `La ${cleanRoomId.toUpperCase()} ya está ocupada con una partida en curso. Por favor selecciona otra mesa disponible (ej. Mesa 2).`);
      socket.emit('rooms-summary', getRoomsSummary());
      return;
    }

    // Si alguien ya está en esa sala jugando contra la IA:
    if (room.isAgainstBotSetting && activeHumans.length >= 1 && !isPlayerReconnecting) {
      socket.emit('error-message', `La ${cleanRoomId.toUpperCase()} ya está ocupada jugando contra la IA. Por favor selecciona otra mesa libre (ej. Mesa 2).`);
      socket.emit('rooms-summary', getRoomsSummary());
      return;
    }

    // Si la mesa de humanos ya completó su cupo máximo de personas activas:
    const maxCapacity = room.is4PlayerSetting ? 4 : 2;
    if (activeHumans.length >= maxCapacity && !isPlayerReconnecting) {
      socket.emit('error-message', `La ${cleanRoomId.toUpperCase()} está llena (${maxCapacity} jugadores activos). Por favor selecciona otra mesa disponible.`);
      socket.emit('rooms-summary', getRoomsSummary());
      return;
    }

    socket.roomId = cleanRoomId;
    socket.join(cleanRoomId);

    // Si no hay otros humanos conectados en esta sala, y cambian la configuración, reiniciar sala
    const otherActiveHumans = room.players.filter(p => p.socketId && p.socketId !== socket.id && !p.isBot);
    if (otherActiveHumans.length === 0) {
      const is4PVal = is4Player !== undefined ? !!is4Player : room.is4PlayerSetting;
      const isBotVal = isAgainstBot !== undefined ? !!isAgainstBot : room.isAgainstBotSetting;
      if (room.is4PlayerSetting !== is4PVal || room.isAgainstBotSetting !== isBotVal) {
        console.log(`Configuración cambiada en sala ${cleanRoomId}. Reiniciando sala.`);
        room.players = [];
        room.gameState = null;
        room.globalScores = [0, 0];
        room.isBotThinking = false;
      }
    }

    // Si hay una limpieza programada en curso para esta sala, cancelarla
    if (room.cleanupTimeout) {
      console.log(`Jugador regresó a sala ${cleanRoomId} (${name}). Cancelando limpieza diferida.`);
      clearTimeout(room.cleanupTimeout);
      room.cleanupTimeout = null;
    }

    if (requiredCanastras) {
      room.requiredCanastrasSetting = requiredCanastras === 2 ? 2 : 1;
    }
    if (targetScore) {
      room.targetScoreSetting = Number(targetScore) || 3000;
    }
    if (is4Player !== undefined) {
      room.is4PlayerSetting = !!is4Player;
    }
    if (isAgainstBot !== undefined) {
      room.isAgainstBotSetting = !!isAgainstBot;
    }

    const maxPlayers = room.is4PlayerSetting ? 4 : 2;

    if (room.isAgainstBotSetting) {
      if (room.is4PlayerSetting) {
        const existingIndex = room.players.findIndex(p => p.name === name);
        if (existingIndex !== -1) {
          room.players[existingIndex].socketId = socket.id;
          console.log(`Humano se reconectó a sala 4P ${cleanRoomId}: ${name}`);
        } else {
          const humanCount = room.players.filter(p => !p.isBot).length;
          if (humanCount < 2) {
            room.players = room.players.filter(p => !p.isBot);
            room.players.push({ socketId: socket.id, name });
            console.log(`Humano ${room.players.length} unido a sala 4P ${cleanRoomId}: ${name}`);
          } else {
            socket.emit('error-message', 'La partida contra la PC en esta sala está llena (ya hay 2 humanos).');
            return;
          }
        }
        
        const activeHumans = room.players.filter(p => !p.isBot);
        if (activeHumans.length === 2) {
          room.players = [
            activeHumans[0],
            activeHumans[1],
            { socketId: 'bot-socket-1', name: 'Compu A (IA)', isBot: true },
            { socketId: 'bot-socket-2', name: 'Compu B (IA)', isBot: true }
          ];
        }
      } else {
        // Modo 2 jugadores con PC
        const isReconnecting = room.gameState && room.players[0] && room.players[0].name === name && room.players[1] && room.players[1].isBot;

        if (isReconnecting) {
          room.players[0].socketId = socket.id;
          console.log(`Jugador se reconectó a su partida contra la PC en sala ${cleanRoomId}: ${name}`);
        } else {
          room.players = [
            { socketId: socket.id, name },
            { socketId: 'bot-socket', name: 'Computadora (IA)', isBot: true }
          ];
          room.gameState = null;
          room.globalScores = [0, 0];
          room.isBotThinking = false;
          console.log(`Partida contra la PC iniciada en sala ${cleanRoomId} para ${name}`);
        }
      }
    } else {
      // Modo multijugador humano completo
      const existingIndex = room.players.findIndex(p => p.socketId === socket.id);
      if (existingIndex !== -1) {
        room.players[existingIndex].name = name;
      } else {
        const sameNameIndex = room.players.findIndex(p => p.name === name);
        if (sameNameIndex !== -1) {
          room.players[sameNameIndex].socketId = socket.id;
          console.log(`Jugador reconectado por nombre en sala ${cleanRoomId}: ${name}`);
        } else {
          const disconnectedIndex = room.players.findIndex(p => !p.socketId && !p.isBot);
          if (disconnectedIndex !== -1) {
            room.players[disconnectedIndex] = { socketId: socket.id, name };
            console.log(`Jugador ocupó slot desconectado en sala ${cleanRoomId}: ${name}`);
          } else if (room.players.length < maxPlayers) {
            room.players.push({ socketId: socket.id, name });
            console.log(`Jugador nuevo unido a sala ${cleanRoomId}: ${name}`);
          } else {
            socket.emit('error-message', `La sala ${cleanRoomId} está llena (ya hay ${maxPlayers} jugadores).`);
            return;
          }
        }
      }
    }

    // Emitir lista de jugadores a la sala
    io.to(cleanRoomId).emit('lobby-update', { roomId: cleanRoomId, players: room.players.map(p => p.name) });

    // Iniciar juego si se completaron los cupos
    const activeHumansCount = room.players.filter(p => !p.isBot).length;
    const requiredHumans = (room.isAgainstBotSetting && room.is4PlayerSetting) ? 2 : (room.isAgainstBotSetting ? 1 : maxPlayers);
    const allSocketsReady = room.players.filter(p => !p.isBot).every(p => p.socketId);

    if (room.players.length === maxPlayers && activeHumansCount === requiredHumans && allSocketsReady) {
      if (!room.gameState) {
        room.gameState = initGame(room.is4PlayerSetting);
        const sorteoActionText = performSorteoInRoom(room, room.is4PlayerSetting);
        
        room.gameState.starterIndex = 0;
        room.gameState.turn = 0;

        for (let i = 0; i < maxPlayers; i++) {
          room.gameState.players[i].name = room.players[i].name;
          if (room.players[i].isBot) {
            room.gameState.players[i].isBot = true;
          }
        }

        room.gameState.requiredCanastras = room.requiredCanastrasSetting;
        room.gameState.targetScore = room.targetScoreSetting;
        room.globalScores = [0, 0];
        room.gameState.scores = room.globalScores;
        room.gameState.lastAction = `¡Comienza el juego en ${cleanRoomId.toUpperCase()}! ${sorteoActionText}`;

        const { turnStartSnapshot, ...snapshotData } = room.gameState;
        room.gameState.turnStartSnapshot = JSON.parse(JSON.stringify(snapshotData));
      } else {
        for (let i = 0; i < maxPlayers; i++) {
          if (room.players[i]) {
            room.gameState.players[i].name = room.players[i].name;
          }
        }
      }
      sendStateToRoom(room);
      io.emit('rooms-summary', getRoomsSummary());
    } else {
      io.to(cleanRoomId).emit('lobby-update', { roomId: cleanRoomId, players: room.players.map(p => p.name) });
      io.emit('rooms-summary', getRoomsSummary());
    }
  });

  // Robar carta del mazo
  socket.on('draw-card', () => {
    const room = findRoomBySocketId(socket.id);
    if (!room || !room.gameState || room.gameState.status !== 'playing') return;
    const pIdx = room.players.findIndex(p => p.socketId === socket.id);
    if (pIdx === -1) return;
    const gameState = room.gameState;

    if (gameState.turn !== pIdx) {
      socket.emit('error-message', 'No es tu turno.');
      return;
    }

    if (gameState.turnState !== 'draw') {
      socket.emit('error-message', 'Ya robaste carta en este turno.');
      return;
    }

    if (gameState.drawPile.length === 0) {
      gameState.status = 'finished';
      gameState.turnState = 'confirm-scores';
      gameState.lastAction = 'El mazo de robo se ha agotado. Fin de la ronda. Esperando confirmación de puntos.';
      gameState.roundScores = calculateRoundScores(gameState);
      sendStateToRoom(room);
      return;
    }

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
    
    sendStateToRoom(room);
  });

  // Robar todo el pozo de descarte
  socket.on('draw-discard', () => {
    const room = findRoomBySocketId(socket.id);
    if (!room || !room.gameState || room.gameState.status !== 'playing') return;
    const pIdx = room.players.findIndex(p => p.socketId === socket.id);
    if (pIdx === -1) return;
    const gameState = room.gameState;

    if (gameState.turn !== pIdx) {
      socket.emit('error-message', 'No es tu turno.');
      return;
    }

    if (gameState.turnState !== 'draw') {
      socket.emit('error-message', 'Ya robaste carta en este turno.');
      return;
    }

    const teamIdx = getTeamOwnerIndex(pIdx, gameState.is4Player);
    
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

    if (gameState.players[pIdx] && !gameState.players[pIdx].isBot) {
      const { turnStartSnapshot, ...snapshotData } = gameState;
      gameState.turnStartSnapshot = JSON.parse(JSON.stringify(snapshotData));
    }

    const count = gameState.discardPile.length;
    gameState.players[pIdx].hand.push(...gameState.discardPile);
    gameState.discardPile = [];
    
    gameState.turnState = 'play';
    gameState.lastAction = `${gameState.players[pIdx].name} recogió el pozo entero (${count} cartas).`;
    
    if (gameState.isFirstTurn) {
      gameState.isFirstTurn = false;
      gameState.firstDrawnCardId = null;
    }
    
    sendStateToRoom(room);
  });

  // Bajar un juego nuevo (secuencia o grupo)
  socket.on('meld-sequence', ({ cards }) => {
    const room = findRoomBySocketId(socket.id);
    if (!room || !room.gameState || room.gameState.status !== 'playing') return;
    const pIdx = room.players.findIndex(p => p.socketId === socket.id);
    if (pIdx === -1) return;
    const gameState = room.gameState;

    if (gameState.turn !== pIdx) {
      socket.emit('error-message', 'No es tu turno.');
      return;
    }

    if (gameState.turnState !== 'play') {
      socket.emit('error-message', 'Debes robar una carta antes de bajar juegos.');
      return;
    }

    const player = gameState.players[pIdx];
    const hand = player.hand;
    const hasAllCards = cards.every(cardToFind => 
      hand.some(handCard => handCard.id === cardToFind.id)
    );

    if (!hasAllCards) {
      socket.emit('error-message', 'No tienes esas cartas en tu mano.');
      return;
    }

    const result = validateMeld(cards);
    if (!result.valid) {
      socket.emit('error-message', `Juego inválido: ${result.error}`);
      return;
    }

    const teamIdx = getTeamOwnerIndex(pIdx, gameState.is4Player);
    const teamMelds = gameState.players[teamIdx].melds;

    let totalPointsInMesa = 0;
    teamMelds.forEach(meld => {
      meld.forEach(c => {
        totalPointsInMesa += CARD_VALUES[c.rank] || 0;
      });
    });

    const isAlreadyMelded = totalPointsInMesa >= 30;

    let newCardsPoints = 0;
    cards.forEach(c => {
      newCardsPoints += CARD_VALUES[c.rank] || 0;
    });

    if (!isAlreadyMelded && newCardsPoints < 30) {
      socket.emit('error-message', `Para bajar por primera vez, el juego debe sumar al menos 30 puntos (suma actual: ${newCardsPoints} pts).`);
      return;
    }

    const hasTakenMorto = gameState.is4Player ? (gameState.mortosTaken[teamIdx] !== null) : gameState.mortosTaken[pIdx];
    const existingCanastras = teamMelds.filter(m => m.length >= 7).length;
    const newCanastraCreated = result.cards.length >= 7 ? 1 : 0;
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

    cards.forEach(cardToRem => {
      const idx = hand.findIndex(hc => hc.id === cardToRem.id);
      if (idx !== -1) hand.splice(idx, 1);
    });

    gameState.players[teamIdx].melds.push(result.cards);
    gameState.lastAction = `${player.name} bajó juego: ${result.clean ? 'Limpio' : 'Sucio'} (${cards.length} cartas).`;

    const tookMortoDirect = checkMortoDirectInRoom(room, pIdx);
    if (!tookMortoDirect) {
      checkDirectBatidaInRoom(room, pIdx);
    }

    sendStateToRoom(room);
  });

  // Acoplar cartas a juego existente
  socket.on('append-to-meld', ({ meldIndex, cards }) => {
    const room = findRoomBySocketId(socket.id);
    if (!room || !room.gameState || room.gameState.status !== 'playing') return;
    const pIdx = room.players.findIndex(p => p.socketId === socket.id);
    if (pIdx === -1) return;
    const gameState = room.gameState;

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

    const hand = player.hand;
    const hasAllCards = cards.every(cardToFind => 
      hand.some(handCard => handCard.id === cardToFind.id)
    );

    if (!hasAllCards) {
      socket.emit('error-message', 'No tienes esas cartas en tu mano.');
      return;
    }

    const currentMeld = teamPlayer.melds[meldIndex];
    if (!currentMeld) return;
    const combined = [...currentMeld, ...cards];

    const result = validateMeld(combined);
    if (!result.valid) {
      socket.emit('error-message', `Movimiento inválido: ${result.error}`);
      return;
    }

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

    cards.forEach(cardToRem => {
      const idx = hand.findIndex(hc => hc.id === cardToRem.id);
      if (idx !== -1) hand.splice(idx, 1);
    });

    teamPlayer.melds[meldIndex] = result.cards;
    gameState.lastAction = `${player.name} acopló cartas a su juego.`;

    const tookMortoDirect = checkMortoDirectInRoom(room, pIdx);
    if (!tookMortoDirect) {
      checkDirectBatidaInRoom(room, pIdx);
    }

    sendStateToRoom(room);
  });

  // Descartar carta y terminar turno
  socket.on('discard-card', ({ card }) => {
    const room = findRoomBySocketId(socket.id);
    if (!room || !room.gameState || room.gameState.status !== 'playing') return;
    const pIdx = room.players.findIndex(p => p.socketId === socket.id);
    if (pIdx === -1) return;
    const gameState = room.gameState;

    if (gameState.turn !== pIdx) {
      socket.emit('error-message', 'No es tu turno.');
      return;
    }

    if (gameState.turnState !== 'play') {
      socket.emit('error-message', 'Debes robar una carta antes de descartar.');
      return;
    }

    const player = gameState.players[pIdx];
    const hand = player.hand;
    const cardIdx = hand.findIndex(c => c.id === card.id);
    if (cardIdx === -1) {
      socket.emit('error-message', 'No tienes esa carta en tu mano.');
      return;
    }

    const teamIdx = getTeamOwnerIndex(pIdx, gameState.is4Player);
    const hasTakenMorto = gameState.is4Player ? (gameState.mortosTaken[teamIdx] !== null) : gameState.mortosTaken[pIdx];
    const teamMelds = gameState.players[teamIdx].melds;
    const canastrasCount = teamMelds.filter(m => m.length >= 7).length;
    const requiredCanastras = gameState.requiredCanastras || 1;

    // Batida final (cierre con descarte)
    if (hand.length === 1 && hasTakenMorto) {
      if (canastrasCount < requiredCanastras) {
        socket.emit('error-message', `No puedes cerrar la partida sin tener al menos ${requiredCanastras} canasta(s) hechas.`);
        return;
      }
      
      const discarded = hand.splice(cardIdx, 1)[0];
      gameState.discardPile.push(discarded);
      gameState.status = 'finished-visual';
      gameState.winner = pIdx;
      gameState.turnState = 'match-over-visual';
      gameState.lastAction = `¡${player.name} ha batido la mano!`;
      gameState.cutterIndex = pIdx;
      
      gameState.roundScores = calculateRoundScores(gameState);
      sendStateToRoom(room);
      return;
    }

    const discarded = hand.splice(cardIdx, 1)[0];
    gameState.discardPile.push(discarded);
    gameState.lastAction = `${player.name} descartó ${discarded.rank} de ${discarded.suit}.`;

    if (gameState.isFirstTurn) {
      gameState.isFirstTurn = false;
      gameState.firstDrawnCardId = null;
    }

    checkMortoIndirectInRoom(room, pIdx);

    const maxPlayers = gameState.is4Player ? 4 : 2;
    const nextTurn = (gameState.turn + 1) % maxPlayers;
    startPlayerTurnInRoom(room, nextTurn);
    
    sendStateToRoom(room);
  });

  socket.on('show-scores-sheet', () => {
    const room = findRoomBySocketId(socket.id);
    if (!room || !room.gameState || room.gameState.status !== 'finished-visual') return;
    room.gameState.status = 'finished';
    room.gameState.turnState = 'confirm-scores';
    sendStateToRoom(room);
  });

  socket.on('hide-scores-sheet', () => {
    const room = findRoomBySocketId(socket.id);
    if (!room || !room.gameState || room.gameState.status !== 'finished') return;
    if (room.gameState.turnState === 'match-over') return;
    room.gameState.status = 'finished-visual';
    room.gameState.turnState = 'match-over-visual';
    sendStateToRoom(room);
  });

  socket.on('keep-first-card', () => {
    const room = findRoomBySocketId(socket.id);
    if (!room || !room.gameState || !room.gameState.isFirstTurn) return;
    const pIdx = room.players.findIndex(p => p.socketId === socket.id);
    if (pIdx === -1 || room.gameState.turn !== pIdx) return;
    
    room.gameState.isFirstTurn = false;
    room.gameState.firstDrawnCardId = null;
    room.gameState.lastAction = `${room.gameState.players[pIdx].name} conservó la primera carta del mazo.`;
    sendStateToRoom(room);
  });

  socket.on('reject-first-card', () => {
    const room = findRoomBySocketId(socket.id);
    if (!room || !room.gameState || !room.gameState.isFirstTurn) return;
    const pIdx = room.players.findIndex(p => p.socketId === socket.id);
    if (pIdx === -1 || room.gameState.turn !== pIdx) return;
    const gameState = room.gameState;

    const hand = gameState.players[pIdx].hand;
    const cardIdx = hand.findIndex(c => c.id === gameState.firstDrawnCardId);
    if (cardIdx !== -1) {
      const rejected = hand.splice(cardIdx, 1)[0];
      gameState.discardPile.push(rejected);
    }
    
    if (gameState.drawPile.length > 0) {
      const newCard = gameState.drawPile.pop();
      hand.push(newCard);
    }
    
    gameState.isFirstTurn = false;
    gameState.firstDrawnCardId = null;
    gameState.lastAction = `${gameState.players[pIdx].name} descartó la primera carta al pozo y robó otra del mazo.`;
    sendStateToRoom(room);
  });

  socket.on('restart-round', () => {
    const room = findRoomBySocketId(socket.id);
    if (!room || !room.gameState) return;
    
    room.isBotThinking = false;
    if (room.botTurnTimeout) clearTimeout(room.botTurnTimeout);
    const currentRequiredCanastras = room.gameState.requiredCanastras || 1;
    const currentTargetScore = room.gameState.targetScore || 3000;
    const previousStarter = room.gameState.starterIndex !== undefined ? room.gameState.starterIndex : 0;
    const maxPlayers = room.is4PlayerSetting ? 4 : 2;
    const nextStarter = (previousStarter + 1) % maxPlayers;

    const newGame = initGame(room.is4PlayerSetting);
    newGame.starterIndex = nextStarter;
    newGame.turn = nextStarter;
    for (let i = 0; i < maxPlayers; i++) {
      newGame.players[i].name = room.players[i].name;
      if (room.players[i] && room.players[i].isBot) {
        newGame.players[i].isBot = true;
      }
    }
    newGame.requiredCanastras = currentRequiredCanastras;
    newGame.targetScore = currentTargetScore;
    newGame.scores = room.globalScores;
    newGame.roundHistory = room.gameState.roundHistory || [];
    newGame.lastAction = `Ronda reiniciada. Inicia mano ${newGame.players[nextStarter].name}.`;

    room.gameState = newGame;
    startPlayerTurnInRoom(room, nextStarter);
    sendStateToRoom(room);
  });

  socket.on('reset-game', () => {
    const room = findRoomBySocketId(socket.id);
    if (!room) return;
    room.globalScores = [0, 0];
    room.isBotThinking = false;
    if (room.botTurnTimeout) clearTimeout(room.botTurnTimeout);
    const currentRequiredCanastras = room.gameState ? room.gameState.requiredCanastras : room.requiredCanastrasSetting;
    const currentTargetScore = room.gameState ? room.gameState.targetScore : room.targetScoreSetting;
    const maxPlayers = room.is4PlayerSetting ? 4 : 2;
    
    room.gameState = initGame(room.is4PlayerSetting);
    const sorteoActionText = performSorteoInRoom(room, room.is4PlayerSetting);
    room.gameState.starterIndex = 0;
    room.gameState.turn = 0;

    for (let i = 0; i < maxPlayers; i++) {
      room.gameState.players[i].name = room.players[i].name;
      if (room.players[i].isBot) {
        room.gameState.players[i].isBot = true;
      }
    }
    room.gameState.requiredCanastras = currentRequiredCanastras;
    room.gameState.targetScore = currentTargetScore;
    room.gameState.scores = room.globalScores;
    room.gameState.lastAction = `¡Partida reiniciada desde cero! ${sorteoActionText}`;
    
    sendStateToRoom(room);
  });

  socket.on('change-target-score', ({ newTargetScore }) => {
    const room = findRoomBySocketId(socket.id);
    if (!room || !room.gameState) return;
    const scoreVal = parseInt(newTargetScore, 10);
    if ([2000, 3000, 5000].includes(scoreVal)) {
      room.gameState.targetScore = scoreVal;
      room.targetScoreSetting = scoreVal;
      room.gameState.lastAction = `Puntos para ganar ajustados a ${scoreVal} pts.`;
      sendStateToRoom(room);
    }
  });

  socket.on('request-undo', () => {
    const room = findRoomBySocketId(socket.id);
    if (!room || !room.gameState || room.gameState.status !== 'playing') return;
    const pIdx = room.players.findIndex(p => p.socketId === socket.id);
    if (pIdx === -1) return;
    const gameState = room.gameState;

    if (gameState.turn !== pIdx) {
      socket.emit('error-message', 'Solo puedes deshacer jugadas en tu propio turno.');
      return;
    }

    const teamIdx = getTeamOwnerIndex(pIdx, gameState.is4Player);
    const opponentTeamIdx = teamIdx === 0 ? 1 : 0;
    const maxUndos = gameState.is4Player ? 3 : 2;

    if (gameState.teamUndoCounts[teamIdx] >= maxUndos) {
      socket.emit('error-message', `Tu equipo ya ha utilizado el máximo de ${maxUndos} deshechos permitidos en esta partida.`);
      return;
    }

    if (!gameState.turnStartSnapshot) {
      socket.emit('error-message', 'No hay jugadas pendientes de confirmación en este turno para deshacer.');
      return;
    }

    gameState.undoRequestedBy = pIdx;
    
    const opponentIndices = gameState.is4Player ? [opponentTeamIdx, opponentTeamIdx + 2] : [opponentTeamIdx];
    const opponentHumans = opponentIndices.map(idx => room.players[idx]).filter(p => p && !p.isBot && p.socketId);
    
    if (opponentHumans.length === 0) {
      applyUndoInRoom(room, pIdx, teamIdx);
      return;
    }

    opponentHumans.forEach(opp => {
      io.to(opp.socketId).emit('undo-requested', {
        requesterName: room.players[pIdx].name,
        requesterIdx: pIdx
      });
    });

    socket.emit('undo-waiting', { message: 'Esperando aprobación del rival para deshacer tu jugada...' });
  });

  socket.on('respond-undo', ({ accept }) => {
    const room = findRoomBySocketId(socket.id);
    if (!room || !room.gameState || room.gameState.status !== 'playing') return;
    const pIdx = room.players.findIndex(p => p.socketId === socket.id);
    if (pIdx === -1) return;
    const gameState = room.gameState;

    if (gameState.undoRequestedBy === null) return;

    const requesterIdx = gameState.undoRequestedBy;
    const requesterPlayer = room.players[requesterIdx];
    const responderPlayer = room.players[pIdx];
    const teamIdx = getTeamOwnerIndex(requesterIdx, gameState.is4Player);

    if (accept) {
      applyUndoInRoom(room, requesterIdx, teamIdx);
    } else {
      gameState.undoRequestedBy = null;
      gameState.lastAction = `${responderPlayer.name} rechazó la solicitud de deshacer de ${requesterPlayer.name}.`;
      if (requesterPlayer && requesterPlayer.socketId) {
        io.to(requesterPlayer.socketId).emit('error-message', `${responderPlayer.name} no aceptó deshacer tu jugada.`);
      }
      sendStateToRoom(room);
    }
  });

  socket.on('debug-simulate-batida', (payload) => {
    const pass = typeof payload === 'string' ? payload : payload?.pass;
    if (pass !== 'lom@lind@') {
      socket.emit('error-message', 'Acceso denegado: se requiere clave de desarrollador.');
      return;
    }
    const room = findRoomBySocketId(socket.id);
    if (!room || !room.gameState || room.gameState.status !== 'playing') return;
    const gameState = room.gameState;

    const cutter = gameState.turn;
    const teamIdx = getTeamOwnerIndex(cutter, gameState.is4Player);
    
    if (gameState.is4Player) {
      gameState.mortosTaken[teamIdx] = cutter;
    } else {
      gameState.mortosTaken[cutter] = true;
    }

    gameState.status = 'finished-visual';
    gameState.winner = cutter;
    gameState.cutterIndex = cutter;
    gameState.turnState = 'match-over-visual';
    gameState.lastAction = `⚡ Simulación de Desarrollador: ¡${gameState.players[cutter].name} bate la ronda!`;
    gameState.roundScores = calculateRoundScores(gameState);
    
    sendStateToRoom(room);
  });

  socket.on('leave-game', () => {
    const room = findRoomBySocketId(socket.id);
    if (!room) return;
    const pIndex = room.players.findIndex(p => p.socketId === socket.id);
    if (pIndex !== -1) {
      const leavingPlayerName = room.players[pIndex].name;
      console.log(`Jugador abandonó sala ${room.id}: ${leavingPlayerName}`);
      room.players = [];
      room.gameState = null;
      room.globalScores = [0, 0];
      room.isBotThinking = false;
      if (room.botTurnTimeout) clearTimeout(room.botTurnTimeout);
      io.to(room.id).emit('game-aborted', `${leavingPlayerName} ha abandonado la partida. Se canceló la mesa.`);
      socket.leave(room.id);
      io.emit('rooms-summary', getRoomsSummary());
    }
  });

  socket.on('disconnect', () => {
    const room = findRoomBySocketId(socket.id);
    if (!room) return;
    const index = room.players.findIndex(p => p.socketId === socket.id);
    if (index !== -1) {
      console.log(`Jugador desconectado de sala ${room.id}: ${room.players[index].name}`);
      room.players[index].socketId = null;
    }

    const activeHumans = room.players.filter(p => p.socketId && !p.socketId.startsWith('bot-socket') && !p.isBot);
    if (activeHumans.length === 0) {
      console.log(`Sala ${room.id} vacía de humanos. Programando limpieza diferida en 20 segundos.`);
      if (room.cleanupTimeout) clearTimeout(room.cleanupTimeout);
      room.cleanupTimeout = setTimeout(() => {
        const stillNoHumans = room.players.filter(p => p.socketId && !p.socketId.startsWith('bot-socket') && !p.isBot).length === 0;
        if (stillNoHumans) {
          console.log(`Limpiando sala ${room.id} por inactividad prolongada.`);
          if (room.botTurnTimeout) clearTimeout(room.botTurnTimeout);
          rooms.delete(room.id);
          io.emit('rooms-summary', getRoomsSummary());
        }
        room.cleanupTimeout = null;
      }, 20000);
    }
    io.emit('rooms-summary', getRoomsSummary());
  });

  socket.on('confirm-round-scores', ({ roundBreakdown }) => {
    try {
      const room = findRoomBySocketId(socket.id);
      if (!room || !room.gameState || room.gameState.status !== 'finished') return;
      const gameState = room.gameState;

      const roundPointsTeam0 = Number(
        roundBreakdown?.p0?.roundTotal ?? 
        roundBreakdown?.team0?.totalRound ?? 
        roundBreakdown?.team0?.roundTotal ?? 
        0
      );
      const roundPointsTeam1 = Number(
        roundBreakdown?.p1?.roundTotal ?? 
        roundBreakdown?.team1?.totalRound ?? 
        roundBreakdown?.team1?.roundTotal ?? 
        0
      );

      room.globalScores[0] += roundPointsTeam0;
      room.globalScores[1] += roundPointsTeam1;

      const currentHistory = gameState.roundHistory || [];
      currentHistory.push({
        roundNumber: currentHistory.length + 1,
        breakdown: roundBreakdown,
        accumulatedScores: [...room.globalScores]
      });

      const currentTargetScore = gameState.targetScore || room.targetScoreSetting || 3000;
      const isMatchOver = room.globalScores[0] >= currentTargetScore || room.globalScores[1] >= currentTargetScore;
      if (isMatchOver) {
        gameState.status = 'finished';
        gameState.turnState = 'match-over';
        gameState.scores = [...room.globalScores];
        gameState.roundHistory = currentHistory;
        sendStateToRoom(room);
        return;
      }

      const currentRequiredCanastras = gameState.requiredCanastras || room.requiredCanastrasSetting || 1;
      const previousStarter = gameState.starterIndex !== undefined ? gameState.starterIndex : 0;
      const maxPlayers = room.is4PlayerSetting ? 4 : 2;
      const nextStarter = (previousStarter + 1) % maxPlayers;

      const newGame = initGame(room.is4PlayerSetting);
      newGame.starterIndex = nextStarter;
      newGame.turn = nextStarter;
      for (let i = 0; i < maxPlayers; i++) {
        newGame.players[i].name = room.players[i].name;
        if (room.players[i] && room.players[i].isBot) {
          newGame.players[i].isBot = true;
        }
      }
      newGame.requiredCanastras = currentRequiredCanastras;
      newGame.targetScore = currentTargetScore;
      newGame.roundHistory = currentHistory;
      newGame.scores = [...room.globalScores];
      newGame.lastAction = `Comienza nueva ronda. Sale de mano ${newGame.players[nextStarter].name}.`;

      room.gameState = newGame;
      room.isBotThinking = false;
      if (room.botTurnTimeout) clearTimeout(room.botTurnTimeout);
      startPlayerTurnInRoom(room, nextStarter);
      sendStateToRoom(room);
    } catch (err) {
      console.error('Error en confirm-round-scores:', err);
    }
  });
});

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



function runBotTurnInRoom(room, botIdx) {
  if (!room || !room.gameState || room.gameState.status !== 'playing') {
    if (room) room.isBotThinking = false;
    return;
  }

  const gameState = room.gameState;
  const players = room.players;
  const sendStateToAll = () => sendStateToRoom(room);
  const startPlayerTurn = (nextTurn) => startPlayerTurnInRoom(room, nextTurn);
  const checkMortoDirect = (bIdx) => checkMortoDirectInRoom(room, bIdx);
  const checkMortoIndirect = (bIdx) => checkMortoIndirectInRoom(room, bIdx);
  const checkDirectBatida = (bIdx) => checkDirectBatidaInRoom(room, bIdx);
  const performOneBotMeldAction = (bIdx) => performOneBotMeldActionInRoom(room, bIdx);
  const runBotDiscardPhase = (bIdx) => runBotDiscardPhaseInRoom(room, bIdx);

  if (!gameState || gameState.status !== 'playing') {
    room.isBotThinking = false;
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
      room.isBotThinking = false;
      sendStateToAll();
      return;
    }
  }

  sendStateToAll();

  // Esperar 1.5s antes de Bajar / Acoplar
  setTimeout(() => {
    if (!gameState || gameState.status !== 'playing') {
      room.isBotThinking = false;
      return;
    }

    function executeBotMeldStep() {
      if (!gameState || gameState.status !== 'playing') {
        room.isBotThinking = false;
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

// HELPER: Comprueba si un comodín (2 o Joker) puede formar un juego nuevo (trío o escalera) con cartas de la mano
function canWildcardFormNewMeldInHand(wildcard, hand) {
  if (!wildcard || (wildcard.rank !== '2' && wildcard.rank !== 'Joker')) return false;

  // 1. ¿Puede formar un nuevo grupo (trío de mismo número)?
  const rankGroups = {};
  hand.forEach(c => {
    if (c.id !== wildcard.id && c.rank !== '2' && c.rank !== 'Joker') {
      if (!rankGroups[c.rank]) rankGroups[c.rank] = [];
      rankGroups[c.rank].push(c);
    }
  });

  for (const rank of Object.keys(rankGroups)) {
    if (rankGroups[rank].length >= 2) {
      const candidate = [rankGroups[rank][0], rankGroups[rank][1], wildcard];
      if (validateMeld(candidate).valid) {
        return true;
      }
    }
  }

  // 2. ¿Puede formar una nueva escalera (secuencia del mismo palo)?
  const rankOrderVals = { 'A': 1, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13 };
  const suits = ['H', 'D', 'C', 'S'];
  for (let s of suits) {
    let suitCards = hand.filter(c => c.id !== wildcard.id && c.suit === s && c.rank !== '2' && c.rank !== 'Joker');
    suitCards.sort((a, b) => (rankOrderVals[a.rank] || 0) - (rankOrderVals[b.rank] || 0));
    for (let i = 0; i < suitCards.length - 1; i++) {
      const c1 = suitCards[i];
      const c2 = suitCards[i+1];
      const v1 = rankOrderVals[c1.rank];
      const v2 = rankOrderVals[c2.rank];
      if (v2 === v1 + 1 || v2 === v1 + 2) {
        const candidate = [c1, c2, wildcard];
        if (validateMeld(candidate).valid) {
          return true;
        }
      }
    }
  }

  return false;
}

// HELPER: Comprueba si una carta natural (no comodín) puede formar un juego nuevo independiente (secuencia de 3+ o trío) con cartas de la mano
function canNaturalCardFormIndependentMeldInHand(card, hand) {
  if (!card || card.rank === '2' || card.rank === 'Joker') return false;

  const rankOrderVals = { 'A': 1, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13 };
  const cardVal = rankOrderVals[card.rank];
  if (!cardVal) return false;

  // 1. ¿Puede formar una secuencia limpia de 3+ cartas de su mismo palo en mano?
  const sameSuitCards = hand.filter(c => c.suit === card.suit && c.rank !== '2' && c.rank !== 'Joker');
  const distinctVals = Array.from(new Set(sameSuitCards.map(c => rankOrderVals[c.rank]))).sort((a, b) => a - b);
  
  for (let i = 0; i < distinctVals.length; i++) {
    let runLength = 1;
    let containsCard = (distinctVals[i] === cardVal);
    for (let j = i + 1; j < distinctVals.length; j++) {
      if (distinctVals[j] === distinctVals[j - 1] + 1) {
        runLength++;
        if (distinctVals[j] === cardVal) containsCard = true;
      } else {
        break;
      }
    }
    if (runLength >= 3 && containsCard) {
      return true;
    }
  }

  // 2. ¿Puede formar una secuencia sucia de 3 cartas usando un comodín de la mano?
  const wildcards = hand.filter(c => c.rank === '2' || c.rank === 'Joker');
  if (wildcards.length > 0) {
    for (let other of sameSuitCards) {
      if (other.id === card.id) continue;
      const otherVal = rankOrderVals[other.rank];
      const diff = Math.abs(otherVal - cardVal);
      if (diff === 1 || diff === 2) {
        const candidate = [card, other, wildcards[0]];
        if (validateMeld(candidate).valid) {
          return true;
        }
      }
    }
  }

  // 3. ¿Puede formar un grupo (trío de mismo rank) en mano?
  const sameRankCards = hand.filter(c => c.rank === card.rank && c.rank !== '2' && c.rank !== 'Joker');
  if (sameRankCards.length >= 3) return true;
  if (sameRankCards.length === 2 && wildcards.length > 0) return true;

  return false;
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
        const isWildcard = card.rank === '2' || card.rank === 'Joker';
        if (isWildcard) {
          if (isCurrentCleanCanastra) continue;
          if (currentMeld.some(c => c && c.isUsedAsWildcard)) {
            const runSuit = currentMeld.find(rc => rc.rank !== 'Joker' && rc.rank !== '2')?.suit;
            const hasSuitTwo = currentMeld.some(c => c && c.rank === '2' && c.suit === runSuit);
            if (!hasSuitTwo) continue;
          }

          // Si el comodín puede unirse a cartas en mano para formar un juego nuevo (trío o escalera),
          // no consumirlo en un acople simple de 1 carta
          if (canWildcardFormNewMeldInHand(card, tempHand)) {
            continue;
          }
        } else if (currentMeld.length >= 7) {
          // Si el juego en mesa ya es canasta, no acoplar cartas que puedan formar un nuevo juego independiente
          if (canNaturalCardFormIndependentMeldInHand(card, tempHand)) {
            continue;
          }
        }

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
          if (run.length >= 10) {
            const canastaPart = run.slice(run.length - 7);
            const remainderPart = run.slice(0, run.length - 7);
            const resC = validateMeld(canastaPart);
            const resR = validateMeld(remainderPart);
            if (resC.valid && resR.valid) {
              tempMelds.push(resC.cards);
              tempMelds.push(resR.cards);
              cardsPlayed += run.length;
              run.forEach(rc => {
                const idx = tempHand.findIndex(c => c.id === rc.id);
                if (idx !== -1) tempHand.splice(idx, 1);
              });
            }
          } else if (run.length >= 3) {
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
    if (run.length >= 10) {
      const canastaPart = run.slice(run.length - 7);
      const remainderPart = run.slice(0, run.length - 7);
      const resC = validateMeld(canastaPart);
      const resR = validateMeld(remainderPart);
      if (resC.valid && resR.valid) {
        tempMelds.push(resC.cards);
        tempMelds.push(resR.cards);
        cardsPlayed += run.length;
        run.forEach(rc => {
          const idx = tempHand.findIndex(c => c.id === rc.id);
          if (idx !== -1) tempHand.splice(idx, 1);
        });
      }
    } else if (run.length >= 3) {
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



function performOneBotMeldActionInRoom(room, botIdx) {
  const gameState = room.gameState;
  const players = room.players;
  const checkMortoDirect = (bIdx) => checkMortoDirectInRoom(room, bIdx);
  const checkDirectBatida = (bIdx) => checkDirectBatidaInRoom(room, bIdx);
  const tryMeldBotRun = (cToMeld, bIdx, hMelded) => tryMeldBotRunInRoom(room, cToMeld, bIdx, hMelded);

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
      // Priorizar los monos: si se pueden acomodar en mesa, debe hacerlo.
      // Solo evitar:
      // 1. Ensuciar una canasta que ya es limpia (7+ cartas naturales)
      // 2. Poner más de un comodín en el mismo juego (regla de máximo 1 comodín)
      // 3. PRIORIDAD TÁCTICA: Si el comodín puede unirse a dos cartas de la mano para BAJAR UN NUEVO JUEGO (trío o escalera),
      //    NO malgastarlo en un acople simple de 1 carta. Bajar el nuevo juego descarga 3 cartas a la vez de la mano
      //    (acercando al muerto o al cierre) y rescata parejas huérfanas en mano (ej. dos 3 con el 2).
      if (isWildcard) {
        if (isCurrentCleanCanastra) continue;
        if (currentMeld.some(c => c && c.isUsedAsWildcard)) {
          const runSuit = currentMeld.find(rc => rc.rank !== 'Joker' && rc.rank !== '2')?.suit;
          const hasSuitTwo = currentMeld.some(c => c && c.rank === '2' && c.suit === runSuit);
          if (!hasSuitTwo) continue;
        }

        // PRIORIDAD TÁCTICA DE COMODINES:
        // Si el comodín puede formar un nuevo juego (trío o escalera) con 2 cartas de la mano:
        // 1. Si la IA aún no tomó el muerto (!botHasMorto): ¡SIEMPRE RESERVARLO!
        //    Bajar el trío/escalera elimina 3 cartas de la mano de golpe. Si le quedan 3 cartas (ej. dos 10 y un 2),
        //    ¡Baja las 3 y toma el MUERTO DIRECTO inmediatamente, continuando su turno!
        //    Acoplar el comodín para hacer una canasta sucia dejando cartas en mano es un error grave:
        //    sin muerto no se puede ganar la partida.
        // 2. Si ya tiene el muerto (botHasMorto):
        //    Solo acoplar si completa canasta de 7 y no puede batir bajando el nuevo juego.
        const canFormNewMeld = canWildcardFormNewMeldInHand(card, botHand);
        if (canFormNewMeld) {
          if (!botHasMorto) {
            continue; // Prioridad suprema: ir al muerto con las cartas de la mano
          }

          const canBatWithNewMeld = botHand.length <= 4 && (canastrasCount >= requiredCanastras);
          if (canBatWithNewMeld) {
            continue; // Prioridad suprema: batir y ganar la mano
          }

          const canCompleteCanastraNow = currentMeld.length === 6;
          const canWinWithAcople = botHand.length === 1 && (canastrasCount >= requiredCanastras || canCompleteCanastraNow);
          if (!canCompleteCanastraNow && !canWinWithAcople) {
            continue;
          }
        }
      } else if (currentMeld.length >= 7) {
        // TÁCTICA CANASTA COMPLETA:
        // Si el juego en mesa ya es canasta (7 o más cartas) y la IA no está cerrando la partida o yendo al muerto inmediatamente,
        // no acoplarle cartas naturales si esas cartas pueden formar o iniciar un nuevo juego independiente en mano (camino a 2da canasta).
        const isGoingForMortoOrWin = canTakeMortoThisTurn || canWinThisTurn;
        if (!isGoingForMortoOrWin && canNaturalCardFormIndependentMeldInHand(card, botHand)) {
          continue;
        }
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
          if (run.length >= 10) {
            // Prioridad táctica: Si tiene 10 o más cartas continuas, bajar primero una canasta limpia de 7 cartas
            // y dejar el resto (3+ cartas) en mano para bajarlas en la siguiente acción como juego separado.
            const canastaCards = run.slice(run.length - 7);
            if (tryMeldBotRun(canastaCards, botIdx, true)) return true;
          } else if (run.length >= 3) {
            if (tryMeldBotRun(run, botIdx, true)) return true;
          }
          run = [card];
        }
      }
    }
    if (run.length >= 10) {
      const canastaCards = run.slice(run.length - 7);
      if (tryMeldBotRun(canastaCards, botIdx, true)) return true;
    } else if (run.length >= 3) {
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

function runBotDiscardPhaseInRoom(room, botIdx) {
  if (!room || !room.gameState || room.gameState.status !== 'playing') {
    if (room) room.isBotThinking = false;
    return;
  }
  const gameState = room.gameState;
  const players = room.players;
  const sendStateToAll = () => sendStateToRoom(room);
  const startPlayerTurn = (nextTurn) => startPlayerTurnInRoom(room, nextTurn);
  const checkMortoIndirect = (bIdx) => checkMortoIndirectInRoom(room, bIdx);

  if (!gameState || gameState.status !== 'playing') {
    room.isBotThinking = false;
    return;
  }

  let botPlayer = gameState.players[botIdx];
  let botHand = botPlayer.hand;
  const teamIdx = getTeamOwnerIndex(botIdx, gameState.is4Player);
  const opponentTeamIdx = teamIdx === 0 ? 1 : 0;
  const botMelds = gameState.players[teamIdx].melds;
  const deckCount = gameState.drawPile.length;

  if (botHand.length === 0) {
    room.isBotThinking = false;
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
      
      room.isBotThinking = false;
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
  room.isBotThinking = false;
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



function tryMeldBotRunInRoom(room, cardsToMeld, botIdx, hasMelded) {
  const gameState = room.gameState;
  const players = room.players;
  const checkMortoDirect = (bIdx) => checkMortoDirectInRoom(room, bIdx);
  const checkDirectBatida = (bIdx) => checkDirectBatidaInRoom(room, bIdx);

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
  console.log('-----------------------------------------------------');
  console.log('Servidor de Buraco Multi-Sala ejecutándose en:');
  console.log(`- Local: http://localhost:${PORT}`);
  console.log(`- Red Local: http://${LOCAL_IP}:${PORT}`);
  console.log('-----------------------------------------------------');
});
