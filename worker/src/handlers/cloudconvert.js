// CloudConvert PDF to image conversion utility
// Usage: await convertPdfToImage(pdfUrl, apiKey)

export async function convertPdfToImage(pdfUrl, apiKey) {
  // Download the PDF file
  const pdfResponse = await fetch(pdfUrl);
  if (!pdfResponse.ok) throw new Error('Failed to download PDF for CloudConvert');
  const pdfArrayBuffer = await pdfResponse.arrayBuffer();

  // Create CloudConvert job
  const createJobRes = await fetch('https://api.cloudconvert.com/v2/jobs', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      tasks: {
        import: {
          operation: 'import/upload'
        },
        convert: {
          operation: 'convert',
          input: 'import',
          output_format: 'png',
          page_range: '1', // Only first page for invoice
          engine: 'poppler',
        },
        export: {
          operation: 'export/url',
          input: 'convert',
        }
      }
    })
  });
  if (!createJobRes.ok) throw new Error('Failed to create CloudConvert job');
  const job = await createJobRes.json();
  const importTask = Object.values(job.data.tasks).find(t => t.operation === 'import/upload');
  if (!importTask || !importTask.result || !importTask.result.form) throw new Error('CloudConvert import task missing');

  // Upload PDF to CloudConvert
  const form = new FormData();
  for (const [k, v] of Object.entries(importTask.result.form.parameters)) {
    form.append(k, v);
  }
  form.append('file', new Blob([pdfArrayBuffer]), 'invoice.pdf');
  const uploadRes = await fetch(importTask.result.form.url, {
    method: 'POST',
    body: form
  });
  if (!uploadRes.ok) throw new Error('Failed to upload PDF to CloudConvert');

  // Poll for job completion
  let exportTask;
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const pollRes = await fetch(`https://api.cloudconvert.com/v2/jobs/${job.data.id}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    });
    if (!pollRes.ok) throw new Error('Failed to poll CloudConvert job');
    const pollJob = await pollRes.json();
    exportTask = Object.values(pollJob.data.tasks).find(t => t.name === 'export' || t.operation === 'export/url');
    if (exportTask && exportTask.status === 'finished' && exportTask.result && exportTask.result.files && exportTask.result.files.length > 0) {
      break;
    }
  }
  if (!exportTask || !exportTask.result || !exportTask.result.files || exportTask.result.files.length === 0) {
    throw new Error('CloudConvert export task did not complete');
  }
  // Return the image URL (first page)
  return exportTask.result.files[0].url;
}
