/**
 * lib/server.js —— HTTP 路由注册（前缀 /dsh-parcel）
 *
 * 契约来源：CONTRACT.md「HTTP API」表。
 * 约定（契约原文）：
 * - 响应统一 `Content-Type: application/json; charset=utf-8`
 * - 错误返回 `{ ok:false, error:'...' }` 且 **HTTP 仍 200**（前端统一处理），只有路由不存在才 404
 *
 * deps 由 lib/index.js 注入：
 *   { store, config, getState, refresh, updateConfig, getCarriers, trackOne,
 *     addManualOrder, deleteManualOrder }
 */

/** 路由前缀 */
export const API_PREFIX = '/dsh-parcel'

/** POST body 上限 1MB */
const MAX_BODY_BYTES = 1024 * 1024

/** 统一的 JSON 响应（HTTP 200） */
function sendJson(res, payload, statusCode = 200) {
  const body = JSON.stringify(payload === undefined ? null : payload)
  try {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
    })
  } catch (err) {
    // res 已经结束或不支持 writeHead —— 兜底直接 end
  }
  try { res.end(body) } catch (err) { /* 连接已断开，忽略 */ }
}

/** 错误响应：HTTP 200 + { ok:false, error } */
function sendError(res, error) {
  const message = typeof error === 'string' && error ? error : 'internal-error'
  sendJson(res, { ok: false, error: message })
}

/** 读取并解析 JSON body；空 body → {}；解析失败 → 抛 'bad-json' */
async function readJsonBody(req) {
  const chunks = []
  let size = 0
  try {
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), 'utf8')
      size += buf.length
      if (size > MAX_BODY_BYTES) throw new Error('payload-too-large')
      chunks.push(buf)
    }
  } catch (err) {
    if (err && err.message === 'payload-too-large') throw err
    // 连接中断等：当作空 body
    return {}
  }
  if (!chunks.length) return {}
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (!text) return {}
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new Error('bad-json')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('bad-json')
  }
  return parsed
}

/** 取请求方法（大写） */
function methodOf(req) {
  return String((req && req.method) || 'GET').toUpperCase()
}

/**
 * 注册全部路由。
 * @param {object} ctx  DSH 插件上下文
 * @param {object} deps 依赖集合（见文件头）
 * @returns {Array<Function>} disposer 列表（每个路由一个）
 */
export function registerRoutes(ctx, deps = {}) {
  const disposers = []
  const logger = (ctx && ctx.logger) || console
  const log = {
    debug: (...a) => { try { logger.debug?.(...a) } catch (e) {} },
    warn: (...a) => { try { logger.warn?.(...a) } catch (e) { console.warn(...a) } },
    error: (...a) => { try { logger.error?.(...a) } catch (e) { console.error(...a) } },
  }

  const server = ctx && ctx.webServer
  if (!server || typeof server.register !== 'function') {
    log.warn('[dsh-parcel-tracker] ctx.webServer 不可用，HTTP 路由未注册')
    return disposers
  }

  /** 包装 handler：统一 try/catch → 错误也返回 HTTP 200 + { ok:false } */
  const wrap = (name, handler) => async (req, res) => {
    try {
      await handler(req, res)
    } catch (err) {
      const message = err && err.message ? String(err.message) : 'internal-error'
      log.error(`[dsh-parcel-tracker] ${name} 失败: ${message}`)
      try { sendError(res, message) } catch (e) {}
    }
  }

  const register = (route) => {
    try {
      const disposer = server.register(route)
      if (typeof disposer === 'function') disposers.push(disposer)
      else if (disposer && typeof disposer.dispose === 'function') disposers.push(() => disposer.dispose())
    } catch (err) {
      log.error(`[dsh-parcel-tracker] 注册路由 ${route.path} 失败: ${err && err.message}`)
    }
  }

  // ---------------------------------------------------------------- state
  register({
    kind: 'exact',
    path: `${API_PREFIX}/state`,
    handler: wrap('state', async (req, res) => {
      const state = await deps.getState()
      sendJson(res, {
        ok: true,
        config: state.config,          // 必须是掩码版本（由 getState 负责）
        orders: Array.isArray(state.orders) ? state.orders : [],
        updatedAt: state.updatedAt || 0,
        nextRefreshAt: state.nextRefreshAt || 0,
        running: !!state.running,
        errors: Array.isArray(state.errors) ? state.errors : [],
        skipped: Array.isArray(state.skipped) ? state.skipped : [],
      })
    }),
  })

  // --------------------------------------------------------------- orders
  register({
    kind: 'exact',
    path: `${API_PREFIX}/orders`,
    handler: wrap('orders', async (req, res) => {
      const state = await deps.getState()
      sendJson(res, {
        ok: true,
        orders: Array.isArray(state.orders) ? state.orders : [],
        updatedAt: state.updatedAt || 0,
      })
    }),
  })

  // -------------------------------------------------------------- refresh
  register({
    kind: 'exact',
    path: `${API_PREFIX}/refresh`,
    handler: wrap('refresh', async (req, res) => {
      let body = {}
      if (methodOf(req) === 'POST') {
        try { body = await readJsonBody(req) } catch (err) {
          sendError(res, err && err.message === 'bad-json' ? 'bad-json' : 'bad-request')
          return
        }
      }
      const platforms = Array.isArray(body.platforms)
        ? body.platforms.filter((p) => typeof p === 'string' && p)
        : undefined
      const result = await deps.refresh(platforms)
      sendJson(res, {
        ok: result && result.ok !== false,
        orders: result && Array.isArray(result.orders) ? result.orders : [],
        updatedAt: (result && result.updatedAt) || 0,
        errors: result && Array.isArray(result.errors) ? result.errors : [],
        skipped: result && Array.isArray(result.skipped) ? result.skipped : [],
      })
    }),
  })

  // --------------------------------------------------------------- config
  // 同一个 path 需要同时支持 GET / POST → 注册一条 exact 路由在 handler 内分流
  register({
    kind: 'exact',
    path: `${API_PREFIX}/config`,
    handler: wrap('config', async (req, res) => {
      const method = methodOf(req)
      if (method === 'POST' || method === 'PUT') {
        let body
        try { body = await readJsonBody(req) } catch (err) {
          sendError(res, err && err.message === 'bad-json' ? 'bad-json' : 'bad-request')
          return
        }
        // 前端可能直接回传整个 { config: {...} }，也可能是 config 本体
        const incoming = (body && typeof body.config === 'object' && body.config !== null && !Array.isArray(body.config))
          ? body.config
          : body
        const saved = await deps.updateConfig(incoming)
        if (saved && saved.ok === false) {
          sendError(res, saved.error || 'update-config-failed')
          return
        }
        sendJson(res, { ok: true, config: (saved && saved.config) || (await deps.getState()).config })
        return
      }
      const state = await deps.getState()
      sendJson(res, { ok: true, config: state.config })
    }),
  })

  // ---------------------------------------------------------------- track
  register({
    kind: 'exact',
    path: `${API_PREFIX}/track`,
    handler: wrap('track', async (req, res) => {
      let body
      try { body = await readJsonBody(req) } catch (err) {
        sendError(res, err && err.message === 'bad-json' ? 'bad-json' : 'bad-request')
        return
      }
      const trackingNo = typeof body.trackingNo === 'string' ? body.trackingNo.trim() : ''
      if (!trackingNo) { sendError(res, 'missing-tracking-no'); return }
      const carrier = typeof body.carrier === 'string' ? body.carrier.trim() : ''
      const result = await deps.trackOne(trackingNo, carrier)
      if (!result) { sendError(res, 'track-failed'); return }
      if (result.ok === false) {
        sendJson(res, { ok: false, error: result.error || 'track-failed', tracking: result.tracking || null })
        return
      }
      sendJson(res, { ok: true, tracking: result.tracking || null })
    }),
  })

  // ---------------------------------------------------------- manual-order
  register({
    kind: 'exact',
    path: `${API_PREFIX}/manual-order`,
    handler: wrap('manual-order', async (req, res) => {
      let body
      try { body = await readJsonBody(req) } catch (err) {
        sendError(res, err && err.message === 'bad-json' ? 'bad-json' : 'bad-request')
        return
      }
      const trackingNo = typeof body.trackingNo === 'string' ? body.trackingNo.trim() : ''
      if (!trackingNo) { sendError(res, 'missing-tracking-no'); return }
      const order = await deps.addManualOrder({
        platform: typeof body.platform === 'string' ? body.platform.trim() : 'manual',
        title: typeof body.title === 'string' ? body.title.trim() : '',
        trackingNo,
        carrier: typeof body.carrier === 'string' ? body.carrier.trim() : '',
        carrierName: typeof body.carrierName === 'string' ? body.carrierName.trim() : '',
        createdAt: Number.isFinite(Number(body.createdAt)) ? Number(body.createdAt) : undefined,
      })
      if (!order) { sendError(res, 'add-manual-order-failed'); return }
      sendJson(res, { ok: true, order })
    }),
  })

  // -------------------------------------------------- manual-order/delete
  // 先于 manual-order 注册（exact 匹配互不干扰，但保持顺序清晰）
  register({
    kind: 'exact',
    path: `${API_PREFIX}/manual-order/delete`,
    handler: wrap('manual-order-delete', async (req, res) => {
      let body
      try { body = await readJsonBody(req) } catch (err) {
        sendError(res, err && err.message === 'bad-json' ? 'bad-json' : 'bad-request')
        return
      }
      const id = typeof body.id === 'string' ? body.id.trim() : ''
      if (!id) { sendError(res, 'missing-id'); return }
      const result = await deps.deleteManualOrder(id)
      if (result && result.ok === false) { sendError(res, result.error || 'delete-failed'); return }
      sendJson(res, { ok: true })
    }),
  })

  // ------------------------------------------------------------- carriers
  register({
    kind: 'exact',
    path: `${API_PREFIX}/carriers`,
    handler: wrap('carriers', async (req, res) => {
      let carriers = []
      try {
        const result = await deps.getCarriers()
        if (Array.isArray(result)) carriers = result
        else if (result && Array.isArray(result.carriers)) carriers = result.carriers
      } catch (err) {
        log.warn(`[dsh-parcel-tracker] getCarriers 失败: ${err && err.message}`)
        sendError(res, 'carriers-unavailable')
        return
      }
      const normalized = carriers
        .filter((c) => c && typeof c === 'object')
        .map((c) => ({ code: String(c.code || ''), name: String(c.name || c.code || '') }))
        .filter((c) => c.code)
      sendJson(res, { ok: true, carriers: normalized })
    }),
  })

  return disposers
}
