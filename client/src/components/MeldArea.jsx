// MeldArea.jsx
import React from 'react';
import Card from './Card';

export default function MeldArea({ melds, onMeldClick, selectedMeldIndex, isOpponent, onDropOnMeld }) {
  const isCompact = melds.length >= 3;
  const [dragOverIndex, setDragOverIndex] = React.useState(null);

  return (
    <div className={`melds-container ${isCompact ? 'compact' : ''}`}>
      {melds.length === 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', color: '#64748b', fontSize: '0.85rem', fontStyle: 'italic' }}>
          Ningún juego bajado aún
        </div>
      ) : (
        melds.map((meld, idx) => {
          // Determinar si es canastra y qué tipo
          const isCanastra = meld.length >= 7;
          
          // Buscar si hay comodines en el juego para saber si es limpia o sucia
          // Una secuencia es sucia si tiene Joker o un 2 que no es del palo o que está fuera del lugar 2 natural
          const hasWildcard = meld.some(c => c.isUsedAsWildcard);
          const canastraType = isCanastra ? (hasWildcard ? 'suja' : 'limpa') : null;

          const isSelected = selectedMeldIndex === idx;
          const isDragOver = dragOverIndex === idx;

          return (
            <div 
              key={idx} 
              className={`meld-row ${isSelected ? 'selected-target' : ''} ${isDragOver ? 'drag-over-target' : ''}`}
              onClick={() => onMeldClick && !isOpponent && onMeldClick(idx)}
              style={{ cursor: (!isOpponent && onMeldClick) ? 'pointer' : 'default' }}
              onDragOver={(e) => {
                if (!isOpponent && onDropOnMeld) {
                  e.preventDefault();
                }
              }}
              onDragEnter={() => {
                if (!isOpponent && onDropOnMeld) {
                  setDragOverIndex(idx);
                }
              }}
              onDragLeave={() => {
                if (!isOpponent && onDropOnMeld) {
                  setDragOverIndex(null);
                }
              }}
              onDrop={(e) => {
                if (!isOpponent && onDropOnMeld) {
                  setDragOverIndex(null);
                  onDropOnMeld(e, idx);
                }
              }}
            >
              {isCanastra && (
                <div className={`canastra-badge ${canastraType}`}>
                  Canastra {canastraType === 'limpa' ? 'Limpia' : 'Sucia'}
                </div>
              )}
              
              <div className="meld-cards">
                {meld.map((card, cIdx) => (
                  <Card 
                    key={card.id || cIdx} 
                    card={card} 
                    isHidden={false} 
                  />
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
