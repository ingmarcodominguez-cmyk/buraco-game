// Scoreboard.jsx
import React from 'react';
import { Award } from 'lucide-react';

const CARD_VALUES = {
  'A': 15, '2': 20, '3': 5, '4': 5, '5': 5, '6': 5, '7': 5,
  '8': 10, '9': 10, '10': 10, 'J': 10, 'Q': 10, 'K': 10, 'Joker': 50
};

export default function Scoreboard({ gameState, playerIndex }) {
  if (!gameState) return null;

  const opponentIndex = playerIndex === 0 ? 1 : 0;

  const getBreakdown = (pIdx) => {
    const player = gameState.players?.[pIdx] || { melds: [], hand: [] };
    
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
      if (player.hand) {
        player.hand.forEach(c => {
          if (c && c.rank !== 'hidden') {
            handPoints += CARD_VALUES[c.rank] || 0;
          }
        });
      }
      
      const tookMorto = gameState.mortosTaken?.[pIdx];
      if (!tookMorto) mortoPenalty = -100;
      
      const isWinner = gameState.winner === pIdx;
      if (isWinner) goOutBonus = 100;
      
      roundTotal = meldPoints + cleanCanastraPoints + dirtyCanastraPoints + goOutBonus + mortoPenalty - handPoints;
    }

    return {
      name: player.name || `Jugador ${pIdx + 1}`,
      meldPoints,
      cleanCanastras,
      cleanCanastraPoints,
      dirtyCanastras,
      dirtyCanastraPoints,
      mortoPenalty,
      handPoints,
      goOutBonus,
      roundTotal,
      globalTotal: (gameState.scores && gameState.scores[pIdx]) || 0
    };
  };

  const myBreakdown = getBreakdown(playerIndex);
  const oppBreakdown = getBreakdown(opponentIndex);

  return (
    <div className="sidebar-section">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Award size={18} style={{ color: '#fbbf24' }} />
          <h2 className="sidebar-title" style={{ margin: 0 }}>Puntuación</h2>
        </div>
        <span style={{ fontSize: '0.75rem', color: '#94a3b8', background: 'rgba(255,255,255,0.08)', padding: '2px 8px', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.1)' }}>
          Meta: {gameState.targetScore || 3000} pts
        </span>
      </div>

      <table className="score-table">
        <thead>
          <tr>
            <th>Concepto</th>
            <th>Tú</th>
            <th>{gameState.players[opponentIndex]?.name || 'Rival'}</th>
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
