/**
 * dsh-parcel-tracker — 京东订单适配器（lib/platforms/jd.js）
 *
 * 两步走：
 *   1) 订单列表：POST api.m.jd.com/api?...&functionId=pcorder_center_list
 *      body = {"page":1,"s":4096,"d":1}
 *      → data.orderList[]（含 orderId / orderType / statusInfo / wareList / showOrderTrack）
 *   2) 逐单物流：POST 同一个 api 网关，functionId=pcorder_center_traceMultiPackage
 *      body = {"orderId":..,"orderType":..,"orderStatus":..}
 *      → data.orderTrackGroupInfoList[0] = { shipId <运单号>, thirdName <快递公司>, orderTrackInfoList[] }
 *
 * 实测要点（2026-10）：
 *   - 这个网关不需要 h5st / x-api-eid-token：把 cURL 里的 h5st 参数整段删掉照样 200。
 *   - pcorder_center_traceMultiPackage 必须用 **POST + body=**（GET 原生 query 会返回
 *     {"success":false,"errCode":"202","errMessage":"数据校验失败"}），body 用 JSON 字符串。
 *   - uuid 取 Cookie 里的 __jda，缺失也能请求，但带上更稳。
 *   - 订单列表本身**不含运单号**，运单号只能从 traceMultiPackage 的 shipId 拿。
 *   - 京东自家就带完整轨迹（orderTrackInfoList），有它就优先用，不必再打快递100。
 */

const API_BASE = 'https://api.m.jd.com/api'
const APP_PARAMS = {
  appid: 'order-jd-com',
  client: 'pc',
  clientVersion: '1.0.0',
  loginType: '3',
}
const LIST_FN = 'pcorder_center_list'
const TRACE_FN = 'pcorder_center_traceMultiPackage'

/** 一次刷新最多查多少单的物流（每单一个请求，别把风控惹毛） */
const MAX_TRACE_QUERIES = 12

/** 已完结的订单状态：不需要运单号也不需要轨迹 */
const FINISHED_STATUS = /已完成|已取消|交易关闭|已删除|已关闭|待付款|等待付款/

export const platform = 'jd'
export const name = '京东'
export const nameEn = 'JD'

export const defaultEndpoint = API_BASE
export const defaultMethod = 'POST'
export const defaultHeaders = {
  Accept: 'application/json, text/plain, */*',
  'Content-Type': 'application/x-www-form-urlencoded',
  Referer: 'https://order.jd.com/center/list.action',
  Origin: 'https://order.jd.com',
  'X-Requested-With': 'XMLHttpRequest',
}
/** 订单列表请求体（POST 表单：body=<urlencoded JSON>） */
export const defaultBody = 'body=' + encodeURIComponent(JSON.stringify({ page: 1, s: 4096, d: 1 }))
export const orderListPath = 'data.orderList'

/** 从 Cookie 里取 __jda（京东网关的 uuid 参数） */
function uuidFromCookie(cookie) {
  const m = /(?:^|;\s*)__jda=([^;]*)/.exec(String(cookie || ''))
  return m ? m[1].trim() : ''
}

/** 拼 api.m.jd.com 网关 URL（functionId + 公共参数） */
function apiUrl(functionId, cookie) {
  const q = new URLSearchParams({
    ...APP_PARAMS,
    functionId,
    t: String(Date.now()),
  })
  const uuid = uuidFromCookie(cookie)
  if (uuid) q.set('uuid', uuid)
  return API_BASE + '?' + q.toString()
}

/**
 * 调一次京东网关。body 序列化成 JSON，再包成 `body=<urlencoded>`。
 * @returns {Promise<{ok:boolean,json:any,status:number,error:string}>}
 */
async function callApi(functionId, cookie, payload, pc, ctx) {
  const { request } = await import('./http.js')
  const body = 'body=' + encodeURIComponent(JSON.stringify(payload || {}))
  return request(
    platform,
    {
      ...pc,
      cookie,
      endpoint: apiUrl(functionId, cookie),
      method: 'POST',
      body,
      headers: { ...(pc && pc.headers && typeof pc.headers === 'object' ? pc.headers : {}) },
      defaultHeaders,
      referer: defaultHeaders.Referer,
    },
    ctx,
  )
}

/** 订单是否还需要跟（京东自己在列表里给了 showOrderTrack） */
function isTrackingOrder(order) {
  if (!order || typeof order !== 'object') return false
  const statusName = String((order.statusInfo && order.statusInfo.orderStateName) || '')
  if (FINISHED_STATUS.test(statusName)) return false
  if (order.showOrderTrack === true) return true
  return /等待收货|配送中|已发货|待收货|运输中|出库|已揽收|待揽收/.test(statusName)
}

/** 取订单标题：wareList[].name 拼起来，最多两个 */
function orderTitle(order) {
  const list = Array.isArray(order && order.wareList) ? order.wareList : []
  const names = []
  for (const ware of list) {
    const t = String((ware && (ware.name || ware.wareName)) || '').trim()
    if (t && !names.includes(t)) names.push(t)
    if (names.length >= 2) break
  }
  if (names.length) return names.join('、')
  const shop = order && order.shopInfo ? String(order.shopInfo.shopName || '') : ''
  return shop || `京东订单 ${String((order && order.orderId) || '')}`
}

/** 轨迹文本 → 标准状态 */
function textToStatus(text) {
  const s = String(text || '')
  if (/已签收|已妥投|已代收|已取件|已放入|已投递/.test(s)) return 'delivered'
  if (/派送|派件|派送中|投递中|正在为您配送/.test(s)) return 'in_transit'
  if (/揽收|已发货|运输|分拣|到达|离开|发往|出库|装车|中转/.test(s)) return 'in_transit'
  if (/已下单|待出库|准备|等待|待发货|已打印/.test(s)) return 'pending'
  return ''
}

function statusTextOf(status) {
  if (status === 'delivered') return '已签收'
  if (status === 'in_transit') return '运输中'
  if (status === 'pending') return '待发货'
  return ''
}

// 京东把「预计送达」写在轨迹文案里，例如：
//   「温馨提示：您的订单预计10月23日24:00前送达，请您做好收货安排」
const ETA_PATTERN = /预计\s*([^，。；\n]{2,26}?)\s*送达/

/** 从轨迹文案里抽「预计…送达」（抽不到返回空串，前端就不显示） */
function findEta(traces) {
  const list = Array.isArray(traces) ? traces : []
  for (const item of list) {
    const text = String((item && item.context) || '')
    const m = ETA_PATTERN.exec(text)
    if (m && m[1]) return `预计${m[1]}送达`
  }
  return ''
}

/**
 * 查单条订单的物流：京东网关 traceMultiPackage。
 * @param {object} order 列表里的原始订单对象
 * @returns {Promise<{ok:boolean,waybill:string,carrierName:string,tracking:object|null,error:string}>}
 */
export async function queryTrace(order, cookie, pc, ctx) {
  const orderId = String((order && order.orderId) || '').trim()
  if (!orderId) return { ok: false, waybill: '', carrierName: '', tracking: null, error: 'missing-order-id' }
  const payload = {
    orderId,
    orderType: order.orderType,
    orderStatus: order.statusInfo ? order.statusInfo.orderState : undefined,
  }
  const res = await callApi(TRACE_FN, cookie, payload, pc, ctx)
  if (!res || !res.ok) {
    return { ok: false, waybill: '', carrierName: '', tracking: null, error: (res && res.error) || 'trace-failed' }
  }
  const json = res.json || {}
  if (json.success === false) {
    return { ok: false, waybill: '', carrierName: '', tracking: null, error: json.errMessage || json.errCode || 'trace-rejected' }
  }
  const groups = (json.data && json.data.orderTrackGroupInfoList) || []
  const group = Array.isArray(groups) ? groups[0] : null
  if (!group) return { ok: false, waybill: '', carrierName: '', tracking: null, error: 'no-trace' }

  const waybill = String(group.shipId || '').trim()
  const carrierName = String(group.thirdName || '').trim()

  // orderTrackInfoList 是「从早到晚」，而全链路约定 traces[0] = 最新
  const rawList = Array.isArray(group.orderTrackInfoList) ? group.orderTrackInfoList : []
  const traces = []
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue
    const time = String(item.creationTime || item.createTimeStr || '').trim()
    const context = String(item.title || item.content || '').trim()
    if (!time && !context) continue
    traces.push({ time, context })
  }
  traces.reverse()

  if (!traces.length) return { ok: false, waybill, carrierName, tracking: null, error: 'no-trace' }

  const latest = String(traces[0] && traces[0].context ? traces[0].context : '')
  let status = textToStatus(latest)
  if (!status) status = textToStatus(traces.slice(0, 3).map((t) => t.context).join(' '))
  if (!status) status = 'in_transit'

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
      statusText: statusTextOf(status) || '运输中',
      traces,
      latest,
      eta: findEta(traces),
      fetchedAt: Date.now(),
      error: '',
    },
  }
}

/**
 * 拉取京东在途订单（含运单号与京东自带轨迹）。
 * @param {object} pc 京东平台配置（cookie / headers / enabled ...）
 * @param {{logger?:object, signal?:AbortSignal, timeoutMs?:number}} ctx
 * @returns {Promise<{ok:boolean,orders:object[],error?:string,skipped?:object[]}>}
 */
export async function fetchOrders(pc, ctx = {}) {
  const { resolveCarrierCode, orderKey, parseTime, isValidTrackingNo } = await import('./index.js')
  const cfg = pc || {}
  const cookie = String(cfg.cookie || '').trim()
  if (!cookie) return { ok: false, orders: [], error: 'missing-cookie' }

  const res = await callApi(LIST_FN, cookie, { page: 1, s: 4096, d: 1 }, cfg, ctx)
  if (!res || !res.ok) return { ok: false, orders: [], error: (res && res.error) || 'list-failed' }
  const json = res.json || {}
  if (json.code && json.code !== '0' && json.code !== 0) {
    return { ok: false, orders: [], error: `jd-${json.code}:${json.echo || ''}` }
  }
  const rawList = (json.data && json.data.orderList) || []
  if (!Array.isArray(rawList)) return { ok: false, orders: [], error: 'unexpected-payload' }

  const wanted = rawList.filter(isTrackingOrder).slice(0, MAX_TRACE_QUERIES)
  const orders = []
  const skipped = []
  for (const raw of wanted) {
    const orderId = String(raw.orderId || '').trim()
    let trace = null
    try {
      trace = await queryTrace(raw, cookie, cfg, ctx)
    } catch (err) {
      trace = { ok: false, waybill: '', carrierName: '', tracking: null, error: err && err.message ? String(err.message) : 'trace-failed' }
    }
    if (!trace || !trace.ok || !trace.waybill) {
      skipped.push({ orderId, reason: (trace && trace.error) || 'no-waybill' })
      continue
    }
    if (!isValidTrackingNo(trace.waybill)) {
      skipped.push({ orderId, reason: 'invalid-waybill' })
      continue
    }
    const carrier = await resolveCarrierCode(trace.carrierName || '京东物流', cfg)
    const tracking = trace.tracking || null
    const status = (tracking && tracking.status) || 'in_transit'
    orders.push({
      id: orderKey(platform, trace.waybill),
      platform,
      title: orderTitle(raw),
      trackingNo: trace.waybill,
      carrier: carrier || 'jd',
      carrierName: trace.carrierName || '京东物流',
      status,
      statusText: (tracking && tracking.statusText) || statusTextOf(status),
      createdAt: parseTime(raw.dateSubmit) || null,
      updatedAt: null,
      tracking,
      error: '',
      extra: { orderId, orderStateName: String((raw.statusInfo && raw.statusInfo.orderStateName) || '') },
    })
  }

  if (!orders.length) {
    return { ok: true, orders: [], skipped, error: wanted.length ? 'no-waybill-yet' : '' }
  }
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
  orderListPath,
  queryTrace,
  fetchOrders,
}
