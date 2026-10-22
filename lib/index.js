/**
 * lib/index.js —— host 入口（export function apply(ctx)）
 *
 * 职责：
 *   1. 初始化 store（读/写 <base>/parcel-tracker/state.json）
 *   2. 加载并归一 config
 *   3. 注册 HTTP 路由（前缀 /dsh-parcel，见 lib/server.js）
 *   4. 启动轮询调度（订单刷新 + 轨迹刷新，定时器必须挂在 ctx.effect 的 cleanup 上）
 *   5. 暴露 parcelTracker 服务（ctx.provide / ctx.get）
 *
 * 跨组依赖（动态 import + 容错，文件不存在时不能崩）：
 *   - B 组：lib/platforms/index.js → fetchAllPlatformOrders
 *   - C 组：lib/kuaidi100.js       → queryTracking, CARRIERS
 *   - C 组：lib/carriers.js        → guessCarrier / 公司码表
 */
import { normalizeConfig, loadConfig, maskConfig, unmaskConfig } from './config.js'
import { resolveStatePath, readState, writeState } from './store.js'
import { mergeOrders, dedupeOrders, sortOrders, summarize, normalizeStatus, orderKey } from './aggregate.js'
import { registerRoutes } from './server.js'

/** 插件名 */
export const name = 'dsh-parcel-tracker'

/** 轨迹后台刷新时的本地 TTL（秒）——C 组自身也有 5 分钟缓存，这里只是防抖 */
const LOCAL_TRACK_TTL_MS = 60 * 1000

/** 内部：把任意导入结果里的公司码表统一成 [{code,name}] */
function normalizeCarrierList(list) {
  if (!Array.isArray(list)) return []
  const out = []
  for (const item of list) {
    if (!item) continue
    if (typeof item === 'string') {
      out.push({ code: item, name: item })
      continue
    }
    if (typeof item !== 'object') continue
    const code = String(item.code || item.value || item.key || '').trim()
    if (!code) continue
    const nameText = String(item.name || item.label || item.title || code).trim()
    out.push({ code, name: nameText })
  }
  return out
}

export function apply(ctx) {
  const hostCtx = ctx || {}
  const rawLogger = hostCtx.logger || null
  const log = {
    debug: (...args) => { try { rawLogger?.debug?.(...args) } catch (err) { /* ignore */ } },
    info: (...args) => { try { rawLogger?.info?.(...args) } catch (err) { console.log(...args) } },
    warn: (...args) => { try { rawLogger?.warn?.(...args) } catch (err) { console.warn(...args) } },
    error: (...args) => { try { rawLogger?.error?.(...args) } catch (err) { console.error(...args) } },
  }

  // ---------------------------------------------------------------- 状态
  const statePath = resolveStatePath()
  let persisted = readState()
  // config 与 orders 同存在 state.json；loadConfig 兼容「config 本体」与「{config:…} 包装」两种形状
  let config = loadConfig(statePath)
  if (!config || typeof config !== 'object') config = normalizeConfig(persisted.config)
  let orders = Array.isArray(persisted.orders) ? persisted.orders : []
  let updatedAt = typeof persisted.updatedAt === 'number' ? persisted.updatedAt : 0
  let lastErrors = []
  /** 本轮因「未配置 Cookie / 已禁用」被跳过的平台，前端用来区分「真没快递」和「抓不到」 */
  let lastSkipped = []
  let running = false
  let nextRefreshAt = 0
  /** @type {Promise<any>|null} 正在进行的刷新 */
  let inflight = null
  /** @type {Map<string, {at:number, result:any}>} 轨迹本地缓存 */
  const trackCache = new Map()

  log.info(`[dsh-parcel-tracker] 已加载，状态文件: ${statePath}`)

  // ------------------------------------------------------- 跨组模块（懒加载）
  /** @type {Promise<any>|null} */
  let platformsModPromise = null
  /** @type {Promise<any>|null} */
  let kuaidiModPromise = null
  /** @type {Promise<any>|null} */
  let carriersModPromise = null

  function loadPlatformsModule() {
    if (!platformsModPromise) {
      platformsModPromise = import('./platforms/index.js').catch((err) => {
        log.warn(`[dsh-parcel-tracker] B 组平台适配器不可用: ${err && err.message}`)
        return null
      })
    }
    return platformsModPromise
  }
  function loadKuaidiModule() {
    if (!kuaidiModPromise) {
      kuaidiModPromise = import('./kuaidi100.js').catch((err) => {
        log.warn(`[dsh-parcel-tracker] C 组快递100 客户端不可用: ${err && err.message}`)
        return null
      })
    }
    return kuaidiModPromise
  }
  function loadCarriersModule() {
    if (!carriersModPromise) {
      carriersModPromise = import('./carriers.js').catch((err) => {
        log.debug(`[dsh-parcel-tracker] C 组 carriers.js 不可用: ${err && err.message}`)
        return null
      })
    }
    return carriersModPromise
  }

  // ------------------------------------------------------- 手动订单（config）
  /** 把 config.manualOrders 条目转成 Order 形状 */
  function manualEntryToOrder(entry) {
    const trackingNo = String(entry?.trackingNo || '').trim()
    const platform = String(entry?.platform || 'manual').trim() || 'manual'
    const id = String(entry?.id || '').trim() || orderKey(platform, trackingNo)
    return {
      id,
      platform,
      title: String(entry?.title || ''),
      trackingNo,
      carrier: String(entry?.carrier || ''),
      carrierName: String(entry?.carrierName || ''),
      status: normalizeStatus(entry?.status || 'unknown'),
      statusText: String(entry?.statusText || ''),
      createdAt: Number.isFinite(Number(entry?.createdAt)) ? Number(entry.createdAt) : null,
      updatedAt: Number.isFinite(Number(entry?.updatedAt)) ? Number(entry.updatedAt) : null,
      tracking: entry?.tracking && typeof entry.tracking === 'object' ? entry.tracking : null,
      error: String(entry?.error || ''),
    }
  }

  /** 依据 config.manualOrders 同步 orders 里的手动条目（新增/删除都走这里） */
  function syncManualOrders() {
    const desired = (config.manualOrders || []).map(manualEntryToOrder).filter((o) => o.trackingNo)
    const nonManual = orders.filter((o) => o && String(o.platform || '') !== 'manual')
    orders = mergeOrders(nonManual, desired)
  }

  syncManualOrders()

  // ------------------------------------------------------------- 持久化
  async function persist() {
    const payload = { config, orders, updatedAt: updatedAt || Date.now() }
    try {
      await writeState(payload)
    } catch (err) {
      log.error(`[dsh-parcel-tracker] 写状态失败: ${err && err.message}`)
    }
  }

  // --------------------------------------------------------- 快递公司码
  async function getCarriers() {
    const kuaidi = await loadKuaidiModule()
    const carriersMod = await loadCarriersModule()
    const candidates = [
      kuaidi?.CARRIERS,
      kuaidi?.CARRIER_LIST,
      carriersMod?.CARRIERS,
      carriersMod?.CARRIER_LIST,
      carriersMod?.CARRIER_MAP,
    ]
    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        const list = normalizeCarrierList(candidate)
        if (list.length) return list
      } else if (candidate && typeof candidate === 'object') {
        // { code: name } 形式的映射表
        const list = normalizeCarrierList(
          Object.entries(candidate).map(([code, name]) => ({ code, name })),
        )
        if (list.length) return list
      }
    }
    if (typeof carriersMod?.listCarriers === 'function') {
      try {
        const list = normalizeCarrierList(await carriersMod.listCarriers())
        if (list.length) return list
      } catch (err) { /* ignore */ }
    }
    return []
  }

  /** 解析订单的快递公司码：订单自带 → carrierOverrides → carriers.js 猜测 */
  async function resolveCarrier(order) {
    const trackingNo = String(order?.trackingNo || '').trim()
    if (!trackingNo) return ''
    if (order?.carrier) return String(order.carrier)
    const override = config.carrierOverrides?.[trackingNo]
    if (override) return String(override)
    const carriersMod = await loadCarriersModule()
    // C 组 lib/carriers.js 的入口名可能是 guessCarrier / guessCarrierCode 等，
    // 这里按候选名依次尝试，任何一个返回非空即采用。
    for (const fnName of ['guessCarrier', 'guessCarrierCode', 'carrierFromTrackingNo', 'guess']) {
      if (typeof carriersMod?.[fnName] !== 'function') continue
      try {
        const guessed = await carriersMod[fnName](trackingNo)
        if (guessed) return String(guessed)
      } catch (err) { /* ignore */ }
    }
    // 只有公司名没有公司码 → 走 companyNameToCode
    const carrierName = String(order?.carrierName || '').trim()
    if (carrierName && typeof carriersMod?.companyNameToCode === 'function') {
      try {
        const code = await carriersMod.companyNameToCode(carrierName)
        if (code) return String(code)
      } catch (err) { /* ignore */ }
    }
    return ''
  }

  // ------------------------------------------------------------- 轨迹查询
  /**
   * 查单条轨迹。
   * @returns {Promise<{ok:boolean, error?:string, tracking:object}>}
   */
  async function queryTrackingOnce(trackingNo, carrier) {
    const mod = await loadKuaidiModule()
    if (!mod || typeof mod.queryTracking !== 'function') {
      return { ok: false, error: 'kuaidi100-module-unavailable', tracking: null }
    }
    if (!carrier) {
      return { ok: false, error: 'carrier-unknown', tracking: null }
    }
    try {
      const raw = await mod.queryTracking(trackingNo, carrier)
      if (!raw || typeof raw !== 'object') {
        return { ok: false, error: 'track-invalid-result', tracking: null }
      }
      const tracking = {
        ok: raw.ok !== false,
        state: String(raw.state || ''),
        status: normalizeStatus(raw.status || raw.state || 'unknown'),
        traces: Array.isArray(raw.traces) ? raw.traces : [],
        fetchedAt: Number.isFinite(Number(raw.fetchedAt)) ? Number(raw.fetchedAt) : Date.now(),
        error: String(raw.error || ''),
      }
      if (!tracking.ok) {
        return { ok: false, error: tracking.error || 'track-failed', tracking }
      }
      return { ok: true, tracking }
    } catch (err) {
      return { ok: false, error: err && err.message ? String(err.message) : 'track-failed', tracking: null }
    }
  }

  /** 带本地 TTL 缓存的单条轨迹查询（后台批量用） */
  async function queryTrackingCached(trackingNo, carrier) {
    const key = `${carrier}:${trackingNo}`
    const hit = trackCache.get(key)
    const now = Date.now()
    if (hit && now - hit.at < LOCAL_TRACK_TTL_MS) return hit.result
    const result = await queryTrackingOnce(trackingNo, carrier)
    trackCache.set(key, { at: now, result })
    return result
  }

  // --------------------------------------------------------------- 刷新
  /**
   * 拉取平台订单 + 轨迹，合并入 store。
   * @param {string[]|undefined} onlyPlatforms 只刷新指定平台（缺省 = 全部启用平台）
   */
  async function runRefresh(onlyPlatforms) {
    const errors = []
    const skipped = []
    const platformsMod = await loadPlatformsModule()
    let fetched = []

    if (!platformsMod || typeof platformsMod.fetchAllPlatformOrders !== 'function') {
      errors.push({ platform: '*', message: 'platforms-module-unavailable' })
    } else {
      // 只刷新指定平台 → 复制一份 config，把其它平台关掉
      let cfg = config
      if (Array.isArray(onlyPlatforms) && onlyPlatforms.length) {
        const allowed = new Set(onlyPlatforms.map((p) => String(p)))
        cfg = {
          ...config,
          platforms: Object.fromEntries(
            Object.entries(config.platforms).map(([key, value]) => [
              key,
              allowed.has(key) ? value : { ...value, enabled: false },
            ]),
          ),
        }
      }
      try {
        const result = await platformsMod.fetchAllPlatformOrders(cfg, {
          logger: rawLogger || console,
          signal: undefined,
          timeoutMs: 15000,
        })
        if (result && Array.isArray(result.orders)) fetched = result.orders
        if (result && Array.isArray(result.skipped)) {
          for (const s of result.skipped) {
            skipped.push({
              platform: String((s && s.platform) || '*'),
              reason: String((s && s.reason) || 'skipped'),
            })
          }
        }
        if (result && Array.isArray(result.errors)) {
          for (const e of result.errors) {
            errors.push({
              platform: String((e && e.platform) || '*'),
              message: String((e && (e.message || e.error)) || 'unknown-error'),
            })
          }
        }
      } catch (err) {
        errors.push({ platform: '*', message: err && err.message ? String(err.message) : 'fetch-failed' })
      }
    }

    // 合并：平台订单覆盖同 id 的旧条目；手动订单条目保留（platform='manual'）
    const manualOrders = orders.filter((o) => o && String(o.platform || '') === 'manual')
    const platformOrders = orders.filter((o) => o && String(o.platform || '') !== 'manual')
    orders = mergeOrders(mergeOrders(platformOrders, fetched), manualOrders)

    // 轨迹刷新
    if (config.trackEnabled) {
      for (const order of orders) {
        if (!order || !order.trackingNo) continue
        // 平台自带轨迹（京东 traceMultiPackage 等）优先：不再打快递100，
        // 既省配额也避开快递100 的 IP 限流；平台刷新时会把轨迹重新带回来。
        if (
          order.tracking &&
          order.tracking.ok === true &&
          order.tracking.source === 'platform' &&
          Array.isArray(order.tracking.traces) &&
          order.tracking.traces.length > 0
        ) {
          if (order.tracking.status) order.status = order.tracking.status
          continue
        }
        const carrier = await resolveCarrier(order)
        if (!carrier) {
          // 猜不到公司码：免 key 模式不能用 type=auto/all，跳过查询（前端提示用户手选）。
          // 注意不能因为"本次没查到"就抹掉已有轨迹 —— 只在没有真实轨迹时才写占位。
          if (isEmptyTracking(order.tracking)) {
            order.tracking = {
              ok: false,
              state: '',
              status: 'unknown',
              traces: [],
              fetchedAt: Date.now(),
              error: 'carrier-unknown',
            }
          }
          continue
        }
        const result = await queryTrackingCached(order.trackingNo, carrier)
        if (result && result.tracking) {
          order.tracking = result.tracking
          if (result.tracking.status) order.status = result.tracking.status
          if (!order.carrier) order.carrier = carrier
        } else if (result && !result.ok && isEmptyTracking(order.tracking)) {
          order.tracking = {
            ok: false,
            state: '',
            status: 'unknown',
            traces: [],
            fetchedAt: Date.now(),
            error: result.error || 'track-failed',
          }
        }
      }
    }

    orders = dedupeOrders(sortOrders(orders))
    updatedAt = Date.now()
    lastErrors = errors
    lastSkipped = skipped
    await persist()
    return { ok: true, orders, updatedAt, errors, skipped }
  }

  /** 对外的 refresh：并发调用时复用同一个 in-flight Promise */
  async function refresh(onlyPlatforms) {
    if (inflight) {
      try { return await inflight } catch (err) { /* fallthrough */ }
    }
    running = true
    const task = (async () => {
      try {
        return await runRefresh(onlyPlatforms)
      } catch (err) {
        log.error(`[dsh-parcel-tracker] 刷新失败: ${err && err.message}`)
        lastErrors = [{ platform: '*', message: err && err.message ? String(err.message) : 'refresh-failed' }]
        lastSkipped = []
        return { ok: false, orders, updatedAt, errors: lastErrors, skipped: lastSkipped }
      } finally {
        running = false
        inflight = null
      }
    })()
    inflight = task
    return task
  }

  // ------------------------------------------------------------ 配置读写
  /** 合并保存配置：掩码 cookie 不会被写坏（unmaskConfig 保留旧明文） */
  async function updateConfig(incoming) {
    const merged = unmaskConfig(config, incoming)
    config = merged
    syncManualOrders()
    updatedAt = Date.now()
    try {
      // config 与 orders 同存在 state.json → 用 persist 写，避免另存成独立文件把订单弄丢
      await persist()
    } catch (err) {
      log.error(`[dsh-parcel-tracker] 写配置失败: ${err && err.message}`)
      return { ok: false, error: 'save-config-failed' }
    }
    // 轮询间隔可能变了 → 重新挂定时器
    rescheduleTimers()
    return { ok: true, config: maskConfig(config) }
  }

  // ---------------------------------------------------------- 手动订单
  async function addManualOrder(payload) {
    const trackingNo = String(payload?.trackingNo || '').trim()
    if (!trackingNo) return null
    const platform = String(payload?.platform || 'manual').trim() || 'manual'
    const id = orderKey(platform, trackingNo)
    const now = Date.now()
    const createdAt = Number.isFinite(Number(payload?.createdAt)) ? Number(payload.createdAt) : now
    const entry = {
      id,
      platform,
      title: String(payload?.title || ''),
      trackingNo,
      carrier: String(payload?.carrier || ''),
      carrierName: String(payload?.carrierName || ''),
      status: 'unknown',
      statusText: '',
      createdAt,
      updatedAt: now,
    }
    const list = (config.manualOrders || []).filter((m) => String(m?.id || '') !== id)
    list.push(entry)
    config = { ...config, manualOrders: list }
    syncManualOrders()
    updatedAt = now
    await persist()
    return orders.find((o) => o && o.id === id) || manualEntryToOrder(entry)
  }

  async function deleteManualOrder(id) {
    const target = String(id || '').trim()
    if (!target) return { ok: false, error: 'missing-id' }
    const before = (config.manualOrders || []).length
    config = {
      ...config,
      manualOrders: (config.manualOrders || []).filter((m) => String(m?.id || '') !== target),
    }
    if (config.manualOrders.length === before) {
      // 仍然把 orders 里的对应条目清掉（兜底：可能 id 格式不一致）
      orders = orders.filter((o) => o && String(o.id || '') !== target)
    }
    syncManualOrders()
    updatedAt = Date.now()
    await persist()
    return { ok: true }
  }

  // ------------------------------------------------------------ 状态读取
  async function getState() {
    return {
      config: maskConfig(config),
      orders: sortOrders(orders),
      updatedAt: updatedAt || 0,
      nextRefreshAt: nextRefreshAt || 0,
      running: !!running,
      errors: Array.isArray(lastErrors) ? lastErrors : [],
      skipped: Array.isArray(lastSkipped) ? lastSkipped : [],
    }
  }

  async function trackOne(trackingNo, carrier) {
    const no = String(trackingNo || '').trim()
    if (!no) return { ok: false, error: 'missing-tracking-no' }
    let code = String(carrier || '').trim()
    if (!code) {
      const override = config.carrierOverrides?.[no]
      if (override) code = String(override)
    }
    if (!code) {
      const carriersMod = await loadCarriersModule()
      if (typeof carriersMod?.guessCarrier === 'function') {
        try { code = String(carriersMod.guessCarrier(no) || '') } catch (err) { /* ignore */ }
      }
    }
    const result = await queryTrackingOnce(no, code)
    if (!result.ok) {
      return { ok: false, error: result.error || 'track-failed', tracking: result.tracking || null }
    }
    // 顺手把已存在的同号订单更新掉
    const target = orders.find((o) => o && String(o.trackingNo || '') === no)
    if (target) {
      target.tracking = result.tracking
      target.status = result.tracking.status
      if (!target.carrier && code) target.carrier = code
      await persist()
    }
    return { ok: true, tracking: result.tracking }
  }

  // ---------------------------------------------------------------- 汇总
  function getSummary() {
    return summarize(orders)
  }

  // ------------------------------------------------------------ 定时器
  let orderTimer = null
  let trackTimer = null

  function stopTimers() {
    if (orderTimer) { clearInterval(orderTimer); orderTimer = null }
    if (trackTimer) { clearInterval(trackTimer); trackTimer = null }
  }

  function startTimers() {
    stopTimers()
    const orderMs = Math.max(1, Number(config.refreshMinutes) || 15) * 60 * 1000
    const trackMs = Math.max(1, Number(config.trackRefreshMinutes) || 10) * 60 * 1000
    orderTimer = setInterval(() => { refresh().catch((err) => log.error(`[dsh-parcel-tracker] 定时刷新失败: ${err && err.message}`)) }, orderMs)
    trackTimer = setInterval(() => { refresh().catch((err) => log.error(`[dsh-parcel-tracker] 定时轨迹刷新失败: ${err && err.message}`)) }, trackMs)
    try { orderTimer.unref?.() } catch (err) { /* ignore */ }
    try { trackTimer.unref?.() } catch (err) { /* ignore */ }
    nextRefreshAt = Date.now() + orderMs
  }

  /** 配置变化后重新安排定时器（必须在 ctx.effect 的 setup 内首次调用） */
  function rescheduleTimers() {
    if (!orderTimer && !trackTimer) {
      // effect 还没建立 → 之后 startTimers 会用最新 config
      return
    }
    startTimers()
  }

  // ------------------------------------------------------------ 路由注册
  const routeDisposers = []
  let routesRegistered = false

  function doRegisterRoutes(target) {
    if (routesRegistered) return true
    let server = null
    try { server = target && target.webServer } catch (err) { server = null }
    if (!server || typeof server.register !== 'function') return false
    try {
      const disposers = registerRoutes(target, {
        store: { readState, writeState },
        config: () => config,
        getState,
        refresh,
        updateConfig,
        getCarriers,
        trackOne,
        addManualOrder,
        deleteManualOrder,
      })
      for (const d of disposers) routeDisposers.push(d)
      routesRegistered = true
      log.info(`[dsh-parcel-tracker] HTTP 路由已注册（${disposers.length} 条）`)
      return true
    } catch (err) {
      log.error(`[dsh-parcel-tracker] 注册 HTTP 路由失败: ${err && err.message}`)
      return false
    }
  }

  // ------------------------------------------------------------ 生命周期
  const disposers = []
  // ① 定时器：必须挂在 ctx.effect 的 cleanup 上
  try {
    hostCtx.effect(() => {
      startTimers()
      return () => {
        stopTimers()
        nextRefreshAt = 0
      }
    }, 'dsh-parcel-tracker: poll timers')
  } catch (err) {
    log.warn(`[dsh-parcel-tracker] ctx.effect 不可用，定时器改为手动清理: ${err && err.message}`)
    startTimers()
    disposers.push(() => stopTimers())
  }
  // ② 路由 disposer
  try {
    hostCtx.effect(() => () => {
      for (const d of routeDisposers) { try { d() } catch (err) { /* ignore */ } }
      routeDisposers.length = 0
      routesRegistered = false
    }, 'dsh-parcel-tracker: http routes')
  } catch (err) {
    disposers.push(() => {
      for (const d of routeDisposers) { try { d() } catch (err) { /* ignore */ } }
    })
  }

  // ③ 路由注册：cordis 里未声明 inject 的服务不能直接读（会抛
  //   cannot get property "webServer" without inject），所以统一走 ctx.inject 等 webServer 就绪。
  try {
    if (typeof hostCtx.inject === 'function') {
      hostCtx.inject(['webServer'], (scoped) => { doRegisterRoutes(scoped || hostCtx) })
    } else {
      log.warn('[dsh-parcel-tracker] ctx.inject 不可用，HTTP 路由未注册')
    }
  } catch (err) {
    log.warn(`[dsh-parcel-tracker] 等待 webServer 注入失败: ${err && err.message}`)
  }

  // ④ 服务暴露
  const service = {
    getState,
    refresh,
    updateConfig,
    getCarriers,
    trackOne,
    addManualOrder,
    deleteManualOrder,
    getSummary,
    getConfig: () => maskConfig(config),
    getStatePath: () => statePath,
  }
  try {
    hostCtx.provide?.('parcelTracker', service)
  } catch (err) {
    log.warn(`[dsh-parcel-tracker] ctx.provide 失败: ${err && err.message}`)
  }

  // ⑤ 首屏：先把已有订单读出来（不阻塞 apply）
  Promise.resolve()
    .then(() => refresh())
    .catch((err) => log.error(`[dsh-parcel-tracker] 首次刷新失败: ${err && err.message}`))

  return service
}
