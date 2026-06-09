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
 snap(){const b=new URLSearchParams();this.$('form[name="win0"]').find('input,select,textarea').each((_,el)=>{const name=this.$(el).attr('name');if(!name||/SSR_OPEN_ONLY/.test(name))return;const tag=el.tagName.toLowerCase(),type=(this.$(el).attr('type')||tag).toLowerCase();if(type==='checkbox'||type==='radio'){if(this.$(el).attr('checked')!==undefined)b.set(name,this.$(el).attr('value')||'Y');return}if(tag==='select'){b.set(name,this.$(el).find('option[selected]').attr('value')??'');return}b.set(name,this.$(el).attr('value')??'')});return b}
 async post(ic,v={}){const b=this.snap();for(const[k,x]of Object.entries(v))if(k)b.set(k,x);b.set('ICAJAX','0');b.set('ICNAVTYPEDROPDOWN','0');b.set('ICType','Panel');b.set('ICElementNum','0');b.set('ICModelCancel','0');b.set('ICResubmit','0');b.set('ICStateNum',this.$('input[name="ICStateNum"]').attr('value')||'2');b.set('ICSID',this.$('input[name="ICSID"]').attr('value')||'');b.set('ICAction',ic);const h=await (await this.f(CA,{method:'POST',headers:{'User-Agent':UA,'Content-Type':'application/x-www-form-urlencoded'},body:b.toString()})).text();this.$=cheerio.load(h);return h}}
const TERM='2268',CAREER='UGRD',SUBJ='COSC'
async function prep(){const s=await new S().open();const inst=s.n(SEL.inst),term=s.n(SEL.term),car=s.n(SEL.career)
 await s.post(term,{[inst]:'UTTYL',[term]:TERM})
 await s.post(car,{[inst]:'UTTYL',[term]:TERM,[car]:CAREER})
 return {s,inst,term,car}}
function diag(s,h){const crit=/at least \d+ search criteria/.test(h);const sec=s.$('[id^="MTG_CLASS_NBR$"]').length;const page=(h.match(/PAGE=([A-Z_]+)/)||[])[1]||'?';const nores=/did not return any|no classes found/i.test(h);return `page=${page} crit2=${crit} sections=${sec} noResults=${nores} subjSel=${s.sel(SEL.subject)||'-'} catVal="${s.$(SEL.cat).attr('value')||''}"`}

for(const variant of ['A_subjFC_cat0001G','B_subjFC_catFC_0001G','C_subjFC_cat1315E','D_subjFC_noCat','E_subjFC_cat1G']){
 try{
  const {s,inst,term,car}=await prep()
  if(!s.has(SEL.subject,SUBJ)){console.log(`[${variant}] subject not in dropdown (subs=${s.$(SEL.subject+' option').length})`);continue}
  const subj=s.n(SEL.subject),catN=s.n(SEL.cat),matchN=s.n(SEL.match)
  const ctx={[inst]:'UTTYL',[term]:TERM,[car]:CAREER}
  await s.post(subj,{...ctx,[subj]:SUBJ})
  const subjOk=s.sel(SEL.subject)===SUBJ
  let ex={...ctx,[subj]:SUBJ}
  if(variant==='A_subjFC_cat0001G'){ex[catN]='0001';ex[matchN]='G'}
  if(variant==='B_subjFC_catFC_0001G'){await s.post(catN,{...ctx,[subj]:SUBJ,[catN]:'0001',[matchN]:'G'});ex[catN]='0001';ex[matchN]='G'}
  if(variant==='C_subjFC_cat1315E'){ex[catN]='1315';ex[matchN]='E'}
  if(variant==='D_subjFC_noCat'){/* no cat */}
  if(variant==='E_subjFC_cat1G'){ex[catN]='1';ex[matchN]='G'}
  const h=await s.post('CLASS_SRCH_WRK2_SSR_PB_CLASS_SRCH',ex)
  console.log(`[${variant}] subjSelectedAfterFC=${subjOk} -> ${diag(s,h)}`)
 }catch(e){console.log(`[${variant}] ERR ${e.message}`)}
}
