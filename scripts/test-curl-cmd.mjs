import { readFileSync } from 'node:fs'
const src = readFileSync('client.js', 'utf8')
const m = src.match(/\/\/ --- curl-parse-begin ---([\s\S]*?)\/\/ --- curl-parse-end ---/)
if (!m) throw new Error('markers not found')
const fn = new Function(
  m[1] + '\nreturn { tokenizeCurl, parseCurl }',
)
const { parseCurl } = fn()

const cmdStyle = `curl ^"https://h5api.m.taobao.com/h5/mtop.taobao.wireless.order.list.get/1.0/?jsv=2.7.2^&appKey=12574478^&t=1792678221454^&sign=258f22f2c7715ddb4ec990d443d4d5db^&api=mtop.taobao.wireless.order.list.get^&v=1.0^&dataType=json^&data=^%^7B^%^22page^%^22:1^%^7D^" ^
  -H ^"accept: application/json^" ^
  -H ^"cookie: cna=abc; _m_h5_tk=token_123; cookie2=xyz^" ^
  --compressed`

const r = parseCurl(cmdStyle)
console.log(JSON.stringify(r, null, 2))
const ok =
  r && r.url.startsWith('https://h5api.m.taobao.com/') &&
  r.url.includes('&appKey=12574478') &&
  r.url.includes('data=%7B%22page%22:1%7D') &&
  r.cookie.includes('_m_h5_tk=token_123') &&
  r.headers.accept === 'application/json' &&
  !r.url.includes('^')
console.log('CMD-STYLE PARSE:', ok ? 'PASS' : 'FAIL')
process.exit(ok ? 0 : 1)
