export function createImportPayload(candidate, operationId) {
  const name = typeof candidate?.name === 'string' ? candidate.name.trim() : '';
  const latitude = candidate?.coordinate?.latitude;
  const longitude = candidate?.coordinate?.longitude;
  if (!name || [...name].length > 300 || !Number.isFinite(latitude) || !Number.isFinite(longitude)
    || Math.abs(latitude) > 90 || Math.abs(longitude) > 180
    || typeof operationId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(operationId)) {
    throw new Error('地點名稱或座標不完整，請重新選取地點。');
  }
  let sourceUrl = candidate.sourceUrl ?? null;
  if (sourceUrl !== null) {
    const url = new URL(sourceUrl);
    if (url.protocol !== 'https:' || url.username || url.password || sourceUrl.length > 8192) throw new Error('地點來源網址無效。');
    sourceUrl = url.href;
  }
  return { p_name: name, p_latitude: latitude, p_longitude: longitude,
    p_operation_id: operationId, p_source_url: sourceUrl };
}
