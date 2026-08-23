'use client';

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Copy, Link2, Loader2, MessageSquare, Unlink } from 'lucide-react';

function authHeaders(): Record<string, string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('trove_token') : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

interface BindingState {
  bound: boolean;
  display_name?: string;
}

export default function LarkBinding() {
  const [binding, setBinding] = useState<BindingState | null>(null);
  const [command, setCommand] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/lark/binding', { headers: authHeaders() });
      if (response.ok) setBinding(await response.json());
    } catch {
      setMessage('暂时无法读取飞书绑定状态');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const createCode = async () => {
    setLoading(true);
    setMessage('');
    try {
      const response = await fetch('/api/lark/bind-code', { method: 'POST', headers: authHeaders() });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || '生成失败');
      setCommand(data.command);
      setExpiresAt(data.expires_at);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '生成失败');
    } finally {
      setLoading(false);
    }
  };

  const unbind = async () => {
    if (!confirm('确定解绑飞书账号？')) return;
    setLoading(true);
    await fetch('/api/lark/binding', { method: 'DELETE', headers: authHeaders() });
    setCommand('');
    await load();
    setLoading(false);
  };

  const copyCommand = async () => {
    await navigator.clipboard.writeText(command);
    setMessage('绑定命令已复制');
  };

  return (
    <section className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 border border-[var(--border-color)] bg-[var(--bg-secondary)] rounded-lg flex items-center justify-center shrink-0">
            <MessageSquare size={18} className="text-blue-600" />
          </div>
          <div>
            <h2 className="font-semibold text-[var(--foreground)]">飞书 Bot</h2>
            <p className="text-sm text-[var(--text-secondary)] mt-1">把飞书作为知识管理 Agent 的消息入口。</p>
          </div>
        </div>
        {binding?.bound && <CheckCircle2 size={20} className="text-emerald-500 shrink-0" />}
      </div>

      {binding?.bound ? (
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-[var(--border-color)] pt-4">
          <div>
            <div className="text-sm font-medium text-[var(--foreground)]">已绑定{binding.display_name ? `：${binding.display_name}` : ''}</div>
            <div className="text-xs text-[var(--text-tertiary)] mt-1">可以在飞书私聊中发送链接、问题和附件。</div>
          </div>
          <button onClick={unbind} disabled={loading} title="解绑飞书" className="w-9 h-9 inline-flex items-center justify-center border border-[var(--border-color)] rounded-lg hover:bg-[var(--bg-tertiary)] disabled:opacity-50">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Unlink size={16} />}
          </button>
        </div>
      ) : (
        <div className="mt-4 border-t border-[var(--border-color)] pt-4">
          {!command ? (
            <button onClick={createCode} disabled={loading} className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-[var(--accent)] text-white disabled:opacity-50">
              {loading ? <Loader2 size={15} className="animate-spin" /> : <Link2 size={15} />}
              生成绑定码
            </button>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <code className="px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-color)] text-sm text-[var(--foreground)]">{command}</code>
              <button onClick={copyCommand} title="复制绑定命令" className="w-9 h-9 inline-flex items-center justify-center border border-[var(--border-color)] rounded-lg hover:bg-[var(--bg-tertiary)]">
                <Copy size={16} />
              </button>
              <span className="text-xs text-[var(--text-tertiary)]">10 分钟内私聊发送{expiresAt ? `，${new Date(expiresAt).toLocaleTimeString()} 前有效` : ''}</span>
            </div>
          )}
          {message && <p className="text-xs text-[var(--text-secondary)] mt-3">{message}</p>}
        </div>
      )}
    </section>
  );
}
