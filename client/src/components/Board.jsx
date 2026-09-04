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

const getTeamOwnerIndex = (idx, is4Player) => {
  if (!is4Player) return idx;
  return idx === 0 || idx === 2 ? 0 : 1;
};

export default function Board({ gameState, playerIndex, onAction, lobbyPlayers, isDevAuthorized, onToggleDevAuth }) {
  const [prevGameState, setPrevGameState] = useState(null);
  const [animatingDiscard, setAnimatingDiscard] = useState(null);
  const [newlyAddedCardIds, setNewlyAddedCardIds] = useState(new Set());
  const highlightTimerRef = React.useRef(null);

  useEffect(() => {
    if (gameState) {
      if (prevGameState) {
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

        // Detectar cartas nuevas acopladas o bajadas para resaltarlas
        const prevIds = new Set();
        prevGameState.players?.forEach(p => {
          p.melds?.forEach(meld => {
            meld?.forEach(c => { if (c?.id) prevIds.add(c.id); });
          });
        });
        
        const newAdded = new Set();
        gameState.players?.forEach(p => {
          p.melds?.forEach(meld => {
            meld?.forEach(c => {
              if (c?.id && !prevIds.has(c.id)) {
                newAdded.add(c.id);
              }
            });
          });
        });
        
        if (newAdded.size > 0) {
          setNewlyAddedCardIds(newAdded);
          if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
          highlightTimerRef.current = setTimeout(() => {
            setNewlyAddedCardIds(new Set());
          }, 2200);
        }
      }
      setPrevGameState(gameState);
    }
  }, [gameState, prevGameState, playerIndex]);

  // Limpiar timer al desmontar
  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []);

  const [selectedCardIds, setSelectedCardIds] = useState([]);
  const [selectedMeldIndex, setSelectedMeldIndex] = useState(null);
  const [localHand, setLocalHand] = useState([]);
  const [logs, setLogs] = useState([]);
  const [startingAlert, setStartingAlert] = useState('');
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [activeTab, setActiveTab] = useState('detalle');
  const [isDevMode, setIsDevMode] = useState(() => localStorage.getItem('buraco_dev_mode') !== 'false');
  const [mortoBanner, setMortoBanner] = useState(null);
  const lastMortoAlertTimestampRef = useRef(0);

  useEffect(() => {
    if (isDevAuthorized) {
      setIsDevMode(true);
      localStorage.setItem('buraco_dev_mode', 'true');
    }
  }, [isDevAuthorized]);

  const renderSidebarSeat = (idx, posStyle) => {
    const player = gameState?.players?.[idx];
    if (!player) return null;

    const isCurrentTurn = gameState.turn === idx;
    const teamIdx = getTeamOwnerIndex(idx, is4P);
    const tookMorto = is4P ? gameState.mortosTaken?.[teamIdx] === idx : false;
    
    const cardinalNames = ['SUR', 'ESTE', 'NORTE', 'OESTE'];
    const isMe = idx === safePlayerIndex;
    const label = cardinalNames[idx] + (isMe ? ' (Tú)' : '');

    return (
      <div style={{
        position: 'absolute',
        width: '78px',
        background: isCurrentTurn ? 'rgba(251, 191, 36, 0.95)' : 'rgba(15, 23, 42, 0.92)',
        border: isCurrentTurn ? '1.5px solid #fbbf24' : '1px solid rgba(255,255,255,0.12)',
        borderRadius: '6px',
        padding: '4px',
        boxShadow: isCurrentTurn ? '0 0 8px rgba(251, 191, 36, 0.5)' : '0 2px 4px rgba(0,0,0,0.4)',
        color: isCurrentTurn ? '#000' : '#fff',
        fontSize: '0.62rem',
        textAlign: 'center',
        zIndex: 10,
        lineHeight: '1.2',
        ...posStyle
      }}>
        <div style={{
          fontWeight: '800',
          color: isCurrentTurn ? '#000' : '#c084fc',
          fontSize: '0.52rem',
          letterSpacing: '0.5px'
        }}>
          {label}
        </div>
        <div style={{
          fontWeight: '700',
          margin: '1px 0',
          textOverflow: 'ellipsis',
          overflow: 'hidden',
          whiteSpace: 'nowrap'
        }}>
          {player.name}
        </div>
        <div style={{ fontSize: '0.58rem', fontWeight: 'bold' }}>
          🎴 {player.hand?.length || 0}
        </div>
        <div style={{
          fontSize: '0.5rem',
          fontWeight: '600',
          color: tookMorto ? (isCurrentTurn ? '#065f46' : '#34d399') : (isCurrentTurn ? '#4b5563' : '#94a3b8'),
          marginTop: '1px'
        }}>
          {tookMorto ? 'Con Muerto' : 'Sin Muerto'}
        </div>
      </div>
    );
  };

  const [scoreForm, setScoreForm] = useState({
    p0Mesa: 0, p0Limpias: 0, p0Sucias: 0, p0Mano: 0, p0Cierre: false, p0SinMuerto: false,
    p1Mesa: 0, p1Limpias: 0, p1Sucias: 0, p1Mano: 0, p1Cierre: false, p1SinMuerto: false
  });

  const logEndRef = useRef(null);

  const safePlayerIndex = typeof playerIndex === 'number' ? playerIndex : 0;
  const is4P = gameState?.is4Player;
  const myTeamIdx = getTeamOwnerIndex(safePlayerIndex, is4P);
  const oppTeamIdx = is4P ? (myTeamIdx === 0 ? 1 : 0) : (safePlayerIndex === 0 ? 1 : 0);
  
  const myPlayer = gameState?.players?.[safePlayerIndex];
  const myHand = myPlayer?.hand || [];
  const opponentIndex = safePlayerIndex === 0 ? 1 : 0;
  const opponent = gameState?.players?.[opponentIndex];

  // Asignar asientos en 4P
  const leftOppIndex = is4P ? (safePlayerIndex + 1) % 4 : null;
  const partnerIndex = is4P ? (safePlayerIndex + 2) % 4 : null;
  const rightOppIndex = is4P ? (safePlayerIndex + 3) % 4 : null;

  // Rellenar formulario de anotación al terminar la ronda
  useEffect(() => {
    if (gameState?.status === 'finished') {
      const getDefaults = (teamIdx) => {
        const teamOwner = getTeamOwnerIndex(teamIdx, is4P);
        const player = gameState.players?.[teamOwner] || { melds: [], hand: [] };
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
        const playersInTeam = is4P ? [teamIdx, teamIdx + 2] : [teamIdx];
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
        const winner = gameState.winner;
        let isWinner = false;
        if (winner !== null) {
          const winnerTeam = is4P ? (winner === 0 || winner === 2 ? 0 : 1) : winner;
          isWinner = winnerTeam === teamIdx;
        }

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

  // Limpiar IDs seleccionados de cartas que ya no están en la mano
  useEffect(() => {
    const currentHandIds = new Set(localHand.map(c => c.id));
    setSelectedCardIds(prev => prev.filter(id => currentHandIds.has(id)));
  }, [localHand]);

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

  // Alerta destacada (cartel bonito flotante) cuando cualquier jugador toma el muerto
  const mortoTimerRef = useRef(null);
  useEffect(() => {
    const alertData = gameState?.mortoAlert;
    if (alertData?.timestamp && alertData.timestamp !== lastMortoAlertTimestampRef.current) {
      lastMortoAlertTimestampRef.current = alertData.timestamp;
      setMortoBanner(alertData);
      if (mortoTimerRef.current) clearTimeout(mortoTimerRef.current);
      mortoTimerRef.current = setTimeout(() => {
        setMortoBanner(null);
      }, 3500);
    }
  }, [gameState?.mortoAlert?.timestamp]);

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

  const handleDropOnMeld = (e, meldIndex) => {
    e.preventDefault();
    if (draggedIndex === null) return;
    const card = localHand[draggedIndex];
    if (!card) return;

    onAction('append-to-meld', { 
      meldIndex: meldIndex, 
      cards: [card] 
    });
    setDraggedIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  if (!gameState) return null;

  const isMyTurn = gameState.turn === playerIndex && !animatingDiscard;
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

  const handleEditTargetScore = () => {
    if (gameState.status === 'finished') return;
    const newScoreStr = window.prompt(
      "Modificar meta de puntos de la partida:", 
      gameState.targetScore || 3000
    );
    if (newScoreStr === null) return;
    const newScore = parseInt(newScoreStr, 10);
    if (!isNaN(newScore) && newScore > 0) {
      onAction('change-target-score', { newTargetScore: newScore });
    } else {
      alert("Por favor ingresa un número válido mayor a 0.");
    }
  };

  // Obtener última carta del pozo
  const lastDiscardCard = gameState.discardPile.length > 0 
    ? gameState.discardPile[gameState.discardPile.length - 1] 
    : null;

  const myMeldsList = is4P ? gameState.players?.[myTeamIdx]?.melds : myPlayer?.melds || [];
  const opponentMeldsList = is4P ? gameState.players?.[oppTeamIdx]?.melds : opponent?.melds || [];
  const myMeldsHeaderTitle = is4P ? "Juegos de tu Equipo" : "Tus Juegos Bajados";
  const opponentNameText = is4P 
    ? `Juegos del Equipo Rival (${gameState.players?.[oppTeamIdx]?.name || ''} & ${gameState.players?.[oppTeamIdx + 2]?.name || ''})`
    : `${opponent?.name || 'Esperando Rival...'} (Rival)`;

  const opponentHandCountText = opponent ? `${opponent.hand?.length || 0} cartas` : '0 cartas';
  const opponentMortoTaken = is4P ? false : (opponentIndex !== null && gameState.mortosTaken ? !!gameState.mortosTaken[opponentIndex] : false);

  const myMeldPoints = myMeldsList.reduce((sum, meld) => 
    sum + meld.reduce((mSum, c) => mSum + (CARD_VALUES[c.rank] || 0), 0)
  , 0) || 0;
  const hasUnlockedDiscard = myMeldPoints >= 30;

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

      {/* CARTEL BONITO ANUNCIANDO LA TOMA DEL MUERTO (BANNER FLOTANTE SIN DESENFOQUE) */}
      {mortoBanner && (
        <div 
          className="morto-toast-container animate-fade-in"
          onClick={() => setMortoBanner(null)}
        >
          <div 
            className="morto-toast-card glass-panel"
            style={{
              background: (mortoBanner.playerIdx === safePlayerIndex || (is4P && getTeamOwnerIndex(mortoBanner.playerIdx, is4P) === myTeamIdx))
                ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.95) 0%, rgba(6, 95, 70, 0.95) 100%)'
                : 'linear-gradient(135deg, rgba(147, 51, 234, 0.95) 0%, rgba(88, 28, 135, 0.95) 100%)',
              borderColor: (mortoBanner.playerIdx === safePlayerIndex || (is4P && getTeamOwnerIndex(mortoBanner.playerIdx, is4P) === myTeamIdx))
                ? '#34d399'
                : '#c084fc',
              boxShadow: (mortoBanner.playerIdx === safePlayerIndex || (is4P && getTeamOwnerIndex(mortoBanner.playerIdx, is4P) === myTeamIdx))
                ? '0 12px 35px rgba(0,0,0,0.6), 0 0 25px rgba(16, 185, 129, 0.5)'
                : '0 12px 35px rgba(0,0,0,0.6), 0 0 25px rgba(168, 85, 247, 0.5)'
            }}
          >
            <div style={{ fontSize: '2rem', lineHeight: '1' }}>
              🎴
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', textAlign: 'left' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{
                  fontSize: '0.68rem',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                  padding: '2px 8px',
                  borderRadius: '10px',
                  background: mortoBanner.isDirect ? 'rgba(251, 191, 36, 0.3)' : 'rgba(56, 189, 248, 0.3)',
                  color: mortoBanner.isDirect ? '#fef08a' : '#e0f2fe',
                  border: `1px solid ${mortoBanner.isDirect ? '#fde047' : '#7dd3fc'}`
                }}>
                  {mortoBanner.isDirect ? '⚡ Muerto Directo' : '🔄 Muerto Indirecto'}
                </span>
                <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.75)' }}>
                  {mortoBanner.isDirect ? '(continúa jugando)' : '(próximo turno)'}
                </span>
              </div>
              <h3 style={{
                fontSize: '1.25rem',
                fontWeight: 800,
                color: '#ffffff',
                margin: 0,
                textShadow: '0 1px 4px rgba(0,0,0,0.4)'
              }}>
                ¡{mortoBanner.playerName} tomó el Muerto! (+11 cartas)
              </h3>
            </div>
            <button 
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMortoBanner(null);
              }}
              style={{
                background: 'rgba(255,255,255,0.15)',
                border: 'none',
                color: '#fff',
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.8rem',
                marginLeft: '8px'
              }}
              title="Cerrar aviso"
            >
              ✕
            </button>
          </div>
        </div>
      )}


      
      {/* AREA DE JUEGO PRINCIPAL */}
      <div className="main-playarea">
        
        {/* En modo 4 jugadores, mostramos una pequeña barra de estado arriba (opcional y compacta) */}
        {is4P && (
          <div style={{
            display: 'flex',
            justifyContent: 'space-around',
            padding: '6px 12px',
            background: 'rgba(15, 23, 42, 0.4)',
            borderRadius: '8px',
            border: '1px solid rgba(255, 255, 255, 0.05)',
            marginBottom: '6px',
            fontSize: '0.72rem',
            color: '#cbd5e1',
            gap: '8px'
          }}>
            <span>🟢 <b>{gameState.players?.[2]?.name}</b> (Norte): {gameState.players?.[2]?.hand?.length || 0} c.</span>
            <span>🔴 <b>{gameState.players?.[1]?.name}</b> (Este): {gameState.players?.[1]?.hand?.length || 0} c.</span>
            <span>🔴 <b>{gameState.players?.[3]?.name}</b> (Oeste): {gameState.players?.[3]?.hand?.length || 0} c.</span>
          </div>
        )}

        {/* ZONA RIVAL */}
        <div className="player-zone">
          <div className="zone-header">
            <span style={{ fontWeight: 700, color: '#f8fafc' }}>
              {opponentNameText}
            </span>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {!is4P && (
                <span className={`badge-info ${!isMyTurn ? 'active-turn-badge' : ''}`}>
                  {!isMyTurn ? 'Su Turno' : 'Esperando'}
                </span>
              )}
              {!is4P && (
                <span className="badge-info">
                  {opponentHandCountText}
                </span>
              )}
              <span className="badge-info">
                {opponentMortoTaken ? 'Muerto Tomado' : 'Muerto Pendiente'}
              </span>
              {/* Botón rápido para activar Modo Dev directamente con la clave o alternar si ya está activo */}
              {!isDevAuthorized ? (
                <button
                  type="button"
                  onClick={onToggleDevAuth}
                  style={{
                    padding: '3px 9px',
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    borderRadius: '6px',
                    cursor: 'pointer',
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    color: '#94a3b8',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    transition: 'all 0.2s ease'
                  }}
                  title="Ingresar clave para ver las cartas de la IA"
                >
                  <span>🔒</span>
                  <span>Ver IA</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    const next = !isDevMode;
                    setIsDevMode(next);
                    localStorage.setItem('buraco_dev_mode', next.toString());
                  }}
                  style={{
                    padding: '3px 9px',
                    fontSize: '0.72rem',
                    fontWeight: 600,
                    borderRadius: '6px',
                    cursor: 'pointer',
                    background: isDevMode ? 'rgba(14, 165, 233, 0.25)' : 'rgba(255,255,255,0.06)',
                    border: `1px solid ${isDevMode ? '#38bdf8' : 'rgba(255,255,255,0.2)'}`,
                    color: isDevMode ? '#38bdf8' : '#94a3b8',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    transition: 'all 0.2s ease'
                  }}
                  title="Alternar visibilidad de las cartas de la IA"
                >
                  <span>👁️</span>
                  <span>{isDevMode ? 'Dev IA: ON' : 'Dev IA: OFF'}</span>
                </button>
              )}
            </div>
          </div>
          
          {/* Si la ronda terminó, o si está autorizado y activo el Modo Desarrollo, mostrar la mano del oponente */}
          {(() => {
            const botPlayer = gameState?.players?.find(p => p && (p.isBot || (p.devHand && p.devHand.length > 0)));
            const targetDevCards = (opponent?.devHand && opponent.devHand.length > 0) ? opponent.devHand : (botPlayer?.devHand || []);
            const shouldShow = gameState.status === 'finished' || (isDevAuthorized && isDevMode && targetDevCards.length > 0);
            if (!shouldShow) return null;

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
                {!is4P ? (
                  (() => {
                    const rawCards = (gameState.status === 'finished' && opponent?.hand?.some(c => !c.isHidden))
                      ? opponent.hand
                      : targetDevCards;
                    if (!rawCards || rawCards.length === 0) return null;

                  // Ordenar las cartas para visualización clara en modo dev
                  const rankOrderVals = { 'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'Joker': 14 };
                  const suitOrderVals = { 'H': 1, 'D': 2, 'C': 3, 'S': 4, 'Joker': 5 };
                  const displayCards = [...rawCards].sort((a, b) => {
                    if (a.suit !== b.suit) return (suitOrderVals[a.suit] || 0) - (suitOrderVals[b.suit] || 0);
                    return (rankOrderVals[a.rank] || 0) - (rankOrderVals[b.rank] || 0);
                  });

                  const isDevActive = gameState.status !== 'finished' && isDevAuthorized && isDevMode;

                  return (
                    <div style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '8px', 
                      padding: '6px 12px', 
                      background: isDevActive ? 'rgba(14, 165, 233, 0.12)' : 'rgba(239, 68, 68, 0.1)', 
                      borderRadius: '8px', 
                      border: isDevActive ? '1px solid rgba(56, 189, 248, 0.4)' : '1px dashed rgba(239, 68, 68, 0.3)',
                      justifyContent: 'center',
                      boxShadow: isDevActive ? '0 0 12px rgba(14, 165, 233, 0.15)' : 'none'
                    }}>
                      <span style={{ 
                        fontSize: '0.8rem', 
                        color: isDevActive ? '#38bdf8' : '#f87171', 
                        fontWeight: 'bold', 
                        marginRight: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px'
                      }}>
                        {isDevActive ? (
                          <>
                            <span>🛠️</span>
                            <span>Mano IA ({displayCards.length}):</span>
                          </>
                        ) : (
                          `Mano de ${opponent.name}:`
                        )}
                      </span>
                      <div style={{ display: 'flex', overflowX: 'auto', padding: '4px 2px' }}>
                        {displayCards.map((card, idx) => (
                          <div 
                            key={card.id || idx}
                            style={{ 
                              marginLeft: idx === 0 ? '0px' : '-44px',
                              transform: 'scale(0.82)',
                              transformOrigin: 'left center',
                              boxShadow: '1px 0 6px rgba(0,0,0,0.4)',
                              zIndex: idx
                            }}
                          >
                            <Card card={card} isHidden={false} />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()
              ) : (
                [leftOppIndex, rightOppIndex].map(oppIdx => {
                  const oppPlayer = gameState.players[oppIdx];
                  if (!oppPlayer || !oppPlayer.hand || oppPlayer.hand.length === 0) return null;
                  return (
                    <div key={oppIdx} style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '6px', 
                      padding: '4px 10px', 
                      background: 'rgba(239, 68, 68, 0.08)', 
                      borderRadius: '8px', 
                      border: '1px dashed rgba(239, 68, 68, 0.25)',
                      justifyContent: 'center'
                    }}>
                      <span style={{ fontSize: '0.78rem', color: '#fca5a5', fontWeight: 'bold', marginRight: '6px' }}>
                        Mano de {oppPlayer.name}:
                      </span>
                      <div style={{ display: 'flex', overflowX: 'auto', padding: '2px' }}>
                        {oppPlayer.hand.map((card, idx) => (
                          <div 
                            key={card.id || idx}
                            style={{ 
                              marginLeft: idx === 0 ? '0px' : '-48px',
                              transform: 'scale(0.72)',
                              transformOrigin: 'left center',
                              boxShadow: '1px 0 4px rgba(0,0,0,0.2)',
                              zIndex: idx
                            }}
                          >
                            <Card card={card} isHidden={false} />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          );
        })()}
          
          <MeldArea 
            melds={opponentMeldsList} 
            isOpponent={true} 
            newlyAddedCardIds={newlyAddedCardIds}
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
                onClick={isMyTurn && needToDraw && hasUnlockedDiscard ? handleDrawDiscard : null}
                style={{ 
                  cursor: isMyTurn && needToDraw && hasUnlockedDiscard ? 'pointer' : 'not-allowed',
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
                title={!hasUnlockedDiscard ? `No puedes robar del pozo hasta haber bajado al menos 30 puntos (tienes ${myMeldPoints} pts)` : ""}
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
                      <Card card={card} isHidden={gameState.status === 'finished-visual' && idx === list.length - 1} />
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

          {/* Cartel de Ronda Finalizada (al lado del pozo) */}
          {gameState.status === 'finished-visual' && (
            <div 
              className="glass-panel" 
              style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
                alignItems: 'center',
                padding: '10px 14px',
                border: '2px solid #fbbf24',
                borderRadius: '10px',
                background: 'rgba(15, 23, 42, 0.95)',
                marginLeft: '15px',
                maxWidth: '260px',
                textAlign: 'center',
                boxShadow: '0 8px 20px rgba(0,0,0,0.6)',
                zIndex: 10
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#fbbf24', fontWeight: 'bold', fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                <span>🎴</span>
                <span>Ronda Finalizada</span>
              </div>
              <p style={{ fontSize: '0.82rem', color: '#fff', margin: '6px 0 4px 0', fontWeight: 600, lineHeight: '1.3' }}>
                ¡{gameState.players?.[gameState.cutterIndex]?.name || 'Un jugador'} ha batido la mano!
              </p>
              {(() => {
                const cutterIdx = gameState.cutterIndex !== null && typeof gameState.cutterIndex === 'number' ? gameState.cutterIndex : 0;
                const cutterTeam = gameState.is4Player ? (cutterIdx === 0 || cutterIdx === 2 ? 0 : 1) : cutterIdx;
                const cutterMelds = gameState.players?.[cutterTeam]?.melds || [];
                const cleanCount = cutterMelds.filter(m => m.length >= 7 && !m.some(c => c && c.isUsedAsWildcard)).length;
                const dirtyCount = cutterMelds.filter(m => m.length >= 7 && m.some(c => c && c.isUsedAsWildcard)).length;
                return (
                  <div style={{ fontSize: '0.74rem', color: '#cbd5e1', marginBottom: '8px', background: 'rgba(255,255,255,0.05)', padding: '3px 8px', borderRadius: '4px' }}>
                    Canastas: {cleanCount > 0 ? `${cleanCount} Limpia` : ''}{cleanCount > 0 && dirtyCount > 0 ? ', ' : ''}{dirtyCount > 0 ? `${dirtyCount} Sucia` : ''}{cleanCount === 0 && dirtyCount === 0 ? 'Sin canastas' : ''}
                  </div>
                );
              })()}
              <button 
                className="btn-primary" 
                onClick={() => onAction('show-scores-sheet')}
                style={{ 
                  width: '100%', 
                  padding: '6px 12px', 
                  fontSize: '0.78rem', 
                  background: 'linear-gradient(135deg, #fbbf24 0%, #d97706 100%)', 
                  border: 'none', 
                  color: '#000',
                  fontWeight: 'bold',
                  borderRadius: '5px',
                  cursor: 'pointer'
                }}
              >
                Ver Puntajes 📊
              </button>
            </div>
          )}
        </div>

        {/* MI ZONA DE JUEGOS BAJADOS */}
        <div className="player-zone">
          <div className="zone-header">
            <span style={{ fontWeight: 700, color: '#f8fafc' }}>
              {myMeldsHeaderTitle}
            </span>
            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
              {selectedMeldIndex !== null ? 'Seleccionado para acoplar cartas' : 'Hacé click en un juego para agregarle cartas'}
            </span>
          </div>
          
          <MeldArea 
            melds={myMeldsList} 
            onMeldClick={(idx) => setSelectedMeldIndex(prev => prev === idx ? null : idx)}
            selectedMeldIndex={selectedMeldIndex}
            isOpponent={false} 
            onDropOnMeld={handleDropOnMeld}
            newlyAddedCardIds={newlyAddedCardIds}
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
        {/* Turno e Info Muerto (Botones y texto más legibles) */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
          <span className={`badge-info ${isMyTurn ? 'active-turn-badge' : ''}`} style={{ fontSize: '0.75rem', padding: '4px 8px', fontWeight: 'bold', borderRadius: '4px', flexGrow: 1, textAlign: 'center', whiteSpace: 'nowrap' }}>
            {isMyTurn ? (needToDraw ? '🚨 ROBAR' : '👉 JUGAR') : '⏳ RIVAL'}
          </span>
          <span style={{ fontSize: '0.75rem', color: myPlayer?.hasTakenMorto ? '#10b981' : '#fbbf24', fontWeight: 600, padding: '4px 8px', background: 'rgba(0,0,0,0.2)', borderRadius: '4px', whiteSpace: 'nowrap' }}>
            {myPlayer?.hasTakenMorto ? 'Con Muerto' : 'Sin Muerto'}
          </span>
        </div>

        {/* Botones de acción (Más legibles y grandes) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          {/* Fase de Robo */}
          {isMyTurn && needToDraw && (
            <div style={{ display: 'flex', gap: '5px' }}>
              <button 
                className="btn-action btn-blue" 
                onClick={handleDrawCard}
                style={{ flex: 1, fontSize: '0.88rem', padding: '6px 10px', height: '35px', justifyContent: 'center' }}
              >
                <ArrowDown size={14} style={{ marginRight: '4px' }} /> Mazo
              </button>
              <button 
                className="btn-action btn-blue" 
                onClick={handleDrawDiscard}
                disabled={!hasUnlockedDiscard}
                style={{ 
                  flex: 1, 
                  fontSize: '0.88rem', 
                  padding: '6px 10px', 
                  height: '35px', 
                  justifyContent: 'center',
                  opacity: !hasUnlockedDiscard ? 0.5 : 1
                }}
                title={!hasUnlockedDiscard ? `Debes tener al menos 30 puntos en mesa para robar el pozo (tienes ${myMeldPoints} pts)` : `Robar pozo (${gameState.discardPile.length})`}
              >
                <ArrowDown size={14} style={{ marginRight: '4px' }} /> Pozo ({gameState.discardPile.length})
              </button>
            </div>
          )}

          {/* Fase de Juego */}
          {canPlay && (
            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap' }}>
              {myMeldPoints > 0 && myMeldPoints < 30 && (
                <div style={{ 
                  width: '100%', 
                  marginBottom: '4px', 
                  padding: '4px 8px', 
                  borderRadius: '6px', 
                  background: 'rgba(245, 158, 11, 0.18)', 
                  border: '1px solid rgba(245, 158, 11, 0.5)', 
                  color: '#fef08a', 
                  fontSize: '0.74rem',
                  fontWeight: 600,
                  textAlign: 'center'
                }}>
                  ⚠️ Apertura: <strong>{myMeldPoints}/30 pts</strong> en mesa (bajá otro juego para poder descartar)
                </div>
              )}
              <button 
                className="btn-action btn-green" 
                onClick={handleMeldSequence}
                disabled={selectedCardIds.length < 3}
                style={{ flex: '1 1 47%', fontSize: '0.82rem', padding: '6px 6px', height: '32px', justifyContent: 'center' }}
              >
                <PlusCircle size={14} style={{ marginRight: '3px' }} /> Bajar
              </button>
              <button 
                className="btn-action btn-green" 
                onClick={handleAppendToMeld}
                disabled={selectedMeldIndex === null || selectedCardIds.length === 0}
                style={{ flex: '1 1 47%', fontSize: '0.82rem', padding: '6px 6px', height: '32px', justifyContent: 'center' }}
              >
                <FolderPlus size={14} style={{ marginRight: '3px' }} /> Acoplar ({selectedCardIds.length})
              </button>
              <button 
                className="btn-action btn-red" 
                onClick={handleDiscard}
                disabled={selectedCardIds.length !== 1}
                style={{ flex: '1 1 98%', fontSize: '0.82rem', padding: '6px 6px', height: '32px', justifyContent: 'center' }}
              >
                <ArrowUp size={14} style={{ marginRight: '4px' }} /> Descartar
              </button>
            </div>
          )}

          {/* Botones de Ordenar y Deshacer */}
          {(() => {
            const myTeamUndos = gameState.teamUndoCounts?.[myTeamIdx] || 0;
            const oppTeamUndos = gameState.teamUndoCounts?.[oppTeamIdx] || 0;
            const isPrevPlayer = safePlayerIndex === (gameState.is4Player 
              ? (gameState.turn - 1 + 4) % 4 
              : (gameState.turn === 0 ? 1 : 0)
            );

            const canRequestUndo = (
              // Caso 1: Es mi turno, ya robé y estoy jugando
              (isMyTurn && !needToDraw) ||
              // Caso 2: El rival acaba de recibir el turno pero aún no robó carta (puedo deshacer mi descarte)
              (isPrevPlayer && needToDraw)
            ) && (
              myTeamUndos < 2 &&
              (myTeamUndos === 0 || oppTeamUndos >= 1)
            );
            const remainingUndos = 2 - myTeamUndos;

            return (
              <div style={{ display: 'flex', gap: '5px', width: '100%', marginTop: '3px' }}>
                <button 
                  className="btn-action btn-gray" 
                  onClick={handleSortHand}
                  disabled={localHand.length === 0}
                  style={{ flex: 1, fontSize: '0.8rem', padding: '5px 4px', height: '32px', justifyContent: 'center' }}
                >
                  <SortAsc size={13} style={{ marginRight: '3px' }} /> Ordenar
                </button>
                <button 
                  className="btn-action" 
                  onClick={() => onAction('request-undo')}
                  disabled={!canRequestUndo}
                  style={{ 
                    flex: 1, 
                    fontSize: '0.8rem', 
                    padding: '5px 4px', 
                    height: '32px', 
                    justifyContent: 'center',
                    background: canRequestUndo ? 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)' : 'rgba(255, 255, 255, 0.04)',
                    color: canRequestUndo ? '#ffffff' : '#64748b',
                    borderColor: canRequestUndo ? '#818cf8' : 'rgba(255, 255, 255, 0.05)',
                    opacity: !canRequestUndo && (myTeamUndos >= 2 || (myTeamUndos === 1 && oppTeamUndos === 0)) ? 0.4 : 1
                  }}
                  title={!canRequestUndo 
                    ? (myTeamUndos >= 2 
                        ? "Llegaste al límite de 2 deshacer" 
                        : (myTeamUndos === 1 && oppTeamUndos === 0 
                            ? "Esperá a que el rival use su deshacer" 
                            : "Solo disponible durante tu turno de juego"
                          )
                      )
                    : `Deshacer jugada (Quedan ${remainingUndos} usos)`
                  }
                >
                  ⏪ Deshacer ({remainingUndos})
                </button>
              </div>
            );
          })()}
        </div>
      </div>

      {/* PANEL LATERAL (INFORMACION, LOGS Y PUNTAJES) */}
      <div className="sidebar">
        
        {/* Selector de Pestañas (solo en modo 4 jugadores) */}
        {is4P && (
          <div style={{
            display: 'flex',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            background: 'rgba(0,0,0,0.15)',
            padding: '4px'
          }}>
            <button
              onClick={() => setActiveTab('detalle')}
              style={{
                flex: 1,
                padding: '8px',
                background: activeTab === 'detalle' ? 'rgba(255,255,255,0.08)' : 'transparent',
                border: 'none',
                borderRadius: '6px',
                color: activeTab === 'detalle' ? '#c084fc' : '#94a3b8',
                fontWeight: 'bold',
                fontSize: '0.8rem',
                cursor: 'pointer',
                transition: 'all 0.2s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px'
              }}
            >
              📊 Detalle
            </button>
            <button
              onClick={() => setActiveTab('mesa')}
              style={{
                flex: 1,
                padding: '8px',
                background: activeTab === 'mesa' ? 'rgba(255,255,255,0.08)' : 'transparent',
                border: 'none',
                borderRadius: '6px',
                color: activeTab === 'mesa' ? '#c084fc' : '#94a3b8',
                fontWeight: 'bold',
                fontSize: '0.8rem',
                cursor: 'pointer',
                transition: 'all 0.2s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px'
              }}
            >
              🎴 Mesa (Asientos)
            </button>
          </div>
        )}

        {/* CONTENIDO DE LA PESTAÑA SELECCIONADA */}
        {(activeTab === 'detalle' || !is4P) ? (
          <>
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
                Requisito: <span style={{ color: '#fbbf24', fontWeight: 600 }}>{gameState.requiredCanastras || 1} {gameState.requiredCanastras === 1 ? 'Canasta' : 'Canastas'} para ganar</span>
              </div>
            </div>

            {/* Planilla Histórica de Rondas */}
            {gameState.roundHistory && gameState.roundHistory.length > 0 && (
              <div className="sidebar-section" style={{ borderTop: '1px solid var(--glass-border)' }}>
                <h2 className="sidebar-title" style={{ color: '#34d399', marginBottom: '8px' }}>Planilla de Rondas</h2>
                <div style={{ maxHeight: '120px', overflowY: 'auto', fontSize: '0.72rem' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8' }}>
                        <th style={{ padding: '3px 4px' }}>Ronda</th>
                        <th style={{ padding: '3px 4px' }}>{gameState.players?.[0]?.name || 'J1'}</th>
                        <th style={{ padding: '3px 4px' }}>{gameState.players?.[1]?.name || 'J2'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gameState.roundHistory && gameState.roundHistory.map((rh, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                          <td style={{ padding: '3px 4px', fontWeight: 'bold' }}>R{rh.round}</td>
                          <td style={{ padding: '3px 4px', color: (rh.totals?.[0] || 0) >= 0 ? '#34d399' : '#ef4444' }}>
                            {(rh.totals?.[0] || 0) >= 0 ? `+${rh.totals?.[0] || 0}` : rh.totals?.[0] || 0}
                          </td>
                          <td style={{ padding: '3px 4px', color: (rh.totals?.[1] || 0) >= 0 ? '#34d399' : '#ef4444' }}>
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
            <Scoreboard gameState={gameState} playerIndex={playerIndex} onChangeTargetScore={handleEditTargetScore} />

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
          </>
        ) : (
          <div className="sidebar-section" style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
            <h2 className="sidebar-title" style={{ color: '#fbbf24', alignSelf: 'flex-start', marginBottom: '10px' }}>Mapa de Asientos</h2>
            
            {/* REPRESENTACION DE LA MESA */}
            <div style={{
              position: 'relative',
              width: '190px',
              height: '190px',
              margin: '25px auto',
              background: 'radial-gradient(circle, #0f5132 0%, #082f1e 100%)',
              borderRadius: '50%',
              border: '6px solid #334155',
              boxShadow: 'inset 0 0 15px rgba(0,0,0,0.8), 0 4px 10px rgba(0,0,0,0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              {/* Centro de la mesa */}
              <div style={{ textAlign: 'center', pointerEvents: 'none', userSelect: 'none', opacity: 0.15 }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 800, letterSpacing: '2px', color: '#fff' }}>BURACO</div>
                <div style={{ fontSize: '0.45rem', letterSpacing: '1px', color: '#fff' }}>MESA</div>
              </div>

              {/* NORTE (Arriba) - Índice 2 */}
              {renderSidebarSeat(2, { top: '-24px', left: '50%', transform: 'translateX(-50%)' })}

              {/* ESTE (Derecha) - Índice 1 */}
              {renderSidebarSeat(1, { top: '50%', right: '-32px', transform: 'translateY(-50%)' })}

              {/* SUR (Abajo) - Índice 0 */}
              {renderSidebarSeat(0, { bottom: '-24px', left: '50%', transform: 'translateX(-50%)' })}

              {/* OESTE (Izquierda) - Índice 3 */}
              {renderSidebarSeat(3, { top: '50%', left: '-32px', transform: 'translateY(-50%)' })}
            </div>

            <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '20px', textAlign: 'center', padding: '0 8px', lineHeight: '1.4' }}>
              💡 <b>Sur</b> es el jugador inicial. El turno corre en sentido antihorario (hacia la derecha). Las posiciones físicas son fijas.
            </div>
          </div>
        )}

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
                El ganador es <strong>{is4P ? (gameState.winner === 0 || gameState.winner === 2 ? `${gameState.players[0].name} & ${gameState.players[2].name}` : `${gameState.players[1].name} & ${gameState.players[3].name}`) : (gameState.players?.[gameState.winner]?.name || 'Desconocido')}</strong> con <strong>{gameState.scores?.[gameState.winner] || 0}</strong> puntos.
              </p>
              
              <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '12px', padding: '16px', marginBottom: '24px' }}>
                <h3 style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Puntajes Finales</h3>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', fontSize: '1.2rem', fontWeight: 'bold' }}>
                  <div style={{ color: '#10b981' }}>
                    <div style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 'normal' }}>
                      {is4P ? `${gameState.players?.[0]?.name || 'Sur'} & ${gameState.players?.[2]?.name || 'Norte'}` : (gameState.players?.[0]?.name || 'Jugador 1')}
                    </div>
                    {gameState.scores?.[0] || 0} pts
                  </div>
                  <div style={{ color: '#3b82f6' }}>
                    <div style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 'normal' }}>
                      {is4P ? `${gameState.players?.[1]?.name || 'Este'} & ${gameState.players?.[3]?.name || 'Oeste'}` : (gameState.players?.[1]?.name || 'Jugador 2')}
                    </div>
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
                        <th style={{ padding: '6px 4px', textAlign: 'center' }}>
                          {is4P ? `${gameState.players?.[0]?.name || 'Sur'} & ${gameState.players?.[2]?.name || 'Norte'}` : (gameState.players?.[0]?.name || 'J1')}
                        </th>
                        <th style={{ padding: '6px 4px', textAlign: 'center' }}>
                          {is4P ? `${gameState.players?.[1]?.name || 'Este'} & ${gameState.players?.[3]?.name || 'Oeste'}` : (gameState.players?.[1]?.name || 'J2')}
                        </th>
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
              <span style={{ fontWeight: 'bold', color: '#10b981', textAlign: 'center', fontSize: '0.85rem', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }} title={is4P ? `${gameState.players?.[0]?.name} & ${gameState.players?.[2]?.name}` : ''}>
                {is4P ? `${gameState.players?.[0]?.name || 'Sur'} & ${gameState.players?.[2]?.name || 'Norte'}` : (gameState.players?.[0]?.name || 'J1')}
              </span>
              <span style={{ fontWeight: 'bold', color: '#3b82f6', textAlign: 'center', fontSize: '0.85rem', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }} title={is4P ? `${gameState.players?.[1]?.name} & ${gameState.players?.[3]?.name}` : ''}>
                {is4P ? `${gameState.players?.[1]?.name || 'Este'} & ${gameState.players?.[3]?.name || 'Oeste'}` : (gameState.players?.[1]?.name || 'J2')}
              </span>
              
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

              {/* Canastas Limpias */}
              <span style={{ fontSize: '0.9rem' }}>Canastas Limpias (x200)</span>
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

              {/* Canastas Sucias */}
              <span style={{ fontSize: '0.9rem' }}>Canastas Sucias (x100)</span>
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

            <div style={{ display: 'flex', gap: '12px', marginTop: '20px', justifyContent: 'center', flexWrap: 'wrap' }}>
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
                style={{ flexGrow: 1, padding: '12px 16px', fontSize: '0.95rem', fontWeight: 'bold' }}
              >
                Confirmar y Pasar a Siguiente Mano ➡️
              </button>
              
              <button 
                className="btn-action btn-gray" 
                onClick={() => onAction('hide-scores-sheet')}
                style={{ padding: '0 16px', fontSize: '0.88rem' }}
                title="Cerrar la planilla para inspeccionar la mesa y cartas"
              >
                Volver a la Mesa 👁️
              </button>

              <button 
                className="btn-action btn-gray" 
                onClick={() => {
                  if (window.confirm('¿Seguro que deseas anular esta ronda? Se repartirán de nuevo las cartas sin sumar puntos.')) {
                    onAction('restart-round');
                  }
                }}
                style={{ padding: '0 16px', fontSize: '0.88rem', color: '#f87171' }}
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

      {/* MODAL DE DESHACER JUGADA (UNDO TURN) */}
      {gameState.undoRequestedBy !== null && (
        <div className="modal-overlay" style={{ zIndex: 1100 }}>
          <div className="modal-content glass-panel" style={{ maxWidth: '450px', padding: '24px', textAlign: 'center' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '10px' }}>⏪</div>
            
            {gameState.undoRequestedBy === playerIndex ? (
              <>
                <h3 className="modal-title" style={{ fontSize: '1.4rem', color: '#fbbf24', marginBottom: '12px' }}>
                  Solicitud de Retroceso Enviada
                </h3>
                <p style={{ color: '#e2e8f0', fontSize: '0.95rem', marginBottom: '20px', lineHeight: '1.5' }}>
                  Esperando que los rivales aprueben o rechacen volver atrás tu jugada...
                </p>
                <div className="loading-spinner-small" style={{ margin: '0 auto 10px auto' }}></div>
              </>
            ) : getTeamOwnerIndex(gameState.undoRequestedBy, is4P) === myTeamIdx ? (
              <>
                <h3 className="modal-title" style={{ fontSize: '1.4rem', color: '#fbbf24', marginBottom: '12px' }}>
                  Tu Compañero solicitó Deshacer
                </h3>
                <p style={{ color: '#e2e8f0', fontSize: '0.95rem', marginBottom: '20px', lineHeight: '1.5' }}>
                  <strong>{gameState.players?.[gameState.undoRequestedBy]?.name || ''}</strong> pidió volver atrás su jugada. 
                  Esperando la decisión del equipo rival...
                </p>
                <div className="loading-spinner-small" style={{ margin: '0 auto 10px auto' }}></div>
              </>
            ) : (
              <>
                <h3 className="modal-title" style={{ fontSize: '1.4rem', color: '#f43f5e', marginBottom: '12px' }}>
                  ¿Permitir Retroceso de Jugada?
                </h3>
                <p style={{ color: '#e2e8f0', fontSize: '0.95rem', marginBottom: '20px', lineHeight: '1.5' }}>
                  El rival <strong>{gameState.players?.[gameState.undoRequestedBy]?.name || ''}</strong> está pidiendo permiso para volver al inicio de su turno (descarte o juego erróneo).
                </p>
                <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                  <button 
                    className="btn-action btn-green" 
                    onClick={() => onAction('respond-undo', { accept: true })}
                    style={{ padding: '8px 24px', fontSize: '0.95rem', flexGrow: 1 }}
                  >
                    Permitir ✅
                  </button>
                  <button 
                    className="btn-action btn-red" 
                    onClick={() => onAction('respond-undo', { accept: false })}
                    style={{ padding: '8px 24px', fontSize: '0.95rem', flexGrow: 1 }}
                  >
                    Rechazar ❌
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
