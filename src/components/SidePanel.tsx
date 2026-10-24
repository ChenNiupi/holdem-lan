import { useEffect, useRef, useState } from 'react';
import type { ChatMessage, LogEntry } from '../../shared/protocol';

interface Props {
  open: boolean;
  tab: 'log' | 'chat';
  unread: number;
  log: LogEntry[];
  chats: ChatMessage[];
  myName: string;
  onTab: (tab: 'log' | 'chat') => void;
  onClose: () => void;
  onSend: (text: string) => void;
}

function timeText(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function SidePanel({ open, tab, unread, log, chats, myName, onTab, onClose, onSend }: Props) {
  const [draft, setDraft] = useState('');
  const logRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const el = tab === 'log' ? logRef.current : chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, tab, log.length, chats.length]);

  const send = (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onSend(text.slice(0, 200));
    setDraft('');
  };

  return (
    <aside className={`side-panel ${open ? 'is-open' : ''}`}>
      <div className="panel-head">
        <div className="panel-tabs">
          <button className={tab === 'log' ? 'active' : ''} onClick={() => onTab('log')}>
            牌局记录
          </button>
          <button className={tab === 'chat' ? 'active' : ''} onClick={() => onTab('chat')}>
            聊天
            {unread > 0 && <i className="panel-unread">{unread}</i>}
          </button>
        </div>
        <button className="panel-close" onClick={onClose} aria-label="关闭">
          ✕
        </button>
      </div>

      {tab === 'log' ? (
        <div className="panel-body log-list" ref={logRef}>
          {log.length === 0 ? (
            <p className="panel-empty">牌局开始后，这里会记录每一步行动。</p>
          ) : (
            log.map((entry) => (
              <div key={entry.id} className={`log-row tone-${entry.tone}`}>
                {entry.text}
              </div>
            ))
          )}
        </div>
      ) : (
        <>
          <div className="panel-body chat-list" ref={chatRef}>
            {chats.length === 0 ? (
              <p className="panel-empty">和朋友打个招呼吧。</p>
            ) : (
              chats.map((msg) => (
                <div key={msg.id} className={`chat-row ${msg.name === myName ? 'is-mine' : ''}`}>
                  <div className="chat-meta">
                    <b>{msg.name}</b>
                    <span>{timeText(msg.at)}</span>
                  </div>
                  <div className="chat-text">{msg.text}</div>
                </div>
              ))
            )}
          </div>
          <form className="chat-form" onSubmit={send}>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value.slice(0, 200))}
              placeholder="说点什么…"
              maxLength={200}
            />
            <button className="btn btn-primary" disabled={!draft.trim()}>
              发送
            </button>
          </form>
        </>
      )}
    </aside>
  );
}
