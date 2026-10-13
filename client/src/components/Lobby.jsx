// Lobby.jsx
import React, { useState } from 'react';
import { User, Users, Globe, ArrowRight, Award } from 'lucide-react';

export default function Lobby({ 
  onJoin, 
  localIp, 
  players, 
  connected, 
  currentRoomId, 
  onRoomChange, 
  roomsSummary = {}, 
  joined = false, 
  onCancelJoin,
  isAgainstBotSetting,
  is4PlayerSetting
}) {
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem('buraco_player_name') || '';
    } catch (e) {
      return '';
    }
  });
  const [selectedRoomOption, setSelectedRoomOption] = useState(currentRoomId || 'mesa-1');
  const [customRoomName, setCustomRoomName] = useState('');
  const [requiredCanastras, setRequiredCanastras] = useState(1);
  const [targetScore, setTargetScore] = useState(3000);
  const [is4Player, setIs4Player] = useState(false);
  const [joinedMode, setJoinedMode] = useState({
    is4Player: false,
    againstBot: false,
    botMode: '2h2b'
  });

  React.useEffect(() => {
    if (is4PlayerSetting !== undefined || isAgainstBotSetting !== undefined) {
      setJoinedMode(prev => ({
        ...prev,
        is4Player: is4PlayerSetting !== undefined ? is4PlayerSetting : prev.is4Player,
        againstBot: isAgainstBotSetting !== undefined ? isAgainstBotSetting : prev.againstBot
      }));
    }
  }, [is4PlayerSetting, isAgainstBotSetting]);

  const currentRoomInfo = selectedRoomOption !== 'custom' ? roomsSummary[selectedRoomOption] : null;
  const isCurrentOccupied = currentRoomInfo ? currentRoomInfo.isOccupied : false;
  const isReconnecting = Boolean(currentRoomInfo && currentRoomInfo.players && name.trim() && currentRoomInfo.players.some(p => p.toLowerCase() === name.trim().toLowerCase()));

  const handleRoomSelect = (val) => {
    setSelectedRoomOption(val);
    const targetRoom = val === 'custom' ? (customRoomName.trim() || 'mesa-personalizada') : val;
    if (onRoomChange) onRoomChange(targetRoom);
    const info = roomsSummary[val];
    if (info && info.isWaiting) {
      if (info.is4Player !== undefined) setIs4Player(!!info.is4Player);
    }
  };

  const handleCustomRoomChange = (val) => {
    setCustomRoomName(val);
    if (onRoomChange) onRoomChange(val.trim() || 'mesa-personalizada');
  };

  const handleJoin = (againstBot, botMode = '2h2b') => {
    if (!name.trim()) return;
    if (isCurrentOccupied && !isReconnecting) {
      alert(`La ${selectedRoomOption.toUpperCase()} ya está ocupada con una partida en curso. Por favor selecciona otra mesa disponible.`);
      return;
    }
    const finalRoomId = selectedRoomOption === 'custom'
      ? (customRoomName.trim() || 'mesa-personalizada')
      : selectedRoomOption;
    try {
      localStorage.setItem('buraco_player_name', name.trim());
      localStorage.setItem('buraco_room', finalRoomId);
    } catch (err) {}
    setJoinedMode({ is4Player, againstBot, botMode });
    onJoin(name.trim(), requiredCanastras, againstBot, targetScore, is4Player, finalRoomId, botMode);
  };

  return (
    <div className="lobby-container">
      <div className="lobby-card glass-panel">
        <div className="lobby-grid">
          {/* Columna Izquierda: Logo, Info e Instrucciones */}
          <div className="lobby-left-col">
            <h1 className="lobby-logo">BURACO</h1>
            <div style={{ fontSize: '0.7rem', letterSpacing: '3px', color: '#a78bfa', marginTop: '-12px', marginBottom: '20px', fontWeight: '800', textTransform: 'uppercase', opacity: 0.8 }}>
              powered by MARCO DOMINGUEZ
            </div>
            <p className="lobby-subtitle" style={{ marginBottom: '20px' }}>
              Juego de cartas multijugador para 2 o 4 notebooks
            </p>
            
            <div className="lobby-info" style={{ width: '100%', textAlign: 'left', marginTop: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#93c5fd', marginBottom: '6px' }}>
                <Globe size={16} />
                <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>¿Cómo jugar en red local?</span>
              </div>
              <p style={{ fontSize: '0.75rem', color: '#cbd5e1', lineHeight: '1.4', margin: 0 }}>
                Asegurate de que ambas notebooks estén conectadas a la misma red WiFi. 
                El otro jugador debe ingresar esta dirección en su navegador:
              </p>
              <div className="ip-badge" style={{ marginTop: '8px', fontSize: '0.8rem', padding: '6px 10px' }}>
                http://{localIp || 'IP-DE-ESTA-PC'}:5174
              </div>
            </div>
          </div>

          {/* Columna Derecha: Formulario de Conexión */}
          <div className="lobby-right-col">
            {!joined ? (
              <div className="lobby-form">
                <div className="form-group" style={{ marginBottom: '14px' }}>
                  <label className="form-label" htmlFor="room-select" style={{ fontSize: '0.8rem', marginBottom: '4px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '1rem' }}>🪑</span> Mesa / Sala de Juego
                    </span>
                  </label>
                  <select
                    id="room-select"
                    className="input-text"
                    value={selectedRoomOption}
                    onChange={(e) => handleRoomSelect(e.target.value)}
                    style={{ cursor: 'pointer', padding: '8px 12px', fontSize: '0.9rem' }}
                  >
                    <option value="mesa-1">
                      Mesa 1 {roomsSummary['mesa-1']?.isOccupied ? '🔴 (Ocupada)' : (roomsSummary['mesa-1']?.isWaiting ? `🟢 (${roomsSummary['mesa-1']?.playersCount}/${roomsSummary['mesa-1']?.requiredHumans} esperando)` : '🟢 (Libre)')}
                    </option>
                    <option value="mesa-2">
                      Mesa 2 {roomsSummary['mesa-2']?.isOccupied ? '🔴 (Ocupada)' : (roomsSummary['mesa-2']?.isWaiting ? `🟢 (${roomsSummary['mesa-2']?.playersCount}/${roomsSummary['mesa-2']?.requiredHumans} esperando)` : '🟢 (Libre)')}
                    </option>
                    <option value="mesa-3">
                      Mesa 3 {roomsSummary['mesa-3']?.isOccupied ? '🔴 (Ocupada)' : (roomsSummary['mesa-3']?.isWaiting ? `🟢 (${roomsSummary['mesa-3']?.playersCount}/${roomsSummary['mesa-3']?.requiredHumans} esperando)` : '🟢 (Libre)')}
                    </option>
                    <option value="mesa-4">
                      Mesa 4 {roomsSummary['mesa-4']?.isOccupied ? '🔴 (Ocupada)' : (roomsSummary['mesa-4']?.isWaiting ? `🟢 (${roomsSummary['mesa-4']?.playersCount}/${roomsSummary['mesa-4']?.requiredHumans} esperando)` : '🟢 (Libre)')}
                    </option>
                    <option value="custom">Sala Privada (Código Personalizado)...</option>
                  </select>
                  {currentRoomInfo?.isWaiting && !isCurrentOccupied && (
                    <div style={{ 
                      marginTop: '6px', 
                      padding: '8px 12px', 
                      borderRadius: '8px', 
                      background: 'rgba(16, 185, 129, 0.15)', 
                      border: '1px solid rgba(16, 185, 129, 0.4)', 
                      color: '#6ee7b7', 
                      fontSize: '0.8rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}>
                      <span style={{ fontSize: '1.1rem' }}>👋</span>
                      <span>
                        <strong>¡Mesa esperando compañero!</strong> {currentRoomInfo.players?.[0]} ya está esperando en esta mesa ({currentRoomInfo.is4Player ? (currentRoomInfo.isAgainstBot ? '2 Humanos + 2 Bots' : '4 Humanos') : '2 Humanos'}). ¡Hacé clic en ingresar para jugar juntos!
                      </span>
                    </div>
                  )}
                  {isCurrentOccupied && (
                    <div style={{ 
                      marginTop: '6px', 
                      padding: '6px 10px', 
                      borderRadius: '6px', 
                      background: isReconnecting ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)', 
                      border: isReconnecting ? '1px solid rgba(16, 185, 129, 0.4)' : '1px solid rgba(239, 68, 68, 0.4)', 
                      color: isReconnecting ? '#6ee7b7' : '#fca5a5', 
                      fontSize: '0.8rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}>
                      <span>{isReconnecting ? '🔄' : '⚠️'}</span>
                      <span>
                        {isReconnecting ? (
                          <strong>Partida en curso detectada para tu usuario ({name.trim()}). Podés reconectarte.</strong>
                        ) : (
                          <strong>Mesa Ocupada: Hay una partida en curso. Elegí otra mesa libre.</strong>
                        )}
                      </span>
                    </div>
                  )}
                  {selectedRoomOption === 'custom' && (
                    <input
                      type="text"
                      className="input-text"
                      placeholder="Ej. familia-perez, torneo-amigos"
                      value={customRoomName}
                      onChange={(e) => handleCustomRoomChange(e.target.value)}
                      maxLength={20}
                      style={{ marginTop: '8px', padding: '8px 12px', fontSize: '0.85rem' }}
                    />
                  )}
                </div>

                <div className="form-group" style={{ marginBottom: '14px' }}>
                  <label className="form-label" htmlFor="player-name" style={{ fontSize: '0.8rem', marginBottom: '4px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <User size={14} /> Tu Nombre de Jugador
                    </span>
                  </label>
                  <input
                    id="player-name"
                    className="input-text"
                    type="text"
                    placeholder="Ej. Viviana"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleJoin(false);
                      }
                    }}
                    maxLength={15}
                    autoFocus
                    style={{ padding: '8px 12px', fontSize: '0.9rem' }}
                  />
                </div>

                <div className="form-group" style={{ marginBottom: '14px' }}>
                  <label className="form-label" htmlFor="player-count" style={{ fontSize: '0.8rem', marginBottom: '4px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Users size={14} /> Modo de Juego
                    </span>
                  </label>
                  <select
                    id="player-count"
                    className="input-text"
                    value={is4Player ? '4' : '2'}
                    onChange={(e) => setIs4Player(e.target.value === '4')}
                    style={{ cursor: 'pointer', padding: '8px 12px', fontSize: '0.9rem' }}
                  >
                    <option value="2">2 Jugadores (1 vs 1)</option>
                    <option value="4">4 Jugadores (2 vs 2 por parejas)</option>
                  </select>
                </div>

                <div className="form-group" style={{ marginBottom: '14px' }}>
                  <label className="form-label" htmlFor="required-canastras" style={{ fontSize: '0.8rem', marginBottom: '4px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Award size={14} /> Canastas para Terminar (Batida)
                    </span>
                  </label>
                  <select
                    id="required-canastras"
                    className="input-text"
                    value={requiredCanastras}
                    onChange={(e) => setRequiredCanastras(Number(e.target.value))}
                    style={{ cursor: 'pointer', padding: '8px 12px', fontSize: '0.9rem' }}
                  >
                    <option value={1}>1 Canasta (Partida rápida)</option>
                    <option value={2}>2 Canastas (Estándar)</option>
                  </select>
                </div>

                <div className="form-group" style={{ marginBottom: '16px' }}>
                  <label className="form-label" htmlFor="target-score" style={{ fontSize: '0.8rem', marginBottom: '4px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Award size={14} /> Puntos para Ganar la Partida
                    </span>
                  </label>
                  <input
                    id="target-score"
                    className="input-text"
                    type="number"
                    min={500}
                    max={10000}
                    step={500}
                    value={targetScore}
                    onChange={(e) => setTargetScore(Number(e.target.value))}
                    style={{ cursor: 'pointer', padding: '8px 12px', fontSize: '0.9rem' }}
                  />
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {is4Player ? (
                    <>
                      {/* Opción 1: 2 Humanos + 2 Bots (2 notebooks) */}
                      <button 
                        type="button"
                        className="btn-primary" 
                        onClick={() => handleJoin(true, '2h2b')}
                        style={{ 
                          padding: '11px 16px', 
                          fontSize: '0.9rem',
                          background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                          boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px'
                        }}
                      >
                        👥 Jugar 2 Humanos + 2 Bots (2 Notebooks) <ArrowRight size={16} />
                      </button>

                      {/* Opción 2: 1 Humano + 3 Bots (Solitario - Inicia Ya) */}
                      <button 
                        type="button"
                        className="btn-primary" 
                        onClick={() => handleJoin(true, '1h3b')}
                        style={{ 
                          padding: '10px 16px', 
                          fontSize: '0.85rem',
                          background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                          boxShadow: '0 4px 12px rgba(139, 92, 246, 0.25)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px'
                        }}
                      >
                        🤖 Jugar con Pareja Bot vs 2 Bots (Iniciar Ya) <ArrowRight size={16} />
                      </button>

                      {/* Opción 3: 4 Humanos (4 notebooks) */}
                      <button 
                        type="button"
                        className="btn-primary" 
                        onClick={() => handleJoin(false)}
                        style={{ 
                          padding: '9px 16px', 
                          fontSize: '0.85rem',
                          background: 'rgba(255, 255, 255, 0.08)',
                          border: '1px solid rgba(255, 255, 255, 0.2)',
                          color: '#cbd5e1',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px'
                        }}
                      >
                        👨‍👩‍👧‍👦 Partida de 4 Humanos (4 Notebooks)
                      </button>
                    </>
                  ) : (
                    <>
                      <button 
                        type="button"
                        className="btn-primary" 
                        onClick={() => handleJoin(false)}
                        style={{ padding: '10px 16px', fontSize: '0.9rem' }}
                      >
                        {isReconnecting ? 'Reconectarse a la Mesa' : 'Jugar contra otro Humano (2 Notebooks)'} <ArrowRight size={16} style={{ marginLeft: '6px', display: 'inline-block', verticalAlign: 'middle' }} />
                      </button>
                      
                      <button 
                        type="button"
                        className="btn-primary" 
                        onClick={() => handleJoin(true)}
                        style={{ 
                          padding: '10px 16px', 
                          fontSize: '0.9rem', 
                          background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', 
                          boxShadow: '0 4px 12px rgba(59, 130, 246, 0.25)' 
                        }}
                      >
                        {isReconnecting ? 'Reconectarse contra la PC' : 'Jugar contra la PC (1 vs 1 IA)'} <ArrowRight size={16} style={{ marginLeft: '6px', display: 'inline-block', verticalAlign: 'middle' }} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center' }}>
                <div className="lobby-info" style={{ marginBottom: '14px', padding: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginBottom: '6px', fontSize: '0.9rem' }}>
                    <div className={`status-dot ${connected ? 'connected' : ''}`}></div>
                    <span>{connected ? 'Conectado' : 'Conectando...'}</span>
                  </div>
                  <div style={{ marginTop: '4px', fontSize: '0.9rem', color: '#38bdf8', fontWeight: 700 }}>
                    🪑 {selectedRoomOption === 'custom' ? (customRoomName.toUpperCase() || 'SALA PRIVADA') : selectedRoomOption.toUpperCase()}
                  </div>

                  {joinedMode.is4Player && joinedMode.againstBot ? (
                    <div style={{ marginTop: '8px' }}>
                      <div style={{ color: '#fbbf24', fontWeight: 700, fontSize: '0.95rem' }}>
                        Esperando al 2º jugador humano ({players.length} de 2 conectados)
                      </div>
                      <p style={{ color: '#94a3b8', fontSize: '0.78rem', margin: '4px 0 0 0', lineHeight: 1.4 }}>
                        La mesa se completará automáticamente con 2 Bots (IA) para formar las 2 parejas.
                      </p>
                    </div>
                  ) : joinedMode.is4Player ? (
                    <div style={{ marginTop: '8px' }}>
                      <div style={{ color: '#38bdf8', fontWeight: 700, fontSize: '0.95rem' }}>
                        Esperando a 4 jugadores humanos ({players.length} de 4 conectados)
                      </div>
                      <p style={{ color: '#94a3b8', fontSize: '0.78rem', margin: '4px 0 0 0' }}>
                        La partida iniciará cuando ingresen los 4 jugadores a esta mesa.
                      </p>
                    </div>
                  ) : (
                    <div style={{ marginTop: '8px' }}>
                      <div style={{ color: '#38bdf8', fontWeight: 700, fontSize: '0.95rem' }}>
                        Esperando al segundo jugador humano ({players.length} de 2 conectados)
                      </div>
                      <p style={{ color: '#94a3b8', fontSize: '0.78rem', margin: '4px 0 0 0' }}>
                        La partida iniciará cuando el otro jugador ingrese a esta mesa.
                      </p>
                    </div>
                  )}
                </div>

                <div className="lobby-players-list" style={{ padding: '10px' }}>
                  <h3 style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '8px' }}>
                    Composición de la mesa:
                  </h3>
                  {joinedMode.is4Player && joinedMode.againstBot ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {/* Jugador 1 */}
                      <div className="lobby-player-row" style={{ padding: '6px 8px', fontSize: '0.85rem' }}>
                        <Users size={14} style={{ color: '#10b981' }} />
                        <span style={{ fontWeight: 600 }}>{players[0] || name} (Humano)</span>
                        <span style={{ fontSize: '0.7rem', color: '#10b981', marginLeft: 'auto' }}>Conectado</span>
                      </div>
                      {/* Jugador 2 (o esperando) */}
                      {players.length >= 2 ? (
                        <div className="lobby-player-row" style={{ padding: '6px 8px', fontSize: '0.85rem' }}>
                          <Users size={14} style={{ color: '#10b981' }} />
                          <span style={{ fontWeight: 600 }}>{players[1]} (Humano)</span>
                          <span style={{ fontSize: '0.7rem', color: '#10b981', marginLeft: 'auto' }}>Conectado</span>
                        </div>
                      ) : (
                        <div className="lobby-player-row" style={{ padding: '6px 8px', fontSize: '0.85rem', background: 'rgba(251, 191, 36, 0.08)', border: '1px dashed rgba(251, 191, 36, 0.4)' }}>
                          <span style={{ fontSize: '0.9rem' }}>⏳</span>
                          <span style={{ color: '#fbbf24', fontStyle: 'italic' }}>Esperando al 2º Jugador Humano...</span>
                          <span style={{ fontSize: '0.7rem', color: '#fbbf24', marginLeft: 'auto' }}>Pendiente</span>
                        </div>
                      )}
                      {/* Bots de compañía listos */}
                      <div className="lobby-player-row" style={{ padding: '6px 8px', fontSize: '0.85rem', opacity: 0.9 }}>
                        <span style={{ fontSize: '0.9rem' }}>🤖</span>
                        <span style={{ color: '#cbd5e1' }}>Compu A (Bot Pareja de {players[0] || name})</span>
                        <span style={{ fontSize: '0.7rem', color: '#38bdf8', marginLeft: 'auto' }}>Listo</span>
                      </div>
                      <div className="lobby-player-row" style={{ padding: '6px 8px', fontSize: '0.85rem', opacity: 0.9 }}>
                        <span style={{ fontSize: '0.9rem' }}>🤖</span>
                        <span style={{ color: '#cbd5e1' }}>Compu B (Bot Pareja del Rival)</span>
                        <span style={{ fontSize: '0.7rem', color: '#38bdf8', marginLeft: 'auto' }}>Listo</span>
                      </div>
                    </div>
                  ) : (
                    players.map((pName, idx) => (
                      <div key={idx} className="lobby-player-row" style={{ padding: '6px 8px', fontSize: '0.85rem' }}>
                        <Users size={14} />
                        <span style={{ fontWeight: 600 }}>{pName}</span>
                        <span style={{ fontSize: '0.7rem', color: '#10b981', marginLeft: 'auto' }}>Conectado</span>
                      </div>
                    ))
                  )}
                </div>

                <button 
                  type="button"
                  className="btn-primary" 
                  onClick={() => {
                    if (onCancelJoin) onCancelJoin();
                  }}
                  style={{ 
                    marginTop: '14px', 
                    background: 'rgba(239, 68, 68, 0.15)', 
                    borderColor: 'rgba(239, 68, 68, 0.3)', 
                    color: '#fca5a5', 
                    boxShadow: 'none', 
                    fontSize: '0.85rem',
                    padding: '8px 16px' 
                  }}
                >
                  Volver al Inicio
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
