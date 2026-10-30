// 把 src/tokens.json 编译成 generated/tokens.css。
// 四个光照主题用 [data-light="noon|dawn|dusk|night"] 切换；第一个主题也写在 :root 上作为默认值。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tokens = JSON.parse(readFileSync(resolve(root, 'src/tokens.json'), 'utf8'))

const themes = tokens.color.themes.map((t) => t.id)
const first = themes[0]
const valueFor = (value, theme) => (typeof value === 'string' ? value : value[theme] ?? value[first])
const toVar = (value) => (typeof value === 'string' && value.startsWith('{') ? `var(--${value.slice(1, -1)})` : value)

const themed = [...tokens.color.tokens, ...(tokens.shadow?.tokens ?? [])]
const blocks = themes.map((theme) => {
  const selector = theme === first ? `:root, [data-light="${theme}"]` : `[data-light="${theme}"]`
  const lines = themed.map((t) => `  --${t.name}: ${toVar(valueFor(t.value, theme))};`)
  return `${selector} {\n${lines.join('\n')}\n}`
})

const plainFamilies = ['spacing', 'radius', 'duration', 'easing', 'layer', 'breakpoint']
const plain = plainFamilies.flatMap((key) => (tokens[key]?.tokens ?? []).map((t) => `  --${t.name}: ${t.value};`))
const fonts = Object.entries(tokens.type.families).map(([key, stack]) => `  --font-${key}: ${stack};`)

const css = `/* Kai 世界设计系统 — generated from tokens.json. Do not edit by hand. */
@font-face {
  font-family: "Smiley Sans";
  src: url("/SmileySans-Oblique.woff2") format("woff2");
  font-display: swap;
}

${blocks.join('\n\n')}

:root {
${[...plain, ...fonts].join('\n')}
}
`

mkdirSync(resolve(root, 'generated'), { recursive: true })
writeFileSync(resolve(root, 'generated/tokens.css'), css)
console.log(`tokens.css: ${themes.length} themes, ${themed.length} themed tokens, ${plain.length + fonts.length} plain tokens`)
