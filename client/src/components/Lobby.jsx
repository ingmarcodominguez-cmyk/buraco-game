// Lobby.jsx
import React, { useState } from 'react';
import { User, Users, Globe, ArrowRight, Award } from 'lucide-react';

export default function Lobby({ onJoin, localIp, players, connected }) {
  const [name, setName] = useState('');
  const [requiredCanastras, setRequiredCanastras] = useState(1);
  const [targetScore, setTargetScore] = useState(3000);
  const [playAgainstBot, setPlayAgainstBot] = useState(false);
  const [joined, setJoined] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onJoin(name.trim(), requiredCanastras, playAgainstBot, targetScore);
    setJoined(true);
  };

  return (
    <div className="lobby-container">
      <div className="lobby-card glass-panel">
        <h1 className="lobby-logo">BURACO</h1>
        <p className="lobby-subtitle">Juego de cartas multijugador para 2 notebooks</p>

        {!joined ? (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label" htmlFor="player-name">
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <User size={16} /> Tu Nombre de Jugador
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
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="required-canastras">
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Award size={16} /> Canastras para Terminar (Batida)
                </span>
              </label>
              <select
                id="required-canastras"
                className="input-text"
                value={requiredCanastras}
                onChange={(e) => setRequiredCanastras(Number(e.target.value))}
                style={{ cursor: 'pointer' }}
              >
                <option value={1}>1 Canastra (Partida rápida)</option>
                <option value={2}>2 Canastras (Estándar)</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="target-score">
                <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Award size={16} /> Puntos para Ganar la Partida
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
                style={{ cursor: 'pointer' }}
              />
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button 
                className="btn-primary" 
                type="submit"
                onClick={() => setPlayAgainstBot(false)}
              >
                Ingresar al Juego <ArrowRight size={18} style={{ marginLeft: '8px', display: 'inline-block', verticalAlign: 'middle' }} />
              </button>
              
              <button 
                className="btn-primary" 
                type="submit"
                onClick={() => setPlayAgainstBot(true)}
                style={{ background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', boxShadow: '0 4px 14px rgba(59, 130, 246, 0.3)' }}
              >
                Jugar contra la PC (IA) <ArrowRight size={18} style={{ marginLeft: '8px', display: 'inline-block', verticalAlign: 'middle' }} />
              </button>
            </div>
          </form>
        ) : (
          <div style={{ textAlign: 'center' }}>
            <div className="lobby-info" style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '8px' }}>
                <div className={`status-dot ${connected ? 'connected' : ''}`}></div>
                <span>{connected ? 'Conectado al servidor' : 'Conectando al servidor...'}</span>
              </div>
              <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Esperando al segundo jugador...</p>
            </div>

            <div className="lobby-players-list">
              <h3 style={{ fontSize: '0.9rem', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '10px' }}>
                Jugadores en la sala:
              </h3>
              {players.length === 0 ? (
                <p style={{ fontStyle: 'italic', color: '#64748b' }}>Nadie conectado aún</p>
              ) : (
                players.map((pName, idx) => (
                  <div key={idx} className="lobby-player-row">
                    <Users size={16} />
                    <span style={{ fontWeight: 600 }}>{pName}</span>
                    <span style={{ fontSize: '0.75rem', color: '#10b981', marginLeft: 'auto' }}>Conectado</span>
                  </div>
                ))
              )}
            </div>

            <button 
              className="btn-primary" 
              onClick={() => window.location.reload()}
              style={{ 
                marginTop: '20px', 
                background: 'rgba(239, 68, 68, 0.2)', 
                borderColor: 'rgba(239, 68, 68, 0.4)', 
                color: '#fca5a5', 
                boxShadow: 'none', 
                fontSize: '0.9rem' 
              }}
            >
              Volver al Inicio
            </button>
          </div>
        )}

        <div className="lobby-info" style={{ marginTop: '30px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center', color: '#93c5fd' }}>
            <Globe size={18} />
            <span style={{ fontWeight: 600 }}>¿Cómo jugar desde dos notebooks?</span>
          </div>
          <p style={{ fontSize: '0.8rem', color: '#cbd5e1', marginTop: '8px', lineHeight: '1.4' }}>
            Asegurate de que ambas notebooks estén conectadas a la misma red WiFi. 
            El segundo jugador debe abrir el navegador e ingresar la siguiente dirección:
          </p>
          <div className="ip-badge">
            http://{localIp || 'IP-DE-ESTA-PC'}:5174
          </div>
        </div>
      </div>
    </div>
  );
}
