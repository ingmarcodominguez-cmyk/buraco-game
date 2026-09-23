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

app.get('/reset-room/:roomId', (req, res) => {
  try {
    const cleanId = (req.params.roomId || 'mesa-1').trim().toLowerCase();
    const room = rooms.get(cleanId);
    if (room) {
      if (room.botTurnTimeout) {
        clearTimeout(room.botTurnTimeout);
        room.botTurnTimeout = null;
      }
      room.players = [];
      room.gameState = null;
      room.globalScores = [0, 0];
      room.isBotThinking = false;
      saveRoomsToDisk();
      io.to(cleanId).emit('game-aborted', 'La sala ha sido reiniciada.');
      io.emit('rooms-summary', getRoomsSummary());
      return res.json({ success: true, message: `Sala ${cleanId} reiniciada con éxito.` });
    }
    res.json({ success: false, message: `Sala ${cleanId} no encontrada.` });
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.get('/debug-rooms', (req, res) => {
  try {
    const data = {};
    for (const [id, r] of rooms.entries()) {
      data[id] = {
        players: r.players.map(p => ({ name: p.name, isBot: p.isBot, socketId: p.socketId })),
        gameStateStatus: r.gameState?.status,
        turnState: r.gameState?.turnState,
        turn: r.gameState?.turn,
        isAgainstBot: r.isAgainstBotSetting,
        is4Player: r.is4PlayerSetting
      };
    }
    res.json(data);
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
    this.aiMemory = {
      knownOpponentHands: {}, // playerIdx -> Card[] (cartas levantadas del pozo que aún conserva)
      discardHistory: [],     // Card[] (historial de cartas descartadas durante la ronda)
      botHeldHistory: []      // Card[] (cartas que el bot tuvo en mano)
    };
  }
}

// Registro global de salas activas
const rooms = new Map();
const ROOMS_CACHE_FILE = path.join(__dirname, 'rooms-cache.json');

function saveRoomsToDisk() {
  try {
    const data = {};
    for (const [id, room] of rooms.entries()) {
      if (room.gameState && (room.gameState.status === 'playing' || room.gameState.status === 'finished-visual')) {
        data[id] = {
          id: room.id,
          players: room.players.map(p => ({ ...p, socketId: p.isBot ? 'bot-socket' : null })),
          gameState: room.gameState,
          globalScores: room.globalScores,
          requiredCanastrasSetting: room.requiredCanastrasSetting,
          targetScoreSetting: room.targetScoreSetting,
          isAgainstBotSetting: room.isAgainstBotSetting,
          is4PlayerSetting: room.is4PlayerSetting,
          aiMemory: room.aiMemory
        };
      }
    }
    fs.writeFileSync(ROOMS_CACHE_FILE, JSON.stringify(data), 'utf8');
  } catch (err) {
    console.error('Error guardando caché de salas en disco:', err.message);
  }
}

function loadRoomsFromDisk() {
  try {
    if (fs.existsSync(ROOMS_CACHE_FILE)) {
      const raw = fs.readFileSync(ROOMS_CACHE_FILE, 'utf8');
      const data = JSON.parse(raw);
      for (const id of Object.keys(data)) {
        const item = data[id];
        const room = new BuracoRoom(item.id);
        room.players = item.players || [];
        room.gameState = item.gameState || null;
        room.globalScores = item.globalScores || [0, 0];
        room.requiredCanastrasSetting = item.requiredCanastrasSetting || 1;
        room.targetScoreSetting = item.targetScoreSetting || 3000;
        room.isAgainstBotSetting = !!item.isAgainstBotSetting;
        room.is4PlayerSetting = !!item.is4PlayerSetting;
        room.aiMemory = item.aiMemory || { knownOpponentHands: {}, discardHistory: [], botHeldHistory: [] };
        rooms.set(id, room);
        console.log(`Sala restaurada desde disco: ${id} (${room.players.map(p => p.name).join(', ')})`);
      }
    }
  } catch (err) {
    console.error('Error cargando caché de salas desde disco:', err.message);
  }
}

// Cargar salas persistidas al iniciar el servidor
loadRoomsFromDisk();

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

// ============================================================================
// MEMORIA DE INFORMACIÓN PÚBLICA Y RASTREO TÁCTICO DE LA IA
// ============================================================================
function getAIMemory(room) {
  if (!room) return { knownOpponentHands: {}, discardHistory: [], botHeldHistory: [] };
  if (!room.aiMemory) {
    room.aiMemory = {
      knownOpponentHands: {},
      discardHistory: [],
      botHeldHistory: []
    };
  }
  return room.aiMemory;
}

function resetAIMemory(room) {
  if (!room) return;
  room.aiMemory = {
    knownOpponentHands: {},
    discardHistory: [],
    botHeldHistory: []
  };
}

function recordOpponentDrawDiscard(room, playerIdx, cards) {
  if (!room || !Array.isArray(cards)) return;
  const mem = getAIMemory(room);
  if (!mem.knownOpponentHands[playerIdx]) {
    mem.knownOpponentHands[playerIdx] = [];
  }
  cards.forEach(c => {
    if (c && c.rank !== 'hidden') {
      mem.knownOpponentHands[playerIdx].push({
        id: c.id,
        suit: c.suit,
        rank: c.rank,
        value: c.value
      });
    }
  });
}

function recordOpponentPlayedCards(room, playerIdx, cards) {
  if (!room || !Array.isArray(cards)) return;
  const mem = getAIMemory(room);
  const known = mem.knownOpponentHands[playerIdx];
  if (!known || known.length === 0) return;
  cards.forEach(c => {
    if (!c) return;
    const idx = known.findIndex(kc => (c.id && kc.id === c.id) || (kc.suit === c.suit && kc.rank === c.rank));
    if (idx !== -1) {
      known.splice(idx, 1);
    }
  });
}

function recordDiscardCard(room, playerIdx, card) {
  if (!room || !card) return;
  const mem = getAIMemory(room);
  recordOpponentPlayedCards(room, playerIdx, [card]);
  mem.discardHistory.push({
    id: card.id,
    suit: card.suit,
    rank: card.rank,
    value: card.value,
    playerIdx: playerIdx
  });
}

function recordMortoTaken(room, playerIdx) {
  if (!room) return;
  const mem = getAIMemory(room);
  // Al agotar la mano para tomar el muerto, todas las cartas conocidas previas ya fueron jugadas/descartadas
  mem.knownOpponentHands[playerIdx] = [];
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
  
  // Limpiar timers de IA si estaban pendientes
  if (room.botTurnTimeout) {
    clearTimeout(room.botTurnTimeout);
    room.botTurnTimeout = null;
  }
  room.isBotThinking = false;

  // Restaurar estado de juego completo en la sala
  room.gameState = JSON.parse(JSON.stringify(savedSnapshot));
  room.gameState.teamUndoCounts = newTeamUndoCounts;
  room.gameState.lastUndoTeam = lastUndoTeam;
  room.gameState.undoRequestedBy = null;
  const oppHumans = room.players.filter((p, idx) => !p.isBot && p.socketId && idx !== requesterIdx);
  room.gameState.lastAction = `Jugada deshecha por ${room.players[requesterIdx].name}${oppHumans.length > 0 ? ' con el permiso del rival.' : '.'}`;
  
  // Re-guardar snapshot en el gameState restaurado para permitir un segundo deshacer consecutivo en el mismo turno
  const { turnStartSnapshot: _ignore, ...currentSnapshotData } = room.gameState;
  room.gameState.turnStartSnapshot = JSON.parse(JSON.stringify(currentSnapshotData));

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
  if (!room || !room.gameState || !Array.isArray(room.players)) return;

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

  // Persistir estado de las salas en disco para no perder partidas activas
  saveRoomsToDisk();
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
      recordMortoTaken(room, playerIdx);
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
      recordMortoTaken(room, playerIdx);
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
    }, 2500); // Demora simulando pensar y permitiendo al usuario deshacer su descarte si fue erróneo
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

  // Salir de la sala de espera (lobby)
  socket.on('leave-lobby', ({ roomId } = {}) => {
    const cleanId = (roomId || socket.roomId || 'mesa-1').trim().toLowerCase();
    const room = rooms.get(cleanId);
    if (room && !room.gameState) {
      room.players = room.players.filter(p => p.socketId !== socket.id);
      saveRoomsToDisk();
      socket.leave(cleanId);
      socket.roomId = null;
      io.to(cleanId).emit('lobby-update', {
        roomId: cleanId,
        players: room.players.filter(p => !p.isBot).map(p => p.name),
        isOccupied: false
      });
      io.emit('rooms-summary', getRoomsSummary());
    }
  });

  socket.on('get-rooms-summary', () => {
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
    const isPlayerReconnecting = room.players.some(p => p.name && p.name.trim().toLowerCase() === cleanName.toLowerCase()) || (room.isAgainstBotSetting && activeHumans.length === 0);

    // Si la partida anterior ya finalizó por completo en esta sala y no hay humanos activos, limpiar
    // NOTA: Solo limpiar si el match terminó definitivamente (match-over), NO entre rondas
    if (room.gameState && room.gameState.turnState === 'match-over' && activeHumans.length === 0) {
      console.log(`La partida anterior en sala ${cleanRoomId} ya finalizó por completo. Limpiando sala.`);
      room.players = [];
      room.gameState = null;
      room.globalScores = [0, 0];
      room.isBotThinking = false;
    }

    // Si la partida previa no tiene ningún humano activo conectado y entra un jugador nuevo en sala humana, limpiar sala abandonada
    if (hasActiveGame && activeHumans.length === 0 && !isPlayerReconnecting && !room.isAgainstBotSetting) {
      console.log(`Sala ${cleanRoomId} tenía una partida previa sin humanos activos. Reiniciando para nuevo jugador: ${cleanName}`);
      room.players = [];
      room.gameState = null;
      room.globalScores = [0, 0];
      room.isBotThinking = false;
      saveRoomsToDisk();
    }

    // Si la sala está en lobby (sin partida en curso) y no hay humanos activos conectados, limpiar cualquier residuo
    if (!hasActiveGame && activeHumans.length === 0) {
      room.players = [];
      room.gameState = null;
      room.globalScores = [0, 0];
      room.isBotThinking = false;
    }

    // Regla de sala ocupada: Solo si hay humanos ACTIVOS conectados y no es el mismo jugador reconectando
    if (hasActiveGame && activeHumans.length > 0 && !isPlayerReconnecting) {
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
        const existingIndex = room.players.findIndex(p => p.name && p.name.trim().toLowerCase() === cleanName.toLowerCase());
        if (existingIndex !== -1) {
          room.players[existingIndex].socketId = socket.id;
          room.players[existingIndex].name = cleanName;
          if (room.gameState && room.gameState.players && room.gameState.players[existingIndex]) {
            room.gameState.players[existingIndex].name = cleanName;
          }
          console.log(`Humano se reconectó a sala 4P ${cleanRoomId}: ${cleanName} (slot ${existingIndex})`);
        } else {
          // Si hay una partida en curso y hay un slot humano desconectado
          const disconnectedHumanIdx = room.players.findIndex(p => !p.isBot && !p.socketId);
          if (disconnectedHumanIdx !== -1 && room.gameState) {
            room.players[disconnectedHumanIdx].socketId = socket.id;
            room.players[disconnectedHumanIdx].name = cleanName;
            if (room.gameState.players && room.gameState.players[disconnectedHumanIdx]) {
              room.gameState.players[disconnectedHumanIdx].name = cleanName;
            }
            console.log(`Humano ocupó slot desconectado en sala 4P ${cleanRoomId}: ${cleanName}`);
          } else {
            const humanCount = room.players.filter(p => !p.isBot).length;
            if (humanCount < 2) {
              if (!room.gameState) {
                room.players = room.players.filter(p => !p.isBot);
                room.players.push({ socketId: socket.id, name: cleanName });
                console.log(`Humano ${room.players.length} unido a sala 4P ${cleanRoomId}: ${cleanName}`);
              } else {
                socket.emit('error-message', 'La partida 4P ya está en curso.');
                return;
              }
            } else {
              socket.emit('error-message', 'La partida contra la PC en esta sala está llena (ya hay 2 humanos).');
              return;
            }
          }
        }
        
        // Solo configurar bots iniciales si la partida no ha comenzado (evitar alterar sorteo de asientos)
        if (!room.gameState) {
          const activeHumans = room.players.filter(p => !p.isBot);
          if (activeHumans.length === 2) {
            room.players = [
              activeHumans[0],
              activeHumans[1],
              { socketId: 'bot-socket-1', name: 'Compu A (IA)', isBot: true },
              { socketId: 'bot-socket-2', name: 'Compu B (IA)', isBot: true }
            ];
          }
        }
      } else {
        // Modo 2 jugadores con PC
        const humanIdx = room.players.findIndex(p => !p.isBot);
        const isReconnecting = room.gameState && humanIdx !== -1 && (
          (room.players[humanIdx] && room.players[humanIdx].name && room.players[humanIdx].name.trim().toLowerCase() === cleanName.toLowerCase()) ||
          !room.players[humanIdx].socketId ||
          room.players[humanIdx].socketId === socket.id
        );

        if (isReconnecting) {
          room.players[humanIdx].socketId = socket.id;
          room.players[humanIdx].name = cleanName;
          if (room.gameState.players && room.gameState.players[humanIdx]) {
            room.gameState.players[humanIdx].name = cleanName;
          }
          console.log(`Jugador se reconectó a su partida contra la PC en sala ${cleanRoomId}: ${cleanName} (asiento ${humanIdx})`);
        } else {
          room.players = [
            { socketId: socket.id, name: cleanName },
            { socketId: 'bot-socket', name: 'Computadora (IA)', isBot: true }
          ];
          room.gameState = null;
          room.globalScores = [0, 0];
          room.isBotThinking = false;
          console.log(`Partida contra la PC iniciada en sala ${cleanRoomId} para ${cleanName}`);
        }
      }
    } else {
      // Modo multijugador humano completo
      const existingIndex = room.players.findIndex(p => p.socketId === socket.id);
      if (existingIndex !== -1) {
        room.players[existingIndex].name = cleanName;
        if (room.gameState && room.gameState.players && room.gameState.players[existingIndex]) {
          room.gameState.players[existingIndex].name = cleanName;
        }
      } else {
        const sameNameIndex = room.players.findIndex(p => p.name && p.name.trim().toLowerCase() === cleanName.toLowerCase());
        if (sameNameIndex !== -1) {
          room.players[sameNameIndex].socketId = socket.id;
          room.players[sameNameIndex].name = cleanName;
          if (room.gameState && room.gameState.players && room.gameState.players[sameNameIndex]) {
            room.gameState.players[sameNameIndex].name = cleanName;
          }
          console.log(`Jugador reconectado por nombre en sala ${cleanRoomId}: ${cleanName} (asiento ${sameNameIndex})`);
        } else {
          const disconnectedIndex = room.players.findIndex(p => !p.socketId && !p.isBot);
          if (disconnectedIndex !== -1) {
            room.players[disconnectedIndex] = { socketId: socket.id, name: cleanName };
            if (room.gameState && room.gameState.players && room.gameState.players[disconnectedIndex]) {
              room.gameState.players[disconnectedIndex].name = cleanName;
            }
            console.log(`Jugador ocupó slot desconectado en sala ${cleanRoomId}: ${cleanName}`);
          } else if (room.players.length < maxPlayers && !room.gameState) {
            room.players.push({ socketId: socket.id, name: cleanName });
            console.log(`Jugador nuevo unido a sala ${cleanRoomId}: ${cleanName}`);
          } else {
            socket.emit('error-message', `La sala ${cleanRoomId} está llena o ya tiene una partida en curso.`);
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
        resetAIMemory(room);
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
      checkAndTriggerBotTurnInRoom(room);
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

    const card = gameState.drawPile.pop();
    gameState.players[pIdx].hand.push(card);
    gameState.turnState = 'play';

    if (gameState.players[pIdx] && !gameState.players[pIdx].isBot) {
      const { turnStartSnapshot, ...snapshotData } = gameState;
      gameState.turnStartSnapshot = JSON.parse(JSON.stringify(snapshotData));
    }
    
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

    const count = gameState.discardPile.length;
    recordOpponentDrawDiscard(room, pIdx, gameState.discardPile);
    gameState.players[pIdx].hand.push(...gameState.discardPile);
    gameState.discardPile = [];
    gameState.turnState = 'play';

    if (gameState.players[pIdx] && !gameState.players[pIdx].isBot) {
      const { turnStartSnapshot, ...snapshotData } = gameState;
      gameState.turnStartSnapshot = JSON.parse(JSON.stringify(snapshotData));
    }
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

    const hasTakenMorto = gameState.is4Player ? (gameState.mortosTaken[teamIdx] !== null) : gameState.mortosTaken[pIdx];
    const existingCanastras = teamMelds.filter(m => m.length >= 7).length;
    const newCanastraCreated = result.cards.length >= 7 ? 1 : 0;
    const totalCanastrasAfter = existingCanastras + newCanastraCreated;
    const requiredCanastras = gameState.requiredCanastras || 1;
    const canBat = hasTakenMorto && (totalCanastrasAfter >= requiredCanastras);
    const minCardsHand = !hasTakenMorto ? 0 : (canBat ? 0 : 1);

    if (hand.length - cards.length < minCardsHand) {
      if (minCardsHand === 1) {
        socket.emit('error-message', `No puedes quedarte sin cartas en la mano sin tener al menos ${requiredCanastras} canasta(s) para batir. Debes conservar al menos una para tu descarte.`);
      } else {
        socket.emit('error-message', 'No puedes quedarte sin cartas en la mano. Debes conservar al menos una para tu descarte.');
      }
      return;
    }

    cards.forEach(cardToRem => {
      const idx = hand.findIndex(hc => hc.id === cardToRem.id);
      if (idx !== -1) hand.splice(idx, 1);
    });
    recordOpponentPlayedCards(room, pIdx, cards);

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
    const minCardsHand = !hasTakenMorto ? 0 : (canBat ? 0 : 1);

    if (hand.length - cards.length < minCardsHand) {
      if (minCardsHand === 1) {
        socket.emit('error-message', `No puedes quedarte sin cartas en la mano sin tener al menos ${requiredCanastras} canasta(s) para batir. Debes conservar al menos una para tu descarte.`);
      } else {
        socket.emit('error-message', 'No puedes quedarte sin cartas en la mano. Debes conservar al menos una para tu descarte.');
      }
      return;
    }

    cards.forEach(cardToRem => {
      const idx = hand.findIndex(hc => hc.id === cardToRem.id);
      if (idx !== -1) hand.splice(idx, 1);
    });
    recordOpponentPlayedCards(room, pIdx, cards);

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
        // CIERRE EN FALSO: El jugador intentó descartar su última carta pero no tiene las canastas requeridas.
        // Se retrotrae automáticamente su turno para devolverle las cartas a la mano y evitar que la partida quede trabada.
        if (gameState.turnStartSnapshot) {
          const savedSnapshot = gameState.turnStartSnapshot;
          const currentTeamUndos = [...gameState.teamUndoCounts];
          const lastUndoTeam = gameState.lastUndoTeam;
          
          if (room.botTurnTimeout) {
            clearTimeout(room.botTurnTimeout);
            room.botTurnTimeout = null;
          }
          room.isBotThinking = false;

          // Restaurar estado al inicio del turno del jugador
          room.gameState = JSON.parse(JSON.stringify(savedSnapshot));
          room.gameState.teamUndoCounts = currentTeamUndos; // No consumir deshechos del jugador
          room.gameState.lastUndoTeam = lastUndoTeam;
          room.gameState.undoRequestedBy = null;
          room.gameState.lastAction = `⚠️ ${player.name} intentó cerrar con ${canastrasCount} de ${requiredCanastras} canastas requeridas. Jugada retrotraída automáticamente para que pueda descartar conservando cartas.`;
          
          // Re-guardar snapshot para futuros deshechos
          const { turnStartSnapshot: _ignore, ...currentSnapshotData } = room.gameState;
          room.gameState.turnStartSnapshot = JSON.parse(JSON.stringify(currentSnapshotData));

          socket.emit('error-message', `No puedes cerrar la partida: tienes ${canastrasCount} canasta(s) y se requieren ${requiredCanastras}. Tu jugada fue retrotraída automáticamente para que conserves tus cartas y puedas descartar.`);
          sendStateToRoom(room);
          return;
        } else {
          socket.emit('error-message', `No puedes cerrar la partida sin tener al menos ${requiredCanastras} canasta(s) hechas.`);
          return;
        }
      }
      
      const discarded = hand.splice(cardIdx, 1)[0];
      recordDiscardCard(room, pIdx, discarded);
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
    recordDiscardCard(room, pIdx, discarded);
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

    resetAIMemory(room);
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
    
    resetAIMemory(room);
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

    const maxPlayers = gameState.is4Player ? 4 : 2;
    const isMyTurn = gameState.turn === pIdx;
    const prevPlayerIdx = (gameState.turn - 1 + maxPlayers) % maxPlayers;
    const isPrevPlayer = gameState.is4Player 
      ? getTeamOwnerIndex(prevPlayerIdx, true) === getTeamOwnerIndex(pIdx, true) 
      : prevPlayerIdx === pIdx;

    const isCurrentPlayerBot = Boolean(room.players[gameState.turn]?.isBot);
    // Permitir deshacer:
    // 1. Durante mi turno de juego
    // 2. Inmediatamente después de haber descartado una carta al pozo (el turno pasó al siguiente jugador y este aún no robó, o es la IA)
    const canUndoNow = isMyTurn || (isPrevPlayer && (gameState.turnState === 'draw' || isCurrentPlayerBot));

    if (!canUndoNow) {
      socket.emit('error-message', 'Solo puedes deshacer durante tu turno o inmediatamente después de haber descartado.');
      return;
    }

    const teamIdx = getTeamOwnerIndex(pIdx, gameState.is4Player);
    const opponentTeamIdx = teamIdx === 0 ? 1 : 0;
    const maxUndos = gameState.is4Player ? 3 : 2;

    const player = gameState.players[pIdx];
    const teamMelds = gameState.players[teamIdx].melds;
    const canastrasCount = teamMelds.filter(m => m.length >= 7).length;
    const requiredCanastras = gameState.requiredCanastras || 1;
    const hasTakenMorto = gameState.is4Player ? (gameState.mortosTaken[teamIdx] !== null) : gameState.mortosTaken[pIdx];

    const isStuckEmergency = (
      player &&
      player.hand.length === 1 &&
      hasTakenMorto &&
      canastrasCount < requiredCanastras
    );

    if (gameState.teamUndoCounts[teamIdx] >= maxUndos && !isStuckEmergency) {
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
      if (room.botTurnTimeout) {
        clearTimeout(room.botTurnTimeout);
        room.botTurnTimeout = null;
      }
      saveRoomsToDisk();
      io.to(room.id).emit('game-aborted', `${leavingPlayerName} ha abandonado la partida. Se canceló la mesa.`);
      socket.leave(room.id);
      socket.roomId = null;
      io.emit('rooms-summary', getRoomsSummary());
    }
  });

  socket.on('disconnect', () => {
    const room = findRoomBySocketId(socket.id);
    if (!room) return;
    const index = room.players.findIndex(p => p.socketId === socket.id);
    if (index !== -1) {
      console.log(`Jugador desconectado de sala ${room.id}: ${room.players[index].name}`);
      if (!room.gameState) {
        // En el lobby: quitar inmediatamente al jugador desconectado para evitar jugadores fantasmas
        room.players.splice(index, 1);
        saveRoomsToDisk();
        io.to(room.id).emit('lobby-update', {
          roomId: room.id,
          players: room.players.filter(p => !p.isBot).map(p => p.name),
          isOccupied: false
        });
      } else {
        room.players[index].socketId = null;
      }
    }

    const activeHumans = room.players.filter(p => p.socketId && !p.socketId.startsWith('bot-socket') && !p.isBot);
    if (activeHumans.length === 0) {
      console.log(`Sala ${room.id} vacía de humanos. Programando limpieza diferida en 60 segundos.`);
      if (room.cleanupTimeout) clearTimeout(room.cleanupTimeout);
      room.cleanupTimeout = setTimeout(() => {
        const stillNoHumans = room.players.filter(p => p.socketId && !p.socketId.startsWith('bot-socket') && !p.isBot).length === 0;
        if (stillNoHumans) {
          console.log(`Limpiando sala ${room.id} por inactividad prolongada.`);
          if (room.botTurnTimeout) clearTimeout(room.botTurnTimeout);
          room.players = [];
          room.gameState = null;
          room.globalScores = [0, 0];
          room.isBotThinking = false;
          saveRoomsToDisk();
          io.emit('rooms-summary', getRoomsSummary());
        }
        room.cleanupTimeout = null;
      }, 60000);
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
      const currentRoundNum = currentHistory.length + 1;
      currentHistory.push({
        round: currentRoundNum,
        roundNumber: currentRoundNum,
        totals: [roundPointsTeam0, roundPointsTeam1],
        roundScores: [roundPointsTeam0, roundPointsTeam1],
        accumulated: [...room.globalScores],
        accumulatedScores: [...room.globalScores],
        breakdown: roundBreakdown
      });

      const currentTargetScore = gameState.targetScore || room.targetScoreSetting || 3000;
      const isMatchOver = room.globalScores[0] >= currentTargetScore || room.globalScores[1] >= currentTargetScore;
      if (isMatchOver) {
        gameState.status = 'finished';
        gameState.turnState = 'match-over';
        gameState.scores = [...room.globalScores];
        gameState.roundHistory = currentHistory;
        gameState.winner = room.globalScores[0] >= room.globalScores[1] ? 0 : 1;
        sendStateToRoom(room);
        return;
      }

      const currentRequiredCanastras = gameState.requiredCanastras || room.requiredCanastrasSetting || 1;
      const previousStarter = gameState.starterIndex !== undefined ? gameState.starterIndex : 0;
      const maxPlayers = room.is4PlayerSetting ? 4 : 2;
      const nextStarter = (previousStarter + 1) % maxPlayers;

      resetAIMemory(room);
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

// HELPER: Rango de valores numéricos para evaluación de escaleras y conectores
const RANK_ORDER_VALS = { 'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13 };

// ============================================================================
// MOTOR PROBABILÍSTICO Y RASTREADOR AVANZADO DE CARTAS (SIN TRAMPAS)
// ============================================================================
function getCardTracker(state, botIdx, aiMemory) {
  const suits = ['H', 'D', 'C', 'S', 'Joker'];
  const ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'Joker'];

  const totalDeckCopies = {};
  suits.forEach(s => {
    if (s === 'Joker') {
      totalDeckCopies['Joker-Joker'] = 4;
    } else {
      ranks.forEach(r => {
        if (r !== 'Joker') {
          totalDeckCopies[`${s}-${r}`] = 2;
        }
      });
    }
  });

  const seenCount = {};
  for (const k in totalDeckCopies) {
    seenCount[k] = 0;
  }
  const seenCardIds = new Set();

  const countCard = (c) => {
    if (!c || c.rank === 'hidden') return;
    const key = (c.suit === 'Joker' || c.rank === 'Joker') ? 'Joker-Joker' : `${c.suit}-${c.rank}`;
    if (seenCount[key] === undefined) return;

    if (c.id) {
      if (seenCardIds.has(c.id)) return;
      seenCardIds.add(c.id);
    }
    seenCount[key] = Math.min(totalDeckCopies[key], seenCount[key] + 1);
  };

  // 1. Mano propia del bot
  if (state.players[botIdx] && state.players[botIdx].hand) {
    state.players[botIdx].hand.forEach(countCard);
  }

  // 2. Juegos en la mesa (de todos los equipos)
  state.players.forEach(p => {
    if (p.melds) {
      p.melds.forEach(meld => {
        if (meld) meld.forEach(countCard);
      });
    }
  });

  // 3. Pozo de descartes actual
  if (state.discardPile) {
    state.discardPile.forEach(countCard);
  }

  // 4. Cartas del historial de descartes
  if (aiMemory && Array.isArray(aiMemory.discardHistory)) {
    aiMemory.discardHistory.forEach(countCard);
  }

  // 5. Cartas conocidas en mano del oponente
  if (aiMemory && aiMemory.knownOpponentHands) {
    Object.values(aiMemory.knownOpponentHands).forEach(cards => {
      if (Array.isArray(cards)) cards.forEach(countCard);
    });
  }

  // 6. Cartas que el bot tuvo previamente
  if (aiMemory && Array.isArray(aiMemory.botHeldHistory)) {
    aiMemory.botHeldHistory.forEach(countCard);
  }

  let totalVisible = 0;
  for (const k in seenCount) {
    totalVisible += seenCount[k];
  }
  const totalInvisible = Math.max(0, 108 - totalVisible);

  const getRemainingCount = (suit, rank) => {
    const key = (suit === 'Joker' || rank === 'Joker') ? 'Joker-Joker' : `${suit}-${rank}`;
    const max = totalDeckCopies[key] || 0;
    const seen = seenCount[key] || 0;
    return Math.max(0, max - seen);
  };

  const drawPileCount = state.drawPile ? state.drawPile.length : 0;
  let mortosRemainingCards = 0;
  if (state.mortos) {
    mortosRemainingCards = state.mortos.filter(Boolean).length * 11;
  }

  // Probabilidad de que la PRÓXIMA carta del mazo sea (suit, rank)
  const probNextDraw = (suit, rank) => {
    if (totalInvisible <= 0) return 0;
    const rem = getRemainingCount(suit, rank);
    return rem / totalInvisible;
  };

  // Probabilidad hipergeométrica exacta de que al menos 1 copia esté en el mazo de robo
  const probInDrawPile = (suit, rank) => {
    const rem = getRemainingCount(suit, rank);
    if (rem <= 0 || drawPileCount <= 0 || totalInvisible <= 0) return 0;
    if (drawPileCount >= totalInvisible) return 1;

    let pZero = 1;
    for (let i = 0; i < rem; i++) {
      const num = totalInvisible - drawPileCount - i;
      const den = totalInvisible - i;
      if (num <= 0) {
        pZero = 0;
        break;
      }
      pZero *= (num / den);
    }
    return Math.max(0, Math.min(1, 1 - pZero));
  };

  // Probabilidad hipergeométrica exacta de que al menos 1 copia esté en los muertos no tomados
  const probInMorto = (suit, rank) => {
    const rem = getRemainingCount(suit, rank);
    if (rem <= 0 || mortosRemainingCards <= 0 || totalInvisible <= 0) return 0;
    if (mortosRemainingCards >= totalInvisible) return 1;

    let pZero = 1;
    for (let i = 0; i < rem; i++) {
      const num = totalInvisible - mortosRemainingCards - i;
      const den = totalInvisible - i;
      if (num <= 0) {
        pZero = 0;
        break;
      }
      pZero *= (num / den);
    }
    return Math.max(0, Math.min(1, 1 - pZero));
  };

  return {
    visible: seenCount,
    totalVisible,
    totalInvisible,
    drawPileCount,
    mortosRemainingCards,
    getRemainingCount,
    probNextDraw,
    probInDrawPile,
    probInMorto
  };
}

// HELPER: Calcular la probabilidad de robar una carta específica del mazo
function getProbabilityOfCard(suit, rank, tracker) {
  if (!tracker) return 0;
  if (tracker.probNextDraw) return tracker.probNextDraw(suit, rank);
  if (tracker.totalInvisible <= 0) return 0;
  const remaining = tracker.getRemainingCount(suit, rank);
  return remaining / tracker.totalInvisible;
}

// ============================================================================
// EVALUADOR TÁCTICO DE PELIGRO DE DESCARTE CONTRA LA MANO CONOCIDA DEL RIVAL
// ============================================================================
function evaluateDiscardDangerAgainstOpponent(card, knownOpponentCards, opponentMelds, tracker, opponentHandSize, opponentDiscardHistory = []) {
  let dangerScore = 0;
  let dangerReason = '';

  const isWildcard = card.rank === '2' || card.rank === 'Joker';
  if (isWildcard) {
    return { dangerScore: 100000, reason: 'Comodín (No descartar bajo ningún concepto)' };
  }

  const cardRankVal = RANK_ORDER_VALS[card.rank] || 0;

  // 1. ANÁLISIS DE CARTAS MUERTAS (Ambas copias vistas -> Imposible que forme nuevas combinaciones en mano del rival)
  if (tracker && tracker.getRemainingCount(card.suit, card.rank) === 0) {
    dangerScore -= 25000;
    dangerReason = 'Carta muerta (ambas copias ya vistas en el juego)';
  }

  // 2. ANÁLISIS DE PALOS FRÍOS Y DESCARTES PREVIOS DEL RIVAL (Lectura de descartes)
  if (opponentDiscardHistory && opponentDiscardHistory.length > 0) {
    // A) Si el rival ya descartó esta carta exacta antes (ej. tiró 10♠ y ahora tenemos el otro 10♠)
    const opponentThrewSame = opponentDiscardHistory.some(d => d.suit === card.suit && d.rank === card.rank);
    if (opponentThrewSame) {
      dangerScore -= 35000;
      dangerReason = `Carta fría: el rival ya descartó un ${card.rank} de ${card.suit}`;
    }

    // B) Palos fríos: ¿Cuántas cartas de este palo ha descartado el rival?
    const suitDiscards = opponentDiscardHistory.filter(d => d.suit === card.suit).length;
    if (suitDiscards >= 3) {
      dangerScore -= 28000;
      if (!dangerReason) dangerReason = `Palo frío (${suitDiscards} descartes del rival en ${card.suit})`;
    } else if (suitDiscards >= 1) {
      dangerScore -= 14000;
      if (!dangerReason) dangerReason = `Palo descartado por el rival (${suitDiscards} en ${card.suit})`;
    } else {
      // El rival NO ha descartado NUNCA de este palo.
      // Si además la carta es central (6, 7, 8, 9), el peligro de alimentarle una escalera es muy alto
      if (cardRankVal >= 6 && cardRankVal <= 9) {
        dangerScore += 22000;
        if (!dangerReason) dangerReason = `Palo caliente sin descartes del rival y carta central conectora (${card.rank} de ${card.suit})`;
      } else if (cardRankVal >= 5 && cardRankVal <= 10) {
        dangerScore += 10000;
        if (!dangerReason) dangerReason = `Palo no tocado por el rival y conector medio (${card.rank})`;
      }
    }
  } else {
    // Sin descartes previos: penalizar cartas centrales
    if (cardRankVal >= 6 && cardRankVal <= 9) {
      dangerScore += 16000;
      if (!dangerReason) dangerReason = `Carta central conectora (${card.rank})`;
    }
  }

  // Las cartas extremas (As, K, 3) tienen naturalmente menor radio de conexión (solo un lado)
  if (card.rank === 'A' || card.rank === 'K' || card.rank === '3') {
    dangerScore -= 9000;
  }

  // 3. PELIGRO CONTRA CARTAS CONOCIDAS EN MANO DEL OPONENTE (Información pública 100% real)
  if (knownOpponentCards && knownOpponentCards.length > 0) {
    // A) Peligro de grupo / trío (Mismo rango)
    const sameRankCount = knownOpponentCards.filter(c => c.rank === card.rank).length;
    if (sameRankCount >= 2) {
      // El rival ya tiene 2 cartas de este rango (ej. dos K): tirarle otra le da el trío instantáneo
      dangerScore += 65000;
      dangerReason = `Rival tiene ${sameRankCount} cartas de rango ${card.rank} en mano`;
    } else if (sameRankCount === 1) {
      // El rival tiene 1 carta de ese rango: le arma pareja
      dangerScore += 16000;
      if (!dangerReason) dangerReason = `Rival tiene un ${card.rank} en mano`;
    }

    // B) Peligro de corrida / escalera (Mismo palo)
    const sameSuitKnown = knownOpponentCards.filter(c => c.suit === card.suit && c.rank !== '2' && c.rank !== 'Joker');
    if (sameSuitKnown.length > 0) {
      const suitVals = [];
      sameSuitKnown.forEach(c => {
        const v = RANK_ORDER_VALS[c.rank];
        if (v) {
          suitVals.push(v);
          if (v === 1) suitVals.push(14); // As como carta alta
        }
      });

      const uniqueVals = Array.from(new Set(suitVals)).sort((a, b) => a - b);
      let formsInstantRun = false;
      let fillsInsideGap = false;
      let twoStepConnector = false;
      let singleNeighbor = false;

      for (let i = 0; i < uniqueVals.length; i++) {
        for (let j = i + 1; j < uniqueVals.length; j++) {
          const v1 = uniqueVals[i];
          const v2 = uniqueVals[j];

          // Caso: rival tiene v1 y v1+1 consecutivos (ej. 5 y 6 de trébol)
          if (v2 === v1 + 1) {
            // Si descartamos v1-1 (4) o v1+2 (7), le completa la corrida de 3 cartas
            if (cardRankVal === v1 - 1 || cardRankVal === v1 + 2 || (cardRankVal === 1 && v1 === 13) || (cardRankVal === 14 && v1 === 12)) {
              formsInstantRun = true;
            }
            // Conector a distancia 2: ej. 3 u 8
            if (cardRankVal === v1 - 2 || cardRankVal === v1 + 3) {
              twoStepConnector = true;
            }
          }

          // Caso: rival tiene v1 y v1+2 con hueco en medio (ej. 5 y 7 de trébol)
          if (v2 === v1 + 2) {
            if (cardRankVal === v1 + 1) {
              fillsInsideGap = true;
            }
          }
        }

        // Caso: vecino simple a distancia 1 de alguna carta conocida (ej. rival tiene 5 y descartamos 4 o 6)
        if (Math.abs(uniqueVals[i] - cardRankVal) === 1 || (uniqueVals[i] === 13 && cardRankVal === 1) || (uniqueVals[i] === 1 && cardRankVal === 13)) {
          singleNeighbor = true;
        }
      }

      if (formsInstantRun) {
        dangerScore += 70000;
        dangerReason = `Completa corrida en mano del rival de palo ${card.suit}`;
      } else if (fillsInsideGap) {
        dangerScore += 65000;
        dangerReason = `Llena hueco de corrida en mano del rival de palo ${card.suit}`;
      } else if (twoStepConnector) {
        dangerScore += 14000;
        if (!dangerReason) dangerReason = `Conector a 2 pasos de corrida en mano rival (${card.suit})`;
      } else if (singleNeighbor) {
        dangerScore += 7000;
        if (!dangerReason) dangerReason = `Vecino directo de carta en mano rival (${card.suit})`;
      }
    }
  }

  // 4. PELIGRO CONTRA JUEGOS BAJADOS EN LA MESA POR EL RIVAL
  if (opponentMelds && opponentMelds.length > 0) {
    let servesMeld = false;
    let createsCanastra = false;
    let adjacentToRun = false;

    for (const meld of opponentMelds) {
      if (validateMeld([...meld, card]).valid) {
        servesMeld = true;
        if (meld.length >= 6) {
          createsCanastra = true;
        }
        break;
      }
    }

    if (servesMeld) {
      if (createsCanastra) {
        dangerScore += 50000;
        dangerReason = `¡Regala canasta en mesa al rival!`;
      } else {
        dangerScore += 25000;
        dangerReason = `Acopla directamente a juego del rival en mesa`;
      }
    } else {
      for (const meld of opponentMelds) {
        if (meld.length > 0 && meld[0].suit === card.suit) {
          const rankVals = meld.map(c => RANK_ORDER_VALS[c.representedRank || c.rank]).filter(Boolean);
          if (rankVals.length > 0) {
            const minV = Math.min(...rankVals);
            const maxV = Math.max(...rankVals);
            if (cardRankVal === minV - 1 || cardRankVal === maxV + 1 || (minV === 1 && cardRankVal === 13) || (maxV === 13 && cardRankVal === 1)) {
              adjacentToRun = true;
              break;
            }
          }
        }
      }
      if (adjacentToRun) {
        dangerScore += 6000;
        if (!dangerReason) dangerReason = `Adyacente a corrida del rival en mesa`;
      }
    }
  }

  if (opponentHandSize <= 3 && dangerScore > 0) {
    dangerScore *= 1.5;
  }

  return { dangerScore, reason: dangerReason };
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
        const pileSize = gameState.discardPile.length;
        const pileEval = evaluatePilePotential(gameState.discardPile, botHand, tracker);

        // 1. Si hay algún comodín en el pozo (2 o Joker) o la superior es comodín: ¡SIEMPRE LEVANTAR!
        if (pileEval.hasWildcard || isWildcard) {
          drewFromDiscard = true;
        }
        // 2. Si la carta superior sirve de inmediato (acopla a juego existente o forma nueva combinación de 3+):
        else if (topCardServes) {
          if (!opponentCanWinSoon || unplayableAdded <= 4) {
            drewFromDiscard = true;
          }
        }
        // 3. Si al recoger el pozo puede bajar al menos un juego de inmediato (3+ cartas):
        else if (cardsGainedFromPile >= 3) {
          drewFromDiscard = true;
        }
        // =========================================================================
        // REGLA FUNDAMENTAL DE POZOS PEQUEÑOS (1 o 2 cartas):
        // NUNCA levantar un pozo de 1 o 2 cartas por simples "conexiones sueltas" si no se puede
        // bajar de inmediato ni contiene comodines. Robar del mazo es infinitamente superior
        // (oculta información, busca comodines y no traba la mano con basura del rival).
        // =========================================================================
        else if (pileSize <= 2) {
          // No cumple comodín ni bajada inmediata: NO levantar, robar del mazo
          drewFromDiscard = false;
        }
        // 4. Pozos medianos (3 a 4 cartas): Solo si tienen múltiples cartas útiles y alta sinergia
        else if (pileSize >= 3 && pileSize <= 4) {
          if (pileEval.usefulCards >= 2 && pileEval.connectionScore >= 3 && unplayableAdded <= 2 && !opponentCanWinSoon) {
            drewFromDiscard = true;
          }
        }
        // 5. Pozos grandes (>= 5 cartas): Volumen táctico que multiplica combinaciones y canastas
        else if (pileSize >= 5 && unplayableAdded <= 6 && !opponentCanWinSoon) {
          drewFromDiscard = true;
        }
      }
    }
  }

  if (drewFromDiscard) {
    const count = gameState.discardPile.length;
    const pickedCardIds = new Set(gameState.discardPile.map(c => c.id));
    if (room) room.lastPickedDiscardCardIds = pickedCardIds;
    gameState.lastPickedDiscardCardIds = pickedCardIds;

    botHand.push(...gameState.discardPile);
    gameState.discardPile = [];
    gameState.turnState = 'play';
    gameState.lastAction = `${botPlayer.name} recogió el pozo entero (${count} cartas).`;
    
    if (gameState.isFirstTurn) {
      gameState.isFirstTurn = false;
      gameState.firstDrawnCardId = null;
    }
  } else {
    if (room) room.lastPickedDiscardCardIds = null;
    gameState.lastPickedDiscardCardIds = null;
    if (gameState.drawPile.length > 0) {
      const card = gameState.drawPile.pop();
      botHand.push(card);
      gameState.turnState = 'play';
      gameState.lastAction = `${botPlayer.name} robó del mazo.`;
      
      if (gameState.isFirstTurn) {
        const handWithoutCard = botHand.slice(0, botHand.length - 1);
        const isUseful = isCardUsefulForFirstTurn(card, handWithoutCard);
        if (!isUseful && gameState.drawPile.length > 0) {
          const rejected = botHand.pop();
          recordDiscardCard(room, botIdx, rejected);
          gameState.discardPile.push(rejected);
          
          const newCard = gameState.drawPile.pop();
          botHand.push(newCard);
          
          gameState.isFirstTurn = false;
          gameState.firstDrawnCardId = null;
          gameState.lastAction = `${botPlayer.name} descartó la primera carta (${rejected.rank} de ${rejected.suit}) al pozo porque no le servía y robó otra del mazo.`;
        } else {
          gameState.isFirstTurn = false;
          gameState.firstDrawnCardId = null;
          gameState.lastAction = `${botPlayer.name} robó y conservó la primera carta del mazo.`;
        }
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

// HELPER: Rango de cartas para la IA
const BOT_RANK_ORDER = { 'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13 };

// HELPER: Mapea las cartas de un palo en la mano a sus slots posibles (1..14)
function getSuitCardSlots(hand, suit) {
  const slots = [];
  hand.forEach(c => {
    if (!c) return;
    if (c.rank === 'Joker') return;
    if (c.rank === '2' && c.suit !== suit) return;
    if (c.suit !== suit) return;
    if (c.rank === 'A') {
      slots.push({ card: c, slot: 1 });
      slots.push({ card: c, slot: 14 });
    } else if (c.rank === '2' && c.suit === suit) {
      slots.push({ card: c, slot: 2 });
    } else {
      const v = BOT_RANK_ORDER[c.rank];
      if (v) slots.push({ card: c, slot: v });
    }
  });
  return slots;
}

// HELPER: Extrae secuencias limpias (3+ cartas consecutivas) de un palo
function extractCleanRunsForSuit(hand, suit) {
  const foundRuns = [];
  let currentHand = [...hand];

  while (true) {
    const slots = getSuitCardSlots(currentHand, suit);
    if (slots.length < 3) break;

    const slotCardMap = {};
    for (let s = 1; s <= 14; s++) slotCardMap[s] = [];
    slots.forEach(item => {
      slotCardMap[item.slot].push(item.card);
    });

    let bestRun = null;
    let curRun = [];
    let curStart = -1;
    let usedCardIds = new Set();

    for (let s = 1; s <= 14; s++) {
      const availableCards = slotCardMap[s].filter(c => !usedCardIds.has(c.id));
      if (availableCards.length > 0) {
        if (curRun.length === 0) curStart = s;
        const chosenCard = availableCards[0];
        curRun.push(chosenCard);
        usedCardIds.add(chosenCard.id);
      } else {
        if (curRun.length >= 3) {
          if (!bestRun || curRun.length > bestRun.length) {
            bestRun = [...curRun];
          }
        }
        curRun = [];
        curStart = -1;
        usedCardIds.clear();
      }
    }
    if (curRun.length >= 3) {
      if (!bestRun || curRun.length > bestRun.length) {
        bestRun = [...curRun];
      }
    }

    if (!bestRun || bestRun.length < 3) break;

    const v = validateMeld(bestRun);
    if (!v.valid) break;

    foundRuns.push(bestRun);
    bestRun.forEach(rc => {
      const idx = currentHand.findIndex(c => c.id === rc.id);
      if (idx !== -1) currentHand.splice(idx, 1);
    });
  }

  return { foundRuns, remainingHand: currentHand };
}

// HELPER: Encuentra combinaciones de 3 cartas (2 cartas del mismo palo + 1 comodín)
function findDirtyRunsCandidates(hand) {
  const candidates = [];
  const wildcards = hand.filter(c => c.rank === '2' || c.rank === 'Joker');
  if (wildcards.length === 0) return candidates;

  const suits = ['H', 'D', 'C', 'S'];
  for (let s of suits) {
    const slots = getSuitCardSlots(hand, s);

    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const s1 = slots[i];
        const s2 = slots[j];
        if (s1.card.id === s2.card.id) continue;
        const diff = Math.abs(s1.slot - s2.slot);
        if (diff === 1 || diff === 2) {
          for (const wc of wildcards) {
            if (wc.id === s1.card.id || wc.id === s2.card.id) continue;
            // Prohibido tener dos doses en la misma corrida
            if (wc.rank === '2' && (s1.card.rank === '2' || s2.card.rank === '2')) continue;
            if (s1.card.rank === '2' && s2.card.rank === '2') continue;
            const cand = [s1.card, s2.card, wc];
            const v = validateMeld(cand);
            if (v.valid) {
              const points = cand.reduce((sum, c) => sum + (CARD_VALUES[c.rank] || 0), 0);
              candidates.push({ cards: cand, points, validated: v.cards });
            }
          }
        }
      }
    }
  }

  candidates.sort((a, b) => b.points - a.points);
  return candidates;
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

  // 1.1 Si el comodín es un Joker, ¿puede unirse a dos doses para formar un grupo de doses? [2, 2, Joker]
  if (wildcard.rank === 'Joker') {
    const twosInHand = hand.filter(c => c.id !== wildcard.id && c.rank === '2');
    if (twosInHand.length >= 2) {
      const candidate = [twosInHand[0], twosInHand[1], wildcard];
      if (validateMeld(candidate).valid) {
        return true;
      }
    }
  }

  // 2. ¿Puede formar una nueva escalera (secuencia del mismo palo)?
  const suits = ['H', 'D', 'C', 'S'];
  for (let s of suits) {
    const slots = getSuitCardSlots(hand.filter(c => c.id !== wildcard.id), s);
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const s1 = slots[i];
        const s2 = slots[j];
        if (s1.card.id === s2.card.id) continue;
        const diff = Math.abs(s1.slot - s2.slot);
        if (diff === 1 || diff === 2) {
          // Prohibido dos doses
          if (wildcard.rank === '2' && (s1.card.rank === '2' || s2.card.rank === '2')) continue;
          if (s1.card.rank === '2' && s2.card.rank === '2') continue;
          const candidate = [s1.card, s2.card, wildcard];
          if (validateMeld(candidate).valid) {
            return true;
          }
        }
      }
    }
  }

  return false;
}

// HELPER: Evalúa si la primera carta robada del mazo le sirve a la IA cuando sale de "mano"
function isCardUsefulForFirstTurn(card, handWithoutCard) {
  if (!card) return false;

  // 1. Un comodín (2 o Joker) SIEMPRE sirve y se conserva
  if (card.rank === '2' || card.rank === 'Joker') return true;

  // 2. ¿Forma o completa algún juego nuevo (secuencia o grupo de 3+) junto con cartas de la mano?
  const fullHand = [...handWithoutCard, card];
  if (canNaturalCardFormIndependentMeldInHand(card, fullHand)) {
    return true;
  }

  for (let i = 0; i < handWithoutCard.length; i++) {
    for (let j = i + 1; j < handWithoutCard.length; j++) {
      if (validateMeld([handWithoutCard[i], handWithoutCard[j], card]).valid) {
        return true;
      }
    }
  }

  // 3. Si NO es comodín y NO completa un juego de 3 cartas de inmediato:
  // En Buraco, conservar una carta que no hace juego es un error porque desperdicia
  // "el truco de la mano": la oportunidad gratuita de descartar esa primera carta al pozo
  // y robar otra nueva del mazo con alta probabilidad de sacar comodín (2 o Joker) o completar un juego real.
  return false;
}

// HELPER: Comprueba si una carta natural (no comodín) puede formar un juego nuevo independiente (secuencia de 3+ o trío) con cartas de la mano
function canNaturalCardFormIndependentMeldInHand(card, hand) {
  if (!card || card.rank === '2' || card.rank === 'Joker') return false;

  // 1. ¿Puede formar una secuencia limpia de 3+ cartas de su mismo palo en mano?
  const slots = getSuitCardSlots(hand, card.suit);
  const cardSlots = slots.filter(s => s.card.id === card.id).map(s => s.slot);
  for (const cSlot of cardSlots) {
    for (let len = 3; len <= 14; len++) {
      for (let start = Math.max(1, cSlot - len + 1); start <= Math.min(15 - len, cSlot); start++) {
        let allPresent = true;
        for (let step = 0; step < len; step++) {
          const requiredSlot = start + step;
          if (!slots.some(s => s.slot === requiredSlot)) {
            allPresent = false;
            break;
          }
        }
        if (allPresent) {
          const runCards = [];
          for (let step = 0; step < len; step++) {
            const requiredSlot = start + step;
            const match = slots.find(s => s.slot === requiredSlot && !runCards.some(rc => rc.id === s.card.id));
            if (match) runCards.push(match.card);
          }
          if (runCards.length >= 3 && runCards.some(rc => rc.id === card.id)) {
            if (validateMeld(runCards).valid) return true;
          }
        }
      }
    }
  }

  // 2. ¿Puede formar una secuencia sucia de 3 cartas usando un comodín de la mano?
  const wildcards = hand.filter(c => c.rank === '2' || c.rank === 'Joker');
  if (wildcards.length > 0) {
    for (const cSlot of cardSlots) {
      for (const otherSlot of slots) {
        if (otherSlot.card.id === card.id) continue;
        const diff = Math.abs(cSlot - otherSlot.slot);
        if (diff === 1 || diff === 2) {
          const candidate = [card, otherSlot.card, wildcards[0]];
          if (validateMeld(candidate).valid) return true;
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

  // 2. Simular nuevas secuencias limpias (reconociendo As alto y 2 natural)
  const suits = ['H', 'D', 'C', 'S'];
  for (let suit of suits) {
    const { foundRuns, remainingHand } = extractCleanRunsForSuit(tempHand, suit);
    foundRuns.forEach(run => {
      if (run.length >= 10) {
        const canastaPart = run.slice(run.length - 7);
        const remainderPart = run.slice(0, run.length - 7);
        const resC = validateMeld(canastaPart);
        const resR = validateMeld(remainderPart);
        if (resC.valid && resR.valid) {
          tempMelds.push(resC.cards);
          tempMelds.push(resR.cards);
          cardsPlayed += run.length;
        }
      } else if (run.length >= 3) {
        const result = validateMeld(run);
        if (result.valid) {
          tempMelds.push(result.cards);
          cardsPlayed += run.length;
        }
      }
    });
    tempHand = remainingHand;
  }

  // 3. Simular nuevas secuencias sucias usando comodines (priorizadas por puntos)
  while (true) {
    const dirtyCands = findDirtyRunsCandidates(tempHand);
    if (dirtyCands.length === 0) break;
    const best = dirtyCands[0];
    tempMelds.push(best.validated);
    cardsPlayed += 3;
    best.cards.forEach(rc => {
      const idx = tempHand.findIndex(c => c.id === rc.id);
      if (idx !== -1) tempHand.splice(idx, 1);
    });
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

  // 4.1 Simular nuevos grupos de doses ("tres dos" o "dos doses y un Joker")
  const twosInTemp = tempHand.filter(c => c.rank === '2');
  if (twosInTemp.length >= 3) {
    const candidateTwos = twosInTemp.slice(0, 3);
    const result = validateMeld(candidateTwos);
    if (result.valid) {
      tempMelds.push(result.cards);
      cardsPlayed += 3;
      candidateTwos.forEach(rc => {
        const idx = tempHand.findIndex(c => c.id === rc.id);
        if (idx !== -1) tempHand.splice(idx, 1);
      });
    }
  } else if (twosInTemp.length === 2 && tempHand.some(c => c.rank === 'Joker')) {
    const jokerCard = tempHand.find(c => c.rank === 'Joker');
    const candidateTwos = [twosInTemp[0], twosInTemp[1], jokerCard];
    const result = validateMeld(candidateTwos);
    if (result.valid) {
      tempMelds.push(result.cards);
      cardsPlayed += 3;
      candidateTwos.forEach(rc => {
        const idx = tempHand.findIndex(c => c.id === rc.id);
        if (idx !== -1) tempHand.splice(idx, 1);
      });
    }
  }

  // 5. Simular nuevos grupos sucios usando comodines
  let wildcards = tempHand.filter(c => c.rank === '2' || c.rank === 'Joker');
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
  const isAlreadyMelded = botMelds.length > 0;

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

        // PROTECCIÓN DE CANASTA LIMPIA EN CURSO (4, 5 o 6 cartas naturales):
        // No ensuciar un juego natural limpio de 4 a 6 cartas con un comodín
        // a menos que sea para cerrar la partida, ir al muerto directo, o defensa extrema ante corte rival
        const isCleanRunBuilding = currentMeld.length >= 4 && !currentMeld.some(c => c && c.isUsedAsWildcard);
        const isEmergencyOrClosing = canWinThisTurn || canTakeMortoThisTurn || opponentImminentWin || isDefensiveSurvivalMode || deckCount <= 8;
        if (isCleanRunBuilding && !isEmergencyOrClosing) {
          continue; // Preservar los 200 puntos potenciales de la canasta limpia
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
  // UMBRAL ESTRATÉGICO DE LOS 30 PUNTOS:
  // Si la IA aún no tiene juegos en mesa (botMeldPoints === 0):
  // Para desbloquear el pozo en Buraco se requieren obligatoriamente 30 puntos en mesa.
  // Si la suma de todas las combinaciones posibles en mano NO alcanza 30 puntos (sim.points < 30),
  // retener las cartas en mano en juego normal en lugar de quemar un trío o corrida aislada de 15 puntos
  // que dejaría el pozo bloqueado y expondría cartas ante el rival.
  const canReach30ThisTurn = (botMeldPoints + sim.points) >= 30;
  if (!isAlreadyMelded && !canReach30ThisTurn && !opponentImminentWin && !isDefensiveSurvivalMode && deckCount > 15) {
    return false; // Retención táctica: esperar a acumular los 30 puntos para abrir el pozo
  }

  const suits = ['H', 'D', 'C', 'S'];
  const allCleanRuns = [];
  for (let suit of suits) {
    const { foundRuns } = extractCleanRunsForSuit(botHand, suit);
    for (const run of foundRuns) {
      const runPoints = run.reduce((sum, c) => sum + (CARD_VALUES[c.rank] || 0), 0);
      allCleanRuns.push({ run, points: runPoints, length: run.length });
    }
  }

  // Ordenar secuencias limpias:
  // 1. Canastas completas (>= 7 cartas) primero
  // 2. Mayor longitud primero
  // 3. Mayor puntuación primero (ej. 10-J-Q-K antes que 3-4-5-6 para alcanzar los 30 pts)
  allCleanRuns.sort((a, b) => {
    if (a.length >= 7 && b.length < 7) return -1;
    if (b.length >= 7 && a.length < 7) return 1;
    if (b.length !== a.length) return b.length - a.length;
    return b.points - a.points;
  });

  for (const item of allCleanRuns) {
    const run = item.run;
    if (run.length >= 10) {
      const canastaCards = run.slice(run.length - 7);
      if (tryMeldBotRun(canastaCards, botIdx, true)) return true;
    } else if (run.length >= 3) {
      // Bajar toda secuencia limpia de 3 o más cartas (suma puntos limpios y descarga la mano)
      if (tryMeldBotRun(run, botIdx, true)) return true;
    }
  }

  // Secuencias usando comodín (ordenadas por puntaje descendente)
  const dirtyCandidates = findDirtyRunsCandidates(botHand);
  const totalWildcardsInHand = botHand.filter(c => c.rank === '2' || c.rank === 'Joker').length;
  for (const candidate of dirtyCandidates) {
    // CONSERVACIÓN ESTRATÉGICA DE COMODINES:
    // Evitar quemar comodines en carreras sucias de 3 cartas si solo tenemos 1 comodín en mano,
    // a menos que:
    // 1. Tengamos 2 o más comodines en mano (hay excedente).
    // 2. Nos permita alcanzar los 30 puntos para desbloquear un pozo valioso (>= 3 cartas o con comodines).
    // 3. Nos lleve al muerto (directo o indirecto) o cierre de partida.
    // 4. Modo defensivo o mazo bajo (<= 12 cartas).
    const candidatePoints = candidate.cards.reduce((sum, c) => sum + (CARD_VALUES[c.rank] || 0), 0);
    const reaches30 = (botMeldPoints < 30) && (botMeldPoints + candidatePoints >= 30);
    const pozoIsValuable = gameState.discardPile.length >= 3 || gameState.discardPile.some(c => c.rank === '2' || c.rank === 'Joker');

    const allowDirtyRun = 
      totalWildcardsInHand >= 2 ||
      (reaches30 && pozoIsValuable) ||
      canTakeMortoThisTurn ||
      isCloseToMorto ||
      canWinThisTurn ||
      isDefensiveSurvivalMode ||
      opponentImminentWin ||
      deckCount <= 12;

    if (!allowDirtyRun) {
      continue;
    }

    if (tryMeldBotRun(candidate.cards, botIdx, true)) return true;
  }

  // Grupos
  const rankGroups = {};
  botHand.forEach(card => {
    if (card.rank !== '2' && card.rank !== 'Joker') {
      if (!rankGroups[card.rank]) rankGroups[card.rank] = [];
      rankGroups[card.rank].push(card);
    }
  });
  const freshWildcards = botHand.filter(c => c.rank === '2' || c.rank === 'Joker');
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

        const cardVal = BOT_RANK_ORDER[card.rank] || 0;
        // Vecino directo a distancia 1 (ej. 7 y 8 de trébol)
        const hasDirectNeighborInHand = botHand.some(c => 
          c.id !== card.id && 
          c.suit === card.suit && 
          c.rank !== '2' && 
          c.rank !== 'Joker' && 
          Math.abs((BOT_RANK_ORDER[c.rank] || 0) - cardVal) === 1
        );

        // Conecta directamente con una escalera propia ya bajada en mesa de ese mismo palo
        const connectsToTableRun = botMelds.some(m => {
          if (m.length > 0 && m[0].suit === card.suit) {
            const rankVals = m.map(mc => BOT_RANK_ORDER[mc.representedRank || mc.rank]).filter(Boolean);
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
      const candPoints = candidate.reduce((sum, c) => sum + (CARD_VALUES[c.rank] || 0), 0);
      const reaches30 = (botMeldPoints < 30) && (botMeldPoints + candPoints >= 30);
      const pozoIsValuable = gameState.discardPile.length >= 3 || gameState.discardPile.some(c => c.rank === '2' || c.rank === 'Joker');

      const allowDirtyGroup = 
        freshWildcards.length >= 2 ||
        (reaches30 && pozoIsValuable) ||
        canTakeMortoThisTurn ||
        isCloseToMorto ||
        canWinThisTurn ||
        isDefensiveSurvivalMode ||
        opponentImminentWin ||
        deckCount <= 12;

      if (allowDirtyGroup) {
        if (tryMeldBotRun(candidate, botIdx, true)) return true;
      }
    }
  }

  // Grupos de tres doses ("tres dos") o dos doses y un Joker ("dos cartas número dos y un joker")
  const twosInBotHand = botHand.filter(c => c.rank === '2');
  if (twosInBotHand.length >= 3) {
    const candidateTwos = twosInBotHand.slice(0, 3);
    if (tryMeldBotRun(candidateTwos, botIdx, true)) return true;
  } else if (twosInBotHand.length === 2 && botHand.some(c => c.rank === 'Joker')) {
    const jokerCard = botHand.find(c => c.rank === 'Joker');
    const candidateTwos = [twosInBotHand[0], twosInBotHand[1], jokerCard];
    if (tryMeldBotRun(candidateTwos, botIdx, true)) return true;
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

  const mem = getAIMemory(room);
  const tracker = getCardTracker(gameState, botIdx, mem);

  const nextPlayerIdx = gameState.is4Player ? (botIdx + 1) % 4 : (botIdx === 0 ? 1 : 0);
  const nextPlayerTeamIdx = getTeamOwnerIndex(nextPlayerIdx, gameState.is4Player);
  const nextPlayerBlocked = gameState.is4Player && gameState.mortosTaken[nextPlayerTeamIdx] === nextPlayerIdx;

  const nextOpponentKnownCards = (mem.knownOpponentHands && mem.knownOpponentHands[nextPlayerIdx]) ? mem.knownOpponentHands[nextPlayerIdx] : [];
  const opponentPlayer = gameState.players[opponentTeamIdx];
  const oppDiscards = Array.isArray(mem.discardHistory)
    ? mem.discardHistory.filter(d => d.playerIdx === opponentTeamIdx || (gameState.is4Player && (d.playerIdx === nextPlayerIdx || d.playerIdx === (nextPlayerIdx + 2) % 4)))
    : [];

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

    // EVALUACIÓN DE PELIGRO CONTRA LA MANO CONOCIDA, DESCARTES PREVIOS Y MESA DEL RIVAL
    const danger = evaluateDiscardDangerAgainstOpponent(
      card,
      nextOpponentKnownCards,
      opponentMelds,
      tracker,
      opponentHandSize,
      oppDiscards
    );

    // COHERENCIA TÁCTICA: NUNCA descartar en el mismo turno una carta recién levantada del pozo
    const lastPickedSet = (room && room.lastPickedDiscardCardIds) || (gameState && gameState.lastPickedDiscardCardIds);
    let justPickedPenalty = 0;
    if (lastPickedSet && lastPickedSet.has(card.id)) {
      const nonPickedCards = botHand.filter(c => !lastPickedSet.has(c.id));
      if (nonPickedCards.length > 0) {
        justPickedPenalty = 50000;
      }
    }

    let score = 0;

    if (isDefensiveSurvivalMode || opponentImminentWin) {
      // EN MODO SUPERVIVENCIA DEFENSIVA / INMINENTE CIERRE RIVAL:
      // Entre las cartas seguras, descartar la de mayor puntaje para minimizar penalización en mano
      score = -CARD_VALUES[card.rank] + danger.dangerScore + justPickedPenalty;
    } else {
      // EN JUEGO NORMAL:
      let botRetention = justPickedPenalty;

      // 1. Si la carta forma parte de un juego completo e independiente en mano (secuencia 3+ o trío):
      // ¡RETENCIÓN MÁXIMA! Jamás romper ni descartar un juego completo que ya tenemos en mano
      if (canNaturalCardFormIndependentMeldInHand(card, botHand)) {
        botRetention += 250000;
      }

      // 2. Si la carta acopla directamente a un juego ya bajado en mesa:
      let servesDirectAppend = false;
      botMelds.forEach(m => {
        if (validateMeld([...m, card]).valid) servesDirectAppend = true;
      });
      if (servesDirectAppend) {
        botRetention += 250000;
      }

      // 3. Conexión directa con los extremos de secuencias propias en mesa (a 1 o 2 de distancia):
      let connectsToMyMelds = 0;
      botMelds.forEach(m => {
        if (m.length > 0 && m[0].suit === card.suit) {
          const rankVals = m.map(mc => RANK_ORDER_VALS[mc.representedRank || mc.rank]).filter(Boolean);
          if (rankVals.length > 0) {
            const minVal = Math.min(...rankVals);
            const maxVal = Math.max(...rankVals);
            const cardVal = RANK_ORDER_VALS[card.rank] || 0;
            if (Math.abs(cardVal - minVal) <= 2 || Math.abs(cardVal - maxVal) <= 2) {
              connectsToMyMelds++;
            }
          }
        }
      });
      botRetention += connectsToMyMelds * 50000;

      // 4. Conexiones en mano propia (vecinos directos, parejas y conectores con hueco):
      const connDetail = getCardHandConnections(card, botHand);
      botRetention += connDetail.directNeighbor * 130000;
      botRetention += connDetail.sameRank * 130000;
      botRetention += connDetail.gapConnector * 85000;

      // 5. Duplicados exactos en mano:
      const duplicates = botHand.filter(c => c.rank === card.rank && c.suit === card.suit && c.id !== card.id).length;
      if (duplicates > 0) {
        botRetention -= 70000;
      }

      // 6. Carta irrecuperable (última copia en todo el juego/mazo):
      if (tracker && tracker.getRemainingCount(card.suit, card.rank) === 0) {
        if (connDetail.total > 0 || connectsToMyMelds > 0) {
          // Si nos sirve para un juego o conecta con nuestra mano, ¡es insustituible!
          botRetention += 40000;
        }
      }

      // 7. Densidad de palo y valor facial
      const sameSuitCount = botHand.filter(c => c.suit === card.suit).length;
      botRetention += sameSuitCount * 100;
      botRetention += (CARD_VALUES[card.rank] || 5);

      // REGLA DE BLOQUEO DEL MUERTO EN 4 JUGADORES:
      if (nextPlayerBlocked) {
        score = botRetention;
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
      } else {
        score = botRetention + danger.dangerScore;
      }
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

      const oppHandCount = opponentPlayer?.hand?.length || 0;
      const oppEstimatedHandPenalty = oppHandCount * 12 + (!opponentHasMorto ? 100 : 0);
      const myEstTotal = myMeldPoints + myCleanCount * 200 + myDirtyCount * 100 + 100;
      const oppEstTotal = Math.max(0, oppMeldPoints + oppCleanCount * 200 + oppDirtyCount * 100 - oppEstimatedHandPenalty);
      const netDiff = myEstTotal - oppEstTotal;

      // Solo postergar si la diferencia estimada es rotundamente perjudicial (menos de -150) y aún queda mucho mazo (> 15 cartas)
      if (netDiff < -150 && deckCount > 15) {
        shouldWin = false;
      }
    }
  }

  const hasTakenMorto = gameState.is4Player ? (gameState.mortosTaken[teamIdx] !== null) : gameState.mortosTaken[botIdx];
  const canastrasCount = botMelds.filter(m => m.length >= 7).length;
  const requiredCanastras = gameState.requiredCanastras || 1;

  // Batida final (cierre con descarte): Solo si le queda 1 carta, tiene muerto, tiene las canastas requeridas Y decide ganar
  if (botHand.length === 1 && hasTakenMorto && canastrasCount >= requiredCanastras && shouldWin) {
    if (room) room.lastPickedDiscardCardIds = null;
    gameState.lastPickedDiscardCardIds = null;
    botHand.splice(discardIdx, 1);
    recordDiscardCard(room, botIdx, cardToDiscard);
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
  }

  // EN TODOS LOS DEMÁS CASOS: DESCARTAR OBLIGATORIAMENTE AL POZO
  if (room) room.lastPickedDiscardCardIds = null;
  gameState.lastPickedDiscardCardIds = null;
  botHand.splice(discardIdx, 1);
  recordDiscardCard(room, botIdx, cardToDiscard);
  gameState.discardPile.push(cardToDiscard);
  gameState.lastAction = `${botPlayer.name} descartó ${cardToDiscard.rank} de ${cardToDiscard.suit}.`;
  checkMortoIndirect(botIdx);

  // Pasar turno al siguiente jugador (respetando sentido antihorario)
  const nextTurn = gameState.is4Player ? (botIdx + 1) % 4 : (botIdx === 0 ? 1 : 0);
  room.isBotThinking = false;
  startPlayerTurn(nextTurn);

  sendStateToAll();

}

// HELPER: Conexiones de cartas en la mano para la IA (escaleras y triadas)
function getConnectionsCount(card, hand) {
  if (!card || card.rank === 'Joker' || card.rank === '2') return 0;
  
  let connects = 0;
  const cardSlots = (card.rank === 'A') ? [1, 14] : [BOT_RANK_ORDER[card.rank] || 0];

  hand.forEach(c => {
    if (c.id !== card.id && c.rank !== 'Joker' && c.rank !== '2') {
      // 1. Conexión de escalera (mismo palo, distancia <= 2)
      if (c.suit === card.suit) {
        const otherSlots = (c.rank === 'A') ? [1, 14] : [BOT_RANK_ORDER[c.rank] || 0];
        let hasConn = false;
        for (const s1 of cardSlots) {
          for (const s2 of otherSlots) {
            if (Math.abs(s1 - s2) <= 2) {
              hasConn = true;
              break;
            }
          }
          if (hasConn) break;
        }
        if (hasConn) {
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

// HELPER: Conexiones detalladas en la mano (vecino directo distancia 1, conector con hueco distancia 2, y misma categoría)
function getCardHandConnections(card, hand) {
  if (!card || card.rank === 'Joker' || card.rank === '2') {
    return { directNeighbor: 0, gapConnector: 0, sameRank: 0, total: 0 };
  }

  let directNeighbor = 0;
  let gapConnector = 0;
  let sameRank = 0;

  const cardSlots = (card.rank === 'A') ? [1, 14] : [BOT_RANK_ORDER[card.rank] || 0];

  hand.forEach(c => {
    if (c.id !== card.id && c.rank !== 'Joker' && c.rank !== '2') {
      if (c.rank === card.rank) {
        sameRank++;
      }
      if (c.suit === card.suit) {
        const otherSlots = (c.rank === 'A') ? [1, 14] : [BOT_RANK_ORDER[c.rank] || 0];
        let minDist = 999;
        for (const s1 of cardSlots) {
          for (const s2 of otherSlots) {
            const d = Math.abs(s1 - s2);
            if (d < minDist) minDist = d;
          }
        }
        if (minDist === 1) {
          directNeighbor++;
        } else if (minDist === 2) {
          gapConnector++;
        }
      }
    }
  });

  return { directNeighbor, gapConnector, sameRank, total: directNeighbor + gapConnector + sameRank };
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

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    console.log('-----------------------------------------------------');
    console.log('Servidor de Buraco Multi-Sala ejecutándose en:');
    console.log(`- Local: http://localhost:${PORT}`);
    console.log(`- Red Local: http://${LOCAL_IP}:${PORT}`);
    console.log('-----------------------------------------------------');
  });
}

module.exports = {
  server,
  io,
  evaluateDiscardDangerAgainstOpponent,
  evaluatePilePotential,
  simulateBotMelding,
  performOneBotMeldActionInRoom,
  runBotDiscardPhaseInRoom,
  tryMeldBotRunInRoom,
  runBotTurnInRoom,
  canWildcardFormNewMeldInHand,
  canNaturalCardFormIndependentMeldInHand,
  isCardUsefulForFirstTurn,
  getConnectionsCount,
  getCardHandConnections,
  validateMeld
};
