/**
 * dsh-parcel-tracker — 淘宝订单适配器（B 组 / lib/platforms/taobao.js）
 *
 * 实测结论（2026-10，真实登录态 Cookie）：
 *
 * 1) 订单列表（PC 页经典 XHR，已生效）
 *    POST https://buyertrade.taobao.com/trade/itemlist/asyncBought.htm
 *    表单：action=itemlist/BoughtQueryAction、event_submit_do_query=1、pageNum、pageSize、
 *          tabCode=OrderTab、orderType=ALL、_tb_token_（从 Cookie 同名键取）
 *    返回 JSON {error, extra, mainOrders, page, query, tabs}（**GBK 编码**，http 层已按 charset 解码）。
 *    注意：这个接口**不含运单号**。
 *
 * 2) 运单号（mtop，需要签名）
 *    GET https://h5api.m.taobao.com/h5/mtop.taobao.logistics.detailorlist.query/1.0/
 *    参数：jsv=2.7.0、appKey=12574478、t=毫秒时间戳、sign=md5(token&t&appKey&data)、
 *          api、v=1.0、needLogin=true、LoginRequest=true、type=originaljson、dataType=originaljson、
 *          data={"orderId":"<主订单号>"}
 *    token = Cookie 里 `_m_h5_tk` 下划线前的 32 位；返回里的 `mailNo` + `name` 就是运单号和快递公司。
 *    实测：{orderId:"3316970173001005189"} → SUCCESS::调用成功，mailNo=YT7650771822822，name=圆通速递。
 *
 * 3) 风控：短时间反复请求会返回 {"ret":["FAIL_SYS_USER_VALIDATE","RGV587_ERROR::SM..."]}（滑块验证），
 *    此时给出可读提示、不刷新太频繁即可恢复。
 */

import { createHash } from 'node:crypto'
import { request } from './http.js'

export const platform = 'taobao'
export const name = '淘宝'
export const nameEn = 'Taobao'
export const defaultEndpoint = 'https://buyertrade.taobao.com/trade/itemlist/asyncBought.htm'
export const defaultHeaders = {
  Accept: 'application/json, text/javascript, */*; q=0.01',
  'Accept-Language': 'zh-CN,zh;q=0.9',
  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  Referer: 'https://buyertrade.taobao.com/trade/itemlist/list_bought_items.htm',
  Origin: 'https://buyertrade.taobao.com',
  'X-Requested-With': 'XMLHttpRequest',
}
export const defaultMethod = 'POST'
/** 表单模板；{{_tbToken}} 由 buildParams 从 Cookie 的 _tb_token_ 里取出后替换 */
export const defaultBody =
  'action=itemlist/BoughtQueryAction&event_submit_do_query=1&pageNum=1&pageSize=20&tabCode=OrderTab&orderType=ALL&_tb_token_={{_tbToken}}'

const APP_KEY = '12574478'
const LOGISTICS_API = 'mtop.taobao.logistics.detailorlist.query'
/** 这些状态表示「还没发」或「已结束」，不查物流 */
const DEAD_STATUS = /CREATE_CLOSED|TRADE_CLOSED|TRADE_FINISHED|WAIT_SELLER_SEND_GOODS|CREATE_/i
/** 单次刷新最多查多少个订单的物流（每个订单一次 mtop 请求） */
const MAX_WAYBILL_QUERIES = 8

/** 从 Cookie 串里取 `_tb_token_`（表单接口的防 CSRF 令牌）。 */
export function tbTokenFromCookie(cookie) {
  const m = /(?:^|;\s*)_tb_token_=([^;]*)/.exec(String(cookie || ''))
  return m ? m[1].trim() : ''
}

/** 从 Cookie 串里取 mtop 的 32 位 token（`_m_h5_tk` 下划线前段）。 */
export function mtopTokenFromCookie(cookie) {
  const m = /(?:^|;\s*)_m_h5_tk=([^;]*)/.exec(String(cookie || ''))
  if (!m) return ''
  return m[1].trim().split('_')[0]
}

/** mtop 签名：md5(token & t & appKey & data)。 */
export function mtopSign(token, t, data, appKey = APP_KEY) {
  return createHash('md5').update(`${token}&${t}&${appKey}&${data}`).digest('hex')
}

/** 把手机号按用户指定的参数名塞进 query/body；`_tbToken` 供 body 模板替换。 */
export function buildParams(cfg = {}) {
  const params = {}
  const phone = String(cfg.phone || '').trim()
  const phoneParam = String(cfg.phoneParam || '').trim()
  if (phone && phoneParam) params[phoneParam] = phone
  const token = tbTokenFromCookie(cfg.cookie)
  if (token) params._tbToken = token
  return params
}

/** 在任意 JSON 里找第一个带 mailNo 的对象。 */
function findWaybill(node, depth = 0) {
  if (!node || depth > 12) return null
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findWaybill(item, depth + 1)
      if (hit) return hit
    }
    return null
  }
  if (typeof node !== 'object') return null
  const mailNo = node.mailNo || node.waybillCode || node.logisticsNo
  if (typeof mailNo === 'string' && /^[A-Za-z0-9-]{6,32}$/.test(mailNo.trim())) {
    return {
      mailNo: mailNo.trim(),
      carrierName: String(node.name || node.companyName || node.cpName || '').trim(),
    }
  }
  for (const key of Object.keys(node)) {
    const hit = findWaybill(node[key], depth + 1)
    if (hit) return hit
  }
  return null
}

/** 从订单列表里取商品标题（第一件商品名）。 */
function orderTitle(mainOrder) {
  try {
    const subs = mainOrder.subOrders || []
    for (const sub of subs) {
      const item = sub.itemInfo || {}
      const t = item.title || item.itemTitle || ''
      if (t) return String(t).trim().slice(0, 60)
    }
  } catch {
    /* ignore */
  }
  return ''
}

/**
 * 查单个订单的运单号。失败返回 null（不抛）。
 * @param {string} orderId 主订单号
 * @param {object} pc 平台配置
 * @param {object} ctx
 */
export async function queryWaybill(orderId, pc, ctx) {
  const token = mtopTokenFromCookie(pc.cookie)
  if (!token) return null
  const t = String(Date.now())
  const data = JSON.stringify({ orderId: String(orderId) })
  const qs = new URLSearchParams({
    jsv: '2.7.0',
    appKey: APP_KEY,
    t,
    sign: mtopSign(token, t, data),
    api: LOGISTICS_API,
    v: '1.0',
    needLogin: 'true',
    LoginRequest: 'true',
    type: 'originaljson',
    dataType: 'originaljson',
    timeout: '20000',
    ttid: '#t#ip##_h5_web_default',
    preventFallback: 'true',
    data,
  })
  const res = await request(
    platform,
    {
      cookie: pc.cookie,
      endpoint: `https://h5api.m.taobao.com/h5/${LOGISTICS_API}/1.0/?${qs.toString()}`,
      method: 'GET',
      headers: { Accept: 'application/json', Referer: 'https://market.m.taobao.com/app/dinamic/pc-trade-logistics/home.html' },
      defaultHeaders: {},
    },
    ctx,
  )
  const json = res && res.json
  if (!json || !Array.isArray(json.ret)) return null
  if (!json.ret.some((r) => /^SUCCESS/i.test(String(r)))) return null
  return findWaybill(json.data)
}

/**
 * 抓取淘宝订单（带运单号）。永远不抛异常。
 * @param {object} cfg 平台 config
 * @param {object} ctx { logger, signal, timeoutMs }
 * @returns {Promise<{ok:boolean,orders:object[],error:string}>}
 */
export async function fetchOrders(cfg = {}, ctx = {}) {
  const pc = { ...(cfg || {}) }
  try {
    const customEndpoint = String(pc.endpoint || '').trim()
    const endpoint = customEndpoint || defaultEndpoint
    const method = customEndpoint ? String(pc.method || '').trim().toUpperCase() || defaultMethod : defaultMethod
    const body = customEndpoint && pc.body ? pc.body : defaultBody
    const res = await request(
      platform,
      { ...pc, endpoint, method, body, params: buildParams(pc), defaultHeaders, defaultBody },
      ctx,
    )
    if (!res.ok && !res.json) return { ok: false, orders: [], error: res.error || `http-${res.status}` }

    const ret = res.json && Array.isArray(res.json.ret) ? res.json.ret : []
    if (ret.length && /FAIL_SYS_USER_VALIDATE|RGV587/.test(String(ret[0]))) {
      return {
        ok: false,
        orders: [],
        error: '淘宝触发了风控校验（滑块验证），请先用浏览器打开淘宝「已买到的宝贝」页正常浏览一下，过几分钟再刷新',
      }
    }

    const { resolveCarrierCode, orderKey } = await import('./index.js')
    const mains = res.json && Array.isArray(res.json.mainOrders) ? res.json.mainOrders : []

    // 自定义接口：保持老行为（深扫用户给的那份 JSON）
    if (customEndpoint) {
      const { finishFetch } = await import('./index.js')
      const out = await finishFetch(res, { ...pc, orderListPath: String(pc.orderListPath || '').trim() || 'mainOrders' }, platform)
      if ((!out.orders || !out.orders.length) && mains.length > 0) {
        return { ok: false, orders: [], error: `读到 ${mains.length} 条订单，但没能从自定义接口里抽到运单号` }
      }
      return out
    }

    if (!mains.length) return { ok: true, orders: [], error: '' }

    const targets = mains
      .filter((m) => !DEAD_STATUS.test(String((m && m.extra && m.extra.tradeStatus) || '')))
      .slice(0, MAX_WAYBILL_QUERIES)
    const orders = []
    for (const main of targets) {
      const orderId = String(main.id || '')
      if (!orderId) continue
      const wb = await queryWaybill(orderId, pc, ctx)
      if (!wb) continue
      const carrierName = wb.carrierName || ''
      const carrier = await resolveCarrierCode(carrierName, pc)
      orders.push({
        id: orderKey(platform, wb.mailNo),
        platform,
        title: orderTitle(main),
        trackingNo: wb.mailNo,
        carrier,
        carrierName,
        status: 'in_transit',
        statusText: '',
        createdAt: null,
        updatedAt: null,
        tracking: { ok: false, state: '', status: 'unknown', traces: [], fetchedAt: null, error: '' },
        error: '',
      })
    }

    if (!orders.length) {
      return {
        ok: false,
        orders: [],
        error: `读到 ${mains.length} 条订单，但都没有可用的运单号（还没发货，或 mtop 物流接口返回空）。当前登录订单里通常只有「待收货」的才有运单。`,
      }
    }
    return { ok: true, orders, error: '' }
  } catch (err) {
    return { ok: false, orders: [], error: err && err.message ? err.message : String(err) }
  }
}

export default {
  platform,
  name,
  nameEn,
  defaultEndpoint,
  defaultHeaders,
  defaultMethod,
  defaultBody,
  tbTokenFromCookie,
  mtopTokenFromCookie,
  mtopSign,
  buildParams,
  fetchOrders,
}
