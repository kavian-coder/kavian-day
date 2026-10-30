import { fileURLToPath } from 'node:url'

const uiDir = fileURLToPath(new URL('../../packages/ui/src', import.meta.url))

export default defineNuxtConfig({
  compatibilityDate: '2026-10-01',
  devtools: { enabled: false },
  modules: ['@nuxtjs/i18n'],
  css: ['@kavian/tokens/tokens.css', '@kavian/ui/components.css', '~/assets/css/base.css'],
  components: [{ path: uiDir, pathPrefix: false }, '~/components'],
  app: {
    head: {
      htmlAttrs: { 'data-light': 'noon' },
      link: [
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        {
          rel: 'stylesheet',
          href: 'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=JetBrains+Mono:wght@400;500&display=swap',
        },
      ],
    },
  },
  i18n: {
    // 中文在根路径，英文在 /en。
    baseUrl: 'https://kavian.day',
    strategy: 'prefix_except_default',
    defaultLocale: 'zh',
    locales: [
      { code: 'zh', language: 'zh-CN', name: '中文', file: 'zh.json' },
      { code: 'en', language: 'en', name: 'English', file: 'en.json' },
    ],
    // Root always opens in Chinese; English is selected explicitly via /en.
    detectBrowserLanguage: false,
  },
  nitro: {
    prerender: { routes: ['/', '/about', '/en', '/en/about'] },
  },
  vite: {
    // three 是 @kavian/world 的依赖，不在站点目录下，要用 “包 > 依赖” 的写法告诉 Vite 去哪里找；
    // 两个 examples 模块也提前打包，免得开发时第一次打开页面又被自动刷新一次
    optimizeDeps: {
      include: [
        '@kavian/world > three',
        '@kavian/world > three/examples/jsm/loaders/GLTFLoader.js',
        '@kavian/world > three/examples/jsm/utils/BufferGeometryUtils.js',
      ],
    },
  },
})
