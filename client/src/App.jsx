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
  const [showDevModal, setShowDevModal] = useState(false);
  const [devPasswordInput, setDevPasswordInput] = useState('');
  const [devErrorMsg, setDevErrorMsg] = useState('');
  const [devSuccessMsg, setDevSuccessMsg] = useState('');
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const [showSimulateConfirm, setShowSimulateConfirm] = useState(false);
  const [showExitGameConfirm, setShowExitGameConfirm] = useState(false);

  const handleRoomChange = (newRoomId) => {
    setCurrentRoomId(newRoomId);
    if (socket && socket.connected) {
      socket.emit('get-lobby-info', { roomId: newRoomId });
    }
  };

  const handleToggleDevAuth = () => {
    if (isDevAuthorized) {
      setShowExitConfirm(true);
    } else {
      setDevPasswordInput('');
      setDevErrorMsg('');
      setDevSuccessMsg('');
      setShowDevModal(true);
    }
  };

  const handleDevSubmit = (e) => {
    if (e) e.preventDefault();
    if (devPasswordInput === 'lom@lind@') {
      sessionStorage.setItem('buraco_dev_auth', 'true');
      localStorage.setItem('buraco_dev_mode', 'true');
      setIsDevAuthorized(true);
      setDevSuccessMsg('✅ Modo Desarrollador activado con éxito.');
      setTimeout(() => {
        setShowDevModal(false);
        setDevSuccessMsg('');
        setDevPasswordInput('');
      }, 700);
    } else {
      setDevErrorMsg('❌ Clave incorrecta. Intenta nuevamente.');
    }
  };

  const handleConfirmExitDev = () => {
    sessionStorage.removeItem('buraco_dev_auth');
    localStorage.removeItem('buraco_dev_mode');
    setIsDevAuthorized(false);
    setShowExitConfirm(false);
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
    const handleConnect = () => {
      setConnected(true);
      console.log('Conectado al servidor de sockets');

      // Si el jugador estaba en una mesa o partida activa, reconectar automáticamente
      const inGame = sessionStorage.getItem('buraco_in_game') === 'true';
      const storedName = playerName || localStorage.getItem('buraco_player_name');
      const storedRoom = currentRoomId || localStorage.getItem('buraco_room') || 'mesa-1';

      if (inGame && storedName) {
        console.log(`Reconectando automáticamente a ${storedRoom} como ${storedName}...`);
        socket.emit('join-lobby', { 
          name: storedName, 
          requiredCanastras: selectedCanastras, 
          isAgainstBot: isAgainstBotSetting, 
          targetScore: selectedTargetScore, 
          is4Player: is4PlayerSetting,
          roomId: storedRoom
        });
      }
    };

    const handleDisconnect = () => {
      setConnected(false);
      // ¡IMPORTANTE! NO destruir gameState ni resetear joined aquí para no expulsar al usuario al Lobby en cortes transitorios.
      console.log('Desconexión temporal del servidor de sockets. Esperando reconexión...');
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);

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
        try {
          localStorage.setItem('buraco_room', roomId);
        } catch (e) {}
      }
      setJoined(true);
      sessionStorage.setItem('buraco_in_game', 'true');
    });

    // Errores del juego (movimiento inválido, etc.)
    socket.on('error-message', (msg) => {
      setErrorMessage(msg);
      // Si la sala está ocupada o llena para un usuario que aún no estaba en partida
      if (sessionStorage.getItem('buraco_in_game') !== 'true') {
        setJoined(false);
      }
    });

    // Escuchar si la partida fue abortada por otro jugador
    socket.on('game-aborted', (msg) => {
      sessionStorage.removeItem('buraco_in_game');
      setGameState(null);
      setJoined(false);
      setErrorMessage(msg);
    });

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
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
    sessionStorage.setItem('buraco_in_game', 'true');
    try {
      localStorage.setItem('buraco_room', roomId);
      localStorage.setItem('buraco_player_name', name);
    } catch (e) {}
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
                    onClick={() => setShowSimulateConfirm(true)}
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
                  onClick={() => setShowExitGameConfirm(true)}
                  style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                  <LogOut size={14} /> Salir
                </button>
              </>
            )}
          </div>
        </header>
      )}

      {/* Indicador de reconexión si se pierde conexión momentáneamente durante la partida */}
      {gameState && !connected && (
        <div 
          className="glass-panel"
          style={{
            position: 'fixed',
            bottom: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9999,
            padding: '10px 20px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            backgroundColor: 'rgba(245, 158, 11, 0.25)',
            borderColor: 'rgba(245, 158, 11, 0.5)',
            color: '#fbbf24',
            fontWeight: 600,
            borderRadius: '10px',
            boxShadow: '0 8px 20px rgba(0, 0, 0, 0.5)',
            fontSize: '0.9rem'
          }}
        >
          <span>⚡</span>
          <span>Reconectando con el servidor... Conservando tu partida.</span>
        </div>
      )}

      {/* MODAL 1: Ingreso de Clave de Desarrollador (Sin window.prompt ni bloqueos) */}
      {showDevModal && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(6px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 10000
        }}>
          <div className="glass-panel" style={{
            width: '90%',
            maxWidth: '420px',
            padding: '24px',
            borderRadius: '16px',
            background: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid rgba(56, 189, 248, 0.3)',
            boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '2rem', marginBottom: '8px' }}>🔑</div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#f8fafc', marginBottom: '8px' }}>
              Modo Desarrollador
            </h2>
            <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '20px', lineHeight: 1.4 }}>
              Ingresa la clave de acceso para activar las herramientas de depuración y ver las cartas de la IA en tiempo real.
            </p>

            <form onSubmit={handleDevSubmit}>
              <input 
                type="password"
                autoFocus
                placeholder="Ingresa la contraseña..."
                value={devPasswordInput}
                onChange={(e) => {
                  setDevPasswordInput(e.target.value);
                  setDevErrorMsg('');
                }}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  borderRadius: '10px',
                  background: 'rgba(30, 41, 59, 0.9)',
                  border: devErrorMsg ? '1px solid #ef4444' : '1px solid rgba(255,255,255,0.15)',
                  color: '#fff',
                  fontSize: '1rem',
                  outline: 'none',
                  boxSizing: 'border-box',
                  marginBottom: '12px'
                }}
              />

              {devErrorMsg && (
                <div style={{ color: '#ef4444', fontSize: '0.82rem', marginBottom: '14px', fontWeight: 600 }}>
                  {devErrorMsg}
                </div>
              )}
              {devSuccessMsg && (
                <div style={{ color: '#10b981', fontSize: '0.82rem', marginBottom: '14px', fontWeight: 600 }}>
                  {devSuccessMsg}
                </div>
              )}

              <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => {
                    setShowDevModal(false);
                    setDevErrorMsg('');
                    setDevPasswordInput('');
                  }}
                  style={{
                    padding: '10px 18px',
                    borderRadius: '8px',
                    background: 'rgba(255,255,255,0.08)',
                    border: '1px solid rgba(255,255,255,0.15)',
                    color: '#cbd5e1',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  style={{
                    padding: '10px 22px',
                    borderRadius: '8px',
                    background: 'linear-gradient(135deg, #0ea5e9, #0284c7)',
                    border: 'none',
                    color: '#fff',
                    fontWeight: 700,
                    cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(14, 165, 233, 0.3)'
                  }}
                >
                  Desbloquear
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Confirmar Salida de Modo Desarrollador */}
      {showExitConfirm && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(6px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 10000
        }}>
          <div className="glass-panel" style={{
            width: '90%',
            maxWidth: '400px',
            padding: '24px',
            borderRadius: '16px',
            background: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid rgba(255, 255, 255, 0.15)',
            boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '2rem', marginBottom: '8px' }}>🔒</div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#f8fafc', marginBottom: '8px' }}>
              ¿Salir de Modo Desarrollador?
            </h2>
            <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '20px' }}>
              Las cartas de la IA volverán a ocultarse y se regresará al modo de producción normal.
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button
                type="button"
                onClick={() => setShowExitConfirm(false)}
                style={{
                  padding: '10px 18px',
                  borderRadius: '8px',
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  color: '#cbd5e1',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Mantener Activo
              </button>
              <button
                type="button"
                onClick={handleConfirmExitDev}
                style={{
                  padding: '10px 20px',
                  borderRadius: '8px',
                  background: '#ef4444',
                  border: 'none',
                  color: '#fff',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Salir a Producción
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Confirmar Simulación de Corte */}
      {showSimulateConfirm && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(6px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 10000
        }}>
          <div className="glass-panel" style={{
            width: '90%',
            maxWidth: '400px',
            padding: '24px',
            borderRadius: '16px',
            background: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid rgba(245, 158, 11, 0.4)',
            boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '2rem', marginBottom: '8px' }}>⚡</div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#f8fafc', marginBottom: '8px' }}>
              Simular Batida de Ronda
            </h2>
            <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '20px' }}>
              ¿Quieres simular que el jugador actual bate la ronda para probar la pantalla de corte y cálculo de puntajes?
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button
                type="button"
                onClick={() => setShowSimulateConfirm(false)}
                style={{
                  padding: '10px 18px',
                  borderRadius: '8px',
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  color: '#cbd5e1',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  socket.emit('debug-simulate-batida', { pass: 'lom@lind@' });
                  setShowSimulateConfirm(false);
                }}
                style={{
                  padding: '10px 20px',
                  borderRadius: '8px',
                  background: '#f59e0b',
                  border: 'none',
                  color: '#000',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Simular Corte
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: Confirmar Salida de Partida */}
      {showExitGameConfirm && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(6px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 10000
        }}>
          <div className="glass-panel" style={{
            width: '90%',
            maxWidth: '400px',
            padding: '24px',
            borderRadius: '16px',
            background: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '2rem', marginBottom: '8px' }}>🚪</div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#f8fafc', marginBottom: '8px' }}>
              ¿Abandonar la partida?
            </h2>
            <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '20px' }}>
              Al salir, se cancelará la mesa actual para todos los jugadores.
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button
                type="button"
                onClick={() => setShowExitGameConfirm(false)}
                style={{
                  padding: '10px 18px',
                  borderRadius: '8px',
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  color: '#cbd5e1',
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Quedarme
              </button>
              <button
                type="button"
                onClick={() => {
                  socket.emit('leave-game');
                  sessionStorage.removeItem('buraco_in_game');
                  setShowExitGameConfirm(false);
                  setTimeout(() => {
                    window.location.reload();
                  }, 200);
                }}
                style={{
                  padding: '10px 20px',
                  borderRadius: '8px',
                  background: '#ef4444',
                  border: 'none',
                  color: '#fff',
                  fontWeight: 700,
                  cursor: 'pointer'
                }}
              >
                Sí, Salir
              </button>
            </div>
          </div>
        </div>
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
