'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  CheckCircle2,
  Clipboard,
  ExternalLink,
  Loader2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { extractUrl } from '@/lib/url';

type AddState =
  | { status: 'idle' }
  | { status: 'adding' }
  | { status: 'success'; articleId: string }
  | { status: 'duplicate' }
  | { status: 'error'; message: string };

export default function QuickAddPage() {
  const searchParams = useSearchParams();
  const started = useRef(false);
  const [state, setState] = useState<AddState>({ status: 'idle' });
  const [origin, setOrigin] = useState('');
  const [copied, setCopied] = useState(false);

  const sharedText = searchParams.get('text') || searchParams.get('url') || '';
  const targetUrl = useMemo(() => {
    const extracted = extractUrl(sharedText);
    if (extracted) return extracted;
    const trimmed = sharedText.trim();
    return /^https?:\/\//i.test(trimmed) ? trimmed : '';
  }, [sharedText]);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!targetUrl || started.current) return;
    started.current = true;
    setState({ status: 'adding' });

    api.createArticle(targetUrl)
      .then((article) => {
        setState({ status: 'success', articleId: article.id });
      })
      .catch((error: Error) => {
        const message = error.message || '添加文章失败';
        if (/already exists|已存在/i.test(message)) {
          setState({ status: 'duplicate' });
          return;
        }
        setState({ status: 'error', message });
      });
  }, [targetUrl]);

  const bookmarklet = origin
    ? `javascript:(()=>{window.open('${origin}/quick-add?url='+encodeURIComponent(location.href),'trove-quick-add','width=520,height=720')})()`
    : '';

  const copyBookmarklet = async () => {
    if (!bookmarklet) return;
    await navigator.clipboard.writeText(bookmarklet);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  if (!sharedText) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10 md:py-16">
        <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-6 md:p-8 shadow-sm">
          <h1 className="text-xl font-bold text-[var(--text-primary)]">快速存入 Trove</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
            这个页面接收浏览器收藏按钮或手机分享快捷指令传来的链接，并使用你当前的 Trove 登录状态自动入库。
          </p>

          <div className="mt-6 space-y-5">
            <section className="rounded-xl bg-[var(--bg-secondary)] p-4">
              <h2 className="font-semibold text-[var(--text-primary)]">电脑浏览器</h2>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                新建一个收藏，将下面复制的内容粘贴到收藏的网址栏。以后在任意网页点击该收藏即可入库。
              </p>
              <button
                type="button"
                onClick={copyBookmarklet}
                className="mt-3 inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white"
              >
                <Clipboard size={16} />
                {copied ? '已复制' : '复制收藏按钮代码'}
              </button>
            </section>

            <section className="rounded-xl bg-[var(--bg-secondary)] p-4">
              <h2 className="font-semibold text-[var(--text-primary)]">iPhone / iPad</h2>
              <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">
                在“快捷指令”中接收分享菜单的文本或 URL，先做 URL 编码，再打开
                <code className="mx-1 break-all text-xs">{origin || '当前 Trove 地址'}/quick-add?text=编码后的内容</code>。
                登录一次后，X、Safari 和普通网页都可以从系统分享菜单直接入库。
              </p>
            </section>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-12 md:py-20">
      <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--bg-primary)] p-6 md:p-8 text-center shadow-sm">
        {state.status === 'adding' && (
          <>
            <Loader2 size={36} className="mx-auto animate-spin text-[var(--accent)]" />
            <h1 className="mt-4 text-xl font-bold text-[var(--text-primary)]">正在存入 Trove</h1>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">正在抓取并解析页面，请稍候。</p>
          </>
        )}

        {state.status === 'success' && (
          <>
            <CheckCircle2 size={40} className="mx-auto text-[var(--success)]" />
            <h1 className="mt-4 text-xl font-bold text-[var(--text-primary)]">已存入 Trove</h1>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">可以返回原应用，AI 处理会在后台继续完成。</p>
            <Link
              href={`/read/${state.articleId}`}
              className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white"
            >
              查看文章 <ExternalLink size={16} />
            </Link>
          </>
        )}

        {state.status === 'duplicate' && (
          <>
            <CheckCircle2 size={40} className="mx-auto text-[var(--accent)]" />
            <h1 className="mt-4 text-xl font-bold text-[var(--text-primary)]">这篇已经在知识库中</h1>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">没有重复创建，可以直接返回原应用。</p>
          </>
        )}

        {state.status === 'error' && (
          <>
            <AlertCircle size={40} className="mx-auto text-[var(--danger)]" />
            <h1 className="mt-4 text-xl font-bold text-[var(--text-primary)]">入库失败</h1>
            <p className="mt-2 break-words text-sm text-[var(--danger)]">{state.message}</p>
          </>
        )}

        {!targetUrl && (
          <>
            <AlertCircle size={40} className="mx-auto text-[var(--warning)]" />
            <h1 className="mt-4 text-xl font-bold text-[var(--text-primary)]">没有识别到链接</h1>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">请从分享菜单传入网页 URL 或包含 URL 的分享文字。</p>
          </>
        )}

        {targetUrl && (
          <p className="mt-6 truncate rounded-lg bg-[var(--bg-secondary)] px-3 py-2 text-left text-xs text-[var(--text-tertiary)]" title={targetUrl}>
            {targetUrl}
          </p>
        )}
      </div>
    </div>
  );
}
