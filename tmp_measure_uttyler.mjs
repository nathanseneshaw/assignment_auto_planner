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
 async post(ic,v={},delay=450){const b=this.snap();for(const[k,x]of Object.entries(v))if(k)b.set(k,x);b.set('ICAJAX','0');b.set('ICNAVTYPEDROPDOWN','0');b.set('ICType','Panel');b.set('ICElementNum','0');b.set('ICModelCancel','0');b.set('ICResubmit','0');b.set('ICStateNum',this.$('input[name="ICStateNum"]').attr('value')||'2');b.set('ICSID',this.$('input[name="ICSID"]').attr('value')||'');b.set('ICAction',ic);const h=await (await this.f(CA,{method:'POST',headers:{'User-Agent':UA,'Content-Type':'application/x-www-form-urlencoded'},body:b.toString()})).text();this.$=cheerio.load(h);await sleep(delay);return h}}
async function attempt(term,career,subject,cat,match){
 const s=await new S().open()
 const inst=s.n(SEL.inst),termN=s.n(SEL.term),carN=s.n(SEL.career)
 await s.post(inst,{[inst]:'UTTYL'})
 await s.post(termN,{[inst]:'UTTYL',[termN]:term})
 if(s.sel(SEL.term)!==term) return {prep:false}
 await s.post(carN,{[inst]:'UTTYL',[termN]:term,[carN]:career})
 if(!s.has(SEL.subject,subject)) return {prep:false,nosub:true}
 const subjN=s.n(SEL.subject),catN=s.n(SEL.cat),matchN=s.n(SEL.match)
 const ctx={[inst]:'UTTYL',[termN]:term,[carN]:career}
 await s.post(subjN,{...ctx,[subjN]:subject})
 if(s.sel(SEL.subject)!==subject) return {prep:false}
 const h=await s.post('CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH',{...ctx,[subjN]:subject,[catN]:cat,[matchN]:match})
 const crit=/at least \d+ search criteria/.test(h)
 const sections=s.$('[id^="MTG_CLASS_NBR$"]').length
 const nores=/did not return any|no classes found/i.test(h)
 return {prep:true,pass:!crit,sections,nores,s}
}
async function measure(label,term,career,subject,cat,match,trials=6){
 let pass=0,prepfail=0,withSecs=null
 for(let i=0;i<trials;i++){
  const r=await attempt(term,career,subject,cat,match)
  if(!r.prep){prepfail++;continue}
  if(r.pass){pass++; if(r.sections&&!withSecs) withSecs=r.s}
 }
 console.log(`\n[${label}] ${subject}/${career}/${term} cat=${cat}/${match}: passed ${pass}/${trials} (prepFail ${prepfail})`)
 if(withSecs){const s=withSecs;console.log('  REAL SECTIONS:')
  s.$('[id^="MTG_CLASS_NBR$"]').slice(0,6).each((_,el)=>{const n=(s.$(el).attr('id').match(/\$(\d+)/)||[])[1];console.log('   •',JSON.stringify({crn:s.$(el).text().trim(),cls:s.$(`[id="MTG_CLASSNAME$${n}"]`).text().replace(/\s+/g,' ').trim(),day:s.$(`[id="MTG_DAYTIME$${n}"]`).text().replace(/\s+/g,' ').trim(),room:s.$(`[id="MTG_ROOM$${n}"]`).text().replace(/\s+/g,' ').trim(),instr:s.$(`[id="MTG_INSTR$${n}"]`).text().replace(/\s+/g,' ').trim(),status:s.$(`[id="win0divDERIVED_CLSRCH_SSR_STATUS_LONG$${n}"] img`).attr('alt')||''}))})}
}
await measure('Medicine known-data','2257','MEDS','MEDI','0001','G')
await measure('Undergrad Fall2026','2268','UGRD','COSC','0001','G')
