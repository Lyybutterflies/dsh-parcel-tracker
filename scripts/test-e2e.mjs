// 端到端自测：用假 ctx 加载 lib/index.js，验证路由注册、状态读写、配置保存、手动订单、
// 也顺带验证 client.js 的模块工厂形状（在假 window 里跑，不渲染 React）。
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const fails = []
function ok(v, label) {
  if (!v) fails.push(label)
  console.log(`${v ? 'PASS' : 'FAIL'} ${label}`)
}
function eq(a, b, label) {
  ok(JSON.stringify(a) === JSON.stringify(b), `${label} -> ${JSON.stringify(a)}`)
}

// ---------------------------------------------------------------- 假 ctx
const routes = new Map()
const effects = []
const provided = {}
const ctx = {
  logger: {
    debug: () => {}, info: (m) => console.log('  [host]', m),
    warn: (m) => console.log('  [warn]', m), error: (m) => console.log('  [err]', m),
  },
  webServer: {
    register(route) {
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
  },
  effect(fn, label) {
    const dispose = fn()
    effects.push({ label, dispose })
    return () => {}
  },
  provide(name, value) { provided[name] = value },
  // cordis 4 的 ctx.inject(deps, cb)：依赖就绪后以 scoped ctx 调 cb。假 ctx 里同步回灌自身。
  inject(deps, cb) { if (typeof cb === 'function') cb(ctx) },
}

const mod = await import(pathToFileURL(join(root, 'lib', 'index.js')).href)
ok(typeof mod.apply === 'function', 'lib/index.js exports apply()')
eq(mod.name, 'dsh-parcel-tracker', 'lib/index.js exports name')
const service = mod.apply(ctx)

eq(routes.size, 8, 'registered 8 routes')
for (const p of ['state', 'orders', 'refresh', 'config', 'track', 'manual-order', 'manual-order/delete', 'carriers']) {
  ok(routes.has('/dsh-parcel/' + p), `route /dsh-parcel/${p}`)
}
ok(!!provided.parcelTracker, 'ctx.provide parcelTracker')

// --------------------------------------------------------- 假 req / res
function makeRes() {
  const out = { status: 0, headers: null, body: '' }
  return {
    out,
    writeHead(s, h) { out.status = s; out.headers = h },
    end(b) { out.body = String(b == null ? '' : b) },
    json() { try { return JSON.parse(out.body) } catch (e) { return null } },
  }
}
function makeReq(method, body) {
  const payload = body === undefined ? '' : JSON.stringify(body)
  return {
    method,
    headers: { host: '127.0.0.1:52915', 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() { if (payload) yield Buffer.from(payload, 'utf8') },
  }
}
async function call(path, method = 'GET', body) {
  const route = routes.get('/dsh-parcel/' + path)
  if (!route) throw new Error('no route ' + path)
  const res = makeRes()
  await route.handler(makeReq(method, body), res)
  return { status: res.out.status, json: res.json() }
}

// ------------------------------------------------------------ 接口实测
const st = await call('state')
ok(st.json && st.json.ok === true, 'GET /state ok')
ok(Array.isArray(st.json.orders), 'GET /state orders is array')
ok(st.json.config && typeof st.json.config === 'object', 'GET /state has masked config')
ok(st.json.config.phone !== undefined, 'GET /state config.phone present')

const carriersRes = await call('carriers')
ok(carriersRes.json && carriersRes.json.ok === true, 'GET /carriers ok')
ok(Array.isArray(carriersRes.json.carriers) && carriersRes.json.carriers.length > 3000,
  `GET /carriers returns ${carriersRes.json && carriersRes.json.carriers && carriersRes.json.carriers.length} carriers`)
ok(carriersRes.json.carriers.some((c) => c.code === 'shunfeng' && c.name === '顺丰速运'),
  'GET /carriers contains shunfeng/顺丰速运')

const cfg = await call('config')
ok(cfg.json && cfg.json.ok === true, 'GET /config ok')
const beforePhone = cfg.json.config.phone

const saved = await call('config', 'POST', { config: Object.assign({}, cfg.json.config, { phone: '13800138000' }) })
ok(saved.json && saved.json.ok === true, 'POST /config ok')
eq(saved.json && saved.json.config && saved.json.config.phone, '13800138000', 'POST /config saved phone')
const reread = await call('config')
eq(reread.json.config.phone, '13800138000', 'config persisted')

const man = await call('manual-order', 'POST', { trackingNo: 'SF1234567890123', carrier: '', title: '测试件' })
ok(man.json && man.json.ok === true, 'POST /manual-order ok')
ok(man.json.order && man.json.order.platform === 'manual', 'manual order platform is manual')
const manId = man.json.order && man.json.order.id
ok(!!manId, 'manual order has id')

const st2 = await call('state')
ok(st2.json.orders.some((o) => o.id === manId), 'manual order appears in /state')

// 刷新一次（平台 cookie 为空 → 各平台应报缺 cookie 的 skipped/errors，但不能崩）
const ref = await call('refresh', 'POST', {})
ok(ref.json && typeof ref.json === 'object', 'POST /refresh responds')
ok(Array.isArray(ref.json.orders), 'POST /refresh returns orders array')

// 轨迹查询：显式公司码，允许 no-result（免 key 不稳定），但不能崩
const tr = await call('track', 'POST', { trackingNo: '925153711389', carrier: 'shunfeng' })
ok(tr.json && typeof tr.json === 'object', 'POST /track responds')
ok(tr.json.ok === true || tr.json.ok === false, 'POST /track has boolean ok')
if (tr.json.ok === false) console.log('   track error =', tr.json.error)

const del = await call('manual-order/delete', 'POST', { id: manId })
ok(del.json && del.json.ok === true, 'POST /manual-order/delete ok')
const st3 = await call('state')
ok(!st3.json.orders.some((o) => o.id === manId), 'manual order removed from /state')

// 恢复原配置
await call('config', 'POST', { config: Object.assign({}, reread.json.config, { phone: beforePhone || '' }) })

// -------------------------------------------------------- client.js 形状
const clientSrc = readFileSync(join(root, 'client.js'), 'utf8')
let loaded = null
const sandbox = {
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  document: { createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }), head: { appendChild() {} }, querySelector: () => null },
  window: {},
  fetch: async () => ({ ok: true, json: async () => ({}) }),
  module: undefined, exports: undefined,
}
sandbox.window.__ModuleLoader__ = { load(def) { loaded = def } }
sandbox.globalThis = sandbox
vm.createContext(sandbox)
try {
  vm.runInContext(clientSrc, sandbox, { filename: 'client.js' })
} catch (err) {
  fails.push('client.js threw: ' + err.message)
  console.log('  client.js error:', err.message)
}
ok(!!loaded, 'client.js registers a module via __ModuleLoader__.load')
eq(loaded && loaded.id, 'dsh-parcel-tracker', 'client module id matches package name')
if (loaded && typeof loaded.factory === 'function') {
  const fakeRequire = (name) => {
    if (name === 'react') {
      return {
        createElement: (...a) => ({ type: a[0], props: a[1] || {}, children: a.slice(2) }),
        useState: (v) => [v, () => {}],
        useEffect: () => {}, useMemo: (f) => f(), useCallback: (f) => f, useRef: (v) => ({ current: v }),
        Fragment: 'Fragment',
      }
    }
    return {}
  }
  let api = null
  try { api = loaded.factory(fakeRequire) } catch (err) {
    fails.push('client factory threw: ' + err.message)
    console.log('  factory error:', err.message)
  }
  ok(api && typeof api.apply === 'function', 'client factory returns { apply }')
  ok(api && Array.isArray(api.inject) && api.inject.includes('slots'), 'client inject includes slots')
}

console.log('\n--- summary ---')
console.log(fails.length ? 'FAILS:\n' + fails.join('\n') : 'ALL PASS')
process.exitCode = fails.length ? 1 : 0
