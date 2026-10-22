/**
 * dsh-parcel-tracker — 拼多多订单适配器（lib/platforms/pdd.js）
 *
 * 拼多多的 H5 是**服务端渲染**的：订单列表和物流详情都直接写在 HTML 里的
 * `window.rawData = {...}` 里，所以只要带登录态 Cookie GET 页面就能读，不需要
 * `anti_content` 风控参数。两步：
 *
 *   1) 订单列表：GET https://mobile.yangkeduo.com/orders.html?type=0&...
 *      → window.rawData.ordersStore.orders[]
 *        每单有 orderSn / orderStatusPrompt / trackingNumber / shippingId /
 *        orderGoods[].goodsName / extraInfo.orderHint.extraMap.pddStatus
 *   2) 逐单物流：GET https://mobile.yangkeduo.com/goods_express.html
 *        ?tracking_number=<运单号>&shipping_id=<id>&order_sn=<单号>&hide_address=1
 *      → window.rawData.store.traceData.shipping
 *        { shippingName <快递公司>, trackingNumber, shippingStatus,
 *          traces[] {info,time,displayTime,status,statusTag},
 *          timeForecast.traceStatusDesc }
 *
 * 实测要点（2026-10）：
 *   - orders.html 订单列表里**已经有运单号**（trackingNumber），但 `shippingName` 是空的，
 *     所以快递公司只能从物流详情页拿。
 *   - 物流详情页带完整轨迹，拿到就用它（source='platform'），不再打快递100。
 *   - 纯数字运单号（如 77127094235378）无法从号段猜公司，必须靠 shippingName。
 */

const ORDERS_URL = 'https://mobile.yangkeduo.com/orders.html?type=0&comment_tab=1&combine_orders=1&main_orders=1'
const EXPRESS_URL = 'https://mobile.yangkeduo.com/goods_express.html'

/** 一次刷新最多查多少单的物流详情（每单一个整页请求，别太频繁） */
const MAX_TRACE_QUERIES = 8

/** 已完结/无效的订单状态：不需要运单号也不需要轨迹 */
const FINISHED_PROMPT = /交易成功|已评价|已取消|交易关闭|已退款|退款成功|待付款|等待付款/
/** 物流侧已签收的标记 */
const SIGNED_STATUS = /^(SIGN|SIGNED)$/i

export const platform = 'pdd'
export const name = '拼多多'
export const nameEn = 'Pinduoduo'

export const defaultEndpoint = ORDERS_URL
export const defaultMethod = 'GET'
export const defaultHeaders = {
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  Referer: 'https://mobile.yangkeduo.com/personal.html',
}
export const defaultBody = ''

/**
 * 从服务端渲染的 HTML 里抠出 `window.rawData = {...}` 的 JSON。
 * 用括号配对扫描（字符串内的引号/转义都跳过），不依赖正则。
 * @param {string} html
 * @returns {object|null}
 */
export function extractRawData(html) {
  const text = String(html || '')
  const marker = text.indexOf('window.rawData')
  if (marker < 0) return null
  const start = text.indexOf('{', marker)
  if (start < 0) return null
  let depth = 0
  let inStr = false
  let esc = false
  let end = -1
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') {
      inStr = true
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        end = i + 1
        break
      }
    }
  }
  if (end < 0) return null
  try {
    return JSON.parse(text.slice(start, end))
  } catch {
    return null
  }
}

/** 取订单标题：orderGoods[].goodsName 拼两个 */
function orderTitle(order) {
  const list = Array.isArray(order && order.orderGoods) ? order.orderGoods : []
  const names = []
  for (const g of list) {
    const t = String((g && g.goodsName) || '').trim()
    if (t && !names.includes(t)) names.push(t)
    if (names.length >= 2) break
  }
  if (names.length) return names.join('、')
  return `拼多多订单 ${String((order && order.orderSn) || '')}`
}

/** 订单是否还需要跟 */
function isTrackingOrder(order) {
  if (!order || typeof order !== 'object') return false
  const tracking = String(order.trackingNumber || '').trim()
  if (!tracking) return false
  const prompt = String(order.orderStatusPrompt || '')
  if (FINISHED_PROMPT.test(prompt)) return false
  const expressStatus = String(
    (order.extraInfo && order.extraInfo.orderHint && order.extraInfo.orderHint.metricInfo && order.extraInfo.orderHint.metricInfo.expressStatus) ||
      (order.extraInfo && order.extraInfo.orderHint && order.extraInfo.orderHint.extraMap && order.extraInfo.orderHint.extraMap.pddStatus) ||
      '',
  )
  if (SIGNED_STATUS.test(expressStatus)) return false
  return true
}

/** 轨迹文本 → 标准状态 */
function textToStatus(text) {
  const s = String(text || '')
  if (/已签收|已妥投|已代收|已取件|已放入快递柜|他人代收/.test(s)) return 'delivered'
  if (/派送|派件|正在投递|配送中/.test(s)) return 'in_transit'
  if (/揽收|已发货|运输|分拣|到达|离开|发往|装车|中转|发出/.test(s)) return 'in_transit'
  if (/已下单|待发货|待出库|商家正在|准备/.test(s)) return 'pending'
  return ''
}

function statusTextOf(status) {
  if (status === 'delivered') return '已签收'
  if (status === 'in_transit') return '运输中'
  if (status === 'pending') return '待发货'
  return ''
}

/**
 * 查单条订单的物流详情：拼多多 goods_express.html（服务端渲染）。
 * @returns {Promise<{ok:boolean,waybill:string,carrierName:string,tracking:object|null,error:string}>}
 */
export async function queryExpress(order, cookie, pc, ctx = {}) {
  const { request } = await import('./http.js')
  const trackingNo = String((order && order.trackingNumber) || '').trim()
  const orderSn = String((order && order.orderSn) || '').trim()
  if (!trackingNo) return { ok: false, waybill: '', carrierName: '', tracking: null, error: 'missing-waybill' }
  const goodsId = String(
    (order && order.orderGoods && order.orderGoods[0] && order.orderGoods[0].goodsId) || '',
  ).trim()

  const q = new URLSearchParams({ tracking_number: trackingNo, hide_address: '1' })
  if (order.shippingId != null) q.set('shipping_id', String(order.shippingId))
  if (orderSn) q.set('order_sn', orderSn)
  if (goodsId) q.set('goods_id', goodsId)

  const res = await request(
    platform,
    {
      ...pc,
      cookie,
      endpoint: `${EXPRESS_URL}?${q.toString()}`,
      method: 'GET',
      params: {},
      body: '',
      headers: { ...(pc && pc.headers && typeof pc.headers === 'object' ? pc.headers : {}) },
      defaultHeaders: { ...defaultHeaders, Referer: ORDERS_URL },
      referer: ORDERS_URL,
    },
    ctx,
  )
  if (!res || !res.ok) {
    return { ok: false, waybill: trackingNo, carrierName: '', tracking: null, error: (res && res.error) || 'express-http' }
  }
  const data = extractRawData(res.text)
  const ship = data && data.store && data.store.traceData ? data.store.traceData.shipping : null
  if (!ship) return { ok: false, waybill: trackingNo, carrierName: '', tracking: null, error: 'no-trace' }

  const waybill = String(ship.trackingNumber || trackingNo).trim()
  const carrierName = String(ship.shippingName || '').trim()
  const rawTraces = Array.isArray(ship.traces) ? ship.traces : []
  const traces = []
  for (const item of rawTraces) {
    if (!item || typeof item !== 'object') continue
    const time = String(item.displayTime || item.time || '').trim()
    const context = String(item.info || item.statusTag || item.status || '').trim()
    if (!time && !context) continue
    traces.push({ time, context })
  }
  if (!traces.length) return { ok: false, waybill, carrierName, tracking: null, error: 'no-trace' }

  const latest = String((traces[0] && traces[0].context) || '')
  let status = textToStatus(latest)
  if (!status) status = textToStatus(traces.slice(0, 3).map((t) => t.context).join(' '))
  const forecast =
    (ship.timeForecast && String(ship.timeForecast.traceStatusDesc || '')) || ''
  if (!status) status = textToStatus(forecast)
  if (!status) status = 'in_transit'
  // 拼多多把预计送达放在 timeForecast.timeForecastDesc，例如「预计明天送达」
  const eta = String((ship.timeForecast && ship.timeForecast.timeForecastDesc) || '').trim()

  return {
    ok: true,
    waybill,
    carrierName,
    error: '',
    tracking: {
      ok: true,
      source: 'platform',
      state: '',
      status,
      statusText: statusTextOf(status) || forecast || '运输中',
      traces,
      latest,
      eta,
      fetchedAt: Date.now(),
      error: '',
    },
  }
}

/**
 * 拉取拼多多在途订单（含运单号 + 快递公司 + 平台轨迹）。
 * @param {object} pc 拼多多平台配置（cookie / headers / enabled ...）
 * @param {{logger?:object, signal?:AbortSignal, timeoutMs?:number}} ctx
 * @returns {Promise<{ok:boolean,orders:object[],error?:string,skipped?:object[]}>}
 */
export async function fetchOrders(pc, ctx = {}) {
  const { resolveCarrierCode, orderKey, parseTime, isValidTrackingNo } = await import('./index.js')
  const cfg = pc || {}
  const cookie = String(cfg.cookie || '').trim()
  if (!cookie) return { ok: false, orders: [], error: 'missing-cookie' }

  const { request } = await import('./http.js')
  const endpoint = String(cfg.endpoint || '').trim() || ORDERS_URL
  const listRes = await request(
    platform,
    {
      ...cfg,
      cookie,
      endpoint,
      method: 'GET',
      params: {},
      body: '',
      headers: { ...(cfg.headers && typeof cfg.headers === 'object' ? cfg.headers : {}) },
      defaultHeaders,
      referer: defaultHeaders.Referer,
    },
    ctx,
  )
  if (!listRes || !listRes.ok) return { ok: false, orders: [], error: (listRes && listRes.error) || 'list-http' }
  const data = extractRawData(listRes.text)
  if (!data) {
    // 拿不到 rawData 多半是被跳登录页或风控页
    return { ok: false, orders: [], error: 'unexpected-payload' }
  }
  const store = data.ordersStore || data.store || {}
  const rawList = Array.isArray(store.orders) ? store.orders : []
  if (!rawList.length) return { ok: true, orders: [] }

  const wanted = rawList.filter(isTrackingOrder).slice(0, MAX_TRACE_QUERIES)
  const orders = []
  const skipped = []
  for (const raw of wanted) {
    let detail = null
    try {
      detail = await queryExpress(raw, cookie, cfg, ctx)
    } catch (err) {
      detail = { ok: false, waybill: '', carrierName: '', tracking: null, error: err && err.message ? String(err.message) : 'express-failed' }
    }
    const trackingNo = String(raw.trackingNumber || '').trim()
    if (!isValidTrackingNo(trackingNo)) {
      skipped.push({ orderSn: raw.orderSn, reason: 'invalid-waybill' })
      continue
    }
    const carrierName = (detail && detail.carrierName) || ''
    const carrier = carrierName ? await resolveCarrierCode(carrierName, cfg) : ''
    const tracking = (detail && detail.tracking) || null
    const status = (tracking && tracking.status) || 'in_transit'
    orders.push({
      id: orderKey(platform, trackingNo),
      platform,
      title: orderTitle(raw),
      trackingNo,
      carrier: carrier || '',
      carrierName: carrierName || '',
      status,
      statusText: (tracking && tracking.statusText) || statusTextOf(status),
      createdAt: parseTime(raw.shippingTime) || null,
      updatedAt: null,
      tracking,
      error: (detail && !detail.ok && detail.error) || '',
      extra: {
        orderSn: String(raw.orderSn || ''),
        orderStatusPrompt: String(raw.orderStatusPrompt || ''),
      },
    })
  }

  if (!orders.length && wanted.length) return { ok: true, orders: [], skipped, error: 'no-waybill-yet' }
  return { ok: true, orders, skipped }
}

export default {
  platform,
  name,
  nameEn,
  defaultEndpoint,
  defaultHeaders,
  defaultMethod,
  defaultBody,
  extractRawData,
  queryExpress,
  fetchOrders,
}
