// Finto Supabase per provare la modalità online senza toccare il progetto vero
const http=require('http'), fs=require('fs'), url=require('url');
const XLS=process.env.XLS||'/home/claude/Formazioni.xls';
const rose=JSON.parse(fs.readFileSync(process.env.ROSE||'/tmp/rose.json','utf8'));
const TEAM={id:'team-Valerio',name:'Valerio',sheet_name:'Valerio'};
const CLUBS=['Atalanta','Bologna','Cagliari','Como','Cremonese','Fiorentina','Genoa','Inter','Juventus','Lazio',
             'Lecce','Milan','Napoli','Parma','Pisa','Roma','Sassuolo','Torino','Udinese','Verona'];
const players=rose['Valerio'].map((p,i)=>({id:'pl-'+p.slot,slot:p.slot,role:p.role,name:p.name,
  club: process.env.NOCLUB ? null : CLUBS[i%CLUBS.length]}));
const byId=new Map(players.map(p=>[p.id,p]));

// calendario: 10 partite. Con LOCKED le prime due sono già iniziate.
const H=36e5;
const now=Date.now();
const fixtures=[];
for(let i=0;i<10;i++){
  const iniziata = process.env.LOCKED && i<2;
  fixtures.push({id:900+i, matchday:7, home:CLUBS[i*2], away:CLUBS[i*2+1],
    kickoff:new Date(now + (iniziata ? -H : (i+1)*H*3)).toISOString(), status: iniziata?'IN_PLAY':'TIMED'});
}
const kicks=fixtures.map(f=>+new Date(f.kickoff));
const md={id:7,label:'Giornata 7',
  first_kickoff:new Date(Math.min(...kicks)).toISOString(),
  last_kickoff:new Date(Math.max(...kicks)).toISOString(),
  closes_at:new Date(Math.max(...kicks)+2*H).toISOString()};
md.deadline=md.first_kickoff;
if(process.env.CLOSED){ md.closes_at=new Date(now-H).toISOString(); md.deadline=md.closes_at; }

const clubKick=c=>{const k=fixtures.filter(f=>f.home===c||f.away===c).map(f=>+new Date(f.kickoff));return k.length?Math.min(...k):null;};
const locked=id=>{const p=byId.get(id); if(!p) return false; const t=p.club?clubKick(p.club):Math.min(...kicks); return t!=null&&t<=Date.now();}; // come player_locked()

const state={lineup:null, prev:null, logs:[], clubs:{}};
if(process.env.PRELOAD) state.lineup={id:'ln1',team_id:TEAM.id,module:'4-3-3',bench_free:false,updated_at:new Date(now-72e5).toISOString(),
  lineup_slots:[1,2,3,4,5,6,7,8,9,10,11].map((pos,i)=>({pos,player_id:'pl-'+[1,5,6,8,11,15,16,19,25,27,26][i]}))};
// formazione di una giornata precedente, per il ripristino
if(process.env.PREV) state.prev={matchday:5,module:'3-5-2',bench_free:true,updated_at:new Date(now-20*24*H).toISOString(),
  lineup_slots:[1,5,6,8,11,15,16,19,25,27,26,2,7,9,12,17,20,28].map((n,i)=>({pos:i+1,player_id:'pl-'+n,
    players:{name:(byId.get('pl-'+n)||{}).name,role:(byId.get('pl-'+n)||{}).role}}))};

const json=(res,code,obj)=>{res.writeHead(code,{'content-type':'application/json','access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,PUT,DELETE,PATCH,OPTIONS','access-control-max-age':'600','access-control-expose-headers':'*'});res.end(JSON.stringify(obj));};

http.createServer((req,res)=>{
  const u=url.parse(req.url,true); let body='';
  req.on('data',c=>body+=c); req.on('end',()=>{
    const p=u.pathname, q=u.query; let b={}; try{ b=body?JSON.parse(body):{}; }catch(e){ b={}; }
    console.log('>>',req.method,p,JSON.stringify(q).slice(0,120));
    if(req.method==='OPTIONS') return json(res,200,{});
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
      if(q.is_current) return json(res,200,[md]);
      return json(res,200,[{id:7,label:'Giornata 7'},{id:6,label:'Giornata 6'},{id:5,label:'Giornata 5'}]);
    }
    if(p==='/rest/v1/fixtures') return json(res,200,fixtures);
    if(p==='/rest/v1/players'){
      if(String(q.select||'').includes('teams('))
        return json(res,200,players.map(x=>({id:x.id,name:x.name,role:x.role,club:state.clubs[x.id]!==undefined?state.clubs[x.id]:x.club,team_id:TEAM.id,teams:{name:TEAM.name}})));
      return json(res,200,players.map(x=>Object.assign({},x,state.clubs[x.id]!==undefined?{club:state.clubs[x.id]}:{})));
    }
    if(p==='/rest/v1/lineups'){
      const sel=String(q.select||'');
      if(sel.includes('teams(')){           // formazioni di tutta la lega
        const out=[];
        if(state.lineup) out.push(Object.assign({team_id:TEAM.id,module:state.lineup.module,updated_at:state.lineup.updated_at},
          {lineup_slots:state.lineup.lineup_slots.map(s=>({pos:s.pos,players:{name:(byId.get(s.player_id)||{}).name,role:(byId.get(s.player_id)||{}).role,club:(byId.get(s.player_id)||{}).club}}))}));
        out.push({team_id:'team-Sebi',module:'3-4-3',updated_at:new Date(now-36e5).toISOString(),
          lineup_slots:players.slice(0,11).map((x,i)=>({pos:i+1,players:{name:x.name,role:x.role,club:x.club}}))});
        return json(res,200,out);
      }
      if(String(q.matchday||'').startsWith('lt.')) return json(res,200,state.prev?[state.prev]:[]);
      return json(res,200,state.lineup?[state.lineup]:[]);
    }
    if(p==='/rest/v1/teams') return json(res,200,Object.keys(rose).map(n=>({id:'team-'+n,name:n,sheet_name:n})));
    if(p==='/rest/v1/lineup_log') return json(res,200,state.logs);
    if(p==='/rest/v1/rpc/save_lineup'){
      // il vero database rifiuta le modifiche che toccano chi è già sceso in campo
      const vecchi=new Map((state.lineup?state.lineup.lineup_slots:[]).map(s=>[s.pos,s.player_id]));
      const nuovi=new Map(b.p_slots.map(s=>[s.pos,s.player_id]));
      const tocchi=new Set();
      new Set([...vecchi.keys(),...nuovi.keys()]).forEach(pos=>{
        if(vecchi.get(pos)!==nuovi.get(pos)){ [vecchi.get(pos),nuovi.get(pos)].forEach(id=>{ if(id&&locked(id)) tocchi.add((byId.get(id)||{}).name); }); }
      });
      if(process.env.FORCE_P0007) return json(res,400,{code:'P0007',message:'Partita già iniziata per: Meret'});
      if(tocchi.size) return json(res,400,{code:'P0007',message:'Partita già iniziata per: '+[...tocchi].join(', ')});
      const snap=b.p_slots.map(s=>({pos:s.pos,nome:(byId.get(s.player_id)||{}).name,ruolo:(byId.get(s.player_id)||{}).role}));
      const out={lineup_id:'ln1',action:state.lineup?'modificata':'creata',changes:{entrati:snap.slice(0,2).map(x=>({pos:x.pos,nome:x.nome})),usciti:[],spostati:[],modulo:{da:null,a:b.p_module}},snapshot:snap};
      state.lineup={id:'ln1',team_id:TEAM.id,module:b.p_module,bench_free:b.p_bench_free,updated_at:new Date().toISOString(),lineup_slots:b.p_slots};
      state.logs.unshift({at:new Date().toISOString(),action:out.action,changes:out.changes});
      fs.writeFileSync('/tmp/last_save.json',JSON.stringify(b));
      return json(res,200,out);
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
    json(res,404,{message:'non trovato: '+p});
  });
}).listen(8899,'localhost',()=>console.log('mock supabase su 8899'));
