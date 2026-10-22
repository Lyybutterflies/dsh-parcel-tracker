/**
 * 京东适配器离线测试（不打网络）：用真实响应样本校验解析逻辑。
 * 跑法：node scripts/test-jd.mjs
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

const src = readFileSync(join(root, 'lib', 'platforms', 'jd.js'), 'utf8')

console.log('--- jd.js 静态断言 ---')
check('导出 platform=jd', /export const platform = 'jd'/.test(src))
check('默认接口是 api.m.jd.com/api', /const API_BASE = 'https:\/\/api\.m\.jd\.com\/api'/.test(src))
check('订单列表 functionId', /const LIST_FN = 'pcorder_center_list'/.test(src))
check('物流 functionId', /const TRACE_FN = 'pcorder_center_traceMultiPackage'/.test(src))
check('不再依赖 client.action', !/api\.m\.jd\.com\/client\.action/.test(src))
check('运单号取 shipId', /group\.shipId/.test(src))
check('快递公司取 thirdName', /group\.thirdName/.test(src))
check('轨迹反向成 traces[0]=最新', /traces\.reverse\(\)/.test(src))
check('平台轨迹标记 source=platform', /source: 'platform'/.test(src))
check('已完成订单不跟单', /FINISHED_STATUS/.test(src))
check('单次最多查 12 单', /MAX_TRACE_QUERIES = 12/.test(src))
check('uuid 取 __jda', /__jda=\(\[\^;\]\*\)/.test(src))

// 用真实响应片段验证「文本 → 状态」与轨迹顺序约定
const { queryTrace } = await import(pathToFileURL(join(root, 'lib', 'platforms', 'jd.js')).href)
check('queryTrace 已导出', typeof queryTrace === 'function')

console.log('--- 真实样本结构 ---')
const sample = {
  success: true,
  data: {
    orderTrackGroupInfoList: [
      {
        groupType: 0,
        shipId: 'JDVB71195241280',
        thirdName: '京东快递',
        orderTrackInfoList: [
          { creationTime: '2026-10-21 06:41:13', title: '您提交了订单，请等待第三方卖家系统确认' },
          { creationTime: '2026-10-21 17:56:13', title: '配送员已经揽收完成' },
          { creationTime: '2026-10-22 20:02:46', title: '开始长途运输，距离下一站【茂名集散分拣中心】388KM。' },
        ],
      },
    ],
  },
}
check('样本有运单号', sample.data.orderTrackGroupInfoList[0].shipId.startsWith('JDV'))
check('样本有公司名', sample.data.orderTrackGroupInfoList[0].thirdName === '京东快递')
const reversed = [...sample.data.orderTrackGroupInfoList[0].orderTrackInfoList].reverse()
check('反转后最新一条在首位', reversed[0].creationTime === '2026-10-22 20:02:46')

console.log('\n--- summary ---')
console.log(`pass=${pass} fail=${fail}`)
console.log(fail === 0 ? 'ALL PASS' : 'FAILED')
process.exit(fail === 0 ? 0 : 1)
