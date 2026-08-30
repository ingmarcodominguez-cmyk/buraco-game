// Card.jsx
import React from 'react';

const SUIT_SYMBOLS = {
  'H': '♥',
  'D': '♦',
  'C': '♣',
  'S': '♠',
  'Joker': '🃏'
};

const SUIT_NAMES = {
  'H': 'hearts',
  'D': 'diamonds',
  'C': 'clubs',
  'S': 'spades',
  'Joker': 'joker'
};

const CARD_POINTS = {
  'A': 15,
  '2': 20,
  '3': 5,
  '4': 5,
  '5': 5,
  '6': 5,
  '7': 5,
  '8': 10,
  '9': 10,
  '10': 10,
  'J': 10,
  'Q': 10,
  'K': 10,
  'Joker': 50
};

export default function Card({ card, onClick, selected, isHidden, isHighlighted }) {
  if (isHidden || card.id === 'hidden') {
    return (
      <div className="playing-card card-back">
        <div className="card-back-pattern"></div>
      </div>
    );
  }

  const { suit, rank, isUsedAsWildcard, representedRank } = card;
  const isRed = suit === 'H' || suit === 'D';
  const colorClass = suit === 'Joker' ? 'joker' : isRed ? 'red' : 'black';
  const symbol = SUIT_SYMBOLS[suit] || '';

  // Valor de puntos a mostrar
  const points = CARD_POINTS[rank] || 0;

  // Los comodines se muestran con su rango original (ej: "2" o "Joker")
  const displayName = rank;

  return (
    <div 
      className={`playing-card ${colorClass} ${selected ? 'selected' : ''} ${isHighlighted ? 'card-flash-highlight' : ''}`}
      onClick={onClick}
    >
      <div className="card-top-left">
        <span>{displayName}</span>
        <span style={{ fontSize: '0.8rem', marginTop: '2px' }}>{symbol}</span>
      </div>

      <div className="card-suit-big">
        {suit === 'Joker' ? '🃏' : symbol}
      </div>

      {isUsedAsWildcard && (
        <span className="card-wildcard-badge" title={`Comodín (como ${representedRank})`} style={{ fontSize: '0.6rem', padding: '1px 3px' }}>
          COMO {representedRank}
        </span>
      )}

      <div className="card-value-display">
        {points} pts
      </div>
    </div>
  );
}
