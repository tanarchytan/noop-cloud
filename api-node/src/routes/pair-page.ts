/** The owner's /pair approval page (enter the rotating code + admin PIN). Posts JSON to /pair/approve,
 *  so no urlencoded body parser is needed. */
export const PAIR_PAGE = `<!doctype html><html><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>Link your noop app</title>
<style>body{font-family:system-ui,sans-serif;max-width:22rem;margin:3rem auto;padding:0 1rem}input{font-size:1.1rem;padding:.6rem;width:100%;box-sizing:border-box;margin:.3rem 0}button{font-size:1.1rem;padding:.7rem 1rem;width:100%;margin-top:.5rem;cursor:pointer}h1{font-size:1.3rem}small{color:#666}</style></head><body>
<h1>Link your noop app</h1><p>Enter the code shown in the app, plus this cloud's admin PIN.</p>
<input id=uc placeholder="NOOP-XXXX" autocapitalize=characters autocomplete=off>
<input id=pin type=password placeholder="admin PIN" autocomplete=off>
<button onclick=go()>Approve</button><p id=m></p>
<small>The code rotates and expires — if it's stale, tap "Link" again in the app.</small>
<script>async function go(){const r=await fetch('/pair/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user_code:uc.value,pin:pin.value})});const j=await r.json().catch(()=>({}));document.getElementById('m').textContent=j.message||j.error||'';}</script>
</body></html>`;
