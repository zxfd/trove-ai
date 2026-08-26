'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  CheckCircle2,
  Clipboard,
  Download,
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
  const startedUrl = useRef('');
  const [state, setState] = useState<AddState>({ status: 'idle' });
  const [origin, setOrigin] = useState('');
  const [hashInput, setHashInput] = useState('');
  const [copied, setCopied] = useState(false);

  const sharedText = searchParams.get('text') || searchParams.get('url') || hashInput;
  const targetUrl = useMemo(() => {
    const extracted = extractUrl(sharedText);
    if (extracted) return extracted;
    const trimmed = sharedText.trim();
    return /^https?:\/\//i.test(trimmed) ? trimmed : '';
  }, [sharedText]);

  useEffect(() => {
    setOrigin(window.location.origin);
    const updateHashInput = () => {
      const rawHash = window.location.hash.slice(1);
      if (!rawHash || /https?:\/\//i.test(rawHash)) {
        setHashInput(rawHash);
        return;
      }
      try {
        setHashInput(decodeURIComponent(rawHash));
      } catch {
        setHashInput(rawHash);
      }
    };

    updateHashInput();
    window.addEventListener('hashchange', updateHashInput);
    return () => window.removeEventListener('hashchange', updateHashInput);
  }, []);

  useEffect(() => {
    if (!targetUrl || startedUrl.current === targetUrl) return;
    startedUrl.current = targetUrl;
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
              <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                Chrome 推荐安装“存入 Trove”插件。点击工具栏图标即可保存当前页，也可以右键网页或链接直接保存。
              </p>
              <a
                href="/downloads/trove-save-extension.zip"
                download
                className="mt-3 inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white"
              >
                <Download size={16} />
                下载 Chrome 插件
              </a>
              <details className="mt-3 text-sm text-[var(--text-secondary)]">
                <summary className="cursor-pointer font-medium text-[var(--text-primary)]">查看安装方法</summary>
                <ol className="mt-2 list-decimal space-y-1 pl-5 leading-6">
                  <li>解压下载的 ZIP。</li>
                  <li>在 Chrome 打开 chrome://extensions，并开启“开发者模式”。</li>
                  <li>点击“加载已解压的扩展程序”，选择解压后的 trove-save-extension 文件夹。</li>
                  <li>把“存入 Trove”固定到工具栏；首次使用前先登录 Trove。</li>
                </ol>
                <p className="mt-2 leading-6">
                  插件只申请当前页面、右键菜单和插件设置权限，不读取浏览历史、Cookie、密码或网页正文。
                </p>
              </details>

              <details className="mt-4 border-t border-[var(--border-color)] pt-4 text-sm text-[var(--text-secondary)]">
                <summary className="cursor-pointer font-medium text-[var(--text-primary)]">不安装插件：使用收藏栏按钮</summary>
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
              </details>
            </section>

            <section className="rounded-xl bg-[var(--bg-secondary)] p-4">
              <h2 className="font-semibold text-[var(--text-primary)]">iPhone / iPad</h2>
              <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                先在 Safari 登录一次当前 Trove 地址，再安装已经配置好的“存入 Trove”。它会自动出现在系统共享菜单，并从分享内容中提取原文 URL。
              </p>
              <a
                href="https://www.icloud.com/shortcuts/8c15532a72f2433e81a8669ff6989c19"
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--accent)] px-4 text-sm font-semibold text-white"
              >
                一键安装“存入 Trove” <ExternalLink size={16} />
              </a>
              <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
                Apple 会要求再确认一次“添加快捷指令”，这是 iOS 不允许网页绕过的安全确认。安装后，在 X、Safari 或其他 App 中选择“分享 → 存入 Trove”。
              </p>
              <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                分享里即使带图片，只要同时包含原文 URL 就能入库，正文图片由 Trove 从原网页抓取；只有图片、没有来源 URL 的内容不属于文章快速入库。
              </p>
              <details className="mt-3 text-sm text-[var(--text-secondary)]">
                <summary className="cursor-pointer font-medium text-[var(--text-primary)]">查看手动配置方法</summary>
                <ol className="mt-2 list-decimal space-y-1 pl-5 leading-6">
                  <li>新建“存入 Trove”，并启用“在共享表单中显示”。</li>
                  <li>依次添加“从输入中获取 URL”“文本”“打开 URL”。</li>
                  <li>文本内容由下面的固定前缀和上一步的“URL”变量组成。</li>
                </ol>
                <code className="mt-2 block break-all rounded-lg bg-[var(--bg-primary)] p-3 text-left text-xs">
                  {origin || '当前 Trove 地址'}/quick-add#URL
                </code>
              </details>
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
