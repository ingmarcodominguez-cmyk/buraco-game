// App.jsx
import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import Lobby from './components/Lobby';
import Board from './components/Board';
import './App.css';
import { AlertCircle, LogOut } from 'lucide-react';

// Conectar con Socket.io usando el proxy de Vite en desarrollo
// O al origen actual en producción.
const socket = io();

export default function App() {
  const [connected, setConnected] = useState(false);
  const [localIp, setLocalIp] = useState('');
  const [lobbyPlayers, setLobbyPlayers] = useState([]);
  const [gameState, setGameState] = useState(null);
  const [playerIndex, setPlayerIndex] = useState(null);
  const [playerName, setPlayerName] = useState('');
  const [selectedCanastras, setSelectedCanastras] = useState(1);
  const [isAgainstBotSetting, setIsAgainstBotSetting] = useState(false);
  const [selectedTargetScore, setSelectedTargetScore] = useState(3000);
  const [joined, setJoined] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    socket.on('connect', () => {
      setConnected(true);
      console.log('Conectado al servidor de sockets');
    });

    socket.on('disconnect', () => {
      setConnected(false);
      setGameState(null);
      console.log('Desconectado del servidor de sockets');
    });

    // Información inicial del lobby
    socket.on('lobby-info', ({ localIp, players }) => {
      setLocalIp(localIp);
      setLobbyPlayers(players);
    });

    // Actualizaciones de jugadores conectados en la sala de espera
    socket.on('lobby-update', (players) => {
      setLobbyPlayers(players);
    });

    // Recibir actualizaciones del estado del juego en tiempo real
    socket.on('game-state', ({ gameState, playerIndex, lobbyPlayers }) => {
      setGameState(gameState);
      setPlayerIndex(playerIndex);
      setLobbyPlayers(lobbyPlayers);
      setJoined(true);
    });

    // Errores del juego (movimiento inválido, etc.)
    socket.on('error-message', (msg) => {
      setErrorMessage(msg);
    });

    // Manejar re-conexión automática si ya teníamos un nombre ingresado
    socket.on('reconnect', () => {
      if (playerName) {
        socket.emit('join-lobby', { name: playerName, requiredCanastras: selectedCanastras, isAgainstBot: isAgainstBotSetting, targetScore: selectedTargetScore });
      }
    });

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('lobby-info');
      socket.off('lobby-update');
      socket.off('game-state');
      socket.off('error-message');
    };
  }, [playerName]);

  // Temporizador para desvanecer el mensaje de error/alerta
  useEffect(() => {
    if (errorMessage) {
      const timer = setTimeout(() => {
        setErrorMessage('');
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [errorMessage]);

  const handleJoinLobby = (name, requiredCanastras, playAgainstBot, targetScore) => {
    setPlayerName(name);
    setSelectedCanastras(requiredCanastras);
    setIsAgainstBotSetting(playAgainstBot);
    setSelectedTargetScore(targetScore);
    setJoined(true);
    socket.emit('join-lobby', { name, requiredCanastras, isAgainstBot: playAgainstBot, targetScore });
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

      {/* Encabezado general */}
      <header className="game-header">
        <h1 className="game-title">
          <span>🃏</span> BURACO MULTIJUGADOR
        </h1>
        {joined && gameState && (
          <div className="header-actions">
            <span style={{ fontSize: '0.85rem', color: '#cbd5e1', alignSelf: 'center', marginRight: '10px' }}>
              Notebook: <span style={{ color: '#10b981', fontWeight: 600 }}>{playerName}</span> (Jugador {playerIndex + 1})
            </span>
            <button 
              className="btn-header" 
              onClick={() => {
                if (window.confirm('¿Quieres salir de la partida actual?')) {
                  window.location.reload();
                }
              }}
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <LogOut size={14} /> Salir
            </button>
          </div>
        )}
      </header>

      {/* Contenido principal: Lobby o Tablero */}
      {!gameState ? (
        <Lobby 
          onJoin={handleJoinLobby}
          localIp={localIp}
          players={lobbyPlayers}
          connected={connected}
        />
      ) : (
        <Board 
          gameState={gameState}
          playerIndex={playerIndex}
          lobbyPlayers={lobbyPlayers}
          onAction={handleGameAction}
        />
      )}
    </div>
  );
}
