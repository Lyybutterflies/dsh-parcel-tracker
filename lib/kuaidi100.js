/**
 * lib/kuaidi100.js —— 快递100 免 key 查询客户端（C 组）
 *
 * 契约来源：CONTRACT.md「快递100 契约」。
 * 端点：GET https://www.kuaidi100.com/query?type=<官方公司码>&postid=<运单号>
 *
 * ────────────────────────────────────────────────────────────────────────
 * 实测结论（2026-10-22，本机直连，共 ~80 次请求）—— 这些坑已踩过，改代码前先读：
 *
 * 1) **必须先建立会话 cookie，否则永远查不到真数据。**
 *    裸请求（不带 cookie）连续 17 个官方 testNumber 全部返回
 *    `{"state":"3","condition":"F00","data":[{"context":"查无结果"}]}`。
 *    先 GET 首页 + GET /chaxun?com=..&nu=.. 拿到 `globacsrftoken / csrftoken / WWWID`
 *    之后再查，同一批单号才有 3 个返回真实轨迹。所以本模块内置 cookie jar + 预热。
 *
 * 2) **「查无结果」是占位响应，不是"未签收"。**
 *    它的特征是 data 只有一条且 context 恰为「查无结果」、state=3、ischeck=1。
 *    如果不单独识别，会被状态码 3（签收）误判成"已签收" —— 本模块在解析前先拦掉，
 *    返回 { ok:false, error:'no-result' }。
 *
 * 3) **免 key 通道不稳定**：即使带 cookie，同一单号短时间内重复查，
 *    也会在「真实轨迹」与「查无结果」之间来回跳（服务端限流/轮换）。
 *    所以：查询结果一律缓存 5 分钟；失败不覆盖已有轨迹；界面上要能重试。
 *
 * 4) **state 码有两套编号并存**，不能只认一套：
 *    · 小数字（旧实时查询 API）：0 在途 / 1 揽收 / 2 疑难 / 3 签收 / 4 退签 /
 *      5 派件 / 6 退回 / 7 转投 / 8 清关 / 9 拒签 / 10 待清关 / 11 清关异常 / 12 拒收
 *    · 三位/四位（订阅推送 API）：303 = 已签收、1002 = 运输中 …
 *    本模块以 **最新一条轨迹文本** 为主判据，state 码只作兜底 —— 文本永远比码更能说明问题。
 *
 * 5) `status` 字段是 HTTP 语义码（'200' / '400'），**不是**物流状态；物流状态在 `state`。
 *    用错时看到 `{"message":"参数错误","status":"400"}`（公司码不存在时就是这样）。
 * ────────────────────────────────────────────────────────────────────────
 */

/** 查询端点 */
export const QUERY_ENDPOINT = 'https://www.kuaidi100.com/query'
/** 站点根（预热 cookie 用） */
export const SITE_ORIGIN = 'https://www.kuaidi100.com'
/** 默认超时（毫秒） */
export const DEFAULT_TIMEOUT_MS = 10 * 1000
/** 缓存 TTL（毫秒）——5 分钟 */
export const CACHE_TTL_MS = 5 * 60 * 1000
/** 缓存条数上限 */
const CACHE_MAX = 500
/** 会话 cookie 有效期（毫秒）——过期后重新预热 */
const COOKIE_TTL_MS = 20 * 60 * 1000

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

/** 「查无结果」占位响应的判定 */
export const NO_RESULT_TEXT = '查无结果'

/**
 * 旧版实时查询 state 码 → 归一状态。
 * 注意 3 = 签收，但占位响应也用 3 —— 调用方必须先过滤「查无结果」。
 */
const LEGACY_STATE_MAP = {
  0: 'in_transit',
  1: 'in_transit',
  2: 'unknown',
  3: 'delivered',
  4: 'unknown',
  5: 'in_transit',
  6: 'unknown',
  7: 'in_transit',
  8: 'in_transit',
  9: 'unknown',
  10: 'pending',
  11: 'unknown',
  12: 'unknown',
}

/**
 * state → 归一状态（两套编号都吃）。
 * @param {string|number} state
 * @returns {'pending'|'in_transit'|'delivered'|'unknown'}
 */
export function stateToStatus(state) {
  const text = String(state == null ? '' : state).trim()
  if (!text) return 'unknown'
  const n = Number(text)
  if (!Number.isFinite(n)) return 'unknown'
  // 三位：3xx = 签收系列（303 已签收 等）
  if (n >= 300 && n <= 399) return 'delivered'
  // 三位：2xx = 已下单/已揽收系列（约定 200 待揽收、201+ 运输中）
  if (n === 200) return 'pending'
  if (n >= 201 && n <= 299) return 'in_transit'
  // 四位：1002 运输中 之类
  if (n >= 1000) return 'in_transit'
  // 旧版小数字
  if (LEGACY_STATE_MAP[n]) return LEGACY_STATE_MAP[n]
  return 'unknown'
}

/** state → 中文短标签（前端可直接显示；拿不准返回 ''） */
export function stateToText(state) {
  const map = {
    0: '运输中', 1: '已揽收', 2: '疑难件', 3: '已签收', 4: '已退签',
    5: '派送中', 6: '已退回', 7: '已转投', 8: '清关中', 9: '已拒签',
    10: '待清关', 11: '清关异常', 12: '已拒收',
    303: '已签收',
  }
  return map[Number(state)] || ''
}

/**
 * 从轨迹文本推断状态（主判据）。
 * 只在能确定时返回，拿不准返回 ''，交给 state 码兜底。
 * @param {string} text
 */
export function textToStatus(text) {
  const s = String(text == null ? '' : text)
  if (!s) return ''
  // 明确签收类（放在最前，避免被「派送」抢走：「派送完成」应算签收）
  if (/已签收|签收成功|已收货|代收|已取件|已领取|投递成功|本人签收|已妥投|已放至|已放在/.test(s)) return 'delivered'
  // 派送/在途
  if (/派送中|正在派送|正在为您派送|派件|已到达|抵达|转运|发往|运输中|已发出|离开|分拨/.test(s)) return 'in_transit'
  if (/揽收|已揽件|上门揽收|已收件|已取|已下单/.test(s)) return 'in_transit'
  // 疑难/异常
  if (/拒收|拒签|退回|退签|异常|无人接听|地址不详|疑难|破损|丢失|取消/.test(s)) return 'unknown'
  if (/待揽收|待发货|等待生产|已下发库房|准备中/.test(s)) return 'pending'
  return ''
}

/** 内部缓存：key = `${carrier}:${trackingNo}` */
const cache = new Map()

function cacheGet(key) {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key)
    return null
  }
  return hit.value
}

function cacheSet(key, value) {
  if (cache.size >= CACHE_MAX) {
    const keys = Array.from(cache.keys()).slice(0, Math.ceil(cache.size / 2))
    for (const k of keys) cache.delete(k)
  }
  cache.set(key, { at: Date.now(), value })
}

/** 清空轨迹缓存 */
export function clearCache() {
  cache.clear()
}
/** 清空会话 cookie（下次查询会重新预热） */
export function clearSession() {
  jar.clear()
  warmedAt = 0
}

// ------------------------------------------------------------ 会话 cookie
/** 简易 cookie jar：name -> value */
const jar = new Map()
let warmedAt = 0
let warmPromise = null

function cookieHeader() {
  return Array.from(jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ')
}

function absorbCookies(res) {
  let list = []
  try {
    list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
  } catch (err) {
    list = []
  }
  for (const line of list) {
    const m = /^\s*([^=;\s]+)=([^;]*)/.exec(String(line))
    if (!m) continue
    const name = m[1]
    const value = m[2]
    if (/^(deleted|)$/i.test(value)) jar.delete(name)
    else jar.set(name, value)
  }
}

/**
 * 预热会话：GET 首页 + GET /chaxun 页，拿到 globacsrftoken / csrftoken / WWWID。
 * 不预热时接口只会返回「查无结果」占位。
 * @param {{ timeoutMs?: number, carrier?: string, trackingNo?: string, force?: boolean }} [options]
 */
export async function warmSession(options) {
  const opts = options || {}
  if (!opts.force && warmedAt && Date.now() - warmedAt < COOKIE_TTL_MS && jar.size) return true
  if (warmPromise) return warmPromise
  warmPromise = (async () => {
    const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : DEFAULT_TIMEOUT_MS
    const headers = {
      'User-Agent': DEFAULT_UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    }
    const hit = async (url) => {
      const controller = new AbortController()
      const timer = setTimeout(() => { try { controller.abort() } catch (e) { } }, timeoutMs)
      try {
        const res = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
          headers: Object.assign({}, headers, { Cookie: cookieHeader() }),
          redirect: 'follow',
        })
        absorbCookies(res)
        try { await res.arrayBuffer() } catch (e) { }
        return true
      } catch (err) {
        return false
      } finally {
        clearTimeout(timer)
      }
    }
    try {
      await hit(`${SITE_ORIGIN}/`)
      if (opts.carrier && opts.trackingNo) {
        await hit(
          `${SITE_ORIGIN}/chaxun?com=${encodeURIComponent(opts.carrier)}` +
          `&nu=${encodeURIComponent(opts.trackingNo)}`,
        )
      }
      warmedAt = Date.now()
      return jar.size > 0
    } finally {
      warmPromise = null
    }
  })()
  return warmPromise
}

// ---------------------------------------------------------------- 主查询
function normalizeArgs(trackingNo, carrier) {
  const no = String(trackingNo == null ? '' : trackingNo).trim().replace(/[\s-]+/g, '')
  const code = String(carrier == null ? '' : carrier).trim().toLowerCase()
  return { no, code }
}

function emptyResult(extra) {
  return Object.assign(
    {
      ok: false,
      state: '',
      status: 'unknown',
      statusText: '',
      traces: [],
      latest: '',
      fetchedAt: Date.now(),
      error: '',
      carrier: '',
      carrierName: '',
    },
    extra || {},
  )
}

/**
 * 查单条轨迹。
 * @param {string} trackingNo 运单号
 * @param {string} carrier 快递100 官方公司码（shunfeng / zhongtong / jd …）
 * @param {{ timeoutMs?:number, noCache?:boolean, signal?:AbortSignal, logger?:object }} [options]
 * @returns {Promise<{ ok:boolean, state:string,
 *   status:'pending'|'in_transit'|'delivered'|'unknown', statusText:string,
 *   traces:{time:string,context:string,location?:string}[], latest:string,
 *   fetchedAt:number, error:string, carrier:string, carrierName:string }>}
 */
export async function queryTracking(trackingNo, carrier, options) {
  const opts = options || {}
  const { no, code } = normalizeArgs(trackingNo, carrier)

  if (!no) return emptyResult({ error: 'missing-tracking-no' })
  if (code.length < 2) return emptyResult({ error: 'missing-carrier' })

  const key = `${code}:${no}`
  if (!opts.noCache) {
    const hit = cacheGet(key)
    if (hit) return hit
  }

  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : DEFAULT_TIMEOUT_MS

  // 预热会话（必须；否则只会拿到「查无结果」占位）
  try {
    await warmSession({ timeoutMs, carrier: code, trackingNo: no })
  } catch (err) { /* 预热失败也照常尝试，只是大概率返回占位 */ }

  const qs = new URLSearchParams({
    type: code,
    postid: no,
    temp: Math.random().toFixed(16).slice(2),
    phone: '',
  })
  const url = `${QUERY_ENDPOINT}?${qs.toString()}`

  const controller = new AbortController()
  const timer = setTimeout(() => { try { controller.abort() } catch (e) { } }, timeoutMs)
  let onAbort = null
  if (opts.signal) {
    if (opts.signal.aborted) {
      try { controller.abort() } catch (e) { }
    } else {
      onAbort = () => { try { controller.abort() } catch (e) { } }
      try { opts.signal.addEventListener('abort', onAbort, { once: true }) } catch (e) { }
    }
  }

  let text = ''
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': DEFAULT_UA,
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        Referer: `${SITE_ORIGIN}/chaxun?com=${encodeURIComponent(code)}&nu=${encodeURIComponent(no)}`,
        'X-Requested-With': 'XMLHttpRequest',
        Cookie: cookieHeader(),
      },
    })
    absorbCookies(res)
    text = await res.text()
    if (!res.ok) {
      const result = emptyResult({ error: `http-${res.status}`, carrier: code })
      cacheSet(key, result)
      return result
    }
  } catch (err) {
    const aborted = err && (err.name === 'AbortError' || /abort/i.test(String(err.message || '')))
    return emptyResult({
      error: aborted ? 'timeout' : `network:${err && err.message ? String(err.message) : 'unknown'}`,
      carrier: code,
    })
  } finally {
    clearTimeout(timer)
    if (opts.signal && onAbort) {
      try { opts.signal.removeEventListener('abort', onAbort) } catch (e) { }
    }
  }

  let json = null
  try {
    json = JSON.parse(text)
  } catch (err) {
    return emptyResult({ error: 'invalid-json', carrier: code })
  }

  const message = String(json.message != null ? json.message : '').trim()
  const apiStatus = String(json.status != null ? json.status : '').trim()
  const stateText = String(json.state != null ? json.state : '').trim()
  const rawData = Array.isArray(json.data) ? json.data : []
  const com = String(json.com || code)

  const traces = []
  for (const item of rawData) {
    if (!item || typeof item !== 'object') continue
    const time = String(item.ftime || item.time || '').trim()
    const context = String(item.context || item.status || '').trim()
    if (!time && !context) continue
    const trace = { time, context }
    const location = String(item.location || '').trim()
    if (location) trace.location = location
    traces.push(trace)
  }

  // --- 错误判定 ---
  const okMessage = message === '' || /^(ok|OK|查询成功)$/.test(message)
  if (!okMessage || (apiStatus && apiStatus !== '200')) {
    let error = message || `api-status-${apiStatus || 'unknown'}`
    if (/参数错误/.test(message)) error = `invalid-params(${code})`
    else if (/查询无结果|查无结果|暂无|无结果/.test(message)) error = 'no-result'
    else if (/非法访问|禁止访问|黑名单|被封/.test(message)) error = 'ip-blocked'
    else if (/频繁|限流|超过|稍后/.test(message)) error = 'rate-limited'
    const result = emptyResult({ error, carrier: com })
    cacheSet(key, result)
    return result
  }

  // --- 「查无结果」占位：不是真轨迹，更不是"已签收" ---
  const isPlaceholder =
    traces.length === 1 && String(traces[0].context || '').trim() === NO_RESULT_TEXT
  if (isPlaceholder || traces.length === 0) {
    const result = emptyResult({ error: 'no-result', carrier: com, state: stateText })
    cacheSet(key, result)
    return result
  }

  // --- 状态判定：轨迹文本优先，state 码兜底 ---
  const latestTrace = traces[0]
  const latest = String(latestTrace && latestTrace.context ? latestTrace.context : '')
  let status = textToStatus(latest)
  if (!status) status = textToStatus(traces.slice(0, 3).map((t) => t.context).join(' '))
  if (!status) status = stateToStatus(stateText)
  // 兜底：state 说签收但最新文本说不清 → 相信文本里的"派送"等已在上面命中；
  // 若文本完全无信息，则保留 state 结论。
  const statusText = status === 'delivered' ? '已签收'
    : status === 'pending' ? '待揽收'
    : status === 'in_transit' ? '运输中'
    : stateToText(stateText)

  const result = {
    ok: true,
    state: stateText,
    status,
    statusText,
    traces,
    latest,
    fetchedAt: Date.now(),
    error: '',
    carrier: com,
    carrierName: '',
  }
  try {
    const carriersMod = await import('./carriers.js')
    if (typeof carriersMod.carrierNameOf === 'function') result.carrierName = carriersMod.carrierNameOf(com)
  } catch (err) { /* carriers.js 缺失时只是没有中文名 */ }

  cacheSet(key, result)
  return result
}

/** 批量查询（串行，间隔 300ms，避免触发限流） */
export async function queryMany(items, options) {
  const list = Array.isArray(items) ? items : []
  const out = []
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i]
    const no = typeof item === 'string' ? item : item && item.trackingNo
    const code = typeof item === 'string' ? '' : item && item.carrier
    if (!no) { out.push(emptyResult({ error: 'missing-tracking-no' })); continue }
    if (!code) { out.push(emptyResult({ error: 'missing-carrier' })); continue }
    out.push(await queryTracking(no, code, options))
    if (i < list.length - 1) await new Promise((r) => setTimeout(r, 300))
  }
  return out
}

// ---------------------------------------------------------------- 兼容导出
// lib/index.js 的 getCarriers() 会依次尝试 kuaidi?.CARRIERS / kuaidi?.CARRIER_LIST
export { CARRIERS, CARRIER_LIST, CARRIER_MAP, COMMON_CODES } from './carriers.js'
