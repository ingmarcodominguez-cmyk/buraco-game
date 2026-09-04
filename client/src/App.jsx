// App.jsx
import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import Lobby from './components/Lobby';
import Board from './components/Board';
import './App.css';
import { AlertCircle, LogOut, Maximize, Minimize } from 'lucide-react';

// Conectar con Socket.io usando el proxy de Vite en desarrollo
// O al origen actual en producción.
const socket = io();

export default function App() {
  const [connected, setConnected] = useState(false);
  const [localIp, setLocalIp] = useState('');
  const [lobbyPlayers, setLobbyPlayers] = useState([]);
  const [gameState, setGameState] = useState(null);
  const [playerIndex, setPlayerIndex] = useState(null);
  const [playerName, setPlayerName] = useState(() => {
    try {
      return localStorage.getItem('buraco_player_name') || '';
    } catch (e) {
      return '';
    }
  });
  const [selectedCanastras, setSelectedCanastras] = useState(1);
  const [isAgainstBotSetting, setIsAgainstBotSetting] = useState(false);
  const [selectedTargetScore, setSelectedTargetScore] = useState(3000);
  const [is4PlayerSetting, setIs4PlayerSetting] = useState(false);
  const [currentRoomId, setCurrentRoomId] = useState(() => {
    try {
      return localStorage.getItem('buraco_room') || 'mesa-1';
    } catch (e) {
      return 'mesa-1';
    }
  });
  const [roomsSummary, setRoomsSummary] = useState({});
  const [joined, setJoined] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDevAuthorized, setIsDevAuthorized] = useState(() => sessionStorage.getItem('buraco_dev_auth') === 'true');

  const handleRoomChange = (newRoomId) => {
    setCurrentRoomId(newRoomId);
    if (socket && socket.connected) {
      socket.emit('get-lobby-info', { roomId: newRoomId });
    }
  };

  const handleToggleDevAuth = () => {
    if (isDevAuthorized) {
      if (window.confirm('¿Deseas salir del Modo Desarrollador y volver al Modo Producción?')) {
        sessionStorage.removeItem('buraco_dev_auth');
        localStorage.removeItem('buraco_dev_mode');
        setIsDevAuthorized(false);
      }
    } else {
      const inputPass = window.prompt('Ingresa la clave de desarrollador para activar las herramientas de depuración:');
      if (inputPass === null) return;
      if (inputPass === 'lom@lind@') {
        sessionStorage.setItem('buraco_dev_auth', 'true');
        localStorage.setItem('buraco_dev_mode', 'true');
        setIsDevAuthorized(true);
        alert('✅ Modo Desarrollador activado. Las cartas de la IA ahora son visibles en tiempo real.');
      } else {
        alert('❌ Clave incorrecta. Permaneciendo en modo producción.');
      }
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!(document.fullscreenElement || document.webkitFullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = () => {
    const docEl = document.documentElement;
    const requestFs = docEl.requestFullscreen || docEl.webkitRequestFullscreen || docEl.msRequestFullscreen;
    const exitFs = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;

    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      if (requestFs) {
        requestFs.call(docEl).catch((err) => {
          console.error(`Error attempting to enable fullscreen: ${err.message}`);
        });
      }
    } else {
      if (exitFs) {
        exitFs.call(document);
      }
    }
  };

  useEffect(() => {
    socket.on('connect', () => {
      setConnected(true);
      console.log('Conectado al servidor de sockets');
    });

    socket.on('disconnect', () => {
      setConnected(false);
      setGameState(null);
      setJoined(false);
      setPlayerIndex(null);
      console.log('Desconectado del servidor de sockets');
    });

    // Información inicial del lobby
    socket.on('lobby-info', ({ localIp, players, roomId }) => {
      setLocalIp(localIp);
      setLobbyPlayers(players || []);
      if (roomId && !joined) {
        setCurrentRoomId(roomId);
      }
    });

    // Actualizaciones de jugadores conectados en la sala de espera
    socket.on('lobby-update', (data) => {
      if (data && data.roomId) {
        if (data.roomId === currentRoomId) {
          setLobbyPlayers(data.players || []);
        }
      } else if (Array.isArray(data)) {
        setLobbyPlayers(data);
      }
    });

    // Resumen de estado de todas las mesas
    socket.on('rooms-summary', (summary) => {
      if (summary) {
        setRoomsSummary(summary);
      }
    });

    // Recibir actualizaciones del estado del juego en tiempo real
    socket.on('game-state', ({ gameState, playerIndex, lobbyPlayers, roomId }) => {
      setGameState(gameState);
      setPlayerIndex(playerIndex);
      setLobbyPlayers(lobbyPlayers || []);
      if (roomId) {
        setCurrentRoomId(roomId);
      }
      setJoined(true);
    });

    // Errores del juego (movimiento inválido, etc.)
    socket.on('error-message', (msg) => {
      setErrorMessage(msg);
    });

    // Escuchar si la partida fue abortada por otro jugador
    socket.on('game-aborted', (msg) => {
      alert(msg);
      window.location.reload();
    });

    // Manejar re-conexión automática si ya teníamos un nombre ingresado
    socket.on('reconnect', () => {
      if (playerName) {
        socket.emit('join-lobby', { 
          name: playerName, 
          requiredCanastras: selectedCanastras, 
          isAgainstBot: isAgainstBotSetting, 
          targetScore: selectedTargetScore, 
          is4Player: is4PlayerSetting,
          roomId: currentRoomId
        });
      }
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('lobby-info');
      socket.off('lobby-update');
      socket.off('rooms-summary');
      socket.off('game-state');
      socket.off('error-message');
      socket.off('game-aborted');
    };
  }, [playerName, currentRoomId, selectedCanastras, isAgainstBotSetting, selectedTargetScore, is4PlayerSetting, joined]);

  // Temporizador para desvanecer el mensaje de error/alerta
  useEffect(() => {
    if (errorMessage) {
      const timer = setTimeout(() => {
        setErrorMessage('');
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [errorMessage]);

  const handleJoinLobby = (name, requiredCanastras, playAgainstBot, targetScore, is4Player, roomId = 'mesa-1') => {
    setPlayerName(name);
    setSelectedCanastras(requiredCanastras);
    setIsAgainstBotSetting(playAgainstBot);
    setSelectedTargetScore(targetScore);
    setIs4PlayerSetting(is4Player);
    setCurrentRoomId(roomId);
    setJoined(true);
    socket.emit('join-lobby', { name, requiredCanastras, isAgainstBot: playAgainstBot, targetScore, is4Player, roomId });
  };

  const handleGameAction = (actionName, data = {}) => {
    socket.emit(actionName, data);
  };

  return (
    <div className="app-container">
      {/* Toast Notificación de Error */}
      {errorMessage && (
        <div 
          className="glass-panel"
          style={{
            position: 'fixed',
            top: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9999,
            padding: '12px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            backgroundColor: 'rgba(239, 68, 68, 0.2)',
            borderColor: 'rgba(239, 68, 68, 0.4)',
            color: '#fca5a5',
            fontWeight: 500,
            borderRadius: '10px',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)'
          }}
        >
          <AlertCircle size={18} />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Encabezado general - Solo se muestra dentro del juego */}
      {gameState && (
        <header className="game-header">
          <h1 className="game-title" style={{ margin: 0 }}>
            <span>🃏</span> BURACO MULTIJUGADOR 
            <span style={{ 
              fontSize: '0.8rem', 
              color: '#fbbf24', 
              fontStyle: 'italic', 
              fontWeight: 'normal', 
              marginLeft: '8px',
              letterSpacing: 'normal',
              WebkitTextFillColor: '#fbbf24',
              WebkitBackgroundClip: 'unset',
              background: 'none'
            }}>
              powered by Marco Dominguez
            </span>
          </h1>
          <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button 
              className="btn-header" 
              onClick={toggleFullscreen}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              {isFullscreen ? <Minimize size={14} /> : <Maximize size={14} />} 
              {isFullscreen ? 'Salir Completa' : 'Pantalla Completa'}
            </button>
            
            {/* Acceso discreto para desarrollador: inicia por defecto bloqueado (producción) */}
            <button 
              className="btn-header" 
              onClick={handleToggleDevAuth}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                opacity: isDevAuthorized ? 1 : 0.6,
                background: isDevAuthorized ? 'rgba(14, 165, 233, 0.2)' : 'rgba(255,255,255,0.05)',
                borderColor: isDevAuthorized ? '#38bdf8' : 'rgba(255,255,255,0.15)',
                color: isDevAuthorized ? '#38bdf8' : '#94a3b8',
                fontSize: '0.75rem',
                padding: '4px 8px'
              }}
              title={isDevAuthorized ? "Modo Desarrollador Activo (Clic para volver a Producción)" : "Desbloquear herramientas de desarrollo"}
            >
              {isDevAuthorized ? '🔓 Dev: ON' : '🔒 Dev'}
            </button>

            {joined && (
              <>
                <span style={{ 
                  fontSize: '0.8rem', 
                  padding: '3px 8px', 
                  borderRadius: '6px', 
                  background: 'rgba(56, 189, 248, 0.15)', 
                  border: '1px solid rgba(56, 189, 248, 0.4)', 
                  color: '#38bdf8', 
                  fontWeight: 600,
                  marginRight: '6px'
                }}>
                  🪑 {currentRoomId.toUpperCase()}
                </span>
                <span style={{ fontSize: '0.85rem', color: '#cbd5e1', alignSelf: 'center', marginRight: '10px' }}>
                  Notebook: <span style={{ color: '#10b981', fontWeight: 600 }}>{playerName}</span> (Jugador {playerIndex + 1})
                </span>
                {/* Simular corte: SOLO visible si el modo desarrollador está autorizado con la clave lom@lind@ */}
                {isDevAuthorized && gameState && gameState.status === 'playing' && (
                  <button 
                    className="btn-header" 
                    onClick={() => {
                      if (window.confirm('¿Quieres simular que el jugador actual bate la ronda para probar la pantalla de corte?')) {
                        socket.emit('debug-simulate-batida', { pass: 'lom@lind@' });
                      }
                    }}
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '6px', 
                      background: 'rgba(245, 158, 11, 0.2)', 
                      border: '1px solid rgba(245, 158, 11, 0.5)', 
                      color: '#fbbf24' 
                    }}
                    title="Simular corte instantáneo para verificar el diseño visual de la mesa"
                  >
                    Simular Corte ⚡
                  </button>
                )}
                <button 
                  className="btn-header" 
                  onClick={() => {
                    if (window.confirm('¿Quieres salir de la partida actual? El juego se cancelará para todos.')) {
                      socket.emit('leave-game');
                      setTimeout(() => {
                        window.location.reload();
                      }, 200);
                    }
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <LogOut size={14} /> Salir
                </button>
              </>
            )}
          </div>
        </header>
      )}

      {/* Contenido principal: Lobby o Tablero */}
      {!gameState ? (
        <Lobby 
          onJoin={handleJoinLobby}
          localIp={localIp}
          players={lobbyPlayers}
          connected={connected}
          currentRoomId={currentRoomId}
          onRoomChange={handleRoomChange}
          roomsSummary={roomsSummary}
        />
      ) : (
        <Board 
          gameState={gameState}
          playerIndex={playerIndex}
          lobbyPlayers={lobbyPlayers}
          onAction={handleGameAction}
          isDevAuthorized={isDevAuthorized}
          onToggleDevAuth={handleToggleDevAuth}
        />
      )}
    </div>
  );
}
