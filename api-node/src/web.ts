/**
 * Server-rendered auth pages (login + forced first-change). The signed-in dashboard is the Vite/React
 * SPA served at /app (see server.ts registerDashboard); these pages are the small dependency-free gate
 * in front of it, kept server-rendered so first-run setup needs no built assets.
 */
const BASE_CSS = `
:root{--bg:#0b0d10;--card:#15181d;--line:#242a31;--fg:#e8ecf1;--dim:#8a94a2;--teal:#22d3ee;--red:#ef4444;--green:#22c55e}
*{box-sizing:border-box}body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg);margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:2rem;width:min(92vw,22rem);box-shadow:0 10px 40px rgba(0,0,0,.4)}
h1{font-size:1.3rem;margin:0 0 .25rem}p.sub{color:var(--dim);margin:.25rem 0 1.25rem;font-size:.9rem}
label{display:block;font-size:.8rem;color:var(--dim);margin:.75rem 0 .25rem}
input{width:100%;padding:.7rem;border-radius:10px;border:1px solid var(--line);background:#0e1116;color:var(--fg);font-size:1rem}
button{width:100%;margin-top:1.25rem;padding:.8rem;border:0;border-radius:10px;background:var(--teal);color:#04212a;font-weight:700;font-size:1rem;cursor:pointer}
button:hover{filter:brightness(1.08)}.err{color:var(--red);font-size:.85rem;margin-top:.75rem;min-height:1.1rem}
.badge{display:inline-block;background:#1c2a2e;color:var(--teal);border-radius:999px;padding:.15rem .6rem;font-size:.7rem;margin-bottom:1rem;letter-spacing:.03em}`;

function page(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>${title}</title><style>${BASE_CSS}</style></head><body>${body}</body></html>`;
}

export function loginPage(localOnly = false): string {
  const note = localOnly ? "<span class=badge>LOCAL SETUP</span>" : "<span class=badge>noop-cloud</span>";
  const hint = localOnly
    ? "<p class=sub>First run — sign in with <b>admin / admin</b>, then pick a real password.</p>"
    : "<p class=sub>Sign in to your self-hosted noop-cloud.</p>";
  return page("Sign in · noop-cloud", `
<form class=card id=f onsubmit="return doLogin(event)">
  ${note}<h1>Sign in</h1>${hint}
  <label>Username</label><input id=u name=username autocomplete=username autofocus required>
  <label>Password</label><input id=p name=password type=password autocomplete=current-password required>
  <button type=submit>Sign in</button><div class=err id=e></div>
</form>
<script>
async function doLogin(ev){ev.preventDefault();const e=document.getElementById('e');e.textContent='';
 const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u.value,password:p.value})});
 const j=await r.json().catch(()=>({}));if(!r.ok){e.textContent=j.error||'sign in failed';return false;}
 location.href=j.must_change?'/change':'/app';return false;}
</script>`);
}

export function changePage(): string {
  const pat = "[A-Za-z0-9]{3}-[A-Za-z0-9]{3}-[A-Za-z0-9]{3}";
  return page("Set password · noop-cloud", `
<form class=card id=f onsubmit="return doChange(event)">
  <span class=badge>SET PASSWORD</span><h1>Choose a password</h1>
  <p class=sub>Format: three groups of three letters or digits — <b>xxx-xxx-xxx</b>. Until you set one, the cloud only answers on localhost.</p>
  <label>New password</label><input id=p1 autocomplete=new-password placeholder="xxx-xxx-xxx" pattern="${pat}" maxlength=11 title="Three groups of three letters or digits, e.g. a3f-9km-2xz" autofocus required>
  <label>Confirm password</label><input id=p2 type=password autocomplete=new-password placeholder="xxx-xxx-xxx" pattern="${pat}" maxlength=11 required>
  <button type=button id=g style="background:#1c2a2e;color:var(--teal);margin-top:.75rem">Generate a strong one</button>
  <button type=submit>Save &amp; continue</button><div class=err id=e></div>
</form>
<script>
var RE=/^${pat}$/;
document.getElementById('g').onclick=function(){var a='abcdefghjkmnpqrstuvwxyz23456789',b=new Uint32Array(9),s='';crypto.getRandomValues(b);for(var i=0;i<9;i++){s+=a[b[i]%a.length];if(i===2||i===5)s+='-';}p1.value=p2.value=s;p1.type=p2.type='text';};
async function doChange(ev){ev.preventDefault();const e=document.getElementById('e');e.textContent='';
 if(!RE.test(p1.value)){e.textContent='use xxx-xxx-xxx — 3 groups of 3 letters or digits';return false;}
 if(p1.value!==p2.value){e.textContent='passwords do not match';return false;}
 const r=await fetch('/api/password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({new_password:p1.value})});
 const j=await r.json().catch(()=>({}));if(!r.ok){e.textContent=j.error||'could not set password';return false;}
 location.href='/app';return false;}
</script>`);
}
