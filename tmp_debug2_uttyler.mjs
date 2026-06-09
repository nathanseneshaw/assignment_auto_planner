import { CookieJar } from 'tough-cookie'
import makeFetchCookie from 'fetch-cookie'
import * as cheerio from 'cheerio'
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const BASE='https://tycs-prd.utshare.utsystem.edu'
const LAND=`${BASE}/psc/TYCSPRD/EMPLOYEE/SA/c/NUI_FRAMEWORK.PT_LANDINGPAGE.GBL`
const CA=`${BASE}/psc/TYCSPRD/EMPLOYEE/SA/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL`
const SEL={inst:'select[id^="CLASS_SRCH_WRK2_INSTITUTION"]',term:'select[id^="CLASS_SRCH_WRK2_STRM"]',career:'select[id^="SSR_CLSRCH_WRK_ACAD_CAREER"]',subject:'select[id^="SSR_CLSRCH_WRK_SUBJECT_SRCH"]',cat:'input[id^="SSR_CLSRCH_WRK_CATALOG_NBR"]',match:'select[id^="SSR_CLSRCH_WRK_SSR_EXACT_MATCH1"]'}
class S{constructor(){this.f=makeFetchCookie(fetch,new CookieJar())}
 async open(){await this.f(LAND,{headers:{'User-Agent':UA}});this.$=cheerio.load(await (await this.f(CA,{headers:{'User-Agent':UA}})).text());return this}
 n(s){return this.$(s).attr('name')} sel(s){return this.$(`${s} option[selected]`).attr('value')||''}
 has(s,code){let f=false;this.$(`${s} option`).each((_,o)=>{if(this.$(o).attr('value')===code)f=true});return f}
 nsub(){return this.$(SEL.subject+' option').length}
 snap(){const b=new URLSearchParams();this.$('form[name="win0"]').find('input,select,textarea').each((_,el)=>{const name=this.$(el).attr('name');if(!name||/SSR_OPEN_ONLY/.test(name))return;const tag=el.tagName.toLowerCase(),type=(this.$(el).attr('type')||tag).toLowerCase();if(type==='checkbox'||type==='radio'){if(this.$(el).attr('checked')!==undefined)b.set(name,this.$(el).attr('value')||'Y');return}if(tag==='select'){b.set(name,this.$(el).find('option[selected]').attr('value')??'');return}b.set(name,this.$(el).attr('value')??'')});return b}
 async post(ic,v={}){const b=this.snap();for(const[k,x]of Object.entries(v))if(k)b.set(k,x);b.set('ICAJAX','0');b.set('ICNAVTYPEDROPDOWN','0');b.set('ICType','Panel');b.set('ICElementNum','0');b.set('ICModelCancel','0');b.set('ICResubmit','0');b.set('ICStateNum',this.$('input[name="ICStateNum"]').attr('value')||'2');b.set('ICSID',this.$('input[name="ICSID"]').attr('value')||'');b.set('ICAction',ic);const h=await (await this.f(CA,{method:'POST',headers:{'User-Agent':UA,'Content-Type':'application/x-www-form-urlencoded'},body:b.toString()})).text();this.$=cheerio.load(h);return h}}
const TERM='2268',CAREER='UGRD',SUBJ='COSC'
async function prep(useInstFC){for(let i=0;i<6;i++){try{const s=await new S().open();const inst=s.n(SEL.inst),term=s.n(SEL.term),car=s.n(SEL.career)
   if(useInstFC) await s.post(inst,{[inst]:'UTTYL'})
   await s.post(term,{[inst]:'UTTYL',[term]:TERM})
   await s.post(car,{[inst]:'UTTYL',[term]:TERM,[car]:CAREER})
   if(s.has(SEL.subject,SUBJ)) return {s,inst,term,car}
  }catch{}}
 return null}
function diag(s,h){const crit=/at least \d+ search criteria/.test(h);const sec=s.$('[id^="MTG_CLASS_NBR$"]').length;const nores=/did not return any|no classes found/i.test(h);return `crit2=${crit} sections=${sec} noResults=${nores}`}

async function run(label, {instFC, catFC, cat, match}){
 const p=await prep(instFC); if(!p){console.log(`[${label}] prep failed`);return}
 const {s,inst,term,car}=p; const subj=s.n(SEL.subject),catN=s.n(SEL.cat),matchN=s.n(SEL.match)
 const ctx={[inst]:'UTTYL',[term]:TERM,[car]:CAREER}
 await s.post(subj,{...ctx,[subj]:SUBJ})
 if(catFC) await s.post(catN,{...ctx,[subj]:SUBJ,[catN]:cat,[matchN]:match})
 const ex={...ctx,[subj]:SUBJ,[catN]:cat,[matchN]:match}
 const h=await s.post('CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH',ex)
 console.log(`[${label}] ${diag(s,h)}`)
 if(s.$('[id^="MTG_CLASS_NBR$"]').length){s.$('[id^="MTG_CLASS_NBR$"]').slice(0,4).each((_,el)=>{const n=(s.$(el).attr('id').match(/\$(\d+)/)||[])[1];console.log('   •',s.$(`[id="MTG_CLASSNAME$${n}"]`).text().replace(/\s+/g,' ').trim(),'|',s.$(`[id="MTG_DAYTIME$${n}"]`).text().replace(/\s+/g,' ').trim(),'|',s.$(`[id="MTG_INSTR$${n}"]`).text().replace(/\s+/g,' ').trim())})}
}
await run('catFC 0001/G', {instFC:false, catFC:true, cat:'0001', match:'G'})
await run('catFC 1315/E', {instFC:false, catFC:true, cat:'1315', match:'E'})
await run('instFC + bulk cat 0001/G', {instFC:true, catFC:false, cat:'0001', match:'G'})
await run('instFC + catFC 0001/G', {instFC:true, catFC:true, cat:'0001', match:'G'})
