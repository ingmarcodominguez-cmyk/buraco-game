// Scoreboard.jsx
import React from 'react';
import { Award } from 'lucide-react';

const CARD_VALUES = {
  'A': 15, '2': 20, '3': 5, '4': 5, '5': 5, '6': 5, '7': 5,
  '8': 10, '9': 10, '10': 10, 'J': 10, 'Q': 10, 'K': 10, 'Joker': 50
};

export default function Scoreboard({ gameState, playerIndex, onChangeTargetScore }) {
  if (!gameState) return null;

  const safePlayerIndex = typeof playerIndex === 'number' ? playerIndex : 0;
  const is4P = gameState.is4Player;
  const myTeamIdx = is4P ? ((safePlayerIndex === 0 || safePlayerIndex === 2) ? 0 : 1) : safePlayerIndex;
  const oppTeamIdx = is4P ? (myTeamIdx === 0 ? 1 : 0) : (safePlayerIndex === 0 ? 1 : 0);
  const opponentIndex = safePlayerIndex === 0 ? 1 : 0;

  const getBreakdown = (teamIdx) => {
    const playersInTeam = is4P ? [teamIdx, teamIdx + 2] : [teamIdx];
    const player = (typeof teamIdx === 'number' && gameState.players?.[teamIdx]) || { melds: [], hand: [], name: '' };
    
    let meldPoints = 0;
    let cleanCanastras = 0;
    let dirtyCanastras = 0;
    
    if (player.melds) {
      player.melds.forEach(meld => {
        if (meld) {
          // Sumar puntos de cartas
          meld.forEach(c => {
            if (c) meldPoints += CARD_VALUES[c.rank] || 0;
          });

          // Contar canastras
          if (meld.length >= 7) {
            const hasWildcard = meld.some(c => c && c.isUsedAsWildcard);
            if (hasWildcard) dirtyCanastras++;
            else cleanCanastras++;
          }
        }
      });
    }

    const cleanCanastraPoints = cleanCanastras * 200;
    const dirtyCanastraPoints = dirtyCanastras * 100;
    
    // Solo aplicar penalizaciones de mano y muerto si la ronda finalizó
    let handPoints = 0;
    let mortoPenalty = 0;
    let goOutBonus = 0;
    let roundTotal = 0;
    
    if (gameState.status === 'finished') {
      playersInTeam.forEach(pIdx => {
        const pObj = gameState.players?.[pIdx];
        if (pObj && pObj.hand) {
          pObj.hand.forEach(c => {
            if (c && c.rank !== 'hidden') {
              handPoints += CARD_VALUES[c.rank] || 0;
            }
          });
        }
      });
      
      const tookMorto = is4P ? (gameState.mortosTaken?.[teamIdx] !== null) : gameState.mortosTaken?.[teamIdx];
      if (!tookMorto) mortoPenalty = -100;
      
      const winner = gameState.winner;
      if (winner !== null) {
        const winnerTeam = is4P ? (winner === 0 || winner === 2 ? 0 : 1) : winner;
        if (winnerTeam === teamIdx) goOutBonus = 100;
      }
      
      roundTotal = meldPoints + cleanCanastraPoints + dirtyCanastraPoints + goOutBonus + mortoPenalty - handPoints;
    }

    const nameText = is4P
      ? (teamIdx === 0 ? "Pareja 1" : "Pareja 2")
      : (player?.name || `Jugador ${(typeof teamIdx === 'number' ? teamIdx : 0) + 1}`);

    return {
      name: nameText,
      meldPoints,
      cleanCanastras,
      cleanCanastraPoints,
      dirtyCanastras,
      dirtyCanastraPoints,
      mortoPenalty,
      handPoints,
      goOutBonus,
      roundTotal,
      globalTotal: (gameState.scores && gameState.scores[teamIdx]) || 0
    };
  };

  const myBreakdown = getBreakdown(is4P ? myTeamIdx : playerIndex);
  const oppBreakdown = getBreakdown(is4P ? oppTeamIdx : opponentIndex);

  return (
    <div className="sidebar-section">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Award size={18} style={{ color: '#fbbf24' }} />
          <h2 className="sidebar-title" style={{ margin: 0 }}>Puntuación</h2>
        </div>
        <span 
          onClick={onChangeTargetScore}
          style={{ 
            fontSize: '0.75rem', 
            color: '#fbbf24', 
            background: 'rgba(251,191,36,0.1)', 
            padding: '2px 8px', 
            borderRadius: '12px', 
            border: '1px solid rgba(251,191,36,0.2)',
            cursor: onChangeTargetScore ? 'pointer' : 'default'
          }}
          title={onChangeTargetScore ? "Hacé click para cambiar la meta de puntos" : ""}
        >
          Meta: {gameState.targetScore || 3000} pts ✏️
        </span>
      </div>

      <table className="score-table">
        <thead>
          <tr>
            <th>Concepto</th>
            <th>{is4P ? "Tus Puntos" : "Tú"}</th>
            <th>{is4P ? "Rivales" : (gameState.players?.[opponentIndex]?.name || 'Rival')}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Cartas Bajadas</td>
            <td style={{ color: '#34d399' }}>+{myBreakdown.meldPoints}</td>
            <td style={{ color: '#34d399' }}>+{oppBreakdown.meldPoints}</td>
          </tr>
          <tr>
            <td>Canastras Limpias (x2)</td>
            <td style={{ color: '#fbbf24' }}>
              +{myBreakdown.cleanCanastraPoints} <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>({myBreakdown.cleanCanastras})</span>
            </td>
            <td style={{ color: '#fbbf24' }}>
              +{oppBreakdown.cleanCanastraPoints} <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>({oppBreakdown.cleanCanastras})</span>
            </td>
          </tr>
          <tr>
            <td>Canastras Sucias (x1)</td>
            <td style={{ color: '#cbd5e1' }}>
              +{myBreakdown.dirtyCanastraPoints} <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>({myBreakdown.dirtyCanastras})</span>
            </td>
            <td style={{ color: '#cbd5e1' }}>
              +{oppBreakdown.dirtyCanastraPoints} <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>({oppBreakdown.dirtyCanastras})</span>
            </td>
          </tr>
          {gameState.status === 'finished' && (
            <>
              <tr>
                <td>Sin Muerto</td>
                <td style={{ color: myBreakdown.mortoPenalty < 0 ? '#ef4444' : '#94a3b8' }}>
                  {myBreakdown.mortoPenalty}
                </td>
                <td style={{ color: oppBreakdown.mortoPenalty < 0 ? '#ef4444' : '#94a3b8' }}>
                  {oppBreakdown.mortoPenalty}
                </td>
              </tr>
              <tr>
                <td>Cartas en Mano</td>
                <td style={{ color: '#ef4444' }}>-{myBreakdown.handPoints}</td>
                <td style={{ color: '#ef4444' }}>-{oppBreakdown.handPoints}</td>
              </tr>
              <tr>
                <td>Bono Batida</td>
                <td style={{ color: '#10b981' }}>+{myBreakdown.goOutBonus}</td>
                <td style={{ color: '#10b981' }}>+{oppBreakdown.goOutBonus}</td>
              </tr>
            </>
          )}
          <tr style={{ borderTop: '1px solid var(--glass-border)', background: 'rgba(255,255,255,0.02)' }}>
            <td style={{ fontWeight: '600' }}>
              {gameState.status === 'finished' ? 'Total Ronda' : 'Total en Mesa'}
            </td>
            <td style={{ fontWeight: '600', color: myBreakdown.roundTotal >= 0 ? '#34d399' : '#ef4444' }}>
              {myBreakdown.roundTotal}
            </td>
            <td style={{ fontWeight: '600', color: oppBreakdown.roundTotal >= 0 ? '#34d399' : '#ef4444' }}>
              {gameState.status === 'finished' ? oppBreakdown.roundTotal : oppBreakdown.roundTotal}
            </td>
          </tr>
          <tr className="score-row-total" style={{ borderTop: '2.5px double var(--glass-border)' }}>
            <td>Total Acumulado</td>
            <td>{myBreakdown.globalTotal} pts</td>
            <td>{oppBreakdown.globalTotal} pts</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
