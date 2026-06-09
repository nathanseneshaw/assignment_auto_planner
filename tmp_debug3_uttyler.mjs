import { CookieJar } from 'tough-cookie'
import makeFetchCookie from 'fetch-cookie'
import * as cheerio from 'cheerio'
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const BASE='https://tycs-prd.utshare.utsystem.edu'
const LAND=`${BASE}/psc/TYCSPRD/EMPLOYEE/SA/c/NUI_FRAMEWORK.PT_LANDINGPAGE.GBL`
const CA=`${BASE}/psc/TYCSPRD/EMPLOYEE/SA/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL`
const SEL={inst:'select[id^="CLASS_SRCH_WRK2_INSTITUTION"]',term:'select[id^="CLASS_SRCH_WRK2_STRM"]',career:'select[id^="SSR_CLSRCH_WRK_ACAD_CAREER"]',subject:'select[id^="SSR_CLSRCH_WRK_SUBJECT_SRCH"]',cat:'input[id^="SSR_CLSRCH_WRK_CATALOG_NBR"]',match:'select[id^="SSR_CLSRCH_WRK_SSR_EXACT_MATCH1"]'}
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
class S{constructor(){this.f=makeFetchCookie(fetch,new CookieJar())}
 async open(){await this.f(LAND,{headers:{'User-Agent':UA}});this.$=cheerio.load(await (await this.f(CA,{headers:{'User-Agent':UA}})).text());return this}
 n(s){return this.$(s).attr('name')} sel(s){return this.$(`${s} option[selected]`).attr('value')||''}
 has(s,code){let f=false;this.$(`${s} option`).each((_,o)=>{if(this.$(o).attr('value')===code)f=true});return f}
 snap(){const b=new URLSearchParams();this.$('form[name="win0"]').find('input,select,textarea').each((_,el)=>{const name=this.$(el).attr('name');if(!name||/SSR_OPEN_ONLY/.test(name))return;const tag=el.tagName.toLowerCase(),type=(this.$(el).attr('type')||tag).toLowerCase();if(type==='checkbox'||type==='radio'){if(this.$(el).attr('checked')!==undefined)b.set(name,this.$(el).attr('value')||'Y');return}if(tag==='select'){b.set(name,this.$(el).find('option[selected]').attr('value')??'');return}b.set(name,this.$(el).attr('value')??'')});return b}
 async post(ic,v={}){const b=this.snap();for(const[k,x]of Object.entries(v))if(k)b.set(k,x);b.set('ICAJAX','0');b.set('ICNAVTYPEDROPDOWN','0');b.set('ICType','Panel');b.set('ICElementNum','0');b.set('ICModelCancel','0');b.set('ICResubmit','0');b.set('ICStateNum',this.$('input[name="ICStateNum"]').attr('value')||'2');b.set('ICSID',this.$('input[name="ICSID"]').attr('value')||'');b.set('ICAction',ic);const h=await (await this.f(CA,{method:'POST',headers:{'User-Agent':UA,'Content-Type':'application/x-www-form-urlencoded'},body:b.toString()})).text();this.$=cheerio.load(h);return h}}
const TERM='2268',CAREER='UGRD',SUBJ='COSC'
async function prep(){for(let i=0;i<6;i++){try{const s=await new S().open();const inst=s.n(SEL.inst),term=s.n(SEL.term),car=s.n(SEL.career)
   await s.post(term,{[inst]:'UTTYL',[term]:TERM}); await sleep(300)
   await s.post(car,{[inst]:'UTTYL',[term]:TERM,[car]:CAREER}); await sleep(300)
   if(s.has(SEL.subject,SUBJ)) return {s,inst,term,car}
  }catch(e){}}
 return null}
const p=await prep(); if(!p){console.log('prep failed');process.exit(0)}
const {s,inst,term,car}=p; const subj=s.n(SEL.subject)
await s.post(subj,{[inst]:'UTTYL',[term]:TERM,[car]:CAREER,[subj]:SUBJ}); await sleep(300)
console.log('=== ALL SSR_CLSRCH_WRK_* fields after subject FieldChange ===')
const seen=new Set()
s.$('form[name="win0"]').find('input,select').each((_,el)=>{const name=s.$(el).attr('name');if(!name||!/SSR_CLSRCH_WRK|CLASS_SRCH_WRK2/.test(name)||seen.has(name))return;seen.add(name);const tag=el.tagName.toLowerCase();let val;if(tag==='select')val='[sel='+(s.$(el).find('option[selected]').attr('value')||'')+']';else val=JSON.stringify(s.$(el).attr('value')||'');console.log(`  ${name} = ${val}`)})
// now look at criteria region text / any hidden criteria-count
console.log('\n=== search button + criteria hint ===')
const cnt=s.$('[id*="SSR_CLSRCH"][id*="CRITERIA"],[id*="CRSE_COUNT"]').map((_,e)=>s.$(e).attr('id')).get()
console.log('criteria-ish ids:', cnt.slice(0,10))
