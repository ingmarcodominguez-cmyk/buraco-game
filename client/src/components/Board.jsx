// Board.jsx
import React, { useState, useEffect, useRef } from 'react';
import Card from './Card';
import MeldArea from './MeldArea';
import Scoreboard from './Scoreboard';
import { ArrowDown, ArrowUp, PlusCircle, FolderPlus, RefreshCw, SortAsc, LogOut } from 'lucide-react';

const CARD_VALUES = {
  'A': 15, '2': 20, '3': 5, '4': 5, '5': 5, '6': 5, '7': 5,
  '8': 10, '9': 10, '10': 10, 'J': 10, 'Q': 10, 'K': 10, 'Joker': 50
};

const calcTotal = (mesa, limpias, sucias, mano, cierre, sinMuerto) => {
  const pointsMesa = Number(mesa) || 0;
  const pointsLimpias = (Number(limpias) || 0) * 200;
  const pointsSucias = (Number(sucias) || 0) * 100;
  const pointsMano = Number(mano) || 0;
  const pointsCierre = cierre ? 100 : 0;
  const penaltyMuerto = sinMuerto ? -100 : 0;
  return pointsMesa + pointsLimpias + pointsSucias + pointsCierre + penaltyMuerto - pointsMano;
};

export default function Board({ gameState, playerIndex, onAction, lobbyPlayers }) {
  const [prevGameState, setPrevGameState] = useState(null);
  const [animatingDiscard, setAnimatingDiscard] = useState(null);

  useEffect(() => {
    if (gameState && prevGameState) {
      const prevDiscard = prevGameState.discardPile || [];
      const currentDiscard = gameState.discardPile || [];

      if (currentDiscard.length > prevDiscard.length) {
        const discardedCard = currentDiscard[currentDiscard.length - 1];
        const discarderIdx = prevGameState.turn;
        const isOpponent = discarderIdx !== playerIndex;

        setAnimatingDiscard({
          card: discardedCard,
          fromOpponent: isOpponent
        });

        setTimeout(() => {
          setAnimatingDiscard(null);
        }, 750);
      }
    }
    setPrevGameState(gameState);
  }, [gameState]);

  const [selectedCardIds, setSelectedCardIds] = useState([]);
  const [selectedMeldIndex, setSelectedMeldIndex] = useState(null);
  const [localHand, setLocalHand] = useState([]);
  const [logs, setLogs] = useState([]);
  const [startingAlert, setStartingAlert] = useState('');
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [scoreForm, setScoreForm] = useState({
    p0Mesa: 0, p0Limpias: 0, p0Sucias: 0, p0Mano: 0, p0Cierre: false, p0SinMuerto: false,
    p1Mesa: 0, p1Limpias: 0, p1Sucias: 0, p1Mano: 0, p1Cierre: false, p1SinMuerto: false
  });

  const logEndRef = useRef(null);

  const myPlayer = gameState?.players[playerIndex];
  const myHand = myPlayer?.hand || [];
  const opponentIndex = playerIndex === 0 ? 1 : 0;
  const opponent = gameState?.players[opponentIndex];

  // Rellenar formulario de anotación al terminar la ronda
  useEffect(() => {
    if (gameState?.status === 'finished') {
      const getDefaults = (pIdx) => {
        const player = gameState.players?.[pIdx] || { melds: [], hand: [] };
        let meldPoints = 0;
        let cleanCanastras = 0;
        let dirtyCanastras = 0;
        
        if (player.melds) {
          player.melds.forEach(meld => {
            if (meld) {
              meld.forEach(c => {
                if (c) meldPoints += CARD_VALUES[c.rank] || 0;
              });
              if (meld.length >= 7) {
                const hasWildcard = meld.some(c => c && c.isUsedAsWildcard);
                if (hasWildcard) dirtyCanastras++;
                else cleanCanastras++;
              }
            }
          });
        }

        let handPoints = 0;
        if (player.hand) {
          player.hand.forEach(c => {
            if (c && c.rank !== 'hidden') {
              handPoints += CARD_VALUES[c.rank] || 0;
            }
          });
        }

        const tookMorto = gameState.mortosTaken?.[pIdx];
        const isWinner = gameState.winner === pIdx;

        return {
          mesa: meldPoints,
          limpias: cleanCanastras,
          sucias: dirtyCanastras,
          mano: handPoints,
          cierre: isWinner,
          sinMuerto: !tookMorto
        };
      };

      const p0Def = getDefaults(0);
      const p1Def = getDefaults(1);

      setScoreForm({
        p0Mesa: p0Def.mesa,
        p0Limpias: p0Def.limpias,
        p0Sucias: p0Def.sucias,
        p0Mano: p0Def.mano,
        p0Cierre: p0Def.cierre,
        p0SinMuerto: p0Def.sinMuerto,
        
        p1Mesa: p1Def.mesa,
        p1Limpias: p1Def.limpias,
        p1Sucias: p1Def.sucias,
        p1Mano: p1Def.mano,
        p1Cierre: p1Def.cierre,
        p1SinMuerto: p1Def.sinMuerto
      });
    }
  }, [gameState?.status]);

  // Sincronizar mano local con la del servidor preservando orden
  useEffect(() => {
    if (myHand.length > 0) {
      const serverHandIds = new Set(myHand.map(c => c.id));
      // Filtrar cartas locales que ya no existen
      let updatedLocal = localHand.filter(c => serverHandIds.has(c.id));
      
      // Agregar nuevas cartas que el servidor reporta y no tenemos localmente
      const localHandIds = new Set(localHand.map(c => c.id));
      const newCards = myHand.filter(c => !localHandIds.has(c.id));
      
      setLocalHand([...updatedLocal, ...newCards]);
    } else {
      setLocalHand([]);
    }
  }, [myHand]);

  // Manejo de historial de acciones en el panel lateral
  useEffect(() => {
    if (gameState?.lastAction) {
      setLogs(prev => {
        // Evitar duplicados consecutivos
        if (prev[prev.length - 1] === gameState.lastAction) return prev;
        return [...prev, gameState.lastAction];
      });
    }
  }, [gameState?.lastAction]);

  // Alerta de inicio de ronda/juego (sorteo/mano alternada)
  useEffect(() => {
    if (gameState?.lastAction) {
      const action = gameState.lastAction;
      if (action.includes('Sorteo:') || action.includes('Sorteo alternado:') || action.includes('Mano alternada:')) {
        setStartingAlert(action);
        const timer = setTimeout(() => {
          setStartingAlert('');
        }, 4000); // 4 segundos en pantalla
        return () => clearTimeout(timer);
      } else {
        setStartingAlert('');
      }
    }
  }, [gameState?.lastAction]);

  // Auto-scroll del log de acciones
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Manejadores de arrastrar y soltar (Drag and Drop) para reordenar la mano
  const handleDragStart = (e, index) => {
    e.dataTransfer.setData('text/plain', index);
    setDraggedIndex(index);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e, targetIndex) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === targetIndex) return;

    const newHand = [...localHand];
    const [draggedCard] = newHand.splice(draggedIndex, 1);
    newHand.splice(targetIndex, 0, draggedCard);
    
    setLocalHand(newHand);
    setDraggedIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  if (!gameState) return null;

  const isMyTurn = gameState.turn === playerIndex;
  const needToDraw = gameState.turnState === 'draw';
  const canPlay = isMyTurn && !needToDraw;

  // Seleccionar/Deseleccionar cartas en mano
  const handleCardClick = (cardId) => {
    setSelectedCardIds(prev => {
      if (prev.includes(cardId)) {
        return prev.filter(id => id !== cardId);
      } else {
        return [...prev, cardId];
      }
    });
  };

  // Ordenar mano local
  const handleSortHand = () => {
    const sorted = [...localHand].sort((a, b) => {
      if (a.suit === 'Joker' && b.suit !== 'Joker') return 1;
      if (a.suit !== 'Joker' && b.suit === 'Joker') return -1;
      
      if (a.suit !== b.suit) {
        return a.suit.localeCompare(b.suit);
      }
      
      const rankOrder = { 'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13 };
      return (rankOrder[a.rank] || 0) - (rankOrder[b.rank] || 0);
    });
    setLocalHand(sorted);
  };

  // Robar del mazo
  const handleDrawCard = () => {
    onAction('draw-card');
  };

  // Robar del pozo
  const handleDrawDiscard = () => {
    onAction('draw-discard');
  };

  // Bajar nuevo juego
  const handleMeldSequence = () => {
    if (selectedCardIds.length < 3) return;
    const cardsToMeld = localHand.filter(c => selectedCardIds.includes(c.id));
    onAction('meld-sequence', { cards: cardsToMeld });
    setSelectedCardIds([]);
  };

  // Acoplar cartas a juego existente
  const handleAppendToMeld = () => {
    if (selectedMeldIndex === null || selectedCardIds.length === 0) return;
    const cardsToAppend = localHand.filter(c => selectedCardIds.includes(c.id));
    onAction('append-to-meld', { 
      meldIndex: selectedMeldIndex, 
      cards: cardsToAppend 
    });
    setSelectedCardIds([]);
    setSelectedMeldIndex(null);
  };

  // Descartar
  const handleDiscard = () => {
    if (selectedCardIds.length !== 1) return;
    const cardToDiscard = localHand.find(c => c.id === selectedCardIds[0]);
    onAction('discard-card', { card: cardToDiscard });
    setSelectedCardIds([]);
  };

  const handleRestart = () => {
    if (window.confirm('¿Quieres reiniciar la ronda manteniendo los puntajes totales?')) {
      onAction('restart-round');
    }
  };

  const handleResetAll = () => {
    if (window.confirm('¿Quieres reiniciar toda la partida y resetear los puntajes a 0?')) {
      onAction('reset-game');
    }
  };

  // Obtener última carta del pozo
  const lastDiscardCard = gameState.discardPile.length > 0 
    ? gameState.discardPile[gameState.discardPile.length - 1] 
    : null;

  return (
    <div className="board-container">
      {startingAlert && (
        <div className="starting-alert-overlay">
          <div className="starting-alert-card glass-panel animate-scale-up">
            <div className="alert-sparkle">🎉</div>
            <h2 className="alert-title">
              {startingAlert.includes('Mano alternada:') || startingAlert.includes('Sorteo alternado:') 
                ? 'Mano Alternada' 
                : 'Sorteo de Mano'}
            </h2>
            <div className="alert-divider"></div>
            <p className="alert-message">
              {startingAlert.includes('¡Comienza la ronda') 
                ? (startingAlert.split('. ')[1] || startingAlert) 
                : startingAlert.replace('¡Comienza el juego! ', '').split('. ')[0]}
            </p>
            <p className="alert-submessage">¡Que comience la partida!</p>
          </div>
        </div>
      )}
      
      {/* AREA DE JUEGO PRINCIPAL */}
      <div className="main-playarea">
        
        {/* ZONA RIVAL */}
        <div className="player-zone">
          <div className="zone-header">
            <span style={{ fontWeight: 700, color: '#f8fafc' }}>
              {opponent?.name || 'Esperando Rival...'} (Rival)
            </span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <span className={`badge-info ${!isMyTurn ? 'active-turn-badge' : ''}`}>
                {!isMyTurn ? 'Su Turno' : 'Esperando'}
              </span>
              <span className="badge-info">
                {opponent?.hand.length || 0} cartas
              </span>
              <span className="badge-info">
                {gameState.mortosTaken[opponentIndex] ? 'Muerto Tomado' : 'Muerto Pendiente'}
              </span>
            </div>
          </div>
          
          {/* Si la ronda terminó, mostrar la mano del oponente */}
          {gameState.status === 'finished' && opponent?.hand && opponent.hand.length > 0 && (
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '6px', 
              marginTop: '6px', 
              padding: '6px 10px', 
              background: 'rgba(239, 68, 68, 0.1)', 
              borderRadius: '8px', 
              border: '1px dashed rgba(239, 68, 68, 0.3)',
              justifyContent: 'center'
            }}>
              <span style={{ fontSize: '0.8rem', color: '#f87171', fontWeight: 'bold', marginRight: '6px' }}>
                Mano del Rival:
              </span>
              <div style={{ display: 'flex', overflowX: 'auto', padding: '2px' }}>
                {opponent.hand.map((card, idx) => (
                  <div 
                    key={card.id || idx}
                    style={{ 
                      marginLeft: idx === 0 ? '0px' : '-44px',
                      transform: 'scale(0.8)',
                      transformOrigin: 'left center',
                      boxShadow: '1px 0 4px rgba(0,0,0,0.3)',
                      zIndex: idx
                    }}
                  >
                    <Card card={card} isHidden={false} />
                  </div>
                ))}
              </div>
            </div>
          )}
          
          <MeldArea 
            melds={opponent?.melds || []} 
            isOpponent={true} 
          />
        </div>

        {/* CENTRO DE MESA (MAZO Y POZO) */}
        <div className="table-center">
          
          {/* Mazo de robo */}
          <div className="deck-pile">
            <span className="pile-title">Mazo</span>
            <div 
              className="pile-card playing-card card-back" 
              onClick={isMyTurn && needToDraw ? handleDrawCard : null}
              style={{ cursor: isMyTurn && needToDraw ? 'pointer' : 'default' }}
            >
              <div className="card-back-pattern"></div>
              {gameState.drawPile.length > 0 && (
                <div className="deck-count">{gameState.drawPile.length}</div>
              )}
            </div>
          </div>

          {/* Pozo de descarte */}
          <div className="discard-pile-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <span className="pile-title" style={{ marginBottom: '4px' }}>
              Pozo ({gameState.discardPile.length} {gameState.discardPile.length === 1 ? 'carta' : 'cartas'})
            </span>
            {gameState.discardPile.length > 0 ? (
              <div 
                className="discard-fan-container" 
                onClick={isMyTurn && needToDraw && myPlayer?.melds.length > 0 ? handleDrawDiscard : null}
                style={{ 
                  cursor: isMyTurn && needToDraw && myPlayer?.melds.length > 0 ? 'pointer' : 'not-allowed',
                  display: 'flex',
                  overflowX: 'auto',
                  overflowY: 'hidden',
                  maxWidth: '450px',
                  minWidth: '82px',
                  height: '95px', /* Reducido de 118px */
                  padding: '4px 6px',
                  background: 'rgba(0, 0, 0, 0.25)',
                  borderRadius: '12px',
                  border: '1px solid var(--glass-border)',
                  alignItems: 'center'
                }}
                title={myPlayer?.melds.length === 0 ? "No puedes robar del pozo hasta haber bajado al menos un juego" : ""}
              >
                {(() => {
                  const list = animatingDiscard ? gameState.discardPile.slice(0, -1) : gameState.discardPile;
                  return list.map((card, idx) => (
                    <div 
                      key={card.id || idx}
                      style={{
                        marginRight: idx === list.length - 1 ? '0px' : '-40px',
                        boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                        pointerEvents: 'none',
                        zIndex: idx
                      }}
                    >
                      <Card card={card} isHidden={false} />
                    </div>
                  ));
                })()}
              </div>
            ) : (
              <div 
                className="playing-card" 
                style={{ 
                  width: '58px', /* Reducido de 72px */
                  height: '85px', /* Reducido de 106px */
                  background: 'rgba(0,0,0,0.15)', 
                  border: '2px dashed rgba(255,255,255,0.1)', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  color: '#64748b',
                  fontSize: '0.7rem',
                  borderRadius: '8px'
                }}
              >
                Vacío
              </div>
            )}
          </div>

          {/* Muertos disponibles */}
          <div className="morto-indicator">
            <span>Muertos:</span>
            <div className="morto-card-stack">
              <div className={`morto-dot ${gameState.mortos[0] ? '' : 'taken'}`} title={gameState.mortos[0] ? 'Muerto 1 listo' : 'Muerto 1 tomado'}></div>
              <div className={`morto-dot ${gameState.mortos[1] ? '' : 'taken'}`} title={gameState.mortos[1] ? 'Muerto 2 listo' : 'Muerto 2 tomado'}></div>
            </div>
          </div>
        </div>

        {/* MI ZONA DE JUEGOS BAJADOS */}
        <div className="player-zone">
          <div className="zone-header">
            <span style={{ fontWeight: 700, color: '#f8fafc' }}>
              Tus Juegos Bajados
            </span>
            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
              {selectedMeldIndex !== null ? 'Seleccionado para acoplar cartas' : 'Hacé click en un juego para agregarle cartas'}
            </span>
          </div>
          
          <MeldArea 
            melds={myPlayer?.melds || []} 
            onMeldClick={(idx) => setSelectedMeldIndex(prev => prev === idx ? null : idx)}
            selectedMeldIndex={selectedMeldIndex}
            isOpponent={false} 
          />
        </div>

        {/* Carta animada de descarte volador */}
        {animatingDiscard && (
          <div className={`discard-animation-card ${animatingDiscard.fromOpponent ? 'from-opponent' : 'from-player'}`}>
            <Card card={animatingDiscard.card} isHidden={false} />
          </div>
        )}

      </div>

      {/* MI MANO Y ACCIONES (PARTE INFERIOR) */}
      <div className="player-hand-container">
        {/* Visualización de Cartas en Mano */}
        <div className="hand-scroll-area">
          {localHand.map((card, idx) => {
            const isFirstDrawn = gameState.isFirstTurn && isMyTurn && card.id === gameState.firstDrawnCardId;
            return (
              <div 
                key={card.id} 
                draggable={true}
                onDragStart={(e) => handleDragStart(e, idx)}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, idx)}
                onDragEnd={handleDragEnd}
                style={{ 
                  position: 'relative',
                  cursor: 'grab',
                  opacity: draggedIndex === idx ? 0.3 : 1,
                  transition: 'opacity 0.15s, transform 0.2s, box-shadow 0.2s',
                  ...(isFirstDrawn ? {
                    boxShadow: '0 0 15px #fbbf24',
                    borderRadius: '8px',
                    transform: 'translateY(-15px)',
                    zIndex: 10
                  } : {})
                }}
              >
                <Card 
                  card={card}
                  onClick={() => handleCardClick(card.id)}
                  selected={selectedCardIds.includes(card.id)}
                  isHidden={false}
                />
                {isFirstDrawn && (
                  <div style={{
                    position: 'absolute',
                    top: '-25px',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    backgroundColor: '#fbbf24',
                    color: '#0f172a',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    fontSize: '0.65rem',
                    fontWeight: 'bold',
                    whiteSpace: 'nowrap',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                    zIndex: 20
                  }}>
                    Robada
                  </div>
                )}
              </div>
            );
          })}
          {localHand.length === 0 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', color: '#64748b', fontStyle: 'italic', fontSize: '0.9rem' }}>
              Mano vacía
            </div>
          )}
        </div>
      </div>

      {/* ACCIONES DEL JUGADOR (ABAJO A LA DERECHA, AL LADO DE LA MANO) */}
      <div className="player-actions-container">
        {/* Turno e Info Muerto (Muy compactos) */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
          <span className={`badge-info ${isMyTurn ? 'active-turn-badge' : ''}`} style={{ fontSize: '0.65rem', padding: '3px 6px', fontWeight: 'bold', borderRadius: '4px', flexGrow: 1, textAlign: 'center', whiteSpace: 'nowrap' }}>
            {isMyTurn ? (needToDraw ? '🚨 ROBAR' : '👉 JUGAR') : '⏳ RIVAL'}
          </span>
          <span style={{ fontSize: '0.65rem', color: myPlayer?.hasTakenMorto ? '#10b981' : '#fbbf24', fontWeight: 600, padding: '3px 6px', background: 'rgba(0,0,0,0.2)', borderRadius: '4px', whiteSpace: 'nowrap' }}>
            {myPlayer?.hasTakenMorto ? 'Con Muerto' : 'Sin Muerto'}
          </span>
        </div>

        {/* Botones de acción */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {/* Fase de Robo */}
          {isMyTurn && needToDraw && (
            <div style={{ display: 'flex', gap: '4px' }}>
              <button 
                className="btn-action btn-blue" 
                onClick={handleDrawCard}
                style={{ flex: 1, fontSize: '0.75rem', padding: '4px 6px', height: '28px', justifyContent: 'center' }}
              >
                <ArrowDown size={12} style={{ marginRight: '4px' }} /> Mazo
              </button>
              <button 
                className="btn-action btn-blue" 
                onClick={handleDrawDiscard}
                disabled={myPlayer?.melds.length === 0}
                style={{ 
                  flex: 1, 
                  fontSize: '0.75rem', 
                  padding: '4px 6px', 
                  height: '28px', 
                  justifyContent: 'center',
                  opacity: myPlayer?.melds.length === 0 ? 0.5 : 1
                }}
                title={myPlayer?.melds.length === 0 ? "Bájate primero" : `Robar pozo (${gameState.discardPile.length})`}
              >
                <ArrowDown size={12} style={{ marginRight: '4px' }} /> Pozo ({gameState.discardPile.length})
              </button>
            </div>
          )}

          {/* Fase de Juego */}
          {canPlay && (
            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              <button 
                className="btn-action btn-green" 
                onClick={handleMeldSequence}
                disabled={selectedCardIds.length < 3}
                style={{ flex: '1 1 48%', fontSize: '0.7rem', padding: '4px 4px', height: '26px', justifyContent: 'center' }}
              >
                <PlusCircle size={12} style={{ marginRight: '2px' }} /> Bajar
              </button>
              <button 
                className="btn-action btn-green" 
                onClick={handleAppendToMeld}
                disabled={selectedMeldIndex === null || selectedCardIds.length === 0}
                style={{ flex: '1 1 48%', fontSize: '0.7rem', padding: '4px 4px', height: '26px', justifyContent: 'center' }}
              >
                <FolderPlus size={12} style={{ marginRight: '2px' }} /> Acoplar ({selectedCardIds.length})
              </button>
              <button 
                className="btn-action btn-red" 
                onClick={handleDiscard}
                disabled={selectedCardIds.length !== 1}
                style={{ flex: '1 1 98%', fontSize: '0.7rem', padding: '4px 4px', height: '26px', justifyContent: 'center' }}
              >
                <ArrowUp size={12} style={{ marginRight: '4px' }} /> Descartar
              </button>
            </div>
          )}

          {/* Botón de Ordenar (Siempre visible, ultra compacto) */}
          <button 
            className="btn-action btn-gray" 
            onClick={handleSortHand}
            disabled={localHand.length === 0}
            style={{ width: '100%', fontSize: '0.75rem', padding: '4px 6px', height: '26px', justifyContent: 'center' }}
          >
            <SortAsc size={12} style={{ marginRight: '4px' }} /> Ordenar Mano
          </button>
        </div>
      </div>

      {/* PANEL LATERAL (INFORMACION, LOGS Y PUNTAJES) */}
      <div className="sidebar">
        
        {/* Info general */}
        <div className="sidebar-section" style={{ background: 'rgba(0,0,0,0.15)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontWeight: 800, color: '#10b981' }}>SALA ACTIVA</span>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button className="btn-header" onClick={handleRestart} title="Reiniciar ronda actual">
                <RefreshCw size={14} />
              </button>
              <button className="btn-header" onClick={handleResetAll} title="Resetear puntos globales">
                Reset General
              </button>
            </div>
          </div>
          <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
            Jugadores: <span style={{ color: '#fff', fontWeight: 600 }}>{lobbyPlayers.join(' vs ')}</span>
          </div>
          <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '4px' }}>
            Requisito: <span style={{ color: '#fbbf24', fontWeight: 600 }}>{gameState.requiredCanastras || 1} {gameState.requiredCanastras === 1 ? 'Canastra' : 'Canastras'} para ganar</span>
          </div>
        </div>


        {/* Planilla Histórica de Rondas */}
        {gameState.roundHistory && gameState.roundHistory.length > 0 && (
          <div className="sidebar-section" style={{ borderTop: '1px solid var(--glass-border)' }}>
            <h2 className="sidebar-title" style={{ color: '#34d399', marginBottom: '8px' }}>Planilla de Rondas</h2>
            <div style={{ maxHeight: '140px', overflowY: 'auto', fontSize: '0.8rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8' }}>
                    <th style={{ padding: '4px' }}>Ronda</th>
                    <th style={{ padding: '4px' }}>{gameState.players?.[0]?.name || 'J1'}</th>
                    <th style={{ padding: '4px' }}>{gameState.players?.[1]?.name || 'J2'}</th>
                  </tr>
                </thead>
                <tbody>
                  {gameState.roundHistory && gameState.roundHistory.map((rh, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                      <td style={{ padding: '4px', fontWeight: 'bold' }}>R{rh.round}</td>
                      <td style={{ padding: '4px', color: (rh.totals?.[0] || 0) >= 0 ? '#34d399' : '#ef4444' }}>
                        {(rh.totals?.[0] || 0) >= 0 ? `+${rh.totals?.[0] || 0}` : rh.totals?.[0] || 0}
                      </td>
                      <td style={{ padding: '4px', color: (rh.totals?.[1] || 0) >= 0 ? '#34d399' : '#ef4444' }}>
                        {(rh.totals?.[1] || 0) >= 0 ? `+${rh.totals?.[1] || 0}` : rh.totals?.[1] || 0}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tabla de puntajes */}
        <Scoreboard gameState={gameState} playerIndex={playerIndex} />

        {/* Historial de Acciones / Log de Turnos */}
        <div className="sidebar-section" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <h2 className="sidebar-title" style={{ marginBottom: '6px' }}>Historial</h2>
          <div className="action-log">
            {logs.map((log, idx) => (
              <div key={idx} className="log-entry">
                {log}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>

      </div>

      {/* MODAL DE FIN DE PARTIDA / RONDA - PLANILLA EDITABLE */}
      {gameState.status === 'finished' && (
        <div className="modal-overlay">
          {gameState.turnState === 'match-over' ? (
            <div className="modal-content glass-panel" style={{ maxWidth: '500px', padding: '28px', textAlign: 'center' }}>
              <div style={{ fontSize: '3rem', marginBottom: '10px' }}>🏆</div>
              <h2 className="modal-title" style={{ fontSize: '1.8rem', color: '#f59e0b', marginBottom: '8px' }}>
                ¡Partida Finalizada!
              </h2>
              <p style={{ color: '#fff', fontSize: '1.1rem', marginBottom: '16px' }}>
                El ganador es <strong>{gameState.players?.[gameState.winner]?.name || 'Desconocido'}</strong> con <strong>{gameState.scores?.[gameState.winner] || 0}</strong> puntos.
              </p>
              
              <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '12px', padding: '16px', marginBottom: '24px' }}>
                <h3 style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Puntajes Finales</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', fontSize: '1.2rem', fontWeight: 'bold' }}>
                  <div style={{ color: '#10b981' }}>
                    <div style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 'normal' }}>{gameState.players?.[0]?.name || 'Jugador 1'}</div>
                    {gameState.scores?.[0] || 0} pts
                  </div>
                  <div style={{ color: '#3b82f6' }}>
                    <div style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 'normal' }}>{gameState.players?.[1]?.name || 'Jugador 2'}</div>
                    {gameState.scores?.[1] || 0} pts
                  </div>
                </div>
              </div>

              {gameState.roundHistory && gameState.roundHistory.length > 0 && (
                <div style={{ maxHeight: '180px', overflowY: 'auto', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', padding: '10px', marginBottom: '24px' }}>
                  <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8' }}>
                        <th style={{ padding: '6px 4px', textAlign: 'center' }}>Ronda</th>
                        <th style={{ padding: '6px 4px', textAlign: 'center' }}>{gameState.players?.[0]?.name || 'J1'}</th>
                        <th style={{ padding: '6px 4px', textAlign: 'center' }}>{gameState.players?.[1]?.name || 'J2'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gameState.roundHistory.map((rh, index) => (
                        <tr key={index} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                          <td style={{ padding: '6px 4px', textAlign: 'center', color: '#94a3b8' }}>#{rh.round}</td>
                          <td style={{ padding: '6px 4px', textAlign: 'center', color: '#10b981' }}>{rh.totals?.[0] || 0} pts ({rh.accumulated?.[0] || 0})</td>
                          <td style={{ padding: '6px 4px', textAlign: 'center', color: '#3b82f6' }}>{rh.totals?.[1] || 0} pts ({rh.accumulated?.[1] || 0})</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <button 
                className="btn-primary" 
                onClick={() => onAction('reset-game')}
                style={{ width: '100%', padding: '12px', fontSize: '1rem', background: 'linear-gradient(135deg, #f59e0b, #d97706)', border: 'none' }}
              >
                Jugar Otra Partida
              </button>
            </div>
          ) : (
            <div className="modal-content glass-panel" style={{ maxWidth: '640px', padding: '24px' }}>
              <h2 className="modal-title" style={{ fontSize: '1.8rem', marginBottom: '4px' }}>Anotación de la Ronda</h2>
              <p style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '16px' }}>
                Verificá y editá los puntos de la ronda antes de anotarla en la planilla.
              </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr', gap: '10px', alignItems: 'center', textAlign: 'left', marginBottom: '12px' }}>
              <span style={{ fontWeight: 'bold', color: '#94a3b8', fontSize: '0.85rem' }}>Concepto</span>
              <span style={{ fontWeight: 'bold', color: '#10b981', textAlign: 'center', fontSize: '0.85rem' }}>{gameState.players?.[0]?.name || 'J1'}</span>
              <span style={{ fontWeight: 'bold', color: '#3b82f6', textAlign: 'center', fontSize: '0.85rem' }}>{gameState.players?.[1]?.name || 'J2'}</span>
              
              {/* Puntos en Mesa */}
              <span style={{ fontSize: '0.9rem' }}>Puntos en Mesa (bajada)</span>
              <input 
                type="number" 
                className="input-text" 
                style={{ padding: '6px 8px', fontSize: '0.9rem', textAlign: 'center' }} 
                value={scoreForm.p0Mesa}
                onChange={(e) => setScoreForm(prev => ({ ...prev, p0Mesa: Number(e.target.value) }))}
              />
              <input 
                type="number" 
                className="input-text" 
                style={{ padding: '6px 8px', fontSize: '0.9rem', textAlign: 'center' }} 
                value={scoreForm.p1Mesa}
                onChange={(e) => setScoreForm(prev => ({ ...prev, p1Mesa: Number(e.target.value) }))}
              />

              {/* Canastras Limpias */}
              <span style={{ fontSize: '0.9rem' }}>Canastras Limpias (x200)</span>
              <input 
                type="number" 
                className="input-text" 
                style={{ padding: '6px 8px', fontSize: '0.9rem', textAlign: 'center' }} 
                value={scoreForm.p0Limpias}
                onChange={(e) => setScoreForm(prev => ({ ...prev, p0Limpias: Number(e.target.value) }))}
              />
              <input 
                type="number" 
                className="input-text" 
                style={{ padding: '6px 8px', fontSize: '0.9rem', textAlign: 'center' }} 
                value={scoreForm.p1Limpias}
                onChange={(e) => setScoreForm(prev => ({ ...prev, p1Limpias: Number(e.target.value) }))}
              />

              {/* Canastras Sucias */}
              <span style={{ fontSize: '0.9rem' }}>Canastras Sucias (x100)</span>
              <input 
                type="number" 
                className="input-text" 
                style={{ padding: '6px 8px', fontSize: '0.9rem', textAlign: 'center' }} 
                value={scoreForm.p0Sucias}
                onChange={(e) => setScoreForm(prev => ({ ...prev, p0Sucias: Number(e.target.value) }))}
              />
              <input 
                type="number" 
                className="input-text" 
                style={{ padding: '6px 8px', fontSize: '0.9rem', textAlign: 'center' }} 
                value={scoreForm.p1Sucias}
                onChange={(e) => setScoreForm(prev => ({ ...prev, p1Sucias: Number(e.target.value) }))}
              />

              {/* Puntos en Mano */}
              <span style={{ fontSize: '0.9rem' }}>Cartas en Mano (restan)</span>
              <input 
                type="number" 
                className="input-text" 
                style={{ padding: '6px 8px', fontSize: '0.9rem', textAlign: 'center' }} 
                value={scoreForm.p0Mano}
                onChange={(e) => setScoreForm(prev => ({ ...prev, p0Mano: Number(e.target.value) }))}
              />
              <input 
                type="number" 
                className="input-text" 
                style={{ padding: '6px 8px', fontSize: '0.9rem', textAlign: 'center' }} 
                value={scoreForm.p1Mano}
                onChange={(e) => setScoreForm(prev => ({ ...prev, p1Mano: Number(e.target.value) }))}
              />

              {/* Cierre / Batida */}
              <span style={{ fontSize: '0.9rem' }}>Bono Cierre (+100)</span>
              <div style={{ textAlign: 'center' }}>
                <input 
                  type="checkbox" 
                  style={{ transform: 'scale(1.3)', cursor: 'pointer' }}
                  checked={scoreForm.p0Cierre}
                  onChange={(e) => setScoreForm(prev => ({ ...prev, p0Cierre: e.target.checked, p1Cierre: e.target.checked ? false : prev.p1Cierre }))}
                />
              </div>
              <div style={{ textAlign: 'center' }}>
                <input 
                  type="checkbox" 
                  style={{ transform: 'scale(1.3)', cursor: 'pointer' }}
                  checked={scoreForm.p1Cierre}
                  onChange={(e) => setScoreForm(prev => ({ ...prev, p1Cierre: e.target.checked, p0Cierre: e.target.checked ? false : prev.p0Cierre }))}
                />
              </div>

              {/* Castigo Sin Muerto */}
              <span style={{ fontSize: '0.9rem' }}>Castigo Sin Muerto (-100)</span>
              <div style={{ textAlign: 'center' }}>
                <input 
                  type="checkbox" 
                  style={{ transform: 'scale(1.3)', cursor: 'pointer' }}
                  checked={scoreForm.p0SinMuerto}
                  onChange={(e) => setScoreForm(prev => ({ ...prev, p0SinMuerto: e.target.checked }))}
                />
              </div>
              <div style={{ textAlign: 'center' }}>
                <input 
                  type="checkbox" 
                  style={{ transform: 'scale(1.3)', cursor: 'pointer' }}
                  checked={scoreForm.p1SinMuerto}
                  onChange={(e) => setScoreForm(prev => ({ ...prev, p1SinMuerto: e.target.checked }))}
                />
              </div>

              {/* Totales Calculados */}
              <span style={{ fontWeight: 'bold', fontSize: '1rem', borderTop: '1.5px solid var(--glass-border)', paddingTop: '10px' }}>Total de Ronda</span>
              <span style={{ 
                fontWeight: 'bold', 
                fontSize: '1.1rem', 
                textAlign: 'center', 
                borderTop: '1.5px solid var(--glass-border)', 
                paddingTop: '10px',
                color: calcTotal(scoreForm.p0Mesa, scoreForm.p0Limpias, scoreForm.p0Sucias, scoreForm.p0Mano, scoreForm.p0Cierre, scoreForm.p0SinMuerto) >= 0 ? '#34d399' : '#ef4444'
              }}>
                {calcTotal(scoreForm.p0Mesa, scoreForm.p0Limpias, scoreForm.p0Sucias, scoreForm.p0Mano, scoreForm.p0Cierre, scoreForm.p0SinMuerto)} pts
              </span>
              <span style={{ 
                fontWeight: 'bold', 
                fontSize: '1.1rem', 
                textAlign: 'center', 
                borderTop: '1.5px solid var(--glass-border)', 
                paddingTop: '10px',
                color: calcTotal(scoreForm.p1Mesa, scoreForm.p1Limpias, scoreForm.p1Sucias, scoreForm.p1Mano, scoreForm.p1Cierre, scoreForm.p1SinMuerto) >= 0 ? '#34d399' : '#ef4444'
              }}>
                {calcTotal(scoreForm.p1Mesa, scoreForm.p1Limpias, scoreForm.p1Sucias, scoreForm.p1Mano, scoreForm.p1Cierre, scoreForm.p1SinMuerto)} pts
              </span>
            </div>

            <div style={{ display: 'flex', gap: '12px', marginTop: '20px', justifyContent: 'center' }}>
              <button 
                className="btn-primary" 
                onClick={() => {
                  const p0RoundTotal = calcTotal(scoreForm.p0Mesa, scoreForm.p0Limpias, scoreForm.p0Sucias, scoreForm.p0Mano, scoreForm.p0Cierre, scoreForm.p0SinMuerto);
                  const p1RoundTotal = calcTotal(scoreForm.p1Mesa, scoreForm.p1Limpias, scoreForm.p1Sucias, scoreForm.p1Mano, scoreForm.p1Cierre, scoreForm.p1SinMuerto);

                  const roundBreakdown = {
                    p0: {
                      meldPoints: Number(scoreForm.p0Mesa),
                      cleanCanastras: Number(scoreForm.p0Limpias),
                      dirtyCanastras: Number(scoreForm.p0Sucias),
                      handPoints: Number(scoreForm.p0Mano),
                      goOutBonus: scoreForm.p0Cierre ? 100 : 0,
                      mortoPenalty: scoreForm.p0SinMuerto ? -100 : 0,
                      roundTotal: p0RoundTotal
                    },
                    p1: {
                      meldPoints: Number(scoreForm.p1Mesa),
                      cleanCanastras: Number(scoreForm.p1Limpias),
                      dirtyCanastras: Number(scoreForm.p1Sucias),
                      handPoints: Number(scoreForm.p1Mano),
                      goOutBonus: scoreForm.p1Cierre ? 100 : 0,
                      mortoPenalty: scoreForm.p1SinMuerto ? -100 : 0,
                      roundTotal: p1RoundTotal
                    }
                  };

                  onAction('confirm-round-scores', { roundBreakdown });
                }}
                style={{ flexGrow: 1 }}
              >
                Confirmar y Anotar Ronda
              </button>
              
              <button 
                className="btn-action btn-gray" 
                onClick={() => onAction('restart-round')}
                style={{ padding: '0 20px' }}
              >
                Anular Ronda
              </button>
            </div>
          </div>
          )}
        </div>
      )}

      {gameState.isFirstTurn && isMyTurn && gameState.firstDrawnCardId && (
        <div style={{
          position: 'fixed',
          bottom: '180px',
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
          border: '2px solid #fbbf24',
          borderRadius: '12px',
          padding: '16px 24px',
          boxShadow: '0 10px 25px -5px rgba(0,0,0,0.5)',
          zIndex: 1000,
          textAlign: 'center',
          backdropFilter: 'blur(8px)',
          animation: 'fadeIn 0.3s ease-out'
        }}>
          <p style={{ margin: '0 0 12px 0', fontSize: '0.95rem', fontWeight: 600, color: '#f8fafc' }}>
            ¿Querés conservar la carta que robaste o descartarla y robar otra?
          </p>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
            <button 
              className="btn-action btn-green" 
              onClick={() => onAction('keep-first-card')}
              style={{ padding: '8px 16px', fontSize: '0.9rem' }}
            >
              Conservar Carta
            </button>
            <button 
              className="btn-action btn-red" 
              onClick={() => onAction('reject-first-card')}
              style={{ padding: '8px 16px', fontSize: '0.9rem' }}
            >
              Descartar y Robar Otra
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
