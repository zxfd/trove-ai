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
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-6 text-[var(--text-secondary)]">
                <li>保持当前浏览器已经登录 Trove。</li>
                <li>点击下方按钮复制收藏代码。</li>
                <li>在 Chrome 收藏栏右键选择“添加网页”；Safari 可先新建书签再编辑地址。</li>
                <li>名称填“存入 Trove”，网址填刚复制的整段代码。</li>
                <li>以后打开任意文章，点击收藏栏里的“存入 Trove”。</li>
              </ol>
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
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-6 text-[var(--text-secondary)]">
                <li>先在 Safari 登录一次当前 Trove 地址。</li>
                <li>在“快捷指令”中新建快捷指令，命名“存入 Trove”。</li>
                <li>打开快捷指令详细信息，启用“在共享表单中显示”，输入类型只保留 URL 和文本。</li>
                <li>添加“URL 编码（URL Encode）”操作，输入选择“快捷指令输入”。</li>
                <li>添加“URL”操作，内容由下面的固定前缀和上一步的编码结果组成。</li>
                <li>最后添加“打开 URL”操作。</li>
              </ol>
              <code className="mt-3 block break-all rounded-lg bg-[var(--bg-primary)] p-3 text-left text-xs text-[var(--text-secondary)]">
                {origin || '当前 Trove 地址'}/quick-add?text=编码后的快捷指令输入
              </code>
              <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
                保存后，在 X、Safari 或其他支持系统共享表单的 App 中选择“分享 → 存入 Trove”。如果登录过期，会先登录再继续原来的入库任务。
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
