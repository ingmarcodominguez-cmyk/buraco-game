// Lobby.jsx
import React, { useState } from 'react';
import { User, Users, Globe, ArrowRight, Award } from 'lucide-react';

export default function Lobby({ onJoin, localIp, players, connected, currentRoomId, onRoomChange, roomsSummary = {} }) {
  const [name, setName] = useState('');
  const [selectedRoomOption, setSelectedRoomOption] = useState(currentRoomId || 'mesa-1');
  const [customRoomName, setCustomRoomName] = useState('');
  const [requiredCanastras, setRequiredCanastras] = useState(1);
  const [targetScore, setTargetScore] = useState(3000);
  const [playAgainstBot, setPlayAgainstBot] = useState(false);
  const [is4Player, setIs4Player] = useState(false);
  const [joined, setJoined] = useState(false);

  const currentRoomInfo = selectedRoomOption !== 'custom' ? roomsSummary[selectedRoomOption] : null;
  const isCurrentOccupied = currentRoomInfo ? currentRoomInfo.isOccupied : false;

  const handleRoomSelect = (val) => {
    setSelectedRoomOption(val);
    const targetRoom = val === 'custom' ? (customRoomName.trim() || 'mesa-personalizada') : val;
    if (onRoomChange) onRoomChange(targetRoom);
  };

  const handleCustomRoomChange = (val) => {
    setCustomRoomName(val);
    if (onRoomChange) onRoomChange(val.trim() || 'mesa-personalizada');
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (isCurrentOccupied) {
      alert(`La ${selectedRoomOption.toUpperCase()} ya está ocupada con una partida en curso. Por favor selecciona otra mesa disponible.`);
      return;
    }
    const finalRoomId = selectedRoomOption === 'custom'
      ? (customRoomName.trim() || 'mesa-personalizada')
      : selectedRoomOption;
    onJoin(name.trim(), requiredCanastras, playAgainstBot, targetScore, is4Player, finalRoomId);
    setJoined(true);
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
              <form onSubmit={handleSubmit}>
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
                      Mesa 1 {roomsSummary['mesa-1']?.isOccupied ? '🔴 (Ocupada)' : '🟢 (Libre)'}
                    </option>
                    <option value="mesa-2">
                      Mesa 2 {roomsSummary['mesa-2']?.isOccupied ? '🔴 (Ocupada)' : '🟢 (Libre)'}
                    </option>
                    <option value="mesa-3">
                      Mesa 3 {roomsSummary['mesa-3']?.isOccupied ? '🔴 (Ocupada)' : '🟢 (Libre)'}
                    </option>
                    <option value="mesa-4">
                      Mesa 4 {roomsSummary['mesa-4']?.isOccupied ? '🔴 (Ocupada)' : '🟢 (Libre)'}
                    </option>
                    <option value="custom">Sala Privada (Código Personalizado)...</option>
                  </select>
                  {isCurrentOccupied && (
                    <div style={{ 
                      marginTop: '6px', 
                      padding: '6px 10px', 
                      borderRadius: '6px', 
                      background: 'rgba(239, 68, 68, 0.15)', 
                      border: '1px solid rgba(239, 68, 68, 0.4)', 
                      color: '#fca5a5', 
                      fontSize: '0.8rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}>
                      <span>⚠️</span>
                      <span><strong>Mesa Ocupada:</strong> Hay una partida en curso. Elige otra mesa libre.</span>
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
                      required
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
                    maxLength={15}
                    required
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
                  <button 
                    className="btn-primary" 
                    type="submit"
                    onClick={() => setPlayAgainstBot(false)}
                    style={{ padding: '10px 16px', fontSize: '0.9rem' }}
                  >
                    {is4Player ? 'Ingresar a Partida de 4' : 'Ingresar al Juego'} <ArrowRight size={16} style={{ marginLeft: '6px', display: 'inline-block', verticalAlign: 'middle' }} />
                  </button>
                  
                  <button 
                    className="btn-primary" 
                    type="submit"
                    onClick={() => setPlayAgainstBot(true)}
                    style={{ 
                      padding: '10px 16px', 
                      fontSize: '0.9rem', 
                      background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', 
                      boxShadow: '0 4px 12px rgba(59, 130, 246, 0.25)' 
                    }}
                  >
                    {is4Player ? 'Jugar con Compañero Bot' : 'Jugar contra la PC (IA)'} <ArrowRight size={16} style={{ marginLeft: '6px', display: 'inline-block', verticalAlign: 'middle' }} />
                  </button>
                </div>
              </form>
            ) : (
              <div style={{ textAlign: 'center' }}>
                <div className="lobby-info" style={{ marginBottom: '14px', padding: '10px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginBottom: '4px', fontSize: '0.9rem' }}>
                    <div className={`status-dot ${connected ? 'connected' : ''}`}></div>
                    <span>{connected ? 'Conectado' : 'Conectando...'}</span>
                  </div>
                  <div style={{ marginTop: '6px', fontSize: '0.85rem', color: '#38bdf8', fontWeight: 600 }}>
                    🪑 {selectedRoomOption === 'custom' ? (customRoomName.toUpperCase() || 'SALA PRIVADA') : selectedRoomOption.toUpperCase()}
                  </div>
                  <p style={{ color: '#94a3b8', fontSize: '0.75rem', margin: '4px 0 0 0' }}>
                    {is4Player 
                      ? (playAgainstBot ? 'Esperando al segundo jugador...' : 'Esperando a 4 jugadores...')
                      : 'Esperando al segundo jugador...'
                    }
                  </p>
                </div>

                <div className="lobby-players-list" style={{ padding: '10px' }}>
                  <h3 style={{ fontSize: '0.75rem', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '6px' }}>
                    Jugadores en esta mesa:
                  </h3>
                  {players.length === 0 ? (
                    <p style={{ fontStyle: 'italic', color: '#64748b', fontSize: '0.8rem', margin: 0 }}>Nadie conectado aún</p>
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
                  className="btn-primary" 
                  onClick={() => window.location.reload()}
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
