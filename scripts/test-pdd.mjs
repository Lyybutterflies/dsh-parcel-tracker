/**
 * 拼多多适配器离线测试（不打网络）：校验 rawData 抽取、订单过滤、状态映射的静态约定。
 * 跑法：node scripts/test-pdd.mjs
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

let pass = 0
let fail = 0
function check(name, cond, detail) {
  if (cond) {
    pass++
    console.log(`  ok   ${name}`)
  } else {
    fail++
    console.log(`  FAIL ${name}${detail ? ' :: ' + detail : ''}`)
  }
}

const src = readFileSync(join(root, 'lib', 'platforms', 'pdd.js'), 'utf8')

console.log('--- pdd.js 静态断言 ---')
check('导出 platform=pdd', /export const platform = 'pdd'/.test(src))
check('默认端点走 orders.html', /mobile\.yangkeduo\.com\/orders\.html/.test(src))
check('物流详情走 goods_express.html', /goods_express\.html/.test(src))
check('不再依赖 /proxy/api', !/proxy\/api/.test(src))
check('从 window.rawData 抽 JSON', /window\.rawData/.test(src))
check('快递公司取 shippingName', /ship\.shippingName/.test(src))
check('运单号取 trackingNumber', /ship\.trackingNumber/.test(src))
check('轨迹取 traces[]', /ship\.traces/.test(src))
check('平台轨迹标记 source=platform', /source: 'platform'/.test(src))
check('已完成订单不跟单', /FINISHED_PROMPT/.test(src))
check('签收标记 SIGN 过滤', /SIGNED_STATUS/.test(src))
check('单次最多查 8 单', /MAX_TRACE_QUERIES = 8/.test(src))

const { extractRawData, queryExpress } = await import(
  pathToFileURL(join(root, 'lib', 'platforms', 'pdd.js')).href
)
check('extractRawData 已导出', typeof extractRawData === 'function')
check('queryExpress 已导出', typeof queryExpress === 'function')

console.log('--- rawData 抽取 ---')
// 用真实页面结构造一个最小样本（含字符串里的 } 与转义引号，验证括号配对）
const sample = {
  ordersStore: {
    orders: [
      {
        orderSn: '261021-009237962271222',
        orderStatusPrompt: '待收货',
        trackingNumber: '77127094235378',
        shippingId: 371,
        shippingName: '',
        orderGoods: [{ goodsId: 1009163667262, goodsName: '【2瓶装】澳洲SHEVEU赛逸洗发水' }],
        extraInfo: { orderHint: { extraMap: { pddStatus: 'DEPARTURE' } } },
      },
      {
        orderSn: '261020-314132436511222',
        orderStatusPrompt: '交易成功',
        trackingNumber: '',
        orderGoods: [{ goodsName: '拼多多三个月省钱月卡' }],
      },
    ],
  },
}
const tricky = '{"s":"里面有个 } 字符和 \\" 转义"}' + '}'
const html = `<html><script>window.rawData=${JSON.stringify(sample)}</script><div>${tricky}</div></html>`
const parsed = extractRawData(html)
check('能抠出 rawData', parsed && typeof parsed === 'object')
check('订单数是 2', parsed && parsed.ordersStore && parsed.ordersStore.orders.length === 2)
check('运单号读得到', parsed && parsed.ordersStore.orders[0].trackingNumber === '77127094235378')
check('无 rawData 时返回 null', extractRawData('<html>nope</html>') === null)
check('括号不配平时返回 null', extractRawData('window.rawData={"a":1') === null)

console.log('--- 物流详情样本结构 ---')
const expressSample = {
  store: {
    traceData: {
      shipping: {
        shippingName: '中通国际',
        trackingNumber: '77127094235378',
        shippingStatus: 20,
        timeForecast: { traceStatusDesc: '运输中' },
        traces: [
          { info: '【吉安市】快件离开【吉安转运中心】发往广州中心', displayTime: '2026-10-22 22:29:23' },
          { info: '【吉安市】快件已到达【吉安转运中心】', displayTime: '2026-10-22 21:10:02' },
        ],
      },
    },
  },
}
const ship = expressSample.store.traceData.shipping
check('样本有公司名', ship.shippingName === '中通国际')
check('样本有运单号', ship.trackingNumber === '77127094235378')
check('样本有轨迹', ship.traces.length === 2)
check('轨迹首条是最新', ship.traces[0].displayTime === '2026-10-22 22:29:23')

console.log('\n--- summary ---')
console.log(`pass=${pass} fail=${fail}`)
console.log(fail === 0 ? 'ALL PASS' : 'FAILED')
process.exit(fail === 0 ? 0 : 1)
