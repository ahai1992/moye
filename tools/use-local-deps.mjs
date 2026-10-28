// 离线开发时复用已安装的依赖。只在本项目内创建链接，不修改参考项目。
import { existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const reference = process.argv[2]
if (!reference) {
  console.error('用法：npm run deps:local -- D:/vscode/gzh/node_modules')
  process.exit(1)
}
const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
const missing = []
for (const name of Object.keys({ ...manifest.dependencies, ...manifest.devDependencies })) {
  const source = resolve(reference, name)
  const target = resolve('node_modules', name)
  if (existsSync(target)) continue
  if (!existsSync(source)) { missing.push(name); continue }
  const installed = JSON.parse(readFileSync(resolve(source, 'package.json'), 'utf8')).version
  const expected = manifest.dependencies?.[name] ?? manifest.devDependencies[name]
  if (installed !== expected && !expected.startsWith('^')) {
    throw new Error(`${name} 版本不一致：需要 ${expected}，现有 ${installed}`)
  }
  mkdirSync(dirname(target), { recursive: true })
  symlinkSync(realpathSync(source), target, process.platform === 'win32' ? 'junction' : 'dir')
}
console.log('本地依赖链接完成。缺少：', missing.join(', ') || '无')
