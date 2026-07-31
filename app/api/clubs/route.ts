import { NextResponse } from "next/server";
import { loadClubIndex } from "@/lib/prediction-log/club-store";

export async function GET() {
  // #region agent log
  const _t0 = Date.now();
  fetch('http://127.0.0.1:7484/ingest/38649fab-69bc-43fe-918c-13ca943dd3c2',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'915201'},body:JSON.stringify({sessionId:'915201',hypothesisId:'C',location:'app/api/clubs/route.ts:GET',message:'clubs index entry',data:{kvConfigured:!!(process.env.KV_REST_API_URL&&process.env.KV_REST_API_TOKEN)},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  try {
    const index = await loadClubIndex();
    // #region agent log
    fetch('http://127.0.0.1:7484/ingest/38649fab-69bc-43fe-918c-13ca943dd3c2',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'915201'},body:JSON.stringify({sessionId:'915201',hypothesisId:'C',location:'app/api/clubs/route.ts:GET',message:'clubs index ok',data:{ms:Date.now()-_t0,clubCount:index?.clubs?.length??null},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return NextResponse.json({ index });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load club index";
    // #region agent log
    fetch('http://127.0.0.1:7484/ingest/38649fab-69bc-43fe-918c-13ca943dd3c2',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'915201'},body:JSON.stringify({sessionId:'915201',hypothesisId:'C',location:'app/api/clubs/route.ts:GET',message:'clubs index error',data:{ms:Date.now()-_t0,err:msg.slice(0,160)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
