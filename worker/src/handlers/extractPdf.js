export async function handleExtractPdf(request, env, ctx) {
  return new Response(JSON.stringify({ success: false, error: 'PDF extraction endpoint is disabled. Use CloudConvert pipeline.' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' }
  });
}
