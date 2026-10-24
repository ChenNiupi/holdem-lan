import { useEffect, useMemo, useState } from 'react';
import type { ServerInfo } from '../../shared/protocol';
import { copyText } from '../lib';

interface Props {
  code: string;
  onClose: () => void;
  toast: (text: string, kind?: 'error' | 'info') => void;
}

export default function ShareModal({ code, onClose, toast }: Props) {
  const [info, setInfo] = useState<ServerInfo | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/info')
      .then((res) => res.json())
      .then((data: ServerInfo) => {
        if (alive) setInfo(data);
      })
      .catch(() => {});
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      alive = false;
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const links = useMemo(() => {
    const origin = window.location.origin;
    const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
    const bases = [...(isLocal ? [] : [origin]), ...(info?.lanUrls ?? [])];
    if (bases.length === 0) bases.push(origin);
    return [...new Set(bases)].map((base) => `${base}/room/${code}`);
  }, [info, code]);

  const copy = async (text: string, success: string) => {
    const ok = await copyText(text);
    toast(ok ? success : '复制失败，请手动选取文本', ok ? 'info' : 'error');
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal share-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>邀请朋友入座</h2>
            <p>同一 Wi-Fi 下，打开链接或输入房间号即可加入。</p>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <div className="share-code">
          <span>房间号</span>
          <b>{code}</b>
          <button className="btn btn-ghost" onClick={() => copy(code, '房间号已复制')}>
            复制
          </button>
        </div>

        <div className="share-links">
          <span className="share-links-title">邀请链接</span>
          {links.map((link) => (
            <div className="share-link-row" key={link}>
              <code>{link}</code>
              <button className="copy-btn" onClick={() => copy(link, '邀请链接已复制')}>
                复制
              </button>
            </div>
          ))}
          {!info && <div className="share-hint">正在读取本机局域网地址…</div>}
        </div>

        <p className="share-note">
          如果朋友打不开，请确认在同一 Wi-Fi 下，并允许防火墙中的 Node.js 访问「专用网络」。
        </p>
      </div>
    </div>
  );
}
