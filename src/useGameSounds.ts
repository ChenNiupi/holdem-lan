import { useEffect, useRef } from 'react';
import type { GameState } from '../shared/protocol';
import { sound, type SoundName } from './sound';

interface PreviousState {
  initialized: boolean;
  handId: number;
  logId: number;
  community: number;
  turnKey: string;
  resultHand: number;
}

function actionSound(text: string): SoundName {
  if (text.includes('弃牌')) return 'fold';
  if (text.includes('过牌')) return 'check';
  if (text.includes('全下')) return 'allin';
  if (text.includes('加注') || text.includes('下注')) return 'raise';
  if (text.includes('跟注')) return 'call';
  return 'call';
}

export function useGameSounds(state: GameState, enabled: boolean): void {
  const previous = useRef<PreviousState>({
    initialized: false,
    handId: 0,
    logId: 0,
    community: 0,
    turnKey: '',
    resultHand: 0,
  });

  useEffect(() => {
    sound.setMuted(!enabled);
  }, [enabled]);

  useEffect(() => {
    const prev = previous.current;
    const maxLogId = state.log.length > 0 ? state.log[state.log.length - 1].id : 0;
    const turnKey = `${state.handId}:${state.street}:${state.toAct ?? ''}:${state.legal ? 1 : 0}`;
    const myTurn = Boolean(state.legal) && state.toAct === state.youId;
    const mySeat = state.seats.find((seat) => seat?.isYou) ?? null;
    const resultIsNew = Boolean(state.result) && prev.resultHand !== state.handId;

    if (!prev.initialized) {
      if (enabled && myTurn) {
        window.setTimeout(() => sound.play('turn'), 600);
      }
      previous.current = {
        initialized: true,
        handId: state.handId,
        logId: maxLogId,
        community: state.community.length,
        turnKey,
        resultHand: state.result ? state.handId : 0,
      };
      return;
    }

    if (enabled) {
      const newHand = state.handId !== prev.handId && state.handInProgress;
      if (newHand) sound.play('deal');

      const newCards = state.community.length - prev.community;
      if (!resultIsNew && newCards > 0 && state.community.length > 0) {
        sound.playCards(newCards, newHand ? 0.25 : 0.08);
      }

      if (!newHand) {
        const newLogs = state.log.filter((entry) => entry.id > prev.logId);
        if (newLogs.length > 0 && newLogs.length <= 4) {
          newLogs.forEach((entry, index) => {
            if (entry.tone !== 'action') return;
            sound.play(actionSound(entry.text), 0.04 + index * 0.09);
          });
        }
      }

      if (myTurn && turnKey !== prev.turnKey) {
        sound.play('turn', newHand ? 0.55 : 0.08);
      }

      if (resultIsNew && state.result) {
        if (state.result.showdown) sound.play('reveal', 0.05);
        const won = mySeat?.won ?? 0;
        sound.play(won > 0 ? 'win' : 'winSoft', state.result.showdown ? 0.4 : 0.15);
      }
    }

    previous.current = {
      initialized: true,
      handId: state.handId,
      logId: maxLogId,
      community: state.community.length,
      turnKey,
      resultHand: state.result ? state.handId : prev.resultHand,
    };
  }, [state, enabled]);
}
