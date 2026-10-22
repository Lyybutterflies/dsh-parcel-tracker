/**
 * cURL 解析器单元测试：直接从 client.js 里抽出 parseCurl 那段源码求值，避免复制粘贴两套实现。
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '..', 'client.js'), 'utf8')
const begin = src.indexOf('// --- curl-parse-begin ---')
const end = src.indexOf('// --- curl-parse-end ---')
if (begin < 0 || end < 0) {
  console.error('FAIL 找不到 curl-parse 标记')
  process.exit(1)
}
const block = src.slice(begin, end)
const factory = new Function(`${block}\nreturn { tokenizeCurl, parseCurl };`)
const { parseCurl } = factory()

let pass = 0
let fail = 0
function check(name, fn) {
  try {
    fn()
    pass += 1
    console.log(`PASS ${name}`)
  } catch (err) {
    fail += 1
    console.log(`FAIL ${name} -> ${err && err.message}`)
  }
}
function eq(actual, expected, label) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) throw new Error(`${label}: got ${a} want ${e}`)
}

// 1) Chrome / bash 风格，反斜杠续行
check('bash 风格解析', () => {
  const raw = `curl 'https://api.m.jd.com/client.action?functionId=orderList' \\
  -H 'accept: application/json' \\
  -H 'cookie: pt_key=AAA; pt_pin=BBB' \\
  -H 'referer: https://m.jd.com/' \\
  -H 'host: api.m.jd.com' \\
  --data-raw '{"page":1}' \\
  --compressed`
  const r = parseCurl(raw)
  eq(r.url, 'https://api.m.jd.com/client.action?functionId=orderList', 'url')
  eq(r.method, 'POST', 'method')
  eq(r.cookie, 'pt_key=AAA; pt_pin=BBB', 'cookie')
  eq(r.body, '{"page":1}', 'body')
  eq(r.headers.accept, 'application/json', 'accept')
  eq(r.headers.referer, 'https://m.jd.com/', 'referer')
  eq(r.headers.host, undefined, 'host 应被丢弃')
  eq(r.headers['content-length'], undefined, 'content-length 应被丢弃')
})

// 2) Windows cmd：^ 续行 + 双引号
check('cmd 风格解析（^ 续行 + 双引号）', () => {
  const raw = 'curl "https://mobile.yangkeduo.com/proxy/api/order/list?page=1" ^\r\n'
    + '  -H "accept: application/json" ^\r\n'
    + '  -H "cookie: api_uid=1; PDDAccessToken=2" ^\r\n'
    + '  -H "user-agent: Mozilla/5.0"'
  const r = parseCurl(raw)
  eq(r.url, 'https://mobile.yangkeduo.com/proxy/api/order/list?page=1', 'url')
  eq(r.method, 'GET', 'method')
  eq(r.cookie, 'api_uid=1; PDDAccessToken=2', 'cookie')
  eq(r.headers['user-agent'], 'Mozilla/5.0', 'ua')
  eq(r.body, '', 'body')
})

// 3) -X POST + 多个 --data 合并
check('-X POST / 多段 data 合并', () => {
  const r = parseCurl("curl -X POST 'https://a.example.com/list' --data 'a=1' --data 'b=2' -b 'sid=x'")
  eq(r.method, 'POST', 'method')
  eq(r.body, 'a=1&b=2', 'body')
  eq(r.cookie, 'sid=x', 'cookie')
})

// 4) HTTP/2 伪头丢弃，:authority 不误判
check('HTTP/2 伪头丢弃', () => {
  const r = parseCurl("curl 'https://a.example.com/x' -H ':authority: a.example.com' -H 'accept: */*'")
  eq(r.headers.accept, '*/*', 'accept')
  eq(Object.keys(r.headers).length, 1, '只剩一个头')
})

// 5) --url / --referer / --user-agent 长参数
check('长参数形式', () => {
  const r = parseCurl('curl --url https://a.example.com/x --referer https://a.example.com/ --user-agent UA1 -H "cookie: k=v"')
  eq(r.url, 'https://a.example.com/x', 'url')
  eq(r.headers.Referer, 'https://a.example.com/', 'referer')
  eq(r.headers['User-Agent'], 'UA1', 'ua')
  eq(r.cookie, 'k=v', 'cookie')
})

// 6) 没有地址 → null
check('无地址返回 null', () => {
  eq(parseCurl('not a curl command'), null, 'null')
  eq(parseCurl(''), null, 'empty null')
})

// 7) cookie 值里的分号与等号不能被截断
check('cookie 值保留完整', () => {
  const r = parseCurl("curl 'https://a.example.com/x' -H 'Cookie: a=1; b=2=3; c='")
  eq(r.cookie, 'a=1; b=2=3; c=', 'cookie')
})

// 8) 单引号内的双引号保留
check('引号嵌套', () => {
  const r = parseCurl(`curl 'https://a.example.com/x' --data-raw '{"k":"v"}'`)
  eq(r.body, '{"k":"v"}', 'body')
})

console.log('--- summary ---')
console.log(`pass=${pass} fail=${fail}`)
if (fail) process.exit(1)
console.log('ALL PASS')
