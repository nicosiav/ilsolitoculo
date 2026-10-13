// Finto Supabase per provare la modalità online senza toccare il progetto vero.
// Da solo:  node server.js  (porta 8899)
// Dentro il finto Supabase del sito: require('.../server.js').gestisci(req,res,p,q,b)
const http=require('http'), fs=require('fs'), url=require('url');
const MD=+(process.env.MD||7);   // giornata corrente, numerazione di Serie A
const XLS=process.env.FORMAZIONI||process.env.XLS||'/home/claude/Formazioni.xls';  // il modello per l'export
const rose=JSON.parse(fs.readFileSync(process.env.ROSE||'/tmp/rose.json','utf8'));
const TEAM={id:'team-Valerio',name:'Valerio',sheet_name:'Valerio'};
const CLUBS=['Atalanta','Bologna','Cagliari','Como','Cremonese','Fiorentina','Genoa','Inter','Juventus','Lazio',
             'Lecce','Milan','Napoli','Parma','Pisa','Roma','Sassuolo','Torino','Udinese','Verona'];
const players=rose['Valerio'].map((p,i)=>({id:'pl-'+p.slot,slot:p.slot,role:p.role,name:p.name,
  club: process.env.NOCLUB ? null : CLUBS[i%CLUBS.length]}));
const byId=new Map(players.map(p=>[p.id,p]));

// calendario: 10 partite. Con LOCKED le prime due sono già iniziate; con LOCK30 la
// prima inizia fra 20 minuti (già bloccata: il blocco scatta mezz'ora prima).
const H=36e5, M30=30*60e3;
const now=Date.now();
const fixtures=[];
for(let i=0;i<10;i++){
  const iniziata = process.env.LOCKED && i<2;
  const fra20 = process.env.LOCK30 && i===0;
  fixtures.push({id:900+i, matchday:MD, home:CLUBS[i*2], away:CLUBS[i*2+1],
    kickoff:new Date(now + (iniziata ? -H : fra20 ? 20*60e3 : (i+1)*H*3)).toISOString(), status: iniziata?'IN_PLAY':'TIMED'});
}
const kicks=fixtures.map(f=>+new Date(f.kickoff));
const md={id:MD,label:'Giornata '+MD,
  first_kickoff:new Date(Math.min(...kicks)).toISOString(),
  last_kickoff:new Date(Math.max(...kicks)).toISOString(),
  closes_at:new Date(Math.max(...kicks)+2*H).toISOString()};
md.deadline=md.first_kickoff;
// scadenza della formazione completa: fra 20 ore (dopo le prime partite); con SCADUTA è passata
md.scadenza_auto=new Date(now + (process.env.SCADUTA ? -60e3 : 20*H)).toISOString();
md.scadenza_admin=null; md.scadenza=md.scadenza_auto;
if(process.env.CLOSED){ md.closes_at=new Date(now-H).toISOString(); md.deadline=md.closes_at; }

const clubKick=c=>{const k=fixtures.filter(f=>f.status!=='POSTPONED'&&(f.home===c||f.away===c)).map(f=>+new Date(f.kickoff));return k.length?Math.min(...k):null;};
const lockAt=p=>{ if(!p) return null; const t=p.club?clubKick(p.club):Math.min(...kicks); return t==null?null:t-M30; };
const lockedP=p=>{ const t=lockAt(p); return t!=null&&t<=Date.now(); };
const locked=id=>lockedP(byId.get(id)); // come player_locked(): mezz'ora prima della partita

// le altre squadre: stessi id dappertutto (pl-Sebi-3), squadre di Serie A in giro
const squadra=nome=>(rose[nome]||[]).map((x,i)=>({id:'pl-'+nome+'-'+x.slot,slot:x.slot,role:x.role,name:x.name,club:CLUBS[i%CLUBS.length]}));
const tutti=new Map(players.map(p=>[p.id,p]));
Object.keys(rose).filter(n=>n!=='Valerio').forEach(n=>squadra(n).forEach(p=>tutti.set(p.id,p)));
// regole sui bloccati, come controlla_blocchi() del database
function controlla(vecchi, nuovi, modVecchio, modNuovo){
  const tocchi=new Set();
  new Set([...vecchi.keys(),...nuovi.keys()]).forEach(pos=>{
    if(vecchi.get(pos)!==nuovi.get(pos)){ [vecchi.get(pos),nuovi.get(pos)].forEach(id=>{ if(id&&locked(id)) tocchi.add((tutti.get(id)||{}).name); }); }
  });
  if(tocchi.size) return 'Partita già iniziata (o al via fra meno di 30 minuti) per: '+[...tocchi].join(', ');
  const ruolo=id=>(tutti.get(id)||{}).role;
  for(const [pos,id] of [...vecchi.entries()].sort((a,b)=>a[0]-b[0])){
    if(pos<12||!locked(id)) continue;
    const r=ruolo(id);
    const davanti=m=>[...m.entries()].filter(([k,x])=>k<pos&&ruolo(x)===r).map(([k,x])=>x).sort().join(',');
    const tit=m=>[...m.entries()].filter(([k,x])=>k<=11&&ruolo(x)===r).length;
    const nelModulo=m=>r==='P'||!/^\d-\d-\d$/.test(m||'')?null:+m.split('-')['DCA'.indexOf(r)];
    if(davanti(vecchi)!==davanti(nuovi)||tit(vecchi)!==tit(nuovi)||(nelModulo(modVecchio)!=null&&nelModulo(modVecchio)!==nelModulo(modNuovo)))
      return (tutti.get(id)||{}).name+' (posto '+pos+') è già bloccato: i giocatori del suo reparto prima di lui restano gli stessi';
  }
  return null;
}

const state={lineup:null, prev:null, logs:[], clubs:{}, vuoti:[], altre:{}};
if(process.env.PRELOAD) state.lineup={id:'ln1',team_id:TEAM.id,module:'4-3-3',bench_free:false,updated_at:new Date(now-72e5).toISOString(),
  lineup_slots:[1,2,3,4,5,6,7,8,9,10,11].map((pos,i)=>({pos,player_id:'pl-'+[1,5,6,8,11,15,16,19,25,27,26][i]}))};
// VUOTO: il giocatore al posto 5 (pl-11) è stato svincolato dal mercato: fuori rosa, posto vuoto da rifare
const fuoriRosa=new Set();
if(process.env.PRELOAD && process.env.VUOTO){
  const via=byId.get('pl-11'); fuoriRosa.add('pl-11');
  state.lineup.lineup_slots=state.lineup.lineup_slots.filter(x=>x.pos!==5);
  state.vuoti.push({lineup_id:'ln1',pos:5,nome:via.name,ruolo:via.role,motivo:'svincolato'});
}
// PANCA: il caso di Lucca. 4-4-2 con Davis K. (Cagliari, già bloccato con LOCKED) primo
// panchinaro dell'attacco al 17: Woltemade e Ramos G. (titolari) restano fermi
if(process.env.PANCA){
  const f={1:1,2:6,3:7,4:8,5:9,6:15,7:16,8:17,9:18,10:27,11:28,12:2,13:10,14:11,15:19,16:20,17:25,18:29,19:30,20:21,21:12,22:31};
  state.lineup={id:'ln1',team_id:TEAM.id,module:'4-4-2',bench_free:false,updated_at:new Date(now-5*H).toISOString(),
    lineup_slots:Object.entries(f).map(([pos,slot])=>({pos:+pos,player_id:'pl-'+slot}))};
}
// ADMIN_MOD: l'amministratore ha già modificato la formazione di Valerio
if(process.env.ADMIN_MOD) state.logs.push({team_id:TEAM.id,matchday:MD,at:new Date(now-30*60e3).toISOString(),action:'modificata',da_admin:true,
  autore:'Sebi',nota:'Comunicata su WhatsApp alle 11.40',changes:{entrati:[{pos:12,nome:'Contini'}],usciti:[{pos:12,nome:'Milinkovic-Savic V.'}],spostati:[],modulo:null}});
// formazione di una giornata precedente, per il ripristino
if(process.env.PREV) state.prev={matchday:5,module:'3-5-2',bench_free:true,updated_at:new Date(now-20*24*H).toISOString(),
  lineup_slots:[1,5,6,8,11,15,16,19,25,27,26,2,7,9,12,17,20,28].map((n,i)=>({pos:i+1,player_id:'pl-'+n,
    players:{name:(byId.get('pl-'+n)||{}).name,role:(byId.get('pl-'+n)||{}).role}}))};

// la formazione salvata di un'altra squadra: quella cambiata dall'amministratore, o una
// fatta con i primi della rosa (Sebi e Massimo; le altre non hanno ancora schierato)
function altraDi(nome){
  const tid='team-'+nome;
  if(state.altre[tid]) return state.altre[tid];
  if(!['Sebi','Massimo'].includes(nome)) return null;
  const r=squadra(nome), per=k=>r.filter(x=>x.role===k);
  const ord=[...per('P').slice(0,1),...per('D').slice(0,4),...per('C').slice(0,3),...per('A').slice(0,3),...per('P').slice(1,2),...per('D').slice(4,6),...per('C').slice(3,5),...per('A').slice(3,5)];
  return {id:'ln-'+nome,team_id:tid,module:'4-3-3',bench_free:false,updated_at:new Date(now-(nome==='Sebi'?1:5)*H).toISOString(),
    lineup_slots:ord.map((x,i)=>({pos:i+1,player_id:x.id}))};
}

const json=(res,code,obj)=>{res.writeHead(code,{'content-type':'application/json','access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,PUT,DELETE,PATCH,OPTIONS','access-control-max-age':'600','access-control-expose-headers':'*'});res.end(JSON.stringify(obj));};

// risponde se la richiesta è sua; altrimenti false
function gestisci(req,res,p,q,b){
    if(p==='/auth/v1/token'){
      if(q.grant_type==='password'){
        if(b.password!=='giusta') return json(res,400,{error_code:'invalid_credentials',message:'Invalid login credentials'});
        return json(res,200,{access_token:'tok',refresh_token:'ref',expires_in:3600,user:{id:'u1',email:b.email}});
      }
      return json(res,200,{access_token:'tok2',refresh_token:'ref',expires_in:3600,user:{id:'u1'}});
    }
    if(p==='/auth/v1/user') return json(res,200,{id:'u1',email:'valerio@test.it'});
    if(p==='/auth/v1/logout') return json(res,204,{});
    if(p==='/auth/v1/recover') return json(res,200,{});
    if(p==='/rest/v1/profiles') return json(res,200,[{display_name:'Valerio',role:process.env.ADMIN?'admin':'player',team_id:TEAM.id,teams:{name:TEAM.name,sheet_name:TEAM.sheet_name}}]);
    if(p==='/rest/v1/matchdays'){
      // NOSCAD: database senza db/12_scadenze.sql (le colonne non ci sono)
      if(process.env.NOSCAD && String(q.select||'').includes('scadenza')) return json(res,400,{code:'42703',message:'column matchdays.scadenza does not exist'});
      if(q.is_current) return json(res,200,[process.env.NOSCAD?(({scadenza,scadenza_auto,scadenza_admin,...x})=>x)(md):md]);
      return json(res,200,[MD,MD-1,MD-2].map(n=>({id:n,label:'Giornata '+n})));
    }
    if(p==='/rest/v1/fixtures') return json(res,200,fixtures);
    if(p==='/rest/v1/rounds') return process.env.NOROUNDS ? json(res,404,{code:'PGRST205',message:"Could not find the table 'public.rounds' in the schema cache"})
      : json(res,200,[{id:5,serie_a:7},{id:4,serie_a:6},{id:3,serie_a:5}]);
    if(p==='/rest/v1/players'){
      if(String(q.select||'').includes('teams('))
        return json(res,200,players.map(x=>({id:x.id,name:x.name,role:x.role,club:state.clubs[x.id]!==undefined?state.clubs[x.id]:x.club,team_id:TEAM.id,teams:{name:TEAM.name}})));
      const tid=String(q.team_id||'').replace(/^eq\./,'');
      if(tid && tid!==TEAM.id) return json(res,200,squadra(tid.replace(/^team-/,'')));
      return json(res,200,players.filter(x=>!fuoriRosa.has(x.id)).map(x=>Object.assign({},x,state.clubs[x.id]!==undefined?{club:state.clubs[x.id]}:{})));
    }
    if(p==='/rest/v1/lineups'){
      const sel=String(q.select||'');
      // formazioni di tutta la lega (sezione Giornata → Formazioni, file unico per l'amministratore):
      // Valerio (quella salvata qui), Sebi e Massimo; le altre squadre non hanno ancora schierato
      if(!q.team_id && sel.includes('players(') && String(q.matchday||'')==='eq.'+MD){
        const pl=x=>({name:x.name,role:x.role,club:x.club||null,slot:x.slot});
        const conGiocatori=l=>Object.assign({},l,{lineup_slots:l.lineup_slots.map(s=>({pos:s.pos,players:pl(tutti.get(s.player_id)||{})}))});
        const out=[];
        if(state.lineup) out.push({id:'ln1',team_id:TEAM.id,module:state.lineup.module,updated_at:state.lineup.updated_at,
          lineup_slots:state.lineup.lineup_slots.map(s=>({pos:s.pos,players:pl(byId.get(s.player_id)||{})}))});
        if(!process.env.SOLO_MIA){ out.push(conGiocatori(altraDi('Sebi'))); out.push(conGiocatori(altraDi('Massimo'))); }
        return json(res,200,out);
      }
      if(sel.includes('teams(')){           // formazioni di tutta la lega
        const out=[];
        if(state.lineup) out.push(Object.assign({team_id:TEAM.id,module:state.lineup.module,updated_at:state.lineup.updated_at},
          {lineup_slots:state.lineup.lineup_slots.map(s=>({pos:s.pos,players:{name:(byId.get(s.player_id)||{}).name,role:(byId.get(s.player_id)||{}).role,club:(byId.get(s.player_id)||{}).club}}))}));
        out.push({team_id:'team-Sebi',module:'3-4-3',updated_at:new Date(now-36e5).toISOString(),
          lineup_slots:players.slice(0,11).map((x,i)=>({pos:i+1,players:{name:x.name,role:x.role,club:x.club}}))});
        return json(res,200,out);
      }
      if(String(q.matchday||'').startsWith('lt.')) return json(res,200,state.prev?[state.prev]:[]);
      const tid=String(q.team_id||'').replace(/^eq\./,'');
      if(tid && tid!==TEAM.id){ const l=altraDi(tid.replace(/^team-/,'')); return json(res,200,l?[l]:[]); }
      return json(res,200,state.lineup?[state.lineup]:[]);
    }
    if(p==='/rest/v1/teams') return json(res,200,Object.keys(rose).map(n=>({id:'team-'+n,name:n,sheet_name:n})));
    if(p==='/rest/v1/lineup_log'){
      const tid=String(q.team_id||'').replace(/^eq\./,'');
      let l=state.logs.filter(x=>!tid||!x.team_id||x.team_id===tid);
      if(q.da_admin==='is.true') l=l.filter(x=>x.da_admin);
      return json(res,200,l);
    }
    if(p==='/rest/v1/lineup_vuoti'){
      const f=String(q.lineup_id||''); const ids=f.startsWith('eq.')?[f.slice(3)]:f.startsWith('in.(')?f.slice(4,-1).split(','):null;
      return json(res,200,state.vuoti.filter(v=>!ids||ids.includes(v.lineup_id)));
    }
    if(p==='/rest/v1/rpc/save_lineup'){
      // il vero database rifiuta dopo la scadenza e le modifiche che rompono le regole sui bloccati
      if(md.scadenza && +new Date(md.scadenza)<=Date.now()) return json(res,400,{code:'P0008',message:"Scadenza passata: la formazione non si può più cambiare. Per una modifica scrivi all'amministratore."});
      const vecchi=new Map((state.lineup?state.lineup.lineup_slots:[]).map(s=>[s.pos,s.player_id]));
      const nuovi=new Map(b.p_slots.map(s=>[s.pos,s.player_id]));
      if(process.env.FORCE_P0007) return json(res,400,{code:'P0007',message:'Partita già iniziata per: Meret'});
      const no=controlla(vecchi,nuovi,state.lineup&&state.lineup.module,b.p_module);
      if(no) return json(res,400,{code:'P0007',message:no});
      const snap=b.p_slots.map(s=>({pos:s.pos,nome:(byId.get(s.player_id)||{}).name,ruolo:(byId.get(s.player_id)||{}).role}));
      const out={lineup_id:'ln1',action:state.lineup?'modificata':'creata',changes:{entrati:snap.slice(0,2).map(x=>({pos:x.pos,nome:x.nome})),usciti:[],spostati:[],modulo:{da:null,a:b.p_module}},snapshot:snap};
      state.vuoti=[];            // salvata di nuovo: niente più da rifare (trigger su lineups)
      state.lineup={id:'ln1',team_id:TEAM.id,module:b.p_module,bench_free:b.p_bench_free,updated_at:new Date().toISOString(),lineup_slots:b.p_slots};
      state.logs.unshift({team_id:TEAM.id,matchday:MD,at:new Date().toISOString(),action:out.action,changes:out.changes,da_admin:false});
      fs.writeFileSync('/tmp/last_save.json',JSON.stringify(b));
      return json(res,200,out);
    }
    if(p==='/rest/v1/rpc/admin_save_lineup'){
      if(!process.env.ADMIN) return json(res,400,{code:'P0005',message:"Solo l'amministratore può modificare la formazione di un'altra squadra"});
      fs.writeFileSync('/tmp/admin_save.json',JSON.stringify(b));
      const snap=b.p_slots.map(s=>({pos:s.pos,nome:(tutti.get(s.player_id)||{}).name,ruolo:(tutti.get(s.player_id)||{}).role}));
      const l={id:'ln-'+b.p_team,team_id:b.p_team,module:b.p_module,bench_free:b.p_bench_free,updated_at:new Date().toISOString(),lineup_slots:b.p_slots};
      if(b.p_team===TEAM.id) state.lineup=Object.assign(l,{id:'ln1'}); else state.altre[b.p_team]=l;
      const changes={entrati:snap.slice(0,1).map(x=>({pos:x.pos,nome:x.nome})),usciti:[],spostati:[],modulo:null};
      state.logs.unshift({team_id:b.p_team,matchday:MD,at:new Date().toISOString(),action:'modificata',changes,da_admin:true,autore:'Valerio',nota:b.p_nota||null});
      return json(res,200,{lineup_id:l.id,action:'modificata',changes,snapshot:snap,da_admin:true});
    }
    if(p==='/rest/v1/rpc/set_scadenza'){
      if(!process.env.ADMIN) return json(res,400,{code:'P0005',message:"Solo l'amministratore può cambiare la scadenza"});
      fs.writeFileSync('/tmp/scadenza.json',JSON.stringify(b));
      md.scadenza_admin=b.p_scadenza||null; md.scadenza=md.scadenza_admin||md.scadenza_auto;
      return json(res,200,{giornata:MD,scadenza:md.scadenza,automatica:md.scadenza_auto,scelta:md.scadenza_admin});
    }
    if(p==='/rest/v1/rpc/import_players'){ fs.appendFileSync('/tmp/import.log',JSON.stringify({sheet:b.p_sheet,n:b.p_players.length,club:(b.p_players[0]||{}).club})+'\n');
      return json(res,200,{squadra:b.p_sheet,nuovi:1,aggiornati:b.p_players.length-1,rimossi:0}); }
    if(p==='/rest/v1/rpc/set_current_matchday'){ md.deadline=b.p_deadline; md.closes_at=b.p_deadline; fs.writeFileSync('/tmp/matchday.json',JSON.stringify(b)); return json(res,200,{ok:true}); }
    if(p==='/rest/v1/rpc/set_player_clubs'){ (b.p_items||[]).forEach(i=>{ state.clubs[i.player_id]=i.club||null; });
      fs.writeFileSync('/tmp/clubs.json',JSON.stringify(b)); return json(res,200,{aggiornati:(b.p_items||[]).length}); }
    if(p==='/rest/v1/rpc/log_export'){ fs.writeFileSync('/tmp/last_export.json',JSON.stringify(b)); return json(res,200,{}); }
    if(p==='/functions/v1/sync-calendario'){
      if(!process.env.ADMIN) return json(res,403,{errore:'Solo l’amministratore può aggiornare il calendario.'});
      fs.writeFileSync('/tmp/sync.json',JSON.stringify({q,b}));
      return json(res,200,{partite:380,giornate:38,corrente:7,da_controllare:null,
        squadre:q.squadre?{abbinati:229,aggiornati:12,da_sistemare:2,elenco:['Stankovic F. (non trovato)']}:undefined});
    }
    if(p.startsWith('/storage/v1/object/modelli/') && req.method==='POST'){ fs.writeFileSync('/tmp/upload.flag','1'); return json(res,200,{Key:'modelli/formazioni.xls'}); }
    if(p.startsWith('/storage/v1/object/modelli/')){
      const f=fs.readFileSync(XLS);
      res.writeHead(200,{'content-type':'application/vnd.ms-excel','access-control-allow-origin':'*'}); return res.end(f);
    }
    return false;
}
module.exports={gestisci};

if(require.main===module) http.createServer((req,res)=>{
  const u=url.parse(req.url,true); let body='';
  req.on('data',c=>body+=c); req.on('end',()=>{
    const p=u.pathname, q=u.query; let b={}; try{ b=body?JSON.parse(body):{}; }catch(e){ b={}; }
    if(req.method==='OPTIONS') return json(res,200,{});
    if(gestisci(req,res,p,q,b)===false) json(res,404,{message:'non trovato: '+p});
  });
}).listen(8899,'localhost',()=>console.log('mock supabase su 8899'));
