import { CARRIERS, CARRIER_MAP, CARRIER_TOTAL, COMMON_CODES, COMMON_SET, guessCarrier, companyNameToCode, listCarriers, carrierNameOf, isValidCarrier } from '../lib/carriers.js'
import { queryTracking, stateToStatus, stateToText } from '../lib/kuaidi100.js'

const fails = []
function eq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) fails.push(`${label}: got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`)
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label} -> ${JSON.stringify(actual)}`)
}
function ok(value, label) {
  if (!value) fails.push(`${label}: assertion failed`)
  console.log(`${value ? 'PASS' : 'FAIL'} ${label}`)
}

eq(CARRIERS.length, CARRIER_TOTAL, 'CARRIER_TOTAL matches length')
eq(CARRIERS.length, 3080, 'carrier count')
eq(CARRIERS.every((c) => c && c.code && c.name), true, 'every row has code+name')
eq(new Set(CARRIERS.map((c) => c.code)).size, CARRIERS.length, 'codes unique')
eq(CARRIER_MAP.shunfeng.name, '顺丰速运', 'shunfeng name')
eq(CARRIER_MAP.zhongtong.name, '中通快递', 'zhongtong name')

eq(guessCarrier('SF1234567890123'), 'shunfeng', 'guess SF')
eq(guessCarrier('JDVA00123456789'), 'jd', 'guess JD')
eq(guessCarrier('JT1234567890123'), 'jtexpress', 'guess JT')
eq(guessCarrier('YT1234567890123'), 'yuantong', 'guess YT')
eq(guessCarrier('ZT1234567890123'), 'zhongtong', 'guess ZT')
eq(guessCarrier('ZTKY1234567890'), 'zhongtongkuaiyun', 'guess ZTKY')
eq(guessCarrier('ST1234567890123'), 'shentong', 'guess ST')
eq(guessCarrier('YD1234567890123'), 'yunda', 'guess YD')
eq(guessCarrier('DPK1234567890'), 'debangkuaidi', 'guess DPK')
eq(guessCarrier('780123456789'), '', 'plain digits not guessed')
eq(guessCarrier('EA123456789CN'), 'ems', 'guess EMS EA..CN')

eq(companyNameToCode('顺丰速运'), 'shunfeng', 'name 顺丰速运')
eq(companyNameToCode('顺丰'), 'shunfeng', 'name 顺丰 short')
eq(companyNameToCode('中通快递'), 'zhongtong', 'name 中通快递')
eq(companyNameToCode('中通快运'), 'zhongtongkuaiyun', 'name 中通快运')
eq(companyNameToCode('圆通速递'), 'yuantong', 'name 圆通速递')
eq(companyNameToCode('申通快递'), 'shentong', 'name 申通快递')
eq(companyNameToCode('韵达快递'), 'yunda', 'name 韵达快递')
eq(companyNameToCode('极兔速递'), 'jtexpress', 'name 极兔速递')
eq(companyNameToCode('京东物流'), 'jd', 'name 京东物流')
eq(companyNameToCode('邮政快递包裹'), 'youzhengguonei', 'name 邮政快递包裹')
eq(companyNameToCode('德邦快递'), 'debangkuaidi', 'name 德邦快递')
eq(companyNameToCode('德邦物流'), 'debangwuliu', 'name 德邦物流')
eq(companyNameToCode('百世快递'), 'huitongkuaidi', 'name 百世快递')
eq(companyNameToCode('菜鸟速递'), 'danniao', 'name 菜鸟速递')
eq(companyNameToCode('安能快运'), 'annengwuliu', 'name 安能快运')
eq(companyNameToCode('顺心捷达'), 'sxjdfreight', 'name 顺心捷达')
eq(companyNameToCode('优速'), 'youshuwuliu', 'name 优速')
eq(companyNameToCode('sf'), 'shunfeng', 'alias sf')
eq(companyNameToCode('zto'), 'zhongtong', 'alias zto')
eq(companyNameToCode('sto'), 'shentong', 'alias sto')
eq(companyNameToCode('yt'), 'yuantong', 'alias yt')
eq(companyNameToCode('不存在的快递公司XYZ'), '', 'unknown company')

eq(carrierNameOf('shunfeng'), '顺丰速运', 'carrierNameOf')
eq(isValidCarrier('shunfeng'), true, 'isValidCarrier shunfeng')
eq(isValidCarrier('sf'), false, 'isValidCarrier sf false')
const common = listCarriers({ commonOnly: true })
eq(common[0].code, 'shunfeng', 'common first is shunfeng')
eq(common.every((c) => CARRIER_MAP[c.code]), true, 'common all valid')
const all = listCarriers()
eq(all.length, CARRIERS.length, 'listCarriers all')
eq(all[0].code, 'shunfeng', 'listCarriers sorted common first')

eq(stateToStatus(200), 'pending', 'state 200')
eq(stateToStatus(201), 'in_transit', 'state 201')
eq(stateToStatus(303), 'delivered', 'state 303')
eq(stateToStatus(999), 'unknown', 'state 999')
eq(stateToText(303), '已签收', 'stateText 303')

// 真实网络查询（免 key）—— 免 key 通道不稳定：可能拿到真轨迹，也可能返回 no-result 占位。
// 这里只断言「形状正确、不会崩」，不硬性要求 ok=true。
console.log('--- live kuaidi100 ---')
const live = await queryTracking('77172888900000', 'yuantong')
console.log('live ok=', live.ok, 'state=', live.state, 'status=', live.status,
  'traces=', live.traces.length, 'error=', live.error)
if (live.traces[0]) console.log('  first trace:', live.traces[0].time, live.traces[0].context.slice(0, 40))
ok(typeof live.status === 'string' && ['pending', 'in_transit', 'delivered', 'unknown'].includes(live.status),
  'live status is normalized')
ok(Array.isArray(live.traces), 'live traces is array')
if (live.ok) ok(live.traces.length > 0, 'live ok implies traces')
else ok(['no-result', 'rate-limited', 'timeout'].some((e) => live.error.startsWith(e)) ||
  live.error.startsWith('network:') || live.error.startsWith('http-'), 'live error is a known kind: ' + live.error)
// 「查无结果」占位绝不能被判成已签收
ok(!(live.error === 'no-result' && live.status === 'delivered'), 'placeholder is not delivered')

const bad = await queryTracking('77172888900000', 'sf')
console.log('bad carrier ->', bad.ok, bad.error)
ok(!bad.ok, 'unknown carrier code is rejected')
const noCarrier = await queryTracking('77172888900000', '')
console.log('no carrier ->', noCarrier.ok, noCarrier.error)
ok(!noCarrier.ok && noCarrier.error === 'missing-carrier', 'empty carrier rejected')

console.log('--- summary ---')
console.log(fails.length ? 'FAILS:\n' + fails.join('\n') : 'ALL PASS')
