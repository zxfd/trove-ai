# 存入 Trove Chrome 插件

这是 Trove 的轻量 Chrome Manifest V3 插件，用于把当前网页或页面中的链接交给 Trove 的 `/quick-add` 入口。

## 功能

- 点击工具栏图标，存入当前网页
- 右键网页或链接，选择“存入 Trove”
- 支持在插件设置中修改 Trove 地址
- 不读取或复制网页正文，不保存登录凭据和 API Key

## 本地安装

1. 下载并解压插件 ZIP。
2. 打开 `chrome://extensions`。
3. 打开右上角“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择解压后的文件夹。
5. 把“存入 Trove”固定到工具栏。

首次使用前，请在同一个 Chrome 中登录一次 Trove。

## 开源参考

交互和 Manifest V3 结构参考了 MIT 许可的 [Linkwarden Browser Extension](https://github.com/linkwarden/browser-extension)。Trove 插件没有引入 Linkwarden 的服务端 API、认证、书签读取或全站访问权限。
