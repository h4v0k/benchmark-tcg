/** Opens a generated PDF in a new tab; if the browser blocks that, downloads it instead (never leaves the page). */
export function openPdf(bytes: Uint8Array<ArrayBuffer>, fileName: string) {
  const url = URL.createObjectURL(new File([bytes], fileName, { type: 'application/pdf' }));
  if (!window.open(url, '_blank')) { const a = document.createElement('a'); a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove(); }
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
}
